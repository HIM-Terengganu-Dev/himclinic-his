import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

// Webhook log id=337 (13 Feb processing for order 9386)
console.log('\n====== WEBHOOK LOG id=337 (13 Feb processing) ======');
const wl = await client.query(`SELECT * FROM his_db.wc_webhook_logs WHERE id = 337`);
const w = wl.rows[0];
console.log(`event:          ${w.webhook_event}`);
console.log(`status:         ${w.status}`);
console.log(`current_status: ${w.current_status}`);
console.log(`entity_id:      ${w.entity_id}`);
console.log(`entity_sku:     ${w.entity_sku}`);
console.log(`affected_skus:  ${JSON.stringify(w.affected_skus)}`);
console.log(`success:        ${w.success}`);
console.log(`error:          ${w.error_message}`);
console.log(`created_at:     ${new Date(w.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
console.log(`details:`);
console.log(JSON.stringify(w.details, null, 2));

// Stock transactions id=545, 546
console.log('\n====== STOCK TX id=545 (tra/10tab) ======');
const tx1 = await client.query(`SELECT * FROM his_db.stock_transactions WHERE id = 545`);
const t1 = tx1.rows[0];
console.log(`type:           ${t1.transaction_type}`);
console.log(`qty_change:     ${t1.quantity_change}`);
console.log(`in_warehouse:   ${t1.in_warehouse_before} → ${t1.in_warehouse_after}`);
console.log(`processing:     ${t1.processing_before} → ${t1.processing_after}`);
console.log(`pending_consult:${t1.pending_consult_before} → ${t1.pending_consult_after}`);
console.log(`pending_review: ${t1.pending_review_before} → ${t1.pending_review_after}`);
console.log(`source_event:   ${t1.source_event}`);
console.log(`created_at:     ${new Date(t1.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
console.log(`details:        ${JSON.stringify(t1.details, null, 2)}`);

console.log('\n====== STOCK TX id=546 (tad20/4tab) ======');
const tx2 = await client.query(`SELECT * FROM his_db.stock_transactions WHERE id = 546`);
const t2 = tx2.rows[0];
console.log(`type:           ${t2.transaction_type}`);
console.log(`qty_change:     ${t2.quantity_change}`);
console.log(`in_warehouse:   ${t2.in_warehouse_before} → ${t2.in_warehouse_after}`);
console.log(`processing:     ${t2.processing_before} → ${t2.processing_after}`);
console.log(`pending_consult:${t2.pending_consult_before} → ${t2.pending_consult_after}`);
console.log(`pending_review: ${t2.pending_review_before} → ${t2.pending_review_after}`);
console.log(`source_event:   ${t2.source_event}`);
console.log(`created_at:     ${new Date(t2.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
console.log(`details:        ${JSON.stringify(t2.details, null, 2)}`);

// Also check what happened to pending_consult that was set in Feb 12
console.log('\n====== PENDING CONSULT TX (Feb 12) for order 9386 ======');
const pc = await client.query(`
  SELECT id, sku, transaction_type, pending_consult_before, pending_consult_after,
         processing_before, processing_after, created_at, details
  FROM his_db.stock_transactions
  WHERE source_id = 9386 AND source_type = 'order'
  ORDER BY id ASC
`);
pc.rows.forEach(r => {
    console.log(`\n[id=${r.id}] ${r.transaction_type} | sku=${r.sku}`);
    console.log(`  pending_consult: ${r.pending_consult_before} → ${r.pending_consult_after}`);
    console.log(`  processing:      ${r.processing_before} → ${r.processing_after}`);
    console.log(`  at: ${new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false })}`);
    console.log(`  details: ${JSON.stringify(r.details)}`);
});

await client.end();
