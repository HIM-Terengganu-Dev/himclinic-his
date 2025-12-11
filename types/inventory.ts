// Single SKU definition
export interface SingleSKU {
  id: number;
  sku: string;
  name: string;
}

// Combo SKU definition with components
export interface ComboSKU {
  id: number;
  sku: string;
  name: string;
  component_1: string;
  component_1_qty: number;
  component_2?: string;
  component_2_qty?: number;
}

// Inventory stock for single SKUs
export interface InventoryStock {
  [sku: string]: number; // e.g., { "him1": 10, "spu1": 10 }
}

// Calculated available combo SKUs based on single SKU inventory
export interface ComboAvailability {
  sku: string;
  name: string;
  maxAvailable: number;
  limitingComponent: string;
}

// WooCommerce Product type
export interface WooCommerceProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  stock_quantity: number | null;
  stock_status: string;
  manage_stock: boolean;
}

// WooCommerce Order type
export interface WooCommerceOrder {
  id: number;
  status: string;
  date_created: string;
  date_created_gmt?: string; // UTC timestamp from WooCommerce
  total: string;
  line_items: WooCommerceLineItem[];
}

// WooCommerce Line Item type
export interface WooCommerceLineItem {
  id: number;
  name: string;
  product_id: number;
  quantity: number;
  sku: string;
  total: string;
}

// Order processing result
export interface OrderProcessingResult {
  orderId: number;
  orderDate: string;
  items: {
    sku: string;
    name: string;
    quantity: number;
    singleSkuDeductions: {
      sku: string;
      quantity: number;
    }[];
  }[];
  totalDeductions: InventoryStock;
}

// Processed order for display
export interface ProcessedOrder {
  orderId: number;
  orderDate: string;
  processedAt: string;
  items: {
    sku: string;
    name: string;
    quantity: number;
  }[];
  totalDeductions: InventoryStock;
}

// Stock update request
export interface StockUpdateRequest {
  sku: string;
  quantity: number;
  operation: 'add' | 'set';
}

