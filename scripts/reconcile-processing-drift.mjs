/**
 * reconcile-processing-drift.mjs
 *
 * Fixes the "processing" counter drift where the global processing_after
 * in stock_transactions is higher than the true active processing load.
 *
 * Root cause:
 *   - nv-pending-pickup handler guardrail (orderProcessingQty < totalQty)
 *     caused it to SKIP clearing processing for some orders.
 *   - Duplicate order.processing webhooks from WooCommerce also inflated counts.
 *   - Result: processing_after accumulated without being cleared.
 *
 * Fix strategy:
 *   Compute the TRUE processing per SKU = net sum of ALL active orders
 *   (orders that have NOT received nv-pending-pickup / cancelled / refunded).
 *   Then insert a single 'reconciliation' correction transaction per drifted SKU.
 *
 * DRY RUN by default. Pass --apply to write changes.
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
    if (match) { DDL = match[1].trim(); break; }
}
if (!DDL) { console.error('❌ DATABASE_URL_DDL not found in .env.local'); process.exit(1); }
console.log('✅ Loaded DATABASE_URL_DDL from .env.local\n');

const DRY_RUN = !process.argv.includes('--apply');
if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — no changes will be made. Pass --apply to execute.\n');
} else {
    console.log('🚀 APPLY MODE — changes WILL be written to the database.\n');
}

const client = new Client({ connectionString: DDL });
await client.connect();

try {
    // ── Step 1: Current global state (what dashboard shows) ───────────────
    console.log('Step 1: Reading current global processing_after per SKU (dashboard view)...\n');
    const globalRes = await client.query(`
        SELECT DISTINCT ON (sku)
            id                    AS latest_tx_id,
            sku,
            single_sku_id,
            in_warehouse_after    AS in_warehouse,
            processing_after      AS processing,
            pending_consult_after AS pending_consult,
            pending_review_after  AS pending_review,
            backorder_after       AS backorder,
            stock_after           AS stock,
            pending_after         AS pending
        FROM his_db.stock_transactions
        ORDER BY sku, id DESC
    `);
    const globalMap = {};
    for (const r of globalRes.rows) globalMap[r.sku] = r;

    const nonZero = globalRes.rows.filter(r => Number(r.processing) > 0);
    console.log('SKUs currently showing processing > 0 on dashboard:');
    console.table(nonZero.map(r => ({
        sku: r.sku,
        in_warehouse: r.in_warehouse,
        processing: r.processing,
        pending_consult: r.pending_consult,
        pending_review: r.pending_review,
    })));

    // ── Step 2: Compute CORRECT processing from ALL active orders ─────────
    // "Active" = has stock_transactions with source_type='order' AND
    //            has NOT received nv-pending-pickup / cancelled / refunded
    //            (checked in wc_webhook_logs, no cutoff — covers all history)
    console.log('\nStep 2: Computing correct processing from ALL active (non-terminal) orders...\n');
    const correctRes = await client.query(`
        WITH
        -- Orders whose last webhook event is terminal (shipped / cancelled / refunded)
        TerminalOrders AS (
            SELECT DISTINCT entity_id AS order_id
            FROM his_db.wc_webhook_logs
            WHERE webhook_type = 'order'
              AND success = true
              AND webhook_event IN ('order.nv-pending-pickup', 'order.cancelled', 'order.refunded')
        ),
        -- Net processing each order contributed (positive delta = still holding)
        NetOrderTx AS (
            SELECT
                st.sku,
                st.source_id AS order_id,
                GREATEST(0, SUM(st.processing_after - st.processing_before)) AS processing
            FROM his_db.stock_transactions st
            WHERE st.source_type = 'order'
            GROUP BY st.sku, st.source_id
        ),
        -- Only keep orders that are NOT terminal
        ActiveNetTx AS (
            SELECT n.sku, n.order_id, n.processing
            FROM NetOrderTx n
            LEFT JOIN TerminalOrders t ON n.order_id = t.order_id
            WHERE t.order_id IS NULL
              AND n.processing > 0
        )
        SELECT sku, SUM(processing) AS correct_processing
        FROM ActiveNetTx
        GROUP BY sku
        ORDER BY sku
    `);
    const correctMap = {};
    for (const r of correctRes.rows) correctMap[r.sku] = Number(r.correct_processing);

    console.log('Correct (active-only) processing per SKU:');
    console.table(correctRes.rows);

    // ── Step 3: Find drifted SKUs ─────────────────────────────────────────
    console.log('\nStep 3: Identifying discrepancies...\n');
    const allSkus = new Set([
        ...Object.keys(globalMap).filter(s => Number(globalMap[s].processing) > 0),
        ...Object.keys(correctMap),
    ]);

    const drifted = [];
    for (const sku of allSkus) {
        const g = globalMap[sku];
        if (!g) continue;
        const currentProc = Number(g.processing);
        const correctProc = correctMap[sku] ?? 0;
        if (currentProc !== correctProc) {
            drifted.push({ sku, current: currentProc, correct: correctProc, drift: currentProc - correctProc });
        }
    }

    if (drifted.length === 0) {
        console.log('✅ No discrepancies found! Dashboard and active orders are in sync.');
        await client.end();
        process.exit(0);
    }

    console.log(`⚠️  Found ${drifted.length} SKU(s) with processing drift:\n`);
    console.table(drifted.map(d => ({
        sku: d.sku,
        dashboard_processing: d.current,
        should_be: d.correct,
        excess_to_clear: d.drift,
    })));

    // ── Step 4: Insert correction transactions ────────────────────────────
    console.log('\nStep 4: Inserting correction transactions...\n');

    if (!DRY_RUN) await client.query('BEGIN');

    try {
        for (const item of drifted) {
            const { sku, correct } = item;
            const g = globalMap[sku];

            const inWarehouse     = Number(g.in_warehouse);
            const pendingConsult  = Number(g.pending_consult);
            const pendingReview   = Number(g.pending_review);
            const stockVal        = Number(g.stock);
            const pendingVal      = Number(g.pending);
            const processingBefore = Number(g.processing);
            const processingAfter  = correct;  // the correct value

            const backorderBefore = Math.max(0, (pendingConsult + pendingReview + processingBefore) - inWarehouse);
            const backorderAfter  = Math.max(0, (pendingConsult + pendingReview + processingAfter)  - inWarehouse);

            const details = JSON.stringify({
                correction: true,
                reason: 'Processing counter drift reconciliation — orders cleared via nv-pending-pickup/cancel were not zeroing the processing bucket',
                processingBefore,
                processingAfter,
                excess_cleared: processingBefore - processingAfter,
                script: 'reconcile-processing-drift.mjs',
                applied_at: new Date().toISOString(),
            });

            if (DRY_RUN) {
                console.log(`[DRY RUN] ${sku}: processing ${processingBefore} → ${processingAfter} (clearing ${processingBefore - processingAfter})`);
                console.log(`          backorder ${backorderBefore} → ${backorderAfter}`);
            } else {
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
                        'manual', 'reconcile.processing_drift',
                        $12::jsonb, NOW()
                    )
                `, [
                    sku, g.single_sku_id,
                    stockVal,                           // stock_before = stock_after
                    pendingVal,                         // pending_before = pending_after
                    inWarehouse,                        // in_warehouse_before = in_warehouse_after
                    processingBefore, processingAfter,
                    pendingConsult,                     // pending_consult_before = after (unchanged)
                    pendingReview,                      // pending_review_before = after (unchanged)
                    backorderBefore, backorderAfter,
                    details,
                ]);
                console.log(`✅ Correction inserted for ${sku}: processing ${processingBefore} → ${processingAfter} | backorder ${backorderBefore} → ${backorderAfter}`);
            }
        }

        if (!DRY_RUN) {
            await client.query('COMMIT');
            console.log('\n✅ COMMIT — all corrections applied successfully.\n');
        } else {
            console.log('\n🔍 DRY RUN complete. Run with --apply to write changes.\n');
        }
    } catch (err) {
        if (!DRY_RUN) {
            await client.query('ROLLBACK');
            console.error('❌ ROLLBACK — error during correction:', err.message);
        }
        throw err;
    }

    // ── Step 5: Verify after apply ────────────────────────────────────────
    if (!DRY_RUN) {
        console.log('Step 5: Final verification...\n');
        const finalRes = await client.query(`
            SELECT DISTINCT ON (sku)
                sku,
                in_warehouse_after    AS in_warehouse,
                processing_after      AS processing,
                pending_consult_after AS pending_consult,
                pending_review_after  AS pending_review
            FROM his_db.stock_transactions
            ORDER BY sku, id DESC
        `);
        const finalNonZero = finalRes.rows.filter(r => Number(r.processing) > 0);
        if (finalNonZero.length === 0) {
            console.log('✅ All SKUs now have correct processing values.\n');
        } else {
            console.log('SKUs still showing processing > 0 (expected if active orders exist):');
            console.table(finalNonZero.map(r => ({
                sku: r.sku, processing: r.processing,
                pending_consult: r.pending_consult, pending_review: r.pending_review,
            })));
        }
    }

} catch (e) {
    console.error('❌ Fatal error:', e.message);
    process.exit(1);
} finally {
    await client.end();
}
