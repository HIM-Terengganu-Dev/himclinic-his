import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'pri/6tab';

const result = await client.query(`
  SELECT id, transaction_type, source_id, source_type, quantity_change, 
         processing_before, processing_after,
         in_warehouse_after, details
  FROM his_db.stock_transactions
  WHERE sku = $1
  ORDER BY id ASC
`, [SKU]);

console.log(`\n=== All Transactions for ${SKU} ===`);
result.rows.forEach(r => {
    console.log(`[${r.id}] ${r.transaction_type} (src=${r.source_id}) | processing: ${r.processing_before} → ${r.processing_after} | change=${r.quantity_change}`);
});

await client.end();
