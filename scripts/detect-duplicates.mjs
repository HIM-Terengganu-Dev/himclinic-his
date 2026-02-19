/**
 * Detect orders where the same event type was written multiple times
 * for the same (order_id, sku) combination — these are duplicate/ghost entries.
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const res = await client.query(`
  SELECT
    source_id AS order_id,
    sku,
    transaction_type,
    COUNT(*) AS count,
    MIN(created_at) AS first_at,
    MAX(created_at) AS last_at,
    ARRAY_AGG(id ORDER BY created_at) AS tx_ids
  FROM his_db.stock_transactions
  WHERE source_type = 'order'
    AND transaction_type IN (
      'order_processing',
      'order_pending_consult',
      'order_pending_review'
    )
  GROUP BY source_id, sku, transaction_type
  HAVING COUNT(*) > 1
  ORDER BY count DESC, source_id, sku
`);

if (res.rows.length === 0) {
    console.log('\n✅ No duplicate processing/pending transactions found — all clean.');
} else {
    console.log(`\n⚠️  Found ${res.rows.length} (order, sku, type) combination(s) with MULTIPLE transactions:\n`);
    console.table(res.rows.map(r => ({
        order_id: r.order_id,
        sku: r.sku,
        type: r.transaction_type,
        count: +r.count,
        first_at: new Date(r.first_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
        last_at: new Date(r.last_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
        tx_ids: r.tx_ids.join(', ')
    })));
}

await client.end();
