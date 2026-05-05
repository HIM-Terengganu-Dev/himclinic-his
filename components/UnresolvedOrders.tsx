'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    AlertTriangle,
    RefreshCw,
    CheckCircle2,
    Clock,
    Package,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Loader2,
    ShieldAlert,
    Info,
} from 'lucide-react';

interface HeldSku {
    sku: string;
    processing: number;
    pending_consult: number;
    pending_review: number;
}

interface UnresolvedOrder {
    order_id: number;
    current_status: string;
    affected_skus: string[];
    first_seen_at: string;
    last_event_at: string;
    last_webhook_event: string;
    held_stock: HeldSku[];
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    processing: { label: 'Processing', color: 'text-blue-700', bg: 'bg-blue-100' },
    'pending-consult': { label: 'Pending Consult', color: 'text-amber-700', bg: 'bg-amber-100' },
    'pending-review': { label: 'Pending Review', color: 'text-orange-700', bg: 'bg-orange-100' },
    unknown: { label: 'Unknown', color: 'text-gray-600', bg: 'bg-gray-100' },
};

function statusTag(status: string) {
    const s = STATUS_LABELS[status] || STATUS_LABELS['unknown'];
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.color}`}>
            {s.label}
        </span>
    );
}

function formatDate(iso: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-MY', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function timeAgo(iso: string) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ago`;
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(diff / 60000);
    return `${m}m ago`;
}

export default function UnresolvedOrders() {
    const [orders, setOrders] = useState<UnresolvedOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [resolving, setResolving] = useState<Set<number>>(new Set());
    const [resolved, setResolved] = useState<Set<number>>(new Set());
    const [confirmId, setConfirmId] = useState<number | null>(null);
    const [resolveReason, setResolveReason] = useState('');
    const [resolveType, setResolveType] = useState<'nv-pending-pickup' | 'cancelled' | 'refunded'>('nv-pending-pickup');
    const [wcStatuses, setWcStatuses] = useState<Record<number, string>>({});
    const [isCheckingWc, setIsCheckingWc] = useState(false);
    
    // Bulk resolve state
    const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
    const [isBulkResolving, setIsBulkResolving] = useState(false);
    const [bulkResolveType, setBulkResolveType] = useState<'nv-pending-pickup' | 'cancelled'>('nv-pending-pickup');
    const [bulkResolveReason, setBulkResolveReason] = useState('');

    const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

    const showToast = (type: 'success' | 'error', msg: string) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 4000);
    };

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/orders/unresolved', { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load');
            setOrders(data.orders || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const handleCheckWc = async () => {
        if (orders.length === 0) return;
        setIsCheckingWc(true);
        try {
            const orderIds = orders.map(o => o.order_id);
            const res = await fetch('/api/orders/unresolved/check-wc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to check WC');
            setWcStatuses(data.statuses || {});
            showToast('success', 'WooCommerce statuses fetched successfully.');
        } catch (e: any) {
            showToast('error', e.message);
        } finally {
            setIsCheckingWc(false);
        }
    };

    const toggleRow = (id: number) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleResolve = async (orderId: number) => {
        setResolving(prev => new Set(prev).add(orderId));
        try {
            const res = await fetch('/api/orders/unresolved/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    orderId, 
                    reason: resolveReason || 'Manual resolution by admin',
                    resolutionType: resolveType
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to resolve');
            setResolved(prev => new Set(prev).add(orderId));
            const totalDeducted = (data.resolved || []).reduce((s: number, r: any) => s + (r.in_warehouse_deducted || 0), 0);
            showToast('success', `Order #${orderId} resolved — ${data.resolved?.length ?? 0} SKU(s) cleared, ${totalDeducted} unit(s) deducted from in_warehouse.`);
            // Remove from list after short delay
            setTimeout(() => {
                setOrders(prev => prev.filter(o => o.order_id !== orderId));
                setResolved(prev => { const s = new Set(prev); s.delete(orderId); return s; });
            }, 1500);
        } catch (e: any) {
            showToast('error', e.message);
        } finally {
            setResolving(prev => { const s = new Set(prev); s.delete(orderId); return s; });
            setConfirmId(null);
            setResolveReason('');
            setResolveType('nv-pending-pickup');
        }
    };

    const handleBulkResolve = async () => {
        if (selectedOrders.size === 0) return;
        setIsBulkResolving(true);
        try {
            const res = await fetch('/api/orders/unresolved/resolve-bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderIds: Array.from(selectedOrders),
                    reason: bulkResolveReason || 'Bulk manual resolution by admin',
                    resolutionType: bulkResolveType
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to bulk resolve');
            
            if (data.errorCount > 0) {
                showToast('error', `Resolved ${data.resolvedCount} orders, but failed on ${data.errorCount} orders.`);
            } else {
                showToast('success', `Successfully resolved ${data.resolvedCount} orders.`);
            }
            
            // Mark as resolved visually
            setResolved(prev => {
                const next = new Set(prev);
                Array.from(selectedOrders).forEach(id => next.add(id));
                return next;
            });
            
            setTimeout(() => {
                setOrders(prev => prev.filter(o => !selectedOrders.has(o.order_id)));
                setResolved(prev => {
                    const next = new Set(prev);
                    Array.from(selectedOrders).forEach(id => next.delete(id));
                    return next;
                });
                setSelectedOrders(new Set());
                setBulkResolveReason('');
                setBulkResolveType('nv-pending-pickup');
            }, 1500);
        } catch (e: any) {
            showToast('error', e.message);
        } finally {
            setIsBulkResolving(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedOrders.size === orders.length) {
            setSelectedOrders(new Set());
        } else {
            setSelectedOrders(new Set(orders.map(o => o.order_id)));
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedOrders(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="space-y-4">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-xl text-sm font-medium border transition-all
                    ${toast.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {toast.type === 'success'
                        ? <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        : <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                    {toast.msg}
                </div>
            )}

            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-amber-600" />
                    <span className="font-semibold text-gray-800">
                        Unresolved Orders
                        {!loading && (
                            <span className="ml-2 text-xs font-normal text-gray-500">
                                ({orders.length} order{orders.length !== 1 ? 's' : ''})
                            </span>
                        )}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCheckWc}
                        disabled={loading || isCheckingWc || orders.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 border border-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                        {isCheckingWc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        Check WC Status
                    </button>
                    <button
                        onClick={fetchOrders}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Info banner */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                <div>
                    Orders tracked from <strong>3 March 2026</strong> onwards that are still holding stock in
                    <strong> pending-consult</strong>, <strong>pending-review</strong>, or <strong>processing</strong> —
                    and have <em>not</em> exited via nv-pending-pickup, cancelled, or refunded.
                    You can resolve orders by matching them to their actual WooCommerce status. 
                    <strong>nv-pending-pickup</strong> deducts stock from the warehouse, while <strong>Cancelled</strong> returns held stock to available without deducting from the warehouse.
                    Every resolve is logged in the system activity log.
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading unresolved orders…
                </div>
            )}

            {/* Error */}
            {!loading && error && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && orders.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
                    <p className="font-medium text-gray-600">All clear!</p>
                    <p className="text-sm mt-1">No unresolved orders since 3 March 2026.</p>
                </div>
            )}

            {/* Bulk Action Bar */}
            {!loading && !error && selectedOrders.size > 0 && (
                <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-center gap-2">
                        <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">
                            {selectedOrders.size} selected
                        </div>
                        <span className="text-sm text-gray-600 font-medium">Bulk Resolve Action</span>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <select
                            value={bulkResolveType}
                            onChange={(e) => setBulkResolveType(e.target.value as any)}
                            disabled={isBulkResolving}
                            className="w-full sm:w-auto px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="nv-pending-pickup">Treat as nv-pending-pickup (Deduct Stock)</option>
                            <option value="cancelled">Treat as Cancelled (Return to Available)</option>
                        </select>
                        <input
                            type="text"
                            value={bulkResolveReason}
                            onChange={e => setBulkResolveReason(e.target.value)}
                            disabled={isBulkResolving}
                            placeholder="Reason (optional)"
                            className="w-full sm:w-auto px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={handleBulkResolve}
                            disabled={isBulkResolving}
                            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-60"
                        >
                            {isBulkResolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            Resolve Selected
                        </button>
                    </div>
                </div>
            )}

            {/* Order table */}
            {!loading && !error && orders.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3 w-12 text-center">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedOrders.size === orders.length && orders.length > 0}
                                        onChange={toggleSelectAll}
                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                    />
                                </th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Order</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</th>
                                {Object.keys(wcStatuses).length > 0 && (
                                    <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">WC Status</th>
                                )}
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">SKUs</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Last Event</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Held Stock</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orders.map((order) => {
                                const isExpanded = expandedRows.has(order.order_id);
                                const isResolving = resolving.has(order.order_id);
                                const isResolved = resolved.has(order.order_id);
                                const isConfirming = confirmId === order.order_id;

                                return (
                                    <>
                                        <tr
                                            key={order.order_id}
                                            className={`hover:bg-gray-50 transition-colors ${isResolved ? 'opacity-50' : ''} ${selectedOrders.has(order.order_id) ? 'bg-blue-50/30' : ''}`}
                                        >
                                            {/* Checkbox */}
                                            <td className="px-4 py-3 text-center">
                                                <input 
                                                    type="checkbox" 
                                                    checked={selectedOrders.has(order.order_id)}
                                                    onChange={() => toggleSelect(order.order_id)}
                                                    disabled={isResolved || isResolving}
                                                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                                                />
                                            </td>

                                            {/* Order ID */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-gray-900">#{order.order_id}</span>
                                                    <a
                                                        href={`https://forhimclinic.com/wp-admin/post.php?post=${order.order_id}&action=edit`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-500 hover:text-blue-700"
                                                        title="Open in WooCommerce"
                                                    >
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                </div>
                                                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {timeAgo(order.first_seen_at)}
                                                </div>
                                            </td>

                                            {/* Status */}
                                            <td className="px-4 py-3">
                                                {statusTag(order.current_status)}
                                                <div className="text-xs text-gray-400 mt-1 font-mono">{order.last_webhook_event}</div>
                                            </td>

                                            {/* WC Status (Optional) */}
                                            {Object.keys(wcStatuses).length > 0 && (
                                                <td className="px-4 py-3">
                                                    {wcStatuses[order.order_id] ? (
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold 
                                                            ${['cancelled', 'refunded'].includes(wcStatuses[order.order_id]) 
                                                                ? 'bg-red-100 text-red-700' 
                                                                : 'bg-gray-100 text-gray-700'}`}>
                                                            {wcStatuses[order.order_id]}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-gray-400">—</span>
                                                    )}
                                                </td>
                                            )}

                                            {/* SKUs */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {order.affected_skus.slice(0, 3).map(sku => (
                                                        <span key={sku} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                                                            <Package className="w-2.5 h-2.5 text-gray-400" />
                                                            {sku}
                                                        </span>
                                                    ))}
                                                    {order.affected_skus.length > 3 && (
                                                        <span className="text-xs text-gray-400">+{order.affected_skus.length - 3} more</span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Last event */}
                                            <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                                                {formatDate(order.last_event_at)}
                                            </td>

                                            {/* Held stock summary */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1.5 text-xs">
                                                    {order.held_stock.map(hs => {
                                                        const total = hs.processing + hs.pending_consult + hs.pending_review;
                                                        return (
                                                            <span key={hs.sku} className="font-mono bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded">
                                                                {hs.sku}: {total}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2 justify-end">
                                                    <button
                                                        onClick={() => toggleRow(order.order_id)}
                                                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                                        title="Show SKU detail"
                                                    >
                                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </button>
                                                    {!isResolved && !isConfirming && (
                                                        <button
                                                            onClick={() => {
                                                                setConfirmId(order.order_id);
                                                                // Pre-select based on WC status if available
                                                                const wcStat = wcStatuses[order.order_id];
                                                                if (wcStat === 'cancelled') setResolveType('cancelled');
                                                                else if (wcStat === 'refunded') setResolveType('refunded');
                                                                else setResolveType('nv-pending-pickup');
                                                            }}
                                                            disabled={isResolving}
                                                            className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                                                        >
                                                            Resolve
                                                        </button>
                                                    )}
                                                    {isResolved && (
                                                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                                            <CheckCircle2 className="w-3.5 h-3.5" /> Done
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Confirm resolve inline */}
                                        {isConfirming && (
                                            <tr key={`confirm-${order.order_id}`} className="bg-red-50">
                                                <td colSpan={Object.keys(wcStatuses).length > 0 ? 8 : 7} className="px-6 py-4">
                                                    <div className="flex flex-col gap-3">
                                                        <div className="flex items-start gap-2 text-sm text-red-800">
                                                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
                                                            <div>
                                                                <strong>Confirm manual resolve for Order #{order.order_id}</strong>
                                                                {resolveType === 'nv-pending-pickup' && (
                                                                    <p className="text-xs text-red-600 mt-0.5">
                                                                        This treats the order as a natural <strong>nv-pending-pickup</strong>: <strong>in_warehouse will be deducted</strong> by the held quantity and processing/pending counters cleared. Cannot be undone automatically.
                                                                    </p>
                                                                )}
                                                                {resolveType === 'cancelled' && (
                                                                    <p className="text-xs text-red-600 mt-0.5">
                                                                        This treats the order as <strong>Cancelled</strong>: Held stock will be cleared and return to Available, but <strong>in_warehouse will NOT be deducted</strong> (goods never left).
                                                                    </p>
                                                                )}
                                                                {resolveType === 'refunded' && (
                                                                    <p className="text-xs text-red-600 mt-0.5">
                                                                        For Refunds, it is safer to process them via the <strong>Refund/Return</strong> tab to properly document returned items and optionally restock them.
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <select
                                                                value={resolveType}
                                                                onChange={(e) => setResolveType(e.target.value as any)}
                                                                className="px-3 py-1.5 text-sm border border-red-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                                                            >
                                                                <option value="nv-pending-pickup">Treat as nv-pending-pickup (Deduct Stock)</option>
                                                                <option value="cancelled">Treat as Cancelled (Return to Available)</option>
                                                                <option value="refunded">Treat as Refunded</option>
                                                            </select>
                                                            {resolveType !== 'refunded' && (
                                                                <input
                                                                    type="text"
                                                                    value={resolveReason}
                                                                    onChange={e => setResolveReason(e.target.value)}
                                                                    placeholder="Reason (optional)"
                                                                    className="flex-1 px-3 py-1.5 text-sm border border-red-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
                                                                />
                                                            )}
                                                            {resolveType === 'refunded' ? (
                                                                <button
                                                                    onClick={() => {
                                                                        window.dispatchEvent(new CustomEvent('navigate', { detail: 'return-refund' }));
                                                                    }}
                                                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
                                                                >
                                                                    Go to Refunds Tab
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleResolve(order.order_id)}
                                                                    disabled={isResolving}
                                                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
                                                                >
                                                                    {isResolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                                                    Confirm Resolve
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => { setConfirmId(null); setResolveReason(''); setResolveType('nv-pending-pickup'); }}
                                                                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}

                                        {/* Expanded SKU detail */}
                                        {isExpanded && !isConfirming && (
                                            <tr key={`detail-${order.order_id}`} className="bg-gray-50">
                                                <td colSpan={Object.keys(wcStatuses).length > 0 ? 8 : 7} className="px-6 py-4">
                                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Held Stock Breakdown</p>
                                                    <div className="overflow-x-auto">
                                                        <table className="text-xs w-auto border-collapse">
                                                            <thead>
                                                                <tr className="text-gray-500">
                                                                    <th className="text-left pr-8 pb-1 font-semibold">SKU</th>
                                                                    <th className="text-right pr-8 pb-1 font-semibold">Processing</th>
                                                                    <th className="text-right pr-8 pb-1 font-semibold">Pending Consult</th>
                                                                    <th className="text-right pb-1 font-semibold">Pending Review</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-gray-100">
                                                                {order.held_stock.map(hs => (
                                                                    <tr key={hs.sku}>
                                                                        <td className="pr-8 py-1 font-mono font-medium text-gray-800">{hs.sku}</td>
                                                                        <td className={`pr-8 py-1 text-right font-mono ${hs.processing > 0 ? 'text-blue-700 font-bold' : 'text-gray-400'}`}>
                                                                            {hs.processing}
                                                                        </td>
                                                                        <td className={`pr-8 py-1 text-right font-mono ${hs.pending_consult > 0 ? 'text-amber-700 font-bold' : 'text-gray-400'}`}>
                                                                            {hs.pending_consult}
                                                                        </td>
                                                                        <td className={`py-1 text-right font-mono ${hs.pending_review > 0 ? 'text-orange-700 font-bold' : 'text-gray-400'}`}>
                                                                            {hs.pending_review}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    <div className="mt-3 text-xs text-gray-400">
                                                        First seen: {formatDate(order.first_seen_at)} · Last event: {formatDate(order.last_event_at)}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
