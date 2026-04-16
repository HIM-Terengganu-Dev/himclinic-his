import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev, requireAuth } from '@/lib/auth/middleware';
import { createSingleSku, getSingleSkuByCode, getAllSingleSkusAdmin, updateSingleSku, deleteSingleSku, createStockTransaction } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';
import { createProduct, deleteProduct, updateProductStock } from '@/lib/services/woocommerce';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
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
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sku, name, description, countInitialization } = body;

        if (!sku || !name) {
            return NextResponse.json({ error: 'SKU and Name are required' }, { status: 400 });
        }

        // Check if SKU exists
        const existing = await getSingleSkuByCode(sku);
        if (existing) {
            return NextResponse.json({ error: 'SKU already exists' }, { status: 400 });
        }

        const initialCount = parseInt(countInitialization) || 0;
        let wcProductId: number | null = null;
        let wcProductCreated = false;

        // Step 1: Create product in WooCommerce first
        try {
            const wcProduct = await createProduct({
                name,
                type: 'simple',
                sku,
                manage_stock: true,
                stock_quantity: initialCount,
                stock_status: initialCount > 0 ? 'instock' : 'outofstock',
                status: 'publish',
                regular_price: '0', // Default price, can be updated later
                description: description || '',
            });
            wcProductId = wcProduct.id;
            wcProductCreated = true;
            console.log(`✅ Created WooCommerce product for SKU ${sku}: Product ID ${wcProductId}`);
        } catch (wcError: any) {
            console.error('❌ Failed to create WooCommerce product:', wcError);
            return NextResponse.json({ 
                error: `Failed to create product in WooCommerce: ${wcError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Step 2: Create in HIS database
        let newSku;
        try {
            newSku = await createSingleSku({
                sku,
                name,
                woocommerceProductId: wcProductId,
                description,
                createdBy: session.user.id
            });
            console.log(`✅ Created HIS SKU ${sku}: ID ${newSku.id}`);
        } catch (hisError: any) {
            console.error('❌ Failed to create HIS SKU:', hisError);
            // Rollback: Delete WooCommerce product if we created it
            if (wcProductCreated && wcProductId) {
                try {
                    await deleteProduct(wcProductId);
                    console.log(`🔄 Rolled back: Deleted WooCommerce product ${wcProductId}`);
                } catch (rollbackError) {
                    console.error('⚠️ Failed to rollback WooCommerce product:', rollbackError);
                }
            }
            return NextResponse.json({ 
                error: `Failed to create SKU in HIS: ${hisError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Step 3: Create initial stock transaction
        try {
            await createStockTransaction({
                sku,
                singleSkuId: newSku.id,
                transactionType: 'manual_set',
                quantityChange: initialCount,
                inWarehouseBefore: 0,
                inWarehouseAfter: initialCount,
                processingBefore: 0,
                processingAfter: 0,
                pendingConsultBefore: 0,
                pendingConsultAfter: 0,
                pendingReviewBefore: 0,
                pendingReviewAfter: 0,
                backorderBefore: 0,
                backorderAfter: 0,
                sourceType: 'sku_creation',
                sourceId: newSku.id,
                createdBy: session.user.id,
                details: {
                    operation: 'initial_setup',
                    initialCount,
                    woocommerceProductId: wcProductId
                }
            });
            console.log(`✅ Created initial stock transaction for ${sku}: ${initialCount}`);

            // Stock is already set during product creation, but sync to ensure consistency
            try {
                await updateProductStock(wcProductId!, initialCount);
                console.log(`✅ Synced initial stock to WooCommerce for ${sku}`);
            } catch (syncError) {
                console.warn('⚠️ Failed to sync initial stock to WooCommerce:', syncError);
                // Don't fail the entire operation if sync fails
            }
        } catch (stockError: any) {
            console.error('❌ Failed to create initial stock transaction:', stockError);
            // Rollback: Delete both HIS SKU and WooCommerce product
            try {
                await deleteSingleSku(newSku.id);
                console.log(`🔄 Rolled back: Deleted HIS SKU ${newSku.id}`);
            } catch (rollbackError) {
                console.error('⚠️ Failed to rollback HIS SKU:', rollbackError);
            }
            if (wcProductCreated && wcProductId) {
                try {
                    await deleteProduct(wcProductId);
                    console.log(`🔄 Rolled back: Deleted WooCommerce product ${wcProductId}`);
                } catch (rollbackError) {
                    console.error('⚠️ Failed to rollback WooCommerce product:', rollbackError);
                }
            }
            return NextResponse.json({ 
                error: `Failed to initialize stock: ${stockError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Log Activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_created',
            entityType: 'single_sku',
            entityId: newSku.id,
            details: { 
                sku, 
                name, 
                woocommerceProductId: wcProductId,
                initialCount,
                wcProductCreated
            },
            success: true
        });

        return NextResponse.json({ 
            success: true, 
            sku: newSku,
            woocommerceProductId: wcProductId,
            initialCount
        });
    } catch (error) {
        console.error('Error creating single SKU:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
