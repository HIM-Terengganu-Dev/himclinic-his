import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

// Find the CHECK constraint on transaction_type
const result = await client.query(`
  SELECT pg_get_constraintdef(c.oid) AS constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'his_db'
    AND t.relname = 'stock_transactions'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%transaction_type%'
`);

console.log('CHECK constraint on transaction_type:');
result.rows.forEach(r => console.log(r.constraint_def));

// Also show all distinct types currently used
const types = await client.query(`
  SELECT DISTINCT transaction_type FROM his_db.stock_transactions ORDER BY transaction_type
`);
console.log('\nDistinct transaction_type values in use:');
types.rows.forEach(r => console.log(' -', r.transaction_type));

await client.end();
