import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const res = await client.query(`
  SELECT DISTINCT ON (sku)
    sku,
    in_warehouse_after::numeric   AS in_warehouse,
    processing_after::numeric     AS processing,
    pending_consult_after::numeric AS pending_consult,
    pending_review_after::numeric  AS pending_review,
    backorder_after::numeric       AS backorder,
    (in_warehouse_after::numeric
      - processing_after::numeric
      - pending_consult_after::numeric
      - pending_review_after::numeric)  AS available,
    created_at AS last_tx_at
  FROM his_db.stock_transactions
  ORDER BY sku, id DESC
`);

// Sort by SKU name
const rows = res.rows.sort((a, b) => a.sku.localeCompare(b.sku));

console.log(`\n📊 Current Stock State by SKU (as of ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })})\n`);
console.table(rows.map(r => ({
    sku: r.sku,
    in_warehouse: +r.in_warehouse,
    processing: +r.processing,
    pending_consult: +r.pending_consult,
    pending_review: +r.pending_review,
    backorder: +r.backorder,
    available: +r.available,
    last_tx: new Date(r.last_tx_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })
})));

await client.end();
