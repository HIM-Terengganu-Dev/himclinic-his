# Installation Checklist

Use this checklist to ensure your Telehealth Inventory Management System is properly set up.

## Pre-Installation

- [ ] Node.js 18 or higher installed
  - Check: `node --version`
  - Download: https://nodejs.org/

- [ ] npm installed (comes with Node.js)
  - Check: `npm --version`

- [ ] WooCommerce API credentials ready
  - Consumer Key (ck_...)
  - Consumer Secret (cs_...)
  - Store URL

## Installation Steps

### 1. Install Dependencies

- [ ] Navigate to project directory
  ```bash
  cd telehealth-inventory-management-system
  ```

- [ ] Install npm packages
  ```bash
  npm install
  ```

- [ ] Wait for installation to complete
  - Should see "Installation verification" output automatically
  - All checks should pass (✅)

### 2. Configure Environment

- [ ] Create `.env` file in root directory
  ```bash
  # Windows
  copy .env.example .env
  
  # Mac/Linux
  cp .env.example .env
  ```

- [ ] Edit `.env` file with your credentials
  - [ ] Replace `WOOCOMMERCE_STORE_URL` with your store URL
  - [ ] Replace `WOOCOMMERCE_CONSUMER_KEY` with your key
  - [ ] Replace `WOOCOMMERCE_CONSUMER_SECRET` with your secret

- [ ] Verify `.env` file format
  ```env
  WOOCOMMERCE_STORE_URL=https://forhimclinic.com
  WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxx
  WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxx
  ```
  - [ ] No trailing slash on URL
  - [ ] No spaces around `=` signs
  - [ ] No quotes needed around values

### 3. Verify Installation

- [ ] Run verification script
  ```bash
  npm run verify
  ```

- [ ] Check output - should see:
  - [ ] ✅ Node.js version OK
  - [ ] ✅ All required files present
  - [ ] ✅ API routes configured
  - [ ] ✅ Data files present
  - [ ] ✅ Environment file exists

### 4. Start Development Server

- [ ] Run development server
  ```bash
  npm run dev
  ```

- [ ] Wait for server to start
  - Should see: "Ready on http://localhost:3000"

- [ ] Open browser to http://localhost:3000

### 5. Verify Application

- [ ] Dashboard loads without errors

- [ ] Check Single SKU Inventory section
  - [ ] See 12 single SKU cards
  - [ ] Each shows 10 units (initial stock)
  - [ ] All show green status (in stock)

- [ ] Check Combo SKU Availability table
  - [ ] See 18 combo SKU rows
  - [ ] Each shows calculated availability
  - [ ] Limiting component displayed

- [ ] Check statistics at top
  - [ ] Total Single SKU Stock: 120 (12 × 10)
  - [ ] Combo SKUs Available: calculated value
  - [ ] Low Stock Items: 0

### 6. Test Order Processing

- [ ] Get a test order ID from WooCommerce
  - [ ] Go to WooCommerce > Orders
  - [ ] Find a completed order
  - [ ] Note the Order ID

- [ ] Click "Process Orders" tab

- [ ] Enter order ID and click "Process Order"

- [ ] Verify results
  - [ ] Order details displayed
  - [ ] Items listed with deductions
  - [ ] Total deductions summary shown
  - [ ] No errors displayed

- [ ] Return to Stock Dashboard
  - [ ] Stock quantities updated
  - [ ] Combo availability recalculated

### 7. Test Procurement Update

- [ ] Click "Procurement Update" tab

- [ ] Select a single SKU (e.g., him1)

- [ ] Choose operation: Add

- [ ] Enter quantity: 50

- [ ] Click "Update Stock"

- [ ] Verify results
  - [ ] Success message shown
  - [ ] Updated single SKU quantity displayed
  - [ ] Affected combo SKUs listed
  - [ ] No errors

- [ ] Return to Stock Dashboard
  - [ ] him1 stock increased by 50
  - [ ] Combo SKUs using him1 updated

## Post-Installation

### 8. Update Initial Stock

Since the system starts with 10 units per SKU, update to actual stock:

- [ ] For each single SKU:
  - [ ] Go to Procurement Update tab
  - [ ] Select the SKU
  - [ ] Choose "Set" operation
  - [ ] Enter actual quantity
  - [ ] Click Update Stock

- [ ] Verify all stocks match physical inventory

### 9. Verify WooCommerce Sync

- [ ] Open WooCommerce admin

- [ ] Go to Products

- [ ] Check a combo product (e.g., kom/spu+him)
  - [ ] Stock quantity matches system calculation
  - [ ] Stock status is correct

### 10. Documentation Review

- [ ] Read `PROJECT_SUMMARY.md` for overview
- [ ] Read `USAGE_GUIDE.md` for daily operations
- [ ] Bookmark `README.md` for reference

## Troubleshooting

### Issue: "Cannot find module" errors

- [ ] Run `npm install` again
- [ ] Delete `node_modules` and `.next` folders
- [ ] Run `npm install` fresh

### Issue: "Failed to fetch products"

- [ ] Check `.env` file exists in root directory
- [ ] Verify WooCommerce credentials are correct
- [ ] Test credentials in WooCommerce REST API page
- [ ] Ensure API key has Read/Write permissions

### Issue: Port 3000 already in use

- [ ] Stop other applications using port 3000
- [ ] Or run on different port: `npm run dev -- -p 3001`

### Issue: TypeScript errors

- [ ] Run `npm run build` to check for errors
- [ ] Ensure all TypeScript files are present
- [ ] Check `tsconfig.json` is correct

## Production Deployment

### Vercel Deployment

- [ ] Push code to GitHub
- [ ] Connect repository to Vercel
- [ ] Add environment variables in Vercel
  - [ ] WOOCOMMERCE_STORE_URL
  - [ ] WOOCOMMERCE_CONSUMER_KEY
  - [ ] WOOCOMMERCE_CONSUMER_SECRET
  - [ ] NEXT_PUBLIC_BASE_URL (your Vercel domain)
- [ ] Deploy
- [ ] Test production site

## Final Checks

- [ ] System runs without errors
- [ ] All three tabs functional
- [ ] WooCommerce API connection working
- [ ] Stock calculations accurate
- [ ] Documentation understood

## Ready to Use! 🎉

Once all items are checked:

✅ **The system is ready for production use!**

Start using it for:
- Daily order processing
- Stock management
- Procurement updates
- Inventory monitoring

---

## Support Resources

If you encounter issues:

1. Check `USAGE_GUIDE.md` for usage instructions
2. Review `SETUP.md` for setup troubleshooting
3. Consult `README.md` for technical details
4. Check `ARCHITECTURE.md` for system design

---

**Installation Date:** _______________

**Verified By:** _______________

**Notes:**
_____________________________________________
_____________________________________________
_____________________________________________

