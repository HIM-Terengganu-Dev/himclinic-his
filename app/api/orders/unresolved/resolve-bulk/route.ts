import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { resolveOrderManually } from '@/lib/db/queries';

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { orderIds, reason, resolutionType = 'nv-pending-pickup' } = body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: 'orderIds array is required' }, { status: 400 });
        }

        const validTypes = ['nv-pending-pickup', 'cancelled'];
        if (!validTypes.includes(resolutionType)) {
            return NextResponse.json({ error: 'Invalid resolutionType. Allowed: nv-pending-pickup, cancelled' }, { status: 400 });
        }

        const userId = (session.user as any)?.id;
        const results = [];
        const errors = [];

        // Process sequentially to ensure database transaction integrity per order
        for (const orderId of orderIds) {
            if (typeof orderId !== 'number') continue;
            
            try {
                const result = await resolveOrderManually(
                    orderId, 
                    reason || `Bulk manual resolution by admin`, 
                    userId ?? null, 
                    resolutionType as 'nv-pending-pickup' | 'cancelled'
                );
                results.push({ orderId, resolved: result });
            } catch (err: any) {
                errors.push({ orderId, error: err.message });
            }
        }

        return NextResponse.json({ 
            success: true, 
            resolvedCount: results.length,
            errorCount: errors.length,
            results,
            errors 
        });
    } catch (error: any) {
        console.error('[POST /api/orders/unresolved/resolve-bulk] Error:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
