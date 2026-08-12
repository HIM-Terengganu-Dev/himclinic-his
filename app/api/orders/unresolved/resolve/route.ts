import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { resolveOrderManually } from '@/lib/db/queries';

/**
 * POST /api/orders/unresolved/resolve
 * Manually resolves an unresolved order by inserting a reconciliation transaction
 * that zeroes out any held stock (processing, pending_consult, pending_review) for the order.
 * Admin/Dev only.
 *
 * Body: { orderId: number, reason?: string, resolutionType?: 'nv-pending-pickup' | 'cancelled' | 'refunded' }
 */
import { resolveSandboxOrder } from '@/lib/sandbox/sandboxOrders';

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { orderId, reason, resolutionType = 'nv-pending-pickup' } = body;
        const isSandbox = req.headers.get('x-sandbox-mode') === 'true' || body.isSandbox === true;

        if (!orderId || typeof orderId !== 'number') {
            return NextResponse.json({ error: 'orderId (number) is required' }, { status: 400 });
        }

        const validTypes = ['nv-pending-pickup', 'cancelled', 'refunded'];
        if (!validTypes.includes(resolutionType)) {
            return NextResponse.json({ error: 'Invalid resolutionType' }, { status: 400 });
        }

        if (isSandbox) {
            const result = resolveSandboxOrder(orderId, reason || 'Sandbox manual resolution', resolutionType);
            return NextResponse.json({ success: true, isSandbox: true, resolved: result });
        }

        const userId = (session.user as any)?.id;
        const result = await resolveOrderManually(orderId, reason || 'Manual resolution by admin', userId ?? null, resolutionType);

        return NextResponse.json({ success: true, resolved: result });
    } catch (error: any) {
        console.error('[POST /api/orders/unresolved/resolve] Error:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
