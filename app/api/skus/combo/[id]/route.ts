import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { query } from '@/lib/db/connection';
import { updateComboSku, deleteComboSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';

export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid SKU ID' }, { status: 400 });
        }

        const body = await req.json();
        const { name, description, woocommerceProductId, components, hidden, lowStockThreshold, emailAlertsEnabled } = body;

        // Get SKU before update for logging
        const skuResult = await query('SELECT * FROM "his_db".combo_skus WHERE id = $1', [id]);
        if (!skuResult.rows[0]) {
            return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
        }
        const skuBefore = skuResult.rows[0];

        // Update SKU
        const updatedSku = await updateComboSku(id, {
            name,
            description,
            woocommerceProductId,
            components,
            hidden,
            lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold === '' ? null : parseInt(lowStockThreshold)) : undefined,
            emailAlertsEnabled
        });

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_updated',
            entityType: 'combo_sku',
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
        console.error('Error updating combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const id = parseInt(params.id);
        if (isNaN(id)) {
            return NextResponse.json({ error: 'Invalid SKU ID' }, { status: 400 });
        }

        // Get SKU before deletion for logging
        const skuResult = await query('SELECT * FROM "his_db".combo_skus WHERE id = $1', [id]);
        if (!skuResult.rows[0]) {
            return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
        }

        // Delete SKU
        const deletedSku = await deleteComboSku(id);

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_deleted',
            entityType: 'combo_sku',
            entityId: id,
            details: { sku: deletedSku.sku, name: deletedSku.name },
            success: true
        });

        return NextResponse.json({ success: true, message: 'SKU deleted successfully' });
    } catch (error: any) {
        console.error('Error deleting combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
