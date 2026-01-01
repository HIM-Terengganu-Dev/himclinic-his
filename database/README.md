# Database Setup Guide

This guide walks you through setting up the PostgreSQL database for the Telehealth Inventory Management System using Neon DB.

## Overview

The database uses a **minimal schema** approach where:
- ✅ **WooCommerce** is the source of truth for inventory levels and orders
- ✅ **PostgreSQL** stores only: users, SKU definitions, and activity logs
- ✅ **Bidirectional sync**: Manual edits → WooCommerce, Orders → System (via refresh)

## Database Schema

The `inventory_management` schema contains **6 tables**:

| Table | Purpose | Records |
|-------|---------|---------|
| `users` | Google OAuth user authentication | User accounts with roles |
| `single_skus` | Master data for single SKU products | 12 SKUs |
| `combo_skus` | Combo SKU definitions with components | 18 combo SKUs |
| `procurement_updates` | History of manual stock updates | Activity tracking |
| `activity_logs` | Comprehensive audit trail | All manual system changes (HIS System tab) |
| `wc_webhook_logs` | WooCommerce webhook events | Orders, product reconciliations (WooCommerce tab) |

## Prerequisites

- PostgreSQL database (Neon DB)
- Connection string with DDL enabled
- `psql` command-line tool installed

## Setup Steps

### 1. Connect to Database

Using the provided connection string:

```bash
psql 'postgresql://neondb_owner:npg_tP8qomJXdH9e@ep-misty-bonus-a1z6q1cy-pooler.ap-southeast-1.aws.neon.tech/HC_live_dashboard?sslmode=require&channel_binding=require'
```

You should see the PostgreSQL prompt:
```
HC_live_dashboard=>
```

### 2. Create Schema and Tables

Run the schema creation script:

```sql
\i database/schema.sql
```

Or if you're in a different directory:

```bash
psql 'postgresql://...' -f database/schema.sql
```

**Expected output:**
```
CREATE SCHEMA
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE INDEX
...
```

### 3. Verify Schema Creation

Check that all tables were created:

```sql
\dt inventory_management.*;
```

**Expected output:**
```
                            List of relations
       Schema        |         Name          | Type  |    Owner     
---------------------+-----------------------+-------+--------------
 inventory_management| activity_logs         | table | neondb_owner
 inventory_management| combo_skus            | table | neondb_owner
 inventory_management| procurement_updates   | table | neondb_owner
 inventory_management| single_skus           | table | neondb_owner
 inventory_management| users                 | table | neondb_owner
 inventory_management| wc_webhook_logs       | table | neondb_owner
```

### 4. Seed Initial Data

Populate the database with existing SKU data:

```sql
\i database/seed.sql
```

Or:

```bash
psql 'postgresql://...' -f database/seed.sql
```

**Expected output:**
```
INSERT 0 12  -- single SKUs
INSERT 0 18  -- combo SKUs
 single_sku_count | combo_sku_count 
------------------+-----------------
               12 |              18
```

### 5. Verify Data

Check the imported data:

```sql
-- Count records
SELECT 
    (SELECT COUNT(*) FROM inventory_management.single_skus) as single_skus,
    (SELECT COUNT(*) FROM inventory_management.combo_skus) as combo_skus;

-- View single SKUs
SELECT sku, name FROM inventory_management.single_skus ORDER BY sku;

-- View combo SKUs with components
SELECT sku, name, components FROM inventory_management.combo_skus ORDER BY sku;
```

## Post-Setup Configuration

### Promote First Admin User

After the first user logs in via Google OAuth, promote them to admin:

```sql
-- Find the user
SELECT id, email, role FROM inventory_management.users;

-- Promote to admin
UPDATE inventory_management.users 
SET role = 'admin' 
WHERE email = 'your-admin-email@gmail.com';

-- Verify
SELECT id, email, role FROM inventory_management.users;
```

## Table Details

### Users Table

```sql
CREATE TABLE inventory_management.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',  -- 'admin' or 'user'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Roles:**
- `admin` - Can manage SKUs, update stock, view activity logs
- `user` - Can update stock, view activity logs

### Single SKUs Table

```sql
CREATE TABLE inventory_management.single_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    woocommerce_product_id INTEGER UNIQUE,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Note:** Inventory quantities are NOT stored here - they're fetched from WooCommerce in real-time.

### Combo SKUs Table

```sql
CREATE TABLE inventory_management.combo_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    woocommerce_product_id INTEGER UNIQUE,
    components JSONB NOT NULL,  -- [{"sku": "him1", "quantity": 3}, ...]
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Components format (JSONB):**
```json
[
  {"sku": "spu1", "quantity": 1},
  {"sku": "him1", "quantity": 3}
]
```

### Procurement Updates Table

```sql
CREATE TABLE inventory_management.procurement_updates (
    id SERIAL PRIMARY KEY,
    single_sku_id INTEGER REFERENCES single_skus(id),
    operation VARCHAR(10) NOT NULL,  -- 'add' or 'set'
    quantity INTEGER NOT NULL,
    previous_quantity INTEGER,
    new_quantity INTEGER,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Activity Logs Table

```sql
CREATE TABLE inventory_management.activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Purpose:** Tracks all manual system changes made by users through the HIS System interface (procurement updates, SKU management, etc.). Displayed in the "HIS System" tab of the Activity Log.

### WooCommerce Webhook Logs Table

```sql
CREATE TABLE inventory_management.wc_webhook_logs (
    id SERIAL PRIMARY KEY,
    webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN ('order', 'product')),
    webhook_event VARCHAR(100) NOT NULL, -- e.g., 'order.created', 'order.processing', 'product.updated'
    entity_id INTEGER NOT NULL, -- Order ID or Product ID from WooCommerce
    entity_sku VARCHAR(100), -- SKU of the product/order item
    entity_name VARCHAR(255), -- Name of the product/order
    status VARCHAR(50), -- Order status or product stock status
    stock_quantity INTEGER, -- Stock quantity after change
    previous_stock_quantity INTEGER, -- Stock quantity before change (if available)
    affected_skus JSONB, -- Array of SKUs affected by this webhook
    combo_updates JSONB, -- Details of combo SKU updates triggered: [{"sku": "combo1", "newStock": 5}, ...]
    details JSONB, -- Full webhook payload and additional context
    ip_address VARCHAR(45), -- IP address of webhook sender
    user_agent TEXT, -- User agent of webhook sender
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Purpose:** Tracks all stock changes and triggers from WooCommerce side (orders, product reconciliations, manual stock updates in WooCommerce). Displayed in the "WooCommerce" tab of the Activity Log.

**Key Fields:**
- `entity_sku`: SKU that was ordered/edited (for quick reference)
- `affected_skus`: JSONB array of all SKUs affected
- `stock_quantity`: Stock quantity after change (for product events)
- `details`: JSONB containing:
  - `lineItems`: Order line items (what customer ordered)
  - `componentDeductions`: Stock deductions with WC/HIS indicators
  - `componentRestorations`: Stock restorations for cancelled orders
  - `comboUpdates`: Recalculated combo SKU availability

**To create this table**, run the migration:
```bash
psql 'postgresql://...' -f database/migration_wc_webhook_logs.sql
```

**To backfill missing SKU and stock data** for existing records:
```bash
psql 'postgresql://...' -f database/migration_backfill_wc_webhook_sku.sql
```

## Useful Queries

### View Recent Activity

```sql
SELECT 
    al.created_at,
    u.name as user,
    u.email,
    al.action,
    al.success,
    al.details
FROM inventory_management.activity_logs al
LEFT JOIN inventory_management.users u ON al.user_id = u.id
ORDER BY al.created_at DESC
LIMIT 20;
```

### View Procurement History

```sql
SELECT 
    pu.created_at,
    u.name as user,
    s.sku,
    s.name as product,
    pu.operation,
    pu.previous_quantity,
    pu.new_quantity,
    pu.notes
FROM inventory_management.procurement_updates pu
JOIN inventory_management.users u ON pu.created_by = u.id
JOIN inventory_management.single_skus s ON pu.single_sku_id = s.id
ORDER BY pu.created_at DESC;
```

### Check Combo SKU Components

```sql
SELECT 
    sku,
    name,
    jsonb_array_length(components) as num_components,
    components
FROM inventory_management.combo_skus
ORDER BY sku;
```

### Find SKUs by Component

```sql
-- Find all combo SKUs that contain 'him1'
SELECT 
    sku,
    name,
    components
FROM inventory_management.combo_skus
WHERE components::text LIKE '%him1%';
```

### View WooCommerce Webhook Logs

```sql
-- Recent webhook events with component deductions/restorations
SELECT 
    created_at,
    webhook_type,
    webhook_event,
    entity_id,
    entity_sku,
    status,
    stock_quantity,
    affected_skus,
    jsonb_array_length(details->'componentDeductions') as component_deductions_count,
    jsonb_array_length(details->'componentRestorations') as component_restorations_count,
    jsonb_array_length(details->'comboUpdates') as combo_updates_count,
    success,
    error_message
FROM inventory_management.wc_webhook_logs
ORDER BY created_at DESC
LIMIT 20;
```

### View Order Cancellations with Component Restorations

```sql
SELECT 
    entity_id as order_id,
    entity_sku,
    created_at,
    details->'componentRestorations' as component_restorations,
    details->'comboUpdates' as combo_updates
FROM inventory_management.wc_webhook_logs
WHERE webhook_type = 'order'
AND webhook_event IN ('order.cancelled', 'order.refunded')
ORDER BY created_at DESC
LIMIT 20;
```

### View Component Deductions by SKU

```sql
SELECT 
    wwl.entity_id as order_id,
    wwl.created_at,
    deduction->>'sku' as component_sku,
    (deduction->>'previousStock')::integer as previous_stock,
    (deduction->>'newStock')::integer as new_stock,
    CASE 
        WHEN deduction->>'isWcSide' = 'true' THEN 'WooCommerce'
        ELSE 'HIS System'
    END as deducted_by
FROM inventory_management.wc_webhook_logs wwl,
     jsonb_array_elements(wwl.details->'componentDeductions') as deduction
WHERE wwl.webhook_type = 'order'
AND wwl.webhook_event = 'order.processing'
ORDER BY wwl.created_at DESC;

-- View order webhooks
SELECT * FROM inventory_management.wc_webhook_logs 
WHERE webhook_type = 'order' 
ORDER BY created_at DESC;

-- View product update webhooks
SELECT * FROM inventory_management.wc_webhook_logs 
WHERE webhook_type = 'product' 
ORDER BY created_at DESC;

-- View combo updates from webhooks
SELECT 
    created_at,
    entity_sku,
    jsonb_array_elements(combo_updates) as combo_update
FROM inventory_management.wc_webhook_logs
WHERE combo_updates IS NOT NULL
ORDER BY created_at DESC;
```

## Maintenance

### Backup Database

```bash
pg_dump 'postgresql://...' --schema=inventory_management > backup_$(date +%Y%m%d).sql
```

### Restore from Backup

```bash
psql 'postgresql://...' < backup_20231209.sql
```

### Reset Schema (Caution!)

```sql
-- WARNING: This deletes all data!
DROP SCHEMA inventory_management CASCADE;
-- Then run schema.sql and seed.sql again
```

## Troubleshooting

### Connection Issues

If you get SSL errors:

```bash
psql 'postgresql://...?sslmode=require'
```

### Permission Issues

Ensure your database user has proper permissions:

```sql
GRANT ALL PRIVILEGES ON SCHEMA inventory_management TO neondb_owner;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory_management TO neondb_owner;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA inventory_management TO neondb_owner;
```

### Check Current Connections

```sql
SELECT * FROM pg_stat_activity WHERE datname = 'HC_live_dashboard';
```

## Next Steps

After successfully setting up the database:

1. ✅ Configure environment variables (`.env`)
2. ✅ Install dependencies (`npm install pg next-auth`)
3. ✅ Set up Google OAuth credentials
4. ✅ Run the application and test authentication
5. ✅ Promote first user to admin role
6. ✅ Test SKU management and procurement updates

---

**Questions?** Check the main [README.md](../README.md) or reach out to the development team.
