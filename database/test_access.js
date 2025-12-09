/**
 * Verify Access Script
 * 
 * Verifies that 'himbi_readwrite' can access the schema and tables.
 */

const { Client } = require('pg');

// User connection string (password decoded automatically by pg usually, but let's use the raw string provided by user)
// NOTE: pg client handles URI decoding of password if passed as connectionString
const connectionString = 'postgresql://himbi_readwrite:%261hoeGqE%21rbizI%26w@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require';

async function testAccess() {
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🔌 Connecting as himbi_readwrite...');
        await client.connect();
        console.log('✅ Connected!');

        console.log('🔍 Testing SELECT permission on SINGLE_SKUS...');
        const res = await client.query('SELECT COUNT(*) FROM inventory_management.single_skus');
        console.log(`✅ Success! Count: ${res.rows[0].count}`);

        console.log('🔍 Testing INSERT permission on ACTIVITY_LOGS...');
        await client.query(`
      INSERT INTO inventory_management.activity_logs (action, details, success) 
      VALUES ('access_test', '{"test": true}', true)
    `);
        console.log('✅ Success! Inserted test log.');

        console.log('\n🎉 ALL TESTS PASSED. User has correct permissions.');

    } catch (err) {
        console.error('❌ Access Test Failed:', err.message);
    } finally {
        await client.end();
    }
}

testAccess();
