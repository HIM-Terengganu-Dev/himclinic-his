/**
 * Cleanup Stale Orders (Phase 2A)
 * 
 * Objectives:
 * 1. Identify orders active before Feb 10, 2026 that are "stuck" (Processing/Pending > 0, no Exit).
 * 2. Create a correction transaction for each order to zero out its contribution.
 *    - Processing: -N
 *    - Pending: -M
 *    - In Warehouse: No Change (items never left).
 *    - Available: Increases by (N+M).
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const CUTOFF_DATE = '2026-02-10T00:00:00.000Z';

try {
  await client.query('BEGIN');
  console.log(`🧹 Cleaning up stale orders before ${CUTOFF_DATE}...`);

  // 1. Find Stale Orders
  const staleOrders = await client.query(`
    WITH OrderStats AS (
      SELECT 
        source_id, 
        sku,
        MAX(created_at) as last_activity,
        COUNT(CASE WHEN transaction_type IN ('order_processing') THEN 1 END) as processing_events,
        COUNT(CASE WHEN transaction_type IN ('order_pending_consult') THEN 1 END) as pending_consult_events,
        COUNT(CASE WHEN transaction_type IN ('order_pending_review') THEN 1 END) as pending_review_events,
        COUNT(CASE WHEN transaction_type IN ('order_nv_pending_pickup', 'order_cancelled', 'order_completed') THEN 1 END) as exit_events
      FROM his_db.stock_transactions
      WHERE source_type = 'order'
      GROUP BY source_id, sku
    )
    SELECT * 
    FROM OrderStats
    WHERE last_activity < $1
      AND (processing_events > 0 OR pending_consult_events > 0 OR pending_review_events > 0)
      AND exit_events = 0
    ORDER BY last_activity ASC
  `, [CUTOFF_DATE]);

  if (staleOrders.rows.length === 0) {
    console.log('✅ No stale orders found to clean up.');
    await client.query('ROLLBACK');
    process.exit(0);
  }

  console.log(`Found ${staleOrders.rows.length} orders to clean up.`);

  // 2. Process each order
  for (const order of staleOrders.rows) {
    console.log(`\nProcessing Order #${order.source_id} (SKU: ${order.sku})`);

    // Calculate needed deduction (Net Contribution)
    // Since exit_events = 0, contribution is just the sum of entry events.
    // We need to SUBTRACT this amount.
    const flProcessing = parseFloat(order.processing_events);
    const flPendingConsult = parseFloat(order.pending_consult_events);
    const flPendingReview = parseFloat(order.pending_review_events);

    console.log(`Current Contribution: Processing=${flProcessing}, Consult=${flPendingConsult}, Review=${flPendingReview}`);

    // Fetch latest state for this SKU to calculate 'before' and 'after'
    const lastTxRes = await client.query(`
          SELECT * FROM his_db.stock_transactions 
          WHERE sku = $1 
          ORDER BY id DESC LIMIT 1
      `, [order.sku]);

    if (lastTxRes.rows.length === 0) {
      console.error(`❌ No transactions found for SKU ${order.sku}! Skipping.`);
      continue;
    }
    const lastTx = lastTxRes.rows[0];

    // Prepare new state
    // We are revoking the hold, so we SUBTRACT the contribution from the current global state.
    // SAFETY: Cap deduction so we don't go below zero.
    const processingBefore = parseFloat(lastTx.processing_after);
    const pendingConsultBefore = parseFloat(lastTx.pending_consult_after);
    const pendingReviewBefore = parseFloat(lastTx.pending_review_after);

    // Calculate actual applied deductions (capped at current availability)
    const dedProcessing = Math.min(processingBefore, flProcessing);
    const dedConsult = Math.min(pendingConsultBefore, flPendingConsult);
    const dedReview = Math.min(pendingReviewBefore, flPendingReview);

    if (dedProcessing === 0 && dedConsult === 0 && dedReview === 0) {
      console.log(`⚠️ SKU ${order.sku} already has 0 counts for these states. Skipping correction.`);
      continue;
    }

    const processingAfter = processingBefore - dedProcessing;
    const pendingConsultAfter = pendingConsultBefore - dedConsult;
    const pendingReviewAfter = pendingReviewBefore - dedReview;

    const pendingBefore = parseFloat(lastTx.pending_after);
    const pendingAfter = pendingBefore - (dedConsult + dedReview);

    // In Warehouse SHOULD change (items returned to stock)
    const inWarehouseBefore = parseFloat(lastTx.in_warehouse_after);
    const inWarehouseAfter = inWarehouseBefore + (dedProcessing + dedConsult + dedReview);

    // Backorder calculation
    const backorderBefore = parseFloat(lastTx.backorder_after);
    const backorderAfter = Math.max(0, (pendingConsultAfter + pendingReviewAfter + processingAfter) - inWarehouseAfter);

    console.log(`State Update:
         Processing: ${processingBefore} -> ${processingAfter} (-${dedProcessing})
         Pending Consult: ${pendingConsultBefore} -> ${pendingConsultAfter} (-${dedConsult})
         Pending Review: ${pendingReviewBefore} -> ${pendingReviewAfter} (-${dedReview})
         In Warehouse: ${inWarehouseBefore} -> ${inWarehouseAfter} (No Change)
      `);

    // Insert Correction Transaction
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
            $1, $2, 'reconciliation', 0,
            $3, $4, -- stock (in_warehouse)
            $5, $6, -- pending
            $7, $8, -- in_warehouse
            $9, $10, -- processing
            $11, $12, -- pending_consult
            $13, $14, -- pending_review
            $15, $16, -- backorder
            'order', $17, 'cleanup.stale_revocation',
            $18::jsonb, NOW()
        )
      `, [
      order.sku, lastTx.single_sku_id,
      inWarehouseBefore, inWarehouseAfter, // stock matches in_warehouse usually
      pendingBefore, pendingAfter,
      inWarehouseBefore, inWarehouseAfter,
      processingBefore, processingAfter,
      pendingConsultBefore, pendingConsultAfter,
      pendingReviewBefore, pendingReviewAfter,
      backorderBefore, backorderAfter,
      order.source_id, // Link to the stale order
      JSON.stringify({
        reason: "Revoking stale order contribution (Pre-Feb 10)",
        original_contribution: {
          processing: flProcessing,
          pending_consult: flPendingConsult,
          pending_review: flPendingReview
        }
      })
    ]);
    console.log('✅ Correction inserted.');
  }

  await client.query('COMMIT');
  console.log('🎉 All stale orders processed successfully.');

} catch (e) {
  console.error('❌ Error:', e);
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
