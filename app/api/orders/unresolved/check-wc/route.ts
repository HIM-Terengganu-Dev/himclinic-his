import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import wooCommerce from '@/lib/services/woocommerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { orderIds } = body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: 'orderIds array is required' }, { status: 400 });
        }

        const orderIdsStr = orderIds.join(',');

        // Fetch all orders from WC at once
        const wcResponse = await wooCommerce.get('orders', {
            include: orderIdsStr,
            per_page: 100 // Max allowed by WC API
        });

        const wcOrders = wcResponse.data;
        const statuses: Record<number, string> = {};

        // Map order ID to status
        for (const order of wcOrders) {
            statuses[order.id] = order.status;
        }

        // For any orders requested but not returned by WC (maybe deleted)
        for (const id of orderIds) {
            if (!statuses[id]) {
                statuses[id] = 'not_found';
            }
        }

        return NextResponse.json({ success: true, statuses });
    } catch (error: any) {
        console.error('[POST /api/orders/unresolved/check-wc] Error:', error.response?.data || error.message);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
