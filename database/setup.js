/**
 * Database Setup Script
 * 
 * This script connects to the Neon PostgreSQL database and runs the schema
 * and seed SQL files to set up the inventory management database.
 * 
 * Usage: node database/setup.js
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Database connection string
const connectionString = process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require';

async function runSetup() {
    const client = new Client({
        connectionString,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('🔌 Connecting to database...');
        await client.connect();
        console.log('✅ Connected successfully!\n');

        // Test connection
        const result = await client.query('SELECT NOW() as current_time, version()');
        console.log('📅 Current database time:', result.rows[0].current_time);
        console.log('🗄️  PostgreSQL version:', result.rows[0].version.split(',')[0]);
        console.log();

        // Read schema file
        console.log('📄 Reading schema.sql...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

        // Execute schema
        console.log('🔨 Creating schema and tables...');
        await client.query(schemaSQL);
        console.log('✅ Schema created successfully!\n');

        // Verify tables
        console.log('🔍 Verifying tables created...');
        const tables = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'inventory_management' 
      ORDER BY tablename;
    `);

        console.log(`✅ Found ${tables.rows.length} tables:`);
        tables.rows.forEach(row => {
            console.log(`   - ${row.schemaname}.${row.tablename}`);
        });
        console.log();

        // Read seed file
        console.log('📄 Reading seed.sql...');
        const seedPath = path.join(__dirname, 'seed.sql');
        const seedSQL = fs.readFileSync(seedPath, 'utf8');

        // Execute seed
        console.log('🌱 Seeding initial data...');
        await client.query(seedSQL);
        console.log('✅ Data seeded successfully!\n');

        // Verify data
        console.log('🔍 Verifying seeded data...');
        const counts = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM inventory_management.single_skus) as single_skus,
        (SELECT COUNT(*) FROM inventory_management.combo_skus) as combo_skus;
    `);

        const { single_skus, combo_skus } = counts.rows[0];
        console.log(`✅ Single SKUs: ${single_skus}`);
        console.log(`✅ Combo SKUs: ${combo_skus}`);
        console.log();

        // Show sample data
        console.log('📋 Sample Single SKUs:');
        const sampleSingle = await client.query(`
      SELECT sku, name FROM inventory_management.single_skus 
      ORDER BY sku LIMIT 5;
    `);
        sampleSingle.rows.forEach(row => {
            console.log(`   - ${row.sku}: ${row.name}`);
        });
        console.log();

        console.log('📋 Sample Combo SKUs:');
        const sampleCombo = await client.query(`
      SELECT sku, name FROM inventory_management.combo_skus 
      ORDER BY sku LIMIT 5;
    `);
        sampleCombo.rows.forEach(row => {
            console.log(`   - ${row.sku}: ${row.name}`);
        });
        console.log();

        console.log('🎉 Database setup complete!');
        console.log();
        console.log('📝 Next steps:');
        console.log('   1. Set up Google OAuth credentials');
        console.log('   2. Update .env with OAuth credentials');
        console.log('   3. Install dependencies: npm install');
        console.log('   4. Run the app: npm run dev');
        console.log('   5. After first login, promote user to admin:');
        console.log('      UPDATE inventory_management.users SET role = \'admin\' WHERE email = \'your-email@gmail.com\';');

    } catch (error) {
        console.error('❌ Error during setup:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await client.end();
        console.log('\n👋 Disconnected from database');
    }
}

// Run the setup
runSetup();
