import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getWcWebhookLogs } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get('limit') || '20');
        const offset = parseInt(searchParams.get('offset') || '0');
        const webhookType = searchParams.get('type') as 'order' | 'product' | undefined;
        const webhookEvent = searchParams.get('event') || undefined;
        const entitySku = searchParams.get('sku') || undefined;
        const dateFrom = searchParams.get('dateFrom') || undefined;
        const dateTo = searchParams.get('dateTo') || undefined;

        const logs = await getWcWebhookLogs({
            webhookType,
            webhookEvent,
            limit,
            offset,
            entitySku,
            dateFrom,
            dateTo
        });

        return NextResponse.json({ logs });
    } catch (error) {
        console.error('Error fetching webhook logs:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

