import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getActivityLogs } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get('limit') || '20');
        const offset = parseInt(searchParams.get('offset') || '0');
        const type = searchParams.get('type') || undefined;
        const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId')!) : undefined;
        const sku = searchParams.get('sku') || undefined;
        const dateFrom = searchParams.get('dateFrom') || undefined;
        const dateTo = searchParams.get('dateTo') || undefined;

        const logs = await getActivityLogs({
            userId,
            limit,
            offset,
            type,
            sku,
            dateFrom,
            dateTo
        });

        return NextResponse.json({ logs });
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
