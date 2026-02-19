/**
 * Delete ALL ghost order_processing rows — both patterns:
 *
 * Pattern A (already handled): order_processing tx AFTER nv-pending-pickup tx for same order
 * Pattern B (new):             duplicate order_processing txs for same (order, sku) —
 *                              keep only the FIRST one, delete the rest
 *
 * DRY_RUN = true → preview only
 * DRY_RUN = false → delete
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const DRY_RUN = false; // ← set to false to apply

try {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🗑️  LIVE'} — Finding ghost rows...\n`);

  // ── Pattern A ────────────────────────────────────────────────────────────────
  // order_processing tx/webhook AFTER nv-pending-pickup for same order
  const patternA_tx = await client.query(`
    SELECT st.id, st.sku, st.transaction_type, st.created_at, st.source_id AS order_id,
           pickup.created_at AS pickup_at
    FROM his_db.stock_transactions st
    JOIN (
      SELECT source_id, MAX(created_at) AS created_at
      FROM his_db.stock_transactions
      WHERE transaction_type = 'order_nv_pending_pickup' AND source_type = 'order'
      GROUP BY source_id
    ) pickup ON pickup.source_id = st.source_id
    WHERE st.transaction_type = 'order_processing'
      AND st.source_type = 'order'
      AND st.created_at > pickup.created_at
    ORDER BY st.source_id, st.created_at
  `);

  const patternA_wl = await client.query(`
    SELECT wl.id, wl.entity_id AS order_id, wl.webhook_event, wl.created_at,
           pickup.created_at AS pickup_at
    FROM his_db.wc_webhook_logs wl
    JOIN (
      SELECT entity_id, MAX(created_at) AS created_at
      FROM his_db.wc_webhook_logs
      WHERE webhook_event = 'order.nv-pending-pickup' AND success = true
      GROUP BY entity_id
    ) pickup ON pickup.entity_id = wl.entity_id
    WHERE wl.webhook_event = 'order.processing'
      AND wl.created_at > pickup.created_at
    ORDER BY wl.entity_id, wl.created_at
  `);

  console.log(`📦 Pattern A — stock_transactions (processing AFTER pickup): ${patternA_tx.rows.length} row(s)`);
  if (patternA_tx.rows.length > 0) console.table(patternA_tx.rows.map(r => ({
    id: r.id, order_id: r.order_id, sku: r.sku,
    created_at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
    pickup_at: new Date(r.pickup_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
  })));

  console.log(`\n📨 Pattern A — wc_webhook_logs (processing AFTER pickup): ${patternA_wl.rows.length} row(s)`);
  if (patternA_wl.rows.length > 0) console.table(patternA_wl.rows.map(r => ({
    id: r.id, order_id: r.order_id, event: r.webhook_event,
    created_at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
    pickup_at: new Date(r.pickup_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
  })));

  // ── Pattern B ────────────────────────────────────────────────────────────────
  // Duplicate order_processing txs for same (order, sku) — keep only first, delete rest
  const patternB_tx = await client.query(`
    WITH ranked AS (
      SELECT id, source_id AS order_id, sku, transaction_type, created_at,
             ROW_NUMBER() OVER (
               PARTITION BY source_id, sku, transaction_type
               ORDER BY id ASC  -- keep the earliest
             ) AS rn
      FROM his_db.stock_transactions
      WHERE source_type = 'order'
        AND transaction_type IN ('order_processing','order_pending_consult','order_pending_review')
    )
    SELECT id, order_id, sku, transaction_type, created_at
    FROM ranked
    WHERE rn > 1
    ORDER BY order_id, sku, created_at
  `);

  const patternB_wl = await client.query(`
    WITH ranked AS (
      SELECT id, entity_id AS order_id, webhook_event, created_at,
             ROW_NUMBER() OVER (
               PARTITION BY entity_id, webhook_event
               ORDER BY id ASC
             ) AS rn
      FROM his_db.wc_webhook_logs
      WHERE webhook_event IN ('order.processing','order.pending-consult','order.pending-review')
    )
    SELECT id, order_id, webhook_event, created_at
    FROM ranked
    WHERE rn > 1
    ORDER BY order_id, created_at
  `);

  console.log(`\n📦 Pattern B — duplicate stock_transactions (keeping first per order+sku+type): ${patternB_tx.rows.length} row(s)`);
  if (patternB_tx.rows.length > 0) console.table(patternB_tx.rows.map(r => ({
    id: r.id, order_id: r.order_id, sku: r.sku, type: r.transaction_type,
    created_at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
  })));

  console.log(`\n📨 Pattern B — duplicate wc_webhook_logs (keeping first per order+event): ${patternB_wl.rows.length} row(s)`);
  if (patternB_wl.rows.length > 0) console.table(patternB_wl.rows.map(r => ({
    id: r.id, order_id: r.order_id, event: r.webhook_event,
    created_at: new Date(r.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
  })));

  const totalTx = patternA_tx.rows.length + patternB_tx.rows.length;
  const totalWl = patternA_wl.rows.length + patternB_wl.rows.length;
  console.log(`\n📊 Total to delete: ${totalTx} stock_transactions + ${totalWl} wc_webhook_logs`);

  if (DRY_RUN) {
    console.log('\n🔒 DRY RUN — no rows deleted. Set DRY_RUN = false to apply.');
    await client.end();
    process.exit(0);
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  await client.query('BEGIN');

  const txIds = [...new Set([
    ...patternA_tx.rows.map(r => r.id),
    ...patternB_tx.rows.map(r => r.id)
  ])];
  const wlIds = [...new Set([
    ...patternA_wl.rows.map(r => r.id),
    ...patternB_wl.rows.map(r => r.id)
  ])];

  if (txIds.length > 0) {
    const d1 = await client.query(`DELETE FROM his_db.stock_transactions WHERE id = ANY($1)`, [txIds]);
    console.log(`\n✅ Deleted ${d1.rowCount} ghost stock_transaction row(s).`);
  }
  if (wlIds.length > 0) {
    const d2 = await client.query(`DELETE FROM his_db.wc_webhook_logs WHERE id = ANY($1)`, [wlIds]);
    console.log(`✅ Deleted ${d2.rowCount} ghost wc_webhook_log row(s).`);
  }

  await client.query('COMMIT');
  console.log('\n🎉 Done. All ghost rows removed.');

} catch (e) {
  await client.query('ROLLBACK').catch(() => { });
  console.error('❌ Error:', e);
} finally {
  await client.end();
}
