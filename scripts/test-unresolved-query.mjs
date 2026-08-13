import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
const match = envContent.match(/DATABASE_URL\s*=\s*"([^"]+)"/);
const pool = new pg.Pool({ connectionString: match[1].trim(), ssl: { rejectUnauthorized: false } });

const CUTOFF_UTC = '2026-03-02T16:00:00Z';
const sql = `
    WITH
    OrderEvents AS (
        SELECT entity_id AS order_id, MAX(created_at) AS last_event_at, MIN(created_at) AS first_seen_at,
            (ARRAY_AGG(webhook_event ORDER BY created_at DESC))[1] AS last_webhook_event,
            (ARRAY_AGG(current_status ORDER BY created_at DESC))[1] AS last_current_status
        FROM his_db.wc_webhook_logs
        WHERE webhook_type = 'order' AND success = true AND created_at >= $1::timestamptz
        GROUP BY entity_id
    ),
    TerminalOrders AS (
        SELECT DISTINCT entity_id AS order_id FROM his_db.wc_webhook_logs
        WHERE webhook_type = 'order' AND success = true
          AND webhook_event IN ('order.nv-pending-pickup', 'order.cancelled', 'order.refunded', 'order.manual_resolve', 'order.manual_resolved')
          AND created_at >= $1::timestamptz
        UNION
        SELECT DISTINCT source_id AS order_id FROM his_db.stock_transactions
        WHERE source_type = 'order'
          AND (source_event = 'admin.manual_resolve' OR transaction_type IN ('order_nv_pending_pickup', 'order_cancelled', 'order_refunded'))
    ),
    ActiveOrders AS (
        SELECT oe.* FROM OrderEvents oe
        LEFT JOIN TerminalOrders te ON oe.order_id = te.order_id
        WHERE te.order_id IS NULL
    ),
    NetOrderTx AS (
        SELECT
            st.source_id AS order_id, st.sku,
            GREATEST(0, SUM(st.processing_after      - st.processing_before))      AS processing,
            GREATEST(0, SUM(st.pending_consult_after - st.pending_consult_before)) AS pending_consult,
            GREATEST(0, SUM(st.pending_review_after  - st.pending_review_before))  AS pending_review
        FROM his_db.stock_transactions st
        INNER JOIN ActiveOrders ao ON st.source_id = ao.order_id
        WHERE st.source_type = 'order'
        GROUP BY st.source_id, st.sku
    ),
    HeldStock AS (
        SELECT nt.order_id, nt.sku, nt.processing, nt.pending_consult, nt.pending_review
        FROM NetOrderTx nt
        WHERE (nt.processing > 0 OR nt.pending_consult > 0 OR nt.pending_review > 0)
    ),
    OrdersWithStock AS (SELECT DISTINCT order_id FROM HeldStock)
    SELECT ao.order_id, ao.last_current_status AS current_status, ao.first_seen_at, ao.last_event_at, ao.last_webhook_event,
        COALESCE(json_agg(json_build_object('sku', hs.sku, 'processing', hs.processing, 'pending_consult', hs.pending_consult, 'pending_review', hs.pending_review) ORDER BY hs.sku) FILTER (WHERE hs.sku IS NOT NULL), '[]'::json) AS held_stock
    FROM ActiveOrders ao
    INNER JOIN OrdersWithStock ows ON ao.order_id = ows.order_id
    LEFT JOIN HeldStock hs ON ao.order_id = hs.order_id
    GROUP BY ao.order_id, ao.last_current_status, ao.first_seen_at, ao.last_event_at, ao.last_webhook_event
    ORDER BY ao.last_event_at DESC
`;

try {
    const result = await pool.query(sql, [CUTOFF_UTC]);
    console.log(`✅ ${result.rows.length} unresolved order(s)\n`);
    for (const row of result.rows) {
        console.log(`Order #${row.order_id} [${row.current_status}]`);
        for (const h of row.held_stock) {
            const total = h.processing + h.pending_consult + h.pending_review;
            console.log(`  ${h.sku}: processing=${h.processing} pending_consult=${h.pending_consult} pending_review=${h.pending_review} → TOTAL HELD=${total}`);
        }
    }
} catch (err) {
    console.error('❌', err.message);
} finally {
    await pool.end();
}
