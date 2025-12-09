# Usage Guide - Telehealth Inventory Management System

This guide provides step-by-step instructions and examples for using the Telehealth Inventory Management System.

## Table of Contents
1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Processing Orders](#processing-orders)
4. [Procurement Updates](#procurement-updates)
5. [Real-World Scenarios](#real-world-scenarios)
6. [Best Practices](#best-practices)

---

## Getting Started

### First Time Setup

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open your browser to `http://localhost:3000`

3. You'll see the dashboard with:
   - **Initial stock**: 10 units for each single SKU
   - **Calculated combos**: Automatically calculated based on components

### Understanding the Interface

The system has three main tabs:

1. **📦 Stock Dashboard** - View current inventory
2. **🛒 Process Orders** - Process WooCommerce orders
3. **📈 Procurement Update** - Add new stock (uses WRITE API)

---

## Dashboard Overview

### Single SKU Inventory Cards

Each card shows:
- **Product Name**: Full product name
- **SKU Code**: Short identifier (e.g., `him1`, `spu1`)
- **Current Stock**: Number of units available
- **Status Indicator**: 
  - ✅ Green border: In stock (5+ units)
  - ⚠️ Yellow border: Low stock (1-4 units)
  - ❌ Red border: Out of stock (0 units)

### Combo SKU Availability Table

The table displays:
- **SKU**: Combo product code
- **Product Name**: Full combo product name
- **Max Available**: How many units can be made
- **Limiting Component**: Which single SKU is the bottleneck
- **Status**: In Stock / Low Stock / Out of Stock

#### Example:
```
SKU: kom/spu+him
Name: KOMBO Spray Up + Him Coffee
Max Available: 8
Limiting Component: spu1 (8 units)
Status: In Stock
```

This means:
- You have 8 units of `spu1` available
- You have 10+ units of `him1` available
- Maximum 8 combos can be made (limited by spu1)

---

## Processing Orders

### Step-by-Step Order Processing

1. **Get the Order ID from WooCommerce**
   - Go to WooCommerce > Orders
   - Find the order you want to process
   - Note the Order ID (e.g., 12345)

2. **Enter Order ID in System**
   - Click the "Process Orders" tab
   - Enter the Order ID in the input field
   - Click "Process Order"

3. **Review Results**
   - See order details (date, items)
   - View single SKU deductions for each item
   - Check total deductions summary

### Example: Processing Order #12345

**Order Contents:**
- 2× kom/spu+him (Combo: Spray Up + Him Coffee)
- 3× him1 (Single: HIM Coffee)

**What Happens:**

1. System fetches order from WooCommerce
2. Breaks down items:
   ```
   kom/spu+him × 2 = 
     - spu1: 2 units (1 per combo × 2)
     - him1: 2 units (1 per combo × 2)
   
   him1 × 3 = 
     - him1: 3 units
   ```

3. Total deductions:
   ```
   - spu1: 2 units
   - him1: 5 units (2 + 3)
   ```

4. Inventory updated:
   ```
   Before:
   - spu1: 10 → After: 8
   - him1: 10 → After: 5
   ```

5. Combo availability recalculated:
   ```
   kom/spu+him: min(8, 5) = 5 units available
   ```

### Error Handling

**Insufficient Stock Error:**
```
Error: Insufficient stock for spu1. 
Required: 10, Available: 8
```

**Solution:**
- Add more stock via Procurement Update tab
- Or reduce order quantity in WooCommerce

---

## Procurement Updates

### Adding New Stock

Use this when you receive new inventory from suppliers.

#### Step-by-Step

1. **Click "Procurement Update" Tab**

2. **Select Single SKU**
   - Choose from dropdown (e.g., "him1 - HIM Coffee by Dr. Samhan")

3. **Choose Operation**
   - **Add**: Increment current stock
   - **Set**: Set stock to specific amount

4. **Enter Quantity**
   - Type the number of units

5. **Click "Update Stock"**

6. **Review Changes**
   - See updated single SKU quantity
   - View affected combo SKUs
   - All combo SKU stock automatically updated in WooCommerce

### Example 1: Adding Stock

**Scenario:** Received 100 units of HIM Coffee

**Steps:**
1. Select: `him1 - HIM Coffee by Dr. Samhan`
2. Choose: **Add**
3. Enter: `100`
4. Click: **Update Stock**

**Result:**
```
✅ Stock Updated Successfully!

Updated Single SKU:
- him1: 105 units (was 5, added 100)

Affected Combo SKUs (Updated in WooCommerce):
- kom/spu+him: 8 available (limited by spu1)
- kom/tad20+Him: 10 available
- him3: 35 available (105 ÷ 3)
- him9: 11 available (105 ÷ 9)
```

### Example 2: Setting Specific Stock Level

**Scenario:** Physical inventory count shows 50 units of Spray Up

**Steps:**
1. Select: `spu1 - Spray Up 10ml`
2. Choose: **Set**
3. Enter: `50`
4. Click: **Update Stock**

**Result:**
```
✅ Stock Updated Successfully!

Updated Single SKU:
- spu1: 50 units (set to exact count)

Affected Combo SKUs (Updated in WooCommerce):
- kom/spu+him: 5 available (limited by him1)
- kom/spu+tad20: 10 available
- kom/spu+iqn50: 10 available
- kom/spu+iqn100: 10 available
- kom/spu+tra: 10 available
- spu3: 16 available (50 ÷ 3)
- spu5: 10 available (50 ÷ 5)
- spu10: 5 available (50 ÷ 10)
```

---

## Real-World Scenarios

### Scenario 1: Daily Morning Routine

**Task:** Start the day by processing overnight orders

1. Open the system
2. Click "Refresh" to ensure latest data
3. Go to WooCommerce and note new order IDs
4. Process each order one by one in "Process Orders" tab
5. Monitor the dashboard for low stock items
6. Report any low stock items to procurement team

### Scenario 2: Weekly Stock Replenishment

**Task:** Update inventory after receiving supplier delivery

**Delivery Received:**
- 200× HIM Coffee (him1)
- 150× Spray Up (spu1)
- 100× Pil Harian 5mg (tad5/10tab)

**Steps:**

1. **Update him1:**
   - Tab: Procurement Update
   - SKU: him1
   - Operation: Add
   - Quantity: 200
   - Result: Combos using him1 updated in WooCommerce

2. **Update spu1:**
   - SKU: spu1
   - Operation: Add
   - Quantity: 150
   - Result: Combos using spu1 updated in WooCommerce

3. **Update tad5/10tab:**
   - SKU: tad5/10tab
   - Operation: Add
   - Quantity: 100
   - Result: Combos using tad5/10tab updated in WooCommerce

4. **Verify:**
   - Go to Stock Dashboard
   - Confirm all single SKUs updated
   - Check combo availability is correct

### Scenario 3: Investigating Stock Discrepancy

**Issue:** WooCommerce shows 20 units of kom/spu+him available, but customer can't order

**Investigation:**

1. **Check Dashboard:**
   ```
   kom/spu+him availability: 5 units
   Limiting component: him1 (5 units)
   ```

2. **Problem Identified:**
   - Local system shows 5 units available
   - WooCommerce shows 20 units (outdated)

3. **Solution:**
   - Procurement Update tab
   - Select: him1
   - Operation: Set
   - Quantity: (current actual stock)
   - This will sync WooCommerce to correct value

### Scenario 4: Flash Sale Preparation

**Task:** Prepare inventory for flash sale of kom/spu+him

**Target:** Need 100 units of kom/spu+him available

**Analysis:**
```
Current Inventory:
- spu1: 30 units
- him1: 150 units

kom/spu+him requires:
- 1× spu1
- 1× him1

Current max: min(30, 150) = 30 units
Need: 100 units
Shortfall: 70 more spu1 needed
```

**Action:**
1. Order 70+ units of spu1 from supplier
2. When received, use Procurement Update:
   - SKU: spu1
   - Operation: Add
   - Quantity: 70
3. Verify kom/spu+him now shows 100 available

---

## Best Practices

### Daily Operations

✅ **DO:**
- Refresh dashboard regularly
- Process orders promptly after they're placed
- Check for low stock items daily
- Update procurement immediately when stock arrives
- Keep a log of major stock movements

❌ **DON'T:**
- Process the same order twice
- Update combo SKUs directly in WooCommerce (system will overwrite)
- Ignore low stock warnings
- Forget to verify stock after procurement updates

### Stock Management

1. **Always Use Procurement Update for Adding Stock**
   - This ensures combo SKUs are updated in WooCommerce
   - Manual WooCommerce updates will be overwritten

2. **Monitor Limiting Components**
   - Check which components are limiting combo availability
   - Prioritize restocking limiting components

3. **Verify After Large Updates**
   - After adding significant stock, check dashboard
   - Verify combo SKUs show expected availability
   - Test by viewing products in WooCommerce storefront

4. **Handle Errors Gracefully**
   - If order processing fails, check actual stock
   - Don't process partial orders
   - Investigate discrepancies before continuing

### Data Integrity

1. **Single Source of Truth**
   - This system manages single SKU inventory
   - WooCommerce shows combo SKU availability
   - Don't manually adjust single SKU stock in WooCommerce

2. **Regular Audits**
   - Weekly: Compare physical inventory to system
   - Monthly: Full reconciliation
   - Update discrepancies using "Set" operation

3. **Backup Strategy**
   - Record major procurement updates in a log
   - Keep supplier delivery receipts
   - Document any manual adjustments

---

## Troubleshooting

### Issue: Order Processing Shows "Insufficient Stock" But Dashboard Shows Stock Available

**Cause:** Stock may have been consumed by another order being processed simultaneously

**Solution:**
1. Refresh the dashboard
2. Verify current stock levels
3. Process order again if stock is sufficient

### Issue: Combo SKU Shows 0 Available Despite Having Components

**Cause:** One component may be at 0 units

**Solution:**
1. Check limiting component in combo table
2. Add stock for that component via Procurement Update
3. Combo availability will automatically update

### Issue: WooCommerce Stock Different from Dashboard

**Cause:** System is source of truth for single SKUs, calculates combos

**Solution:**
1. Use Procurement Update to set correct single SKU levels
2. System will automatically sync combo SKUs to WooCommerce

---

## Quick Reference

### Stock Status Colors

| Color | Status | Action |
|-------|--------|--------|
| 🟢 Green | In Stock (5+) | Continue normal operations |
| 🟡 Yellow | Low Stock (1-4) | Alert procurement team |
| 🔴 Red | Out of Stock (0) | Order immediately |

### Operation Types

| Operation | Use Case | Example |
|-----------|----------|---------|
| **Add** | Receiving new stock | Delivery of 100 units → Add 100 |
| **Set** | Inventory reconciliation | Count shows 50 units → Set to 50 |

### Combo SKU Limits

Remember: Combo availability is always limited by the component with lowest ratio.

```
Example: spu5 (Spray Up × 5)
Requires: 5× spu1

If spu1 = 23 units
Then spu5 max = 23 ÷ 5 = 4 units (with 3 spare spu1)
```

---

## Support & Further Help

- **Technical Documentation**: See `README.md`
- **API Reference**: See `WOOCOMMERCE_API_AND_WEBHOOKS.md`
- **Architecture**: See `ARCHITECTURE.md`
- **Setup Guide**: See `SETUP.md`

---

**Happy Inventory Managing! 📦**




