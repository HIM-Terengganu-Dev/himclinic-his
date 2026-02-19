/**
 * Add Missing nv-pending-pickup Transaction for Order 12388
 * 
 * Objectives:
 * 1. Verify current state (processing=1, in_warehouse=11)
 * 2. Insert 'order_nv_pending_pickup' transaction
 *    - processing: 1 -> 0
 *    - in_warehouse: 11 -> 10
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'pri/6tab';
const ORDER_ID = 12388;

try {
    await client.query('BEGIN');

    // 1. Get latest state
    const lastTxResult = await client.query(`
    SELECT * FROM his_db.stock_transactions
    WHERE sku = $1
    ORDER BY id DESC LIMIT 1
  `, [SKU]);

    const lastTx = lastTxResult.rows[0];
    console.log('Current Latest State:', {
        id: lastTx.id,
        in_warehouse: lastTx.in_warehouse_after,
        processing: lastTx.processing_after
    });

    if (lastTx.processing_after !== 1) {
        throw new Error(`Expected processing=1, but got ${lastTx.processing_after}. Aborting.`);
    }

    // 2. Insert new transaction
    const inWarehouseBefore = lastTx.in_warehouse_after;
    const inWarehouseAfter = inWarehouseBefore - 1;

    const processingBefore = lastTx.processing_after;
    const processingAfter = processingBefore - 1; // 1 -> 0

    // Use last values for others
    const pendingConsultBefore = lastTx.pending_consult_after;
    const pendingConsultAfter = pendingConsultBefore;

    const pendingReviewBefore = lastTx.pending_review_after;
    const pendingReviewAfter = pendingReviewBefore;

    const pendingBefore = pendingConsultBefore + pendingReviewBefore;
    const pendingAfter = pendingBefore;

    // Recalculate backorder
    const backorderBefore = lastTx.backorder_after;
    const backorderAfter = Math.max(0,
        (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter
    );

    console.log('New Transaction State:', {
        in_warehouse: `${inWarehouseBefore} -> ${inWarehouseAfter}`,
        processing: `${processingBefore} -> ${processingAfter}`,
        backorder: `${backorderBefore} -> ${backorderAfter}`
    });

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
        $1, $2, 'order_nv_pending_pickup', -1,
        $3, $4,
        $5, $6,
        $7, $8,
        $9, $10,
        $11, $12,
        $13, $14,
        $15, $16,
        'order', $17, 'order.nv-pending-pickup',
        $18::jsonb, NOW()
    ) RETURNING id
  `, [
        SKU, lastTx.single_sku_id,
        inWarehouseBefore, inWarehouseAfter, // stock legacy
        pendingBefore, pendingAfter,
        inWarehouseBefore, inWarehouseAfter,
        processingBefore, processingAfter,
        pendingConsultBefore, pendingConsultAfter,
        pendingReviewBefore, pendingReviewAfter,
        backorderBefore, backorderAfter,
        ORDER_ID,
        JSON.stringify({
            manual_insertion: true,
            reason: "Adding missing webhook transaction for nv-pending-pickup",
            restored_from_missing_log: true
        })
    ]);

    console.log(`✅ Transaction created: ID ${insertTx.rows[0].id}`);

    await client.query('COMMIT');

} catch (e) {
    console.error('❌ Error:', e);
    await client.query('ROLLBACK');
} finally {
    await client.end();
}
