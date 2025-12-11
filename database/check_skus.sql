-- ========================================
-- Check if Single SKUs exist in Database
-- ========================================
-- Run this query to see if single SKUs are in your database

-- Count total single SKUs
SELECT COUNT(*) as total_single_skus 
FROM inventory_management.single_skus;

-- List all single SKUs
SELECT id, sku, name, woocommerce_product_id, created_at
FROM inventory_management.single_skus
ORDER BY sku;

-- If the count is 0, you need to run the seed script:
-- Run: database/seed.sql


