import { InventoryStock, ComboAvailability } from '@/types/inventory';
import { SINGLE_SKUS } from '@/lib/data/single-skus';
import { COMBO_SKUS } from '@/lib/data/combo-skus';

/**
 * Initialize inventory with default quantity for all single SKUs
 * Used as fallback if WooCommerce data not available
 */
export function initializeInventory(defaultQuantity: number = 10): InventoryStock {
  const inventory: InventoryStock = {};
  SINGLE_SKUS.forEach((sku) => {
    inventory[sku.sku] = defaultQuantity;
  });
  return inventory;
}

/**
 * Initialize inventory from WooCommerce product stock quantities
 * Uses database SKU definitions instead of static files
 */
export function initializeInventoryFromProducts(products: any[], singleSkus: any[]): InventoryStock {
  const inventory: InventoryStock = {};
  
  singleSkus.forEach((singleSku) => {
    // Find the product in WooCommerce by woocommerce_product_id
    const product = products.find((p) => p.id === singleSku.woocommerce_product_id);
    
    if (product) {
      // Handle stock_quantity: can be number, null, undefined, or string
      let stockQuantity: number = 0;
      
      if (product.stock_quantity !== null && product.stock_quantity !== undefined) {
        // Convert to number if it's a string
        stockQuantity = typeof product.stock_quantity === 'string' 
          ? parseFloat(product.stock_quantity) || 0
          : Number(product.stock_quantity) || 0;
      }
      
      inventory[singleSku.sku] = stockQuantity;
      
      // Log if stock management is disabled
      if (!product.manage_stock && stockQuantity === 0) {
        console.warn(`Product ${singleSku.sku} (WC ID: ${singleSku.woocommerce_product_id}) has stock management disabled. Setting to 0.`);
      }
    } else {
      // Fallback to 0 if product not found
      console.warn(`Product ${singleSku.sku} (WC ID: ${singleSku.woocommerce_product_id}) not found in WooCommerce. Setting to 0.`);
      inventory[singleSku.sku] = 0;
    }
  });
  
  return inventory;
}

/**
 * Calculate how many units of a combo SKU can be made from current inventory
 */
export function calculateComboAvailability(
  comboSku: string,
  inventory: InventoryStock
): number {
  const combo = COMBO_SKUS.find((c) => c.sku === comboSku);
  if (!combo) return 0;

  // Check component 1
  const component1Available = Math.floor(
    (inventory[combo.component_1] || 0) / combo.component_1_qty
  );

  // If there's no component 2, return component 1 availability
  if (!combo.component_2 || !combo.component_2_qty) {
    return component1Available;
  }

  // Check component 2
  const component2Available = Math.floor(
    (inventory[combo.component_2] || 0) / combo.component_2_qty
  );

  // Return the minimum (bottleneck)
  return Math.min(component1Available, component2Available);
}

/**
 * Calculate availability for all combo SKUs
 * Uses database combo SKU definitions instead of static files
 */
export function calculateAllComboAvailability(
  inventory: InventoryStock,
  comboSkus: any[]
): ComboAvailability[] {
  return comboSkus.map((combo) => {
    // Parse components from database JSONB field
    const components = Array.isArray(combo.components) 
      ? combo.components 
      : JSON.parse(combo.components || '[]');

    if (components.length === 0) {
      return {
        sku: combo.sku,
        name: combo.name,
        maxAvailable: 0,
        limitingComponent: '',
      };
    }

    // Calculate availability for each component
    let maxAvailable = Infinity;
    let limitingComponent = '';

    for (const comp of components) {
      if (!comp.sku || !comp.quantity) continue;
      
      const componentAvailable = Math.floor(
        (inventory[comp.sku] || 0) / comp.quantity
      );

      if (componentAvailable < maxAvailable) {
        maxAvailable = componentAvailable;
        limitingComponent = comp.sku;
      }
    }

    // If no components found or all have infinite availability, set to 0
    if (maxAvailable === Infinity) {
      maxAvailable = 0;
    }

    return {
      sku: combo.sku,
      name: combo.name,
      maxAvailable,
      limitingComponent,
    };
  });
}

/**
 * Deduct single SKUs based on a combo SKU order
 */
export function deductComboSKU(
  comboSku: string,
  quantity: number,
  inventory: InventoryStock
): { success: boolean; inventory: InventoryStock; deductions: InventoryStock } {
  const combo = COMBO_SKUS.find((c) => c.sku === comboSku);
  if (!combo) {
    return { success: false, inventory, deductions: {} };
  }

  const newInventory = { ...inventory };
  const deductions: InventoryStock = {};

  // Deduct component 1
  const deduction1 = combo.component_1_qty * quantity;
  if ((newInventory[combo.component_1] || 0) < deduction1) {
    return { success: false, inventory, deductions: {} };
  }
  newInventory[combo.component_1] -= deduction1;
  deductions[combo.component_1] = deduction1;

  // Deduct component 2 if exists
  if (combo.component_2 && combo.component_2_qty) {
    const deduction2 = combo.component_2_qty * quantity;
    if ((newInventory[combo.component_2] || 0) < deduction2) {
      return { success: false, inventory, deductions: {} };
    }
    newInventory[combo.component_2] -= deduction2;
    deductions[combo.component_2] = deduction2;
  }

  return { success: true, inventory: newInventory, deductions };
}

/**
 * Deduct single SKU directly
 */
export function deductSingleSKU(
  sku: string,
  quantity: number,
  inventory: InventoryStock
): { success: boolean; inventory: InventoryStock; deductions: InventoryStock } {
  const newInventory = { ...inventory };
  const deductions: InventoryStock = {};

  if ((newInventory[sku] || 0) < quantity) {
    return { success: false, inventory, deductions: {} };
  }

  newInventory[sku] -= quantity;
  deductions[sku] = quantity;

  return { success: true, inventory: newInventory, deductions };
}

/**
 * Check if a SKU is a single SKU or combo SKU
 */
export function isSingleSKU(sku: string): boolean {
  return SINGLE_SKUS.some((s) => s.sku === sku);
}

export function isComboSKU(sku: string): boolean {
  return COMBO_SKUS.some((c) => c.sku === sku);
}

/**
 * Get SKU details
 */
export function getSKUDetails(sku: string) {
  const singleSku = SINGLE_SKUS.find((s) => s.sku === sku);
  if (singleSku) {
    return { type: 'single', ...singleSku };
  }

  const comboSku = COMBO_SKUS.find((c) => c.sku === sku);
  if (comboSku) {
    return { type: 'combo', ...comboSku };
  }

  return null;
}

