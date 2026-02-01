'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { formatDateTimeWithSecondsGMT8 } from '@/lib/utils/date';
import { fetchWithRole } from '@/lib/utils/fetchWithRole';
import { Download, RefreshCw, Filter, Search, User, AlertCircle, AlertTriangle, CheckCircle2, Package, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react';

interface ActivityLogEntry {
    id: number;
    user_name: string;
    user_email: string;
    user_picture: string;
    action: string;
    details: any;
    success: boolean;
    error_message?: string;
    created_at: string;
    affected_sku?: string;
}

interface WcWebhookLogEntry {
    id: number;
    webhook_type: 'order' | 'product';
    webhook_event: string;
    entity_id: number;
    entity_sku?: string;
    entity_name?: string;
    status?: string;
    stock_quantity?: number;
    previous_stock_quantity?: number;
    affected_skus?: string[];
    combo_updates?: Array<{ sku: string; newStock: number; wcProductId?: number; error?: string }>;
    details: any;
    success: boolean;
    error_message?: string;
    created_at: string;
    _isGrouped?: boolean;
    _orderId?: number;
    _history?: WcWebhookLogEntry[];
}

type TabType = 'manual' | 'orders';

export default function ActivityLog({ limit = 20, compact = false }: { limit?: number, compact?: boolean }) {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<TabType>('manual');
    const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
    const [wcLogs, setWcLogs] = useState<WcWebhookLogEntry[]>([]);
    const [allWcLogs, setAllWcLogs] = useState<WcWebhookLogEntry[]>([]); // All logs for pending stock calculation (without SKU filter)
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filterType, setFilterType] = useState('');
    const [filterSku, setFilterSku] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [filterOrderStatus, setFilterOrderStatus] = useState('');
    const [singleSkus, setSingleSkus] = useState<Array<{ sku: string; name: string }>>([]);
    const [comboSkus, setComboSkus] = useState<Array<{ sku: string; name: string }>>([]);
    const [wcCurrentPage, setWcCurrentPage] = useState(1);
    const [wcTotalCount, setWcTotalCount] = useState(0);
    const [componentDeductionsCache, setComponentDeductionsCache] = useState<Record<number, any[]>>({});
    const topScrollRef = useRef<HTMLDivElement>(null);
    const bottomScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Fetch single SKUs for filter dropdown
        fetchWithRole('/api/skus/single')
            .then(res => res.json())
            .then(data => {
                if (data.skus) {
                    setSingleSkus(data.skus.map((s: any) => ({ sku: s.sku, name: s.name })));
                }
            })
            .catch(err => console.error('Failed to fetch SKUs:', err));
        
        // Fetch combo SKUs for Orders filter dropdown
        fetchWithRole('/api/skus/combo')
            .then(res => res.json())
            .then(data => {
                if (data.skus) {
                    setComboSkus(data.skus.map((s: any) => ({ sku: s.sku, name: s.name })));
                }
            })
            .catch(err => console.error('Failed to fetch combo SKUs:', err));
    }, []);

    const fetchManualLogs = async () => {
        try {
            const queryParams = new URLSearchParams();
            if (limit) queryParams.append('limit', limit.toString());
            if (filterType) {
                // Handle filterType format: "procurement_update:add" or just "procurement_update"
                if (filterType.includes(':')) {
                    const [action, operation] = filterType.split(':');
                    queryParams.append('type', action);
                    queryParams.append('operation', operation);
                } else {
                    queryParams.append('type', filterType);
                }
            }
            if (filterSku) queryParams.append('sku', filterSku);
            if (filterDateFrom) queryParams.append('dateFrom', filterDateFrom);
            if (filterDateTo) queryParams.append('dateTo', filterDateTo);

            const res = await fetchWithRole(`/api/activity-logs?${queryParams.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch logs');

            const data = await res.json();
            setLogs(data.logs);
        } catch (error) {
            console.error('Error fetching activity logs:', error);
        }
    };

    const fetchWcWebhookLogs = async () => {
        try {
            const queryParams = new URLSearchParams();
            if (limit) queryParams.append('limit', limit.toString());
            const offset = (wcCurrentPage - 1) * (limit || 20);
            queryParams.append('offset', offset.toString());
            if (filterType) {
                if (filterType === 'order') {
                    queryParams.append('type', 'order');
                } else if (filterType === 'product') {
                    queryParams.append('type', 'product');
                }
            }
            if (filterSku) queryParams.append('sku', filterSku);
            if (filterDateFrom) queryParams.append('dateFrom', filterDateFrom);
            if (filterDateTo) queryParams.append('dateTo', filterDateTo);
            if (filterOrderStatus) queryParams.append('orderStatus', filterOrderStatus);

            const res = await fetchWithRole(`/api/webhook-logs?${queryParams.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch webhook logs');

            const data = await res.json();
            setWcLogs(data.logs || []);
            setWcTotalCount(data.total || 0);
            
            // Also fetch ALL logs (without SKU filter AND without date filters) for pending stock calculations
            // This ensures we have all pending-consult logs from other orders, even if they're outside the current date filter
            // Date filters would exclude relevant pending-consult logs that affect pending stock calculations
            const allLogsParams = new URLSearchParams();
            if (filterType) {
                if (filterType === 'order') {
                    allLogsParams.append('type', 'order');
                } else if (filterType === 'product') {
                    allLogsParams.append('type', 'product');
                }
            }
            // IMPORTANT: Don't include SKU filter OR date filters for all logs
            // We need ALL pending-consult logs to calculate pending stock correctly, regardless of date filters
            // Only apply orderStatus filter if needed (but this might also exclude relevant logs)
            // if (filterOrderStatus) allLogsParams.append('orderStatus', filterOrderStatus);
            // Fetch with a high limit to get all logs (or implement pagination if needed)
            allLogsParams.append('limit', '10000'); // High limit to get all logs
            
            const allLogsRes = await fetchWithRole(`/api/webhook-logs?${allLogsParams.toString()}`);
            if (allLogsRes.ok) {
                const allLogsData = await allLogsRes.json();
                setAllWcLogs(allLogsData.logs || []);
            }
        } catch (error) {
            console.error('Error fetching webhook logs:', error);
        }
    };

    const fetchLogs = async () => {
        try {
            setRefreshing(true);
            await Promise.all([
                fetchManualLogs(),
                fetchWcWebhookLogs()
            ]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // Reset to page 1 when filters change
    useEffect(() => {
        setWcCurrentPage(1);
    }, [filterType, filterSku, filterDateFrom, filterDateTo, filterOrderStatus, activeTab]);

    useEffect(() => {
        fetchLogs();
    }, [filterType, filterSku, filterDateFrom, filterDateTo, filterOrderStatus, activeTab, wcCurrentPage]);
    
    // Fetch component deductions from database for all order events
    useEffect(() => {
        const fetchComponentDeductions = async () => {
            // Get all order logs (not just processing)
            const orderLogs = wcLogs.filter(log => 
                log.webhook_type === 'order' && log.entity_id
            );
            
            const orderIds = orderLogs
                .map(log => log.entity_id)
                .filter((id, index, self) => self.indexOf(id) === index) // unique
                .filter(id => id && !componentDeductionsCache[id]); // not already cached
            
            if (orderIds.length === 0) return;
            
            const promises = orderIds.map(async (orderId) => {
                try {
                    const res = await fetchWithRole(`/api/orders/${orderId}/component-deductions`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.success && data.componentDeductions) {
                            return { orderId, deductions: data.componentDeductions };
                        }
                    }
                } catch (error) {
                    console.error(`Failed to fetch component deductions for order ${orderId}:`, error);
                }
                return null;
            });
            
            const results = await Promise.all(promises);
            const newCache: Record<number, any[]> = {};
            results.forEach(result => {
                if (result) {
                    newCache[result.orderId] = result.deductions;
                }
            });
            
            if (Object.keys(newCache).length > 0) {
                setComponentDeductionsCache(prev => ({ ...prev, ...newCache }));
            }
        };
        
        if (wcLogs.length > 0 && activeTab === 'orders') {
            fetchComponentDeductions();
        }
    }, [wcLogs, activeTab]);

    // Sync scroll between top and bottom scrollbars
    useEffect(() => {
        const topScroll = topScrollRef.current;
        const bottomScroll = bottomScrollRef.current;
        
        if (!topScroll || !bottomScroll) return;

        // Function to sync table width to top scrollbar
        const syncWidth = () => {
            const table = bottomScroll.querySelector('table');
            if (table) {
                const tableWidth = table.scrollWidth;
                const topScrollContent = topScroll.querySelector('div');
                if (topScrollContent) {
                    topScrollContent.style.minWidth = `${tableWidth}px`;
                }
            }
        };

        // Initial sync and on resize
        syncWidth();
        const resizeObserver = new ResizeObserver(syncWidth);
        if (bottomScroll) {
            resizeObserver.observe(bottomScroll);
        }

        const handleTopScroll = () => {
            if (bottomScroll) {
                bottomScroll.scrollLeft = topScroll.scrollLeft;
            }
        };

        const handleBottomScroll = () => {
            if (topScroll) {
                topScroll.scrollLeft = bottomScroll.scrollLeft;
            }
        };

        topScroll.addEventListener('scroll', handleTopScroll);
        bottomScroll.addEventListener('scroll', handleBottomScroll);

        return () => {
            resizeObserver.disconnect();
            topScroll.removeEventListener('scroll', handleTopScroll);
            bottomScroll.removeEventListener('scroll', handleBottomScroll);
        };
    }, [logs.length, wcLogs.length, activeTab]);

    const handleExport = () => {
        const headers = activeTab === 'manual' 
            ? ['Timestamp', 'User', 'Action', 'SKU', 'Success', 'Details', 'Error']
            : ['Timestamp', 'Type', 'Entity', 'SKU', 'Status', 'Combo Updates', 'Success', 'Error'];
        
        const data = activeTab === 'manual' ? logs : wcLogs;
        
        const csvContent = [
            headers.join(','),
            ...data.map((log: any) => {
                if (activeTab === 'manual') {
                    let actionLabel = log.action;
                    if (log.action === 'procurement_update' && log.details) {
                        const operation = log.details.operation;
                        if (operation === 'add') actionLabel = 'Manual Stock In';
                        else if (operation === 'subtract') actionLabel = 'Manual Stock Out';
                        else if (operation === 'set') actionLabel = 'Reconciliation';
                    }
                    
                    return [
                        `"${formatDateTimeWithSecondsGMT8(log.created_at)}"`,
                        `"${log.user_name || log.user_email || 'System'}"`,
                        `"${actionLabel}"`,
                        `"${log.affected_sku || ''}"`,
                        log.success ? 'Yes' : 'No',
                        `"${JSON.stringify(log.details).replace(/"/g, '""')}"`,
                        `"${log.error_message || ''}"`
                    ].join(',');
                } else {
                    return [
                        `"${formatDateTimeWithSecondsGMT8(log.created_at)}"`,
                        `"${log.webhook_type}"`,
                        `"${log.entity_name || `#${log.entity_id}`}"`,
                        `"${log.entity_sku || ''}"`,
                        `"${log.status || ''}"`,
                        `"${JSON.stringify(log.combo_updates || []).replace(/"/g, '""')}"`,
                        log.success ? 'Yes' : 'No',
                        `"${log.error_message || ''}"`
                    ].join(',');
                }
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeTab === 'manual' ? 'activity-log' : 'wc-webhook-log'}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const getActionLabel = (log: ActivityLogEntry) => {
        const action = log.action;
        
        if (action === 'refund_return') {
            return 'Refund/Return';
        }
        
        if (action === 'procurement_update' && log.details) {
            const operation = log.details.operation;
            switch (operation) {
                case 'add': return 'Manual Stock In';
                case 'subtract': return 'Manual Stock Out';
                case 'set': return 'Reconciliation';
                default: return 'Stock Update';
            }
        }
        
        // Webhook log failure actions
        if (action === 'webhook_log_failed_after_stock_deduction') {
            return '⚠️ Webhook Log Failed (Stock Deducted)';
        }
        if (action === 'webhook_log_failed_after_stock_restoration') {
            return '⚠️ Webhook Log Failed (Stock Restored)';
        }
        if (action === 'webhook_log_failed_product_update') {
            return '⚠️ Webhook Log Failed (Product Updated)';
        }
        
        switch (action) {
            case 'procurement_update': return 'Stock Update';
            case 'sku_created': return 'Created SKU';
            case 'sku_updated': return 'Updated SKU';
            case 'manual_adjustment': return 'Manual Adjustment';
            default: return action.replace(/_/g, ' ');
        }
    };

    const getActionColor = (log: ActivityLogEntry) => {
        if (log.action === 'refund_return') {
            return 'bg-orange-100 text-orange-800 border border-orange-200';
        }
        
        if (log.action === 'procurement_update' && log.details) {
            const operation = log.details.operation;
            switch (operation) {
                case 'add': return 'bg-green-100 text-green-800 border border-green-200';
                case 'subtract': return 'bg-orange-100 text-orange-800 border border-orange-200';
                case 'set': return 'bg-blue-100 text-blue-800 border border-blue-200';
                default: return 'bg-gray-100 text-gray-800';
            }
        }
        
        if (log.action.includes('sku')) return 'bg-purple-100 text-purple-800';
        if (log.action.includes('error')) return 'bg-red-100 text-red-800';
        if (log.action.includes('webhook_log_failed')) return 'bg-red-100 text-red-800 border border-red-200'; // Critical errors
        if (log.action.includes('stock_take')) return 'bg-indigo-100 text-indigo-800';
        return 'bg-gray-100 text-gray-800';
    };

    const getWebhookEventLabel = (event: string) => {
        if (event.includes('order.')) {
            return event.replace('order.', 'Order ').replace('_', ' ').toUpperCase();
        }
        if (event.includes('product.')) {
            return event.replace('product.', 'Product ').replace('_', ' ').toUpperCase();
        }
        return event.replace(/_/g, ' ').toUpperCase();
    };

    const getWebhookTypeColor = (type: string, status?: string) => {
        if (type === 'order') {
            // Show yellow for pending-consult and pending-review status
            if (status === 'pending-consult' || status === 'pending-review') return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
            return 'bg-green-100 text-green-800';
        }
        if (type === 'product') return 'bg-blue-100 text-blue-800';
        return 'bg-gray-100 text-gray-800';
    };

    const currentLogs = activeTab === 'manual' ? logs : wcLogs;

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${compact ? '' : 'p-6'}`}>
            {!compact && (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">Activity Log</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                {activeTab === 'manual' 
                                    ? 'Audit trail of all manual system changes'
                                    : 'Stock changes and triggers from Orders (order updates, reconciliations)'
                                }
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <div className="relative">
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                                >
                                    {activeTab === 'manual' ? (
                                        <>
                                            <option value="">All Actions</option>
                                            <option value="procurement_update:add">Manual Stock In</option>
                                            <option value="procurement_update:subtract">Manual Stock Out</option>
                                            <option value="procurement_update:set">Reconciliation</option>
                                            <option value="stock_take_adjustment">Stock Take Adjustment</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="">All Types</option>
                                            <option value="order">Orders</option>
                                            <option value="product">Products</option>
                                        </>
                                    )}
                                </select>
                                <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            </div>

                            {activeTab === 'orders' && (filterType === '' || filterType === 'order') && (
                                <div className="relative">
                                    <select
                                        value={filterOrderStatus}
                                        onChange={(e) => setFilterOrderStatus(e.target.value)}
                                        className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                                    >
                                        <option value="">All Order Statuses</option>
                                        <option value="processing">Processing</option>
                                        <option value="pending-consult">Pending Consultation</option>
                                        <option value="pending-review">Pending Review</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                    <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                            )}

                            <div className="relative">
                                <select
                                    value={filterSku}
                                    onChange={(e) => setFilterSku(e.target.value)}
                                    className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                                >
                                    <option value="">All SKUs</option>
                                    {activeTab === 'orders' ? (
                                        <>
                                            {singleSkus.map((sku) => (
                                                <option key={sku.sku} value={sku.sku}>
                                                    {sku.sku}
                                                </option>
                                            ))}
                                            {comboSkus.map((sku) => (
                                                <option key={sku.sku} value={sku.sku}>
                                                    {sku.sku}
                                                </option>
                                            ))}
                                        </>
                                    ) : (
                                        singleSkus.map((sku) => (
                                            <option key={sku.sku} value={sku.sku}>
                                                {sku.sku}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            </div>

                            <input
                                type="date"
                                value={filterDateFrom}
                                onChange={(e) => setFilterDateFrom(e.target.value)}
                                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="From Date"
                            />

                            <input
                                type="date"
                                value={filterDateTo}
                                onChange={(e) => setFilterDateTo(e.target.value)}
                                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="To Date"
                            />

                            <button
                                onClick={handleExport}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                            >
                                <Download size={16} />
                                Export CSV
                            </button>

                            <button
                                onClick={fetchLogs}
                                disabled={refreshing}
                                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                                title="Refresh Logs"
                            >
                                <RefreshCw size={20} className={`${refreshing ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 border-b border-gray-200">
                        <button
                            onClick={() => setActiveTab('manual')}
                            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                                activeTab === 'manual'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <User size={16} />
                                HIS System
                            </div>
                        </button>
                        <button
                            onClick={() => setActiveTab('orders')}
                            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                                activeTab === 'orders'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <Package size={16} />
                                Orders
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {loading && currentLogs.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
            ) : (
                <div className="relative">
                    {/* Top horizontal scrollbar (above header) */}
                    <div 
                        ref={topScrollRef}
                        className="overflow-x-auto overflow-y-hidden mb-0 border-b border-gray-200 rounded-t-lg"
                        style={{ height: '17px' }}
                    >
                        <div style={{ height: '1px', minWidth: '100%' }}></div>
                    </div>
                    
                    {/* Table container with both scrollbars */}
                    <div 
                        ref={bottomScrollRef}
                        className="overflow-auto max-h-[600px] border-x border-b border-gray-200 rounded-b-lg"
                    >
                        <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-100 sticky top-0 z-10">
                            <tr>
                                {activeTab === 'manual' ? (
                                    <>
                                        <th className="px-6 py-4">Time</th>
                                        <th className="px-6 py-4">User</th>
                                        <th className="px-6 py-4">Action</th>
                                        <th className="px-6 py-4">SKU</th>
                                        <th className="px-6 py-4">Details</th>
                                        <th className="px-6 py-4">Status</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-6 py-4">Time</th>
                                        <th className="px-6 py-4">Type</th>
                                        <th className="px-6 py-4">Entity</th>
                                        <th className="px-6 py-4">SKU</th>
                                        <th className="px-6 py-4 min-w-[200px]">Component Deductions</th>
                                        <th className="px-6 py-4">Combo Updates</th>
                                        <th className="px-6 py-4">Status</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {currentLogs.length > 0 ? (
                                activeTab === 'manual' ? (
                                    logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                {formatDateTimeWithSecondsGMT8(log.created_at)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    {log.user_picture ? (
                                                        <img
                                                            src={log.user_picture}
                                                            alt={log.user_name}
                                                            className="w-8 h-8 rounded-full border border-gray-100"
                                                        />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                                                            <User size={16} />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="font-medium text-gray-900">{log.user_name || 'System'}</p>
                                                        <p className="text-xs text-gray-500">{log.user_email || ''}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getActionColor(log)}`}>
                                                    {getActionLabel(log)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {log.affected_sku ? (
                                                    <span className="font-mono text-sm font-medium text-gray-900 bg-gray-50 px-2 py-1 rounded">
                                                        {log.affected_sku}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="max-w-xs truncate text-gray-600">
                                                    {(log.action === 'procurement_update' || log.action === 'refund_return') && log.details ? (
                                                        <div className="space-y-1">
                                                            <span>
                                                                {log.details.operation === 'add' ? 'Added' : log.details.operation === 'subtract' ? 'Deducted' : 'Set to'} <strong>{log.details.quantity}</strong> units
                                                                {(log.details.previousQuantity !== undefined && log.details.newQuantity !== undefined) && (
                                                                    <span className="ml-2 text-gray-600">
                                                                        (from <strong>{log.details.previousQuantity}</strong> to <strong>{log.details.newQuantity}</strong>)
                                                                    </span>
                                                                )}
                                                                {log.details.returnCondition && (
                                                                    <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                                        log.details.returnCondition === 'good' ? 'bg-green-100 text-green-800' :
                                                                        log.details.returnCondition === 'damaged' ? 'bg-orange-100 text-orange-800' :
                                                                        'bg-red-100 text-red-800'
                                                                    }`}>
                                                                        Return: {log.details.returnCondition.charAt(0).toUpperCase() + log.details.returnCondition.slice(1)}
                                                                    </span>
                                                                )}
                                                                {log.details.orderId && (
                                                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title="Order ID">
                                                                        Order #{log.details.orderId}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {log.details.notes && (
                                                                <div className="text-xs text-gray-400">{log.details.notes}</div>
                                                            )}
                                                        </div>
                                                    ) : log.action.includes('webhook_log_failed') && log.details ? (
                                                        <div className="space-y-1">
                                                            <div className="text-xs font-medium text-red-700">
                                                                {log.details.note || 'Webhook log failed - manual reconciliation required'}
                                                            </div>
                                                            {log.details.orderId && (
                                                                <div className="text-xs">
                                                                    <span className="font-medium">Order:</span> #{log.details.orderId}
                                                                </div>
                                                            )}
                                                            {log.details.componentDeductions && Array.isArray(log.details.componentDeductions) && log.details.componentDeductions.length > 0 && (
                                                                <div className="text-xs">
                                                                    <span className="font-medium">Affected:</span> {log.details.componentDeductions.map((d: any) => d.sku).join(', ')}
                                                                </div>
                                                            )}
                                                            {log.details.componentRestorations && Array.isArray(log.details.componentRestorations) && log.details.componentRestorations.length > 0 && (
                                                                <div className="text-xs">
                                                                    <span className="font-medium">Affected:</span> {log.details.componentRestorations.map((r: any) => r.sku).join(', ')}
                                                                </div>
                                                            )}
                                                            {log.details.sku && (
                                                                <div className="text-xs">
                                                                    <span className="font-medium">SKU:</span> {log.details.sku}
                                                                </div>
                                                            )}
                                                            {log.error_message && (
                                                                <div className="text-xs text-red-600 mt-1">
                                                                    <span className="font-medium">Error:</span> {log.error_message}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="truncate">{JSON.stringify(log.details)}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {log.success ? (
                                                    <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                                                        <CheckCircle2 size={16} />
                                                        Success
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium" title={log.error_message}>
                                                        <AlertCircle size={16} />
                                                        Failed
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    (() => {
                                        // Flatten all logs - if a log has _history, expand it to individual entries
                                        const allLogs: WcWebhookLogEntry[] = [];
                                        
                                        for (const log of wcLogs) {
                                            if (log._isGrouped && log._history && Array.isArray(log._history)) {
                                                // If grouped, add all history entries individually
                                                allLogs.push(...log._history);
                                            } else {
                                                // Otherwise, add the log as-is
                                                allLogs.push(log);
                                            }
                                        }
                                        
                                        // Filter to only show first pending and first processing event per order ID
                                        // Rule: If there's a pending event, ignore any processing that comes BEFORE the pending
                                        // This prevents showing glitchy WC webhooks where processing fires before pending
                                        const seenEvents = new Map<string, boolean>(); // key: "orderId:eventType"
                                        const filteredLogs: WcWebhookLogEntry[] = [];
                                        
                                        // First pass: Find earliest pending event per order
                                        const orderPendingTimes = new Map<number, number>(); // orderId -> earliest pending timestamp
                                        
                                        // Sort by time ascending first to get chronological order
                                        allLogs.sort((a, b) => {
                                            const aTime = new Date(a.created_at).getTime();
                                            const bTime = new Date(b.created_at).getTime();
                                            return aTime - bTime;
                                        });
                                        
                                        // First pass: identify earliest pending events per order
                                        for (const log of allLogs) {
                                            if (log.webhook_type === 'order' && log.entity_id) {
                                                const orderId = log.entity_id;
                                                const eventType = log.webhook_event || log.status || '';
                                                const isPending = eventType.includes('pending-consult') || eventType === 'pending-consult' || 
                                                    eventType.includes('pending-review') || eventType === 'pending-review' ||
                                                    log.status === 'pending-consult' || log.status === 'pending-review' ||
                                                    log.webhook_event === 'order.pending-consult' || log.webhook_event === 'order.pending-review';
                                                
                                                if (isPending && !orderPendingTimes.has(orderId)) {
                                                    orderPendingTimes.set(orderId, new Date(log.created_at).getTime());
                                                }
                                            }
                                        }
                                        
                                        // Second pass: filter events
                                        for (const log of allLogs) {
                                            if (log.webhook_type === 'order' && log.entity_id) {
                                                const orderId = log.entity_id;
                                                const eventType = log.webhook_event || log.status || '';
                                                const logTime = new Date(log.created_at).getTime();
                                                
                                                // Determine the event type key
                                                // Treat all pending events (consult/review) as "pending"
                                                let eventKey: string | null = null;
                                                const isPending = eventType.includes('pending-consult') || eventType === 'pending-consult' || 
                                                    eventType.includes('pending-review') || eventType === 'pending-review' ||
                                                    log.status === 'pending-consult' || log.status === 'pending-review' ||
                                                    log.webhook_event === 'order.pending-consult' || log.webhook_event === 'order.pending-review';
                                                
                                                const isProcessing = eventType.includes('processing') || eventType === 'processing' ||
                                                    log.status === 'processing' || log.webhook_event === 'order.processing';
                                                
                                                if (isPending) {
                                                    eventKey = `${orderId}:pending`;
                                                } else if (isProcessing) {
                                                    eventKey = `${orderId}:processing`;
                                                    
                                                    // Rule: If there's a pending event for this order, ignore processing that comes BEFORE pending
                                                    //       If there's NO pending event, include processing (order goes straight to processing)
                                                    const earliestPendingTime = orderPendingTimes.get(orderId);
                                                    if (earliestPendingTime !== undefined && logTime < earliestPendingTime) {
                                                        // Skip this processing event - it comes before pending (glitch from WC)
                                                        continue;
                                                    }
                                                    // If earliestPendingTime is undefined (no pending event), this processing event is valid
                                                }
                                                
                                                // Only include if this is the first occurrence of this event type for this order
                                                if (eventKey && !seenEvents.has(eventKey)) {
                                                    seenEvents.set(eventKey, true);
                                                    filteredLogs.push(log);
                                                } else if (!eventKey) {
                                                    // For other event types (cancelled, etc.), always include
                                                    filteredLogs.push(log);
                                                }
                                            } else {
                                                // For non-order events (products, etc.), always include
                                                filteredLogs.push(log);
                                            }
                                        }
                                        
                                        // Sort by time descending (latest first) for display
                                        filteredLogs.sort((a, b) => {
                                            const aTime = new Date(a.created_at).getTime();
                                            const bTime = new Date(b.created_at).getTime();
                                            return bTime - aTime;
                                        });
                                        
                                        return filteredLogs.map((logEntry) => {
                                            // For logs that came from grouped history, ensure they have access to the full history
                                            // for pending stock calculations
                                            const history = logEntry._history || [logEntry];
                                            const logEntryWithHistory = logEntry._history ? logEntry : { ...logEntry, _history: history };
                                            
                                            return (
                                                <tr 
                                                    key={logEntry.id} 
                                                    className="hover:bg-gray-50/50 transition-colors"
                                                >
                                                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                        {formatDateTimeWithSecondsGMT8(logEntry.created_at)}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getWebhookTypeColor(logEntry.webhook_type, logEntry.status)}`}>
                                                            {logEntry.webhook_type === 'order' ? <ShoppingCart size={12} className="mr-1" /> : <Package size={12} className="mr-1" />}
                                                            {logEntry.webhook_type}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="text-gray-900 font-medium">
                                                            {logEntry.entity_name || `#${logEntry.entity_id}`}
                                                        </div>
                                                        {logEntry.status && (
                                                            <div className="text-xs text-gray-500">{logEntry.status}</div>
                                                        )}
                                                        {/* Display edge case warning */}
                                                        {logEntry.details?.isEdgeCase && (
                                                            <div className="mt-1">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-300">
                                                                    <AlertTriangle size={12} className="mr-1" />
                                                                    {logEntry.details.edgeCaseType === 'shipped_order_cancelled' 
                                                                        ? 'EDGE CASE: Shipped Order Cancelled'
                                                                        : 'EDGE CASE'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {/* For orders: Show SKUs with quantities from lineItems */}
                                                        {logEntry.webhook_type === 'order' && logEntry.details?.lineItems && Array.isArray(logEntry.details.lineItems) && logEntry.details.lineItems.length > 0 ? (
                                                            <div className="font-mono text-xs text-gray-700">
                                                                {logEntry.details.lineItems.map((item: any, itemIdx: number) => (
                                                                    <span key={itemIdx}>
                                                                        {item.sku}
                                                                        {item.quantity && item.quantity > 0 && (
                                                                            <span className="text-gray-500 ml-1">(x{item.quantity})</span>
                                                                        )}
                                                                        {itemIdx < logEntry.details.lineItems.length - 1 && (
                                                                            <>
                                                                                ,<br />
                                                                            </>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : logEntry.webhook_type === 'order' && logEntry.affected_skus && Array.isArray(logEntry.affected_skus) && logEntry.affected_skus.length > 0 ? (
                                                            /* Fallback: Show affected_skus if lineItems not available */
                                                            <div className="font-mono text-xs text-gray-700">
                                                                {logEntry.affected_skus.map((sku: string, skuIdx: number) => (
                                                                    <span key={skuIdx}>
                                                                        {sku}
                                                                        {skuIdx < logEntry.affected_skus!.length - 1 && (
                                                                            <>
                                                                                ,<br />
                                                                            </>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : logEntry.webhook_type === 'product' && logEntry.entity_sku ? (
                                                            /* For products: Show entitySku (the SKU that was manually edited) */
                                                            <span className="text-gray-700 font-mono text-xs">{logEntry.entity_sku}</span>
                                                        ) : logEntry.affected_skus && Array.isArray(logEntry.affected_skus) && logEntry.affected_skus.length > 0 ? (
                                                            /* Fallback for orders: Show affected_skus if available */
                                                            <div className="font-mono text-xs text-gray-700">
                                                                {logEntry.affected_skus.map((sku: string, skuIdx: number) => (
                                                                    <span key={skuIdx}>
                                                                        {sku}
                                                                        {skuIdx < logEntry.affected_skus!.length - 1 && (
                                                                            <>
                                                                                ,<br />
                                                                            </>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : logEntry.entity_sku ? (
                                                            /* Fallback for products: Show entity_sku */
                                                            <span className="text-gray-700 font-mono text-xs">{logEntry.entity_sku}</span>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 min-w-[200px]">
                                                        {/* Show component restorations for cancelled orders */}
                                                        {logEntry.details?.componentRestorations && Array.isArray(logEntry.details.componentRestorations) && logEntry.details.componentRestorations.length > 0 ? (
                                                            <div className="min-w-[200px]">
                                                                {logEntry.details.componentRestorations.map((restoration: any, restorationIdx: number) => (
                                                                    <div key={restorationIdx} className="text-xs text-gray-600 mb-2">
                                                                        <div className="font-mono">{restoration.sku}</div>
                                                                        <div className="whitespace-nowrap">
                                                                            <span className="text-gray-500">:{restoration.previousStock}</span>
                                                                            <span className="text-gray-500">→</span>
                                                                            <span className="text-green-600 font-medium">{restoration.newStock}</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                                {/* Display edge case warning note after restorations */}
                                                                {logEntry.details?.isEdgeCase && logEntry.details?.note && (
                                                                    <div className="mt-3 pt-3 border-t border-red-200">
                                                                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                                                                            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                                                                            <div className="flex-1">
                                                                                <p className="text-xs font-semibold text-red-800 mb-1">⚠️ Edge Case Detected</p>
                                                                                <p className="text-xs text-red-700">{logEntry.details.note}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (() => {
                                                            // Try to get component deductions from database (stock_transactions)
                                                            const orderId = logEntry.entity_id;
                                                            const dbDeductions = componentDeductionsCache[orderId] || [];
                                                            
                                                            // Match deductions to this specific log entry by event type and timestamp
                                                            // Get the event type from logEntry - check current_status first, then webhook_event, then status
                                                            const eventType = (logEntry as any).current_status || logEntry.webhook_event || logEntry.status || '';
                                                            const logTime = new Date(logEntry.created_at).getTime();
                                                            
                                                            // Map webhook event to transaction type
                                                            const mapEventToTransactionType = (event: string): string => {
                                                                if (!event) return '';
                                                                const lowerEvent = event.toLowerCase();
                                                                if (lowerEvent.includes('pending-consult') || lowerEvent === 'pending-consult') return 'order_pending_consult';
                                                                if (lowerEvent.includes('pending-review') || lowerEvent === 'pending-review') return 'order_pending_review';
                                                                if (lowerEvent.includes('processing') || lowerEvent === 'processing') return 'order_processing';
                                                                if (lowerEvent.includes('nv-pending-pickup') || lowerEvent === 'nv-pending-pickup' || lowerEvent.includes('nv_pending_pickup')) return 'order_nv_pending_pickup';
                                                                if (lowerEvent.includes('cancelled') || lowerEvent === 'cancelled') return 'order_cancelled';
                                                                return '';
                                                            };
                                                            
                                                            const expectedTransactionType = mapEventToTransactionType(eventType);
                                                            
                                                            // Find deductions that match this event (same event type and similar timestamp)
                                                            // IMPORTANT: Only show transactions that match the current log entry's event type
                                                            const matchingDeductions = dbDeductions.filter((deduction: any) => {
                                                                const deductionTime = new Date(deduction.createdAt).getTime();
                                                                const timeDiff = Math.abs(deductionTime - logTime);
                                                                // Match if within 30 seconds (to handle timing differences between webhook and transaction creation)
                                                                const timeMatches = timeDiff < 30000;
                                                                
                                                                // Strict transaction type matching - must exactly match the expected type
                                                                const txType = deduction.transactionType || deduction.sourceEvent || '';
                                                                let typeMatches = false;
                                                                
                                                                if (expectedTransactionType && txType) {
                                                                    // Normalize both types for comparison (handle underscores, hyphens, prefixes)
                                                                    const normalizeType = (t: string) => {
                                                                        return t.toLowerCase()
                                                                            .replace(/^order[._-]?/, '')
                                                                            .replace(/[_-]/g, '_');
                                                                    };
                                                                    
                                                                    const normalizedTxType = normalizeType(txType);
                                                                    const normalizedExpected = normalizeType(expectedTransactionType);
                                                                    
                                                                    typeMatches = normalizedTxType === normalizedExpected;
                                                                } else if (!expectedTransactionType) {
                                                                    // If no expected type, don't match (shouldn't happen, but be safe)
                                                                    typeMatches = false;
                                                                }
                                                                
                                                                return timeMatches && typeMatches;
                                                            });
                                                            
                                                            // Fallback to webhook log data if database data not available
                                                            // IMPORTANT: Do NOT fall back to all dbDeductions - only show matching transactions
                                                            const webhookDeductions = logEntry.details?.componentDeductions || [];
                                                            const deductions = matchingDeductions.length > 0 ? matchingDeductions : webhookDeductions;
                                                            
                                                            if (deductions.length === 0) {
                                                                // If no deductions, check for pendingStockUpdates
                                                                if (logEntry.details?.pendingStockUpdates && Array.isArray(logEntry.details.pendingStockUpdates) && logEntry.details.pendingStockUpdates.length > 0) {
                                                                    return null; // Will be handled by next ternary
                                                                }
                                                                return <span className="text-gray-400 text-xs">—</span>;
                                                            }
                                                            
                                                            // Get transaction event label
                                                            const getTransactionEventLabel = (deduction: any) => {
                                                                const txType = deduction.transactionType || deduction.sourceEvent || eventType;
                                                                if (txType) {
                                                                    if (txType.includes('pending_consult')) return 'Pending Consult';
                                                                    if (txType.includes('pending_review')) return 'Pending Review';
                                                                    if (txType.includes('processing')) return 'Processing';
                                                                    if (txType.includes('nv_pending_pickup') || txType.includes('nv-pending-pickup')) return 'NV Pending Pickup';
                                                                    if (txType.includes('cancelled')) return 'Cancelled';
                                                                    return txType.replace(/order[._]/g, '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                                                                }
                                                                return eventType.replace(/order[._]/g, '').replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                                                            };
                                                            
                                                            return (
                                                                <div className="min-w-[200px]">
                                                                    {deductions.map((deduction: any, deductionIdx: number) => {
                                                                        // Get transaction type to determine if in_warehouse changes should be shown
                                                                        // Check deduction first, then fall back to log entry's event type
                                                                        const txType = deduction.transactionType || deduction.sourceEvent || eventType || '';
                                                                        const isProcessingTransaction = txType.includes('processing') || txType === 'order_processing' || 
                                                                                                      logEntry.webhook_event === 'order.processing' || 
                                                                                                      logEntry.status === 'processing';
                                                                        
                                                                        // Get before and after values
                                                                        // If deduction has the new fields, use them; otherwise try to calculate from webhook log details
                                                                        let inWarehouseBefore = deduction.inWarehouseBefore ?? deduction.stockBefore ?? deduction.previousStock ?? 0;
                                                                        let inWarehouseAfter = deduction.inWarehouseAfter ?? deduction.stockAfter ?? deduction.newStock ?? 0;
                                                                        let processingBefore = deduction.processingBefore ?? 0;
                                                                        let processingAfter = deduction.processingAfter ?? 0;
                                                                        let pendingConsultBefore = deduction.pendingConsultBefore ?? 0;
                                                                        let pendingConsultAfter = deduction.pendingConsultAfter ?? 0;
                                                                        let pendingReviewBefore = deduction.pendingReviewBefore ?? 0;
                                                                        let pendingReviewAfter = deduction.pendingReviewAfter ?? 0;
                                                                        let backorderBefore = deduction.backorderBefore ?? 0;
                                                                        let backorderAfter = deduction.backorderAfter ?? 0;
                                                                        
                                                                        // If this is a webhook log detail (missing new fields), try to infer values
                                                                        // For processing transactions, we can infer from deductedQty
                                                                        if (isProcessingTransaction && processingBefore === 0 && processingAfter === 0) {
                                                                            // This is likely a webhook log detail - try to infer processing change
                                                                            const deductedQty = deduction.deductedQty || Math.abs(deduction.quantityChange || 0) || 0;
                                                                            if (deductedQty > 0) {
                                                                                // For processing, we add to processing count
                                                                                // We don't know the exact before value, but we can show the change
                                                                                // Use a placeholder approach: show 0 → deductedQty if we can't determine before
                                                                                // But better: check if we can get current state from other deductions
                                                                                processingAfter = deductedQty;
                                                                                // Note: processingBefore stays 0 if we can't determine it
                                                                                // This will show "Processing: 0 → X" which is acceptable
                                                                            }
                                                                        }
                                                                        
                                                                        // Get available before and after (use API values if available, otherwise calculate)
                                                                        // For processing transactions, use in_warehouse_before for both (since in_warehouse doesn't change)
                                                                        const effectiveInWarehouseBefore = inWarehouseBefore;
                                                                        const effectiveInWarehouseAfter = isProcessingTransaction ? inWarehouseBefore : inWarehouseAfter; // Processing doesn't change in_warehouse
                                                                        const availableBefore = deduction.availableForPurchaseBefore ?? Math.max(0, effectiveInWarehouseBefore - pendingConsultBefore - pendingReviewBefore - processingBefore);
                                                                        const availableAfter = deduction.availableForPurchaseAfter ?? deduction.availableForPurchase ?? Math.max(0, effectiveInWarehouseAfter - pendingConsultAfter - pendingReviewAfter - processingAfter);
                                                                        
                                                                        // Build list of changed statuses
                                                                        const changedStatuses: Array<{ label: string; before: number; after: number; color: string }> = [];
                                                                        
                                                                        // Processing transactions should NOT change in_warehouse
                                                                        // If they do, it's a data issue - don't display it
                                                                        if (inWarehouseBefore !== inWarehouseAfter && !isProcessingTransaction) {
                                                                            changedStatuses.push({ label: 'In Warehouse', before: inWarehouseBefore, after: inWarehouseAfter, color: 'text-gray-900' });
                                                                        }
                                                                        if (availableBefore !== availableAfter) {
                                                                            changedStatuses.push({ label: 'Available', before: availableBefore, after: availableAfter, color: 'text-green-600' });
                                                                        }
                                                                        if (processingBefore !== processingAfter) {
                                                                            changedStatuses.push({ label: 'Processing', before: processingBefore, after: processingAfter, color: 'text-blue-600' });
                                                                        }
                                                                        if (pendingConsultBefore !== pendingConsultAfter) {
                                                                            changedStatuses.push({ label: 'Pending Consult', before: pendingConsultBefore, after: pendingConsultAfter, color: 'text-yellow-600' });
                                                                        }
                                                                        if (pendingReviewBefore !== pendingReviewAfter) {
                                                                            changedStatuses.push({ label: 'Pending Review', before: pendingReviewBefore, after: pendingReviewAfter, color: 'text-yellow-600' });
                                                                        }
                                                                        if (backorderBefore !== backorderAfter) {
                                                                            changedStatuses.push({ label: 'Backorder', before: backorderBefore, after: backorderAfter, color: 'text-orange-600' });
                                                                        }
                                                                        
                                                                        return (
                                                                            <div key={deductionIdx} className="text-xs text-gray-600 mb-3 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                                                                                <div className="font-mono font-semibold mb-1">{deduction.sku}</div>
                                                                                <div className="text-xs font-medium text-gray-500 mb-1.5">
                                                                                    {getTransactionEventLabel(deduction)}
                                                                                </div>
                                                                                {changedStatuses.length > 0 ? (
                                                                                    <div className="mt-1 space-y-1">
                                                                                        {changedStatuses.map((status, statusIdx) => (
                                                                                            <div key={statusIdx} className="whitespace-nowrap">
                                                                                                <span className="text-gray-500">{status.label}: </span>
                                                                                                <span className={`font-medium ${status.color}`}>
                                                                                                    {status.before} → {status.after}
                                                                                                </span>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="text-gray-400 text-xs italic">No changes</div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })()}
                                                        {/* Show pending stock updates for pending-consult/pending-review orders */}
                                                        {(() => {
                                                            // Only show if not already showing component deductions or restorations
                                                            const hasRestorations = logEntry.details?.componentRestorations && Array.isArray(logEntry.details.componentRestorations) && logEntry.details.componentRestorations.length > 0;
                                                            const orderId = logEntry.entity_id;
                                                            const dbDeductions = componentDeductionsCache[orderId] || [];
                                                            const webhookDeductions = logEntry.details?.componentDeductions || [];
                                                            const hasDeductions = (dbDeductions.length > 0 || webhookDeductions.length > 0);
                                                            
                                                            if (hasRestorations || hasDeductions) return null;
                                                            
                                                            if (logEntry.details?.pendingStockUpdates && Array.isArray(logEntry.details.pendingStockUpdates) && logEntry.details.pendingStockUpdates.length > 0) {
                                                                return (
                                                                    <div className="min-w-[200px] mt-2">
                                                                        {logEntry.details.pendingStockUpdates.map((pending: any, pendingIdx: number) => {
                                                                            // Calculate pending stock from OTHER orders at the time of this pending order
                                                                            const currentOrderTime = new Date(logEntry.created_at).getTime();
                                                                            let pendingFromOtherOrders = 0;
                                                                            
                                                                            // Track pending stock by order ID to handle removals correctly
                                                                            const pendingByOrder = new Map<number, number>();
                                                                            
                                                                            // Use allWcLogs (without SKU filter) for pending stock calculation
                                                                            const logsForPendingCalc = allWcLogs.length > 0 ? allWcLogs : wcLogs;
                                                                            const sortedLogs = [...logsForPendingCalc].sort((a, b) => 
                                                                                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                                                                            );
                                                                            
                                                                            // Look through all webhook logs to calculate pending stock from other orders
                                                                            sortedLogs.forEach((log: WcWebhookLogEntry) => {
                                                                                const logTime = new Date(log.created_at).getTime();
                                                                                if (logTime >= currentOrderTime) return; // Only look at logs before this order
                                                                                
                                                                                // Skip this order's own logs
                                                                                if (log.entity_id === logEntry.entity_id) return;
                                                                                
                                                                                // Add pending stock from pending-consult/pending-review entries
                                                                                // Check both status and webhook_event to ensure we catch all pending logs
                                                                                const isPendingLog = (log.status === 'pending-consult' || log.status === 'pending-review') ||
                                                                                                    (log.webhook_event === 'order.pending-consult' || log.webhook_event === 'order.pending-review');
                                                                                
                                                                                if (isPendingLog && log.details?.pendingStockUpdates) {
                                                                                    const pendingUpdate = log.details.pendingStockUpdates.find((p: any) => p.sku === pending.sku);
                                                                                    if (pendingUpdate) {
                                                                                        pendingByOrder.set(log.entity_id, pendingUpdate.quantity);
                                                                                    }
                                                                                }
                                                                                
                                                                                // Remove pending stock when order is processed (pending tracking is removed)
                                                                                if (log.webhook_event === 'order.processing' && pendingByOrder.has(log.entity_id)) {
                                                                                    pendingByOrder.delete(log.entity_id);
                                                                                }
                                                                                
                                                                                // Remove pending stock when order is cancelled from pending status
                                                                                if (log.webhook_event === 'order.cancelled' && 
                                                                                    (log.details?.previousStatus === 'pending-consult' || log.details?.previousStatus === 'pending-review') &&
                                                                                    pendingByOrder.has(log.entity_id)) {
                                                                                    pendingByOrder.delete(log.entity_id);
                                                                                }
                                                                            });
                                                                            
                                                                            // Sum up all remaining pending stock from other orders
                                                                            pendingFromOtherOrders = Array.from(pendingByOrder.values()).reduce((sum, qty) => sum + qty, 0);
                                                                            
                                                                            // Total pending stock after this order (others + this order)
                                                                            const totalPendingAfter = pendingFromOtherOrders + pending.quantity;
                                                                            
                                                                            // Display: WC stock before + pending from others → WC stock after + total pending (others + this order)
                                                                            // Example: 83+4→82+5 (where +4 is pending from others, +5 is total pending after adding this order's +1)
                                                                            const wcStockBefore = pending.wcStock + pending.quantity; // WC stock before deduction
                                                                            const wcStockAfter = pending.wcStock; // WC stock after deduction
                                                                            
                                                                            return (
                                                                                <div key={pendingIdx} className="text-xs text-gray-600 mb-2">
                                                                                    <div className="font-mono">{pending.sku}</div>
                                                                                    <div className="whitespace-nowrap">
                                                                                        <span className="text-gray-500">:{wcStockBefore}</span>
                                                                                        {pendingFromOtherOrders > 0 && (
                                                                                            <span className="text-yellow-600 font-medium">+{pendingFromOtherOrders}</span>
                                                                                        )}
                                                                                        <span className="text-gray-500">→</span>
                                                                                        <span className="text-red-600 font-medium">{wcStockAfter}</span>
                                                                                        {totalPendingAfter > 0 && (
                                                                                            <span className="text-yellow-600 font-medium">+{totalPendingAfter}</span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                );
                                                            }
                                                            return <span className="text-gray-400 text-xs">—</span>;
                                                        })()}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {logEntry.combo_updates && Array.isArray(logEntry.combo_updates) && logEntry.combo_updates.length > 0 ? (
                                                            <div className="max-w-xs">
                                                                {logEntry.combo_updates.map((update: any, updateIdx: number) => (
                                                                    <div key={updateIdx} className="text-xs text-gray-600 mb-1">
                                                                        <span className="font-mono">{update.sku}</span>: 
                                                                        {update.error ? (
                                                                            <span className="text-red-600 ml-1">Error</span>
                                                                        ) : (
                                                                            <span className="text-green-600 ml-1">→ {update.newStock}</span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {logEntry.success ? (
                                                            <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                                                                <CheckCircle2 size={16} />
                                                                Success
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium" title={logEntry.error_message}>
                                                                <AlertCircle size={16} />
                                                                Failed
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()
                                )
                            ) : (
                                <tr>
                                    <td colSpan={activeTab === 'manual' ? 6 : 7} className="px-6 py-12 text-center text-gray-500">
                                        No {activeTab === 'manual' ? 'activity' : 'webhook'} logs found matching your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        </table>
                    </div>
                    
                    {/* Pagination controls for Orders tab */}
                    {activeTab === 'orders' && wcTotalCount > (limit || 20) && (
                        <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
                            <div className="text-sm text-gray-600">
                                Showing {((wcCurrentPage - 1) * (limit || 20)) + 1} to {Math.min(wcCurrentPage * (limit || 20), wcTotalCount)} of {wcTotalCount} entries
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setWcCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={wcCurrentPage === 1}
                                    className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                        wcCurrentPage === 1
                                            ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-1">
                                        <ChevronLeft size={16} />
                                        Previous
                                    </div>
                                </button>
                                
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.ceil(wcTotalCount / (limit || 20)) }, (_, i) => i + 1)
                                        .filter(page => {
                                            const totalPages = Math.ceil(wcTotalCount / (limit || 20));
                                            // Show first page, last page, current page, and pages around current
                                            return page === 1 || 
                                                   page === totalPages || 
                                                   (page >= wcCurrentPage - 1 && page <= wcCurrentPage + 1);
                                        })
                                        .map((page, idx, arr) => {
                                            const totalPages = Math.ceil(wcTotalCount / (limit || 20));
                                            const showEllipsisBefore = idx > 0 && arr[idx - 1] < page - 1;
                                            const showEllipsisAfter = idx < arr.length - 1 && arr[idx + 1] > page + 1;
                                            
                                            return (
                                                <div key={page} className="flex items-center gap-1">
                                                    {showEllipsisBefore && (
                                                        <span className="px-2 text-gray-400">...</span>
                                                    )}
                                                    <button
                                                        onClick={() => setWcCurrentPage(page)}
                                                        className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                                            wcCurrentPage === page
                                                                ? 'border-blue-500 bg-blue-50 text-blue-600'
                                                                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        {page}
                                                    </button>
                                                    {showEllipsisAfter && (
                                                        <span className="px-2 text-gray-400">...</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                                
                                <button
                                    onClick={() => setWcCurrentPage(prev => Math.min(Math.ceil(wcTotalCount / (limit || 20)), prev + 1))}
                                    disabled={wcCurrentPage >= Math.ceil(wcTotalCount / (limit || 20))}
                                    className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                                        wcCurrentPage >= Math.ceil(wcTotalCount / (limit || 20))
                                            ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-1">
                                        Next
                                        <ChevronRight size={16} />
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
