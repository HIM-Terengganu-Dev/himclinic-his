'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Trash2, Box, Layers, RefreshCw, Eye, EyeOff, Edit2, Save, X, Bell, BellOff } from 'lucide-react';
import { fetchWithRole } from '@/lib/utils/fetchWithRole';

interface SingleSku {
    id: number;
    sku: string;
    name: string;
    woocommerce_product_id: number;
    hidden?: boolean;
    description?: string;
    low_stock_threshold?: number | null;
    enough_stock_level?: number | null;
    email_alerts_enabled?: boolean;
}

interface ComboSku {
    id: number;
    sku: string;
    name: string;
    woocommerce_product_id: number;
    components: { sku: string; quantity: number }[];
    hidden?: boolean;
    description?: string;
    low_stock_threshold?: number | null;
    enough_stock_level?: number | null;
    email_alerts_enabled?: boolean;
}

export default function SkuManagement() {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<'single' | 'combo'>('single');
    const [singleSkus, setSingleSkus] = useState<SingleSku[]>([]);
    const [comboSkus, setComboSkus] = useState<ComboSku[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingType, setEditingType] = useState<'single' | 'combo' | null>(null);
    const [editLowThreshold, setEditLowThreshold] = useState<string>('');
    const [editEnoughLevel, setEditEnoughLevel] = useState<string>('');
    const [editEmailAlerts, setEditEmailAlerts] = useState<boolean>(false);

    // Form States
    const [sku, setSku] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    // Combo Form State
    const [components, setComponents] = useState<{ sku: string; quantity: number }[]>([{ sku: '', quantity: 1 }]);

    const fetchSkus = async () => {
        setLoading(true);
        try {
            if (activeTab === 'single') {
                const res = await fetchWithRole('/api/skus/single');
                if (!res.ok) throw new Error(`Failed to fetch single SKUs: ${res.status}`);
                const data = await res.json();
                if (data.skus) setSingleSkus(data.skus);
            } else {
                const res = await fetchWithRole('/api/skus/combo');
                if (!res.ok) throw new Error(`Failed to fetch combo SKUs: ${res.status}`);
                const data = await res.json();
                if (data.skus) setComboSkus(data.skus);

                // Also fetch single SKUs for component selector if empty
                if (singleSkus.length === 0) {
                    const resSingle = await fetchWithRole('/api/skus/single');
                    if (resSingle.ok) {
                        const dataSingle = await resSingle.json();
                        if (dataSingle.skus) setSingleSkus(dataSingle.skus);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching SKUs:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSkus();
    }, [activeTab]);

    const handleCreateSingle = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetchWithRole('/api/skus/single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, name, description })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Single SKU created successfully!');
                setError(null);
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.error || 'Failed to create SKU');
                setSuccess(null);
            }
        } catch (error) {
            console.error(error);
            setError('Failed to create SKU');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateCombo = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Filter out empty components
            const validComponents = components.filter(c => c.sku && c.quantity > 0);

            const res = await fetchWithRole('/api/skus/combo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, name, description, components: validComponents })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Combo SKU created successfully!');
                setError(null);
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
                setComponents([{ sku: '', quantity: 1 }]);
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.error || 'Failed to create combo SKU');
                setSuccess(null);
            }
        } catch (error) {
            console.error(error);
            setError('Failed to create Combo SKU');
        } finally {
            setLoading(false);
        }
    };

    const addComponentRow = () => {
        setComponents([...components, { sku: '', quantity: 1 }]);
    };

    const updateComponent = (index: number, field: 'sku' | 'quantity', value: any) => {
        const newComponents = [...components];
        // @ts-ignore
        newComponents[index][field] = value;
        setComponents(newComponents);
    };

    const removeComponentRow = (index: number) => {
        const newComponents = [...components];
        newComponents.splice(index, 1);
        setComponents(newComponents);
    };

    const handleToggleHidden = async (id: number, currentHidden: boolean, type: 'single' | 'combo') => {
        try {
            const endpoint = type === 'single' ? `/api/skus/single/${id}` : `/api/skus/combo/${id}`;
            const res = await fetchWithRole(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hidden: !currentHidden })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess(`SKU ${!currentHidden ? 'hidden' : 'shown'} successfully!`);
                setError(null);
                fetchSkus();
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.error || 'Failed to update SKU');
                setSuccess(null);
            }
        } catch (err: any) {
            console.error('Error toggling SKU visibility:', err);
            setError('Failed to update SKU visibility');
            setSuccess(null);
        }
    };

    const handleDelete = async (id: number, type: 'single' | 'combo') => {
        if (!confirm('Are you sure you want to delete this SKU? This action cannot be undone.')) {
            return;
        }

        try {
            const endpoint = type === 'single' ? `/api/skus/single/${id}` : `/api/skus/combo/${id}`;
            const res = await fetchWithRole(endpoint, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('SKU deleted successfully!');
                setError(null);
                fetchSkus();
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.error || 'Failed to delete SKU');
                setSuccess(null);
            }
        } catch (err: any) {
            console.error('Error deleting SKU:', err);
            setError('Failed to delete SKU');
            setSuccess(null);
        }
    };

    const handleEditThresholds = (skuItem: SingleSku | ComboSku, type: 'single' | 'combo') => {
        setEditingId(skuItem.id);
        setEditingType(type);
        setEditLowThreshold(skuItem.low_stock_threshold?.toString() || '');
        setEditEnoughLevel(skuItem.enough_stock_level?.toString() || '');
        setEditEmailAlerts(skuItem.email_alerts_enabled || false);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingType(null);
        setEditLowThreshold('');
        setEditEnoughLevel('');
        setEditEmailAlerts(false);
    };

    const handleSaveThresholds = async () => {
        if (!editingId || !editingType) return;

        setLoading(true);
        setError(null);
        setSuccess(null);
        try {
            const endpoint = editingType === 'single' ? `/api/skus/single/${editingId}` : `/api/skus/combo/${editingId}`;
            const res = await fetchWithRole(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lowStockThreshold: editLowThreshold === '' ? null : parseInt(editLowThreshold),
                    enoughStockLevel: editEnoughLevel === '' ? null : parseInt(editEnoughLevel),
                    emailAlertsEnabled: editEmailAlerts
                })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Stock thresholds updated successfully!');
                setError(null);
                fetchSkus();
                handleCancelEdit();
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.error || 'Failed to update thresholds');
                setSuccess(null);
            }
        } catch (err: any) {
            console.error('Error updating thresholds:', err);
            setError('Failed to update thresholds');
            setSuccess(null);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Success/Error Messages */}
            {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                    {success}
                </div>
            )}
            {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                </div>
            )}
            
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">SKU Management</h2>
                        <p className="text-sm text-gray-500 mt-1">Create and manage Single and Combo SKUs</p>
                    </div>
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        <button
                            onClick={() => setActiveTab('single')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'single' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <Box size={16} />
                            Single SKUs
                        </button>
                        <button
                            onClick={() => setActiveTab('combo')}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'combo' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            <Layers size={16} />
                            Combo SKUs
                        </button>
                    </div>
                </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Creation Form */}
                <div className="lg:col-span-1 lg:border-r lg:border-gray-100 lg:pr-8">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">
                            Create New {activeTab === 'single' ? 'Single' : 'Combo'} SKU
                        </h3>

                        <form onSubmit={activeTab === 'single' ? handleCreateSingle : handleCreateCombo} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">SKU Code</label>
                                <input
                                    type="text"
                                    value={sku}
                                    onChange={(e) => setSku(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="e.g. him1"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="e.g. HIM Coffee"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    rows={3}
                                />
                            </div>

                            {activeTab === 'combo' && (
                                <div className="space-y-3">
                                    <label className="block text-sm font-medium text-gray-700">Components</label>
                                    {components.map((comp, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <select
                                                value={comp.sku}
                                                onChange={(e) => updateComponent(idx, 'sku', e.target.value)}
                                                className="flex-1 text-sm border border-gray-300 rounded-lg p-2"
                                                required
                                            >
                                                <option value="">Select SKU</option>
                                                {singleSkus.map(s => (
                                                    <option key={s.id} value={s.sku}>{s.name} ({s.sku})</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                min="1"
                                                value={comp.quantity}
                                                onChange={(e) => updateComponent(idx, 'quantity', parseInt(e.target.value))}
                                                className="w-20 text-sm border border-gray-300 rounded-lg p-2"
                                                required
                                            />
                                            <button type="button" onClick={() => removeComponentRow(idx)} className="text-red-500 hover:text-red-700">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={addComponentRow} className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                        <Plus size={16} /> Add Component
                                    </button>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full mt-4 bg-blue-600 text-white rounded-lg py-2 px-4 hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus size={18} />
                                {loading ? 'Creating...' : `Create ${activeTab === 'single' ? 'Single' : 'Combo'} SKU`}
                            </button>
                        </form>
                    </div>

                    {/* List View */}
                    <div className="lg:col-span-2">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Existing SKUs</h3>
                            <button onClick={fetchSkus} className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100">
                                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">SKU</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Name</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">WC ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Low Stock</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Enough Level</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Email Alerts</th>
                                        {activeTab === 'combo' && (
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Components</th>
                                        )}
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {activeTab === 'single' ? (
                                        singleSkus.map((skuItem) => (
                                            <tr key={skuItem.id} className={skuItem.hidden ? 'opacity-50 bg-gray-50' : ''}>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{skuItem.sku}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{skuItem.name}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{skuItem.woocommerce_product_id || '—'}</td>
                                                <td className="px-4 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                        skuItem.hidden 
                                                            ? 'bg-gray-100 text-gray-600' 
                                                            : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {skuItem.hidden ? 'Hidden' : 'Visible'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {editingId === skuItem.id && editingType === 'single' ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editLowThreshold}
                                                            onChange={(e) => setEditLowThreshold(e.target.value)}
                                                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                                            placeholder="Threshold"
                                                        />
                                                    ) : (
                                                        <span>{skuItem.low_stock_threshold ?? '—'}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {editingId === skuItem.id && editingType === 'single' ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editEnoughLevel}
                                                            onChange={(e) => setEditEnoughLevel(e.target.value)}
                                                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                                            placeholder="Level"
                                                        />
                                                    ) : (
                                                        <span>{skuItem.enough_stock_level ?? '—'}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap">
                                                    {editingId === skuItem.id && editingType === 'single' ? (
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={editEmailAlerts}
                                                                onChange={(e) => setEditEmailAlerts(e.target.checked)}
                                                                className="sr-only peer"
                                                            />
                                                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                        </label>
                                                    ) : (
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                            skuItem.email_alerts_enabled 
                                                                ? 'bg-blue-100 text-blue-700' 
                                                                : 'bg-gray-100 text-gray-600'
                                                        }`}>
                                                            {skuItem.email_alerts_enabled ? 'Enabled' : 'Disabled'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <div className="flex justify-end gap-2">
                                                        {editingId === skuItem.id && editingType === 'single' ? (
                                                            <>
                                                                <button
                                                                    onClick={handleSaveThresholds}
                                                                    disabled={loading}
                                                                    className="text-green-600 hover:text-green-900"
                                                                    title="Save"
                                                                >
                                                                    <Save className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={handleCancelEdit}
                                                                    className="text-gray-600 hover:text-gray-900"
                                                                    title="Cancel"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => handleEditThresholds(skuItem, 'single')}
                                                                    className="text-purple-600 hover:text-purple-900"
                                                                    title="Edit stock thresholds"
                                                                >
                                                                    <Edit2 className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleToggleHidden(skuItem.id, skuItem.hidden || false, 'single')}
                                                                    className="text-blue-600 hover:text-blue-900"
                                                                    title={skuItem.hidden ? 'Show in dashboard' : 'Hide from dashboard'}
                                                                >
                                                                    {skuItem.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(skuItem.id, 'single')}
                                                                    className="text-red-600 hover:text-red-900"
                                                                    title="Delete SKU"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        comboSkus.map((skuItem) => (
                                            <tr key={skuItem.id} className={skuItem.hidden ? 'opacity-50 bg-gray-50' : ''}>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{skuItem.sku}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{skuItem.name}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{skuItem.woocommerce_product_id || '—'}</td>
                                                <td className="px-4 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                        skuItem.hidden 
                                                            ? 'bg-gray-100 text-gray-600' 
                                                            : 'bg-green-100 text-green-700'
                                                    }`}>
                                                        {skuItem.hidden ? 'Hidden' : 'Visible'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {editingId === skuItem.id && editingType === 'combo' ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editLowThreshold}
                                                            onChange={(e) => setEditLowThreshold(e.target.value)}
                                                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                                            placeholder="Threshold"
                                                        />
                                                    ) : (
                                                        <span>{skuItem.low_stock_threshold ?? '—'}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {editingId === skuItem.id && editingType === 'combo' ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            value={editEnoughLevel}
                                                            onChange={(e) => setEditEnoughLevel(e.target.value)}
                                                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                                            placeholder="Level"
                                                        />
                                                    ) : (
                                                        <span>{skuItem.enough_stock_level ?? '—'}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap">
                                                    {editingId === skuItem.id && editingType === 'combo' ? (
                                                        <label className="relative inline-flex items-center cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={editEmailAlerts}
                                                                onChange={(e) => setEditEmailAlerts(e.target.checked)}
                                                                className="sr-only peer"
                                                            />
                                                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                        </label>
                                                    ) : (
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                            skuItem.email_alerts_enabled 
                                                                ? 'bg-blue-100 text-blue-700' 
                                                                : 'bg-gray-100 text-gray-600'
                                                        }`}>
                                                            {skuItem.email_alerts_enabled ? 'Enabled' : 'Disabled'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 text-sm text-gray-500">
                                                    <div className="flex flex-col gap-1">
                                                        {skuItem.components.map((c, i) => (
                                                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                                                {c.quantity}x {c.sku}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <div className="flex justify-end gap-2">
                                                        {editingId === skuItem.id && editingType === 'combo' ? (
                                                            <>
                                                                <button
                                                                    onClick={handleSaveThresholds}
                                                                    disabled={loading}
                                                                    className="text-green-600 hover:text-green-900"
                                                                    title="Save"
                                                                >
                                                                    <Save className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={handleCancelEdit}
                                                                    className="text-gray-600 hover:text-gray-900"
                                                                    title="Cancel"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => handleEditThresholds(skuItem, 'combo')}
                                                                    className="text-purple-600 hover:text-purple-900"
                                                                    title="Edit stock thresholds"
                                                                >
                                                                    <Edit2 className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleToggleHidden(skuItem.id, skuItem.hidden || false, 'combo')}
                                                                    className="text-blue-600 hover:text-blue-900"
                                                                    title={skuItem.hidden ? 'Show in dashboard' : 'Hide from dashboard'}
                                                                >
                                                                    {skuItem.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(skuItem.id, 'combo')}
                                                                    className="text-red-600 hover:text-red-900"
                                                                    title="Delete SKU"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    {((activeTab === 'single' && singleSkus.length === 0) || (activeTab === 'combo' && comboSkus.length === 0)) && (
                                        <tr>
                                            <td colSpan={activeTab === 'combo' ? 9 : 8} className="px-4 py-12 text-center text-gray-500">No SKUs found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
