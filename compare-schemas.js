const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require',
  ssl: {
    rejectUnauthorized: false
  }
});

async function compareSchemas() {
  try {
    // Get tables from inventory_management schema
    const oldSchemaResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'inventory_management'
      ORDER BY table_name
    `);
    
    // Get tables from his_db schema
    const newSchemaResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'his_db'
      ORDER BY table_name
    `);
    
    const oldTables = oldSchemaResult.rows.map(r => r.table_name);
    const newTables = newSchemaResult.rows.map(r => r.table_name);
    
    console.log('Tables in inventory_management (old schema):');
    console.log('===========================================');
    oldTables.forEach(t => console.log(`  - ${t}`));
    
    console.log('\n\nTables in his_db (current schema):');
    console.log('===================================');
    newTables.forEach(t => console.log(`  - ${t}`));
    
    // Find missing tables (excluding stock take tables)
    const stockTakeTables = ['stock_takes', 'stock_take_items'];
    const missingTables = oldTables.filter(t => 
      !newTables.includes(t) && 
      !stockTakeTables.includes(t)
    );
    
    console.log('\n\nMissing tables in his_db (excluding stock take):');
    console.log('================================================');
    if (missingTables.length === 0) {
      console.log('  None - all required tables exist!');
    } else {
      missingTables.forEach(t => console.log(`  - ${t}`));
      
      // Get structure of missing tables
      console.log('\n\nStructure of missing tables:');
      console.log('============================');
      for (const table of missingTables) {
        const structureResult = await pool.query(`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'inventory_management'
          AND table_name = $1
          ORDER BY ordinal_position
        `, [table]);
        
        console.log(`\n${table}:`);
        structureResult.rows.forEach(col => {
          console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
        });
      }
    }
    
    // Check for pending_consultation_stock table
    const pendingTableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'his_db' 
      AND table_name = 'pending_consultation_stock'
    `);
    
    console.log('\n\npending_consultation_stock table exists in his_db:', pendingTableCheck.rows.length > 0);
    
  } catch (error) {
    console.error('Error comparing schemas:', error);
  } finally {
    await pool.end();
  }
}

compareSchemas();

