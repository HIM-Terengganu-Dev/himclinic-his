# Database Schema

## Overview

The system uses PostgreSQL with the `his_db` schema. All tables are prefixed with the schema name.

## Core Tables

### `stock_transactions`

Stores all stock changes with complete before/after state for all 6 statuses.

```sql
CREATE TABLE "his_db".stock_transactions (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(255) NOT NULL,
    single_sku_id INTEGER REFERENCES "his_db".single_skus(id),
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'order_pending_consult',
        'order_pending_review',
        'order_processing',
        'order_cancelled',
        'order_nv_pending_pickup',
        'manual_add',
        'manual_subtract',
        'manual_set',
        'reconciliation',
        'refund_return'
    )),
    quantity_change INTEGER NOT NULL,
    
    -- Legacy fields (for backward compatibility)
    stock_before INTEGER NOT NULL DEFAULT 0,
    stock_after INTEGER NOT NULL DEFAULT 0,
    pending_before INTEGER NOT NULL DEFAULT 0,
    pending_after INTEGER NOT NULL DEFAULT 0,
    
    -- New 6-status fields
    in_warehouse_before INTEGER NOT NULL DEFAULT 0,
    in_warehouse_after INTEGER NOT NULL DEFAULT 0,
    processing_before INTEGER NOT NULL DEFAULT 0,
    processing_after INTEGER NOT NULL DEFAULT 0,
    pending_consult_before INTEGER NOT NULL DEFAULT 0,
    pending_consult_after INTEGER NOT NULL DEFAULT 0,
    pending_review_before INTEGER NOT NULL DEFAULT 0,
    pending_review_after INTEGER NOT NULL DEFAULT 0,
    backorder_before INTEGER NOT NULL DEFAULT 0,
    backorder_after INTEGER NOT NULL DEFAULT 0,
    
    -- Source tracking
    source_type VARCHAR(50), -- 'order', 'manual', 'reconciliation', etc.
    source_id INTEGER, -- Order ID, user ID, etc.
    source_event VARCHAR(100), -- 'order.processing', etc.
    
    -- Metadata
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES "his_db".users(id)
);
```

**Indexes:**
- `idx_stock_transactions_sku` on `sku`
- `idx_stock_transactions_created_at` on `created_at`
- `idx_stock_transactions_source` on `(source_type, source_id)`

### `wc_webhook_logs`

Logs all WooCommerce webhook events.

```sql
CREATE TABLE "his_db".wc_webhook_logs (
    id SERIAL PRIMARY KEY,
    webhook_type VARCHAR(50) NOT NULL, -- 'order' or 'product'
    webhook_event VARCHAR(100) NOT NULL, -- 'order.processing', etc.
    entity_id INTEGER NOT NULL, -- Order ID or Product ID
    entity_sku VARCHAR(255),
    entity_name VARCHAR(255),
    status VARCHAR(50), -- 'processing', 'pending-consult', etc.
    current_status VARCHAR(50), -- Latest status for this order
    stock_quantity INTEGER,
    previous_stock_quantity INTEGER,
    affected_skus TEXT[], -- Array of affected SKUs
    combo_updates JSONB, -- Combo SKU stock updates
    details JSONB, -- Full webhook payload
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- `idx_wc_webhook_logs_entity` on `(webhook_type, entity_id)`
- `idx_wc_webhook_logs_created_at` on `created_at`
- `idx_wc_webhook_logs_status` on `status`
- `idx_wc_webhook_logs_current_status` on `current_status`

### `activity_logs`

Logs all manual system activities.

```sql
CREATE TABLE "his_db".activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES "his_db".users(id),
    user_name VARCHAR(255),
    user_email VARCHAR(255),
    user_picture TEXT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50), -- 'order', 'product', 'sku', etc.
    entity_id INTEGER,
    affected_sku VARCHAR(255),
    details JSONB,
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- `idx_activity_logs_user` on `user_id`
- `idx_activity_logs_created_at` on `created_at`
- `idx_activity_logs_action` on `action`
- `idx_activity_logs_sku` on `affected_sku`

### `single_skus`

Master data for single SKU products.

```sql
CREATE TABLE "his_db".single_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    wc_product_id INTEGER, -- WooCommerce product ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- `idx_single_skus_sku` on `sku`
- `idx_single_skus_wc_product_id` on `wc_product_id`

### `combo_skus`

Combo SKU definitions with components.

```sql
CREATE TABLE "his_db".combo_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    wc_product_id INTEGER, -- WooCommerce product ID
    components JSONB NOT NULL, -- Array of {sku: string, quantity: number}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- `idx_combo_skus_sku` on `sku`
- `idx_combo_skus_wc_product_id` on `wc_product_id`

### `users`

User authentication and authorization.

```sql
CREATE TABLE "his_db".users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    picture TEXT,
    role VARCHAR(50) DEFAULT 'user', -- 'user' or 'admin'
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes:**
- `idx_users_email` on `email`

### `procurement_updates`

History of manual stock updates (legacy table, may be deprecated).

```sql
CREATE TABLE "his_db".procurement_updates (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(255) NOT NULL,
    operation VARCHAR(50) NOT NULL, -- 'add', 'subtract', 'set'
    quantity INTEGER NOT NULL,
    previous_stock INTEGER,
    new_stock INTEGER,
    notes TEXT,
    created_by INTEGER REFERENCES "his_db".users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Current Stock Calculation

The current stock state for any SKU is calculated by:

1. Finding the latest `stock_transaction` for that SKU
2. Using the `*_after` values from that transaction

Alternatively, use the `getCurrentStockState(sku)` function which:
- Queries the latest transaction
- Returns all 6 status values
- Calculates `available_for_purchase`

## Relationships

```
users
  └── activity_logs (user_id)
  └── stock_transactions (created_by)

single_skus
  └── stock_transactions (single_sku_id)
  └── combo_skus.components (referenced in JSONB)

combo_skus
  └── (components reference single_skus.sku)

stock_transactions
  └── (source_id can reference orders, users, etc.)

wc_webhook_logs
  └── (entity_id references WooCommerce order/product IDs)
```

## Query Functions

### Get Current Stock State
```typescript
getCurrentStockState(sku: string): Promise<{
    inWarehouse: number;
    availableForPurchase: number;
    processing: number;
    pendingConsult: number;
    pendingReview: number;
    backorder: number;
}>
```

### Get All Current Stock
```typescript
getAllCurrentStock(): Promise<Record<string, {
    inWarehouse: number;
    availableForPurchase: number;
    processing: number;
    pendingConsult: number;
    pendingReview: number;
    backorder: number;
}>>
```

### Get Stock Transactions
```typescript
getStockTransactions(filters: {
    sku?: string;
    transactionType?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
}): Promise<StockTransaction[]>
```

## Migration History

### Order Status System Overhaul (2026-01-XX)

Added new columns to `stock_transactions`:
- `in_warehouse_before/after`
- `processing_before/after`
- `pending_consult_before/after`
- `pending_review_before/after`
- `backorder_before/after`

Added `current_status` column to `wc_webhook_logs` for tracking order status.

See `database/migration_order_status_overhaul.sql` for the full migration.

## Related Documentation

- [Order Status System](./ORDER_STATUS_SYSTEM.md) - Status definitions
- [API Reference](./API_REFERENCE.md) - API endpoints using these tables
- [Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md) - How data flows
