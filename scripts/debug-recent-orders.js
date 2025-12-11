// Debug script for Recently Processed Orders
const fs = require('fs');
const path = require('path');

// Read .env.local file manually
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function debugRecentOrders() {
  console.log('='.repeat(80));
  console.log('DEBUGGING RECENTLY PROCESSED ORDERS');
  console.log('='.repeat(80));
  console.log(`Current time (GMT+8): ${new Date(new Date().getTime() + (8 * 60 * 60 * 1000)).toISOString().replace('Z', '+08:00')}`);
  console.log(`Current time (UTC): ${new Date().toISOString()}`);
  console.log(`Current time (Local): ${new Date().toString()}`);
  console.log('---\n');

  try {
    console.log('Fetching /api/inventory...');
    const response = await fetch(`${API_URL}/api/inventory`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log(`Found ${data.recentlyProcessedOrders?.length || 0} recently processed orders\n`);
    
    if (data.recentlyProcessedOrders && data.recentlyProcessedOrders.length > 0) {
      data.recentlyProcessedOrders.forEach((order, idx) => {
        console.log(`Order #${order.orderId} (${idx + 1}/${data.recentlyProcessedOrders.length}):`);
        console.log(`  processedAt: ${order.processedAt}`);
        
        // Parse the timestamp
        const processedDate = new Date(order.processedAt);
        const now = new Date();
        const diffMs = now.getTime() - processedDate.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = diffMs / (1000 * 60 * 60);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        
        console.log(`  Parsed as Date: ${processedDate.toISOString()}`);
        console.log(`  Parsed as Local: ${processedDate.toString()}`);
        console.log(`  Time difference: ${diffMinutes} minutes (${diffHours.toFixed(2)} hours, ${diffDays.toFixed(2)} days)`);
        
        // Calculate what formatDistanceToNowGMT8 should return
        let relativeTime = '';
        if (diffMinutes < 1) {
          relativeTime = 'less than a minute ago';
        } else if (diffMinutes < 60) {
          relativeTime = `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
          relativeTime = `${Math.floor(diffHours)} hour${Math.floor(diffHours) !== 1 ? 's' : ''} ago`;
        } else {
          relativeTime = `${Math.floor(diffDays)} day${Math.floor(diffDays) !== 1 ? 's' : ''} ago`;
        }
        
        console.log(`  Expected relative time: "${relativeTime}"`);
        console.log(`  Items: ${order.items.length}`);
        console.log(`  Total deductions: ${Object.keys(order.totalDeductions).length} SKUs`);
        console.log('---\n');
      });
    } else {
      console.log('No recently processed orders found.');
    }
    
    // Also check the raw data structure
    console.log('\nRaw data structure:');
    console.log(JSON.stringify(data.recentlyProcessedOrders?.slice(0, 2) || [], null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

debugRecentOrders().catch(console.error);

