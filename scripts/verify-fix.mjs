import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'pri/6tab';

// Verify the last transaction and current state
const result = await client.query(`
  SELECT * FROM his_db.stock_transactions
  WHERE sku = $1
  ORDER BY id DESC
  LIMIT 5
`, [SKU]);

console.log(`\n=== LAST 5 TRANSACTIONS FOR ${SKU} ===`);
result.rows.forEach(r => {
    console.log(`[${r.id}] type=${r.transaction_type} | processing: ${r.processing_before} → ${r.processing_after} | in_warehouse: ${r.in_warehouse_after}`);
});

// Check activity_logs columns just to be sure
const cols = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'his_db' AND table_name = 'activity_logs'
`);
console.log('\n=== COLUMNS IN activity_logs ===');
cols.rows.forEach(c => console.log(' -', c.column_name));

await client.end();
