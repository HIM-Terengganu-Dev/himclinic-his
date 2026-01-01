-- ========================================
-- Test Insert: Combo SKU "kom/A+B" Order
-- ========================================
-- Minimal required fields to test component deductions display
-- ========================================

INSERT INTO inventory_management.wc_webhook_logs (
    webhook_type,           -- REQUIRED: 'order' or 'product'
    webhook_event,          -- REQUIRED: e.g., 'order.processing'
    entity_id,              -- REQUIRED: Order ID (any number for testing)
    entity_sku,             -- REQUIRED for display: First SKU from order
    entity_name,            -- REQUIRED for display: Order name
    status,                 -- REQUIRED for display: Order status
    affected_skus,           -- REQUIRED for SKU column: All SKUs ordered
    details,                -- REQUIRED for component deductions: Full payload
    success                 -- REQUIRED: true/false
) VALUES (
    'order',                -- Must be 'order' for order webhooks
    'order.processing',     -- Event type
    99999,                  -- Dummy order ID
    'kom/A+B',              -- First SKU (the combo SKU itself)
    'Order #99999',         -- Display name
    'processing',           -- Order status
    '["kom/A+B"]'::jsonb,   -- All SKUs in order (for SKU column display)
    '{
        "orderId": 99999,
        "status": "processing",
        "lineItems": [
            {
                "sku": "kom/A+B",
                "name": "KOM A+B Combo",
                "quantity": 2
            }
        ],
        "comboSkusOrdered": ["kom/A+B"],
        "componentDeductions": [
            {
                "sku": "A",
                "previousStock": 20,
                "newStock": 18,
                "isWcSide": false
            },
            {
                "sku": "B",
                "previousStock": 15,
                "newStock": 13,
                "isWcSide": false
            }
        ],
        "comboUpdates": [
            {
                "sku": "kom/A+B",
                "newStock": 6
            }
        ],
        "note": "Combo SKU ordered. System deducted component single SKU stocks."
    }'::jsonb,
    true
);

-- Verify the insert
SELECT 
    id,
    entity_id,
    entity_sku,
    entity_name,
    jsonb_array_length(details->'componentDeductions') as component_deductions_count,
    details->'componentDeductions' as component_deductions,
    created_at
FROM inventory_management.wc_webhook_logs
WHERE entity_id = 99999;

-- To clean up:
-- DELETE FROM inventory_management.wc_webhook_logs WHERE entity_id = 99999;

