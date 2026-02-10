/**
 * Investigate order 12272: Check webhook logs, stock transactions, and timestamps
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function investigateOrder12272() {
    try {
        console.log('🔍 Investigating Order #12272\n');
        console.log('='.repeat(80));

        // 1. Get all webhook logs for order 12272
        console.log('\n📋 WEBHOOK LOGS for Order #12272:');
        console.log('-'.repeat(80));
        const webhookLogs = await pool.query(`
            SELECT 
                id,
                webhook_event,
                status,
                current_status,
                created_at,
                success,
                error_message,
                details
            FROM "his_db".wc_webhook_logs
            WHERE entity_id = 12272
            ORDER BY created_at ASC
        `);

        if (webhookLogs.rows.length === 0) {
            console.log('❌ No webhook logs found for order 12272');
        } else {
            webhookLogs.rows.forEach((log, idx) => {
                console.log(`\n${idx + 1}. ${log.webhook_event || 'N/A'}`);
                console.log(`   Status: ${log.status || 'N/A'}`);
                console.log(`   Current Status: ${log.current_status || 'N/A'}`);
                console.log(`   Created At (GMT+8): ${log.created_at}`);
                console.log(`   Success: ${log.success}`);
                if (log.error_message) {
                    console.log(`   Error: ${log.error_message}`);
                }
                if (log.details) {
                    const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                    if (details.wcDateCreated || details.wcDateModified) {
                        console.log(`   WC Date Created: ${details.wcDateCreated || 'N/A'}`);
                        console.log(`   WC Date Created GMT: ${details.wcDateCreatedGmt || 'N/A'}`);
                        console.log(`   WC Date Modified: ${details.wcDateModified || 'N/A'}`);
                        console.log(`   WC Date Modified GMT: ${details.wcDateModifiedGmt || 'N/A'}`);
                    }
                }
            });
        }

        // 2. Get all stock transactions for order 12272
        console.log('\n\n📊 STOCK TRANSACTIONS for Order #12272:');
        console.log('-'.repeat(80));
        const stockTransactions = await pool.query(`
            SELECT 
                id,
                sku,
                transaction_type,
                quantity_change,
                in_warehouse_before,
                in_warehouse_after,
                processing_before,
                processing_after,
                pending_consult_before,
                pending_consult_after,
                pending_review_before,
                pending_review_after,
                created_at,
                source_type,
                source_id,
                source_event,
                details
            FROM "his_db".stock_transactions
            WHERE source_id = 12272
            AND source_type = 'order'
            ORDER BY created_at ASC
        `);

        if (stockTransactions.rows.length === 0) {
            console.log('❌ No stock transactions found for order 12272');
        } else {
            stockTransactions.rows.forEach((tx, idx) => {
                console.log(`\n${idx + 1}. ${tx.transaction_type} - ${tx.sku}`);
                console.log(`   Created At (GMT+8): ${tx.created_at}`);
                console.log(`   Quantity Change: ${tx.quantity_change}`);
                console.log(`   In Warehouse: ${tx.in_warehouse_before} → ${tx.in_warehouse_after}`);
                console.log(`   Processing: ${tx.processing_before} → ${tx.processing_after}`);
                console.log(`   Pending Consult: ${tx.pending_consult_before} → ${tx.pending_consult_after}`);
                console.log(`   Pending Review: ${tx.pending_review_before} → ${tx.pending_review_after}`);
                console.log(`   Source Event: ${tx.source_event || 'N/A'}`);
                if (tx.details) {
                    const details = typeof tx.details === 'string' ? JSON.parse(tx.details) : tx.details;
                    if (details.deductedFromStatus) {
                        console.log(`   Deducted From Status: ${details.deductedFromStatus}`);
                    }
                }
            });
        }

        // 3. Check for nv-pending-pickup specifically
        console.log('\n\n🔍 NV-PENDING-PICKUP CHECK:');
        console.log('-'.repeat(80));
        const nvPickupWebhook = await pool.query(`
            SELECT * FROM "his_db".wc_webhook_logs
            WHERE entity_id = 12272
            AND (webhook_event = 'order.nv-pending-pickup' OR status = 'nv-pending-pickup')
            ORDER BY created_at DESC
            LIMIT 1
        `);

        const nvPickupTransaction = await pool.query(`
            SELECT * FROM "his_db".stock_transactions
            WHERE source_id = 12272
            AND source_type = 'order'
            AND transaction_type = 'order_nv_pending_pickup'
            ORDER BY created_at DESC
            LIMIT 1
        `);

        if (nvPickupWebhook.rows.length > 0) {
            console.log('✅ NV-Pending-Pickup Webhook Found:');
            const log = nvPickupWebhook.rows[0];
            console.log(`   Webhook Created At: ${log.created_at}`);
            console.log(`   Webhook Event: ${log.webhook_event}`);
            console.log(`   Status: ${log.status}`);
        } else {
            console.log('❌ No NV-Pending-Pickup webhook found');
        }

        if (nvPickupTransaction.rows.length > 0) {
            console.log('✅ NV-Pending-Pickup Transaction Found:');
            const tx = nvPickupTransaction.rows[0];
            console.log(`   Transaction Created At: ${tx.created_at}`);
            console.log(`   SKU: ${tx.sku}`);
            console.log(`   In Warehouse: ${tx.in_warehouse_before} → ${tx.in_warehouse_after}`);
        } else {
            console.log('❌ No NV-Pending-Pickup transaction found');
        }

        // 4. Compare timestamps
        console.log('\n\n⏰ TIMESTAMP COMPARISON:');
        console.log('-'.repeat(80));
        if (webhookLogs.rows.length > 0 && stockTransactions.rows.length > 0) {
            webhookLogs.rows.forEach((log, idx) => {
                console.log(`\nWebhook ${idx + 1} (${log.webhook_event}):`);
                console.log(`   Webhook Received: ${log.created_at}`);
                
                // Find matching transactions
                const matchingTxs = stockTransactions.rows.filter(tx => {
                    const logTime = new Date(log.created_at).getTime();
                    const txTime = new Date(tx.created_at).getTime();
                    // Check if within 5 seconds (webhook processing time)
                    return Math.abs(logTime - txTime) < 5000;
                });

                if (matchingTxs.length > 0) {
                    matchingTxs.forEach(tx => {
                        const logTime = new Date(log.created_at).getTime();
                        const txTime = new Date(tx.created_at).getTime();
                        const diff = Math.abs(logTime - txTime);
                        console.log(`   ✅ Matching Transaction: ${tx.transaction_type} - ${tx.sku}`);
                        console.log(`      Transaction Created: ${tx.created_at}`);
                        console.log(`      Time Difference: ${diff}ms (${(diff / 1000).toFixed(2)}s)`);
                    });
                } else {
                    console.log(`   ⚠️  No matching transactions found within 5 seconds`);
                }
            });
        }

        // 5. Check current stock state for affected SKUs
        console.log('\n\n📦 CURRENT STOCK STATE (for SKUs in order 12272):');
        console.log('-'.repeat(80));
        const orderSkus = await pool.query(`
            SELECT DISTINCT sku
            FROM "his_db".stock_transactions
            WHERE source_id = 12272
            AND source_type = 'order'
        `);

        for (const row of orderSkus.rows) {
            const sku = row.sku;
            const latestTx = await pool.query(`
                SELECT 
                    in_warehouse_after,
                    processing_after,
                    pending_consult_after,
                    pending_review_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `, [sku]);

            if (latestTx.rows.length > 0) {
                const state = latestTx.rows[0];
                const availableForPurchase = Math.max(0, 
                    state.in_warehouse_after - 
                    state.processing_after - 
                    state.pending_consult_after - 
                    state.pending_review_after
                );
                console.log(`\n${sku}:`);
                console.log(`   In Warehouse: ${state.in_warehouse_after}`);
                console.log(`   Processing: ${state.processing_after}`);
                console.log(`   Pending Consult: ${state.pending_consult_after}`);
                console.log(`   Pending Review: ${state.pending_review_after}`);
                console.log(`   Available for Purchase: ${availableForPurchase}`);
                console.log(`   Last Transaction: ${state.created_at}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

investigateOrder12272();
