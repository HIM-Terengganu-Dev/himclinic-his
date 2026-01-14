-- Find Unlogged Stock Changes
-- This query detects discrepancies where stock changed but wasn't logged

-- Step 1: Find all logged stock changes for a specific SKU
WITH logged_changes AS (
    SELECT 
        created_at,
        'manual' as source,
        previous_quantity as stock_before,
        new_quantity as stock_after,
        new_quantity - previous_quantity as change,
        'procurement_updates' as table_name,
        id::text as record_id
    FROM procurement_updates pu
    JOIN single_skus ss ON pu.single_sku_id = ss.id
    WHERE ss.sku = 'iqn100/4tab'  -- Change SKU as needed
    
    UNION ALL
    
    SELECT 
        w.created_at,
        'order_deduction' as source,
        (deduction->>'previousStock')::int as stock_before,
        (deduction->>'newStock')::int as stock_after,
        (deduction->>'newStock')::int - (deduction->>'previousStock')::int as change,
        'wc_webhook_logs' as table_name,
        w.id::text as record_id
    FROM wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentDeductions') AS deduction
    WHERE deduction->>'sku' = 'iqn100/4tab'
    AND w.webhook_type = 'order'
    
    UNION ALL
    
    SELECT 
        w.created_at,
        'order_restoration' as source,
        (restoration->>'previousStock')::int as stock_before,
        (restoration->>'newStock')::int as stock_after,
        (restoration->>'newStock')::int - (restoration->>'previousStock')::int as change,
        'wc_webhook_logs' as table_name,
        w.id::text as record_id
    FROM wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentRestorations') AS restoration
    WHERE restoration->>'sku' = 'iqn100/4tab'
    AND w.webhook_type = 'order'
    
    UNION ALL
    
    SELECT 
        created_at,
        'product_update' as source,
        previous_stock_quantity as stock_before,
        stock_quantity as stock_after,
        stock_quantity - previous_stock_quantity as change,
        'wc_webhook_logs' as table_name,
        id::text as record_id
    FROM wc_webhook_logs
    WHERE webhook_type = 'product'
    AND entity_sku = 'iqn100/4tab'
),
ordered_changes AS (
    SELECT 
        *,
        ROW_NUMBER() OVER (ORDER BY created_at) as change_number
    FROM logged_changes
    ORDER BY created_at
)
-- Step 2: Find gaps where stock_before doesn't match previous stock_after
SELECT 
    c1.created_at as change_1_time,
    c1.stock_before as change_1_before,
    c1.stock_after as change_1_after,
    c1.source as change_1_source,
    c1.record_id as change_1_record_id,
    c2.created_at as change_2_time,
    c2.stock_before as change_2_before,
    c2.stock_after as change_2_after,
    c2.source as change_2_source,
    c2.record_id as change_2_record_id,
    CASE 
        WHEN c1.stock_after != c2.stock_before THEN 
            'UNLOGGED CHANGE DETECTED: Stock went from ' || c1.stock_after || ' to ' || c2.stock_before || 
            ' (missing ' || (c1.stock_after - c2.stock_before) || ' units)'
        ELSE 'OK'
    END as status,
    c1.stock_after - c2.stock_before as missing_units
FROM ordered_changes c1
JOIN ordered_changes c2 ON c2.change_number = c1.change_number + 1
WHERE c1.stock_after != c2.stock_before
ORDER BY c1.created_at;

-- Step 3: Check for failed webhook logs that might indicate unlogged changes
SELECT 
    id,
    entity_id as order_id,
    created_at,
    webhook_event,
    success,
    error_message,
    details->'componentDeductions' as component_deductions
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND success = false
AND created_at >= (
    SELECT MIN(created_at) - INTERVAL '7 days'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id IN (11639, 11648)
)
ORDER BY created_at DESC;

-- Step 4: Check for activity logs indicating webhook log failures
SELECT 
    id,
    created_at,
    action,
    entity_id,
    details,
    error_message
FROM inventory_management.activity_logs
WHERE action = 'webhook_log_failed_after_stock_deduction'
ORDER BY created_at DESC;

