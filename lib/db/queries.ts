import { query, pool } from './connection';

/**
 * USER OPERATIONS
 */

export async function getUserByEmail(email: string) {
    const result = await query(
        'SELECT * FROM inventory_management.users WHERE email = $1',
        [email]
    );
    return result.rows[0];
}

export async function createUser(user: {
    email: string;
    name: string;
    role?: string;
}) {
    const result = await query(
        `INSERT INTO inventory_management.users (email, name, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [user.email, user.name, user.role || 'user']
    );
    return result.rows[0];
}

export async function updateLastLogin(id: number) {
    await query(
        'UPDATE inventory_management.users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
    );
}

/**
 * SKU OPERATIONS
 */

export async function getAllSingleSkus() {
    const result = await query(
        `SELECT * FROM inventory_management.single_skus 
         WHERE LOWER(COALESCE(description, '')) NOT IN ('not for sale', 'dummy sku')
         ORDER BY sku`
    );
    return result.rows;
}

export async function getSingleSkuByCode(sku: string) {
    const result = await query(
        `SELECT * FROM inventory_management.single_skus WHERE sku = $1`,
        [sku]
    );
    return result.rows[0];
}

export async function createSingleSku(data: {
    sku: string;
    name: string;
    woocommerceProductId?: number;
    description?: string;
    createdBy: number;
}) {
    const result = await query(
        `INSERT INTO inventory_management.single_skus 
     (sku, name, woocommerce_product_id, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [data.sku, data.name, data.woocommerceProductId, data.description, data.createdBy]
    );
    return result.rows[0];
}

export async function getAllComboSkus() {
    const result = await query(
        `SELECT * FROM inventory_management.combo_skus 
         WHERE LOWER(COALESCE(description, '')) NOT IN ('not for sale', 'dummy sku')
         ORDER BY sku`
    );
    return result.rows;
}

// Admin functions to get all SKUs including "not for sale" and "dummy sku" items
export async function getAllSingleSkusAdmin() {
    const result = await query(
        `SELECT * FROM inventory_management.single_skus ORDER BY sku`
    );
    return result.rows;
}

export async function getAllComboSkusAdmin() {
    const result = await query(
        `SELECT * FROM inventory_management.combo_skus ORDER BY sku`
    );
    return result.rows;
}

export async function createComboSku(data: {
    sku: string;
    name: string;
    woocommerceProductId?: number;
    components: any;
    description?: string;
    createdBy: number;
}) {
    const result = await query(
        `INSERT INTO inventory_management.combo_skus 
     (sku, name, woocommerce_product_id, components, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
        [data.sku, data.name, data.woocommerceProductId, JSON.stringify(data.components), data.description, data.createdBy]
    );
    return result.rows[0];
}

/**
 * PROCUREMENT & ACTIVITY LOGS
 */

export async function createProcurementUpdate(data: {
    singleSkuId: number;
    operation: 'add' | 'subtract' | 'set';
    quantity: number;
    previousQuantity?: number;
    newQuantity?: number;
    notes?: string;
    returnCondition?: 'lost' | 'damaged' | 'good';
    orderId?: number;
    createdBy: number;
}) {
    // Validate operation value
    if (!['add', 'subtract', 'set'].includes(data.operation)) {
        throw new Error(`Invalid operation: ${data.operation}. Must be 'add', 'subtract', or 'set'`);
    }
    
    // Start transaction
    const { pool } = await import('./connection');
    if (!pool) {
        throw new Error('Database not configured. Please set DATABASE_URL in .env.local');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create record
        // Ensure notes is null (not undefined) for database compatibility
        const notesValue = data.notes && data.notes.trim() ? data.notes.trim() : null;
        console.log(`📝 Inserting procurement update: operation=${data.operation}, quantity=${data.quantity}, notes=${notesValue}`);
        
        const result = await client.query(
            `INSERT INTO inventory_management.procurement_updates
       (single_sku_id, operation, quantity, previous_quantity, new_quantity, notes, return_condition, order_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            [data.singleSkuId, data.operation, data.quantity, data.previousQuantity || null, data.newQuantity || null, notesValue, data.returnCondition || null, data.orderId || null, data.createdBy]
        );

        // Also log to activity_logs
        const entry = result.rows[0];
        console.log(`✅ Procurement update record created: ID=${entry.id}, Operation=${entry.operation}`);
        
        // Explicitly construct details object to ensure operation field is included
        // Use data.operation as source of truth to ensure it's always present
        const details = {
            id: entry.id,
            operation: data.operation, // Use data.operation as source of truth
            quantity: entry.quantity,
            previousQuantity: entry.previous_quantity,
            newQuantity: entry.new_quantity,
            notes: entry.notes,
            returnCondition: entry.return_condition || null,
            orderId: entry.order_id || null,
            createdBy: entry.created_by,
            createdAt: entry.created_at
        };
        
        // Determine action type based on return condition
        const action = data.returnCondition ? 'refund_return' : 'procurement_update';
        
        try {
            await client.query(
                `INSERT INTO inventory_management.activity_logs
           (user_id, action, entity_type, entity_id, details, success)
           VALUES ($1, $2, 'procurement_update', $3, $4, true)`,
                [data.createdBy, action, entry.id, JSON.stringify(details)]
            );
            console.log(`✅ Activity log entry created for ${action} ID=${entry.id}`);
        } catch (activityLogError: any) {
            // If activity log insert fails, log the error but don't rollback the procurement update
            // The procurement update is the primary record, activity log is secondary
            console.error('⚠️ Failed to create activity log entry (but procurement update succeeded):', {
                error: activityLogError?.message,
                code: activityLogError?.code,
                detail: activityLogError?.detail,
                procurementUpdateId: entry.id
            });
            // Continue with commit - the procurement update is more important
        }

        await client.query('COMMIT');
        console.log(`✅ Procurement update transaction committed: ID=${entry.id}, Operation=${entry.operation}`);
        return entry;
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('❌ Procurement update transaction failed:', {
            error: e?.message,
            code: e?.code,
            detail: e?.detail,
            constraint: e?.constraint,
            operation: data.operation,
            singleSkuId: data.singleSkuId,
            quantity: data.quantity
        });
        throw e;
    } finally {
        client.release();
    }
}

export async function logActivity(data: {
    userId?: number | string;
    action: string;
    entityType?: string;
    entityId?: number;
    details?: any;
    success?: boolean;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
}) {
    await query(
        `INSERT INTO inventory_management.activity_logs
     (user_id, action, entity_type, entity_id, details, success, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            typeof data.userId === 'number' ? data.userId : null,
            data.action,
            data.entityType,
            data.entityId,
            data.details ? JSON.stringify(data.details) : null,
            data.success ?? true,
            data.errorMessage,
            data.ipAddress,
            data.userAgent
        ]
    );
}

export async function getActivityLogs(filters: {
    userId?: number;
    limit?: number;
    offset?: number;
    type?: string;
    operation?: string;
    sku?: string;
    dateFrom?: string;
    dateTo?: string;
}) {
    let sql = `
    SELECT 
        al.*, 
        u.name as user_name, 
        u.email as user_email,
        ss.sku as affected_sku,
        to_char(al.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
    FROM inventory_management.activity_logs al
    LEFT JOIN inventory_management.users u ON al.user_id = u.id
    LEFT JOIN inventory_management.procurement_updates pu ON al.entity_type = 'procurement_update' AND al.entity_id = pu.id
    LEFT JOIN inventory_management.single_skus ss ON pu.single_sku_id = ss.id
    WHERE 1=1
  `;
    const params: any[] = [];
    let pIdx = 1;

    if (filters.userId) {
        sql += ` AND al.user_id = $${pIdx++}`;
        params.push(filters.userId);
    }

    if (filters.type) {
        sql += ` AND al.action = $${pIdx++}`;
        params.push(filters.type);
    }

    if (filters.operation) {
        sql += ` AND pu.operation = $${pIdx++}`;
        params.push(filters.operation);
    }

    if (filters.sku) {
        sql += ` AND ss.sku = $${pIdx++}`;
        params.push(filters.sku);
    }

    if (filters.dateFrom) {
        sql += ` AND al.created_at >= $${pIdx++}`;
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        sql += ` AND al.created_at <= $${pIdx++}`;
        params.push(filters.dateTo);
    }

    sql += ` ORDER BY al.created_at DESC`;

    if (filters.limit) {
        sql += ` LIMIT $${pIdx++}`;
        params.push(filters.limit);
    }

    if (filters.offset) {
        sql += ` OFFSET $${pIdx++}`;
        params.push(filters.offset);
    }

    const result = await query(sql, params);
    // Replace created_at with GMT+8 version if available
    return result.rows.map(row => {
        if (row.created_at_gmt8) {
            row.created_at = row.created_at_gmt8;
        }
        return row;
    });
}

export async function logWcWebhook(data: {
    webhookType: 'order' | 'product';
    webhookEvent: string;
    entityId: number;
    entitySku?: string;
    entityName?: string;
    status?: string;
    stockQuantity?: number;
    previousStockQuantity?: number;
    affectedSkus?: string[];
    comboUpdates?: Array<{ sku: string; newStock: number; wcProductId?: number; error?: string }>;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    errorMessage?: string;
}) {
    await query(
        `INSERT INTO inventory_management.wc_webhook_logs
         (webhook_type, webhook_event, entity_id, entity_sku, entity_name, status, stock_quantity, previous_stock_quantity, 
          affected_skus, combo_updates, details, ip_address, user_agent, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
            data.webhookType,
            data.webhookEvent,
            data.entityId,
            data.entitySku || null,
            data.entityName || null,
            data.status || null,
            data.stockQuantity ?? null,
            data.previousStockQuantity ?? null,
            data.affectedSkus ? JSON.stringify(data.affectedSkus) : null,
            data.comboUpdates ? JSON.stringify(data.comboUpdates) : null,
            data.details ? JSON.stringify(data.details) : null,
            data.ipAddress || null,
            data.userAgent || null,
            data.success ?? true,
            data.errorMessage || null
        ]
    );
}

export async function getWcWebhookLogByOrderId(orderId: number, webhookEvent?: string) {
    let sql = `
        SELECT 
            *,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
        FROM inventory_management.wc_webhook_logs
        WHERE webhook_type = 'order'
        AND entity_id = $1
    `;
    const params: any[] = [orderId];
    
    if (webhookEvent) {
        sql += ` AND webhook_event = $2`;
        params.push(webhookEvent);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT 1`;
    
    const result = await query(sql, params);
    if (result.rows.length === 0) {
        return null;
    }
    
    const row = result.rows[0];
    if (row.created_at_gmt8) {
        row.created_at = row.created_at_gmt8;
    }
    // Parse JSONB fields
    if (row.affected_skus && typeof row.affected_skus === 'string') {
        try {
            row.affected_skus = JSON.parse(row.affected_skus);
        } catch (e) {
            row.affected_skus = [];
        }
    }
    if (row.combo_updates && typeof row.combo_updates === 'string') {
        try {
            row.combo_updates = JSON.parse(row.combo_updates);
        } catch (e) {
            row.combo_updates = [];
        }
    }
    if (row.details && typeof row.details === 'string') {
        try {
            row.details = JSON.parse(row.details);
        } catch (e) {
            row.details = {};
        }
    }
    return row;
}

export async function getWcWebhookLogs(filters: {
    webhookType?: 'order' | 'product';
    webhookEvent?: string;
    entitySku?: string;
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
    orderStatus?: string;
}) {
    // Build WHERE clause for both count and data queries
    let whereClause = `WHERE 1=1`;
    const params: any[] = [];
    let pIdx = 1;

    if (filters.webhookType) {
        whereClause += ` AND webhook_type = $${pIdx++}`;
        params.push(filters.webhookType);
    }

    if (filters.webhookEvent) {
        whereClause += ` AND webhook_event = $${pIdx++}`;
        params.push(filters.webhookEvent);
    }

    if (filters.entitySku) {
        // Filter by SKU in multiple places:
        // 1. entity_sku column
        // 2. affected_skus array
        // 3. componentDeductions array in details JSONB
        // 4. componentRestorations array in details JSONB
        const skuParam = pIdx++;
        const affectedSkusParam = pIdx++;
        const componentDeductionsParam = pIdx++;
        const componentRestorationsParam = pIdx++;
        
        whereClause += ` AND (
            entity_sku = $${skuParam} OR
            (affected_skus IS NOT NULL AND affected_skus::jsonb @> $${affectedSkusParam}::jsonb) OR
            (details IS NOT NULL AND details ? 'componentDeductions' AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements(details->'componentDeductions') AS deduction
                WHERE deduction->>'sku' = $${componentDeductionsParam}
            )) OR
            (details IS NOT NULL AND details ? 'componentRestorations' AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements(details->'componentRestorations') AS restoration
                WHERE restoration->>'sku' = $${componentRestorationsParam}
            ))
        )`;
        params.push(filters.entitySku);
        params.push(JSON.stringify([filters.entitySku])); // For affected_skus array check
        params.push(filters.entitySku); // For componentDeductions check
        params.push(filters.entitySku); // For componentRestorations check
    }

    if (filters.dateFrom) {
        whereClause += ` AND created_at >= $${pIdx++}`;
        params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
        whereClause += ` AND created_at <= $${pIdx++}`;
        params.push(filters.dateTo);
    }

    if (filters.orderStatus) {
        whereClause += ` AND status = $${pIdx++}`;
        params.push(filters.orderStatus);
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM inventory_management.wc_webhook_logs ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
    let dataSql = `
        SELECT 
            *,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
        FROM inventory_management.wc_webhook_logs
        ${whereClause}
        ORDER BY created_at DESC
    `;

    const dataParams = [...params];
    let dataPIdx = params.length + 1;

    if (filters.limit) {
        dataSql += ` LIMIT $${dataPIdx++}`;
        dataParams.push(filters.limit);
    }

    if (filters.offset) {
        dataSql += ` OFFSET $${dataPIdx++}`;
        dataParams.push(filters.offset);
    }

    const result = await query(dataSql, dataParams);
    // Replace created_at with GMT+8 version if available
    const rows = result.rows.map(row => {
        if (row.created_at_gmt8) {
            row.created_at = row.created_at_gmt8;
        }
        // Parse JSONB fields
        if (row.affected_skus && typeof row.affected_skus === 'string') {
            try {
                row.affected_skus = JSON.parse(row.affected_skus);
            } catch (e) {
                row.affected_skus = [];
            }
        }
        if (row.combo_updates && typeof row.combo_updates === 'string') {
            try {
                row.combo_updates = JSON.parse(row.combo_updates);
            } catch (e) {
                row.combo_updates = [];
            }
        }
        if (row.details && typeof row.details === 'string') {
            try {
                row.details = JSON.parse(row.details);
            } catch (e) {
                row.details = {};
            }
        }
        return row;
    });

    return { rows, total };
}

/**
 * STOCK TAKE OPERATIONS
 */

export async function createStockTake(data: {
    userId: number;
    month: number;
    year: number;
    snapshotData: any;
}) {
    const result = await query(
        `INSERT INTO inventory_management.stock_takes
         (month, year, snapshot_data, created_by, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [data.month, data.year, JSON.stringify(data.snapshotData), data.userId]
    );
    return result.rows[0];
}

export async function getStockTakeByMonth(month: number, year: number) {
    const result = await query(
        `SELECT st.*, 
                u1.name as created_by_name, u1.email as created_by_email,
                u2.name as completed_by_name, u2.email as completed_by_email,
                to_char(st.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8,
                to_char(st.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as completed_at_gmt8
         FROM inventory_management.stock_takes st
         LEFT JOIN inventory_management.users u1 ON st.created_by = u1.id
         LEFT JOIN inventory_management.users u2 ON st.completed_by = u2.id
         WHERE st.month = $1 AND st.year = $2
         ORDER BY st.created_at DESC
         LIMIT 1`,
        [month, year]
    );
    const row = result.rows[0];
    if (row) {
        // Use GMT+8 timestamps with timezone indicator
        if (row.created_at_gmt8) {
            row.created_at = row.created_at_gmt8;
        }
        if (row.completed_at_gmt8) {
            row.completed_at = row.completed_at_gmt8;
        }
    }
    return row || null;
}

export async function getCurrentStockTake() {
    const now = new Date();
    const month = now.getMonth() + 1; // JavaScript months are 0-indexed
    const year = now.getFullYear();
    return getStockTakeByMonth(month, year);
}

export async function getStockTakeById(id: number) {
    const result = await query(
        `SELECT st.*, 
                u1.name as created_by_name, u1.email as created_by_email,
                u2.name as completed_by_name, u2.email as completed_by_email,
                to_char(st.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8,
                to_char(st.completed_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as completed_at_gmt8
         FROM inventory_management.stock_takes st
         LEFT JOIN inventory_management.users u1 ON st.created_by = u1.id
         LEFT JOIN inventory_management.users u2 ON st.completed_by = u2.id
         WHERE st.id = $1`,
        [id]
    );
    const row = result.rows[0];
    if (row) {
        // Use GMT+8 timestamps with timezone indicator
        if (row.created_at_gmt8) {
            row.created_at = row.created_at_gmt8;
        }
        if (row.completed_at_gmt8) {
            row.completed_at = row.completed_at_gmt8;
        }
    }
    return row || null;
}

export async function createStockTakeItems(stockTakeId: number, items: Array<{
    singleSkuId: number;
    systemQuantity: number;
}>) {
    if (items.length === 0) return [];

    const values = items.map((item, idx) => {
        const baseIdx = idx * 3; // Each item has 3 parameters: stockTakeId, singleSkuId, systemQuantity
        return `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3})`;
    }).join(', ');

    const params: any[] = [];
    items.forEach(item => {
        params.push(stockTakeId, item.singleSkuId, item.systemQuantity);
    });

    const result = await query(
        `INSERT INTO inventory_management.stock_take_items
         (stock_take_id, single_sku_id, system_quantity)
         VALUES ${values}
         RETURNING *`,
        params
    );
    return result.rows;
}

export async function getStockTakeItems(stockTakeId: number) {
    const result = await query(
        `SELECT sti.*, ss.sku, ss.name as sku_name
         FROM inventory_management.stock_take_items sti
         JOIN inventory_management.single_skus ss ON sti.single_sku_id = ss.id
         WHERE sti.stock_take_id = $1
         ORDER BY ss.sku`,
        [stockTakeId]
    );
    return result.rows;
}

export async function updateStockTakeItems(stockTakeId: number, physicalCounts: Array<{
    sku: string;
    physicalQuantity: number;
    remarks?: string | null;
}>) {
    const { pool } = await import('./connection');
    if (!pool) {
        throw new Error('Database not configured');
    }
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Get SKU IDs for the provided SKUs
        const skuMap = new Map<string, number>();
        for (const count of physicalCounts) {
            const skuResult = await client.query(
                'SELECT id FROM inventory_management.single_skus WHERE sku = $1',
                [count.sku]
            );
            if (skuResult.rows.length > 0) {
                skuMap.set(count.sku, skuResult.rows[0].id);
            }
        }

        // Update each item
        for (const count of physicalCounts) {
            const skuId = skuMap.get(count.sku);
            if (!skuId) continue;

            const variance = count.physicalQuantity - (await client.query(
                'SELECT system_quantity FROM inventory_management.stock_take_items WHERE stock_take_id = $1 AND single_sku_id = $2',
                [stockTakeId, skuId]
            )).rows[0]?.system_quantity || 0;

            await client.query(
                `UPDATE inventory_management.stock_take_items
                 SET physical_quantity = $1, variance = $2
                 WHERE stock_take_id = $3 AND single_sku_id = $4`,
                [count.physicalQuantity, variance, stockTakeId, skuId]
            );
        }

        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function completeStockTake(stockTakeId: number, completedBy: number) {
    const result = await query(
        `UPDATE inventory_management.stock_takes
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by = $1
         WHERE id = $2
         RETURNING *`,
        [completedBy, stockTakeId]
    );
    return result.rows[0];
}

export async function markStockTakeItemAdjusted(stockTakeId: number, singleSkuId: number, notes?: string) {
    const result = await query(
        `UPDATE inventory_management.stock_take_items
         SET adjustment_applied = true, adjustment_notes = $1
         WHERE stock_take_id = $2 AND single_sku_id = $3
         RETURNING *`,
        [notes || null, stockTakeId, singleSkuId]
    );
    return result.rows[0];
}
