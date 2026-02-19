/**
 * Debug Order History
 * usage: node scripts/debug-order-history.mjs [ORDER_ID]
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const ORDER_ID = process.argv[2] || 9386;

console.log(`\n=== Transactions for Order ${ORDER_ID} ===`);

const result = await client.query(`
  SELECT id, sku, transaction_type, quantity_change, 
         processing_before, processing_after,
         in_warehouse_after, details, created_at
  FROM his_db.stock_transactions
  WHERE source_id = $1
  ORDER BY id ASC
`, [ORDER_ID]);

result.rows.forEach(r => {
    console.log(`[${r.id}] ${r.created_at.toISOString()} | SKU: ${r.sku} | ${r.transaction_type} | Processing: ${r.processing_before} -> ${r.processing_after}`);
});

await client.end();
