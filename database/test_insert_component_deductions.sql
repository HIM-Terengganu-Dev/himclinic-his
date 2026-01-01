-- ========================================
-- Test Insert: Component Deductions Display
-- ========================================
-- This SQL script inserts test data to verify the component deductions display
-- in the Activity Log > WooCommerce tab
-- ========================================

-- Example 1: Order with single SKU (WC-side deduction)
INSERT INTO inventory_management.wc_webhook_logs (
    webhook_type,
    webhook_event,
    entity_id,
    entity_sku,
    entity_name,
    status,
    affected_skus,
    details,
    success,
    created_at
) VALUES (
    'order',
    'order.processing',
    99999,
    'TEST-SKU-001',  -- First SKU from order
    'Order #99999',
    'processing',
    '["TEST-SKU-001"]'::jsonb,  -- All SKUs ordered
    '{
        "orderId": 99999,
        "status": "processing",
        "lineItems": [
            {"sku": "TEST-SKU-001", "name": "Test Product 1", "quantity": 5}
        ],
        "componentDeductions": [
            {
                "sku": "TEST-SKU-001",
                "previousStock": 15,
                "newStock": 10,
                "deductedQty": 5,
                "isWcSide": true
            }
        ],
        "comboUpdates": [],
        "note": "Single SKU ordered. WooCommerce deducted stock."
    }'::jsonb,
    true,
    CURRENT_TIMESTAMP
);

-- Example 2: Order with combo SKU (HIS system deduction)
INSERT INTO inventory_management.wc_webhook_logs (
    webhook_type,
    webhook_event,
    entity_id,
    entity_sku,
    entity_name,
    status,
    affected_skus,
    details,
    success,
    created_at
) VALUES (
    'order',
    'order.processing',
    99998,
    'COMBO-TEST-001',
    'Order #99998',
    'processing',
    '["COMBO-TEST-001"]'::jsonb,
    '{
        "orderId": 99998,
        "status": "processing",
        "lineItems": [
            {"sku": "COMBO-TEST-001", "name": "Test Combo", "quantity": 2}
        ],
        "comboSkusOrdered": ["COMBO-TEST-001"],
        "componentDeductions": [
            {
                "sku": "COMPONENT-A",
                "previousStock": 20,
                "newStock": 16,
                "isWcSide": false
            },
            {
                "sku": "COMPONENT-B",
                "previousStock": 15,
                "newStock": 11,
                "isWcSide": false
            }
        ],
        "comboUpdates": [
            {"sku": "COMBO-TEST-001", "newStock": 5}
        ],
        "note": "Combo SKU ordered. System deducted component single SKU stocks."
    }'::jsonb,
    true,
    CURRENT_TIMESTAMP
);

-- Example 3: Order with both single SKU and combo SKU (mixed deductions)
INSERT INTO inventory_management.wc_webhook_logs (
    webhook_type,
    webhook_event,
    entity_id,
    entity_sku,
    entity_name,
    status,
    affected_skus,
    details,
    success,
    created_at
) VALUES (
    'order',
    'order.processing',
    99997,
    'SINGLE-TEST-001',
    'Order #99997',
    'processing',
    '["SINGLE-TEST-001", "COMBO-MIXED-001"]'::jsonb,
    '{
        "orderId": 99997,
        "status": "processing",
        "lineItems": [
            {"sku": "SINGLE-TEST-001", "name": "Single Product", "quantity": 3},
            {"sku": "COMBO-MIXED-001", "name": "Mixed Combo", "quantity": 1}
        ],
        "comboSkusOrdered": ["COMBO-MIXED-001"],
        "componentDeductions": [
            {
                "sku": "SINGLE-TEST-001",
                "previousStock": 25,
                "newStock": 22,
                "deductedQty": 3,
                "isWcSide": true
            },
            {
                "sku": "COMPONENT-X",
                "previousStock": 30,
                "newStock": 28,
                "isWcSide": false
            },
            {
                "sku": "COMPONENT-Y",
                "previousStock": 18,
                "newStock": 16,
                "isWcSide": false
            }
        ],
        "comboUpdates": [
            {"sku": "COMBO-MIXED-001", "newStock": 8}
        ],
        "note": "Mixed order: Single SKU (WC deduction) + Combo SKU (HIS deduction)"
    }'::jsonb,
    true,
    CURRENT_TIMESTAMP
);

-- Example 4: Product webhook (stock reconciliation)
INSERT INTO inventory_management.wc_webhook_logs (
    webhook_type,
    webhook_event,
    entity_id,
    entity_sku,
    entity_name,
    status,
    stock_quantity,
    affected_skus,
    details,
    success,
    created_at
) VALUES (
    'product',
    'product.updated',
    88888,
    'PROD-TEST-001',
    'Test Product Reconciliation',
    'stock_reconciled',
    42,  -- New stock quantity
    '["PROD-TEST-001"]'::jsonb,
    '{
        "productId": 88888,
        "singleSku": "PROD-TEST-001",
        "newStock": 42,
        "comboUpdates": [
            {"sku": "COMBO-A", "newStock": 10},
            {"sku": "COMBO-B", "newStock": 5}
        ],
        "note": "Product stock updated in WooCommerce. Combo SKU availability recalculated."
    }'::jsonb,
    true,
    CURRENT_TIMESTAMP
);

-- Verify the test data was inserted
SELECT 
    id,
    webhook_type,
    entity_id,
    entity_sku,
    entity_name,
    jsonb_array_length(details->'componentDeductions') as component_deductions_count,
    jsonb_array_length(details->'comboUpdates') as combo_updates_count,
    created_at
FROM inventory_management.wc_webhook_logs
WHERE entity_id IN (99999, 99998, 99997, 88888)
ORDER BY created_at DESC;

-- To clean up test data later, run:
-- DELETE FROM inventory_management.wc_webhook_logs WHERE entity_id IN (99999, 99998, 99997, 88888);

