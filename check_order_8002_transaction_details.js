/**
 * Check order 8002 nv-pending-pickup transaction details
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function checkTransactionDetails() {
    try {
        const result = await pool.query(`
            SELECT 
                id,
                sku,
                transaction_type,
                created_at,
                quantity_change,
                in_warehouse_before,
                in_warehouse_after,
                processing_before,
                processing_after,
                source_event,
                details
            FROM "his_db".stock_transactions
            WHERE source_id = 8002
            AND source_type = 'order'
            AND transaction_type = 'order_nv_pending_pickup'
            ORDER BY created_at DESC
        `);

        console.log('📊 NV-Pending-Pickup Transactions:');
        console.log('='.repeat(80));
        
        result.rows.forEach((tx, idx) => {
            console.log(`\n${idx + 1}. ${tx.sku}`);
            console.log(`   Transaction ID: ${tx.id}`);
            console.log(`   Created At: ${tx.created_at}`);
            console.log(`   Quantity Change: ${tx.quantity_change}`);
            console.log(`   In Warehouse: ${tx.in_warehouse_before} → ${tx.in_warehouse_after}`);
            console.log(`   Processing: ${tx.processing_before} → ${tx.processing_after}`);
            console.log(`   Source Event: ${tx.source_event}`);
            
            if (tx.details) {
                const details = typeof tx.details === 'string' ? JSON.parse(tx.details) : tx.details;
                console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
            }
        });

        // Check what the stock state was at the time of webhook (13:28:25)
        console.log('\n\n📦 STOCK STATE AT WEBHOOK TIME (13:28:25):');
        console.log('-'.repeat(80));
        
        const webhookTime = '2026-02-03 13:28:25';
        const skus = ['tra/10tab', 'tad5/10tab'];
        
        for (const sku of skus) {
            const stateAtTime = await pool.query(`
                SELECT 
                    in_warehouse_after,
                    processing_after,
                    pending_consult_after,
                    pending_review_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                AND created_at <= $2::timestamp
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            `, [sku, webhookTime]);
            
            if (stateAtTime.rows.length > 0) {
                const state = stateAtTime.rows[0];
                console.log(`\n${sku} at ${webhookTime}:`);
                console.log(`   In Warehouse: ${state.in_warehouse_after}`);
                console.log(`   Processing: ${state.processing_after}`);
                console.log(`   Pending Consult: ${state.pending_consult_after}`);
                console.log(`   Pending Review: ${state.pending_review_after}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkTransactionDetails();
