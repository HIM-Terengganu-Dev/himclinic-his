import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getStockTransactions } from '@/lib/db/queries';

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

        // Get all stock transactions for this order that are component deductions
        const transactions = await getStockTransactions({
            sourceType: 'order',
            sourceId: orderId,
            transactionType: 'order_processing'
        });

        // Format as component deductions
        const componentDeductions = transactions.map((tx: any) => ({
            sku: tx.sku,
            stockBefore: tx.stock_before,
            stockAfter: tx.stock_after,
            pendingBefore: tx.pending_before,
            pendingAfter: tx.pending_after,
            quantityChange: tx.quantity_change,
            deductedQty: tx.details?.deductedQty || Math.abs(tx.quantity_change) || 0,
            wasFromPending: tx.details?.wasFromPending || false,
            isComboComponent: tx.details?.isComboComponent || false,
            createdAt: tx.created_at
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

