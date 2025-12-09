import { query } from './connection';

/**
 * USER OPERATIONS
 */

export async function getUserByGoogleId(googleId: string) {
    const result = await query(
        'SELECT * FROM inventory_management.users WHERE google_id = $1',
        [googleId]
    );
    return result.rows[0];
}

export async function getUserByEmail(email: string) {
    const result = await query(
        'SELECT * FROM inventory_management.users WHERE email = $1',
        [email]
    );
    return result.rows[0];
}

export async function createUser(user: {
    googleId: string;
    email: string;
    name: string;
    picture: string
}) {
    const result = await query(
        `INSERT INTO inventory_management.users (google_id, email, name, picture)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
        [user.googleId, user.email, user.name, user.picture]
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
    operation: 'add' | 'set';
    quantity: number;
    previousQuantity?: number;
    newQuantity?: number;
    notes?: string;
    createdBy: number;
}) {
    // Start transaction
    const client = await import('./connection').then(m => m.pool.connect());
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
    userId?: number;
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
            data.userId,
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
}) {
    let sql = `
    SELECT al.*, u.name as user_name, u.email as user_email, u.picture as user_picture
    FROM inventory_management.activity_logs al
    LEFT JOIN inventory_management.users u ON al.user_id = u.id
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
    return result.rows;
}
