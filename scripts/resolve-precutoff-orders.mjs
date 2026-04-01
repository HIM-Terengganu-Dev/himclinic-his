/**
 * resolve-precutoff-orders.mjs
 *
 * Clears processing / pending_consult / pending_review held by orders
 * that FIRST appeared BEFORE 2026-03-03 00:00 MYT (2026-03-02T16:00:00Z)
 * and are still "active" (no terminal event: nv-pending-pickup / cancelled / refunded).
 *
 * Skips dummy SKUs (description = 'dummy sku').
 *
 * Per-bucket treatment:
 *   processing         → deduct from in_warehouse (items physically dispatched) + clear processing
 *   pending_consult / pending_review → clear bucket only (no in_warehouse deduction)
 *
 * Satisfies all DB check constraints:
 *   stock_check:              stock_after = stock_before + quantity_change
 *   stock_non_negative:       stock_after >= 0
 *   in_warehouse_non_negative: in_warehouse_after >= 0
 *   (all others enforced by Math.max(0, ...) guards)
 *
 * Inserts one reconciliation transaction per (order, sku), processed sequentially
 * so each step reads the freshest state before computing the next correction.
 *
 * DRY RUN by default. Pass --apply to write changes.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf-8');
let DDL = '';
for (const l of envContent.split(/\r?\n/)) {
    const m = l.match(/^DATABASE_URL_DDL=(.+)$/);
    if (m) { DDL = m[1].trim(); break; }
}
if (!DDL) { console.error('❌ DATABASE_URL_DDL not found in .env.local'); process.exit(1); }
console.log('✅ Loaded DATABASE_URL_DDL from .env.local\n');

const DRY_RUN = !process.argv.includes('--apply');
console.log(DRY_RUN
    ? '🔍 DRY RUN MODE — no changes. Pass --apply to execute.\n'
    : '🚀 APPLY MODE — changes WILL be written.\n');

const CUTOFF = '2026-03-02T16:00:00Z'; // 2026-03-03 00:00 MYT

const client = new Client({ connectionString: DDL });
await client.connect();

try {
    // ── Step 1: Find all pre-cutoff active (order, sku) pairs ─────────────
    console.log('Step 1: Finding pre-cutoff active orders with held stock (skipping dummy SKUs)...\n');

    const res = await client.query(`
        WITH
        PreCutoffOrders AS (
            SELECT entity_id AS order_id
            FROM his_db.wc_webhook_logs
            WHERE webhook_type = 'order' AND success = true
            GROUP BY entity_id
            HAVING MIN(created_at) < $1::timestamptz
        ),
        TerminalOrders AS (
            SELECT DISTINCT entity_id AS order_id
            FROM his_db.wc_webhook_logs
            WHERE webhook_type = 'order' AND success = true
              AND webhook_event IN ('order.nv-pending-pickup','order.cancelled','order.refunded')
        ),
        ActivePreCutoff AS (
            SELECT pc.order_id
            FROM PreCutoffOrders pc
            LEFT JOIN TerminalOrders t ON pc.order_id = t.order_id
            WHERE t.order_id IS NULL
        ),
        NetTx AS (
            SELECT
                st.source_id                                              AS order_id,
                st.sku,
                st.single_sku_id,
                GREATEST(0, SUM(st.processing_after      - st.processing_before))      AS net_proc,
                GREATEST(0, SUM(st.pending_consult_after - st.pending_consult_before)) AS net_pc,
                GREATEST(0, SUM(st.pending_review_after  - st.pending_review_before))  AS net_pr
            FROM his_db.stock_transactions st
            INNER JOIN ActivePreCutoff apc ON st.source_id = apc.order_id
            WHERE st.source_type = 'order'
            GROUP BY st.source_id, st.sku, st.single_sku_id
        )
        SELECT n.*
        FROM NetTx n
        -- Skip dummy SKUs
        LEFT JOIN his_db.single_skus ss ON ss.sku = n.sku
        WHERE (n.net_proc > 0 OR n.net_pc > 0 OR n.net_pr > 0)
          AND LOWER(COALESCE(ss.description, '')) != 'dummy sku'
        ORDER BY n.sku, n.order_id
    `, [CUTOFF]);

    if (res.rows.length === 0) {
        console.log('✅ No pre-cutoff active orders to resolve. Nothing to do.');
        await client.end();
        process.exit(0);
    }

    console.log(`⚠️  Found ${res.rows.length} (order, SKU) pair(s) to resolve:\n`);
    console.table(res.rows.map(r => ({
        order_id: r.order_id, sku: r.sku,
        net_proc: r.net_proc, net_pc: r.net_pc, net_pr: r.net_pr,
    })));

    // Summary by SKU
    const bySkuSummary = {};
    for (const r of res.rows) {
        bySkuSummary[r.sku] = bySkuSummary[r.sku] || { proc: 0, pc: 0, pr: 0 };
        bySkuSummary[r.sku].proc += Number(r.net_proc);
        bySkuSummary[r.sku].pc   += Number(r.net_pc);
        bySkuSummary[r.sku].pr   += Number(r.net_pr);
    }
    console.log('\nSummary — total to clear per SKU:');
    console.table(Object.entries(bySkuSummary).map(([sku, v]) => ({
        sku,
        clear_processing: v.proc,
        clear_pending_consult: v.pc,
        clear_pending_review: v.pr,
        deduct_in_warehouse: v.proc,
    })));

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN complete. Run with --apply to write changes.\n');
        await client.end();
        process.exit(0);
    }

    // ── Step 2: Apply — one tx per (order, sku), reading fresh state each time ─
    console.log('\nStep 2: Applying corrections...\n');
    await client.query('BEGIN');

    try {
        for (const row of res.rows) {
            const { order_id, sku, single_sku_id } = row;
            const netProc = Number(row.net_proc);
            const netPc   = Number(row.net_pc);
            const netPr   = Number(row.net_pr);

            // Read FRESH current global state (previous loop iterations may have changed it)
            const stateRes = await client.query(`
                SELECT DISTINCT ON (sku)
                    in_warehouse_after    AS in_warehouse,
                    processing_after      AS processing,
                    pending_consult_after AS pending_consult,
                    pending_review_after  AS pending_review,
                    backorder_after       AS backorder,
                    stock_after           AS stock,
                    pending_after         AS pending
                FROM his_db.stock_transactions
                WHERE sku = $1
                ORDER BY sku, id DESC
            `, [sku]);

            if (stateRes.rows.length === 0) {
                console.warn(`⚠️  No transactions for ${sku}, skipping.`);
                continue;
            }
            const s = stateRes.rows[0];

            const inWarehouseBefore    = Number(s.in_warehouse);
            const processingBefore     = Number(s.processing);
            const pendingConsultBefore = Number(s.pending_consult);
            const pendingReviewBefore  = Number(s.pending_review);
            const stockBefore          = Number(s.stock);
            const pendingBefore        = Number(s.pending);

            // Cap deductions at what's actually available to avoid constraint violations
            const procDeduct = Math.min(netProc, processingBefore);   // can't clear more than global has
            const warehouseDeduct = Math.min(procDeduct, inWarehouseBefore); // in_warehouse >= 0
            const pcDeduct = Math.min(netPc, pendingConsultBefore);
            const prDeduct = Math.min(netPr, pendingReviewBefore);

            // Legacy stock field: must satisfy stock_after = stock_before + quantity_change
            // and stock_after >= 0. Use the warehouse deduction capped at stock_before.
            const stockDeduct = Math.min(warehouseDeduct, stockBefore);
            const quantityChange = -stockDeduct; // satisfies stock_check constraint

            const inWarehouseAfter    = inWarehouseBefore - warehouseDeduct;
            const processingAfter     = processingBefore - procDeduct;
            const pendingConsultAfter = pendingConsultBefore - pcDeduct;
            const pendingReviewAfter  = pendingReviewBefore - prDeduct;
            const stockAfter          = stockBefore - stockDeduct;      // = stockBefore + quantityChange ✓
            const pendingAfter        = pendingBefore - pcDeduct - prDeduct;

            const backorderBefore = Math.max(0, (pendingConsultBefore + pendingReviewBefore + processingBefore) - inWarehouseBefore);
            const backorderAfter  = Math.max(0, (pendingConsultAfter  + pendingReviewAfter  + processingAfter)  - inWarehouseAfter);

            const details = JSON.stringify({
                correction: true,
                reason: 'Resolved pre-cutoff active order — clearing held processing/pending stock',
                order_id,
                net_proc_cleared:      procDeduct,
                net_pc_cleared:        pcDeduct,
                net_pr_cleared:        prDeduct,
                in_warehouse_deducted: warehouseDeduct,
                script: 'resolve-precutoff-orders.mjs',
                applied_at: new Date().toISOString(),
            });

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
                    source_type, source_id, source_event,
                    details, created_at
                ) VALUES (
                    $1, $2, 'reconciliation', $3,
                    $4, $5,
                    $6, $7,
                    $8, $9,
                    $10, $11,
                    $12, $13,
                    $14, $15,
                    $16, $17,
                    'order', $18, 'resolve.precutoff_order',
                    $19::jsonb, NOW()
                )
            `, [
                sku, single_sku_id,
                quantityChange,
                stockBefore,   stockAfter,
                pendingBefore, pendingAfter,
                inWarehouseBefore, inWarehouseAfter,
                processingBefore,  processingAfter,
                pendingConsultBefore, pendingConsultAfter,
                pendingReviewBefore,  pendingReviewAfter,
                backorderBefore, backorderAfter,
                order_id,
                details,
            ]);

            console.log(
                `✅ order ${order_id} / ${sku}: ` +
                `proc ${processingBefore}→${processingAfter}  ` +
                `in_wh ${inWarehouseBefore}→${inWarehouseAfter}  ` +
                `pc ${pendingConsultBefore}→${pendingConsultAfter}  ` +
                `pr ${pendingReviewBefore}→${pendingReviewAfter}`
            );
        }

        await client.query('COMMIT');
        console.log('\n✅ COMMIT — all pre-cutoff order resolutions applied.\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ ROLLBACK:', err.message);
        throw err;
    }

    // ── Step 3: Final state ─────────────────────────────────────────────────
    console.log('Step 3: Final dashboard state (SKUs with non-zero active buckets):\n');
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
    const relevant = finalRes.rows.filter(r =>
        Number(r.processing) > 0 || Number(r.pending_consult) > 0 || Number(r.pending_review) > 0
    );
    if (relevant.length === 0) {
        console.log('✅ All SKUs cleared — only post-cutoff active orders remain.\n');
    } else {
        console.table(relevant.map(r => ({
            sku: r.sku,
            in_warehouse: r.in_warehouse,
            processing: r.processing,
            pending_consult: r.pending_consult,
            pending_review: r.pending_review,
        })));
    }

} catch (e) {
    console.error('❌ Fatal:', e.message);
    process.exit(1);
} finally {
    await client.end();
}
