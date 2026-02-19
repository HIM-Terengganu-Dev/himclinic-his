/**
 * CLEANUP SCRIPT for Order 12388
 * 
 * Objectives:
 * 1. Delete the 4 duplicate 'order_processing' transactions (IDs: 590, 609, 627, 646)
 * 2. Delete the corrective 'reconciliation' transaction (ID: 695) created by the previous fix
 * 3. Update any intervening transactions (IDs > 590 and < 695) to have correct running balances
 *    - Specifically: processing count should be 1, not 5
 *    - Backorder should be recalculated
 */
import pg from 'pg';
const { Client } = pg;

const DDL = "postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require";
const client = new Client({ connectionString: DDL });
await client.connect();

const SKU = 'pri/6tab';
const ORDER_ID = 12388;

try {
    await client.query('BEGIN');

    // 1. Identify rows to delete
    // Duplicates are order_processing for this order created on Feb 18 (IDs > 549)
    const duplicates = await client.query(`
    SELECT id FROM his_db.stock_transactions
    WHERE sku = $1 
      AND source_id = $2 
      AND transaction_type = 'order_processing'
      AND id > 549
    ORDER BY id ASC
  `, [SKU, ORDER_ID]);

    const duplicateIds = duplicates.rows.map(r => r.id);
    console.log('Duplicate IDs to delete:', duplicateIds);

    // Identify corrective transaction
    const correction = await client.query(`
    SELECT id FROM his_db.stock_transactions
    WHERE sku = $1 
      AND source_id = $2 
      AND transaction_type = 'reconciliation'
  `, [SKU, ORDER_ID]);

    const correctionIds = correction.rows.map(r => r.id);
    console.log('Correction IDs to delete:', correctionIds);

    const allToDelete = [...duplicateIds, ...correctionIds];

    if (allToDelete.length === 0) {
        console.log('No rows to delete. Exiting.');
        await client.query('ROLLBACK');
        await client.end();
        process.exit(0);
    }

    // 2. Delete rows
    await client.query(`
    DELETE FROM his_db.stock_transactions
    WHERE id = ANY($1::int[])
  `, [allToDelete]);
    console.log(`Deleted ${allToDelete.length} rows.`);

    // 3. Fix subsequent transactions (running balances)
    // We need to fetch all transactions for this SKU ordered by ID, calculate correct running state, and update

    // Get all remaining transactions for this SKU
    const allTxs = await client.query(`
    SELECT * FROM his_db.stock_transactions
    WHERE sku = $1
    ORDER BY id ASC
  `, [SKU]);

    console.log(`Found ${allTxs.rows.length} total transactions for ${SKU}. Recalculating state...`);

    // Replay state from scratch to ensure absolute correctness
    let currentState = {
        in_warehouse: 0,
        processing: 0,
        pending_consult: 0,
        pending_review: 0,
        backorder: 0
    };

    for (const tx of allTxs.rows) {
        // Capture state BEFORE this transaction
        const beforeState = { ...currentState };

        // Apply change based on transaction type (or manual overrides in the row)
        // Actually, we should trust the 'quantity_change' and type logic, 
        // BUT we must trust the `quantity_change` from the row? 
        // No, standard transactions like order_processing usually have quantity_change=0 but update specific columns.
        // However, for manual_add/subtract/set, quantity_change is key.

        // Simplification: We only need to fix `processing` and `backorder` columns in the rows.
        // The `in_warehouse` logic likely wasn't corrupted (duplicates didn't change in_warehouse).
        // The `duplicates` inflated `processing` by +1 each.

        // Let's rely on the fact that `processing` should generally be stable unless the tx modifies it.
        // For `order_processing` (valid ones), processing increases.
        // For `order.nv-pending-pickup` (if we had one), processing decreases.
        // For manual txs, processing usually stays same.

        // Strategy: Re-calculate `processing` and `backorder` for every transaction based on its type.

        let processingChange = 0;
        let pendingConsultChange = 0;
        let pendingReviewChange = 0;
        let inWarehouseChange = 0;

        // Determine changes this transaction *intended* to make
        // Strategy: 
        // - For `reconciliation` and `manual_set`: These are state RESETs. We trust the row's `_after` values as the new truth.
        // - For `manual_add` / `manual_subtract`: These are explicit deltas. We trust their impact on the specific columns they touch (usually in_warehouse).
        // - For `order_*`: These move stock between columns. We calculated their delta above.

        const isResetType = ['reconciliation', 'manual_set'].includes(tx.transaction_type);
        const isManualDeltaType = ['manual_add', 'manual_subtract'].includes(tx.transaction_type);

        let afterState = { ...currentState };

        if (isResetType) {
            // RESET: Trust the row's endpoint
            afterState.in_warehouse = tx.in_warehouse_after;
            afterState.processing = tx.processing_after;
            afterState.pending_consult = tx.pending_consult_after;
            afterState.pending_review = tx.pending_review_after;
            // Backorder follows standard formula or trusted row? Trusted row for reset.
            afterState.backorder = tx.backorder_after;
        } else {
            // DELTA: Apply calculated changes
            if (tx.transaction_type === 'order_processing') {
                processingChange = tx.processing_after - tx.processing_before;
                pendingConsultChange = tx.pending_consult_after - tx.pending_consult_before;
                pendingReviewChange = tx.pending_review_after - tx.pending_review_before;
                inWarehouseChange = tx.in_warehouse_after - tx.in_warehouse_before;
            } else if (isManualDeltaType) {
                inWarehouseChange = tx.in_warehouse_after - tx.in_warehouse_before;
                processingChange = tx.processing_after - tx.processing_before;
                // Manuals might affect other columns too? Usually just in_warehouse.
                // Let's trust the delta in the row for all columns
                pendingConsultChange = tx.pending_consult_after - tx.pending_consult_before;
                pendingReviewChange = tx.pending_review_after - tx.pending_review_before;
            } else {
                // Other order types
                processingChange = tx.processing_after - tx.processing_before;
                pendingConsultChange = tx.pending_consult_after - tx.pending_consult_before;
                pendingReviewChange = tx.pending_review_after - tx.pending_review_before;
                inWarehouseChange = tx.in_warehouse_after - tx.in_warehouse_before;
            }

            afterState.in_warehouse += inWarehouseChange;
            afterState.processing += processingChange;
            afterState.pending_consult += pendingConsultChange;
            afterState.pending_review += pendingReviewChange;

            // Recalculate backorder
            afterState.backorder = Math.max(0,
                (afterState.pending_consult + afterState.pending_review + afterState.processing) - afterState.in_warehouse
            );
        }


        // Update row if different
        if (
            tx.processing_before !== currentState.processing ||
            tx.processing_after !== afterState.processing ||
            tx.backorder_before !== currentState.backorder ||
            tx.backorder_after !== afterState.backorder
        ) {
            console.log(`Updating Tx ${tx.id}: processing ${tx.processing_after} -> ${afterState.processing}`);

            await client.query(`
            UPDATE his_db.stock_transactions
            SET 
                processing_before = $1, processing_after = $2,
                backorder_before = $3, backorder_after = $4,
                in_warehouse_before = $5, in_warehouse_after = $6,
                pending_consult_before = $7, pending_consult_after = $8,
                pending_review_before = $9, pending_review_after = $10,
                stock_before = $11, stock_after = $12,
                pending_before = $13, pending_after = $14
            WHERE id = $15
        `, [
                currentState.processing, afterState.processing,
                currentState.backorder, afterState.backorder,
                currentState.in_warehouse, afterState.in_warehouse,
                currentState.pending_consult, afterState.pending_consult,
                currentState.pending_review, afterState.pending_review,
                currentState.in_warehouse, afterState.in_warehouse, // stock = in_warehouse
                (currentState.pending_consult + currentState.pending_review), (afterState.pending_consult + afterState.pending_review), // pending = sum
                tx.id
            ]);
        }

        // Advance state
        currentState = afterState;
    }

    console.log('Final State:', currentState);

    // Verify final state matches processing=1
    if (currentState.processing !== 1) {
        throw new Error(`Final processing count is ${currentState.processing}, expected 1! Rolling back.`);
    }

    await client.query('COMMIT');
    console.log('✅ Changes committed.');

} catch (e) {
    console.error('❌ Error:', e);
    await client.query('ROLLBACK');
} finally {
    await client.end();
}
