# Inventory Tracing Strategy for inventory_management Schema

## Overview

This document outlines the strategy to trace the current `in_warehouse` count from the `inventory_management.wc_webhook_logs` table, starting from a known baseline count at **2026-01-22 13:00:00**.

## Key Assumptions

1. **Baseline**: We have a correct `in_warehouse` count at **2026-01-22 13:00:00**
2. **Trust Only**: Only trust webhook log events (order events), NOT the `stock_quantity` or `previous_stock_quantity` fields in the database
3. **Event Types**: The schema tracks:
   - `order.processing` - Order shipped out (deducts from warehouse)
   - `order.pending-consult` - Order pending consultation (tracks but doesn't deduct)
   - `order.pending-review` - Order pending review (tracks but doesn't deduct)
   - `order.cancelled` - Order cancelled (restore if was processing, remove if was pending)

## Data Structure in Webhook Logs

### `order.pending-consult` / `order.pending-review`
```json
{
  "lineItems": [{"sku": "sku1", "name": "Product", "quantity": 2}],
  "pendingStockUpdates": [
    {"sku": "component1", "isCombo": false, "wcStock": 100, "quantity": 1},
    {"sku": "component2", "isCombo": false, "wcStock": 50, "quantity": 1}
  ]
}
```
- **Action**: Track but **DO NOT deduct** from `in_warehouse`
- These orders are not yet shipped, so stock is still in warehouse

### `order.processing`
```json
{
  "lineItems": [{"sku": "sku1", "name": "Product", "quantity": 2}],
  "componentDeductions": [
    {"sku": "component1", "deductedQty": 1, "previousStock": 100, "newStock": 99},
    {"sku": "component2", "deductedQty": 1, "previousStock": 50, "newStock": 49}
  ]
}
```
- **Action**: **DEDUCT** from `in_warehouse`
- For direct SKU orders: Use `lineItems[].quantity`
- For combo SKU orders: Use `componentDeductions[].deductedQty` (these are the actual component quantities deducted)

### `order.cancelled`
```json
{
  "lineItems": [{"sku": "sku1", "name": "Product", "quantity": 2}],
  "componentRestorations": [
    {"sku": "component1", "restoredQty": 1, "previousStock": 99, "newStock": 100}
  ]
}
```
- **Action**: **RESTORE** to `in_warehouse` if order was previously `processing`
- **Action**: **NO CHANGE** if order was previously `pending-consult` or `pending-review` (stock was never deducted)
- Need to check order history to determine previous state

## Tracing Algorithm

### Step 1: Initialize Baseline
```sql
-- Start with known count at 2026-01-22 13:00:00
in_warehouse[sku] = baseline_count[sku]
```

### Step 2: Process Events Chronologically
For each webhook log entry after `2026-01-22 13:00:00`, ordered by `created_at`:

#### For `order.pending-consult` or `order.pending-review`:
```javascript
// Track order state but DON'T deduct
trackPendingOrder(orderId, {
  skus: extractFromLineItems(lineItems),
  components: extractFromPendingUpdates(pendingStockUpdates)
});
// in_warehouse remains unchanged
```

#### For `order.processing`:
```javascript
// Check if order was previously pending
if (orderWasPending(orderId)) {
  // Order moved from pending to processing
  // Remove from pending tracking, but DON'T deduct (already tracked)
  removePendingOrder(orderId);
} else {
  // Order directly to processing (no pending state)
  // DEDUCT from in_warehouse
  for (const item of lineItems) {
    if (isComboSku(item.sku)) {
      // For combo SKUs, deduct components
      for (const deduction of componentDeductions) {
        in_warehouse[deduction.sku] -= deduction.deductedQty;
      }
    } else {
      // For single SKUs, deduct directly
      in_warehouse[item.sku] -= item.quantity;
    }
  }
}
```

#### For `order.cancelled`:
```javascript
// Check order history to determine previous state
const previousState = getOrderPreviousState(orderId);

if (previousState === 'processing') {
  // Order was shipped, now cancelled - RESTORE stock
  for (const item of lineItems) {
    if (isComboSku(item.sku)) {
      // For combo SKUs, restore components
      for (const restoration of componentRestorations) {
        in_warehouse[restoration.sku] += restoration.restoredQty;
      }
    } else {
      // For single SKUs, restore directly
      in_warehouse[item.sku] += item.quantity;
    }
  }
} else if (previousState === 'pending-consult' || previousState === 'pending-review') {
  // Order was pending, now cancelled - NO CHANGE (stock was never deducted)
  // Just remove from pending tracking
  removePendingOrder(orderId);
}
```

### Step 3: Handle Order State Tracking

We need to track the lifecycle of each order:

```javascript
const orderStates = new Map(); // orderId -> current state

// When processing pending-consult/pending-review:
orderStates.set(orderId, 'pending-consult' or 'pending-review');

// When processing processing:
if (orderStates.has(orderId)) {
  // Was pending, now processing
  orderStates.set(orderId, 'processing');
} else {
  // Directly to processing
  orderStates.set(orderId, 'processing');
  // Deduct stock
}

// When processing cancelled:
const previousState = orderStates.get(orderId);
if (previousState === 'processing') {
  // Restore stock
} else {
  // Just remove tracking
}
orderStates.delete(orderId);
```

## SQL Query Strategy

### Get all order events chronologically:
```sql
SELECT 
    entity_id as order_id,
    webhook_event,
    status,
    affected_skus,
    details,
    created_at
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
    AND created_at >= '2026-01-22 13:00:00'
    AND success = true  -- Only trust successful webhook logs
ORDER BY created_at ASC, id ASC  -- Process chronologically
```

### Extract quantities from details:
```sql
-- For processing events - get component deductions
SELECT 
    entity_id,
    jsonb_array_elements(details->'componentDeductions') as deduction
FROM inventory_management.wc_webhook_logs
WHERE webhook_event = 'order.processing'
    AND details->'componentDeductions' IS NOT NULL

-- For cancelled events - get component restorations
SELECT 
    entity_id,
    jsonb_array_elements(details->'componentRestorations') as restoration
FROM inventory_management.wc_webhook_logs
WHERE webhook_event = 'order.cancelled'
    AND details->'componentRestorations' IS NOT NULL
```

## Implementation Considerations

1. **Combo SKU Handling**: 
   - Combo SKUs don't have direct stock - only their components do
   - Always use `componentDeductions` or `componentRestorations` for combo orders
   - Use `lineItems[].quantity` for single SKU orders

2. **Order State Tracking**:
   - Must track order lifecycle to know if cancelled order was previously processing or pending
   - Process events chronologically to maintain correct state

3. **Edge Cases**:
   - Orders that go directly to `processing` (no pending state) - deduct immediately
   - Orders cancelled after `processing` - restore stock
   - Orders cancelled after `pending-consult`/`pending-review` - no stock change

4. **Validation**:
   - Compare calculated count with current database count to identify discrepancies
   - Flag orders with missing or incomplete data in `details` field

## Example Calculation

Starting from baseline at 2026-01-22 13:00:00:
- `tra/10tab`: 14 units

Events:
1. Order #11915: `pending-review` for `tra/30tab` (combo) - **NO CHANGE** (still 14)
2. Order #11915: `processing` for `tra/30tab` - Deduct 1x `tra/10tab` component → **13 units**
3. Order #11919: `pending-consult` for `kom/tad20+tra` (combo) - **NO CHANGE** (still 13)
4. Order #11854: `processing` for `iqn100/4tab` (single) - Deduct 2 units → **11 units** (if same SKU, otherwise different SKU)

## Next Steps

1. Create a script to implement this tracing algorithm
2. Validate against known baseline counts
3. Generate a report showing current calculated `in_warehouse` vs database values
4. Identify discrepancies and flag potential data issues
