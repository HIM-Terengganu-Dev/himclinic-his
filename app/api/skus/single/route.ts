import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { createSingleSku, getSingleSkuByCode, getAllSingleSkusAdmin } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdmin();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const skus = await getAllSingleSkusAdmin();
        return NextResponse.json({ skus });
    } catch (error) {
        console.error('Error fetching single SKUs:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdmin();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sku, name, description } = body;

        if (!sku || !name) {
            return NextResponse.json({ error: 'SKU and Name are required' }, { status: 400 });
        }

        // Check if SKU exists
        const existing = await getSingleSkuByCode(sku);
        if (existing) {
            return NextResponse.json({ error: 'SKU already exists' }, { status: 400 });
        }

        // Create in DB (WooCommerce product ID must be provided manually or set to null)
        // Note: We no longer create products in WooCommerce via API
        const body = await req.json();
        const { woocommerceProductId } = body;
        
        const newSku = await createSingleSku({
            sku,
            name,
            woocommerceProductId: woocommerceProductId || null, // Can be set manually if needed
            description,
            createdBy: session.user.id
        });

        // Log Activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_created',
            entityType: 'single_sku',
            entityId: newSku.id,
            details: { sku, name, woocommerceProductId: newSku.woocommerce_product_id },
            success: true
        });

        return NextResponse.json({ success: true, sku: newSku });
    } catch (error) {
        console.error('Error creating single SKU:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
