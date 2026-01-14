import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/connection';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const session = await requireAuth();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const dateFrom = searchParams.get('dateFrom') || undefined;
        const dateTo = searchParams.get('dateTo') || undefined;

        let whereClause = `WHERE 1=1`;
        const params: any[] = [];
        let pIdx = 1;

        // Find failed webhook logs
        whereClause += ` AND success = false`;

        if (dateFrom) {
            whereClause += ` AND created_at >= $${pIdx++}`;
            params.push(dateFrom);
        }

        if (dateTo) {
            whereClause += ` AND created_at <= $${pIdx++}`;
            params.push(dateTo);
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
            LIMIT $${pIdx++}
            OFFSET $${pIdx++}
        `;
        params.push(limit);
        params.push(offset);

        const result = await query(dataSql, params);
        
        // Parse JSONB fields
        const rows = result.rows.map(row => {
            if (row.created_at_gmt8) {
                row.created_at = row.created_at_gmt8;
            }
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

        // Also get activity logs for webhook log failures
        let activityLogSql = `
            SELECT 
                *,
                to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') as created_at_gmt8
            FROM inventory_management.activity_logs
            WHERE action IN ('webhook_log_failed_after_stock_deduction', 'webhook_log_failed_after_stock_restoration', 'webhook_log_failed_product_update')
        `;
        const activityParams: any[] = [];
        let actPIdx = 1;

        if (dateFrom) {
            activityLogSql += ` AND created_at >= $${actPIdx++}`;
            activityParams.push(dateFrom);
        }

        if (dateTo) {
            activityLogSql += ` AND created_at <= $${actPIdx++}`;
            activityParams.push(dateTo);
        }

        activityLogSql += ` ORDER BY created_at DESC LIMIT $${actPIdx++}`;
        activityParams.push(limit);

        const activityResult = await query(activityLogSql, activityParams);
        const activityRows = activityResult.rows.map(row => {
            if (row.created_at_gmt8) {
                row.created_at = row.created_at_gmt8;
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

        return NextResponse.json({
            failed_webhook_logs: rows,
            webhook_log_failures: activityRows,
            total,
            limit,
            offset
        });
    } catch (error: any) {
        console.error('Error fetching failed webhook logs:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}

