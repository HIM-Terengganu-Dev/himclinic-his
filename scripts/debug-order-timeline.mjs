/**
 * Deep-dive into order 12224's full event timeline side by side:
 * webhook logs + stock transactions, sorted chronologically.
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const ORDER_ID = 9386;

console.log(`\n====== FULL EVENT TIMELINE for order ${ORDER_ID} ======\n`);

// Get all webhook logs for this order
const webhooks = await client.query(`
  SELECT 'WEBHOOK' as source, id, webhook_event as event, status, created_at,
         details->>'previousStatus' as prev_status, NULL::text as tx_type,
         NULL::text as sku
  FROM his_db.wc_webhook_logs
  WHERE entity_id = $1
  ORDER BY created_at ASC
`, [ORDER_ID]);

// Get all stock transactions for this order
const txns = await client.query(`
  SELECT 'STOCK_TX' as source, id, source_event as event, NULL::text as status, created_at,
         NULL::text as prev_status, transaction_type as tx_type, sku
  FROM his_db.stock_transactions
  WHERE source_id = $1 AND source_type = 'order'
  ORDER BY created_at ASC
`, [ORDER_ID]);

// Merge and sort by created_at
const all = [...webhooks.rows, ...txns.rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

all.forEach(r => {
    const time = new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
    if (r.source === 'WEBHOOK') {
        console.log(`[${time}] 📨 WEBHOOK  id=${r.id} | event=${r.event} | status=${r.status} | prev=${r.prev_status ?? '-'}`);
    } else {
        console.log(`[${time}] 💾 STOCK_TX id=${r.id} | event=${r.event} | type=${r.tx_type} | sku=${r.sku}`);
    }
});

// Now check: are there processing webhooks that came in AFTER the nv-pending-pickup webhook?
console.log(`\n====== 🔴 Processing webhooks AFTER nv-pending-pickup for order ${ORDER_ID} ======`);
const pickupTime = webhooks.rows.find(r => r.event === 'order.nv-pending-pickup')?.created_at;
if (!pickupTime) {
    console.log('No nv-pending-pickup webhook found!');
} else {
    console.log(`nv-pending-pickup happened at: ${new Date(pickupTime).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);

    const lateProcessing = txns.rows.filter(r =>
        r.tx_type === 'order_processing' && new Date(r.created_at) > new Date(pickupTime)
    );
    if (lateProcessing.length === 0) {
        console.log('✅ No processing transactions after pickup — this is a stock_tx timing inconsistency only.');
    } else {
        console.log(`⚠️  ${lateProcessing.length} order_processing tx(s) registered AFTER nv-pending-pickup!`);
        lateProcessing.forEach(r => {
            console.log(`  id=${r.id} | sku=${r.sku} | at=${new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
        });
    }
}

// Check webhook logs for processing events after pickup
console.log(`\n====== 📨 Processing WEBHOOKS AFTER nv-pending-pickup for order ${ORDER_ID} ======`);
const processingWebhooks = webhooks.rows.filter(r => r.event === 'order.processing');
if (pickupTime) {
    const late = processingWebhooks.filter(r => new Date(r.created_at) > new Date(pickupTime));
    if (late.length === 0) {
        console.log('✅ No processing webhooks received after pickup.');
    } else {
        console.log(`⚠️  ${late.length} ORDER.PROCESSING webhook(s) received AFTER pickup!`);
        late.forEach(r => {
            console.log(`  id=${r.id} | at=${new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
        });
    }
}

await client.end();
