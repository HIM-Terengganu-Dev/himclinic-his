-- ========================================
-- Telehealth Inventory Management System
-- Database Seed Script
-- ========================================
-- Description: Populates single_skus and combo_skus tables from existing CSV data.
--              This is a one-time migration to move from CSV to database storage.
-- ========================================
-- Prerequisites: Run schema.sql first
-- ========================================

-- Note: The created_by will be NULL for initial seed data
-- First admin user can be manually assigned after first login

-- ========================================
-- SINGLE SKUS - From single_sku_list.csv
-- ========================================

INSERT INTO inventory_management.single_skus (woocommerce_product_id, sku, name, description, created_by)
VALUES
    (487, 'him1', 'HIM Coffee by Dr. Samhan', NULL, NULL),
    (484, 'spe/4tab', 'Pil Tindak Pantas 100mg', NULL, NULL),
    (485, 'buku/BK', 'Bangkit Keras! (Buku Khas Untuk Lelaki)', NULL, NULL),
    (486, 'buku/SM', 'Sampai Menang oleh Dr. Samhan - Buku Khas Untuk Lelaki', NULL, NULL),
    (482, 'tra/10tab', 'Pil Tahan Lama', NULL, NULL),
    (480, 'tad20/4tab', 'Pil Hujung Minggu 20mg', NULL, NULL),
    (479, 'pri/6tab', 'Pil Kekal Lama 60mg', NULL, NULL),
    (473, 'tad5/10tab', 'Pil Harian 5mg (10 Hari)', NULL, NULL),
    (472, 'via100/4tab', 'Pil Biru Original 100mg', NULL, NULL),
    (469, 'iqn50/4tab', 'Pil Biru Generik 50mg', NULL, NULL),
    (468, 'iqn100/4tab', 'Pil Biru Generik 100mg', NULL, NULL),
    (464, 'spu1', 'Spray Up 10ml', NULL, NULL)
ON CONFLICT (sku) DO NOTHING;

-- ========================================
-- COMBO SKUS - From combo_sku_list.csv
-- ========================================

-- Helper: JSONB array builder
-- Format: [{"sku": "component_sku", "quantity": N}, ...]

INSERT INTO inventory_management.combo_skus (woocommerce_product_id, sku, name, components, description, created_by)
VALUES
    -- Combo with 2 components
    (7971, 'kom/spu+him', 'KOMBO Spray Up + Him Coffee', 
        '[{"sku": "spu1", "quantity": 1}, {"sku": "him1", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (7935, 'kom/tad5(30tab)+tad20(4tab)', 'KOMBO Ekstra Pil Harian 5mg + Pil Hujung Minggu 20mg', 
        '[{"sku": "tad5/10tab", "quantity": 3}, {"sku": "tad20/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (7932, 'kom/tad20+Him', 'Kombo Pil Hujung Minggu + Him Coffee', 
        '[{"sku": "him1", "quantity": 1}, {"sku": "tad20/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (2058, 'kom/spu+tad20', 'KOMBO Spray Up + Pil Hujung Minggu 20mg', 
        '[{"sku": "spu1", "quantity": 1}, {"sku": "tad20/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (2057, 'kom/spu+iqn50', 'KOMBO Spray Up + Pil Biru 50mg', 
        '[{"sku": "spu1", "quantity": 1}, {"sku": "iqn50/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    -- Note: This appears to have duplicate component (iqn100/4tab twice), keeping as-is from CSV
    (2056, 'kom/spu+iqn100', 'KOMBO Spray Up + Pil Biru 100mg', 
        '[{"sku": "iqn100/4tab", "quantity": 1}, {"sku": "iqn100/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (2055, 'kom/tad20+tra', 'KOMBO Pil Tahan Lama + Pil Hujung Minggu 20mg', 
        '[{"sku": "tra/10tab", "quantity": 1}, {"sku": "tad20/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (2054, 'kom/iqn100+tra', 'KOMBO Pil Tahan Lama + Pil Biru 100mg', 
        '[{"sku": "tra/10tab", "quantity": 1}, {"sku": "iqn100/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (2053, 'kom/spu+tra', 'KOMBO Spray Up + Pil Tahan Lama', 
        '[{"sku": "spu1", "quantity": 1}, {"sku": "tra/10tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    (503, 'kom/tad5+tad20', 'KOMBO Pil Harian 5mg + Pil Hujung Minggu 20mg', 
        '[{"sku": "tad5/10tab", "quantity": 1}, {"sku": "tad20/4tab", "quantity": 1}]'::jsonb, NULL, NULL),
    
    -- Combo with 1 component (multiples of single SKU)
    (6103, 'iqn100/12tab', 'Pil Biru Generik 100mg (Langganan 3 Bulan)', 
        '[{"sku": "iqn100/4tab", "quantity": 3}]'::jsonb, NULL, NULL),
    
    (6101, 'tad5/30tab', 'Pil Harian 5mg (Langganan Bulanan)', 
        '[{"sku": "tad5/10tab", "quantity": 3}]'::jsonb, NULL, NULL),
    
    (5428, 'tra/30tab', 'Pil Tahan Lama (Langganan 3 Bulan)', 
        '[{"sku": "tra/10tab", "quantity": 3}]'::jsonb, NULL, NULL),
    
    (489, 'him9', 'HIM Coffee by Dr Samhan x 9', 
        '[{"sku": "him1", "quantity": 9}]'::jsonb, NULL, NULL),
    
    (488, 'him3', 'HIM Coffee by Dr Samhan x 3', 
        '[{"sku": "him1", "quantity": 3}]'::jsonb, NULL, NULL),
    
    (467, 'spu10', 'Spray Up x 10 botol', 
        '[{"sku": "spu1", "quantity": 10}]'::jsonb, NULL, NULL),
    
    (466, 'spu5', 'Spray Up x 5 Botol', 
        '[{"sku": "spu1", "quantity": 5}]'::jsonb, NULL, NULL),
    
    (465, 'spu3', 'Spray Up x 3 Botol', 
        '[{"sku": "spu1", "quantity": 3}]'::jsonb, NULL, NULL)

ON CONFLICT (sku) DO NOTHING;

-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- Count imported SKUs
SELECT 
    (SELECT COUNT(*) FROM inventory_management.single_skus) as single_sku_count,
    (SELECT COUNT(*) FROM inventory_management.combo_skus) as combo_sku_count;

-- Show all single SKUs
SELECT id, sku, name, woocommerce_product_id FROM inventory_management.single_skus ORDER BY id;

-- Show all combo SKUs with components
SELECT 
    id, 
    sku, 
    name, 
    woocommerce_product_id,
    components
FROM inventory_management.combo_skus 
ORDER BY id;

-- ========================================
-- POST-SEED NOTES
-- ========================================
-- After seeding:
-- 1. First user to login will need to be manually promoted to 'admin' role
--    UPDATE inventory_management.users SET role = 'admin' WHERE email = 'your-admin@gmail.com';
-- 2. CSV files can be archived/removed once data is verified in database
-- 3. Future SKU additions should be done through the admin UI, not SQL
-- ========================================
