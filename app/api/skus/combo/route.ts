import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { createComboSku, getSingleSkuByCode, getAllComboSkus, createSingleSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';
import { createProduct } from '@/lib/services/woocommerce';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdmin();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const skus = await getAllComboSkus();
        return NextResponse.json({ skus });
    } catch (error) {
        console.error('Error fetching combo SKUs:', error);
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
        const { sku, name, description, components } = body;
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

        // Create in WooCommerce
        let wcProductId: number;
        try {
            const product = await createProduct({
                name,
                type: 'simple', // Or 'grouped'? Usually we treat combos as simple products that we manually manage stock for.
                sku,
                regular_price: '0',
                manage_stock: true,
                stock_quantity: 0,
                description: description + '\n\nComponents:\n' + components.map((c: any) => `- ${c.quantity}x ${c.sku}`).join('\n')
            });
            wcProductId = product.id;
        } catch (wcError) {
            console.error('Failed to create WooCommerce product:', wcError);
            return NextResponse.json({ error: 'Failed to create product in WooCommerce' }, { status: 502 });
        }

        // Create in DB
        const newSku = await createComboSku({
            sku,
            name,
            woocommerceProductId: wcProductId,
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
            details: { sku, name, wcProductId, components },
            success: true
        });

        return NextResponse.json({ success: true, sku: newSku });
    } catch (error) {
        console.error('Error creating combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
