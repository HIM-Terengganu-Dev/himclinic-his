/**
 * Script to sync all current "Available for Purchase" stock counts from HIS to WooCommerce
 * This performs a one-time bulk sync of all SKUs (single and combo) to WooCommerce
 * 
 * Usage: node sync_all_stock_to_woocommerce.js
 */

const { Pool } = require('pg');
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const wooCommerce = new WooCommerceRestApi({
    url: process.env.WOOCOMMERCE_STORE_URL || '',
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
    version: 'wc/v3',
});

async function getCurrentStockState(sku) {
    const result = await pool.query(`
        SELECT 
            in_warehouse_after as in_warehouse,
            processing_after as processing,
            pending_consult_after as pending_consult,
            pending_review_after as pending_review,
            backorder_after as backorder
        FROM "his_db".stock_transactions
        WHERE sku = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [sku]);
    
    if (result.rows.length === 0) {
        throw new Error(`No stock transactions found for SKU: ${sku}`);
    }
    
    const row = result.rows[0];
    const inWarehouse = row.in_warehouse || 0;
    const processing = row.processing || 0;
    const pendingConsult = row.pending_consult || 0;
    const pendingReview = row.pending_review || 0;
    
    // Calculate available for purchase: inWarehouse - pendingConsult - pendingReview - processing
    const availableForPurchase = Math.max(0, inWarehouse - pendingConsult - pendingReview - processing);
    
    return {
        inWarehouse,
        availableForPurchase,
        processing,
        pendingConsult,
        pendingReview,
        backorder: row.backorder || 0
    };
}

async function syncSingleSku(sku) {
    try {
        if (!sku.woocommerce_product_id) {
            return { success: false, skipped: true, reason: 'No WooCommerce product ID' };
        }

        const stockState = await getCurrentStockState(sku.sku);
        const availableForPurchase = stockState.availableForPurchase;

        await wooCommerce.put(`products/${sku.woocommerce_product_id}`, {
            stock_quantity: availableForPurchase,
            manage_stock: true,
        });

        return { success: true, availableForPurchase };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function syncComboSku(comboSku) {
    try {
        if (!comboSku.woocommerce_product_id) {
            return { success: false, skipped: true, reason: 'No WooCommerce product ID' };
        }

        // Parse components from database JSONB field
        const components = Array.isArray(comboSku.components) 
            ? comboSku.components 
            : JSON.parse(comboSku.components || '[]');

        if (components.length === 0) {
            const availableForPurchase = 0;
            await wooCommerce.put(`products/${comboSku.woocommerce_product_id}`, {
                stock_quantity: availableForPurchase,
                manage_stock: true,
            });
            return { success: true, availableForPurchase };
        }

        // Get available_for_purchase for all component SKUs
        let maxAvailable = Infinity;
        for (const comp of components) {
            if (!comp.sku || !comp.quantity) continue;
            
            try {
                const componentStockState = await getCurrentStockState(comp.sku);
                const componentAvailable = Math.floor(
                    componentStockState.availableForPurchase / comp.quantity
                );

                if (componentAvailable < maxAvailable) {
                    maxAvailable = componentAvailable;
                }
            } catch (error) {
                console.warn(`⚠️  Could not get stock state for component ${comp.sku}:`, error.message);
                maxAvailable = 0;
                break;
            }
        }

        // If no components found or all have infinite availability, set to 0
        if (maxAvailable === Infinity) {
            maxAvailable = 0;
        }

        const availableForPurchase = maxAvailable;

        await wooCommerce.put(`products/${comboSku.woocommerce_product_id}`, {
            stock_quantity: availableForPurchase,
            manage_stock: true,
        });

        return { success: true, availableForPurchase };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function syncAllStockToWooCommerce() {
  console.log('🚀 Starting bulk sync of all stock to WooCommerce...\n');
  
  try {
    // Check if WooCommerce credentials are configured
    if (!process.env.WOOCOMMERCE_STORE_URL || 
        !process.env.WOOCOMMERCE_CONSUMER_KEY || 
        !process.env.WOOCOMMERCE_CONSUMER_SECRET) {
      console.error('❌ WooCommerce credentials not configured in .env.local');
      console.error('Required: WOOCOMMERCE_STORE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET');
      process.exit(1);
    }

    // Get all SKUs from database
    console.log('📦 Fetching SKUs from database...');
    const singleSkusResult = await pool.query(`
        SELECT * FROM "his_db".single_skus 
        WHERE COALESCE(hidden, false) = false
        ORDER BY sku
    `);
    const comboSkusResult = await pool.query(`
        SELECT * FROM "his_db".combo_skus 
        WHERE COALESCE(hidden, false) = false
        ORDER BY sku
    `);
    
    const singleSkus = singleSkusResult.rows;
    const comboSkus = comboSkusResult.rows;
    
    console.log(`Found ${singleSkus.length} single SKUs and ${comboSkus.length} combo SKUs\n`);

    const results = {
      single: { success: 0, failed: 0, skipped: 0 },
      combo: { success: 0, failed: 0, skipped: 0 }
    };

    // Sync all single SKUs
    console.log('🔄 Syncing single SKUs...');
    for (const sku of singleSkus) {
      const result = await syncSingleSku(sku);
      if (result.skipped) {
        console.log(`⏭️  Skipping ${sku.sku} - ${result.reason}`);
        results.single.skipped++;
      } else if (result.success) {
        console.log(`✅ ${sku.sku} synced: ${result.availableForPurchase} (Product ID: ${sku.woocommerce_product_id})`);
        results.single.success++;
      } else {
        console.log(`❌ ${sku.sku} sync failed: ${result.error}`);
        results.single.failed++;
      }
    }

    console.log('\n🔄 Syncing combo SKUs...');
    // Sync all combo SKUs
    for (const sku of comboSkus) {
      const result = await syncComboSku(sku);
      if (result.skipped) {
        console.log(`⏭️  Skipping ${sku.sku} - ${result.reason}`);
        results.combo.skipped++;
      } else if (result.success) {
        console.log(`✅ ${sku.sku} synced: ${result.availableForPurchase} (Product ID: ${sku.woocommerce_product_id})`);
        results.combo.success++;
      } else {
        console.log(`❌ ${sku.sku} sync failed: ${result.error}`);
        results.combo.failed++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Single SKUs: ${results.single.success} synced, ${results.single.failed} failed, ${results.single.skipped} skipped`);
    console.log(`Combo SKUs: ${results.combo.success} synced, ${results.combo.failed} failed, ${results.combo.skipped} skipped`);
    console.log(`Total: ${results.single.success + results.combo.success} synced, ${results.single.failed + results.combo.failed} failed, ${results.single.skipped + results.combo.skipped} skipped`);
    console.log('='.repeat(60));

    if (results.single.failed + results.combo.failed > 0) {
      console.log('\n⚠️  Some SKUs failed to sync. Check the errors above.');
      process.exit(1);
    } else {
      console.log('\n✅ All SKUs synced successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Fatal error during sync:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the sync
syncAllStockToWooCommerce();
