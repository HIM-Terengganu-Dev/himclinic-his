-- ========================================
-- Stock Take Feature Migration
-- ========================================
-- Adds tables for monthly stock take functionality
-- ========================================

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
-- END OF MIGRATION
-- ========================================


