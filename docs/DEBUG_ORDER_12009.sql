-- Debug Order #12009 and #11941
-- Check what's logged and what pending stock exists

-- Step 1: Get all webhook logs for both orders
SELECT 
    id,
    entity_id as order_id,
    webhook_event,
    status,
    created_at,
    entity_sku,
    affected_skus,
    details->'componentDeductions' as component_deductions,
    details->'lineItems' as line_items,
    details->'pendingStockUpdates' as pending_stock_updates
FROM inventory_management.wc_webhook_logs
WHERE entity_id IN (12009, 11941)
ORDER BY entity_id, created_at;

-- Step 2: Check pending consultation stock for both orders
SELECT 
    order_id,
    sku,
    quantity,
    status,
    created_at,
    updated_at
FROM inventory_management.pending_consultation_stock
WHERE order_id IN (12009, 11941)
ORDER BY order_id, created_at;

-- Step 3: Find all pending-consult/pending-review logs BEFORE order 12009 was processed
-- This helps identify what pending stock should have existed
SELECT 
    id,
    entity_id as order_id,
    webhook_event,
    status,
    created_at,
    details->'pendingStockUpdates' as pending_stock_updates
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND (webhook_event = 'order.pending-consult' OR webhook_event = 'order.pending-review')
AND created_at < (
    SELECT created_at 
    FROM inventory_management.wc_webhook_logs 
    WHERE entity_id = 12009 
    AND webhook_event = 'order.processing'
    LIMIT 1
)
AND details->'pendingStockUpdates' IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- Step 4: Get the specific component deduction for order 12009
-- Replace 'SKU_HERE' with the actual SKU you're debugging
SELECT 
    entity_id as order_id,
    created_at,
    deduction->>'sku' as sku,
    (deduction->>'previousStock')::int as previous_stock,
    (deduction->>'newStock')::int as new_stock,
    (deduction->>'deductedQty')::int as deducted_qty,
    (deduction->>'isWcSide')::boolean as is_wc_side
FROM inventory_management.wc_webhook_logs,
     jsonb_array_elements(details->'componentDeductions') AS deduction
WHERE entity_id = 12009
AND webhook_event = 'order.processing'
ORDER BY deduction->>'sku';

-- Step 5: Check if order 12009 had a pending-consult log before processing
SELECT 
    id,
    entity_id as order_id,
    webhook_event,
    status,
    created_at,
    details->'pendingStockUpdates' as pending_stock_updates
FROM inventory_management.wc_webhook_logs
WHERE entity_id = 12009
ORDER BY created_at;

