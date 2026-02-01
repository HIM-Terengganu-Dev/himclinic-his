require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function findRemoval() {
    try {
        console.log('=== Finding What Removed Processing Count for Order 12099 ===\n');
        
        const skus = ['iqn100/4tab', 'tra/10tab'];
        
        for (const sku of skus) {
            console.log(`--- ${sku} ---`);
            
            // Get processing transaction for order 12099
            const processingTx = await pool.query(`
                SELECT 
                    id,
                    processing_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                AND source_id = 12099
                AND transaction_type = 'order_processing'
            `, [sku]);
            
            if (processingTx.rows.length === 0) {
                console.log('No processing transaction found');
                continue;
            }
            
            const procTx = processingTx.rows[0];
            const expectedProcessing = procTx.processing_after;
            const procTime = procTx.created_at;
            
            console.log(`Processing transaction (ID: ${procTx.id}):`);
            console.log(`  Processing set to: ${expectedProcessing}`);
            console.log(`  Created: ${procTime}`);
            
            // Find transactions that reduced processing count between processing and nv-pending-pickup
            const nvTime = new Date('2026-01-31T19:10:14+08:00');
            
            const reducingTxs = await pool.query(`
                SELECT 
                    id,
                    transaction_type,
                    source_id,
                    source_event,
                    processing_before,
                    processing_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                AND created_at > $2
                AND created_at < $3
                AND processing_after < processing_before
                ORDER BY created_at ASC
            `, [sku, procTime, nvTime]);
            
            console.log(`\nTransactions that reduced processing (${reducingTxs.rows.length}):`);
            reducingTxs.rows.forEach((tx, idx) => {
                console.log(`  ${idx + 1}. ${tx.transaction_type} (ID: ${tx.id}, Order: ${tx.source_id || 'N/A'})`);
                console.log(`     Processing: ${tx.processing_before} → ${tx.processing_after} (reduced by ${tx.processing_before - tx.processing_after})`);
                console.log(`     Created: ${tx.created_at}`);
            });
            
            // Check for nv-pending-pickup transactions for OTHER orders that might have affected this
            const otherNvTxs = await pool.query(`
                SELECT 
                    id,
                    source_id,
                    processing_before,
                    processing_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                AND transaction_type = 'order_nv_pending_pickup'
                AND source_id != 12099
                AND created_at > $2
                AND created_at < $3
                ORDER BY created_at ASC
            `, [sku, procTime, nvTime]);
            
            if (otherNvTxs.rows.length > 0) {
                console.log(`\nOther nv-pending-pickup transactions for this SKU (${otherNvTxs.rows.length}):`);
                otherNvTxs.rows.forEach((tx, idx) => {
                    console.log(`  ${idx + 1}. Order #${tx.source_id} (ID: ${tx.id})`);
                    console.log(`     Processing: ${tx.processing_before} → ${tx.processing_after}`);
                    console.log(`     Created: ${tx.created_at}`);
                });
            }
            
            // Check for cancelled transactions
            const cancelledTxs = await pool.query(`
                SELECT 
                    id,
                    source_id,
                    processing_before,
                    processing_after,
                    created_at
                FROM "his_db".stock_transactions
                WHERE sku = $1
                AND transaction_type = 'order_cancelled'
                AND created_at > $2
                AND created_at < $3
                ORDER BY created_at ASC
            `, [sku, procTime, nvTime]);
            
            if (cancelledTxs.rows.length > 0) {
                console.log(`\nCancelled transactions for this SKU (${cancelledTxs.rows.length}):`);
                cancelledTxs.rows.forEach((tx, idx) => {
                    console.log(`  ${idx + 1}. Order #${tx.source_id} (ID: ${tx.id})`);
                    console.log(`     Processing: ${tx.processing_before} → ${tx.processing_after}`);
                    console.log(`     Created: ${tx.created_at}`);
                });
            }
            
            console.log('');
        }
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

findRemoval();
