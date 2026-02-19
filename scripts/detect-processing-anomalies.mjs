/**
 * Detection Script for Processing Anomalies
 * 
 * Objectives:
 * 1. Find orders with multiple 'order_processing' transactions for the same SKU
 *    (This indicates the idempotency bug hit them)
 * 2. List the affected orders, SKUs, and the number of duplicate entries
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

try {
    console.log('🔍 Scanning for duplicate order_processing transactions...');

    const result = await client.query(`
    SELECT source_id, sku, COUNT(*) as count, MIN(created_at) as first_seen, MAX(created_at) as last_seen
    FROM his_db.stock_transactions
    WHERE transaction_type = 'order_processing'
    GROUP BY source_id, sku
    HAVING COUNT(*) > 1
    ORDER BY count DESC, source_id DESC
  `);

    if (result.rows.length === 0) {
        console.log('✅ No duplicate processing transactions found!');
    } else {
        console.log(`⚠️ Found ${result.rows.length} orders with duplicate processing entries:`);
        console.table(result.rows);

        // Detailed check for a few if simpler
        console.log('\nSuggested Actions:');
        console.log('1. Verify if these are legitimate (e.g. cancelled then re-processed) or bugs.');
        console.log('2. If bugs, delete the duplicates (keep the earliest one).');
        console.log('3. Recalculate stock state for affected SKUs.');
    }

} catch (e) {
    console.error('❌ Error:', e);
} finally {
    await client.end();
}
