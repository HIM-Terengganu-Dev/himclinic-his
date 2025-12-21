import { NextResponse } from 'next/server';
import {
  initializeInventoryFromProducts,
  calculateAllComboAvailability,
} from '@/lib/utils/inventory';
import { getProducts } from '@/lib/services/woocommerce';
import { getAllSingleSkus, getAllComboSkus } from '@/lib/db/queries';
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

