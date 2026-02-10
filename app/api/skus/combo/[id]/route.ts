import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { query } from '@/lib/db/connection';
import { updateComboSku, deleteComboSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';
import { deleteProduct } from '@/lib/services/woocommerce';

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

        // Get SKU before deletion for logging and to get WooCommerce Product ID
        const skuResult = await query('SELECT * FROM "his_db".combo_skus WHERE id = $1', [id]);
        if (!skuResult.rows[0]) {
            return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
        }
        const skuToDelete = skuResult.rows[0];
        const wcProductId = skuToDelete.woocommerce_product_id;

        // Step 1: Delete from WooCommerce first (if product ID exists)
        let wcDeleteSuccess = false;
        let wcDeleteError: string | null = null;
        if (wcProductId) {
            try {
                const result = await deleteProduct(wcProductId);
                if (result) {
                    wcDeleteSuccess = true;
                    console.log(`✅ Deleted WooCommerce product ${wcProductId} for combo SKU ${skuToDelete.sku}`);
                } else {
                    wcDeleteError = 'WooCommerce returned unexpected response';
                    console.warn(`⚠️ WooCommerce deletion returned false for product ${wcProductId}`);
                }
            } catch (wcError: any) {
                // Check if product doesn't exist (404) - this is okay, product might already be deleted
                if (wcError.response?.status === 404 || wcError.message?.includes('404')) {
                    wcDeleteSuccess = true; // Treat as success since product doesn't exist
                    console.log(`ℹ️ WooCommerce product ${wcProductId} not found (may already be deleted)`);
                } else {
                    wcDeleteError = wcError.message || 'Unknown error';
                    console.error(`❌ Failed to delete WooCommerce product ${wcProductId}:`, wcError);
                }
            }
        } else {
            // No WooCommerce product ID, skip WC deletion
            wcDeleteSuccess = true;
        }

        // Step 2: Delete SKU from HIS (always proceed, even if WC deletion had issues)
        let deletedSku;
        try {
            deletedSku = await deleteComboSku(id);
        } catch (hisError: any) {
            console.error(`❌ Failed to delete combo SKU from HIS:`, hisError);
            return NextResponse.json({ 
                error: `Failed to delete combo SKU from HIS: ${hisError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_deleted',
            entityType: 'combo_sku',
            entityId: id,
            details: { 
                sku: deletedSku.sku, 
                name: deletedSku.name,
                woocommerceProductId: wcProductId,
                wcProductDeleted: wcDeleteSuccess,
                wcDeleteError: wcDeleteError
            },
            success: true
        });

        // Return success message based on WC deletion status
        if (wcDeleteSuccess) {
            return NextResponse.json({ 
                success: true, 
                message: 'SKU deleted successfully from both HIS and WooCommerce' 
            });
        } else {
            return NextResponse.json({ 
                success: true, 
                message: `SKU deleted from HIS, but WooCommerce deletion failed: ${wcDeleteError}`,
                warning: `WooCommerce product ${wcProductId} may still exist`
            });
        }
    } catch (error: any) {
        console.error('Error deleting combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
