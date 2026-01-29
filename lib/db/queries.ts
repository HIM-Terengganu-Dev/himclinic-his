import { query, pool } from './connection';

/**
 * USER OPERATIONS
 */

export async function getUserByEmail(email: string) {
    const result = await query(
        'SELECT * FROM "his_db".users WHERE email = $1',
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
        `INSERT INTO "his_db".users (email, name, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [user.email, user.name, user.role || 'user']
    );
    return result.rows[0];
}

export async function updateLastLogin(id: number) {
    await query(
        'UPDATE "his_db".users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
    );
}

/**
 * SKU OPERATIONS
 */

export async function getAllSingleSkus() {
    const result = await query(
        `SELECT * FROM "his_db".single_skus 
         WHERE LOWER(COALESCE(description, '')) != 'dummy sku'
         AND sku NOT IN ('buku/SM', 'buku/BK')
         ORDER BY sku`
    );
    return result.rows;
}

export async function getSingleSkuByCode(sku: string) {
    const result = await query(
        `SELECT * FROM "his_db".single_skus WHERE sku = $1`,
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
        `INSERT INTO "his_db".single_skus 
     (sku, name, woocommerce_product_id, description, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
        [data.sku, data.name, data.woocommerceProductId, data.description, data.createdBy]
    );
    return result.rows[0];
}

export async function getAllComboSkus() {
    const result = await query(
        `SELECT * FROM "his_db".combo_skus 
         WHERE LOWER(COALESCE(description, '')) != 'dummy sku'
         AND sku NOT IN ('buku/SM', 'buku/BK')
         ORDER BY sku`
    );
    return result.rows;
}

// Admin functions to get all SKUs including "dummy sku" items (for admin management)
export async function getAllSingleSkusAdmin() {
    const result = await query(
        `SELECT * FROM "his_db".single_skus ORDER BY sku`
    );
    return result.rows;
}

export async function getAllComboSkusAdmin() {
    const result = await query(
        `SELECT * FROM "his_db".combo_skus ORDER BY sku`
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
        `INSERT INTO "his_db".combo_skus 
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
            `INSERT INTO "his_db".procurement_updates
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
                `INSERT INTO "his_db".activity_logs
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
    try {
        await query(
            `INSERT INTO "his_db".activity_logs
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
    } catch (error: any) {
        // Check if error is due to constraint violation (e.g., CHECK constraint on action column)
        if (error.code === '23514' || error.message?.includes('check constraint') || error.message?.includes('violates check constraint')) {
            console.error(`❌ CRITICAL: Failed to insert activity log due to constraint violation!`, {
                action: data.action,
                error: error.message,
                code: error.code,
                hint: 'The action value may not be allowed by a CHECK constraint or ENUM type on the action column.',
                suggestion: 'Run docs/CHECK_ACTIVITY_LOGS_SCHEMA.sql to diagnose the issue.'
            });
            throw new Error(`Activity log insert failed: Action "${data.action}" violates table constraint. ${error.message}`);
        }
        // Re-throw other errors
        throw error;
    }
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
    FROM "his_db".activity_logs al
    LEFT JOIN "his_db".users u ON al.user_id = u.id
    LEFT JOIN "his_db".procurement_updates pu ON al.entity_type = 'procurement_update' AND al.entity_id = pu.id
    LEFT JOIN "his_db".single_skus ss ON pu.single_sku_id = ss.id
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
        `INSERT INTO "his_db".wc_webhook_logs
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
        FROM "his_db".wc_webhook_logs
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
        // 3. componentDeductions array in details JSONB (for processing orders)
        // 4. componentRestorations array in details JSONB (for cancelled orders)
        // 5. pendingStockUpdates array in details JSONB (for pending-consult/pending-review orders)
        const skuParam = pIdx++;
        const affectedSkusParam = pIdx++;
        const componentDeductionsParam = pIdx++;
        const componentRestorationsParam = pIdx++;
        const pendingStockUpdatesParam = pIdx++;
        
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
            )) OR
            (details IS NOT NULL AND details ? 'pendingStockUpdates' AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements(details->'pendingStockUpdates') AS pending
                WHERE pending->>'sku' = $${pendingStockUpdatesParam}
            ))
        )`;
        params.push(filters.entitySku);
        params.push(JSON.stringify([filters.entitySku])); // For affected_skus array check
        params.push(filters.entitySku); // For componentDeductions check
        params.push(filters.entitySku); // For componentRestorations check
        params.push(filters.entitySku); // For pendingStockUpdates check
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

    // For order webhooks, group by order ID and show latest status with history
    // For product webhooks, return as-is (no grouping needed)
    // Always group orders unless explicitly filtering for products only
    if (filters.webhookType !== 'product') {
        // Get all order webhook logs (no pagination yet, we'll group first)
        // Add filter for order type if not already filtered
        let orderWhereClause = whereClause;
        if (!filters.webhookType) {
            // If no webhook type filter, only get orders
            orderWhereClause += ` AND webhook_type = 'order'`;
        }
        
        // Get all order logs matching filters
        let allOrdersSql = `
            SELECT 
                *,
                to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
            FROM "his_db".wc_webhook_logs
            ${orderWhereClause}
            ORDER BY entity_id, created_at DESC
        `;
        
        const allOrdersResult = await query(allOrdersSql, params);
        
        // Parse JSONB fields and group by order ID
        const parsedRows = allOrdersResult.rows.map(row => {
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
        
        // Group by order ID
        const orderGroups = new Map<number, typeof parsedRows>();
        for (const row of parsedRows) {
            const orderId = row.entity_id;
            if (!orderGroups.has(orderId)) {
                orderGroups.set(orderId, []);
            }
            orderGroups.get(orderId)!.push(row);
        }
        
        // Get latest status for each order (for display)
        const latestOrders: any[] = [];
        for (const [orderId, history] of orderGroups.entries()) {
            // Latest is first in array (sorted DESC by created_at)
            const latest = history[0];
            latestOrders.push({
                ...latest,
                _isGrouped: true,
                _orderId: orderId,
                _history: history // Full history for dropdown
            });
        }
        
        // Sort by latest order's created_at DESC
        latestOrders.sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            return bTime - aTime;
        });
        
        // Apply pagination to grouped results
        const total = latestOrders.length;
        const paginatedOrders = filters.limit 
            ? latestOrders.slice(filters.offset || 0, (filters.offset || 0) + filters.limit)
            : latestOrders;
        
        return { rows: paginatedOrders, total };
    }
    
    // For product webhooks or when webhookType is 'product', return as-is
    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM "his_db".wc_webhook_logs ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total);

    // Get paginated data
    let dataSql = `
        SELECT 
            *,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
        FROM "his_db".wc_webhook_logs
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
 * Find orders with duplicate processing (same order processed multiple times)
 * Useful for detecting double deduction issues, especially for combo SKUs
 */
export async function findDuplicateProcessingOrders() {
    const sql = `
        SELECT 
            entity_id as order_id,
            COUNT(*) as processing_count,
            ARRAY_AGG(id ORDER BY created_at) as log_ids,
            ARRAY_AGG(created_at ORDER BY created_at) as processing_times,
            ARRAY_AGG(success ORDER BY created_at) as success_statuses
        FROM "his_db".wc_webhook_logs
        WHERE webhook_type = 'order'
        AND webhook_event = 'order.processing'
        GROUP BY entity_id
        HAVING COUNT(*) > 1
        ORDER BY processing_count DESC, entity_id DESC
    `;
    
    const result = await query(sql, []);
    
    // For each duplicate order, get detailed component deduction info
    const detailedResults = await Promise.all(
        result.rows.map(async (row: any) => {
            const detailSql = `
                SELECT 
                    id,
                    created_at,
                    success,
                    details->'componentDeductions' as component_deductions,
                    details->'comboSkusOrdered' as combo_skus_ordered
                FROM "his_db".wc_webhook_logs
                WHERE entity_id = $1
                AND webhook_event = 'order.processing'
                ORDER BY created_at
            `;
            const detailResult = await query(detailSql, [row.order_id]);
            
            return {
                order_id: row.order_id,
                processing_count: row.processing_count,
                log_ids: row.log_ids,
                processing_times: row.processing_times,
                success_statuses: row.success_statuses,
                details: detailResult.rows.map((r: any) => {
                    // Parse JSONB fields
                    let componentDeductions = r.component_deductions;
                    if (typeof componentDeductions === 'string') {
                        try {
                            componentDeductions = JSON.parse(componentDeductions);
                        } catch (e) {
                            componentDeductions = [];
                        }
                    }
                    
                    let comboSkusOrdered = r.combo_skus_ordered;
                    if (typeof comboSkusOrdered === 'string') {
                        try {
                            comboSkusOrdered = JSON.parse(comboSkusOrdered);
                        } catch (e) {
                            comboSkusOrdered = [];
                        }
                    }
                    
                    return {
                        log_id: r.id,
                        created_at: r.created_at,
                        success: r.success,
                        component_deductions: componentDeductions,
                        combo_skus_ordered: comboSkusOrdered,
                        has_combo_sku: Array.isArray(comboSkusOrdered) && comboSkusOrdered.length > 0
                    };
                })
            };
        })
    );
    
    return detailedResults;
}

/**
 * Investigate stock changes for a specific SKU between two orders
 * Useful for debugging missing stock changes
 */
export async function investigateStockChangesBetweenOrders(
    sku: string,
    orderId1: number,
    orderId2: number
) {
    // Get order timestamps
    const orderTimesSql = `
        SELECT 
            MIN(created_at) - INTERVAL '1 day' as start_time,
            MAX(created_at) + INTERVAL '1 day' as end_time
        FROM "his_db".wc_webhook_logs
        WHERE entity_id IN ($1, $2)
        AND webhook_event = 'order.processing'
    `;
    const orderTimes = await query(orderTimesSql, [orderId1, orderId2]);
    if (orderTimes.rows.length === 0) {
        return { error: 'One or both orders not found' };
    }
    const { start_time, end_time } = orderTimes.rows[0];

    // Get manual procurement updates
    const manualSql = `
        SELECT 
            pu.created_at,
            'Manual: ' || pu.operation as activity_type,
            ss.sku,
            pu.previous_quantity as stock_before,
            pu.new_quantity as stock_after,
            pu.quantity as change_amount,
            pu.notes,
            NULL::text as order_id,
            'HIS' as source
        FROM "his_db".procurement_updates pu
        JOIN "his_db".single_skus ss ON pu.single_sku_id = ss.id
        WHERE ss.sku = $1
        AND pu.created_at BETWEEN $2 AND $3
        ORDER BY pu.created_at
    `;
    const manual = await query(manualSql, [sku, start_time, end_time]);

    // Get order deductions
    const orderDeductionsSql = `
        SELECT 
            w.created_at,
            'Order: Deduction' as activity_type,
            deduction->>'sku' as sku,
            (deduction->>'previousStock')::int as stock_before,
            (deduction->>'newStock')::int as stock_after,
            (deduction->>'deductedQty')::int as change_amount,
            NULL as notes,
            w.entity_id::text as order_id,
            CASE 
                WHEN (deduction->>'isWcSide')::boolean THEN 'WC'
                ELSE 'HIS'
            END as source
        FROM "his_db".wc_webhook_logs w,
             jsonb_array_elements(w.details->'componentDeductions') AS deduction
        WHERE w.webhook_type = 'order'
        AND w.webhook_event = 'order.processing'
        AND deduction->>'sku' = $1
        AND w.created_at BETWEEN $2 AND $3
        ORDER BY w.created_at
    `;
    const orderDeductions = await query(orderDeductionsSql, [sku, start_time, end_time]);

    // Get order restorations
    const orderRestorationsSql = `
        SELECT 
            w.created_at,
            'Order: Restoration' as activity_type,
            restoration->>'sku' as sku,
            (restoration->>'previousStock')::int as stock_before,
            (restoration->>'newStock')::int as stock_after,
            (restoration->>'restoredQty')::int as change_amount,
            NULL as notes,
            w.entity_id::text as order_id,
            CASE 
                WHEN (restoration->>'isWcSide')::boolean THEN 'WC'
                ELSE 'HIS'
            END as source
        FROM "his_db".wc_webhook_logs w,
             jsonb_array_elements(w.details->'componentRestorations') AS restoration
        WHERE w.webhook_type = 'order'
        AND w.webhook_event LIKE 'order.cancelled%'
        AND restoration->>'sku' = $1
        AND w.created_at BETWEEN $2 AND $3
        ORDER BY w.created_at
    `;
    const orderRestorations = await query(orderRestorationsSql, [sku, start_time, end_time]);

    // Get product updates
    const productUpdatesSql = `
        SELECT 
            w.created_at,
            'Product: Update' as activity_type,
            w.entity_sku as sku,
            w.previous_stock_quantity as stock_before,
            w.stock_quantity as stock_after,
            w.stock_quantity - w.previous_stock_quantity as change_amount,
            NULL as notes,
            NULL::text as order_id,
            'WC' as source
        FROM "his_db".wc_webhook_logs w
        WHERE w.webhook_type = 'product'
        AND w.entity_sku = $1
        AND w.created_at BETWEEN $2 AND $3
        ORDER BY w.created_at
    `;
    const productUpdates = await query(productUpdatesSql, [sku, start_time, end_time]);

    // Combine all results
    const allChanges = [
        ...manual.rows,
        ...orderDeductions.rows,
        ...orderRestorations.rows,
        ...productUpdates.rows
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return {
        sku,
        orderId1,
        orderId2,
        timeRange: { start_time, end_time },
        changes: allChanges,
        summary: {
            total_changes: allChanges.length,
            manual_changes: manual.rows.length,
            order_deductions: orderDeductions.rows.length,
            order_restorations: orderRestorations.rows.length,
            product_updates: productUpdates.rows.length
        }
    };
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
        `INSERT INTO "his_db".stock_takes
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
         FROM "his_db".stock_takes st
         LEFT JOIN "his_db".users u1 ON st.created_by = u1.id
         LEFT JOIN "his_db".users u2 ON st.completed_by = u2.id
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
         FROM "his_db".stock_takes st
         LEFT JOIN "his_db".users u1 ON st.created_by = u1.id
         LEFT JOIN "his_db".users u2 ON st.completed_by = u2.id
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
        `INSERT INTO "his_db".stock_take_items
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
         FROM "his_db".stock_take_items sti
         JOIN "his_db".single_skus ss ON sti.single_sku_id = ss.id
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
                'SELECT id FROM "his_db".single_skus WHERE sku = $1',
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
                'SELECT system_quantity FROM "his_db".stock_take_items WHERE stock_take_id = $1 AND single_sku_id = $2',
                [stockTakeId, skuId]
            )).rows[0]?.system_quantity || 0;

            await client.query(
                `UPDATE "his_db".stock_take_items
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
        `UPDATE "his_db".stock_takes
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP, completed_by = $1
         WHERE id = $2
         RETURNING *`,
        [completedBy, stockTakeId]
    );
    return result.rows[0];
}

export async function markStockTakeItemAdjusted(stockTakeId: number, singleSkuId: number, notes?: string) {
    const result = await query(
        `UPDATE "his_db".stock_take_items
         SET adjustment_applied = true, adjustment_notes = $1
         WHERE stock_take_id = $2 AND single_sku_id = $3
         RETURNING *`,
        [notes || null, stockTakeId, singleSkuId]
    );
    return result.rows[0];
}

/**
 * Calculate pending stock for a SKU at a specific point in time
 * Uses stock_transactions table (source of truth)
 */
export async function getPendingStockAtTime(sku: string, timestamp: Date): Promise<number> {
    const timeStr = timestamp.toISOString();
    
    // Get the latest transaction before the timestamp
    const result = await query(
        `SELECT pending_after
         FROM "his_db".stock_transactions
         WHERE sku = $1
         AND created_at < $2
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [sku, timeStr]
    );
    
    if (result.rows.length === 0) {
        return 0;
    }
    
    return parseInt(result.rows[0].pending_after || '0', 10);
}

/**
 * ========================================
 * NEW TRANSACTION-BASED STOCK SYSTEM
 * ========================================
 * These functions use stock_transactions table as the source of truth
 */

/**
 * Get current stock state for a SKU from the latest transaction
 */
export async function getCurrentStockState(sku: string): Promise<{
    stock: number;
    pending: number;
    display: number;
}> {
    const result = await query(`
        SELECT 
            stock_after as stock,
            pending_after as pending,
            (stock_after + pending_after) as display
        FROM "his_db".stock_transactions
        WHERE sku = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [sku]);
    
    if (result.rows.length === 0) {
        // No transactions yet - this should only happen before initial reconciliation
        // After reconciliation, there should always be at least one transaction
        throw new Error(`No stock transactions found for SKU: ${sku}. Please run reconciliation.`);
    }
    
    return {
        stock: result.rows[0].stock,
        pending: result.rows[0].pending,
        display: result.rows[0].display
    };
}

/**
 * Create a stock transaction (core function for all stock changes)
 */
export async function createStockTransaction(data: {
    sku: string;
    singleSkuId?: number;
    transactionType: 'order_pending_consult' | 'order_pending_review' | 'order_processing' | 'order_cancelled' | 'manual_add' | 'manual_subtract' | 'manual_set' | 'reconciliation' | 'refund_return';
    quantityChange: number;
    stockBefore: number;
    stockAfter: number;
    pendingBefore: number;
    pendingAfter: number;
    sourceType?: string;
    sourceId?: number;
    sourceEvent?: string;
    createdBy?: number;
    details?: any;
}): Promise<any> {
    // Validate: stock_after should equal stock_before + quantity_change
    if (data.stockAfter !== data.stockBefore + data.quantityChange) {
        throw new Error(`Stock calculation mismatch: ${data.stockBefore} + ${data.quantityChange} ≠ ${data.stockAfter}`);
    }
    
    const detailsJson = data.details ? JSON.stringify(data.details) : null;
    
    const result = await query(`
        INSERT INTO "his_db".stock_transactions (
            sku, single_sku_id, transaction_type,
            quantity_change, stock_before, stock_after,
            pending_before, pending_after,
            source_type, source_id, source_event,
            created_by, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
    `, [
        data.sku,
        data.singleSkuId || null,
        data.transactionType,
        data.quantityChange,
        data.stockBefore,
        data.stockAfter,
        data.pendingBefore,
        data.pendingAfter,
        data.sourceType || null,
        data.sourceId || null,
        data.sourceEvent || null,
        data.createdBy || null,
        detailsJson
    ]);
    
    // Note: We read directly from transactions, so no materialized view refresh needed
    
    return result.rows[0];
}

/**
 * Get pending stock records for a specific order from stock_transactions
 * Replaces getPendingConsultationStockByOrder (legacy pending_consultation_stock table)
 */
export async function getPendingStockByOrderFromTransactions(orderId: number): Promise<Array<{ sku: string; quantity: number }>> {
    const result = await query(`
        SELECT 
            sku,
            ABS(quantity_change) as quantity
        FROM "his_db".stock_transactions
        WHERE source_id = $1
        AND source_type = 'order'
        AND transaction_type IN ('order_pending_consult', 'order_pending_review')
        AND pending_after > pending_before
        ORDER BY sku
    `, [orderId]);
    
    return result.rows.map((r: any) => ({
        sku: r.sku,
        quantity: parseInt(r.quantity || '0', 10)
    }));
}

/**
 * Remove pending stock for an order by creating transactions
 * Replaces removePendingConsultationStock (legacy pending_consultation_stock table)
 */
export async function removePendingStockByOrder(orderId: number): Promise<void> {
    // Get all pending stock transactions for this order
    const pendingTransactions = await query(`
        SELECT 
            sku,
            single_sku_id,
            pending_before,
            pending_after,
            ABS(quantity_change) as pending_quantity
        FROM "his_db".stock_transactions
        WHERE source_id = $1
        AND source_type = 'order'
        AND transaction_type IN ('order_pending_consult', 'order_pending_review')
        AND pending_after > pending_before
    `, [orderId]);
    
    // For each SKU that had pending stock, create a transaction to remove it
    for (const tx of pendingTransactions.rows) {
        const currentState = await getCurrentStockState(tx.sku);
        const pendingBefore = currentState.pending;
        const pendingAfter = Math.max(0, pendingBefore - parseInt(tx.pending_quantity || '0', 10));
        
        // Only create transaction if there's actually pending to remove
        if (pendingAfter < pendingBefore) {
            await createStockTransaction({
                sku: tx.sku,
                singleSkuId: tx.single_sku_id || undefined,
                transactionType: 'order_cancelled',
                quantityChange: 0, // No stock change, just pending removal
                stockBefore: currentState.stock,
                stockAfter: currentState.stock,
                pendingBefore,
                pendingAfter,
                sourceType: 'order',
                sourceId: orderId,
                sourceEvent: 'order.cancelled',
                details: {
                    removedPending: pendingBefore - pendingAfter,
                    reason: 'Cancelled from pending-consult/pending-review'
                }
            });
        }
    }
}

/**
 * Get stock transactions for a SKU (for history/display)
 */
export async function getStockTransactions(filters: {
    sku?: string;
    transactionType?: string;
    sourceType?: string;
    sourceId?: number;
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
}) {
    let sql = `
        SELECT 
            t.*,
            ss.name as sku_name
        FROM "his_db".stock_transactions t
        LEFT JOIN "his_db".single_skus ss ON t.single_sku_id = ss.id
        WHERE 1=1
    `;
    const params: any[] = [];
    let pIdx = 1;
    
    if (filters.sku) {
        sql += ` AND t.sku = $${pIdx++}`;
        params.push(filters.sku);
    }
    
    if (filters.transactionType) {
        sql += ` AND t.transaction_type = $${pIdx++}`;
        params.push(filters.transactionType);
    }
    
    if (filters.sourceType) {
        sql += ` AND t.source_type = $${pIdx++}`;
        params.push(filters.sourceType);
    }
    
    if (filters.sourceId) {
        sql += ` AND t.source_id = $${pIdx++}`;
        params.push(filters.sourceId);
    }
    
    if (filters.dateFrom) {
        sql += ` AND t.created_at >= $${pIdx++}`;
        params.push(filters.dateFrom);
    }
    
    if (filters.dateTo) {
        sql += ` AND t.created_at <= $${pIdx++}`;
        params.push(filters.dateTo);
    }
    
    sql += ` ORDER BY t.created_at DESC, t.id DESC`;
    
    if (filters.limit) {
        sql += ` LIMIT $${pIdx++}`;
        params.push(filters.limit);
    }
    
    if (filters.offset) {
        sql += ` OFFSET $${pIdx++}`;
        params.push(filters.offset);
    }
    
    const result = await query(sql, params);
    
    // Parse JSONB details field
    return result.rows.map((row: any) => {
        if (row.details && typeof row.details === 'string') {
            try {
                row.details = JSON.parse(row.details);
            } catch (e) {
                row.details = {};
            }
        }
        return row;
    });
}

/**
 * Get current stock for all SKUs (read directly from transactions - more reliable than materialized view)
 */
export async function getAllCurrentStock(): Promise<Record<string, { stock: number; pending: number; display: number }>> {
    // Read directly from transactions using DISTINCT ON for latest per SKU
    const result = await query(`
        SELECT DISTINCT ON (sku)
            sku,
            stock_after as stock,
            pending_after as pending,
            (stock_after + pending_after) as display
        FROM "his_db".stock_transactions
        ORDER BY sku, created_at DESC, id DESC
    `, []);
    
    const stockMap: Record<string, { stock: number; pending: number; display: number }> = {};
    result.rows.forEach((row: any) => {
        stockMap[row.sku] = {
            stock: row.stock,
            pending: row.pending,
            display: row.display
        };
    });
    
    return stockMap;
}