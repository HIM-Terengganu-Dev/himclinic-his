/**
 * Check order 8002 webhook log details for errors or issues
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkWebhookDetails() {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                webhook_event,
                created_at,
                success,
                error_message,
                details
            FROM "his_db".wc_webhook_logs
            WHERE entity_id = 8002
            AND webhook_event = 'order.nv-pending-pickup'
            ORDER BY created_at DESC
            LIMIT 1
        `);

        if (result.rows.length > 0) {
            const log = result.rows[0];
            console.log('📋 NV-Pending-Pickup Webhook Log Details:');
            console.log('='.repeat(80));
            console.log(`ID: ${log.id}`);
            console.log(`Event: ${log.webhook_event}`);
            console.log(`Created At: ${log.created_at}`);
            console.log(`Success: ${log.success}`);
            console.log(`Error Message: ${log.error_message || 'None'}`);
            
            if (log.details) {
                const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                console.log('\n📄 Details JSON:');
                console.log(JSON.stringify(details, null, 2));
            }
        } else {
            console.log('❌ No webhook log found');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkWebhookDetails();
