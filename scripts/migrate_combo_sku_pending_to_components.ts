/**
 * Migration Script: Convert Combo SKU Pending Entries to Component Entries
 * 
 * This script converts old pending_consultation_stock entries that track combo SKUs
 * to component SKU entries. This ensures:
 * 1. Dashboard shows correct pending indicator (71+1 instead of 72+1)
 * 2. Processing logic works consistently
 * 3. Component stocks are deducted immediately (matching new behavior)
 * 
 * Usage:
 *   npx tsx scripts/migrate_combo_sku_pending_to_components.ts
 * 
 * IMPORTANT: This script will:
 * - Deduct component stocks in WooCommerce (to match new behavior)
 * - Convert combo SKU entries to component entries
 * - Delete old combo SKU entries
 * 
 * Review the changes before running!
 */

import { query } from '../lib/db/connection';
import { getAllComboSkus, getAllSingleSkus, addPendingConsultationStock, removePendingConsultationStock } from '../lib/db/queries';
import { getProduct, updateProductStock } from '../lib/services/woocommerce';

async function migrateComboSkuPendingToComponents() {
    console.log('🔄 Starting migration: Convert combo SKU pending entries to component entries...\n');

    try {
        // Step 1: Get all combo SKU entries from pending_consultation_stock
        const comboEntriesResult = await query(`
            SELECT pcs.id, pcs.order_id, pcs.sku as combo_sku, pcs.quantity, pcs.status, pcs.created_at
            FROM inventory_management.pending_consultation_stock pcs
            WHERE EXISTS (
                SELECT 1 
                FROM inventory_management.combo_skus cs 
                WHERE cs.sku = pcs.sku
            )
            ORDER BY pcs.order_id, pcs.sku
        `);

        const comboEntries = comboEntriesResult.rows;
        console.log(`Found ${comboEntries.length} combo SKU entries to migrate\n`);

        if (comboEntries.length === 0) {
            console.log('✅ No combo SKU entries found. Migration not needed.');
            return;
        }

        // Step 2: Get combo SKU definitions and single SKU mappings
        const [allCombos, allSingleSkus] = await Promise.all([
            getAllComboSkus(),
            getAllSingleSkus()
        ]);

        const comboSkuMap = new Map(allCombos.map((c: any) => [c.sku, c]));
        const singleSkuMap = new Map(allSingleSkus.map((s: any) => [s.sku, s]));

        // Step 3: Process each combo SKU entry
        let successCount = 0;
        let errorCount = 0;

        for (const entry of comboEntries) {
            const { id, order_id, combo_sku, quantity, status } = entry;
            console.log(`\n📦 Processing Order #${order_id}: Combo SKU ${combo_sku} (quantity: ${quantity})`);

            try {
                // Get combo SKU definition
                const combo = comboSkuMap.get(combo_sku);
                if (!combo) {
                    console.error(`  ❌ Combo SKU ${combo_sku} not found in database`);
                    errorCount++;
                    continue;
                }

                // Parse components
                const components = Array.isArray(combo.components)
                    ? combo.components
                    : JSON.parse(combo.components || '[]');

                if (components.length === 0) {
                    console.error(`  ❌ Combo SKU ${combo_sku} has no components`);
                    errorCount++;
                    continue;
                }

                console.log(`  📋 Components: ${components.map((c: any) => `${c.quantity}x ${c.sku}`).join(', ')}`);

                // Step 4: For each component, deduct stock and create pending entry
                const componentEntries: Array<{ sku: string; quantity: number; success: boolean }> = [];

                for (const comp of components) {
                    if (!comp.sku || !comp.quantity) {
                        console.warn(`  ⚠️ Invalid component:`, comp);
                        continue;
                    }

                    const componentSku = singleSkuMap.get(comp.sku);
                    if (!componentSku || !componentSku.woocommerce_product_id) {
                        console.error(`  ❌ Component SKU ${comp.sku} not found or missing WC product ID`);
                        continue;
                    }

                    const deductedQty = comp.quantity * quantity;

                    try {
                        // Get current stock from WC
                        const currentProduct = await getProduct(componentSku.woocommerce_product_id);
                        const currentStock = currentProduct.stock_quantity || 0;

                        // Calculate new stock (deduct)
                        const newStock = Math.max(0, currentStock - deductedQty);

                        // Update in WooCommerce
                        await updateProductStock(componentSku.woocommerce_product_id, newStock);
                        console.log(`  ✅ Deducted ${deductedQty} from ${comp.sku} (${currentStock} → ${newStock})`);

                        // Create component entry in pending_consultation_stock
                        await addPendingConsultationStock(order_id, comp.sku, deductedQty, status || 'pending-consult');
                        console.log(`  ✅ Created pending entry for component ${comp.sku}`);

                        componentEntries.push({ sku: comp.sku, quantity: deductedQty, success: true });
                    } catch (e: any) {
                        console.error(`  ❌ Failed to process component ${comp.sku}:`, e.message);
                        componentEntries.push({ sku: comp.sku, quantity: deductedQty, success: false });
                    }
                }

                // Step 5: Delete old combo SKU entry only if all components were processed successfully
                const allSuccess = componentEntries.length > 0 && componentEntries.every(e => e.success);
                if (allSuccess) {
                    // Remove only the combo SKU entry (not component entries we just created)
                    await query(
                        `DELETE FROM inventory_management.pending_consultation_stock WHERE id = $1`,
                        [id]
                    );
                    console.log(`  ✅ Deleted old combo SKU entry`);
                    successCount++;
                } else {
                    console.error(`  ❌ Some components failed. Keeping combo SKU entry for manual review.`);
                    errorCount++;
                }

            } catch (e: any) {
                console.error(`  ❌ Error processing entry:`, e.message);
                errorCount++;
            }
        }

        console.log(`\n✅ Migration complete!`);
        console.log(`   Success: ${successCount}`);
        console.log(`   Errors: ${errorCount}`);
        console.log(`\n⚠️  Please verify the changes in the dashboard and WooCommerce.`);

    } catch (error: any) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrateComboSkuPendingToComponents()
    .then(() => {
        console.log('\n✅ Migration script completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration script failed:', error);
        process.exit(1);
    });

