/**
 * Fix Stale Processing Entries
 *
 * Step 1: Find orders whose last stock transaction is 'processing' or 'pending_consult'
 *         but ALSO have an nv-pending-pickup webhook event logged.
 *         These are orders that moved on in WC but failed to update the stock DB correctly.
 *
 * Step 2: Insert a corrective `order_nv_pending_pickup` stock transaction for each,
 *         properly restoring processing -> 0 and releasing back to in_warehouse.
 *
 * DRY_RUN = true by default. Set to false to apply changes.
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const DRY_RUN = true; // Set to false to apply changes

try {
    console.log(`\n🔍 Step 1: Find stale orders (last tx = processing/pending) that have an nv-pending-pickup webhook...\n`);

    const res = await client.query(`
    WITH LatestTx AS (
      SELECT DISTINCT ON (source_id, sku)
        source_id::int AS order_id,
        sku,
        single_sku_id,
        transaction_type AS last_event,
        processing_after::numeric     AS processing,
        pending_consult_after::numeric AS pending_consult,
        pending_review_after::numeric  AS pending_review,
        pending_after::numeric         AS pending,
        in_warehouse_after::numeric    AS in_warehouse,
        backorder_after::numeric       AS backorder,
        stock_after::numeric           AS stock,
        created_at
      FROM his_db.stock_transactions
      WHERE source_type = 'order'
      ORDER BY source_id, sku, created_at DESC
    ),
    NvPickupOrders AS (
      SELECT DISTINCT entity_id::int AS order_id
      FROM his_db.wc_webhook_logs
      WHERE webhook_event = 'order.nv-pending-pickup'
        AND success = true
    )
    SELECT lt.*
    FROM LatestTx lt
    INNER JOIN NvPickupOrders nv ON lt.order_id = nv.order_id
    WHERE lt.last_event IN ('order_processing', 'order_pending_consult', 'order_pending_review')
      AND (lt.processing > 0 OR lt.pending_consult > 0 OR lt.pending_review > 0)
    ORDER BY lt.created_at ASC
  `);

    if (res.rows.length === 0) {
        console.log('✅ No stale orders found that need fixing.');
        await client.end();
        process.exit(0);
    }

    console.log(`⚠️  Found ${res.rows.length} stale order-SKU entry(ies) to fix:\n`);
    console.table(res.rows.map(r => ({
        order_id: r.order_id,
        sku: r.sku,
        last_event: r.last_event,
        processing: r.processing,
        pending_consult: r.pending_consult,
        pending_review: r.pending_review,
        last_activity: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })
    })));

    if (DRY_RUN) {
        console.log('\n🔒 DRY RUN — No changes applied. Set DRY_RUN = false to apply fixes.');
        await client.end();
        process.exit(0);
    }

    await client.query('BEGIN');

    for (const order of res.rows) {
        console.log(`\n🔧 Fixing Order #${order.order_id} (SKU: ${order.sku})`);

        // Get the absolute latest transaction for this SKU (global state)
        const lastGlobalTx = await client.query(`
      SELECT * FROM his_db.stock_transactions
      WHERE sku = $1
      ORDER BY id DESC LIMIT 1
    `, [order.sku]);

        if (lastGlobalTx.rows.length === 0) {
            console.log(`  ❌ No global tx found for ${order.sku}, skipping.`);
            continue;
        }

        const g = lastGlobalTx.rows[0];

        const processingBefore = parseFloat(g.processing_after);
        const pendingConsultBefore = parseFloat(g.pending_consult_after);
        const pendingReviewBefore = parseFloat(g.pending_review_after);
        const pendingBefore = parseFloat(g.pending_after);
        const inWarehouseBefore = parseFloat(g.in_warehouse_after);
        const backorderBefore = parseFloat(g.backorder_after);
        const stockBefore = parseFloat(g.stock_after);

        // Deductions = what this order contributed (capped at current global total)
        const dedProcessing = Math.min(processingBefore, parseFloat(order.processing));
        const dedConsult = Math.min(pendingConsultBefore, parseFloat(order.pending_consult));
        const dedReview = Math.min(pendingReviewBefore, parseFloat(order.pending_review));
        const totalDed = dedProcessing + dedConsult + dedReview;

        if (totalDed === 0) {
            console.log(`  ⚠️  Nothing to deduct for ${order.sku} (already 0 globally), skipping.`);
            continue;
        }

        const processingAfter = processingBefore - dedProcessing;
        const pendingConsultAfter = pendingConsultBefore - dedConsult;
        const pendingReviewAfter = pendingReviewBefore - dedReview;
        const pendingAfter = pendingBefore - (dedConsult + dedReview);
        const inWarehouseAfter = inWarehouseBefore; // nv-pickup: items physically left warehouse
        const stockAfter = stockBefore;        // stock (in_warehouse) doesn't change at pickup stage
        const backorderAfter = Math.max(0, (processingAfter + pendingConsultAfter + pendingReviewAfter) - inWarehouseAfter);

        console.log(`  Processing:    ${processingBefore} → ${processingAfter} (-${dedProcessing})`);
        console.log(`  PendingConsult:${pendingConsultBefore} → ${pendingConsultAfter} (-${dedConsult})`);
        console.log(`  PendingReview: ${pendingReviewBefore} → ${pendingReviewAfter} (-${dedReview})`);
        console.log(`  InWarehouse:   ${inWarehouseBefore} → ${inWarehouseAfter} (no change)`);

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
        $1, $2, 'order_nv_pending_pickup', 0,
        $3, $4,
        $5, $6,
        $7, $8,
        $9, $10,
        $11, $12,
        $13, $14,
        $15, $16,
        'order', $17, 'fix.stale_nv_pickup',
        $18::jsonb, NOW()
      )
    `, [
            order.sku, g.single_sku_id,
            stockBefore, stockAfter,
            pendingBefore, pendingAfter,
            inWarehouseBefore, inWarehouseAfter,
            processingBefore, processingAfter,
            pendingConsultBefore, pendingConsultAfter,
            pendingReviewBefore, pendingReviewAfter,
            backorderBefore, backorderAfter,
            order.order_id,
            JSON.stringify({
                reason: 'Retroactive nv-pending-pickup: webhook event existed but stock tx was missing',
                order_id: order.order_id,
                deductions: { processing: dedProcessing, pending_consult: dedConsult, pending_review: dedReview }
            })
        ]);

        console.log(`  ✅ Correction transaction inserted.`);
    }

    await client.query('COMMIT');
    console.log('\n🎉 All stale orders fixed successfully.');

} catch (e) {
    await client.query('ROLLBACK').catch(() => { });
    console.error('❌ Error:', e);
} finally {
    await client.end();
}
