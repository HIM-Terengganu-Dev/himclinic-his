/**
 * Fix: Re-reconcile processing counts to match genuinely active processing orders.
 *
 * The problem:
 *   - Some orders that reached nv-pending-pickup (dispatched) or were cancelled still
 *     have a residual positive net processing delta in stock_transactions, inflating
 *     the global processing count shown on the dashboard.
 *   - The CORRECT processing count per SKU should be the sum of net processing
 *     contributions from orders whose LATEST webhook log is still 'processing'
 *     (i.e., genuinely in-flight, not dispatched/cancelled/refunded).
 *
 * Fix:
 *   For each SKU where current processing_after != expected, insert a
 *   'reconciliation' transaction that sets processing to the correct value.
 *
 * DRY_RUN = true by default. Set to false to apply.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf-8');
const match = envContent.match(/DATABASE_URL_DDL\s*=\s*(.+)/);
if (!match) { console.error('❌ DATABASE_URL_DDL not found'); process.exit(1); }
const DDL = match[1].trim();

const DRY_RUN = false; // ← set false to apply

const client = new Client({ connectionString: DDL });
await client.connect();

console.log('\n🔍 Calculating correct processing count per SKU from active orders...\n');

// ── Step 1: Correct processing per SKU ──────────────────────────────────────
// An order is "genuinely in processing" if:
//   a) It has at least one order_processing transaction, AND
//   b) Its LATEST webhook log status is 'processing' (not nv-pending-pickup/cancelled/refunded)
const correctRes = await client.query(`
  WITH
  -- Last known status per order from webhook logs
  LastStatus AS (
    SELECT DISTINCT ON (entity_id)
      entity_id AS order_id,
      current_status AS last_status,
      webhook_event  AS last_event
    FROM his_db.wc_webhook_logs
    WHERE webhook_type = 'order' AND success = true
    ORDER BY entity_id, created_at DESC, id DESC
  ),
  -- Net processing delta per (order, sku) across all transactions
  NetProcessing AS (
    SELECT
      source_id AS order_id,
      sku,
      SUM(processing_after - processing_before) AS net_processing
    FROM his_db.stock_transactions
    WHERE source_type = 'order'
    GROUP BY source_id, sku
    HAVING SUM(processing_after - processing_before) > 0
  ),
  -- Join to get only genuinely active orders
  ActiveProcessing AS (
    SELECT np.sku, np.order_id, np.net_processing, ls.last_status, ls.last_event
    FROM NetProcessing np
    JOIN LastStatus ls ON np.order_id = ls.order_id
    WHERE ls.last_status = 'processing'
  )
  SELECT
    sku,
    COALESCE(SUM(net_processing), 0)::int AS correct_processing,
    json_agg(json_build_object(
      'order_id', order_id,
      'net_processing', net_processing,
      'last_status', last_status
    ) ORDER BY order_id) AS active_orders
  FROM ActiveProcessing
  GROUP BY sku
  ORDER BY sku
`);

// ── Step 2: Current global processing per SKU ────────────────────────────────
const currentRes = await client.query(`
  SELECT DISTINCT ON (sku)
    sku, processing_after AS current_processing,
    pending_consult_after AS pending_consult,
    pending_review_after AS pending_review,
    in_warehouse_after AS in_warehouse,
    backorder_after AS backorder,
    stock_after, pending_after,
    single_sku_id, id AS latest_tx_id
  FROM his_db.stock_transactions
  WHERE source_type = 'order' OR transaction_type NOT IN ('manual_add','manual_subtract','manual_set')
  ORDER BY sku, id DESC
`);
// Rebuild as map
const currentMap = {};
for (const r of currentRes.rows) {
    currentMap[r.sku] = r;
}

// ── Step 3: Identify SKUs that need correction ───────────────────────────────
console.log('\n📊 Comparison: current vs correct processing per SKU:\n');
const toFix = [];

// Build correct map
const correctMap = {};
for (const r of correctRes.rows) {
    correctMap[r.sku] = r;
}

// Get all SKUs that either have current > 0 OR expected > 0
const allSkuRes = await client.query(`
  SELECT DISTINCT ON (sku)
    sku,
    processing_after AS current_processing,
    pending_consult_after AS pending_consult,
    pending_review_after  AS pending_review,
    in_warehouse_after    AS in_warehouse,
    backorder_after       AS backorder_after,
    stock_after,
    pending_after,
    single_sku_id
  FROM his_db.stock_transactions
  ORDER BY sku, id DESC
`);

for (const r of allSkuRes.rows) {
    const current = parseInt(r.current_processing || '0', 10);
    const expected = correctMap[r.sku]?.correct_processing ?? 0;
    if (current !== expected) {
        console.log(`⚠️  ${r.sku}: current=${current} → correct=${expected}  (diff=${expected - current})`);
        if (correctMap[r.sku]) {
            console.log('    Active orders:', JSON.stringify(correctMap[r.sku].active_orders));
        } else {
            console.log('    No genuinely active processing orders found.');
        }
        toFix.push({ sku: r.sku, current, expected, row: r });
    } else {
        console.log(`✅  ${r.sku}: processing=${current} (correct)`);
    }
}

if (toFix.length === 0) {
    console.log('\n✅ All SKUs have correct processing counts. Nothing to fix.');
    await client.end();
    process.exit(0);
}

console.log(`\n${toFix.length} SKU(s) need correction.`);

if (DRY_RUN) {
    console.log('\n🔒 DRY RUN — no changes applied. Set DRY_RUN = false to apply.');
    await client.end();
    process.exit(0);
}

// ── Step 4: Insert corrective reconciliation transactions ─────────────────────
await client.query('BEGIN');
let fixed = 0;
try {
    for (const { sku, current, expected, row } of toFix) {
        const processingBefore = current;
        const processingAfter = expected;
        const pendingConsult = parseInt(row.pending_consult || '0', 10);
        const pendingReview = parseInt(row.pending_review || '0', 10);
        const inWarehouse = parseInt(row.in_warehouse || '0', 10);
        const stockBefore = parseInt(row.stock_after || '0', 10);
        const pendingBefore = parseInt(row.pending_after || '0', 10);

        // Recalculate backorder after correction
        const backorderAfter = Math.max(0, (pendingConsult + pendingReview + processingAfter) - inWarehouse);

        console.log(`\n🔧 Fixing ${sku}: processing ${processingBefore} → ${processingAfter}, backorder → ${backorderAfter}`);

        await client.query(`
      INSERT INTO his_db.stock_transactions (
        sku, single_sku_id, transaction_type, quantity_change,
        stock_before, stock_after,
        pending_before, pending_after,
        in_warehouse_before, in_warehouse_after,
        processing_before, processing_after,
        pending_consult_before, pending_consult_after,
        pending_review_before,  pending_review_after,
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
        'manual', 'reconcile.processing_correct',
        $12::jsonb, NOW()
      )
    `, [
            sku, row.single_sku_id || null,
            stockBefore,
            pendingBefore,
            inWarehouse,
            processingBefore, processingAfter,
            pendingConsult,
            pendingReview,
            parseInt(row.backorder_after || '0', 10), backorderAfter,
            JSON.stringify({
                reason: 'Reconcile processing to match genuinely active processing orders only',
                processing_before: processingBefore,
                processing_after: processingAfter,
                active_orders: correctMap[sku]?.active_orders ?? [],
            }),
        ]);

        console.log(`  ✅ Reconciliation tx inserted for ${sku}`);
        fixed++;
    }

    await client.query('COMMIT');
    console.log(`\n🎉 Done! Fixed ${fixed} SKU(s). Processing counts now match active orders only.`);
} catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error, rolled back:', e.message);
    process.exit(1);
} finally {
    await client.end();
}
