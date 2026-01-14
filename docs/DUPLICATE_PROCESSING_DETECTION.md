# Detecting Duplicate Order Processing

## Overview

If an order goes through the "processing" status multiple times (e.g., `processing → pending consult → processing`), it can cause **double stock deduction**, especially for **combo SKUs** where HIS system writes to WooCommerce.

## Why Combo SKUs Are Affected

### Single SKUs (Safe)
- WooCommerce deducts stock automatically
- HIS system only **reads** current stock to track changes
- Duplicate processing shows same values: `100 → 95` (calculated from current stock)

### Combo SKUs (Problematic)
- HIS system **writes** to WooCommerce (deducts component stocks)
- First processing: Reads stock (100), deducts to 95, logs `100 → 95`
- Second processing: Reads stock (95), deducts to 90, logs `95 → 90`
- **Result: Stock deducted twice!**

## How to Detect in Database

### Method 1: Simple SQL Query

Find all orders processed more than once:

```sql
SELECT 
    entity_id as order_id,
    COUNT(*) as processing_count,
    ARRAY_AGG(id ORDER BY created_at) as log_ids,
    ARRAY_AGG(created_at ORDER BY created_at) as processing_times
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND webhook_event = 'order.processing'
GROUP BY entity_id
HAVING COUNT(*) > 1
ORDER BY processing_count DESC, entity_id DESC;
```

### Method 2: Detailed Component Deduction Analysis

For a specific order, check component deduction values:

```sql
SELECT 
    id,
    entity_id as order_id,
    created_at,
    success,
    details->'componentDeductions' as component_deductions,
    details->'comboSkusOrdered' as combo_skus_ordered
FROM inventory_management.wc_webhook_logs
WHERE entity_id = 12345  -- Replace with order ID
AND webhook_event = 'order.processing'
ORDER BY created_at;
```

**What to Look For:**
- Multiple log entries for the same order
- Different `created_at` timestamps
- Different `previousStock` values in `componentDeductions` (shows double deduction)
- Example:
  - First log: `"tad5/10tab": {"previousStock": 87, "newStock": 84}`
  - Second log: `"tad5/10tab": {"previousStock": 84, "newStock": 81}` ← **Double deduction detected!**

### Method 3: Find Orders with Combo SKUs That Were Processed Multiple Times

```sql
SELECT 
    w.entity_id as order_id,
    COUNT(*) as processing_count,
    w.details->'comboSkusOrdered' as combo_skus,
    ARRAY_AGG(w.created_at ORDER BY w.created_at) as processing_times
FROM inventory_management.wc_webhook_logs w
WHERE w.webhook_type = 'order'
AND w.webhook_event = 'order.processing'
AND w.details->'comboSkusOrdered' IS NOT NULL
AND jsonb_array_length(w.details->'comboSkusOrdered') > 0
GROUP BY w.entity_id, w.details->'comboSkusOrdered'
HAVING COUNT(*) > 1
ORDER BY processing_count DESC;
```

## Prevention

The system now includes **idempotency protection** that:
1. Checks for previous successful processing logs
2. Skips duplicate processing to prevent double deduction
3. Allows reprocessing if order was cancelled (stock was restored)

## Manual Verification

To verify if an order was processed multiple times:

1. **Check Activity Log > WooCommerce tab:**
   - Filter by order ID
   - Look for multiple "Processing" entries with different timestamps

2. **Check Component Deductions:**
   - Compare `previousStock` values between entries
   - If they match the `newStock` from previous entry → duplicate processing detected

3. **Example:**
   ```
   Order #12345 - First Processing (14:30:25):
   - tad5/10tab: 87 → 84
   
   Order #12345 - Second Processing (15:45:10):
   - tad5/10tab: 84 → 81  ← Shows double deduction!
   ```

## Using the Helper Function

A helper function `findDuplicateProcessingOrders()` is available in `lib/db/queries.ts` that:
- Finds all orders with duplicate processing
- Returns detailed component deduction information
- Identifies which orders have combo SKUs (most at risk)

Example usage (in API route or script):
```typescript
import { findDuplicateProcessingOrders } from '@/lib/db/queries';

const duplicates = await findDuplicateProcessingOrders();
// Returns array of orders with processing_count > 1
// Each entry includes detailed component deduction info
```

