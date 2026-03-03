/**
 * Reconcile Processing Count to 0 for All SKUs
 *
 * Finds every SKU whose latest stock_transaction has processing_after > 0,
 * then inserts a 'reconciliation' transaction that resets processing to 0
 * while preserving all other stock state values.
 *
 * Uses DATABASE_URL_DDL from .env.local for write access.
 *
 * DRY_RUN = true by default. Set to false to apply changes.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;

// ── Load DATABASE_URL_DDL from .env.local ──────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

let DDL = '';
for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL_DDL=(.+)$/);
    if (match) {
        DDL = match[1].trim();
        break;
    }
}

if (!DDL) {
    console.error('❌ Could not find DATABASE_URL_DDL in .env.local');
    process.exit(1);
}

console.log('✅ Loaded DATABASE_URL_DDL from .env.local');

// ── Config ─────────────────────────────────────────────────────────────────
const DRY_RUN = false; // ← Set to false to apply changes

// ── Connect ────────────────────────────────────────────────────────────────
const client = new Client({ connectionString: DDL });
await client.connect();

try {
    console.log('\n🔍 Finding all SKUs with processing_after > 0 in their latest transaction...\n');

    // Get the latest transaction per SKU where processing_after > 0
    const res = await client.query(`
    WITH LatestTx AS (
      SELECT DISTINCT ON (sku)
        id,
        sku,
        single_sku_id,
        in_warehouse_after,
        processing_after,
        pending_consult_after,
        pending_review_after,
        backorder_after,
        stock_after,
        pending_after
      FROM his_db.stock_transactions
      ORDER BY sku, id DESC
    )
    SELECT *
    FROM LatestTx
    WHERE processing_after > 0
    ORDER BY sku
  `);

    if (res.rows.length === 0) {
        console.log('✅ All SKUs already have processing = 0. Nothing to do.');
        await client.end();
        process.exit(0);
    }

    console.log(`⚠️  Found ${res.rows.length} SKU(s) with processing > 0:\n`);
    console.table(res.rows.map(r => ({
        sku: r.sku,
        processing_before: r.processing_after,
        in_warehouse: r.in_warehouse_after,
        pending_consult: r.pending_consult_after,
        pending_review: r.pending_review_after,
        backorder: r.backorder_after,
    })));

    if (DRY_RUN) {
        console.log('\n🔒 DRY RUN — No changes applied. Set DRY_RUN = false to apply fixes.');
        await client.end();
        process.exit(0);
    }

    // ── Apply reconciliation transactions ──────────────────────────────────
    await client.query('BEGIN');

    let fixed = 0;
    for (const row of res.rows) {
        const processingBefore = parseInt(row.processing_after, 10);
        const inWarehouseBefore = parseInt(row.in_warehouse_after, 10);
        const pendingConsultBefore = parseInt(row.pending_consult_after, 10);
        const pendingReviewBefore = parseInt(row.pending_review_after, 10);
        const backorderBefore = parseInt(row.backorder_after, 10);
        const stockBefore = parseInt(row.stock_after, 10);
        const pendingBefore = parseInt(row.pending_after, 10);

        const processingAfter = 0;
        // Recalculate backorder after zeroing processing:
        // backorder = max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
        const backorderAfter = Math.max(
            0,
            (pendingConsultBefore + pendingReviewBefore + processingAfter) - inWarehouseBefore
        );

        console.log(`\n🔧 [${row.sku}] processing: ${processingBefore} → 0  |  backorder: ${backorderBefore} → ${backorderAfter}`);

        await client.query(`
      INSERT INTO his_db.stock_transactions (
        sku, single_sku_id, transaction_type, quantity_change,
        stock_before, stock_after,
        pending_before, pending_after,
        in_warehouse_before, in_warehouse_after,
        processing_before, processing_after,
        pending_consult_before, pending_consult_after,
        pending_review_before, pending_review_after,
        backorder_before, backorder_after,
        source_type, source_event,
        details, created_at
      ) VALUES (
        $1, $2, 'reconciliation', 0,
        $3, $3,
        $4, $4,
        $5, $5,
        $6, $7,
        $8, $8,
        $9, $9,
        $10, $11,
        'manual', 'reconcile.processing_zero',
        $12::jsonb, NOW()
      )
    `, [
            row.sku, row.single_sku_id,
            stockBefore,
            pendingBefore,
            inWarehouseBefore,
            processingBefore, processingAfter,        // processing_before, processing_after
            pendingConsultBefore,
            pendingReviewBefore,
            backorderBefore, backorderAfter,
            JSON.stringify({
                reason: 'Manual reconciliation: reset processing count to 0',
                processing_cleared: processingBefore,
            }),
        ]);

        console.log(`  ✅ Reconciliation transaction inserted for ${row.sku}`);
        fixed++;
    }

    await client.query('COMMIT');
    console.log(`\n🎉 Done! Reconciled ${fixed} SKU(s) — processing set to 0 for all.`);

} catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    console.error('❌ Error:', e);
    process.exit(1);
} finally {
    await client.end();
}
