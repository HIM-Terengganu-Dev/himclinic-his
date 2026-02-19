/**
 * Cleanup Duplicates (Phase 2B)
 * 
 * Objectives:
 * 1. Find orders with multiple 'order_processing' transactions.
 * 2. Verify they are contiguous.
 * 3. Delete duplicates (keep first).
 * 4. Recalculate running balances for the SKU.
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

try {
    await client.query('BEGIN');
    console.log('🧹 Scanning for duplicate processing orders...');

    // 1. Find orders with duplicates
    const targetOrders = await client.query(`
    SELECT source_id, sku, COUNT(*) as count
    FROM his_db.stock_transactions
    WHERE transaction_type = 'order_processing'
    GROUP BY source_id, sku
    HAVING COUNT(*) > 1
    ORDER BY source_id DESC
  `);

    if (targetOrders.rows.length === 0) {
        console.log('✅ No duplicate processing transactions found.');
        await client.query('ROLLBACK');
        process.exit(0);
    }

    console.log(`Found ${targetOrders.rows.length} orders with duplicates.`);

    for (const order of targetOrders.rows) {
        console.log(`\nProcessing Order #${order.source_id} (SKU: ${order.sku})`);

        // Fetch ALL transactions for this Order to check contiguity
        // We only care about the sequence of events for this ORDER.
        // But we also need to know if there are other transactions for this SKU in between?
        // No, for "contiguity of duplicates", we only care if the Order had other events.
        // E.g. Processing -> Cancel -> Processing is valid (not duplicate logic).
        // Processing -> Processing (with no Cancel in between) is invalid.

        const orderTxRes = await client.query(`
          SELECT * FROM his_db.stock_transactions 
          WHERE source_id = $1 
          ORDER BY id ASC
      `, [order.source_id]);

        const orderTx = orderTxRes.rows;
        const processingTx = orderTx.filter(t => t.transaction_type === 'order_processing');

        if (processingTx.length <= 1) continue; // Should have been caught by HAVING > 1, but safety check.

        // Check Contiguity
        // We expect: Processing, Processing, Processing... 
        // with NO other types in between them.

        let firstProcessingIdx = orderTx.findIndex(t => t.id === processingTx[0].id);
        let lastProcessingIdx = orderTx.findIndex(t => t.id === processingTx[processingTx.length - 1].id);

        // Check if all transactions between first and last are 'order_processing'
        let isContiguous = true;
        for (let i = firstProcessingIdx; i <= lastProcessingIdx; i++) {
            if (orderTx[i].transaction_type !== 'order_processing') {
                isContiguous = false;
                break;
            }
        }

        if (!isContiguous) {
            console.warn(`⚠️ Order #${order.source_id} duplicates are NOT contiguous! Skipping manual review.`);
            // Log what was found
            console.log(orderTx.map(t => `${t.id}:${t.transaction_type}`).join(' -> '));
            continue;
        }

        // Safe to delete all but first
        const toKeep = processingTx[0];
        const toDelete = processingTx.slice(1);
        const idsToDelete = toDelete.map(t => t.id);

        console.log(`Deleting ${idsToDelete.length} duplicates: [${idsToDelete.join(', ')}]`);

        await client.query(`DELETE FROM his_db.stock_transactions WHERE id = ANY($1)`, [idsToDelete]);

        // Recalculate Running Balances for SKU
        // We need to fetch ALL transactions for this SKU that came AFTER the first deleted ID
        // and re-run the ledger logic.

        const minDeletedId = Math.min(...idsToDelete);
        console.log(`Recalculating SKU ${order.sku} from ID ${minDeletedId}...`);

        const skuTxRes = await client.query(`
          SELECT * FROM his_db.stock_transactions 
          WHERE sku = $1 AND id > $2
          ORDER BY id ASC
      `, [order.sku, minDeletedId]); // Actually we need the state before minDeletedId to start?
        // No, we need the state of the tx just before the first recalculation target?
        // Actually, since we deleted rows, the "previous state" for the NEXT row (the one after deleted block)
        // should be the state of 'toKeep' (or whatever was before it).

        // We need to iterate through all subsequent transactions and fix their _before/_after.

        // Get the stable state from the LAST valid transaction before the deleted block.
        // Since toKeep is valid and is < minDeletedId (it was the first one), 
        // we can just fetch everything `WHERE id >= toKeep.id`? 
        // No, `toKeep` is already correct. We don't need to change it.
        // We need to fix everything AFTER `toKeep.id`. 
        // (Wait, are there other transactions between `toKeep` and `toDelete[0]`?
        // Checks above said "Contiguous". So for THIS order, no.
        // But for the SKU, there might be other orders' transactions in between!)

        // IF there are other transactions mixed in between the duplicates, 
        // then simply "deleting" duplicates changes the running balance for those mixed-in transactions too.
        // So yes, we must recalculate everything after `toKeep.id`.

        const subsequentTxRes = await client.query(`
          SELECT * FROM his_db.stock_transactions 
          WHERE sku = $1 AND id > $2
          ORDER BY id ASC
      `, [order.sku, toKeep.id]);

        let currentState = {
            in_warehouse: parseFloat(toKeep.in_warehouse_after),
            processing: parseFloat(toKeep.processing_after),
            pending_consult: parseFloat(toKeep.pending_consult_after),
            pending_review: parseFloat(toKeep.pending_review_after),
            stock: parseFloat(toKeep.stock_after),
            pending: parseFloat(toKeep.pending_after)
            // backorder derived
        };

        for (let tx of subsequentTxRes.rows) {
            // Calculate changes based on tx type and known delta logic, OR trust the stored delta?
            // Most transactions store 'quantity_change' for stuck.
            // But `processing` change is implicit in type.

            let procChange = 0;
            let pendConsultChange = 0;
            let pendReviewChange = 0;
            let warehouseChange = 0;

            // Logic mapping
            switch (tx.transaction_type) {
                case 'order_processing':
                    // pending -> processing
                    // But WHERE did it come from? consult or review?
                    // We can look at `pending_consult_before` vs `pending_consult_after` in the record to infer?
                    // Yes, preserve the DELTA from the record.
                    procChange = parseFloat(tx.processing_after) - parseFloat(tx.processing_before);
                    pendConsultChange = parseFloat(tx.pending_consult_after) - parseFloat(tx.pending_consult_before);
                    pendReviewChange = parseFloat(tx.pending_review_after) - parseFloat(tx.pending_review_before);
                    warehouseChange = parseFloat(tx.quantity_change) || 0;
                    break;

                case 'order_pending_consult':
                case 'order_pending_review':
                case 'order_nv_pending_pickup':
                case 'order_cancelled':
                case 'order_completed':
                case 'manual_add':
                case 'manual_subtract':
                case 'manual_set': // manual_set is special (absolute).
                case 'reconciliation': // reconciliation is special.
                    // For all types, we should try to preserve the INTENDED CHANGE.
                    // Calculate the delta from the stored record.
                    procChange = parseFloat(tx.processing_after) - parseFloat(tx.processing_before);
                    pendConsultChange = parseFloat(tx.pending_consult_after) - parseFloat(tx.pending_consult_before);
                    pendReviewChange = parseFloat(tx.pending_review_after) - parseFloat(tx.pending_review_before);
                    warehouseChange = parseFloat(tx.in_warehouse_after) - parseFloat(tx.in_warehouse_before);
                    break;
            }

            // Special handling for absolute setters:
            if (tx.transaction_type === 'manual_set' || tx.transaction_type === 'reconciliation') {
                // These might be absolute resets. 
                // Check if they were intended as absolute values or corrections.
                // If absolute value (e.g. "Set stock to 10"), we should respect that?
                // The user wants "processing" to be correct.
                // If a reconciliation set processing to X, it might have been confirming the INFLATED value.
                // So we should probably treat them as deltas too? 
                // Or if they explicitly set a value, maybe we should stop recalculating?
                // But usually reconciliation is used to FIX counts. 
                // If we fix the history, the reconciliation might be redundant or wrong.

                // Decision: Treat everything as DELTA.
                // If ID 695 (the one I deleted) was reconciliation, I already handled it.
                // For other reconciliations, assume they were valid adjustments relative to that time.
            }

            // Apply Delta to Current Running State
            const before = { ...currentState };

            currentState.processing += procChange;
            currentState.pending_consult += pendConsultChange;
            currentState.pending_review += pendReviewChange;
            currentState.in_warehouse += warehouseChange;
            currentState.stock = currentState.in_warehouse; // usually
            currentState.pending = currentState.pending_consult + currentState.pending_review;

            // Recalculate backorder
            const backorderBefore = Math.max(0, (before.pending_consult + before.pending_review + before.processing) - before.in_warehouse);
            const backorderAfter = Math.max(0, (currentState.pending_consult + currentState.pending_review + currentState.processing) - currentState.in_warehouse);

            // Update DB
            await client.query(`
              UPDATE his_db.stock_transactions
              SET 
                 processing_before = $1, processing_after = $2,
                 pending_consult_before = $3, pending_consult_after = $4,
                 pending_review_before = $5, pending_review_after = $6,
                 in_warehouse_before = $7, in_warehouse_after = $8,
                 stock_before = $9, stock_after = $10,
                 pending_before = $11, pending_after = $12,
                 backorder_before = $13, backorder_after = $14
              WHERE id = $15
          `, [
                before.processing, currentState.processing,
                before.pending_consult, currentState.pending_consult,
                before.pending_review, currentState.pending_review,
                before.in_warehouse, currentState.in_warehouse,
                before.in_warehouse, currentState.in_warehouse,
                before.pending, currentState.pending,
                backorderBefore, backorderAfter,
                tx.id
            ]);
        }
        console.log(`Recalculated ${subsequentTxRes.rows.length} transactions.`);
    }

    await client.query('COMMIT');
    console.log('🎉 Duplicates cleanup complete.');

} catch (e) {
    console.error('❌ Error:', e);
    await client.query('ROLLBACK');
} finally {
    await client.end();
}
