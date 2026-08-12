import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { getUnresolvedOrders } from '@/lib/db/queries';

/**
 * GET /api/orders/unresolved
 * Returns orders that entered the system on or after 2026-03-03 and have NOT yet exited
 * (i.e. still have stock held in pending-consult, pending-review, or processing).
 * Admin/Dev only.
 */
import { getSandboxOrders } from '@/lib/sandbox/sandboxOrders';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const isSandbox = req.headers.get('x-sandbox-mode') === 'true' || req.nextUrl.searchParams.get('sandbox') === 'true';
        if (isSandbox) {
            return NextResponse.json({ success: true, isSandbox: true, orders: getSandboxOrders() });
        }

        const orders = await getUnresolvedOrders();
        return NextResponse.json({ success: true, orders });
    } catch (error: any) {
        console.error('[GET /api/orders/unresolved] Error:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
