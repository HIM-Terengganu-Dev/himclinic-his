import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { investigateStockChangesBetweenOrders } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const sku = searchParams.get('sku');
        const orderId1 = searchParams.get('orderId1');
        const orderId2 = searchParams.get('orderId2');

        if (!sku || !orderId1 || !orderId2) {
            return NextResponse.json(
                { error: 'Missing required parameters: sku, orderId1, orderId2' },
                { status: 400 }
            );
        }

        const result = await investigateStockChangesBetweenOrders(
            sku,
            parseInt(orderId1),
            parseInt(orderId2)
        );

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Error investigating stock changes:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}

