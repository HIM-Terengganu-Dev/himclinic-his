#!/usr/bin/env node

/**
 * Installation Verification Script
 * Run this after npm install to verify the system is set up correctly
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Verifying Telehealth Inventory Management System Installation...\n');

let hasErrors = false;
const warnings = [];
const checks = [];

// Check 1: Node.js version
console.log('📦 Checking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
if (majorVersion >= 18) {
  checks.push('✅ Node.js version: ' + nodeVersion + ' (OK)');
} else {
  checks.push('❌ Node.js version: ' + nodeVersion + ' (Need 18 or higher)');
  hasErrors = true;
}

// Check 2: package.json exists
console.log('📄 Checking package.json...');
if (fs.existsSync('package.json')) {
  checks.push('✅ package.json found');
} else {
  checks.push('❌ package.json not found');
  hasErrors = true;
}

// Check 3: node_modules exists
console.log('📚 Checking dependencies...');
if (fs.existsSync('node_modules')) {
  checks.push('✅ node_modules directory exists');
} else {
  checks.push('❌ node_modules not found (run: npm install)');
  hasErrors = true;
}

// Check 4: Required files
console.log('📁 Checking required files...');
const requiredFiles = [
  'tsconfig.json',
  'next.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'app/layout.tsx',
  'app/page.tsx',
  'app/globals.css',
  'lib/services/woocommerce.ts',
  'lib/utils/inventory.ts',
  'lib/data/single-skus.ts',
  'lib/data/combo-skus.ts',
  'components/InventoryDashboard.tsx',
  'types/inventory.ts',
];

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    checks.push(`✅ ${file}`);
  } else {
    checks.push(`❌ ${file} (missing)`);
    hasErrors = true;
  }
});

// Check 5: Environment file (optional for Vercel/production)
console.log('🔐 Checking environment configuration...');
const isProduction = process.env.VERCEL || process.env.NODE_ENV === 'production';

if (fs.existsSync('.env')) {
  checks.push('✅ .env file exists');
  
  // Check if it has required variables
  const envContent = fs.readFileSync('.env', 'utf8');
  const hasStoreUrl = envContent.includes('WOOCOMMERCE_STORE_URL');
  const hasConsumerKey = envContent.includes('WOOCOMMERCE_CONSUMER_KEY');
  const hasConsumerSecret = envContent.includes('WOOCOMMERCE_CONSUMER_SECRET');
  
  if (hasStoreUrl && hasConsumerKey && hasConsumerSecret) {
    checks.push('✅ Environment variables configured');
  } else {
    warnings.push('⚠️  .env file exists but may be missing required variables');
    warnings.push('   Required: WOOCOMMERCE_STORE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET');
  }
} else if (isProduction) {
  checks.push('✅ Production environment (environment variables expected from platform)');
} else {
  warnings.push('⚠️  .env file not found');
  warnings.push('   Copy .env.example to .env and add your credentials');
}

// Check 6: API routes
console.log('🔌 Checking API routes...');
const apiRoutes = [
  'app/api/inventory/route.ts',
  'app/api/orders/route.ts',
  'app/api/products/route.ts',
  'app/api/stock/update/route.ts',
];

apiRoutes.forEach(route => {
  if (fs.existsSync(route)) {
    checks.push(`✅ ${route}`);
  } else {
    checks.push(`❌ ${route} (missing)`);
    hasErrors = true;
  }
});

// Check 7: Data files
console.log('📊 Checking data files...');
const dataFiles = ['single_sku_list.csv', 'combo_sku_list.csv'];
dataFiles.forEach(file => {
  if (fs.existsSync(file)) {
    checks.push(`✅ ${file}`);
  } else {
    checks.push(`❌ ${file} (missing)`);
    hasErrors = true;
  }
});

// Print results
console.log('\n' + '='.repeat(70));
console.log('📋 VERIFICATION RESULTS');
console.log('='.repeat(70) + '\n');

checks.forEach(check => console.log(check));

if (warnings.length > 0) {
  console.log('\n' + '⚠'.repeat(35));
  console.log('WARNINGS:');
  console.log('⚠'.repeat(35) + '\n');
  warnings.forEach(warning => console.log(warning));
}

console.log('\n' + '='.repeat(70));

if (hasErrors) {
  console.log('❌ VERIFICATION FAILED');
  console.log('='.repeat(70));
  console.log('\nPlease fix the errors above and run this script again.\n');
  process.exit(1);
} else if (warnings.length > 0) {
  console.log('⚠️  VERIFICATION PASSED WITH WARNINGS');
  console.log('='.repeat(70));
  console.log('\nThe system should work, but please address the warnings.\n');
  console.log('Next steps:');
  console.log('1. Create .env file with your WooCommerce credentials');
  console.log('2. Run: npm run dev');
  console.log('3. Open: http://localhost:3000\n');
  process.exit(0);
} else {
  console.log('✅ VERIFICATION PASSED');
  console.log('='.repeat(70));
  console.log('\n🎉 Everything looks good! You\'re ready to start.\n');
  console.log('Next steps:');
  console.log('1. Ensure .env has your WooCommerce credentials');
  console.log('2. Run: npm run dev');
  console.log('3. Open: http://localhost:3000\n');
  process.exit(0);
}

