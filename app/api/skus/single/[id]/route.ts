import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/connection';
import { updateSingleSku, deleteSingleSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid SKU ID' }, { status: 400 });
        }

        const body = await req.json();
        const { name, description, woocommerceProductId, hidden } = body;

        // Get SKU before update for logging
        const skuResult = await query('SELECT * FROM "his_db".single_skus WHERE id = $1', [id]);
        if (!skuResult.rows[0]) {
            return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
        }
        const skuBefore = skuResult.rows[0];

        // Update SKU
        const updatedSku = await updateSingleSku(id, {
            name,
            description,
            woocommerceProductId,
            hidden
        });

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_updated',
            entityType: 'single_sku',
            entityId: id,
            details: {
                sku: updatedSku.sku,
                before: { name: skuBefore.name, hidden: skuBefore.hidden || false },
                after: { name: updatedSku.name, hidden: updatedSku.hidden || false }
            },
            success: true
        });

        return NextResponse.json({ success: true, sku: updatedSku });
    } catch (error: any) {
        console.error('Error updating single SKU:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid SKU ID' }, { status: 400 });
        }

        // Get SKU before deletion for logging
        const skuResult = await query('SELECT * FROM "his_db".single_skus WHERE id = $1', [id]);
        if (!skuResult.rows[0]) {
            return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
        }

        // Delete SKU
        const deletedSku = await deleteSingleSku(id);

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_deleted',
            entityType: 'single_sku',
            entityId: id,
            details: { sku: deletedSku.sku, name: deletedSku.name },
            success: true
        });

        return NextResponse.json({ success: true, message: 'SKU deleted successfully' });
    } catch (error: any) {
        console.error('Error deleting single SKU:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
