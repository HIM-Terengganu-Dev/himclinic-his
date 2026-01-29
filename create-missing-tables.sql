-- Create pending_consultation_stock table in his_db schema
-- This table tracks pending stock from orders in pending-consult/pending-review status
CREATE TABLE IF NOT EXISTS "his_db".pending_consultation_stock (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    sku VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    status VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, sku)
);

-- Create indexes for pending_consultation_stock
CREATE INDEX IF NOT EXISTS idx_pending_consultation_stock_order_id ON "his_db".pending_consultation_stock(order_id);
CREATE INDEX IF NOT EXISTS idx_pending_consultation_stock_sku ON "his_db".pending_consultation_stock(sku);
CREATE INDEX IF NOT EXISTS idx_pending_consultation_stock_status ON "his_db".pending_consultation_stock(status);

-- Create stock_movements table in his_db schema
-- This table is for reference/debugging only - NOT source of truth
-- The source of truth is stock_transactions table
CREATE TABLE IF NOT EXISTS "his_db".stock_movements (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(255) NOT NULL,
    single_sku_id INTEGER,
    previous_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    change_amount INTEGER NOT NULL,
    pending_stock INTEGER DEFAULT 0,
    source_type VARCHAR(100) NOT NULL,
    source_id INTEGER,
    source_event VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    details JSONB
);

-- Create indexes for stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_sku ON "his_db".stock_movements(sku);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON "his_db".stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source_type ON "his_db".stock_movements(source_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source_id ON "his_db".stock_movements(source_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_details ON "his_db".stock_movements USING GIN(details);

