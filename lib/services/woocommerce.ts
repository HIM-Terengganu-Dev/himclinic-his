import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import { WooCommerceProduct, WooCommerceOrder } from '@/types/inventory';

// Initialize WooCommerce API client
const wooCommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_STORE_URL || '',
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
  version: 'wc/v3',
});

/**
 * Fetch all products from WooCommerce
 */
export async function getProducts(params?: {
  per_page?: number;
  page?: number;
  status?: string;
}): Promise<WooCommerceProduct[]> {
  try {
    const response = await wooCommerce.get('products', {
      per_page: params?.per_page || 100,
      page: params?.page || 1,
      status: params?.status || 'publish',
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching products:', error);
    throw error;
  }
}

/**
 * Fetch a single product by ID
 */
export async function getProduct(id: number): Promise<WooCommerceProduct> {
  try {
    const response = await wooCommerce.get(`products/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching product ${id}:`, error);
    throw error;
  }
}

/**
 * Update product stock quantity (WRITE access)
 */
export async function updateProductStock(
  productId: number,
  stockQuantity: number
): Promise<WooCommerceProduct> {
  try {
    const response = await wooCommerce.put(`products/${productId}`, {
      stock_quantity: stockQuantity,
      manage_stock: true,
    });
    return response.data;
  } catch (error) {
    console.error(`Error updating product stock ${productId}:`, error);
    throw error;
  }
}

/**
 * Create a new product (WRITE access)
 */
export async function createProduct(data: any): Promise<WooCommerceProduct> {
  try {
    const response = await wooCommerce.post('products', data);
    return response.data;
  } catch (error) {
    console.error('Error creating product:', error);
    throw error;
  }
}

/**
 * Fetch orders from WooCommerce
 */
export async function getOrders(params?: {
  per_page?: number;
  page?: number;
  status?: string;
  after?: string;
  before?: string;
}): Promise<WooCommerceOrder[]> {
  try {
    const response = await wooCommerce.get('orders', {
      per_page: params?.per_page || 100,
      page: params?.page || 1,
      status: params?.status,
      after: params?.after,
      before: params?.before,
      orderby: 'date',
      order: 'desc', // Newest first
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching orders:', error);
    throw error;
  }
}

/**
 * Fetch a single order by ID
 */
export async function getOrder(id: number): Promise<WooCommerceOrder> {
  try {
    const response = await wooCommerce.get(`orders/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching order ${id}:`, error);
    throw error;
  }
}

/**
 * Fetch recent orders (processing and completed)
 */
export async function getRecentOrders(limit: number = 50): Promise<WooCommerceOrder[]> {
  try {
    const response = await wooCommerce.get('orders', {
      per_page: limit,
      status: 'processing,completed',
      orderby: 'date',
      order: 'desc',
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching recent orders:', error);
    throw error;
  }
}

/**
 * Sync "Available for Purchase" stock count to WooCommerce
 * This function updates WooCommerce product stock whenever the HIS system stock changes
 * Handles both single SKUs and combo SKUs
 * 
 * @param sku - The SKU code to sync
 * @returns Promise<boolean> - true if sync was successful, false otherwise
 */
export async function syncStockToWooCommerce(sku: string): Promise<boolean> {
  try {
    // Check if WooCommerce credentials are configured
    if (!process.env.WOOCOMMERCE_STORE_URL || 
        !process.env.WOOCOMMERCE_CONSUMER_KEY || 
        !process.env.WOOCOMMERCE_CONSUMER_SECRET) {
      console.warn(`⚠️ WooCommerce credentials not configured. Skipping stock sync for ${sku}`);
      return false;
    }

    // Get SKU information from database (check both single and combo SKUs)
    const { getSingleSkuByCode, getComboSkuByCode, getCurrentStockState, getAllSingleSkus } = await import('@/lib/db/queries');
    const { calculateAllComboAvailability } = await import('@/lib/utils/inventory');
    
    let productId: number | null = null;
    let availableForPurchase: number = 0;
    let skuType: 'single' | 'combo' | null = null;

    // First, try to find as a single SKU
    const singleSku = await getSingleSkuByCode(sku);
    if (singleSku) {
      skuType = 'single';
      productId = singleSku.woocommerce_product_id;
      
      if (!productId) {
        console.log(`ℹ️ Single SKU ${sku} has no WooCommerce product ID. Skipping sync.`);
        return false;
      }

      // Get current stock state (includes availableForPurchase calculation)
      const stockState = await getCurrentStockState(sku);
      availableForPurchase = stockState.availableForPurchase;
    } else {
      // Try to find as a combo SKU
      const comboSku = await getComboSkuByCode(sku);
      if (comboSku) {
        skuType = 'combo';
        productId = comboSku.woocommerce_product_id;
        
        if (!productId) {
          console.log(`ℹ️ Combo SKU ${sku} has no WooCommerce product ID. Skipping sync.`);
          return false;
        }

        // For combo SKUs, calculate availability based on component stock
        // Parse components from database JSONB field
        const components = Array.isArray(comboSku.components) 
          ? comboSku.components 
          : JSON.parse(comboSku.components || '[]');

        if (components.length === 0) {
          availableForPurchase = 0;
        } else {
          // Get available_for_purchase for all component SKUs
          const allSingleSkus = await getAllSingleSkus();
          const componentAvailability: { [key: string]: number } = {};
          
          for (const comp of components) {
            if (!comp.sku || !comp.quantity) continue;
            
            try {
              const componentStockState = await getCurrentStockState(comp.sku);
              componentAvailability[comp.sku] = componentStockState.availableForPurchase;
            } catch (error) {
              console.warn(`⚠️ Could not get stock state for component ${comp.sku}:`, error);
              componentAvailability[comp.sku] = 0;
            }
          }

          // Calculate how many combos can be made (minimum of all components)
          let maxAvailable = Infinity;
          for (const comp of components) {
            if (!comp.sku || !comp.quantity) continue;
            
            const componentAvailable = Math.floor(
              (componentAvailability[comp.sku] || 0) / comp.quantity
            );

            if (componentAvailable < maxAvailable) {
              maxAvailable = componentAvailable;
            }
          }

          // If no components found or all have infinite availability, set to 0
          if (maxAvailable === Infinity) {
            maxAvailable = 0;
          }

          availableForPurchase = maxAvailable;
        }
      } else {
        console.warn(`⚠️ SKU ${sku} not found in database (neither single nor combo). Skipping WooCommerce sync.`);
        return false;
      }
    }

    if (productId === null) {
      return false;
    }

    // Update WooCommerce product stock
    await updateProductStock(productId, availableForPurchase);
    
    console.log(`✅ Synced ${skuType} SKU ${sku} stock to WooCommerce: ${availableForPurchase} (Product ID: ${productId})`);
    
    // If this is a single SKU (component), also sync all combo SKUs that use it
    if (skuType === 'single') {
      try {
        const { getAllComboSkus } = await import('@/lib/db/queries');
        const allComboSkus = await getAllComboSkus();
        
        // Find all combo SKUs that use this component
        const affectedCombos = allComboSkus.filter((combo: any) => {
          const components = Array.isArray(combo.components) 
            ? combo.components 
            : JSON.parse(combo.components || '[]');
          return components.some((comp: any) => comp.sku === sku);
        });
        
        // Sync each affected combo SKU (async, don't block)
        for (const combo of affectedCombos) {
          syncStockToWooCommerce(combo.sku).catch(err => {
            console.error(`Error syncing combo SKU ${combo.sku} after component ${sku} change:`, err);
          });
        }
        
        if (affectedCombos.length > 0) {
          console.log(`📦 Also syncing ${affectedCombos.length} combo SKU(s) that use component ${sku}`);
        }
      } catch (error) {
        // Don't fail the main sync if combo sync fails
        console.warn(`⚠️ Could not sync combo SKUs for component ${sku}:`, error);
      }
    }
    
    return true;
  } catch (error: any) {
    // Log error but don't throw - we don't want to break the main flow
    console.error(`❌ Failed to sync ${sku} stock to WooCommerce:`, {
      error: error.message,
      code: error.code,
      sku,
      productId: error.response?.config?.url || 'unknown'
    });
    return false;
  }
}

export default wooCommerce;







