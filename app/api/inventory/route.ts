import { NextResponse } from 'next/server';
import {
  initializeInventory,
  initializeInventoryFromProducts,
  calculateAllComboAvailability,
  deductComboSKU,
  deductSingleSKU,
  isSingleSKU,
  isComboSKU,
} from '@/lib/utils/inventory';
import { getProducts, getOrders } from '@/lib/services/woocommerce';
import { InventoryStock, ProcessedOrder } from '@/types/inventory';
import { COMBO_SKUS } from '@/lib/data/combo-skus';

// In-memory inventory store (in production, use a database)
let inventoryStore = initializeInventory(10);
let isInitialized = false;

// Track last order check timestamp (per serverless instance)
// Initialize with 1 hour lookback for safety
let lastOrderCheckTime = new Date(Date.now() - 60 * 60 * 1000);

// Store recently processed orders (last 20)
let recentlyProcessedOrders: ProcessedOrder[] = [];

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

/**
 * Check for and process new orders from WooCommerce
 */
async function checkAndProcessNewOrders() {
  try {
    console.log(`Checking for orders after ${lastOrderCheckTime.toISOString()}`);
    
    // Fetch processing orders created after last check
    const orders = await getOrders({
      status: 'processing',
      after: lastOrderCheckTime.toISOString(),
      per_page: 100,
    });

    console.log(`Found ${orders.length} new orders to process`);

    const processedThisCheck: ProcessedOrder[] = [];

    for (const order of orders) {
      try {
        // Process each line item
        let currentInventory = { ...inventoryStore };
        const totalDeductions: InventoryStock = {};
        const orderItems: ProcessedOrder['items'] = [];

        for (const item of order.line_items) {
          const sku = item.sku;
          const quantity = item.quantity;

          if (!sku) {
            console.warn(`Order ${order.id} item ${item.name} has no SKU, skipping`);
            continue;
          }

          if (isSingleSKU(sku)) {
            // Direct single SKU deduction
            const result = deductSingleSKU(sku, quantity, currentInventory);
            if (result.success) {
              currentInventory = result.inventory;
              totalDeductions[sku] = (totalDeductions[sku] || 0) + quantity;
            } else {
              console.warn(`Insufficient stock for ${sku} in order ${order.id}`);
              // Continue processing other items even if one fails
            }
          } else if (isComboSKU(sku)) {
            // Combo SKU deduction (breaks down to single SKUs)
            const result = deductComboSKU(sku, quantity, currentInventory);
            if (result.success) {
              currentInventory = result.inventory;
              Object.entries(result.deductions).forEach(([deductedSku, deductedQty]) => {
                totalDeductions[deductedSku] = (totalDeductions[deductedSku] || 0) + deductedQty;
              });
            } else {
              console.warn(`Insufficient stock for combo ${sku} in order ${order.id}`);
            }
          }

          orderItems.push({
            sku,
            name: item.name,
            quantity,
          });
        }

        // Update inventory if any deductions were made
        if (Object.keys(totalDeductions).length > 0) {
          inventoryStore = currentInventory;
          
          const processedOrder: ProcessedOrder = {
            orderId: order.id,
            orderDate: order.date_created,
            processedAt: new Date().toISOString(),
            items: orderItems,
            totalDeductions,
          };

          processedThisCheck.push(processedOrder);
          console.log(`✅ Processed order #${order.id}`);
        }
      } catch (error) {
        console.error(`Error processing order ${order.id}:`, error);
      }
    }

    // Add to recently processed list (keep last 20)
    if (processedThisCheck.length > 0) {
      recentlyProcessedOrders = [...processedThisCheck, ...recentlyProcessedOrders].slice(0, 20);
    }

    // Update last check timestamp
    lastOrderCheckTime = new Date();

    return processedThisCheck;
  } catch (error) {
    console.error('Error checking orders:', error);
    return [];
  }
}

export async function GET() {
  try {
    // Ensure inventory is initialized from WooCommerce on first request
    await ensureInventoryInitialized();
    
    // Check for and process new orders
    const newlyProcessed = await checkAndProcessNewOrders();
    
    // Always fetch last 10 completed/processing orders from WooCommerce for display
    let allRecentOrders: ProcessedOrder[] = [];
    try {
      const wooOrders = await getOrders({
        per_page: 10,
        orderby: 'date',
        order: 'desc',
      });

      // Convert WooCommerce orders to ProcessedOrder format
      const wooOrdersFormatted: ProcessedOrder[] = wooOrders.map(order => {
        const totalDeductions: InventoryStock = {};
        
        // Calculate what would be deducted (for display only)
        order.line_items.forEach(item => {
          if (item.sku) {
            if (isSingleSKU(item.sku)) {
              totalDeductions[item.sku] = (totalDeductions[item.sku] || 0) + item.quantity;
            } else if (isComboSKU(item.sku)) {
              // Estimate deductions for combos (for display)
              const combo = require('@/lib/data/combo-skus').COMBO_SKUS.find((c: any) => c.sku === item.sku);
              if (combo) {
                totalDeductions[combo.component_1] = (totalDeductions[combo.component_1] || 0) + (combo.component_1_qty * item.quantity);
                if (combo.component_2) {
                  totalDeductions[combo.component_2] = (totalDeductions[combo.component_2] || 0) + (combo.component_2_qty * item.quantity);
                }
              }
            }
          }
        });

        return {
          orderId: order.id,
          orderDate: order.date_created,
          processedAt: order.date_created, // Use order date as fallback
          items: order.line_items.map(item => ({
            sku: item.sku || 'unknown',
            name: item.name,
            quantity: item.quantity,
          })),
          totalDeductions,
        };
      });

      // Merge: In-memory orders (most recent, detailed) + WooCommerce orders (historical)
      const memoryOrderIds = new Set(recentlyProcessedOrders.map(o => o.orderId));
      const wooOrdersNotInMemory = wooOrdersFormatted.filter(o => !memoryOrderIds.has(o.orderId));
      
      allRecentOrders = [...recentlyProcessedOrders, ...wooOrdersNotInMemory].slice(0, 15);
    } catch (error) {
      console.error('Error fetching recent orders from WooCommerce:', error);
      // Fallback to in-memory only
      allRecentOrders = recentlyProcessedOrders;
    }
    
    const comboAvailability = calculateAllComboAvailability(inventoryStore);

    return NextResponse.json({
      success: true,
      singleSkus: inventoryStore,
      comboAvailability,
      initializedFromWooCommerce: isInitialized,
      newOrdersProcessed: newlyProcessed,
      recentlyProcessedOrders: allRecentOrders,
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

