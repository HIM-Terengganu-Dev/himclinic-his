-- ========================================
-- Migration: Backfill entity_sku, affected_skus, and stock_quantity for WC Webhook Logs
-- ========================================
-- Description: Backfills entity_sku, affected_skus, and stock_quantity columns from details JSONB
--              for existing records that have these fields empty
-- Note: previous_stock_quantity cannot be backfilled as it's not stored in the details field
-- ========================================

-- For ORDER webhooks: Extract SKUs from details.lineItems
UPDATE inventory_management.wc_webhook_logs w
SET 
    entity_sku = CASE 
        WHEN w.entity_sku IS NULL OR w.entity_sku = '' 
        THEN (
            SELECT (line_item->>'sku')
            FROM jsonb_array_elements(w.details->'lineItems') AS line_item
            WHERE w.details->'lineItems' IS NOT NULL 
            AND jsonb_array_length(w.details->'lineItems') > 0
            LIMIT 1
        )
        ELSE w.entity_sku
    END,
    affected_skus = CASE 
        WHEN w.affected_skus IS NULL
        THEN (
            SELECT jsonb_agg(DISTINCT line_item->>'sku')
            FROM jsonb_array_elements(w.details->'lineItems') AS line_item
            WHERE w.details->'lineItems' IS NOT NULL
            AND (line_item->>'sku') IS NOT NULL
            AND (line_item->>'sku') != ''
        )
        ELSE w.affected_skus
    END
WHERE w.webhook_type = 'order'
AND (w.entity_sku IS NULL OR w.entity_sku = '' OR w.affected_skus IS NULL)
AND w.details->'lineItems' IS NOT NULL
AND jsonb_array_length(w.details->'lineItems') > 0;

-- For PRODUCT webhooks: Extract SKU and stock quantity from details
UPDATE inventory_management.wc_webhook_logs w
SET 
    entity_sku = CASE 
        WHEN w.entity_sku IS NULL OR w.entity_sku = ''
        THEN COALESCE(
            w.details->>'singleSku',
            CASE 
                WHEN w.affected_skus IS NOT NULL AND jsonb_array_length(w.affected_skus) > 0
                THEN (w.affected_skus->0)::text
                ELSE NULL
            END
        )
        ELSE w.entity_sku
    END,
    stock_quantity = CASE 
        WHEN w.stock_quantity IS NULL AND w.details->>'newStock' IS NOT NULL
        THEN (
            CASE 
                WHEN (w.details->>'newStock')::text ~ '^-?[0-9]+$' 
                THEN (w.details->>'newStock')::integer
                ELSE NULL
            END
        )
        ELSE w.stock_quantity
    END
    -- Note: previous_stock_quantity cannot be backfilled as it's not stored in details field
WHERE w.webhook_type = 'product'
AND (
    (w.entity_sku IS NULL OR w.entity_sku = '')
    OR (w.stock_quantity IS NULL AND w.details->>'newStock' IS NOT NULL)
)
AND (
    w.details->>'singleSku' IS NOT NULL 
    OR (w.affected_skus IS NOT NULL AND jsonb_array_length(w.affected_skus) > 0)
    OR w.details->>'newStock' IS NOT NULL
);

-- Display results
SELECT 
    webhook_type,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE entity_sku IS NOT NULL AND entity_sku != '') as records_with_entity_sku,
    COUNT(*) FILTER (WHERE affected_skus IS NOT NULL) as records_with_affected_skus,
    COUNT(*) FILTER (WHERE stock_quantity IS NOT NULL) as records_with_stock_quantity,
    COUNT(*) FILTER (WHERE previous_stock_quantity IS NOT NULL) as records_with_previous_stock_quantity
FROM inventory_management.wc_webhook_logs
GROUP BY webhook_type;

