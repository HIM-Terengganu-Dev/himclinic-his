/**
 * One-time DB correction script for order 12388.
 * 
 * Problem: Order #12388 (pri/6tab) received 4 duplicate order.processing webhooks,
 * inflating the processing counter from 1 → 5 in stock_transactions.
 * 
 * Fix: Insert a corrective stock_transaction of type 'manual_correction' that
 * reduces processing by 4 (5 → 1) and adjusts backorder accordingly.
 * Also logs the correction to activity_logs.
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'pri/6tab';
const ORDER_ID = 12388;
const EXCESS_PROCESSING = 4; // duplicates: processing went 1→2, 2→3, 3→4, 4→5

// ── Step 1: Read current state ────────────────────────────────────────────────
const stateResult = await client.query(`
  SELECT
    COALESCE((
      SELECT t.stock_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS stock_after,
    COALESCE((
      SELECT t.in_warehouse_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS in_warehouse,
    COALESCE((
      SELECT t.processing_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS processing,
    COALESCE((
      SELECT t.pending_consult_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS pending_consult,
    COALESCE((
      SELECT t.pending_review_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS pending_review,
    COALESCE((
      SELECT t.backorder_after FROM his_db.stock_transactions t
      WHERE t.sku = $1 ORDER BY t.id DESC LIMIT 1
    ), 0) AS backorder,
    COALESCE((
      SELECT s.id FROM his_db.single_skus s WHERE s.sku = $1 LIMIT 1
    ), NULL) AS single_sku_id
`, [SKU]);

const state = stateResult.rows[0];
console.log('\n=== CURRENT STATE (before correction) ===');
console.log(`sku:            ${SKU}`);
console.log(`in_warehouse:   ${state.in_warehouse}`);
console.log(`processing:     ${state.processing}`);
console.log(`pending_consult:${state.pending_consult}`);
console.log(`pending_review: ${state.pending_review}`);
console.log(`backorder:      ${state.backorder}`);
console.log(`single_sku_id:  ${state.single_sku_id}`);

// Safety check: processing must be at least EXCESS_PROCESSING + 1
if (parseInt(state.processing) < EXCESS_PROCESSING + 1) {
    console.error(`\n❌ ABORT: processing (${state.processing}) is less than expected minimum of ${EXCESS_PROCESSING + 1}. Manual review required.`);
    await client.end();
    process.exit(1);
}

// ── Step 2: Calculate corrected values ───────────────────────────────────────
const processingBefore = parseInt(state.processing);
const processingAfter = processingBefore - EXCESS_PROCESSING; // 5 → 1

const inWarehouseBefore = parseInt(state.in_warehouse);
const inWarehouseAfter = inWarehouseBefore; // no change

const pendingConsultBefore = parseInt(state.pending_consult);
const pendingConsultAfter = pendingConsultBefore; // no change

const pendingReviewBefore = parseInt(state.pending_review);
const pendingReviewAfter = pendingReviewBefore; // no change

// Backorder = max(0, (pendingConsult + pendingReview + processing) - inWarehouse)
const backorderBefore = parseInt(state.backorder);
const backorderAfter = Math.max(
    0,
    (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter
);

const pendingBefore = pendingConsultBefore + pendingReviewBefore;
const pendingAfter = pendingConsultAfter + pendingReviewAfter;

console.log('\n=== CORRECTION TO APPLY ===');
console.log(`processing:  ${processingBefore} → ${processingAfter}  (reduce by ${EXCESS_PROCESSING})`);
console.log(`backorder:   ${backorderBefore} → ${backorderAfter}`);
console.log(`in_warehouse: ${inWarehouseBefore} (no change)`);

// ── Step 3: Insert corrective stock_transaction ───────────────────────────────
const insertTx = await client.query(`
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
    $1, $2, 'reconciliation', 0,
    $3, $4,
    $5, $6,
    $7, $8,
    $9, $10,
    $11, $12,
    $13, $14,
    $15, $16,
    'manual', $17, 'db_correction_order_12388_duplicate_processing',
    $18::jsonb, NOW()
  ) RETURNING id
`, [
    SKU,
    state.single_sku_id,
    inWarehouseBefore, inWarehouseAfter,           // stock_before/after (legacy = in_warehouse)
    pendingBefore, pendingAfter,                    // pending_before/after (legacy)
    inWarehouseBefore, inWarehouseAfter,            // in_warehouse_before/after
    processingBefore, processingAfter,              // processing_before/after
    pendingConsultBefore, pendingConsultAfter,      // pending_consult_before/after
    pendingReviewBefore, pendingReviewAfter,        // pending_review_before/after
    backorderBefore, backorderAfter,               // backorder_before/after
    ORDER_ID,                                       // source_id
    JSON.stringify({
        reason: 'Corrective transaction: 4 duplicate order.processing webhooks fired on 2026-02-18 inflated processing count from 1 to 5 for order #12388. This restores it to 1.',
        excessCount: EXCESS_PROCESSING,
        affectedOrderId: ORDER_ID,
        correctedBy: 'manual_db_correction_script',
        correctedAt: new Date().toISOString()
    })
]);

const newTxId = insertTx.rows[0].id;
console.log(`\n✅ Corrective stock_transaction created (id=${newTxId})`);

// ── Step 4: Log to activity_logs ─────────────────────────────────────────────
await client.query(`
  INSERT INTO his_db.activity_logs (
    action, entity_type, entity_id, entity_sku, entity_name,
    details, success, created_at
  ) VALUES (
    'manual_stock_correction',
    'stock_transaction',
    $1,
    $2,
    $3,
    $4::jsonb,
    true,
    NOW()
  )
`, [
    newTxId,
    SKU,
    `DB Correction: Order #${ORDER_ID} duplicate processing`,
    JSON.stringify({
        reason: `Corrective transaction for order #${ORDER_ID} duplicate processing webhooks`,
        sku: SKU,
        processingBefore,
        processingAfter,
        backorderBefore,
        backorderAfter,
        correctedBy: 'manual_db_correction_script'
    })
]);

console.log('✅ Correction logged to activity_logs');

// ── Step 5: Verify final state ───────────────────────────────────────────────
const verifyResult = await client.query(`
  SELECT
    in_warehouse_after AS in_warehouse,
    processing_after   AS processing,
    pending_consult_after AS pending_consult,
    pending_review_after  AS pending_review,
    backorder_after    AS backorder
  FROM his_db.stock_transactions
  WHERE sku = $1
  ORDER BY id DESC LIMIT 1
`, [SKU]);

const v = verifyResult.rows[0];
console.log('\n=== FINAL STATE (after correction) ===');
console.log(`in_warehouse:   ${v.in_warehouse}`);
console.log(`processing:     ${v.processing}    ← should be 1`);
console.log(`pending_consult:${v.pending_consult}`);
console.log(`pending_review: ${v.pending_review}`);
console.log(`backorder:      ${v.backorder}`);

if (parseInt(v.processing) === 1) {
    console.log('\n🎉 SUCCESS: processing count correctly restored to 1.');
} else {
    console.error(`\n⚠️  WARNING: processing count is ${v.processing}, expected 1. Please review manually.`);
}

await client.end();
