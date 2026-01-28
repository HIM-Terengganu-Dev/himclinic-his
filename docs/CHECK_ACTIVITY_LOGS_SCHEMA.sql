-- ============================================
-- Check activity_logs Table Schema and Constraints
-- ============================================
-- This script checks if the activity_logs table can accept
-- the new error log action values:
-- - webhook_log_failed_after_stock_deduction
-- - webhook_log_failed_after_stock_restoration
-- - webhook_log_failed_product_update
-- ============================================

-- 1. Check column data type and constraints
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default,
    udt_name
FROM information_schema.columns
WHERE table_schema = 'inventory_management'
AND table_name = 'activity_logs'
AND column_name = 'action'
ORDER BY ordinal_position;

-- 2. Check for CHECK constraints on action column
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'inventory_management.activity_logs'::regclass
AND (pg_get_constraintdef(oid) LIKE '%action%' OR contype = 'c')
ORDER BY conname;

-- 3. Check if action column uses an ENUM type
SELECT 
    t.typname as enum_name,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname LIKE '%action%' OR t.typname LIKE '%activity%'
GROUP BY t.typname
ORDER BY t.typname;

-- 4. Check current distinct action values in the table
SELECT DISTINCT action, COUNT(*) as count
FROM inventory_management.activity_logs
GROUP BY action
ORDER BY action;

-- 5. Test INSERT with new action values (will fail if constraints prevent it)
-- Test 1: webhook_log_failed_after_stock_deduction
DO $$
BEGIN
    BEGIN
        INSERT INTO inventory_management.activity_logs
        (action, entity_type, entity_id, details, success, error_message)
        VALUES (
            'webhook_log_failed_after_stock_deduction',
            'order',
            99999,
            '{"test": true}'::jsonb,
            false,
            'Test error message'
        );
        RAISE NOTICE '✅ SUCCESS: webhook_log_failed_after_stock_deduction can be inserted';
        -- Rollback the test insert
        ROLLBACK;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ FAILED: webhook_log_failed_after_stock_deduction cannot be inserted. Error: %', SQLERRM;
    END;
END $$;

-- Test 2: webhook_log_failed_after_stock_restoration
DO $$
BEGIN
    BEGIN
        INSERT INTO inventory_management.activity_logs
        (action, entity_type, entity_id, details, success, error_message)
        VALUES (
            'webhook_log_failed_after_stock_restoration',
            'order',
            99999,
            '{"test": true}'::jsonb,
            false,
            'Test error message'
        );
        RAISE NOTICE '✅ SUCCESS: webhook_log_failed_after_stock_restoration can be inserted';
        -- Rollback the test insert
        ROLLBACK;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ FAILED: webhook_log_failed_after_stock_restoration cannot be inserted. Error: %', SQLERRM;
    END;
END $$;

-- Test 3: webhook_log_failed_product_update
DO $$
BEGIN
    BEGIN
        INSERT INTO inventory_management.activity_logs
        (action, entity_type, entity_id, details, success, error_message)
        VALUES (
            'webhook_log_failed_product_update',
            'product',
            99999,
            '{"test": true}'::jsonb,
            false,
            'Test error message'
        );
        RAISE NOTICE '✅ SUCCESS: webhook_log_failed_product_update can be inserted';
        -- Rollback the test insert
        ROLLBACK;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ FAILED: webhook_log_failed_product_update cannot be inserted. Error: %', SQLERRM;
    END;
END $$;

-- 6. Check table structure summary
SELECT 
    'activity_logs' as table_name,
    COUNT(*) as total_columns,
    string_agg(column_name || ' (' || data_type || ')', ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns
WHERE table_schema = 'inventory_management'
AND table_name = 'activity_logs';

-- ============================================
-- Expected Results:
-- ============================================
-- 1. action column should be VARCHAR or TEXT (not ENUM)
-- 2. No CHECK constraints should restrict action values
-- 3. All three test inserts should succeed
-- ============================================
-- If any test fails, you may need to:
-- 1. Alter the table to remove CHECK constraints
-- 2. Change ENUM to VARCHAR/TEXT if action is an ENUM
-- 3. Update any triggers that validate action values
-- ============================================

