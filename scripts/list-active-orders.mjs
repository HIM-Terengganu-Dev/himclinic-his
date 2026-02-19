import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

// Get the latest stock transaction per (order, sku)
// Only include orders whose LAST event is an active entry event (not an exit event)
const res = await client.query(`
  WITH LatestTx AS (
    SELECT DISTINCT ON (source_id, sku)
      source_id::int AS order_id,
      sku,
      transaction_type AS last_event,
      processing_after::numeric AS processing,
      pending_consult_after::numeric AS pending_consult,
      pending_review_after::numeric AS pending_review,
      created_at
    FROM his_db.stock_transactions
    WHERE source_type = 'order'
    ORDER BY source_id, sku, created_at DESC
  )
  SELECT *
  FROM LatestTx
  WHERE last_event IN ('order_processing', 'order_pending_consult', 'order_pending_review')
    AND (processing > 0 OR pending_consult > 0 OR pending_review > 0)
  ORDER BY created_at ASC
`);

console.log(`\nFound ${res.rows.length} order-SKU combinations currently holding stock:\n`);
console.table(res.rows.map(r => ({
    order_id: r.order_id,
    sku: r.sku,
    last_event: r.last_event,
    processing: r.processing,
    pending_consult: r.pending_consult,
    pending_review: r.pending_review,
    last_activity: new Date(r.created_at).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
})));

await client.end();
