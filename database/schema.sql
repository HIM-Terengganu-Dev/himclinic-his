-- ========================================
-- Telehealth Inventory Management System
-- Database Schema
-- ========================================
-- Description: PostgreSQL schema for inventory management with minimal database usage.
--              WooCommerce is the source of truth for inventory levels and orders.
--              This database stores: users, SKU definitions, and activity logs only.
-- ========================================

-- Create schema
CREATE SCHEMA IF NOT EXISTS inventory_management;

-- ========================================
-- 1. USERS TABLE
-- ========================================
-- Stores Google OAuth user information and roles
CREATE TABLE IF NOT EXISTS inventory_management.users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_key UNIQUE (email)
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON inventory_management.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON inventory_management.users(role);

COMMENT ON TABLE inventory_management.users IS 'Stores Google OAuth authenticated users with role-based access control';
COMMENT ON COLUMN inventory_management.users.role IS 'User role: admin (can manage SKUs) or user (can only update stock)';

-- ========================================
-- 2. SINGLE SKUS TABLE
-- ========================================
-- Master data for single SKU products
CREATE TABLE IF NOT EXISTS inventory_management.single_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    woocommerce_product_id INTEGER UNIQUE,
    description TEXT,
    created_by INTEGER REFERENCES inventory_management.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_skus_sku_key UNIQUE (sku),
    CONSTRAINT single_skus_woocommerce_product_id_key UNIQUE (woocommerce_product_id)
);

-- Indexes for single_skus table
CREATE INDEX IF NOT EXISTS idx_single_skus_sku ON inventory_management.single_skus(sku);
CREATE INDEX IF NOT EXISTS idx_single_skus_woocommerce_id ON inventory_management.single_skus(woocommerce_product_id);

COMMENT ON TABLE inventory_management.single_skus IS 'Master data for single SKU products. Note: Inventory levels are stored in WooCommerce, not here.';
COMMENT ON COLUMN inventory_management.single_skus.woocommerce_product_id IS 'WooCommerce product ID for API sync';

-- ========================================
-- 3. COMBO SKUS TABLE
-- ========================================
-- Master data for combo SKU products with component definitions
CREATE TABLE IF NOT EXISTS inventory_management.combo_skus (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    woocommerce_product_id INTEGER UNIQUE,
    components JSONB NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES inventory_management.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT combo_skus_sku_key UNIQUE (sku),
    CONSTRAINT combo_skus_woocommerce_product_id_key UNIQUE (woocommerce_product_id),
    CONSTRAINT combo_skus_components_not_empty CHECK (jsonb_array_length(components) > 0)
);

-- Indexes for combo_skus table
CREATE INDEX IF NOT EXISTS idx_combo_skus_sku ON inventory_management.combo_skus(sku);
CREATE INDEX IF NOT EXISTS idx_combo_skus_woocommerce_id ON inventory_management.combo_skus(woocommerce_product_id);
CREATE INDEX IF NOT EXISTS idx_combo_skus_components ON inventory_management.combo_skus USING GIN (components);

COMMENT ON TABLE inventory_management.combo_skus IS 'Master data for combo SKU products with component definitions in JSONB format';
COMMENT ON COLUMN inventory_management.combo_skus.components IS 'JSONB array of components: [{"sku": "him1", "quantity": 3}, ...]';

-- ========================================
-- 4. PROCUREMENT UPDATES TABLE
-- ========================================
-- History of manual stock procurement updates
CREATE TABLE IF NOT EXISTS inventory_management.procurement_updates (
    id SERIAL PRIMARY KEY,
    single_sku_id INTEGER REFERENCES inventory_management.single_skus(id) ON DELETE CASCADE,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('add', 'subtract', 'set')),
    quantity INTEGER NOT NULL,
    previous_quantity INTEGER,
    new_quantity INTEGER,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES inventory_management.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT procurement_quantity_positive CHECK (quantity >= 0),
    CONSTRAINT procurement_previous_qty_positive CHECK (previous_quantity IS NULL OR previous_quantity >= 0),
    CONSTRAINT procurement_new_qty_positive CHECK (new_quantity IS NULL OR new_quantity >= 0)
);

-- Indexes for procurement_updates table
CREATE INDEX IF NOT EXISTS idx_procurement_created_at ON inventory_management.procurement_updates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_procurement_single_sku_id ON inventory_management.procurement_updates(single_sku_id);
CREATE INDEX IF NOT EXISTS idx_procurement_created_by ON inventory_management.procurement_updates(created_by);

COMMENT ON TABLE inventory_management.procurement_updates IS 'Historical record of manual stock procurement updates';
COMMENT ON COLUMN inventory_management.procurement_updates.operation IS 'Operation type: add (increment) or set (absolute value)';
COMMENT ON COLUMN inventory_management.procurement_updates.notes IS 'Optional notes/reason for the update';

-- ========================================
-- 5. ACTIVITY LOGS TABLE
-- ========================================
-- Comprehensive audit trail for all manual changes
CREATE TABLE IF NOT EXISTS inventory_management.activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES inventory_management.users(id) ON DELETE SET NULL,
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

-- Indexes for activity_logs table
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON inventory_management.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON inventory_management.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON inventory_management.activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_success ON inventory_management.activity_logs(success);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON inventory_management.activity_logs(entity_type, entity_id);

COMMENT ON TABLE inventory_management.activity_logs IS 'Comprehensive audit trail for all manual changes (procurement updates, SKU management, failed attempts)';
COMMENT ON COLUMN inventory_management.activity_logs.action IS 'Action type: procurement_update, sku_created, sku_updated, manual_adjustment, stock_take_adjustment, etc.';
COMMENT ON COLUMN inventory_management.activity_logs.details IS 'Full JSON details of the change (before/after values, etc.)';
COMMENT ON COLUMN inventory_management.activity_logs.success IS 'Whether the action succeeded or failed';

-- ========================================
-- 6. STOCK TAKES TABLE
-- ========================================
-- Store monthly stock take records
CREATE TABLE IF NOT EXISTS inventory_management.stock_takes (
    id SERIAL PRIMARY KEY,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    snapshot_data JSONB NOT NULL,
    created_by INTEGER NOT NULL REFERENCES inventory_management.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    completed_by INTEGER REFERENCES inventory_management.users(id) ON DELETE SET NULL,
    CONSTRAINT stock_takes_month_year_unique UNIQUE (month, year)
);

-- Indexes for stock_takes table
CREATE INDEX IF NOT EXISTS idx_stock_takes_month_year ON inventory_management.stock_takes(year, month DESC);
CREATE INDEX IF NOT EXISTS idx_stock_takes_status ON inventory_management.stock_takes(status);
CREATE INDEX IF NOT EXISTS idx_stock_takes_created_at ON inventory_management.stock_takes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_takes_created_by ON inventory_management.stock_takes(created_by);

COMMENT ON TABLE inventory_management.stock_takes IS 'Monthly stock take records with snapshot of inventory levels';
COMMENT ON COLUMN inventory_management.stock_takes.month IS 'Month number (1-12)';
COMMENT ON COLUMN inventory_management.stock_takes.year IS 'Year (e.g., 2024)';
COMMENT ON COLUMN inventory_management.stock_takes.status IS 'Status: pending (in progress) or completed';
COMMENT ON COLUMN inventory_management.stock_takes.snapshot_data IS 'JSONB snapshot of all stock levels at time of creation';

-- ========================================
-- 7. STOCK TAKE ITEMS TABLE
-- ========================================
-- Store individual SKU counts and adjustments for each stock take
CREATE TABLE IF NOT EXISTS inventory_management.stock_take_items (
    id SERIAL PRIMARY KEY,
    stock_take_id INTEGER NOT NULL REFERENCES inventory_management.stock_takes(id) ON DELETE CASCADE,
    single_sku_id INTEGER NOT NULL REFERENCES inventory_management.single_skus(id) ON DELETE CASCADE,
    system_quantity INTEGER NOT NULL CHECK (system_quantity >= 0),
    physical_quantity INTEGER CHECK (physical_quantity IS NULL OR physical_quantity >= 0),
    variance INTEGER,
    adjustment_applied BOOLEAN DEFAULT FALSE,
    adjustment_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_take_items_unique UNIQUE (stock_take_id, single_sku_id)
);

-- Indexes for stock_take_items table
CREATE INDEX IF NOT EXISTS idx_stock_take_items_stock_take_id ON inventory_management.stock_take_items(stock_take_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_single_sku_id ON inventory_management.stock_take_items(single_sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_items_adjustment_applied ON inventory_management.stock_take_items(adjustment_applied);

COMMENT ON TABLE inventory_management.stock_take_items IS 'Individual SKU counts and adjustments for stock takes';
COMMENT ON COLUMN inventory_management.stock_take_items.system_quantity IS 'Stock from WooCommerce at snapshot time';
COMMENT ON COLUMN inventory_management.stock_take_items.physical_quantity IS 'Physical count entered by staff';
COMMENT ON COLUMN inventory_management.stock_take_items.variance IS 'Calculated: physical_quantity - system_quantity';
COMMENT ON COLUMN inventory_management.stock_take_items.adjustment_applied IS 'Whether adjustment has been applied to WooCommerce';

-- ========================================
-- FUNCTIONS AND TRIGGERS
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION inventory_management.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for single_skus
DROP TRIGGER IF EXISTS update_single_skus_updated_at ON inventory_management.single_skus;
CREATE TRIGGER update_single_skus_updated_at
    BEFORE UPDATE ON inventory_management.single_skus
    FOR EACH ROW
    EXECUTE FUNCTION inventory_management.update_updated_at_column();

-- Trigger for combo_skus
DROP TRIGGER IF EXISTS update_combo_skus_updated_at ON inventory_management.combo_skus;
CREATE TRIGGER update_combo_skus_updated_at
    BEFORE UPDATE ON inventory_management.combo_skus
    FOR EACH ROW
    EXECUTE FUNCTION inventory_management.update_updated_at_column();

-- ========================================
-- SAMPLE COMMENTS FOR DOCUMENTATION
-- ========================================

COMMENT ON SCHEMA inventory_management IS 'Inventory management system schema - stores users, SKU definitions, and activity logs. WooCommerce is the source of truth for inventory levels.';

-- ========================================
-- GRANT PERMISSIONS (Optional - adjust as needed)
-- ========================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA inventory_management TO neondb_owner;

-- Grant all privileges on all tables
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory_management TO neondb_owner;

-- Grant all privileges on all sequences
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA inventory_management TO neondb_owner;

-- ========================================
-- END OF SCHEMA
-- ========================================
