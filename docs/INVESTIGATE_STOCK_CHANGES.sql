-- Investigate Stock Changes for iqn100/4tab between Orders #11639 and #11648
-- Stock progression: 17 → 14 → 13 → 12
-- Need to find what caused 14 → 13

-- Step 1: Find the exact SKU and timestamps for both orders
SELECT 
    'Order Info' as step,
    entity_id as order_id,
    created_at,
    entity_sku,
    affected_skus,
    details->'lineItems' as line_items
FROM inventory_management.wc_webhook_logs
WHERE entity_id IN (11639, 11648)
AND webhook_event = 'order.processing'
ORDER BY entity_id, created_at;

-- Step 2: Find all order processing activities affecting iqn100 components
-- (assuming the SKU might be iqn100/4tab or similar)
SELECT 
    'Order Processing' as activity_type,
    entity_id as order_id,
    created_at,
    entity_sku,
    details->'componentDeductions' as component_deductions,
    details->'componentRestorations' as component_restorations
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND (
    -- Check if iqn100 appears in component deductions
    EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(details->'componentDeductions') AS deduction
        WHERE deduction->>'sku' LIKE 'iqn100%'
    )
    OR
    -- Check if iqn100 appears in component restorations
    EXISTS (
        SELECT 1 
        FROM jsonb_array_elements(details->'componentRestorations') AS restoration
        WHERE restoration->>'sku' LIKE 'iqn100%'
    )
    OR
    -- Check if iqn100 is in affected SKUs
    affected_skus::text LIKE '%iqn100%'
    OR
    -- Check if iqn100 is the entity SKU
    entity_sku LIKE 'iqn100%'
)
AND created_at >= (
    SELECT MIN(created_at) - INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11639
    AND webhook_event = 'order.processing'
)
AND created_at <= (
    SELECT MAX(created_at) + INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11648
    AND webhook_event = 'order.processing'
)
ORDER BY created_at;

-- Step 3: Find manual procurement updates for iqn100
SELECT 
    'Manual Procurement' as activity_type,
    pu.id,
    pu.created_at,
    ss.sku,
    pu.operation,
    pu.previous_quantity,
    pu.new_quantity,
    pu.quantity,
    pu.notes,
    al.details
FROM inventory_management.procurement_updates pu
JOIN inventory_management.single_skus ss ON pu.single_sku_id = ss.id
LEFT JOIN inventory_management.activity_logs al ON al.entity_type = 'procurement_update' AND al.entity_id = pu.id
WHERE ss.sku LIKE 'iqn100%'
AND pu.created_at >= (
    SELECT MIN(created_at) - INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11639
    AND webhook_event = 'order.processing'
)
AND pu.created_at <= (
    SELECT MAX(created_at) + INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11648
    AND webhook_event = 'order.processing'
)
ORDER BY pu.created_at;

-- Step 4: Find product webhook updates for iqn100
SELECT 
    'Product Update' as activity_type,
    entity_id as product_id,
    created_at,
    entity_sku,
    previous_stock_quantity,
    stock_quantity,
    details
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'product'
AND entity_sku LIKE 'iqn100%'
AND created_at >= (
    SELECT MIN(created_at) - INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11639
    AND webhook_event = 'order.processing'
)
AND created_at <= (
    SELECT MAX(created_at) + INTERVAL '1 day'
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id = 11648
    AND webhook_event = 'order.processing'
)
ORDER BY created_at;

-- Step 5: Comprehensive timeline of ALL stock changes for iqn100
-- This combines all sources to show the complete picture
WITH order_times AS (
    SELECT 
        MIN(created_at) - INTERVAL '1 day' as start_time,
        MAX(created_at) + INTERVAL '1 day' as end_time
    FROM inventory_management.wc_webhook_logs
    WHERE entity_id IN (11639, 11648)
    AND webhook_event = 'order.processing'
),
manual_changes AS (
    SELECT 
        pu.created_at,
        'Manual: ' || pu.operation as activity_type,
        ss.sku,
        pu.previous_quantity as stock_before,
        pu.new_quantity as stock_after,
        pu.quantity as change_amount,
        pu.notes,
        NULL::text as order_id,
        NULL::text as source
    FROM inventory_management.procurement_updates pu
    JOIN inventory_management.single_skus ss ON pu.single_sku_id = ss.id
    CROSS JOIN order_times ot
    WHERE ss.sku LIKE 'iqn100%'
    AND pu.created_at BETWEEN ot.start_time AND ot.end_time
),
order_deductions AS (
    SELECT 
        w.created_at,
        'Order: Deduction' as activity_type,
        deduction->>'sku' as sku,
        (deduction->>'previousStock')::int as stock_before,
        (deduction->>'newStock')::int as stock_after,
        (deduction->>'deductedQty')::int as change_amount,
        NULL as notes,
        w.entity_id::text as order_id,
        'WC' as source
    FROM inventory_management.wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentDeductions') AS deduction
    CROSS JOIN order_times ot
    WHERE w.webhook_type = 'order'
    AND w.webhook_event = 'order.processing'
    AND deduction->>'sku' LIKE 'iqn100%'
    AND w.created_at BETWEEN ot.start_time AND ot.end_time
),
order_restorations AS (
    SELECT 
        w.created_at,
        'Order: Restoration' as activity_type,
        restoration->>'sku' as sku,
        (restoration->>'previousStock')::int as stock_before,
        (restoration->>'newStock')::int as stock_after,
        (restoration->>'restoredQty')::int as change_amount,
        NULL as notes,
        w.entity_id::text as order_id,
        'WC' as source
    FROM inventory_management.wc_webhook_logs w,
         jsonb_array_elements(w.details->'componentRestorations') AS restoration
    CROSS JOIN order_times ot
    WHERE w.webhook_type = 'order'
    AND w.webhook_event LIKE 'order.cancelled%'
    AND restoration->>'sku' LIKE 'iqn100%'
    AND w.created_at BETWEEN ot.start_time AND ot.end_time
),
product_updates AS (
    SELECT 
        w.created_at,
        'Product: Update' as activity_type,
        w.entity_sku as sku,
        w.previous_stock_quantity as stock_before,
        w.stock_quantity as stock_after,
        w.stock_quantity - w.previous_stock_quantity as change_amount,
        NULL as notes,
        NULL::text as order_id,
        'WC' as source
    FROM inventory_management.wc_webhook_logs w
    CROSS JOIN order_times ot
    WHERE w.webhook_type = 'product'
    AND w.entity_sku LIKE 'iqn100%'
    AND w.created_at BETWEEN ot.start_time AND ot.end_time
)
SELECT 
    created_at,
    activity_type,
    sku,
    stock_before,
    stock_after,
    change_amount,
    notes,
    order_id,
    source
FROM (
    SELECT * FROM manual_changes
    UNION ALL
    SELECT * FROM order_deductions
    UNION ALL
    SELECT * FROM order_restorations
    UNION ALL
    SELECT * FROM product_updates
) combined
ORDER BY created_at;

