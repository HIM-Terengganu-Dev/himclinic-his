const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
});

async function createTables() {
  try {
    const sql = fs.readFileSync('create-missing-tables.sql', 'utf8');
    
    console.log('Creating missing tables in his_db schema...');
    await pool.query(sql);
    
    console.log('✅ Tables created successfully!');
    
    // Verify tables were created
    const verifyResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'his_db' 
      AND table_name IN ('pending_consultation_stock', 'stock_movements')
      ORDER BY table_name
    `);
    
    console.log('\n✅ Verified tables in his_db:');
    verifyResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('Error creating tables:', error);
  } finally {
    await pool.end();
  }
}

createTables();

