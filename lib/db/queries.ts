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
        `SELECT * FROM inventory_management.single_skus ORDER BY sku`
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
    createdBy: number;
}) {
    // Start transaction
    const { pool } = await import('./connection');
    if (!pool) {
        throw new Error('Database not configured. Please set DATABASE_URL in .env.local');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create record
        const result = await client.query(
            `INSERT INTO inventory_management.procurement_updates
       (single_sku_id, operation, quantity, previous_quantity, new_quantity, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [data.singleSkuId, data.operation, data.quantity, data.previousQuantity, data.newQuantity, data.notes, data.createdBy]
        );

        // Also log to activity_logs
        const entry = result.rows[0];
        await client.query(
            `INSERT INTO inventory_management.activity_logs
       (user_id, action, entity_type, entity_id, details, success)
       VALUES ($1, 'procurement_update', 'procurement_update', $2, $3, true)`,
            [data.createdBy, entry.id, JSON.stringify(entry)]
        );

        await client.query('COMMIT');
        return entry;
    } catch (e) {
        await client.query('ROLLBACK');
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
