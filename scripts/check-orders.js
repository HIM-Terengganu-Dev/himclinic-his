// Script to check order timestamps from WooCommerce API
// Read .env.local file manually
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
}

const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const wooCommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_STORE_URL || '',
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || '',
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || '',
  version: 'wc/v3',
});

async function checkOrders(orderIds) {
  console.log('Fetching orders:', orderIds.join(', '));
  console.log('Current time (UTC):', new Date().toISOString());
  console.log('Current time (Local):', new Date().toString());
  console.log('Current time (GMT+8):', new Date(new Date().getTime() + (8 * 60 * 60 * 1000)).toISOString());
  console.log('---\n');

  for (const orderId of orderIds) {
    try {
      const response = await wooCommerce.get(`orders/${orderId}`);
      const order = response.data;
      
      const orderDate = new Date(order.date_created);
      const now = new Date();
      const diffMs = now.getTime() - orderDate.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      console.log(`Order #${order.id}:`);
      console.log(`  Status: ${order.status}`);
      console.log(`  date_created (from API): ${order.date_created}`);
      console.log(`  date_created_gmt (from API): ${order.date_created_gmt || 'N/A'}`);
      console.log(`  Parsed as UTC: ${orderDate.toISOString()}`);
      console.log(`  Parsed as Local: ${orderDate.toString()}`);
      console.log(`  Time difference from now: ${diffHours.toFixed(2)} hours (${diffDays.toFixed(2)} days)`);
      console.log(`  Relative time: ${diffHours < 1 ? `${(diffMs / 60000).toFixed(0)} minutes ago` : diffHours < 24 ? `${diffHours.toFixed(1)} hours ago` : `${diffDays.toFixed(1)} days ago`}`);
      console.log('---\n');
    } catch (error) {
      console.error(`Error fetching order ${orderId}:`, error.message);
      console.log('---\n');
    }
  }
}

// Check orders 10328 and 10341
checkOrders(['10328', '10341']).catch(console.error);

