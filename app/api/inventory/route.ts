import { NextResponse } from 'next/server';
import {
  initializeInventoryFromProducts,
  calculateAllComboAvailability,
} from '@/lib/utils/inventory';
import { getProducts } from '@/lib/services/woocommerce';
import { getAllSingleSkus, getAllComboSkus, getAllPendingConsultationStock } from '@/lib/db/queries';
import { InventoryStock } from '@/types/inventory';

// Force dynamic rendering to prevent Next.js caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Fetch SKU definitions from database (source of truth)
    const [singleSkus, comboSkus] = await Promise.all([
      getAllSingleSkus(),
      getAllComboSkus()
    ]);

    if (singleSkus.length === 0) {
      return NextResponse.json({
        success: true,
        singleSkus: {},
        comboAvailability: [],
        singleSkuList: [],
        message: 'No single SKUs found in database'
      });
    }

    // Always fetch fresh inventory from WooCommerce to ensure accuracy
    // This ensures stock take adjustments and manual updates are reflected immediately
    let inventoryStore: InventoryStock = {};
    try {
      // Fetch ALL products (handle pagination)
      let allProducts: any[] = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const products = await getProducts({ per_page: 100, page });
        allProducts = allProducts.concat(products);
        
        // If we got less than 100 products, we've reached the end
        hasMore = products.length === 100;
        page++;
      }
      
      console.log(`Fetched ${allProducts.length} products from WooCommerce at ${new Date().toISOString()}`);
      inventoryStore = initializeInventoryFromProducts(allProducts, singleSkus);
      
      // Log sample of inventory for debugging
      const sampleSkus = Object.keys(inventoryStore).slice(0, 5);
      console.log('Sample inventory:', sampleSkus.map(sku => ({ sku, qty: inventoryStore[sku] })));
    } catch (error) {
      console.error('Failed to fetch from WooCommerce:', error);
      // If WooCommerce fails, initialize with 0 stock for all SKUs
      singleSkus.forEach((sku: any) => {
        inventoryStore[sku.sku] = 0;
      });
    }
    
    // Calculate combo availability using database combos
    const comboAvailability = calculateAllComboAvailability(inventoryStore, comboSkus);

    // Get pending consultation stock (stock deducted by WC when order moves to "pending-consult" status)
    // This includes both single SKU and combo SKU orders
    const pendingStock = await getAllPendingConsultationStock();
    
    // Calculate pending component stock from pending combo SKU orders
    // For each pending combo SKU, calculate how much component stock is "reserved"
    const pendingComponentStock: Record<string, number> = {};
    
    // Get all combo SKUs to calculate component breakdown
    for (const combo of comboSkus) {
        const comboPendingQty = pendingStock[combo.sku] || 0;
        if (comboPendingQty > 0) {
            // Parse components from database JSONB field
            const components = Array.isArray(combo.components) 
                ? combo.components 
                : JSON.parse(combo.components || '[]');
            
            // For each component, add the pending quantity (component.quantity * comboPendingQty)
            for (const comp of components) {
                if (comp.sku && comp.quantity) {
                    const componentPendingQty = comp.quantity * comboPendingQty;
                    pendingComponentStock[comp.sku] = (pendingComponentStock[comp.sku] || 0) + componentPendingQty;
                }
            }
        }
    }
    
    // Merge single SKU pending stock with component pending stock
    // Component pending stock takes precedence (if a SKU is both a single SKU and a component, show component pending)
    const finalPendingStock: Record<string, number> = { ...pendingStock };
    for (const [sku, qty] of Object.entries(pendingComponentStock)) {
        // Add component pending stock (may add to existing if SKU was also directly ordered)
        finalPendingStock[sku] = (finalPendingStock[sku] || 0) + qty;
    }

    // Return SKU list for frontend display
    const singleSkuList = singleSkus.map((sku: any) => ({
      sku: sku.sku,
      name: sku.name,
      id: sku.woocommerce_product_id
    }));

    return NextResponse.json({
      success: true,
      singleSkus: inventoryStore,
      comboAvailability,
      singleSkuList, // For frontend to know which SKUs to display
      pendingStock: finalPendingStock, // Pending consultation stock: includes single SKU + component stock from combo SKUs
      initializedFromWooCommerce: true,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    console.error('Error getting inventory:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get inventory' },
      { status: 500 }
    );
  }
}

// POST endpoint removed - inventory updates should go through /api/procurement/update

