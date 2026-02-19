import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const ORDER_ID = 12388;

// 1. All webhook logs for this order
console.log('\n====== WC_WEBHOOK_LOGS for order', ORDER_ID, '======');
const webhookLogs = await client.query(`
  SELECT id, webhook_type, webhook_event, entity_id, entity_sku, status, current_status,
         stock_quantity, previous_stock_quantity, affected_skus, combo_updates, details,
         success, error_message, created_at
  FROM his_db.wc_webhook_logs
  WHERE entity_id = $1
  ORDER BY created_at ASC
`, [ORDER_ID]);
console.log(`Found ${webhookLogs.rows.length} webhook log entries:`);
webhookLogs.rows.forEach((r, i) => {
    console.log(`\n[${i + 1}] id=${r.id} | event=${r.webhook_event} | status=${r.status} | current_status=${r.current_status} | created_at=${r.created_at}`);
    console.log(`     success=${r.success} | error=${r.error_message}`);
    console.log(`     entity_sku=${r.entity_sku}`);
    console.log(`     affected_skus=${JSON.stringify(r.affected_skus)}`);
    console.log(`     combo_updates=${JSON.stringify(r.combo_updates)}`);
    console.log(`     details=${JSON.stringify(r.details)}`);
});

// 2. All stock transactions linked to this order
console.log('\n====== STOCK_TRANSACTIONS for order', ORDER_ID, '======');
const stockTx = await client.query(`
  SELECT id, sku, single_sku_id, transaction_type, quantity_change,
         stock_before, stock_after,
         pending_before, pending_after,
         in_warehouse_before, in_warehouse_after,
         processing_before, processing_after,
         pending_consult_before, pending_consult_after,
         pending_review_before, pending_review_after,
         backorder_before, backorder_after,
         source_type, source_id, source_event, details, created_at
  FROM his_db.stock_transactions
  WHERE source_id = $1
     OR details::text LIKE $2
  ORDER BY created_at ASC
`, [ORDER_ID, `%${ORDER_ID}%`]);
console.log(`Found ${stockTx.rows.length} stock transaction entries:`);
stockTx.rows.forEach((r, i) => {
    console.log(`\n[${i + 1}] id=${r.id} | sku=${r.sku} | type=${r.transaction_type} | change=${r.quantity_change}`);
    console.log(`     stock: ${r.stock_before} → ${r.stock_after}`);
    console.log(`     pending: ${r.pending_before} → ${r.pending_after}`);
    console.log(`     in_warehouse: ${r.in_warehouse_before} → ${r.in_warehouse_after}`);
    console.log(`     processing: ${r.processing_before} → ${r.processing_after}`);
    console.log(`     pending_consult: ${r.pending_consult_before} → ${r.pending_consult_after}`);
    console.log(`     pending_review: ${r.pending_review_before} → ${r.pending_review_after}`);
    console.log(`     backorder: ${r.backorder_before} → ${r.backorder_after}`);
    console.log(`     source: ${r.source_type} / ${r.source_event} | source_id=${r.source_id}`);
    console.log(`     details=${JSON.stringify(r.details)}`);
    console.log(`     created_at=${r.created_at}`);
});

// 3. Check if any webhook log mentions nv-pending-pickup in any field
console.log('\n====== SEARCHING for nv-pending-pickup in ALL webhook logs ======');
const nvCheck = await client.query(`
  SELECT id, entity_id, webhook_event, status, current_status, details, created_at
  FROM his_db.wc_webhook_logs
  WHERE status = 'nv-pending-pickup'
     OR current_status = 'nv-pending-pickup'
     OR details::text ILIKE '%nv-pending-pickup%'
     OR details::text ILIKE '%pending-pickup%'
  ORDER BY created_at DESC
  LIMIT 20
`);
console.log(`Found ${nvCheck.rows.length} logs with nv-pending-pickup reference:`);
nvCheck.rows.forEach((r, i) => {
    console.log(`[${i + 1}] id=${r.id} | order=${r.entity_id} | event=${r.webhook_event} | status=${r.status} | current_status=${r.current_status} | created_at=${r.created_at}`);
});

// 4. What distinct statuses/events exist in webhook logs?
console.log('\n====== DISTINCT webhook_event + status combinations ======');
const distinct = await client.query(`
  SELECT webhook_event, status, current_status, COUNT(*) as cnt
  FROM his_db.wc_webhook_logs
  GROUP BY webhook_event, status, current_status
  ORDER BY cnt DESC
  LIMIT 30
`);
distinct.rows.forEach(r => {
    console.log(`  event=${r.webhook_event} | status=${r.status} | current_status=${r.current_status} | count=${r.cnt}`);
});

await client.end();
