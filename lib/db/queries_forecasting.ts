import { query } from './connection';

export interface ForecastingSettings {
    windowDays?: number;      // 14, 30, 60, 90 (default 30)
    leadTimeDays?: number;    // Supplier turnaround (default 14)
    bufferDays?: number;      // Safety stock buffer (default 14)
    cycleDays?: number;       // Coverage target for each order batch (default 30)
    growthRate?: number;      // Demand growth expectation 0 to 1 (default 0)
}

export interface MonthlyDataPoint {
    month: string;
    units: number;
}

export interface DailyDataPoint {
    day: string;
    units: number;
}

export interface SkuForecastItem {
    sku: string;
    name: string;
    lowStockThreshold: number | null;
    inWarehouse: number;
    processing: number;
    pendingConsult: number;
    pendingReview: number;
    backorder: number;
    reservedStock: number;
    availableForPurchase: number;
    
    // Sales History
    sold7d: number;
    sold14d: number;
    sold30d: number;
    sold60d: number;
    sold90d: number;
    totalSold: number;
    firstSoldAt: string | null;
    lastSoldAt: string | null;
    
    // Velocity & Trends
    dailyVelocity: number;
    dailyVelocity7d: number;
    trend: 'accelerating' | 'steady' | 'slowing' | 'inactive';
    trendRatio: number; // 7d rate / 30d rate
    
    // Forecasting & Inventory Math
    daysOfStockLeft: number;
    estimatedStockoutDate: string | null;
    leadTimeDays: number;
    leadTimeDemand: number;
    safetyStock: number;
    reorderPoint: number;
    targetStockLevel: number;
    recommendedOrderQty: number;
    status: 'critical_stockout' | 'reorder_needed' | 'healthy' | 'overstocked' | 'inactive';

    // Sparkline & History
    monthlyHistory: MonthlyDataPoint[];
    recentDailyHistory: DailyDataPoint[];
}

export interface ForecastingResult {
    summary: {
        totalSkus: number;
        criticalCount: number;
        reorderCount: number;
        healthyCount: number;
        overstockedCount: number;
        inactiveCount: number;
        totalUnitsToOrder: number;
        avgDaysOfSupply: number;
        totalUnitsSold30d: number;
    };
    settings: {
        windowDays: number;
        leadTimeDays: number;
        bufferDays: number;
        cycleDays: number;
        growthRate: number;
    };
    items: SkuForecastItem[];
}

export async function getForecastingData(
    settings: ForecastingSettings = {}
): Promise<ForecastingResult> {
    const windowDays = Math.max(7, Math.min(180, settings.windowDays ?? 30));
    const leadTimeDays = Math.max(1, Math.min(90, settings.leadTimeDays ?? 14));
    const bufferDays = Math.max(0, Math.min(90, settings.bufferDays ?? 14));
    const cycleDays = Math.max(7, Math.min(120, settings.cycleDays ?? 30));
    const growthRate = Math.max(-0.9, Math.min(5, settings.growthRate ?? 0));

    // 1. Fetch SKUs and their latest transaction balance
    const stockQuery = await query(`
        SELECT DISTINCT ON (s.sku)
            s.id,
            s.sku,
            s.name,
            s.low_stock_threshold,
            COALESCE(t.in_warehouse_after, 0)::int as in_warehouse,
            COALESCE(t.processing_after, 0)::int as processing,
            COALESCE(t.pending_consult_after, 0)::int as pending_consult,
            COALESCE(t.pending_review_after, 0)::int as pending_review,
            COALESCE(t.backorder_after, 0)::int as backorder
        FROM "his_db".single_skus s
        LEFT JOIN "his_db".stock_transactions t ON s.sku = t.sku
        WHERE COALESCE(s.hidden, false) = false
        ORDER BY s.sku, t.created_at DESC, t.id DESC;
    `);

    // 2. Fetch rolling sales metrics per SKU
    const salesQuery = await query(`
        SELECT 
            sku,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' AND transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as sold_7d,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '14 days' AND transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as sold_14d,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' AND transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as sold_30d,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '60 days' AND transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as sold_60d,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '90 days' AND transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as sold_90d,
            SUM(CASE WHEN transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as total_sold,
            MIN(created_at) FILTER (WHERE transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0) as first_sold_at,
            MAX(created_at) FILTER (WHERE transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0) as last_sold_at
        FROM "his_db".stock_transactions
        GROUP BY sku;
    `);

    const salesMap = new Map<string, any>();
    for (const r of salesQuery.rows) {
        salesMap.set(r.sku, r);
    }

    // 3. Fetch monthly volume per SKU (last 6 months)
    const monthlyQuery = await query(`
        SELECT 
            sku,
            TO_CHAR(created_at, 'YYYY-MM') as month,
            SUM(CASE WHEN transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as units
        FROM "his_db".stock_transactions
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY sku, TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY sku, month ASC;
    `);

    const monthlyMap = new Map<string, MonthlyDataPoint[]>();
    for (const r of monthlyQuery.rows) {
        if (!monthlyMap.has(r.sku)) {
            monthlyMap.set(r.sku, []);
        }
        monthlyMap.get(r.sku)!.push({ month: r.month, units: r.units });
    }

    // 4. Fetch daily volume for last 14 days (for sparkline)
    const dailyQuery = await query(`
        SELECT 
            sku,
            TO_CHAR(created_at, 'YYYY-MM-DD') as day,
            SUM(CASE WHEN transaction_type = 'order_nv_pending_pickup' AND quantity_change < 0 THEN ABS(quantity_change) ELSE 0 END)::int as units
        FROM "his_db".stock_transactions
        WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY sku, TO_CHAR(created_at, 'YYYY-MM-DD')
        ORDER BY sku, day ASC;
    `);

    const dailyMap = new Map<string, DailyDataPoint[]>();
    for (const r of dailyQuery.rows) {
        if (!dailyMap.has(r.sku)) {
            dailyMap.set(r.sku, []);
        }
        dailyMap.get(r.sku)!.push({ day: r.day, units: r.units });
    }

    // 5. Build SKU forecast models
    let criticalCount = 0;
    let reorderCount = 0;
    let healthyCount = 0;
    let overstockedCount = 0;
    let inactiveCount = 0;
    let totalUnitsToOrder = 0;
    let totalSupplyDaysSum = 0;
    let supplyDaysCount = 0;
    let totalUnitsSold30d = 0;

    const items: SkuForecastItem[] = stockQuery.rows.map((row: any) => {
        const sku = row.sku;
        const sales = salesMap.get(sku) || {
            sold_7d: 0,
            sold_14d: 0,
            sold_30d: 0,
            sold_60d: 0,
            sold_90d: 0,
            total_sold: 0,
            first_sold_at: null,
            last_sold_at: null,
        };

        const inWarehouse = Number(row.in_warehouse) || 0;
        const processing = Number(row.processing) || 0;
        const pendingConsult = Number(row.pending_consult) || 0;
        const pendingReview = Number(row.pending_review) || 0;
        const backorder = Number(row.backorder) || 0;
        const reservedStock = processing + pendingConsult + pendingReview;
        const availableForPurchase = Math.max(0, inWarehouse - reservedStock);

        totalUnitsSold30d += sales.sold_30d;

        // Determine baseline window sales
        let baseSalesInWindow = sales.sold_30d;
        if (windowDays === 14) baseSalesInWindow = sales.sold_14d;
        else if (windowDays === 60) baseSalesInWindow = sales.sold_60d;
        else if (windowDays === 90) baseSalesInWindow = sales.sold_90d;

        const rawVelocity = baseSalesInWindow / windowDays;
        const dailyVelocity = rawVelocity * (1 + growthRate);
        const dailyVelocity7d = (sales.sold_7d || 0) / 7;

        // Trend calculation
        let trend: 'accelerating' | 'steady' | 'slowing' | 'inactive' = 'steady';
        let trendRatio = 1.0;
        if (sales.sold_30d === 0 && sales.sold_7d === 0) {
            trend = 'inactive';
            trendRatio = 0;
        } else if (rawVelocity > 0) {
            trendRatio = dailyVelocity7d / rawVelocity;
            if (trendRatio >= 1.2) trend = 'accelerating';
            else if (trendRatio <= 0.8) trend = 'slowing';
        }

        // Days of stock remaining
        let daysOfStockLeft = 0;
        let estimatedStockoutDate: string | null = null;
        if (dailyVelocity > 0) {
            daysOfStockLeft = Number((availableForPurchase / dailyVelocity).toFixed(1));
            totalSupplyDaysSum += Math.min(180, daysOfStockLeft);
            supplyDaysCount++;

            if (daysOfStockLeft < 365) {
                const stockoutMs = Date.now() + daysOfStockLeft * 86400000;
                estimatedStockoutDate = new Date(stockoutMs).toISOString();
            }
        } else if (availableForPurchase > 0) {
            daysOfStockLeft = 999; // Effectively infinite / inactive
        } else {
            daysOfStockLeft = 0;
        }

        // Reorder point and stock sizing
        const leadTimeDemand = Math.ceil(dailyVelocity * leadTimeDays);
        const safetyStock = Math.ceil(dailyVelocity * bufferDays);
        const reorderPoint = leadTimeDemand + safetyStock;
        const targetStockLevel = Math.ceil(dailyVelocity * (leadTimeDays + cycleDays) + safetyStock);
        const recommendedOrderQty = Math.max(0, targetStockLevel - availableForPurchase);

        // Inventory health status
        let status: 'critical_stockout' | 'reorder_needed' | 'healthy' | 'overstocked' | 'inactive';
        if (sales.total_sold === 0 && availableForPurchase === 0) {
            status = 'inactive';
            inactiveCount++;
        } else if (availableForPurchase <= 0 || (dailyVelocity > 0 && daysOfStockLeft <= leadTimeDays)) {
            status = 'critical_stockout';
            criticalCount++;
        } else if (availableForPurchase <= reorderPoint) {
            status = 'reorder_needed';
            reorderCount++;
        } else if (dailyVelocity > 0 && daysOfStockLeft > 90) {
            status = 'overstocked';
            overstockedCount++;
        } else if (dailyVelocity === 0 && availableForPurchase > 0) {
            status = 'inactive';
            inactiveCount++;
        } else {
            status = 'healthy';
            healthyCount++;
        }

        totalUnitsToOrder += recommendedOrderQty;

        return {
            sku,
            name: row.name || sku,
            lowStockThreshold: row.low_stock_threshold ?? null,
            inWarehouse,
            processing,
            pendingConsult,
            pendingReview,
            backorder,
            reservedStock,
            availableForPurchase,
            sold7d: sales.sold_7d,
            sold14d: sales.sold_14d,
            sold30d: sales.sold_30d,
            sold60d: sales.sold_60d,
            sold90d: sales.sold_90d,
            totalSold: sales.total_sold,
            firstSoldAt: sales.first_sold_at ? new Date(sales.first_sold_at).toISOString() : null,
            lastSoldAt: sales.last_sold_at ? new Date(sales.last_sold_at).toISOString() : null,
            dailyVelocity: Number(dailyVelocity.toFixed(2)),
            dailyVelocity7d: Number(dailyVelocity7d.toFixed(2)),
            trend,
            trendRatio: Number(trendRatio.toFixed(2)),
            daysOfStockLeft,
            estimatedStockoutDate,
            leadTimeDays,
            leadTimeDemand,
            safetyStock,
            reorderPoint,
            targetStockLevel,
            recommendedOrderQty,
            status,
            monthlyHistory: monthlyMap.get(sku) || [],
            recentDailyHistory: dailyMap.get(sku) || [],
        };
    });

    // Sort by priority: critical first, then reorder, then by sales volume descending
    items.sort((a, b) => {
        const orderWeight: Record<string, number> = {
            critical_stockout: 1,
            reorder_needed: 2,
            healthy: 3,
            overstocked: 4,
            inactive: 5,
        };
        const weightDiff = (orderWeight[a.status] || 99) - (orderWeight[b.status] || 99);
        if (weightDiff !== 0) return weightDiff;
        return b.sold30d - a.sold30d;
    });

    const avgDaysOfSupply = supplyDaysCount > 0 ? Number((totalSupplyDaysSum / supplyDaysCount).toFixed(1)) : 0;

    return {
        summary: {
            totalSkus: items.length,
            criticalCount,
            reorderCount,
            healthyCount,
            overstockedCount,
            inactiveCount,
            totalUnitsToOrder,
            avgDaysOfSupply,
            totalUnitsSold30d,
        },
        settings: {
            windowDays,
            leadTimeDays,
            bufferDays,
            cycleDays,
            growthRate,
        },
        items,
    };
}
