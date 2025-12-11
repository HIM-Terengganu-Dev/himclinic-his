'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { format } from 'date-fns';
import { formatDateTimeWithSecondsGMT8 } from '@/lib/utils/date';
import { Download, RefreshCw, Filter, Search, User, AlertCircle, CheckCircle2 } from 'lucide-react';

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

export default function ActivityLog({ limit = 20, compact = false }: { limit?: number, compact?: boolean }) {
    const { data: session } = useSession();
    const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filterType, setFilterType] = useState('');
    const [filterSku, setFilterSku] = useState('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [singleSkus, setSingleSkus] = useState<Array<{ sku: string; name: string }>>([]);

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
    }, []);

    const fetchLogs = async () => {
        try {
            setRefreshing(true);
            const queryParams = new URLSearchParams();
            if (limit) queryParams.append('limit', limit.toString());
            if (filterType) queryParams.append('type', filterType);
            if (filterSku) queryParams.append('sku', filterSku);
            if (filterDateFrom) queryParams.append('dateFrom', filterDateFrom);
            if (filterDateTo) queryParams.append('dateTo', filterDateTo);

            const res = await fetch(`/api/activity-logs?${queryParams.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch logs');

            const data = await res.json();
            setLogs(data.logs);
        } catch (error) {
            console.error('Error fetching activity logs:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [filterType, filterSku, filterDateFrom, filterDateTo]);

    const handleExport = () => {
        const headers = ['Timestamp', 'User', 'Action', 'SKU', 'Success', 'Details', 'Error'];
        const csvContent = [
            headers.join(','),
            ...logs.map(log => {
                // Get specific action label for export
                let actionLabel = log.action;
                if (log.action === 'procurement_update' && log.details) {
                    const operation = log.details.operation;
                    if (operation === 'add') actionLabel = 'Manual Stock In';
                    else if (operation === 'subtract') actionLabel = 'Manual Stock Out';
                    else if (operation === 'set') actionLabel = 'Reconciliation';
                }
                
                return [
                    `"${formatDateTimeWithSecondsGMT8(log.created_at)}"`,
                    `"${log.user_name || log.user_email}"`,
                    `"${actionLabel}"`,
                    `"${log.affected_sku || ''}"`,
                    log.success ? 'Yes' : 'No',
                    `"${JSON.stringify(log.details).replace(/"/g, '""')}"`,
                    `"${log.error_message || ''}"`
                ].join(',');
            })
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const getActionLabel = (log: ActivityLogEntry) => {
        const action = log.action;
        
        // For procurement updates, check the operation type in details
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

    const getActionColor = (action: string) => {
        if (action.includes('procurement')) return 'bg-blue-100 text-blue-800';
        if (action.includes('sku')) return 'bg-purple-100 text-purple-800';
        if (action.includes('error')) return 'bg-red-100 text-red-800';
        return 'bg-gray-100 text-gray-800';
    };

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${compact ? '' : 'p-6'}`}>
            {!compact && (
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Activity Log</h2>
                        <p className="text-sm text-gray-500 mt-1">Audit trail of all manual system changes</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={fetchLogs}
                            disabled={refreshing}
                            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                            title="Refresh Logs"
                        >
                            <RefreshCw size={20} className={`${refreshing ? 'animate-spin' : ''}`} />
                        </button>

                        <div className="relative">
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                            >
                                <option value="">All Actions</option>
                                <option value="procurement_update">Stock Updates</option>
                                <option value="sku_created">SKU Creations</option>
                            </select>
                            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>

                        <div className="relative">
                            <select
                                value={filterSku}
                                onChange={(e) => setFilterSku(e.target.value)}
                                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                            >
                                <option value="">All SKUs</option>
                                {singleSkus.map((sku) => (
                                    <option key={sku.sku} value={sku.sku}>
                                        {sku.sku}
                                    </option>
                                ))}
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
                    </div>
                </div>
            )}

            {loading && logs.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-100">
                            <tr>
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4">User</th>
                                <th className="px-6 py-4">Action</th>
                                <th className="px-6 py-4">SKU</th>
                                <th className="px-6 py-4">Details</th>
                                <th className="px-6 py-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {logs.length > 0 ? (
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
                                                    <p className="font-medium text-gray-900">{log.user_name}</p>
                                                    <p className="text-xs text-gray-500">{log.user_email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${getActionColor(log.action)}`}>
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
                                                {log.action === 'procurement_update' && log.details ? (
                                                    <span>
                                                        {log.details.operation === 'add' ? 'Added' : log.details.operation === 'subtract' ? 'Deducted' : 'Set to'} <strong>{log.details.quantity}</strong> units
                                                        {log.details.notes && <span className="text-gray-400 ml-1">- {log.details.notes}</span>}
                                                    </span>
                                                ) : (
                                                    JSON.stringify(log.details)
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
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                        No activity logs found matching your filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
