'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { formatDateTimeWithSecondsGMT8 } from '@/lib/utils/date';
import { Download, RefreshCw, Filter, Search, User, AlertCircle, CheckCircle2, Package, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react';

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
}

type TabType = 'manual' | 'woocommerce';

export default function ActivityLog({ limit = 20, compact = false }: { limit?: number, compact?: boolean }) {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<TabType>('manual');
    const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
    const [wcLogs, setWcLogs] = useState<WcWebhookLogEntry[]>([]);
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
    const topScrollRef = useRef<HTMLDivElement>(null);
    const bottomScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Fetch single SKUs for filter dropdown
        fetch('/api/skus/single')
            .then(res => res.json())
            .then(data => {
                if (data.skus) {
                    setSingleSkus(data.skus.map((s: any) => ({ sku: s.sku, name: s.name })));
                }
            })
            .catch(err => console.error('Failed to fetch SKUs:', err));
        
        // Fetch combo SKUs for WooCommerce filter dropdown
        fetch('/api/skus/combo')
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

            const res = await fetch(`/api/activity-logs?${queryParams.toString()}`);
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

            const res = await fetch(`/api/webhook-logs?${queryParams.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch webhook logs');

            const data = await res.json();
            setWcLogs(data.logs || []);
            setWcTotalCount(data.total || 0);
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
            : ['Timestamp', 'Type', 'Event', 'Entity', 'SKU', 'Status', 'Combo Updates', 'Success', 'Error'];
        
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
                        `"${log.webhook_event}"`,
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

    const getWebhookTypeColor = (type: string) => {
        if (type === 'order') return 'bg-green-100 text-green-800';
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
                                    : 'Stock changes and triggers from WooCommerce (orders, reconciliations)'
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

                            {activeTab === 'woocommerce' && (filterType === '' || filterType === 'order') && (
                                <div className="relative">
                                    <select
                                        value={filterOrderStatus}
                                        onChange={(e) => setFilterOrderStatus(e.target.value)}
                                        className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                                    >
                                        <option value="">All Order Statuses</option>
                                        <option value="processing">Processing</option>
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
                                    {activeTab === 'woocommerce' ? (
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
                            onClick={() => setActiveTab('woocommerce')}
                            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                                activeTab === 'woocommerce'
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <Package size={16} />
                                WooCommerce
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
                                        <th className="px-6 py-4">Event</th>
                                        <th className="px-6 py-4">Entity</th>
                                        <th className="px-6 py-4">SKU</th>
                                        <th className="px-6 py-4">Component Deductions</th>
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
                                                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title="WooCommerce Order ID">
                                                                        Order #{log.details.orderId}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {log.details.notes && (
                                                                <div className="text-xs text-gray-400">{log.details.notes}</div>
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
                                    wcLogs.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                                                {formatDateTimeWithSecondsGMT8(log.created_at)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getWebhookTypeColor(log.webhook_type)}`}>
                                                    {log.webhook_type === 'order' ? <ShoppingCart size={12} className="mr-1" /> : <Package size={12} className="mr-1" />}
                                                    {log.webhook_type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-gray-700 font-medium text-xs">
                                                    {getWebhookEventLabel(log.webhook_event)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-gray-900 font-medium">
                                                    {log.entity_name || `#${log.entity_id}`}
                                                </div>
                                                {log.status && (
                                                    <div className="text-xs text-gray-500">{log.status}</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {/* For orders: Show all SKUs from affected_skus (what customer ordered) */}
                                                {log.webhook_type === 'order' && log.affected_skus && Array.isArray(log.affected_skus) && log.affected_skus.length > 0 ? (
                                                    <div className="font-mono text-xs text-gray-700">
                                                        {log.affected_skus.map((sku: string, idx: number) => (
                                                            <span key={idx}>
                                                                {sku}
                                                                {idx < log.affected_skus!.length - 1 && (
                                                                    <>
                                                                        ,<br />
                                                                    </>
                                                                )}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : log.webhook_type === 'product' && log.entity_sku ? (
                                                    /* For products: Show entitySku (the SKU that was manually edited) */
                                                    <span className="text-gray-700 font-mono text-xs">{log.entity_sku}</span>
                                                ) : log.affected_skus && Array.isArray(log.affected_skus) && log.affected_skus.length > 0 ? (
                                                    /* Fallback for orders: Show affected_skus if available */
                                                    <div className="font-mono text-xs text-gray-700">
                                                        {log.affected_skus.map((sku: string, idx: number) => (
                                                            <span key={idx}>
                                                                {sku}
                                                                {idx < log.affected_skus!.length - 1 && (
                                                                    <>
                                                                        ,<br />
                                                                    </>
                                                                )}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : log.entity_sku ? (
                                                    /* Fallback for products: Show entity_sku */
                                                    <span className="text-gray-700 font-mono text-xs">{log.entity_sku}</span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {/* Show component restorations for cancelled orders */}
                                                {log.details?.componentRestorations && Array.isArray(log.details.componentRestorations) && log.details.componentRestorations.length > 0 ? (
                                                    <div className="max-w-xs">
                                                        {log.details.componentRestorations.map((restoration: any, idx: number) => (
                                                            <div key={idx} className="text-xs text-gray-600 mb-1">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="font-mono">{restoration.sku}</span>: 
                                                                    <span className="text-gray-400 ml-1">{restoration.previousStock}</span>
                                                                    <span className="mx-1">→</span>
                                                                    <span className="text-green-600 font-medium">{restoration.newStock}</span>
                                                                    {!restoration.hisWrote && (
                                                                        <span className="text-xs text-blue-600 ml-1" title="Restored by WooCommerce (HIS only tracked)">
                                                                            (WC)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : log.details?.componentDeductions && Array.isArray(log.details.componentDeductions) && log.details.componentDeductions.length > 0 ? (
                                                    /* Show component deductions for processing orders */
                                                    <div className="max-w-xs">
                                                        {log.details.componentDeductions.map((deduction: any, idx: number) => (
                                                            <div key={idx} className="text-xs text-gray-600 mb-1">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="font-mono">{deduction.sku}</span>: 
                                                                    <span className="text-gray-400 ml-1">{deduction.previousStock}</span>
                                                                    <span className="mx-1">→</span>
                                                                    <span className="text-red-600 font-medium">{deduction.newStock}</span>
                                                                    {!deduction.hisWrote && (
                                                                        <span className="text-xs text-blue-600 ml-1" title="Deducted by WooCommerce (HIS only tracked)">
                                                                            (WC)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                {log.combo_updates && Array.isArray(log.combo_updates) && log.combo_updates.length > 0 ? (
                                                    <div className="max-w-xs">
                                                        {log.combo_updates.map((update: any, idx: number) => (
                                                            <div key={idx} className="text-xs text-gray-600 mb-1">
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
                                )
                            ) : (
                                <tr>
                                    <td colSpan={activeTab === 'manual' ? 6 : 8} className="px-6 py-12 text-center text-gray-500">
                                        No {activeTab === 'manual' ? 'activity' : 'webhook'} logs found matching your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        </table>
                    </div>
                    
                    {/* Pagination controls for WooCommerce tab */}
                    {activeTab === 'woocommerce' && wcTotalCount > (limit || 20) && (
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
