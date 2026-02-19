/**
 * Detect Stale Orders (Pre-Feb 10, 2026)
 * 
 * Objectives:
 * 1. Find orders created/processed before Feb 10, 2026.
 * 2. That appear to be "stuck" in Processing or Pending state.
 *    (Have entry transaction but no exit transaction like pickup/cancel).
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const CUTOFF_DATE = '2026-02-10T00:00:00.000Z';

try {
    console.log(`🔍 Scanning for stale active orders before ${CUTOFF_DATE}...`);

    // Query: Find orders that have entry events but no exit events, and were last touched before cutoff
    // Entry events: order_processing, order_pending_consult, order_pending_review
    // Exit events: order_nv_pending_pickup, order_cancelled, order_completed (if exists in DB?)

    // Note: Reconciliation might hide things, but we focus on order flow.

    const result = await client.query(`
    WITH OrderStats AS (
      SELECT 
        source_id, 
        sku,
        MAX(created_at) as last_activity,
        COUNT(CASE WHEN transaction_type IN ('order_processing') THEN 1 END) as processing_events,
        COUNT(CASE WHEN transaction_type IN ('order_pending_consult', 'order_pending_review') THEN 1 END) as pending_events,
        COUNT(CASE WHEN transaction_type IN ('order_nv_pending_pickup', 'order_cancelled') THEN 1 END) as exit_events
      FROM his_db.stock_transactions
      WHERE source_type = 'order'
      GROUP BY source_id, sku
    )
    SELECT * 
    FROM OrderStats
    WHERE last_activity < $1
      AND (processing_events > 0 OR pending_events > 0)
      AND exit_events < (processing_events + pending_events) -- Crude check: fewer exits than entries? 
      -- Actually, usually 1 entry (processing) should have 1 exit (pickup).
      -- If exit_events = 0, it's definitely stuck.
      AND exit_events = 0
    ORDER BY last_activity ASC
  `, [CUTOFF_DATE]);

    if (result.rows.length === 0) {
        console.log('✅ No stale orders found before cutoff date.');
    } else {
        console.log(`⚠️ Found ${result.rows.length} potentially stale orders:`);
        console.table(result.rows);

        console.log('\nAnalysis:');
        console.log(`These orders have Processing/Pending entries but NO exit entries (pickup/cancel) recorded in DB.`);
        console.log(`Strategy: Revoke their stock hold (set to 0).`);
    }

} catch (e) {
    console.error('❌ Error:', e);
} finally {
    await client.end();
}
