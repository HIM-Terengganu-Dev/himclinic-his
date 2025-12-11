# Stock Take Troubleshooting: "0 items" Issue

## Problem
Stock take form shows "0 items • 0 with variance" and you can't see the manual count form.

## Root Cause
The stock take feature reads from the **database table** `inventory_management.single_skus`, not directly from WooCommerce.

## Solution

### Step 1: Check if Single SKUs exist in Database

Run this SQL query in your Neon database:

```sql
SELECT COUNT(*) as total_single_skus 
FROM inventory_management.single_skus;
```

**If the count is 0**, you need to populate the table.

### Step 2: Populate Single SKUs

Run the seed script to populate single SKUs:

```sql
-- Run this in your database (from database/seed.sql)
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
```

Or run the full seed script:
```bash
psql 'your_connection_string' -f database/seed.sql
```

### Step 3: Verify

After seeding, check again:
```sql
SELECT id, sku, name, woocommerce_product_id 
FROM inventory_management.single_skus 
ORDER BY sku;
```

You should see 12 single SKUs listed.

### Step 4: Try Stock Take Again

After populating the database, try creating a stock take again. You should now see all 12 SKUs in the form.

## Why This Happens

- **WooCommerce** has your products and stock levels
- **Database** needs to know which SKUs to track for stock take
- The `single_skus` table is the "master list" of SKUs the system should track
- Stock take creates items based on what's in the database table, then fetches current stock from WooCommerce

## Alternative: Check via API

You can also check if SKUs exist by calling:
```
GET /api/skus/single
```

This will return all single SKUs from the database.


