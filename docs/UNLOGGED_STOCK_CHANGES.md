# Unlogged Stock Changes - Debugging Guide

## Problem

Stock was deducted (14 → 13) but no activity was logged in the database. This indicates a **critical bug** where stock changes happen but aren't recorded.

## Possible Causes

### 1. **Webhook Logging Failed After Stock Deduction** ⚠️ CRITICAL
**Location:** `app/api/webhooks/orders/route.ts` lines 271-398

**The Issue:**
- Line 271: Stock is deducted in WooCommerce (`updateProductStock`)
- Line 398: Log is written to database (`logWcWebhook`)
- **If logging fails, stock is already deducted but not logged!**

**Current Code Flow:**
```typescript
// 1. Deduct stock in WooCommerce (line 271)
await updateProductStock(wcProductId, newStock);  // ✅ Stock changed

// 2. Add to tracking array (line 273)
singleSkuUpdates.push({...});

// 3. Later, log to database (line 398)
await logWcWebhook({...});  // ❌ If this fails, no log!
```

**What Can Go Wrong:**
- Database connection timeout
- Database write failure
- Network error
- Server crash/timeout after stock deduction but before logging

### 2. **WooCommerce Direct Stock Update**
- Someone manually updated stock in WooCommerce admin
- Stock was changed via WooCommerce REST API directly
- Stock was changed by another plugin/system

### 3. **Failed Webhook (Partial Processing)**
- Webhook was received and stock was deducted
- But webhook handler crashed/timed out before logging
- No error log was created

### 4. **Race Condition**
- Multiple webhooks processed simultaneously
- One webhook read stock, another deducted it
- Logging happened with stale stock values

## How to Detect

### Check for Failed Webhook Logs

```sql
-- Find webhook logs with success = false
SELECT 
    id,
    entity_id as order_id,
    created_at,
    webhook_event,
    success,
    error_message,
    details
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND success = false
AND created_at >= '2026-01-01'  -- Adjust date
ORDER BY created_at DESC;
```

### Check for Missing Logs Between Orders

```sql
-- Find orders that should have logs but don't
-- Compare WooCommerce order timestamps with webhook logs
SELECT 
    wc_order_id,
    wc_order_date,
    wc_status,
    CASE 
        WHEN wl.id IS NULL THEN 'MISSING LOG'
        WHEN wl.success = false THEN 'FAILED LOG'
        ELSE 'OK'
    END as log_status,
    wl.created_at as log_created_at,
    wl.error_message
FROM (
    -- This would need to query WooCommerce API or have a sync table
    -- For now, check manually
    SELECT 11639 as wc_order_id, 'processing' as wc_status
    UNION ALL
    SELECT 11640, 'processing'
    UNION ALL
    SELECT 11641, 'processing'
    -- Add all orders between 11639 and 11648
) orders
LEFT JOIN inventory_management.wc_webhook_logs wl 
    ON wl.entity_id = orders.wc_order_id 
    AND wl.webhook_event = 'order.processing'
ORDER BY wc_order_id;
```

### Reconciliation: Compare Expected vs Actual Stock

```sql
-- Calculate expected stock based on all logged activities
WITH stock_changes AS (
    -- Manual changes
    SELECT 
        pu.created_at,
        ss.sku,
        pu.previous_quantity as stock_before,
        pu.new_quantity as stock_after,
        pu.new_quantity - pu.previous_quantity as change
    FROM procurement_updates pu
    JOIN single_skus ss ON pu.single_sku_id = ss.id
    WHERE ss.sku = 'iqn100/4tab'
    
    UNION ALL
    
    -- Order deductions
    SELECT 
        w.created_at,
        deduction->>'sku' as sku,
        (deduction->>'previousStock')::int as stock_before,
        (deduction->>'newStock')::int as stock_after,
        (deduction->>'newStock')::int - (deduction->>'previousStock')::int as change
    FROM wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentDeductions') AS deduction
    WHERE deduction->>'sku' = 'iqn100/4tab'
    AND w.webhook_type = 'order'
    
    UNION ALL
    
    -- Order restorations
    SELECT 
        w.created_at,
        restoration->>'sku' as sku,
        (restoration->>'previousStock')::int as stock_before,
        (restoration->>'newStock')::int as stock_after,
        (restoration->>'newStock')::int - (restoration->>'previousStock')::int as change
    FROM wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentRestorations') AS restoration
    WHERE restoration->>'sku' = 'iqn100/4tab'
    AND w.webhook_type = 'order'
    
    UNION ALL
    
    -- Product updates
    SELECT 
        created_at,
        entity_sku as sku,
        previous_stock_quantity as stock_before,
        stock_quantity as stock_after,
        stock_quantity - previous_stock_quantity as change
    FROM wc_webhook_logs
    WHERE webhook_type = 'product'
    AND entity_sku = 'iqn100/4tab'
)
SELECT 
    created_at,
    stock_before,
    stock_after,
    change,
    SUM(change) OVER (ORDER BY created_at) as running_total
FROM stock_changes
ORDER BY created_at;
```

## Solutions

### Immediate Fix: Add Transaction Safety

**Problem:** Stock is deducted before logging. If logging fails, we lose the record.

**Solution Options:**

1. **Log First, Then Deduct** (Recommended)
   - Log the intended change first (with status "pending")
   - Then deduct stock
   - Update log status to "completed"
   - If deduction fails, update log to "failed"

2. **Add Rollback on Log Failure**
   - Deduct stock
   - Try to log
   - If logging fails, rollback stock change
   - **Problem:** WooCommerce API might not support rollback easily

3. **Add Retry Logic**
   - If logging fails, retry
   - Store failed logs in a queue for retry
   - Alert admin if retries fail

4. **Add Reconciliation Job**
   - Periodically check WooCommerce stock vs logged changes
   - Flag discrepancies
   - Create missing log entries

### Long-term Fix: Idempotent Operations

- Use order ID + timestamp as unique identifier
- Check if operation already logged before executing
- Prevent duplicate processing

## Detection Query

Run this to find potential unlogged changes:

```sql
-- Find time gaps in stock changes that don't match logged activities
WITH logged_changes AS (
    -- All logged stock changes for iqn100/4tab
    SELECT 
        created_at,
        'logged' as source,
        stock_before,
        stock_after
    FROM (
        -- Manual
        SELECT pu.created_at, pu.previous_quantity as stock_before, pu.new_quantity as stock_after
        FROM procurement_updates pu
        JOIN single_skus ss ON pu.single_sku_id = ss.id
        WHERE ss.sku = 'iqn100/4tab'
        
        UNION ALL
        
        -- Order deductions
        SELECT w.created_at, 
               (deduction->>'previousStock')::int, 
               (deduction->>'newStock')::int
        FROM wc_webhook_logs w,
             jsonb_array_elements(w.details->'componentDeductions') AS deduction
        WHERE deduction->>'sku' = 'iqn100/4tab'
        
        UNION ALL
        
        -- Product updates
        SELECT created_at, previous_stock_quantity, stock_quantity
        FROM wc_webhook_logs
        WHERE webhook_type = 'product' AND entity_sku = 'iqn100/4tab'
    ) changes
    ORDER BY created_at
)
SELECT 
    l1.created_at as change_time,
    l1.stock_after as expected_next_stock,
    l2.stock_before as actual_next_stock,
    l2.created_at as next_change_time,
    CASE 
        WHEN l1.stock_after != l2.stock_before THEN 'DISCREPANCY DETECTED'
        ELSE 'OK'
    END as status
FROM logged_changes l1
JOIN logged_changes l2 ON l2.created_at > l1.created_at
WHERE l1.stock_after != l2.stock_before
ORDER BY l1.created_at;
```

