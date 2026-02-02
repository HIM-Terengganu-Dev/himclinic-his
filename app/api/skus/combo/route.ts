import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { createComboSku, getSingleSkuByCode, getAllComboSkusAdmin, createSingleSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdmin(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const skus = await getAllComboSkusAdmin();
        return NextResponse.json({ skus });
    } catch (error) {
        console.error('Error fetching combo SKUs:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await requireAdmin(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sku, name, description, components, woocommerceProductId } = body;
        // components: [{ sku: 'him1', quantity: 3 }, ...]

        if (!sku || !name || !components || !Array.isArray(components) || components.length === 0) {
            return NextResponse.json({ error: 'SKU, Name, and Components are required' }, { status: 400 });
        }

        // Validate components exist
        for (const comp of components) {
            const existing = await getSingleSkuByCode(comp.sku);
            if (!existing) {
                return NextResponse.json({ error: `Component SKU ${comp.sku} does not exist.` }, { status: 400 });
            }
        }

        // Create in DB (WooCommerce product ID must be provided manually or set to null)
        // Note: We no longer create products in WooCommerce via API
        
        const newSku = await createComboSku({
            sku,
            name,
            woocommerceProductId: woocommerceProductId || null, // Can be set manually if needed
            components,
            description,
            createdBy: session.user.id
        });

        // Log Activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_created',
            entityType: 'combo_sku',
            entityId: newSku.id,
            details: { sku, name, woocommerceProductId: newSku.woocommerce_product_id, components },
            success: true
        });

        return NextResponse.json({ success: true, sku: newSku });
    } catch (error) {
        console.error('Error creating combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
