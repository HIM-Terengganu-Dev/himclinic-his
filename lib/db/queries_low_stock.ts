// Low Stock Alert Functions
import { query } from './connection';

export async function getLowStockEmailSettings() {
    const result = await query(
        `SELECT * FROM "his_db".low_stock_email_settings ORDER BY id DESC LIMIT 1`
    );
    return result.rows[0] || null;
}

export async function updateLowStockEmailSettings(settings: {
    enabled?: boolean;
    recipientEmail?: string;
    senderEmail?: string;
    emailSubject?: string;
    emailBody?: string;
}) {
    // Get existing settings
    const existing = await getLowStockEmailSettings();
    
    if (existing) {
        // Update existing
        const fields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (settings.enabled !== undefined) {
            fields.push(`enabled = $${paramIndex++}`);
            values.push(settings.enabled);
        }
        if (settings.recipientEmail !== undefined) {
            fields.push(`recipient_email = $${paramIndex++}`);
            values.push(settings.recipientEmail);
        }
        if (settings.senderEmail !== undefined) {
            fields.push(`sender_email = $${paramIndex++}`);
            values.push(settings.senderEmail);
        }
        if (settings.emailSubject !== undefined) {
            fields.push(`email_subject = $${paramIndex++}`);
            values.push(settings.emailSubject);
        }
        if (settings.emailBody !== undefined) {
            fields.push(`email_body = $${paramIndex++}`);
            values.push(settings.emailBody);
        }

        if (fields.length > 0) {
            fields.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(existing.id);
            const result = await query(
                `UPDATE "his_db".low_stock_email_settings SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
                values
            );
            return result.rows[0];
        }
        return existing;
    } else {
        // Create new
        const result = await query(
            `INSERT INTO "his_db".low_stock_email_settings (enabled, recipient_email, sender_email, email_subject, email_body)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                settings.enabled ?? false,
                settings.recipientEmail || 'admin@example.com',
                settings.senderEmail || process.env.RESEND_FROM_EMAIL || 'noreply@example.com',
                settings.emailSubject || 'Low Stock Alert',
                settings.emailBody || 'The following SKUs are running low on stock:'
            ]
        );
        return result.rows[0];
    }
}

export async function updateLowStockEmailLastSent() {
    const existing = await getLowStockEmailSettings();
    if (existing) {
        await query(
            `UPDATE "his_db".low_stock_email_settings SET last_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [existing.id]
        );
    }
}

export async function getSkusWithLowStock() {
    // Get all SKUs that have email alerts enabled and are below threshold
    // Use getCurrentStockState to get accurate stock levels
    const { getAllCurrentStock } = await import('./queries');
    const stockMap = await getAllCurrentStock();
    
    const singleSkus = await query(
        `SELECT * FROM "his_db".single_skus 
         WHERE email_alerts_enabled = true
         AND low_stock_threshold IS NOT NULL`
    );

    const comboSkus = await query(
        `SELECT * FROM "his_db".combo_skus 
         WHERE email_alerts_enabled = true
         AND low_stock_threshold IS NOT NULL`
    );

    const lowStockSingle: any[] = [];
    const lowStockCombo: any[] = [];

    for (const sku of singleSkus.rows) {
        const stock = stockMap[sku.sku];
        if (stock) {
            const currentStock = stock.inWarehouse || 0;
            // Alert triggers when stock <= threshold (inclusive)
            if (currentStock <= sku.low_stock_threshold) {
                lowStockSingle.push({
                    ...sku,
                    currentStock
                });
            }
        }
    }

    for (const sku of comboSkus.rows) {
        const stock = stockMap[sku.sku];
        if (stock) {
            const currentStock = stock.inWarehouse || 0;
            // Alert triggers when stock <= threshold (inclusive)
            if (currentStock <= sku.low_stock_threshold) {
                lowStockCombo.push({
                    ...sku,
                    currentStock
                });
            }
        }
    }

    return {
        single: lowStockSingle,
        combo: lowStockCombo
    };
}
