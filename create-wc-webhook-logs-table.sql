-- Create wc_webhook_logs table in his_db schema
CREATE TABLE IF NOT EXISTS "his_db".wc_webhook_logs (
    id SERIAL PRIMARY KEY,
    webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN ('order', 'product')),
    webhook_event VARCHAR(100) NOT NULL,
    entity_id INTEGER NOT NULL,
    entity_sku VARCHAR(255),
    entity_name VARCHAR(255),
    status VARCHAR(50),
    stock_quantity INTEGER,
    previous_stock_quantity INTEGER,
    affected_skus JSONB,
    combo_updates JSONB,
    details JSONB,
    ip_address VARCHAR(255),
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_entity_id ON "his_db".wc_webhook_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_webhook_type ON "his_db".wc_webhook_logs(webhook_type);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_webhook_event ON "his_db".wc_webhook_logs(webhook_event);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_created_at ON "his_db".wc_webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_entity_sku ON "his_db".wc_webhook_logs(entity_sku);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_status ON "his_db".wc_webhook_logs(status);

-- Index for JSONB fields (for filtering by SKU in affected_skus array)
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_affected_skus ON "his_db".wc_webhook_logs USING GIN(affected_skus);
CREATE INDEX IF NOT EXISTS idx_wc_webhook_logs_details ON "his_db".wc_webhook_logs USING GIN(details);

