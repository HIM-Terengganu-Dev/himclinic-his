import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getComboSkuByCode, getDummyComboSkus } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Get combo SKU details including components (for test environment)
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

        const sku = request.nextUrl.searchParams.get('sku');
        if (!sku) {
            return NextResponse.json({ error: 'SKU parameter is required' }, { status: 400 });
        }

        // Get combo SKU details
        const comboSku = await getComboSkuByCode(sku);
        if (!comboSku) {
            return NextResponse.json({ error: 'Combo SKU not found' }, { status: 404 });
        }

        // Verify it's a dummy SKU (for test environment safety)
        const dummyCombos = await getDummyComboSkus();
        const isDummySku = dummyCombos.some((c: any) => c.sku === sku);
        if (!isDummySku) {
            return NextResponse.json({ error: 'Only dummy SKUs are allowed in test environment' }, { status: 403 });
        }

        // Parse components
        const components = Array.isArray(comboSku.components) 
            ? comboSku.components 
            : JSON.parse(comboSku.components || '[]');

        return NextResponse.json({
            success: true,
            sku: comboSku.sku,
            name: comboSku.name,
            components: components.map((comp: any) => ({
                sku: comp.sku,
                quantity: comp.quantity,
                name: comp.name || comp.sku
            }))
        });
    } catch (error: any) {
        console.error('Error fetching combo details:', error);
        return NextResponse.json({ 
            error: 'Internal server error',
            message: error.message || 'Failed to fetch combo details'
        }, { status: 500 });
    }
}
