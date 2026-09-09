import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { query } from '@/lib/db/connection';
import { updateComboSku, deleteComboSku, getSingleSkuByCode } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';
import { deleteProduct, updateProduct, syncStockToWooCommerce } from '@/lib/services/woocommerce';

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

        // Validate components if provided
        let validatedComponents: Array<{ sku: string; quantity: number }> | undefined = undefined;
        if (components !== undefined) {
            if (!Array.isArray(components) || components.length === 0) {
                return NextResponse.json({ error: 'At least one component is required for a combo SKU' }, { status: 400 });
            }

            validatedComponents = [];
            for (const comp of components) {
                if (!comp || !comp.sku || typeof comp.sku !== 'string' || !comp.sku.trim()) {
                    return NextResponse.json({ error: 'All components must have a valid SKU code' }, { status: 400 });
                }
                const trimmedSku = comp.sku.trim();
                const qty = parseInt(comp.quantity);
                if (isNaN(qty) || qty <= 0) {
                    return NextResponse.json({ error: `Invalid quantity for component "${trimmedSku}". Must be at least 1.` }, { status: 400 });
                }

                // Verify component SKU exists in single_skus
                const singleSku = await getSingleSkuByCode(trimmedSku);
                if (!singleSku) {
                    return NextResponse.json({ error: `Component SKU "${trimmedSku}" does not exist in single SKUs.` }, { status: 400 });
                }

                // Merge duplicates if same SKU was added multiple times
                const existingIndex = validatedComponents.findIndex(c => c.sku === trimmedSku);
                if (existingIndex >= 0) {
                    validatedComponents[existingIndex].quantity += qty;
                } else {
                    validatedComponents.push({ sku: trimmedSku, quantity: qty });
                }
            }

            if (validatedComponents.length === 0) {
                return NextResponse.json({ error: 'At least one valid component is required' }, { status: 400 });
            }
        }

        // Update SKU
        const updatedSku = await updateComboSku(id, {
            name,
            description,
            woocommerceProductId,
            components: validatedComponents,
            hidden,
            lowStockThreshold: lowStockThreshold !== undefined ? (lowStockThreshold === '' ? null : parseInt(lowStockThreshold)) : undefined,
            emailAlertsEnabled
        });

        // Sync stock to WooCommerce if components changed
        let wcSyncSuccess = false;
        let wcSyncError: string | null = null;
        if (validatedComponents !== undefined) {
            try {
                wcSyncSuccess = await syncStockToWooCommerce(updatedSku.sku);
                console.log(`✅ Synced updated combo SKU ${updatedSku.sku} stock to WooCommerce: ${wcSyncSuccess}`);
            } catch (syncErr: any) {
                console.warn(`⚠️ Failed to sync combo SKU ${updatedSku.sku} to WooCommerce:`, syncErr);
                wcSyncError = syncErr.message || 'WooCommerce stock sync failed';
            }
        }

        // Sync name/description to WooCommerce if product ID exists and fields changed
        const wcProductId = updatedSku.woocommerce_product_id;
        if (wcProductId && (name !== undefined || description !== undefined)) {
            try {
                const wcUpdate: any = {};
                if (name !== undefined && name.trim()) wcUpdate.name = name.trim();
                if (description !== undefined) wcUpdate.description = description;
                if (Object.keys(wcUpdate).length > 0) {
                    await updateProduct(wcProductId, wcUpdate);
                    console.log(`✅ Updated WooCommerce product ${wcProductId} metadata for combo SKU ${updatedSku.sku}`);
                }
            } catch (wcMetaErr) {
                console.warn(`⚠️ Could not sync metadata to WooCommerce product ${wcProductId}:`, wcMetaErr);
            }
        }

        // Log activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_updated',
            entityType: 'combo_sku',
            entityId: id,
            details: {
                sku: updatedSku.sku,
                before: {
                    name: skuBefore.name,
                    hidden: skuBefore.hidden || false,
                    components: skuBefore.components,
                    low_stock_threshold: skuBefore.low_stock_threshold,
                    email_alerts_enabled: skuBefore.email_alerts_enabled
                },
                after: {
                    name: updatedSku.name,
                    hidden: updatedSku.hidden || false,
                    components: updatedSku.components,
                    low_stock_threshold: updatedSku.low_stock_threshold,
                    email_alerts_enabled: updatedSku.email_alerts_enabled
                },
                wcSyncSuccess,
                wcSyncError
            },
            success: true
        });

        return NextResponse.json({ success: true, sku: updatedSku, wcSynced: wcSyncSuccess });
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
