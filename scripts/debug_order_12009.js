const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function debugOrder() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        console.log('🔍 Debugging Order #12009 and #11941...\n');

        // Step 1: Get all webhook logs for both orders
        console.log('=== Step 1: Webhook Logs for Orders 12009 and 11941 ===');
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
                details->'lineItems' as line_items,
                details->'pendingStockUpdates' as pending_stock_updates
            FROM inventory_management.wc_webhook_logs
            WHERE entity_id IN (12009, 11941)
            ORDER BY entity_id, created_at
        `);
        console.log(JSON.stringify(orderLogs.rows, null, 2));
        console.log('\n');

        // Step 2: Get component deductions for order 12009
        console.log('=== Step 2: Component Deductions for Order 12009 ===');
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
            WHERE w.entity_id = 12009
            AND w.webhook_event = 'order.processing'
            ORDER BY deduction->>'sku'
        `);
        console.log(JSON.stringify(componentDeductions.rows, null, 2));
        console.log('\n');

        // Step 3: Get pending consultation stock
        console.log('=== Step 3: Pending Consultation Stock ===');
        const pendingStock = await pool.query(`
            SELECT 
                order_id,
                sku,
                quantity,
                status,
                created_at
            FROM inventory_management.pending_consultation_stock
            WHERE order_id IN (12009, 11941)
            ORDER BY order_id, created_at
        `);
        console.log(JSON.stringify(pendingStock.rows, null, 2));
        console.log('\n');

        // Step 4: Get processing time for order 12009
        const processingTimeResult = await pool.query(`
            SELECT created_at
            FROM inventory_management.wc_webhook_logs
            WHERE entity_id = 12009
            AND webhook_event = 'order.processing'
            LIMIT 1
        `);
        const processingTime = processingTimeResult.rows[0]?.created_at;

        if (processingTime) {
            console.log(`=== Step 4: Pending Logs BEFORE Order 12009 (processed at ${processingTime}) ===`);
            const pendingLogsBefore = await pool.query(`
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
                LIMIT 20
            `, [processingTime]);
            console.log(JSON.stringify(pendingLogsBefore.rows, null, 2));
            console.log('\n');

            // Step 5: Check if order 11941's pending-consult affects the same SKU as order 12009
            console.log('=== Step 5: Checking if Order 11941 pending affects same SKU as Order 12009 ===');
            if (componentDeductions.rows.length > 0 && pendingLogsBefore.rows.length > 0) {
                const skusIn12009 = componentDeductions.rows.map((r) => r.sku);
                console.log(`SKUs in Order 12009: ${skusIn12009.join(', ')}`);
                
                pendingLogsBefore.rows.forEach((log) => {
                    if (log.order_id === 11941 && log.pending_stock_updates) {
                        console.log(`\nOrder 11941 pending-consult log:`);
                        console.log(`  Created at: ${log.created_at}`);
                        console.log(`  Pending stock updates:`, JSON.stringify(log.pending_stock_updates, null, 2));
                        
                        const matchingSkus = log.pending_stock_updates.filter((p) => 
                            skusIn12009.includes(p.sku)
                        );
                        if (matchingSkus.length > 0) {
                            console.log(`  ✅ MATCHING SKUs found:`, matchingSkus);
                        } else {
                            console.log(`  ❌ No matching SKUs - Order 11941 pending is for different SKUs`);
                        }
                    }
                });
            }
        }

        // Step 6: Check if order 11941 was processed (which would remove its pending stock)
        console.log('\n=== Step 6: Check if Order 11941 was processed ===');
        const order11941Processing = await pool.query(`
            SELECT 
                id,
                entity_id as order_id,
                webhook_event,
                status,
                created_at,
                details->'componentDeductions' as component_deductions
            FROM inventory_management.wc_webhook_logs
            WHERE entity_id = 11941
            AND webhook_event = 'order.processing'
            ORDER BY created_at
        `);
        console.log('Order 11941 processing logs:', JSON.stringify(order11941Processing.rows, null, 2));
        
        // Step 7: Check all processing logs that might have removed pending stock
        console.log('\n=== Step 7: Processing logs that might have removed pending stock ===');
        if (processingTime) {
            const processingLogsBefore = await pool.query(`
                SELECT 
                    id,
                    entity_id as order_id,
                    webhook_event,
                    created_at,
                    details->'componentDeductions' as component_deductions
                FROM inventory_management.wc_webhook_logs
                WHERE webhook_type = 'order'
                AND webhook_event = 'order.processing'
                AND created_at < $1
                AND created_at >= $1 - INTERVAL '7 days'
                ORDER BY created_at DESC
                LIMIT 10
            `, [processingTime]);
            console.log(JSON.stringify(processingLogsBefore.rows, null, 2));
        }
        
        // Step 8: Summary - What should the display show?
        console.log('\n=== Step 8: Summary ===');
        console.log(`Order 12009 processed at: ${processingTime}`);
        console.log(`Order 12009: him1 ${componentDeductions.rows[0]?.previous_stock} → ${componentDeductions.rows[0]?.new_stock} (deducted ${componentDeductions.rows[0]?.deducted_qty})`);
        
        if (order11941Processing.rows.length > 0) {
            const processedAt = order11941Processing.rows[0].created_at;
            console.log(`Order 11941 was processed at: ${processedAt}`);
            if (new Date(processedAt) < new Date(processingTime)) {
                console.log('❌ Order 11941 was processed BEFORE order 12009 - its pending stock should have been removed');
                console.log('   Expected display: 64 → 61 (no pending stock)');
            } else {
                console.log('✅ Order 11941 was processed AFTER order 12009 - its pending stock should still be there');
                console.log('   Expected display: 64+1 → 61+1');
            }
        } else {
            console.log('✅ Order 11941 was NOT processed - its pending stock should still be there');
            console.log('   Expected display: 64+1 → 61+1');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

debugOrder();

