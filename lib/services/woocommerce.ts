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

export default wooCommerce;

