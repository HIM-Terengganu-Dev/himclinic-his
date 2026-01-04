/**
 * Script: Get All Order Statuses from WooCommerce API
 * 
 * This script fetches all possible order statuses from WooCommerce API.
 * It queries:
 * 1. The order statuses endpoint to get all available statuses
 * 2. Actual orders to see which statuses are in use
 * 
 * Output: Comprehensive list of order statuses for data pipeline architecting
 * 
 * Usage: node scripts/get-order-statuses.js
 */

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

/**
 * Fetch all available order statuses from WooCommerce
 */
async function getOrderStatuses() {
  try {
    console.log('📡 Fetching order statuses from WooCommerce API...\n');
    const response = await wooCommerce.get('orders/statuses');
    return response.data;
  } catch (error) {
    console.error('❌ Error fetching order statuses:', error.message);
    throw error;
  }
}

/**
 * Fetch actual orders to see which statuses are in use
 */
async function getOrdersByStatus() {
  const statusCounts = {};
  const statusOrders = {};
  
  try {
    console.log('📡 Fetching orders to analyze status usage...\n');
    
    // Fetch orders in batches
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    let totalFetched = 0;
    
    while (hasMore && page <= 10) { // Limit to 10 pages (1000 orders max)
      const response = await wooCommerce.get('orders', {
        per_page: perPage,
        page: page,
        orderby: 'date',
        order: 'desc',
      });
      
      const orders = response.data;
      if (orders.length === 0) {
        hasMore = false;
        break;
      }
      
      orders.forEach(order => {
        const status = order.status;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        
        if (!statusOrders[status]) {
          statusOrders[status] = [];
        }
        // Store sample order IDs (max 5 per status)
        if (statusOrders[status].length < 5) {
          statusOrders[status].push({
            id: order.id,
            date_created: order.date_created,
            total: order.total,
          });
        }
      });
      
      totalFetched += orders.length;
      console.log(`  Fetched page ${page}: ${orders.length} orders (total: ${totalFetched})`);
      
      // Check if there are more pages
      const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1');
      if (page >= totalPages) {
        hasMore = false;
      } else {
        page++;
      }
    }
    
    console.log(`\n✅ Total orders analyzed: ${totalFetched}\n`);
    return { statusCounts, statusOrders };
  } catch (error) {
    console.error('❌ Error fetching orders:', error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('WooCommerce Order Statuses - Data Pipeline Reference');
  console.log('='.repeat(60));
  console.log(`Store URL: ${process.env.WOOCOMMERCE_STORE_URL || 'N/A'}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);
  
  try {
    // 1. Get all available order statuses
    const statuses = await getOrderStatuses();
    
    console.log('📋 AVAILABLE ORDER STATUSES (from API):');
    console.log('-'.repeat(60));
    const statusList = [];
    Object.keys(statuses).forEach(status => {
      const statusInfo = statuses[status];
      statusList.push({
        slug: status,
        name: statusInfo.name,
        description: statusInfo.description || 'N/A',
      });
      console.log(`  • ${status.padEnd(15)} - ${statusInfo.name}`);
      if (statusInfo.description) {
        console.log(`    ${statusInfo.description}`);
      }
    });
    console.log(`\n  Total available statuses: ${statusList.length}\n`);
    
    // 2. Get actual order status usage
    const { statusCounts, statusOrders } = await getOrdersByStatus();
    
    console.log('📊 ORDER STATUS USAGE (from actual orders):');
    console.log('-'.repeat(60));
    
    // Sort by count (descending)
    const sortedStatuses = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1]);
    
    sortedStatuses.forEach(([status, count]) => {
      console.log(`  • ${status.padEnd(15)} - ${count} order(s)`);
      if (statusOrders[status] && statusOrders[status].length > 0) {
        console.log(`    Sample order IDs: ${statusOrders[status].map(o => o.id).join(', ')}`);
      }
    });
    
    console.log(`\n  Total statuses in use: ${sortedStatuses.length}\n`);
    
    // 3. Summary for data pipeline
    console.log('='.repeat(60));
    console.log('📝 DATA PIPELINE REFERENCE');
    console.log('='.repeat(60));
    console.log('\nAll Possible Order Statuses (for webhook events):');
    console.log('─'.repeat(60));
    statusList.forEach((s, idx) => {
      console.log(`${idx + 1}. ${s.slug}`);
      console.log(`   Name: ${s.name}`);
      console.log(`   Description: ${s.description}`);
      console.log(`   Webhook Event: order.${s.slug}`);
      console.log(`   In Use: ${statusCounts[s.slug] ? `Yes (${statusCounts[s.slug]} orders)` : 'No'}`);
      console.log('');
    });
    
    // 4. JSON output for programmatic use
    const output = {
      timestamp: new Date().toISOString(),
      store_url: process.env.WOOCOMMERCE_STORE_URL,
      available_statuses: statusList,
      status_usage: statusCounts,
      summary: {
        total_available: statusList.length,
        total_in_use: sortedStatuses.length,
        statuses_in_use: sortedStatuses.map(([status, count]) => ({
          status,
          count,
        })),
        statuses_not_in_use: statusList
          .filter(s => !statusCounts[s.slug])
          .map(s => s.slug),
      },
    };
    
    // Save to JSON file
    const outputPath = path.join(__dirname, '..', 'database', 'order_statuses.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Full data saved to: ${outputPath}`);
    
    // 5. Quick reference list
    console.log('\n' + '='.repeat(60));
    console.log('🚀 QUICK REFERENCE - Order Status List');
    console.log('='.repeat(60));
    console.log('\nStatus slugs (for filtering/processing):');
    console.log(statusList.map(s => s.slug).join(', '));
    
    console.log('\n\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);

