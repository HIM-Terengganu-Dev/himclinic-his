import { NextRequest, NextResponse } from 'next/server';
import { requireAdminOrDev } from '@/lib/auth/middleware';
import { createComboSku, getSingleSkuByCode, getAllComboSkusAdmin, createSingleSku, getCurrentStockState, deleteComboSku } from '@/lib/db/queries';
import { logActivity } from '@/lib/db/queries';
import { createProduct, deleteProduct, updateProductStock } from '@/lib/services/woocommerce';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAdminOrDev(req);
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
        const session = await requireAdminOrDev(req);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { sku, name, description, components } = body;
        // components: [{ sku: 'him1', quantity: 3 }, ...]

        if (!sku || !name || !components || !Array.isArray(components) || components.length === 0) {
            return NextResponse.json({ error: 'SKU, Name, and Components are required' }, { status: 400 });
        }

        // Validate components exist and get their current stock
        const componentStockData: Array<{ sku: string; quantity: number; availableForPurchase: number }> = [];
        for (const comp of components) {
            const existing = await getSingleSkuByCode(comp.sku);
            if (!existing) {
                return NextResponse.json({ error: `Component SKU ${comp.sku} does not exist.` }, { status: 400 });
            }
            // Get current available stock for this component
            const stockState = await getCurrentStockState(comp.sku);
            componentStockData.push({
                sku: comp.sku,
                quantity: comp.quantity,
                availableForPurchase: stockState.availableForPurchase
            });
        }

        // Calculate initial count from components automatically
        // Minimum available combos = floor(min(component.availableForPurchase / component.quantity))
        const availableCombos = componentStockData.map(comp => 
            Math.floor(comp.availableForPurchase / comp.quantity)
        );
        const initialCount = Math.min(...availableCombos);
        console.log(`📊 Calculated initial count for combo ${sku} from components: ${initialCount}`);

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
            console.log(`✅ Created WooCommerce product for combo SKU ${sku}: Product ID ${wcProductId}`);
        } catch (wcError: any) {
            console.error('❌ Failed to create WooCommerce product:', wcError);
            return NextResponse.json({ 
                error: `Failed to create product in WooCommerce: ${wcError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Step 2: Create in HIS database
        let newSku;
        try {
            newSku = await createComboSku({
                sku,
                name,
                woocommerceProductId: wcProductId,
                components,
                description,
                createdBy: session.user.id
            });
            console.log(`✅ Created HIS combo SKU ${sku}: ID ${newSku.id}`);
        } catch (hisError: any) {
            console.error('❌ Failed to create HIS combo SKU:', hisError);
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
                error: `Failed to create combo SKU in HIS: ${hisError.message || 'Unknown error'}` 
            }, { status: 500 });
        }

        // Step 3: Sync initial stock to WooCommerce (combo SKUs don't have their own stock transactions)
        // Stock is already set during product creation, but sync to ensure consistency
        try {
            await updateProductStock(wcProductId!, initialCount);
            console.log(`✅ Synced initial stock to WooCommerce for combo ${sku}: ${initialCount}`);
        } catch (syncError) {
            console.warn('⚠️ Failed to sync initial stock to WooCommerce:', syncError);
            // Rollback: Delete both HIS combo SKU and WooCommerce product
            try {
                await deleteComboSku(newSku.id);
                console.log(`🔄 Rolled back: Deleted HIS combo SKU ${newSku.id}`);
            } catch (rollbackError) {
                console.error('⚠️ Failed to rollback HIS combo SKU:', rollbackError);
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
                error: `Failed to sync stock to WooCommerce: ${syncError instanceof Error ? syncError.message : 'Unknown error'}` 
            }, { status: 500 });
        }

        // Log Activity
        await logActivity({
            userId: session.user.id,
            action: 'sku_created',
            entityType: 'combo_sku',
            entityId: newSku.id,
            details: { 
                sku, 
                name, 
                woocommerceProductId: wcProductId,
                components,
                initialCount,
                calculatedFromComponents: true, // Always calculated from components for combo SKUs
                wcProductCreated
            },
            success: true
        });

        return NextResponse.json({ 
            success: true, 
            sku: newSku,
            woocommerceProductId: wcProductId,
            initialCount,
            calculatedFromComponents: true // Always calculated from components for combo SKUs
        });
    } catch (error) {
        console.error('Error creating combo SKU:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
