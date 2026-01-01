-- ========================================
-- Migration: WooCommerce Webhook Logs Table
-- ========================================
-- Description: Creates a table to track stock changes and triggers from WooCommerce side
--              (orders, product reconciliations, etc.)

-- Create WC Webhook Logs table
CREATE TABLE IF NOT EXISTS inventory_management.wc_webhook_logs (
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
    combo_updates JSONB, -- Details of combo SKU updates triggered by this webhook
    details JSONB, -- Full webhook payload and additional context
    ip_address VARCHAR(45), -- IP address of webhook sender
    user_agent TEXT, -- User agent of webhook sender
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for wc_webhook_logs table
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_created_at ON inventory_management.wc_webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_webhook_type ON inventory_management.wc_webhook_logs(webhook_type);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_webhook_event ON inventory_management.wc_webhook_logs(webhook_event);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_entity_id ON inventory_management.wc_webhook_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_entity_sku ON inventory_management.wc_webhook_logs(entity_sku);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_success ON inventory_management.wc_webhook_logs(success);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_type_event ON inventory_management.wc_webhook_logs(webhook_type, webhook_event);

COMMENT ON TABLE inventory_management.wc_webhook_logs IS 'Logs all stock changes and triggers from WooCommerce side (orders, product reconciliations)';
COMMENT ON COLUMN inventory_management.wc_webhook_logs.webhook_type IS 'Type of webhook: order or product';
COMMENT ON COLUMN inventory_management.wc_webhook_logs.webhook_event IS 'Specific event: order.created, order.processing, product.updated, etc.';
COMMENT ON COLUMN inventory_management.wc_webhook_logs.affected_skus IS 'JSONB array of SKUs affected by this webhook';
COMMENT ON COLUMN inventory_management.wc_webhook_logs.combo_updates IS 'JSONB array of combo SKU updates triggered: [{"sku": "combo1", "newStock": 5}, ...]';

-- Grant permissions
GRANT ALL PRIVILEGES ON inventory_management.wc_webhook_logs TO neondb_owner;
GRANT ALL PRIVILEGES ON SEQUENCE inventory_management.wc_webhook_logs_id_seq TO neondb_owner;

