# Stock Logging Reference

## Overview

The system logs stock counts before and after activities in different ways depending on the activity type. This document explains what is logged and where.

## Activity Types and Stock Logging

### 1. Manual Procurement Updates (HIS System)

**Tables:** `procurement_updates`, `activity_logs`

**Stock Information Logged:**
- ✅ **Before:** `previous_quantity` column in `procurement_updates` table
- ✅ **After:** `new_quantity` column in `procurement_updates` table
- ✅ **Also in:** `activity_logs.details` JSONB as `previousQuantity` and `newQuantity`

**Example:**
```sql
SELECT 
    id,
    operation,
    previous_quantity,  -- Stock before (e.g., 100)
    new_quantity,        -- Stock after (e.g., 105)
    quantity             -- Change amount (e.g., +5)
FROM procurement_updates
WHERE id = 123;
```

**Activity Log Details:**
```json
{
  "operation": "add",
  "quantity": 5,
  "previousQuantity": 100,
  "newQuantity": 105
}
```

**Operations:**
- `add` - Manual stock in
- `subtract` - Manual stock out
- `set` - Reconciliation

---

### 2. WooCommerce Order Processing

**Table:** `wc_webhook_logs`

**Stock Information Logged:**
- ✅ **Component Deductions:** `details.componentDeductions` array
  - Each entry has `previousStock` and `newStock`
  - Example: `{"sku": "tad5/10tab", "previousStock": 87, "newStock": 84}`
- ✅ **Component Restorations:** `details.componentRestorations` array (for cancellations)
  - Each entry has `previousStock` and `newStock`
  - Example: `{"sku": "tad5/10tab", "previousStock": 84, "newStock": 87}`

**Note:** `stock_quantity` and `previous_stock_quantity` columns are **NULL** for order events (only used for product events).

**Example Query:**
```sql
SELECT 
    entity_id as order_id,
    created_at,
    details->'componentDeductions' as component_deductions
FROM wc_webhook_logs
WHERE webhook_event = 'order.processing'
AND entity_id = 12345;
```

**Example Result:**
```json
{
  "componentDeductions": [
    {
      "sku": "tad5/10tab",
      "previousStock": 87,    -- Stock before deduction
      "newStock": 84,         -- Stock after deduction
      "deductedQty": 3,
      "isWcSide": false,
      "hisWrote": true
    },
    {
      "sku": "iqn100/4tab",
      "previousStock": 13,
      "newStock": 12,
      "deductedQty": 1,
      "isWcSide": true,
      "hisWrote": false
    }
  ]
}
```

**⚠️ Important: Pending Stock and Logged Values**

When an order is processed directly (goes to `processing` status without going through `pending-consult` or `pending-review`), the logged `previousStock` reflects **WooCommerce stock only**, not the dashboard display value.

**Example Scenario:**
- **WooCommerce stock:** 64
- **Pending stock:** +1 (from a previous pending-consult order)
- **Dashboard shows:** 64+1 = 65
- **New order:** Quantity 3, goes directly to `processing`

**What Happens:**
1. WooCommerce deducts stock: 64 → 61 (WC is blind to pending stock)
2. Webhook reads current stock from WC: 61
3. System calculates `previousStock`: 61 + 3 = 64
4. System logs: `previousStock: 64, newStock: 61`

**The Discrepancy:**
- Dashboard showed 65 before the order (64+1)
- But logged `previousStock` is 64 (WC stock only)
- This is **expected behavior** - logs reflect WC stock, not dashboard display

**Why This Happens:**
- WooCommerce doesn't know about pending stock (it's only tracked in HIS database)
- When calculating `previousStock`, the system reads current WC stock and adds back the deducted quantity
- Pending stock is a display-only concept for the dashboard

**To Get Dashboard Display Value:**
If you need to know what the dashboard showed before the order, you would need to:
1. Get logged `previousStock` (WC stock)
2. Query `pending_consultation_stock` table for pending stock at that time
3. Add them together: `previousStock + pendingStock = dashboard display`

---

### 3. WooCommerce Product Updates

**Table:** `wc_webhook_logs`

**Stock Information Logged:**
- ✅ **Before:** `previous_stock_quantity` column
- ✅ **After:** `stock_quantity` column
- ✅ **Also in:** `details` JSONB (for additional context)

**Example Query:**
```sql
SELECT 
    entity_id as product_id,
    entity_sku,
    previous_stock_quantity,  -- Stock before (e.g., 100)
    stock_quantity,            -- Stock after (e.g., 95)
    created_at
FROM wc_webhook_logs
WHERE webhook_type = 'product'
AND webhook_event = 'product.updated'
AND entity_sku = 'tad5/10tab'
ORDER BY created_at DESC;
```

---

### 4. Combo SKU Availability Updates

**Table:** `wc_webhook_logs`

**Stock Information Logged:**
- ⚠️ **Only After:** `details.comboUpdates` array with `newStock` (calculated availability)
- ❌ **Not Logged:** Previous combo availability (only the new calculated value)

**Example:**
```json
{
  "comboUpdates": [
    {
      "sku": "kom/tad5(30tab)+tad20(4tab)",
      "newStock": 5  // New calculated availability
    }
  ]
}
```

**Note:** Previous combo stock is not logged because:
- Combo availability is **calculated** from component stocks
- It's not a direct stock change, but a derived value
- You can calculate previous combo stock from previous component stocks if needed

---

### 5. Refund/Return

**Tables:** `procurement_updates`, `activity_logs`

**Stock Information Logged:**
- ✅ **Before:** `previous_quantity` (current stock before restoration)
- ✅ **After:** `new_quantity` (stock after restoration, only if condition = 'good')
- ✅ **Condition:** `return_condition` ('good', 'damaged', 'lost')

**Note:** Stock is only restored if `return_condition = 'good'`. For 'damaged' or 'lost', `new_quantity` = `previous_quantity` (no change).

---

## Summary Table

| Activity Type | Table | Before Stock | After Stock | Location |
|--------------|-------|--------------|-------------|----------|
| Manual Procurement | `procurement_updates` | ✅ `previous_quantity` | ✅ `new_quantity` | Columns |
| Manual Procurement | `activity_logs` | ✅ `details.previousQuantity` | ✅ `details.newQuantity` | JSONB |
| Order Processing | `wc_webhook_logs` | ✅ `details.componentDeductions[].previousStock` | ✅ `details.componentDeductions[].newStock` | JSONB |
| Order Cancellation | `wc_webhook_logs` | ✅ `details.componentRestorations[].previousStock` | ✅ `details.componentRestorations[].newStock` | JSONB |
| Product Update | `wc_webhook_logs` | ✅ `previous_stock_quantity` | ✅ `stock_quantity` | Columns |
| Combo Update | `wc_webhook_logs` | ❌ Not logged | ✅ `details.comboUpdates[].newStock` | JSONB |
| Refund/Return | `procurement_updates` | ✅ `previous_quantity` | ✅ `new_quantity` | Columns |

---

## Query Examples

### Find All Stock Changes for a Specific SKU

```sql
-- Manual changes
SELECT 
    'manual' as source,
    created_at,
    operation,
    previous_quantity as stock_before,
    new_quantity as stock_after
FROM procurement_updates pu
JOIN single_skus ss ON pu.single_sku_id = ss.id
WHERE ss.sku = 'tad5/10tab'
ORDER BY created_at DESC;

-- WooCommerce order changes (component deductions)
SELECT 
    'woocommerce_order' as source,
    created_at,
    'deduction' as operation,
    deduction->>'previousStock' as stock_before,
    deduction->>'newStock' as stock_after
FROM wc_webhook_logs w,
     jsonb_array_elements(w.details->'componentDeductions') as deduction
WHERE deduction->>'sku' = 'tad5/10tab'
ORDER BY created_at DESC;

-- WooCommerce product changes
SELECT 
    'woocommerce_product' as source,
    created_at,
    'update' as operation,
    previous_stock_quantity as stock_before,
    stock_quantity as stock_after
FROM wc_webhook_logs
WHERE webhook_type = 'product'
AND entity_sku = 'tad5/10tab'
ORDER BY created_at DESC;
```

### Calculate Stock History Timeline

```sql
WITH stock_changes AS (
    -- Manual changes
    SELECT 
        created_at,
        'manual' as source,
        previous_quantity as stock_before,
        new_quantity as stock_after
    FROM procurement_updates pu
    JOIN single_skus ss ON pu.single_sku_id = ss.id
    WHERE ss.sku = 'tad5/10tab'
    
    UNION ALL
    
    -- WooCommerce order deductions
    SELECT 
        w.created_at,
        'woocommerce_order' as source,
        (deduction->>'previousStock')::int as stock_before,
        (deduction->>'newStock')::int as stock_after
    FROM wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentDeductions') as deduction
    WHERE deduction->>'sku' = 'tad5/10tab'
    
    UNION ALL
    
    -- WooCommerce product updates
    SELECT 
        created_at,
        'woocommerce_product' as source,
        previous_stock_quantity as stock_before,
        stock_quantity as stock_after
    FROM wc_webhook_logs
    WHERE webhook_type = 'product'
    AND entity_sku = 'tad5/10tab'
)
SELECT 
    created_at,
    source,
    stock_before,
    stock_after,
    stock_after - stock_before as change
FROM stock_changes
ORDER BY created_at DESC;
```

---

## Important Notes

1. **Combo SKU Updates:** Only the new calculated availability is logged, not the previous value. To get previous combo stock, you would need to:
   - Find the previous log entry for that combo
   - Or calculate it from previous component stock values

2. **Order Events:** The `stock_quantity` and `previous_stock_quantity` columns are NULL for order events. Stock information is in the `details.componentDeductions` array.

3. **Product Events:** Use the `stock_quantity` and `previous_stock_quantity` columns directly.

4. **Pending Stock Discrepancy:** When orders are processed directly (skip pending-consult/pending-review), logged `previousStock` reflects WooCommerce stock only, not the dashboard display value (which includes pending stock). See the detailed explanation in Section 2 above.

5. **Timeline Reconstruction:** You can reconstruct the complete stock history by querying all sources and ordering by `created_at`. Note that logged values represent WC stock, not dashboard display values (which include pending stock).

