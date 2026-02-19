/**
 * Check tra/10tab transactions — look for:
 * 1. Full tx history with running totals
 * 2. Any order_processing tx that came AFTER an nv-pending-pickup for the same order
 * 3. Orders currently holding stock in processing/pending
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'tra/10tab';

// ── 1. Full transaction history ──────────────────────────────────────────────
console.log(`\n====== ALL STOCK TRANSACTIONS for ${SKU} ======\n`);
const allTx = await client.query(`
  SELECT id, transaction_type, quantity_change,
         in_warehouse_after::numeric  AS wh,
         processing_after::numeric    AS proc,
         pending_consult_after::numeric AS pc,
         pending_review_after::numeric  AS pr,
         backorder_after::numeric       AS bo,
         source_id, source_event, created_at
  FROM his_db.stock_transactions
  WHERE sku = $1
  ORDER BY id ASC
`, [SKU]);

console.table(allTx.rows.map(r => ({
    id: r.id,
    type: r.transaction_type,
    Δ: +r.quantity_change,
    wh: +r.wh,
    proc: +r.proc,
    pc: +r.pc,
    pr: +r.pr,
    bo: +r.bo,
    order: r.source_id,
    event: r.source_event,
    at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
})));

// ── 2. Orders currently holding tra/10tab stock in processing/pending ────────
console.log(`\n====== ORDERS CURRENTLY HOLDING ${SKU} STOCK ======\n`);
const holding = await client.query(`
  WITH LatestPerOrder AS (
    SELECT DISTINCT ON (source_id)
      source_id AS order_id,
      transaction_type AS last_event,
      processing_after::numeric      AS processing,
      pending_consult_after::numeric AS pending_consult,
      pending_review_after::numeric  AS pending_review,
      created_at
    FROM his_db.stock_transactions
    WHERE sku = $1 AND source_type = 'order'
    ORDER BY source_id, id DESC
  )
  SELECT * FROM LatestPerOrder
  WHERE last_event IN ('order_processing','order_pending_consult','order_pending_review')
    AND (processing > 0 OR pending_consult > 0 OR pending_review > 0)
  ORDER BY created_at ASC
`, [SKU]);

console.table(holding.rows.map(r => ({
    order_id: r.order_id,
    last_event: r.last_event,
    processing: +r.processing,
    pending_consult: +r.pending_consult,
    pending_review: +r.pending_review,
    at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
})));

// ── 3. Cross-check: do any of those holding orders have nv-pending-pickup? ──
const orderIds = holding.rows.map(r => r.order_id);
if (orderIds.length > 0) {
    console.log(`\n====== CHECKING IF ANY HOLDING ORDERS ALREADY HAVE nv-pending-pickup WEBHOOK ======\n`);
    const crossed = await client.query(`
    SELECT entity_id::int AS order_id, webhook_event, success, created_at
    FROM his_db.wc_webhook_logs
    WHERE entity_id::int = ANY($1::int[])
      AND webhook_event = 'order.nv-pending-pickup'
      AND success = true
    ORDER BY entity_id, created_at
  `, [orderIds.map(String)]);

    if (crossed.rows.length === 0) {
        console.log('✅ None of the holding orders have an nv-pending-pickup event — all look legitimate.');
    } else {
        console.log(`⚠️  ${crossed.rows.length} order(s) holding stock BUT already dispatched (nv-pending-pickup exists):`);
        console.table(crossed.rows.map(r => ({
            order_id: r.order_id,
            event: r.webhook_event,
            at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
        })));
    }
}

await client.end();
