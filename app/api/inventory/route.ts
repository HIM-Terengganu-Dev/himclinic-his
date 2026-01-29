import { NextResponse } from 'next/server';
import {
  calculateAllComboAvailability,
} from '@/lib/utils/inventory';
import { getAllSingleSkus, getAllComboSkus, getAllCurrentStock } from '@/lib/db/queries';
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

    // Get current stock from transactions table (source of truth)
    const currentStockMap = await getAllCurrentStock();
    
    // Build inventory store from transactions
    const inventoryStore: InventoryStock = {};
    const pendingStock: Record<string, number> = {};
    
    singleSkus.forEach((sku: any) => {
      const stockData = currentStockMap[sku.sku];
      if (stockData) {
        inventoryStore[sku.sku] = stockData.stock;
        pendingStock[sku.sku] = stockData.pending;
      } else {
        // No transactions yet - default to 0
        inventoryStore[sku.sku] = 0;
        pendingStock[sku.sku] = 0;
      }
    });
    
    console.log(`Fetched stock from transactions for ${Object.keys(inventoryStore).length} SKUs at ${new Date().toISOString()}`);
    
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
      pendingStock: pendingStock, // Pending stock from transactions
      initializedFromTransactions: true
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

