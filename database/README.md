# Database Setup Guide

This guide walks you through setting up the PostgreSQL database for the Telehealth Inventory Management System using Neon DB.

## Overview

The database uses a **minimal schema** approach where:
- ✅ **WooCommerce** is the source of truth for inventory levels and orders
- ✅ **PostgreSQL** stores only: users, SKU definitions, and activity logs
- ✅ **Bidirectional sync**: Manual edits → WooCommerce, Orders → System (via refresh)

## Database Schema

The `inventory_management` schema contains **5 tables**:

| Table | Purpose | Records |
|-------|---------|---------|
| `users` | Google OAuth user authentication | User accounts with roles |
| `single_skus` | Master data for single SKU products | 12 SKUs |
| `combo_skus` | Combo SKU definitions with components | 18 combo SKUs |
| `procurement_updates` | History of manual stock updates | Activity tracking |
| `activity_logs` | Comprehensive audit trail | All manual changes |

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
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture TEXT,
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
