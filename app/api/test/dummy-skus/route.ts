import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getDummySingleSkus, getDummyComboSkus } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Get only dummy SKUs for test environment
 */
export async function GET(request: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only allow dev role to use test endpoint
        if (session.user?.role !== 'dev') {
            return NextResponse.json({ error: 'Forbidden: Dev access required' }, { status: 403 });
        }

        const [singleSkus, comboSkus] = await Promise.all([
            getDummySingleSkus(),
            getDummyComboSkus()
        ]);

        return NextResponse.json({
            success: true,
            singleSkus,
            comboSkus
        });
    } catch (error: any) {
        console.error('Error fetching dummy SKUs:', error);
        return NextResponse.json({ 
            error: 'Internal server error',
            message: error.message || 'Failed to fetch dummy SKUs'
        }, { status: 500 });
    }
}
