const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Read .env.local and extract DATABASE_URL_DDL
let databaseUrl = null;
try {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = envContent.match(/DATABASE_URL_DDL="([^"]+)"/);
    if (match) {
        databaseUrl = match[1];
    } else {
        // Try DATABASE_URL as fallback
        const match2 = envContent.match(/DATABASE_URL="([^"]+)"/);
        if (match2) {
            databaseUrl = match2[1];
        }
    }
} catch (error) {
    console.error('Error reading .env.local:', error.message);
}

if (!databaseUrl) {
    console.error('❌ Error: DATABASE_URL_DDL or DATABASE_URL not found in .env.local');
    process.exit(1);
}

console.log('🔌 Connecting to database...');

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('📝 Reading migration script...');
        const migrationSql = fs.readFileSync(
            path.join(__dirname, 'migration_remove_google_id_picture.sql'),
            'utf8'
        );

        console.log('🚀 Running migration...\n');
        
        // Execute migration statements one by one
        console.log('1. Dropping index on google_id...');
        try {
            await client.query('DROP INDEX IF EXISTS inventory_management.idx_users_google_id');
            console.log('   ✅ Index dropped');
        } catch (error) {
            console.log('   ℹ️  Index already removed or does not exist');
        }

        console.log('2. Dropping unique constraint on google_id...');
        try {
            await client.query('ALTER TABLE inventory_management.users DROP CONSTRAINT IF EXISTS users_google_id_key');
            console.log('   ✅ Constraint dropped');
        } catch (error) {
            console.log('   ℹ️  Constraint already removed or does not exist');
        }

        console.log('3. Removing google_id column...');
        try {
            await client.query('ALTER TABLE inventory_management.users DROP COLUMN IF EXISTS google_id');
            console.log('   ✅ google_id column removed');
        } catch (error) {
            console.log('   ℹ️  Column already removed or does not exist');
        }

        console.log('4. Removing picture column...');
        try {
            await client.query('ALTER TABLE inventory_management.users DROP COLUMN IF EXISTS picture');
            console.log('   ✅ picture column removed');
        } catch (error) {
            console.log('   ℹ️  Column already removed or does not exist');
        }

        // Run the verification query separately
        console.log('\n📊 Verifying changes...');
        const verifyResult = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'inventory_management'
              AND table_name = 'users'
            ORDER BY ordinal_position;
        `);

        console.log('\n✅ Migration completed successfully!');
        console.log('\n📋 Current users table structure:');
        console.table(verifyResult.rows);

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();

