-- ============================================
-- Quick Test: Insert Error Log Actions
-- ============================================
-- Based on schema: action is character varying (VARCHAR)
-- This means it CAN accept any string value
-- ============================================

-- Test 1: webhook_log_failed_after_stock_deduction
INSERT INTO inventory_management.activity_logs
(action, entity_type, entity_id, details, success, error_message)
VALUES (
    'webhook_log_failed_after_stock_deduction',
    'order',
    99999,
    '{"test": true, "orderId": 99999, "note": "Test insert"}'::jsonb,
    false,
    'Test error message - can be deleted'
)
RETURNING id, action, created_at;

-- Test 2: webhook_log_failed_after_stock_restoration
INSERT INTO inventory_management.activity_logs
(action, entity_type, entity_id, details, success, error_message)
VALUES (
    'webhook_log_failed_after_stock_restoration',
    'order',
    99999,
    '{"test": true, "orderId": 99999, "note": "Test insert"}'::jsonb,
    false,
    'Test error message - can be deleted'
)
RETURNING id, action, created_at;

-- Test 3: webhook_log_failed_product_update
INSERT INTO inventory_management.activity_logs
(action, entity_type, entity_id, details, success, error_message)
VALUES (
    'webhook_log_failed_product_update',
    'product',
    99999,
    '{"test": true, "productId": 99999, "note": "Test insert"}'::jsonb,
    false,
    'Test error message - can be deleted'
)
RETURNING id, action, created_at;

-- Clean up test records (optional - uncomment to delete)
-- DELETE FROM inventory_management.activity_logs 
-- WHERE entity_id = 99999 AND error_message = 'Test error message - can be deleted';

-- ============================================
-- Expected Result: All three inserts succeed
-- ============================================
-- If all three RETURNING statements show the inserted records,
-- then the table CAN accept these action values ✅
-- ============================================

