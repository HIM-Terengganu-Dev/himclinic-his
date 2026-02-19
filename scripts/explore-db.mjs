import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";

const client = new Client({ connectionString: DDL });
await client.connect();

// 1. List all schemas
const schemas = await client.query(`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`);
console.log('\n=== SCHEMAS ===');
schemas.rows.forEach(r => console.log(' -', r.schema_name));

// 2. List all tables in his_db schema
const tables = await client.query(`
  SELECT table_name, table_type
  FROM information_schema.tables
  WHERE table_schema = 'his_db'
  ORDER BY table_name
`);
console.log('\n=== TABLES in his_db ===');
tables.rows.forEach(r => console.log(` - ${r.table_name} (${r.table_type})`));

// 3. For each table, list columns with types
for (const row of tables.rows) {
  const cols = await client.query(`
    SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'his_db' AND table_name = $1
    ORDER BY ordinal_position
  `, [row.table_name]);

  console.log(`\n--- ${row.table_name} ---`);
  cols.rows.forEach(c => {
    const len = c.character_maximum_length ? `(${c.character_maximum_length})` : '';
    const nullable = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    console.log(`  ${c.column_name}: ${c.data_type}${len} ${nullable}${def}`);
  });
}

// 4. List foreign key relationships
const fks = await client.query(`
  SELECT
    tc.table_name AS from_table,
    kcu.column_name AS from_col,
    ccu.table_name AS to_table,
    ccu.column_name AS to_col,
    tc.constraint_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'his_db'
  ORDER BY tc.table_name
`);
console.log('\n=== FOREIGN KEYS in his_db ===');
fks.rows.forEach(r => console.log(`  ${r.from_table}.${r.from_col} → ${r.to_table}.${r.to_col}`));

await client.end();
