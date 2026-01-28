const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function debugOrders() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        console.log('🔍 Debugging Orders #11964 and #11314 for iqn100/4tab...\n');

        // Get all webhook logs for both orders
        console.log('=== Step 1: All Webhook Logs for Orders 11964 and 11314 ===');
        const orderLogs = await pool.query(`
            SELECT 
                id,
                entity_id as order_id,
                webhook_event,
                status,
                created_at,
                entity_sku,
                affected_skus,
                details->'componentDeductions' as component_deductions,
                details->'pendingStockUpdates' as pending_stock_updates,
                details->'lineItems' as line_items
            FROM inventory_management.wc_webhook_logs
            WHERE entity_id IN (11964, 11314)
            ORDER BY entity_id, created_at
        `);
        console.log(JSON.stringify(orderLogs.rows, null, 2));
        console.log('\n');

        // Get pending consultation stock
        console.log('=== Step 2: Pending Consultation Stock ===');
        const pendingStock = await pool.query(`
            SELECT 
                order_id,
                sku,
                quantity,
                status,
                created_at
            FROM inventory_management.pending_consultation_stock
            WHERE order_id IN (11964, 11314)
            ORDER BY order_id, created_at
        `);
        console.log(JSON.stringify(pendingStock.rows, null, 2));
        console.log('\n');

        // Get timestamps for each event
        const order11314Pending = orderLogs.rows.find((r) => r.order_id === 11314 && (r.webhook_event === 'order.pending-consult' || r.webhook_event === 'order.pending-review'));
        const order11964Pending = orderLogs.rows.find((r) => r.order_id === 11964 && (r.webhook_event === 'order.pending-consult' || r.webhook_event === 'order.pending-review'));
        const order11314Processing = orderLogs.rows.find((r) => r.order_id === 11314 && r.webhook_event === 'order.processing');

        if (order11314Pending) {
            console.log(`=== Step 3: Pending Logs BEFORE Order 11314 Pending (${order11314Pending.created_at}) ===`);
            const pendingBefore11314 = await pool.query(`
                SELECT 
                    id,
                    entity_id as order_id,
                    webhook_event,
                    status,
                    created_at,
                    details->'pendingStockUpdates' as pending_stock_updates
                FROM inventory_management.wc_webhook_logs
                WHERE webhook_type = 'order'
                AND (webhook_event = 'order.pending-consult' OR webhook_event = 'order.pending-review')
                AND created_at < $1
                AND details->'pendingStockUpdates' IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 10
            `, [order11314Pending.created_at]);
            console.log(JSON.stringify(pendingBefore11314.rows, null, 2));
            console.log('\n');
        }

        if (order11964Pending) {
            console.log(`=== Step 4: Pending Logs BEFORE Order 11964 Pending (${order11964Pending.created_at}) ===`);
            const pendingBefore11964 = await pool.query(`
                SELECT 
                    id,
                    entity_id as order_id,
                    webhook_event,
                    status,
                    created_at,
                    details->'pendingStockUpdates' as pending_stock_updates
                FROM inventory_management.wc_webhook_logs
                WHERE webhook_type = 'order'
                AND (webhook_event = 'order.pending-consult' OR webhook_event = 'order.pending-review')
                AND created_at < $1
                AND details->'pendingStockUpdates' IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 10
            `, [order11964Pending.created_at]);
            console.log(JSON.stringify(pendingBefore11964.rows, null, 2));
            console.log('\n');
        }

        if (order11314Processing) {
            console.log(`=== Step 5: Pending Logs BEFORE Order 11314 Processing (${order11314Processing.created_at}) ===`);
            const pendingBefore11314Processing = await pool.query(`
                SELECT 
                    id,
                    entity_id as order_id,
                    webhook_event,
                    status,
                    created_at,
                    details->'pendingStockUpdates' as pending_stock_updates
                FROM inventory_management.wc_webhook_logs
                WHERE webhook_type = 'order'
                AND (webhook_event = 'order.pending-consult' OR webhook_event = 'order.pending-review')
                AND created_at < $1
                AND details->'pendingStockUpdates' IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 10
            `, [order11314Processing.created_at]);
            console.log(JSON.stringify(pendingBefore11314Processing.rows, null, 2));
            console.log('\n');
        }

        // Check component deductions for order 11314 processing
        if (order11314Processing) {
            console.log('=== Step 6: Component Deductions for Order 11314 Processing ===');
            const componentDeductions = await pool.query(`
                SELECT 
                    w.entity_id as order_id,
                    w.created_at,
                    deduction->>'sku' as sku,
                    (deduction->>'previousStock')::int as previous_stock,
                    (deduction->>'newStock')::int as new_stock,
                    (deduction->>'deductedQty')::int as deducted_qty,
                    (deduction->>'isWcSide')::boolean as is_wc_side
                FROM inventory_management.wc_webhook_logs w,
                     jsonb_array_elements(w.details->'componentDeductions') AS deduction
                WHERE w.entity_id = 11314
                AND w.webhook_event = 'order.processing'
                AND deduction->>'sku' = 'iqn100/4tab'
            `);
            console.log(JSON.stringify(componentDeductions.rows, null, 2));
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

debugOrders();

