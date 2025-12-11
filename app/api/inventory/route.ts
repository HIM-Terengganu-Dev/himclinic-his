import { NextResponse } from 'next/server';
import {
  initializeInventory,
  initializeInventoryFromProducts,
  calculateAllComboAvailability,
} from '@/lib/utils/inventory';
import { getProducts } from '@/lib/services/woocommerce';
import { InventoryStock } from '@/types/inventory';

// In-memory inventory store (in production, use a database)
let inventoryStore = initializeInventory(10);
let isInitialized = false;



/**
 * Initialize inventory from WooCommerce on first request
 */
async function ensureInventoryInitialized() {
  if (!isInitialized) {
    try {
      console.log('Initializing inventory from WooCommerce...');
      const products = await getProducts({ per_page: 100 });
      inventoryStore = initializeInventoryFromProducts(products);
      isInitialized = true;
      console.log('Inventory initialized successfully from WooCommerce');
    } catch (error) {
      console.error('Failed to initialize from WooCommerce, using default:', error);
      inventoryStore = initializeInventory(10);
      isInitialized = true;
    }
  }
}


export async function GET() {
  try {
    // Always fetch fresh inventory from WooCommerce to ensure accuracy
    // This ensures stock take adjustments and manual updates are reflected immediately
    try {
      const products = await getProducts({ per_page: 100 });
      inventoryStore = initializeInventoryFromProducts(products);
      isInitialized = true;
    } catch (error) {
      console.error('Failed to fetch from WooCommerce, using cached:', error);
      // Fallback to cached if API fails
      if (!isInitialized) {
        await ensureInventoryInitialized();
      }
    }
    
    const comboAvailability = calculateAllComboAvailability(inventoryStore);

    return NextResponse.json({
      success: true,
      singleSkus: inventoryStore,
      comboAvailability,
      initializedFromWooCommerce: isInitialized,
    });
  } catch (error) {
    console.error('Error getting inventory:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get inventory' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, sku, quantity } = body;

    if (!action || !sku || quantity === undefined) {
      return NextResponse.json(
        { success: false, error: 'action, sku, and quantity are required' },
        { status: 400 }
      );
    }

    if (action === 'set') {
      inventoryStore[sku] = quantity;
    } else if (action === 'add') {
      inventoryStore[sku] = (inventoryStore[sku] || 0) + quantity;
    } else if (action === 'subtract') {
      inventoryStore[sku] = Math.max(0, (inventoryStore[sku] || 0) - quantity);
    } else {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use set, add, or subtract' },
        { status: 400 }
      );
    }

    const comboAvailability = calculateAllComboAvailability(inventoryStore);

    return NextResponse.json({
      success: true,
      singleSkus: inventoryStore,
      comboAvailability,
    });
  } catch (error) {
    console.error('Error updating inventory:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update inventory' },
      { status: 500 }
    );
  }
}

