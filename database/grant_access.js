/**
 * Grant Permissions Script
 * 
 * Grants 'himbi_readwrite' user access to 'inventory_management' schema.
 */

const { Client } = require('pg');

// Owner connection string (from previous context)
const connectionString = 'postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require';

const targetUser = 'himbi_readwrite';

async function grantPermissions() {
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🔌 Connecting as Owner...');
        await client.connect();

        console.log(`🔐 Granting permissions to user: ${targetUser}`);

        // 1. Grant Usage on Schema
        console.log('   - Granting USAGE on SCHEMA inventory_management...');
        await client.query(`GRANT USAGE ON SCHEMA inventory_management TO ${targetUser};`);

        // 2. Grant Select/Insert/Update/Delete on all tables
        console.log('   - Granting ALL PRIVILEGES on ALL TABLES...');
        await client.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory_management TO ${targetUser};`);

        // 3. Grant usage on sequences (for SERIAL IDs)
        console.log('   - Granting ALL PRIVILEGES on ALL SEQUENCES...');
        await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA inventory_management TO ${targetUser};`);

        // 4. Set default privileges for future tables
        console.log('   - Setting DEFAULT PRIVILEGES for future tables...');
        await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA inventory_management GRANT ALL PRIVILEGES ON TABLES TO ${targetUser};`);
        await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA inventory_management GRANT ALL PRIVILEGES ON SEQUENCES TO ${targetUser};`);

        console.log('✅ Permissions granted successfully!');

        // Verification
        console.log('\n🔍 Verifying permissions...');
        const res = await client.query(`
      SELECT grantee, privilege_type 
      FROM information_schema.role_usage_grants 
      WHERE object_schema = 'inventory_management' 
      AND grantee = $1
    `, [targetUser]);

        if (res.rows.length > 0) {
            console.log(`User ${targetUser} has the following privileges on schema:`);
            res.rows.forEach(r => console.log(` - ${r.privilege_type}`));
        } else {
            console.log('⚠️  Could not verify schema usage directly via information_schema (might require different permissions view), but commands were executed.');
        }

    } catch (err) {
        console.error('❌ Error granting permissions:', err.message);
    } finally {
        await client.end();
    }
}

grantPermissions();
