import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getStockTransactions } from '@/lib/db/queries';
import { query } from '@/lib/db/connection';

/**
 * Calculate backorder for a SKU at a specific point in time
 * Backorder = max(0, total pending orders quantity - available stock)
 * Updated to use new status columns
 */
async function getBackorderAtTimestamp(sku: string, timestamp: string): Promise<number> {
    const result = await query(`
        WITH stock_at_time AS (
            SELECT 
                in_warehouse_after as in_warehouse,
                processing_after as processing,
                pending_consult_after as pending_consult,
                pending_review_after as pending_review
            FROM "his_db".stock_transactions
            WHERE sku = $1
            AND created_at <= $2::timestamp
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        ),
        back_order_calc AS (
            SELECT 
                COALESCE((SELECT in_warehouse FROM stock_at_time), 0) as in_warehouse,
                COALESCE((SELECT processing FROM stock_at_time), 0) as processing,
                COALESCE((SELECT pending_consult FROM stock_at_time), 0) as pending_consult,
                COALESCE((SELECT pending_review FROM stock_at_time), 0) as pending_review
        )
        SELECT 
            COALESCE((SELECT backorder_after FROM "his_db".stock_transactions
                WHERE sku = $1
                AND created_at <= $2::timestamp
                ORDER BY created_at DESC, id DESC
                LIMIT 1), 0) as back_order
        FROM back_order_calc
    `, [sku, timestamp]);
    
    return result.rows.length > 0 ? (result.rows[0].back_order || 0) : 0;
}

export async function GET(
    req: NextRequest,
    { params }: { params: { orderId: string } }
) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const orderId = parseInt(params.orderId);
        if (isNaN(orderId)) {
            return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
        }

        // Get all pending transactions for this order (to check if processing should be ignored)
        const pendingTransactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_pending_consult' // Also check for order_pending_review
        });
        
        // Also get pending-review transactions
        const pendingReviewTransactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_pending_review'
        });
        
        const allPendingTransactions = [...pendingTransactions, ...pendingReviewTransactions];
        
        // Get the earliest pending transaction timestamp (if any)
        const earliestPendingTime = allPendingTransactions.length > 0
            ? Math.min(...allPendingTransactions.map((tx: any) => new Date(tx.created_at).getTime()))
            : null;
        
        // Get all processing transactions for this order
        const allProcessingTransactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_processing'
        });
        
        // Filter processing transactions:
        // Rule: If there's a pending event, ignore any processing that comes BEFORE the pending (WC glitch)
        //       If there's NO pending event (order goes straight to processing), show the first processing event
        let validProcessingTransactions = allProcessingTransactions;
        
        if (earliestPendingTime !== null) {
            // Order has pending event(s) - only keep processing transactions that come AFTER the pending
            // This filters out glitchy WC webhooks where processing fires before pending
            validProcessingTransactions = allProcessingTransactions.filter((tx: any) => 
                new Date(tx.created_at).getTime() >= earliestPendingTime
            );
        }
        // If earliestPendingTime is null (no pending events), allProcessingTransactions are valid
        // This handles orders that go straight to processing without consultation/review
        
        // Get the first valid processing transaction (earliest timestamp)
        const processingTransactions = validProcessingTransactions.length > 0 
            ? [validProcessingTransactions.sort((a: any, b: any) => 
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )[0]]
            : [];

        // Get all other transaction types for this order
        const nvPendingPickupTransactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_nv_pending_pickup'
        });

        const cancelledTransactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_cancelled'
        });

        // Combine all transactions, sorted by timestamp
        const allTransactions = [
            ...allPendingTransactions,
            ...processingTransactions,
            ...nvPendingPickupTransactions,
            ...cancelledTransactions
        ].sort((a: any, b: any) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        // Format as component deductions with backorder
        const componentDeductions = await Promise.all(allTransactions.map(async (tx: any) => {
            const backorderBefore = await getBackorderAtTimestamp(tx.sku, tx.created_at);
            // For backorderAfter, we need to calculate it after the transaction
            // We'll use a slightly later timestamp to account for the transaction
            const afterTimestamp = new Date(new Date(tx.created_at).getTime() + 1000).toISOString();
            const backorderAfter = await getBackorderAtTimestamp(tx.sku, afterTimestamp);
            
            // Calculate available_for_purchase (before and after)
            const inWarehouseBefore = tx.in_warehouse_before ?? tx.stock_before ?? 0;
            const inWarehouseAfter = tx.in_warehouse_after ?? tx.stock_after ?? 0;
            const processingBefore = tx.processing_before ?? 0;
            const processingAfter = tx.processing_after ?? 0;
            const pendingConsultBefore = tx.pending_consult_before ?? 0;
            const pendingConsultAfter = tx.pending_consult_after ?? 0;
            const pendingReviewBefore = tx.pending_review_before ?? 0;
            const pendingReviewAfter = tx.pending_review_after ?? 0;
            
            // Calculate available_for_purchase: in_warehouse - pending_consult - pending_review - processing
            const availableForPurchaseBefore = Math.max(0, inWarehouseBefore - pendingConsultBefore - pendingReviewBefore - processingBefore);
            const availableForPurchaseAfter = Math.max(0, inWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);
            
            return {
                sku: tx.sku,
                transactionType: tx.transaction_type,
                sourceEvent: tx.source_event,
                // New fields (all 6 statuses)
                inWarehouseBefore,
                inWarehouseAfter,
                processingBefore,
                processingAfter,
                pendingConsultBefore,
                pendingConsultAfter,
                pendingReviewBefore,
                pendingReviewAfter,
                backorderBefore,
                backorderAfter,
                availableForPurchaseBefore,
                availableForPurchaseAfter,
                availableForPurchase: availableForPurchaseAfter, // Legacy field for backward compatibility
                // Legacy fields (for backward compatibility)
                stockBefore: tx.stock_before ?? inWarehouseAfter,
                stockAfter: tx.stock_after ?? inWarehouseAfter,
                pendingBefore: tx.pending_before ?? (pendingConsultAfter + pendingReviewAfter),
                pendingAfter: tx.pending_after ?? (pendingConsultAfter + pendingReviewAfter),
                quantityChange: tx.quantity_change,
                deductedQty: tx.details?.deductedQty || tx.details?.quantity || Math.abs(tx.quantity_change) || 0,
                wasFromPending: tx.details?.wasFromPending || false,
                wasFromPendingConsult: tx.details?.wasFromPendingConsult || false,
                wasFromPendingReview: tx.details?.wasFromPendingReview || false,
                isComboComponent: tx.details?.isComboComponent || false,
                createdAt: tx.created_at
            };
        }));

        return NextResponse.json({ 
            success: true,
            componentDeductions 
        });
    } catch (error) {
        console.error('Error fetching component deductions:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

