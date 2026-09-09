'use client';

import React, { useState, useEffect, useRef } from 'react';
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
    const [editEmailAlerts, setEditEmailAlerts] = useState<boolean>(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [showThresholdInput, setShowThresholdInput] = useState<number | null>(null); // Store the ID of the SKU being edited

    // Edit Combo SKU Modal State
    const [editingComboSku, setEditingComboSku] = useState<ComboSku | null>(null);
    const [editComboName, setEditComboName] = useState('');
    const [editComboDescription, setEditComboDescription] = useState('');
    const [editComboComponents, setEditComboComponents] = useState<{ sku: string; quantity: number }[]>([]);
    const [editComboThreshold, setEditComboThreshold] = useState('');
    const [editComboEmailAlerts, setEditComboEmailAlerts] = useState(false);
    const [modalLoading, setModalLoading] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);
    
    // Refs for scroll synchronization
    const topScrollRef = useRef<HTMLDivElement>(null);
    const bottomScrollRef = useRef<HTMLDivElement>(null);

    // Form States
    const [sku, setSku] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [countInitialization, setCountInitialization] = useState<string>('0');

    // Combo Form State
    const [components, setComponents] = useState<{ sku: string; quantity: number }[]>([{ sku: '', quantity: 1 }]);

    // Quick lookup map for single SKU details
    const singleSkuMap = React.useMemo(() => {
        const map = new Map<string, SingleSku>();
        singleSkus.forEach(s => map.set(s.sku, s));
        return map;
    }, [singleSkus]);

    const fetchSkus = async () => {
        setLoading(true);
        try {
            if (activeTab === 'single') {
                const res = await fetchWithRole('/api/skus/single');
                if (!res.ok) throw new Error(`Failed to fetch single SKUs: ${res.status}`);
                const data = await res.json();
                if (data.skus) setSingleSkus(data.skus);
            } else {
                const [resCombo, resSingle] = await Promise.all([
                    fetchWithRole('/api/skus/combo'),
                    fetchWithRole('/api/skus/single')
                ]);
                if (!resCombo.ok) throw new Error(`Failed to fetch combo SKUs: ${resCombo.status}`);
                const dataCombo = await resCombo.json();
                if (dataCombo.skus) setComboSkus(dataCombo.skus);

                if (resSingle.ok) {
                    const dataSingle = await resSingle.json();
                    if (dataSingle.skus) setSingleSkus(dataSingle.skus);
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
        setShowCreateForm(false); // Close form when switching tabs
    }, [activeTab]);

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
    }, [singleSkus.length, comboSkus.length, activeTab]);

    const handleCreateSingle = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetchWithRole('/api/skus/single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sku, 
                    name, 
                    description,
                    countInitialization: parseInt(countInitialization) || 0
                })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Single SKU created successfully in both HIS and WooCommerce!');
                setError(null);
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
                setCountInitialization('0');
                setShowCreateForm(false);
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
                body: JSON.stringify({ 
                    sku, 
                    name, 
                    description, 
                    components: validComponents
                    // countInitialization is not needed for combo SKUs - calculated automatically from components
                })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Combo SKU created successfully in both HIS and WooCommerce!');
                setError(null);
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
                setCountInitialization('0');
                setComponents([{ sku: '', quantity: 1 }]);
                setShowCreateForm(false);
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
        setEditEmailAlerts(skuItem.email_alerts_enabled || false);
        setShowThresholdInput(skuItem.id); // Show the input field for this SKU
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingType(null);
        setEditLowThreshold('');
        setEditEmailAlerts(false);
        setShowThresholdInput(null); // Hide the input field
    };

    // Open Edit Combo SKU Modal
    const openEditComboModal = async (skuItem: ComboSku) => {
        // Ensure single SKUs are fresh for the dropdown
        if (singleSkus.length === 0) {
            try {
                const resSingle = await fetchWithRole('/api/skus/single');
                if (resSingle.ok) {
                    const dataSingle = await resSingle.json();
                    if (dataSingle.skus) setSingleSkus(dataSingle.skus);
                }
            } catch (err) {
                console.error('Error fetching single SKUs for combo editing:', err);
            }
        }

        setEditingComboSku(skuItem);
        setEditComboName(skuItem.name || '');
        setEditComboDescription(skuItem.description || '');
        setEditComboThreshold(skuItem.low_stock_threshold !== null && skuItem.low_stock_threshold !== undefined ? skuItem.low_stock_threshold.toString() : '');
        setEditComboEmailAlerts(skuItem.email_alerts_enabled || false);
        setModalError(null);

        // Normalize components
        let rawComps: any = skuItem.components;
        if (typeof rawComps === 'string') {
            try {
                rawComps = JSON.parse(rawComps);
            } catch {
                rawComps = [];
            }
        }
        if (Array.isArray(rawComps) && rawComps.length > 0) {
            setEditComboComponents(rawComps.map((c: any) => ({
                sku: c.sku || '',
                quantity: Number(c.quantity) || 1
            })));
        } else {
            setEditComboComponents([{ sku: '', quantity: 1 }]);
        }
    };

    const closeEditComboModal = () => {
        setEditingComboSku(null);
        setModalError(null);
        setModalLoading(false);
    };

    const addEditComboComponentRow = () => {
        setEditComboComponents(prev => [...prev, { sku: '', quantity: 1 }]);
    };

    const updateEditComboComponent = (index: number, field: 'sku' | 'quantity', value: any) => {
        setEditComboComponents(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const removeEditComboComponentRow = (index: number) => {
        setEditComboComponents(prev => {
            if (prev.length <= 1) return prev;
            const updated = [...prev];
            updated.splice(index, 1);
            return updated;
        });
    };

    const handleSaveComboModal = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingComboSku) return;

        // Validation
        const validComponents = editComboComponents.filter(c => c.sku && c.sku.trim() && Number(c.quantity) > 0);
        if (validComponents.length === 0) {
            setModalError('Please specify at least one valid component SKU with quantity >= 1.');
            return;
        }

        const hasEmptySku = editComboComponents.some(c => !c.sku || !c.sku.trim());
        if (hasEmptySku) {
            setModalError('Please select a single SKU for every component row or remove unused rows.');
            return;
        }

        setModalLoading(true);
        setModalError(null);

        try {
            const res = await fetchWithRole(`/api/skus/combo/${editingComboSku.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editComboName.trim(),
                    description: editComboDescription.trim(),
                    components: validComponents,
                    lowStockThreshold: !editComboThreshold || editComboThreshold.trim() === '' || isNaN(Number(editComboThreshold))
                        ? null
                        : Math.max(0, Math.floor(Number(editComboThreshold))),
                    emailAlertsEnabled: editComboEmailAlerts
                })
            });

            const data = await res.json();
            if (data.success) {
                setSuccess(
                    data.wcSynced
                        ? `Combo SKU "${editingComboSku.sku}" components updated successfully and synced to WooCommerce!`
                        : `Combo SKU "${editingComboSku.sku}" components updated successfully!`
                );
                setError(null);
                closeEditComboModal();
                fetchSkus();
                setTimeout(() => setSuccess(null), 4000);
            } else {
                setModalError(data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to update combo SKU'));
            }
        } catch (err: any) {
            console.error('Error saving combo SKU components:', err);
            setModalError('Failed to save combo SKU: ' + (err.message || 'Unknown error'));
        } finally {
            setModalLoading(false);
        }
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
                    lowStockThreshold: !editLowThreshold || editLowThreshold.trim() === '' || isNaN(Number(editLowThreshold))
                        ? null
                        : Math.max(0, Math.floor(Number(editLowThreshold))),
                    emailAlertsEnabled: editEmailAlerts
                })
            });
            const data = await res.json();
            if (data.success) {
                setSuccess('Stock thresholds updated successfully!');
                setError(null);
                fetchSkus();
                handleCancelEdit();
                setShowThresholdInput(null); // Hide the input field
                setTimeout(() => setSuccess(null), 3000);
            } else {
                setError(data.details ? `${data.error}: ${data.details}` : (data.error || 'Failed to update thresholds'));
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

            <div className="space-y-4">
                {/* Create New SKU Button */}
                <div className="flex justify-end">
                    <button
                        onClick={() => setShowCreateForm(!showCreateForm)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <Plus size={18} />
                        {showCreateForm ? 'Cancel' : `Create New ${activeTab === 'single' ? 'Single' : 'Combo'} SKU`}
                    </button>
                </div>

                {/* Creation Form - Only show when button is clicked */}
                {showCreateForm && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
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


                            {activeTab === 'single' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Initial In Warehouse Count</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={countInitialization}
                                        onChange={(e) => setCountInitialization(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        placeholder="0"
                                        required
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Initial stock quantity in warehouse (default: 0)</p>
                                </div>
                            )}


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
                )}

                {/* List View */}
                <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Existing SKUs</h3>
                            <button onClick={fetchSkus} className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100">
                                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>
                        </div>

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
                                className="overflow-auto border-x border-b border-gray-200 rounded-b-lg"
                                style={{ maxHeight: '600px' }}
                            >
                                <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-100 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap min-w-[200px]">SKU</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Name</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">WC ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Low Stock Threshold</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Email Alerts</th>
                                        {activeTab === 'combo' && (
                                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Components</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {activeTab === 'single' ? (
                                        singleSkus.map((skuItem) => (
                                            <tr key={skuItem.id} className={skuItem.hidden ? 'opacity-50 bg-gray-50' : ''}>
                                                <td className="px-4 py-4 whitespace-nowrap min-w-[250px]">
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-sm font-medium text-gray-900 flex-shrink-0">{skuItem.sku}</span>
                                                            <div className="flex gap-2 flex-shrink-0">
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
                                                        </div>
                                                        {editingId === skuItem.id && editingType === 'single' && (
                                                            <div className="bg-gray-50 p-3 rounded border border-gray-200 space-y-3">
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-xs text-gray-600 whitespace-nowrap font-medium">Low Stock Threshold:</label>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        value={editLowThreshold}
                                                                        onChange={(e) => setEditLowThreshold(e.target.value)}
                                                                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                                                                        placeholder="e.g. 10"
                                                                        autoFocus
                                                                    />
                                                                    <span className="text-xs text-gray-400">Alert when stock ≤ this</span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-xs text-gray-600 whitespace-nowrap font-medium">Email Alerts:</label>
                                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={editEmailAlerts}
                                                                            onChange={(e) => setEditEmailAlerts(e.target.checked)}
                                                                            className="sr-only peer"
                                                                        />
                                                                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                                    </label>
                                                                    <span className="text-xs text-gray-400">{editEmailAlerts ? 'Enabled' : 'Disabled'}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
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
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{skuItem.low_stock_threshold ?? '—'}</span>
                                                        {skuItem.low_stock_threshold !== null && (
                                                            <span className="text-xs text-gray-400">Alert if ≤ {skuItem.low_stock_threshold}</span>
                                                        )}
                                                    </div>
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
                                            </tr>
                                        ))
                                    ) : (
                                        comboSkus.map((skuItem) => (
                                            <tr key={skuItem.id} className={skuItem.hidden ? 'opacity-50 bg-gray-50' : ''}>
                                                <td className="px-4 py-4 whitespace-nowrap min-w-[200px]">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-sm font-medium text-gray-900 flex-shrink-0">{skuItem.sku}</span>
                                                        <div className="flex gap-2 flex-shrink-0">
                                                            <button
                                                                onClick={() => openEditComboModal(skuItem)}
                                                                className="text-purple-600 hover:text-purple-900"
                                                                title="Edit SKU details & components"
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
                                                        </div>
                                                    </div>
                                                </td>
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
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{skuItem.low_stock_threshold ?? '—'}</span>
                                                        {skuItem.low_stock_threshold !== null && (
                                                            <span className="text-xs text-gray-400">Alert if ≤ {skuItem.low_stock_threshold}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                        skuItem.email_alerts_enabled 
                                                            ? 'bg-blue-100 text-blue-700' 
                                                            : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {skuItem.email_alerts_enabled ? 'Enabled' : 'Disabled'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-sm text-gray-500">
                                                    <div className="flex flex-col gap-1.5">
                                                        <div className="flex flex-wrap gap-1">
                                                            {(() => {
                                                                const comps = Array.isArray(skuItem.components) 
                                                                    ? skuItem.components 
                                                                    : (typeof skuItem.components === 'string' ? JSON.parse(skuItem.components || '[]') : []);
                                                                if (!comps || comps.length === 0) {
                                                                    return <span className="text-xs text-amber-600 italic">No components defined</span>;
                                                                }
                                                                return comps.map((c: any, i: number) => {
                                                                    const singleInfo = singleSkuMap.get(c.sku);
                                                                    return (
                                                                        <span
                                                                            key={i}
                                                                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-800 border border-blue-100"
                                                                            title={singleInfo ? `${singleInfo.name} (${c.sku})` : c.sku}
                                                                        >
                                                                            <span className="font-bold mr-1">{c.quantity}x</span>
                                                                            <span>{c.sku}</span>
                                                                            {singleInfo && (
                                                                                <span className="text-blue-500 ml-1 text-[10px] font-normal">
                                                                                    ({singleInfo.name})
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                    );
                                                                });
                                                            })()}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => openEditComboModal(skuItem)}
                                                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium w-fit hover:underline pt-0.5"
                                                            title="Edit component content for this combo SKU"
                                                        >
                                                            <Edit2 size={12} />
                                                            <span>Edit Components</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    {((activeTab === 'single' && singleSkus.length === 0) || (activeTab === 'combo' && comboSkus.length === 0)) && (
                                        <tr>
                                            <td colSpan={activeTab === 'combo' ? 7 : 6} className="px-4 py-12 text-center text-gray-500">No SKUs found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Edit Combo SKU Modal */}
            {editingComboSku && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/80">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                                    <Layers size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">
                                        Edit Combo SKU: <span className="font-mono text-blue-600">{editingComboSku.sku}</span>
                                    </h3>
                                    <p className="text-xs text-gray-500">Edit components content, stock thresholds, and details</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeEditComboModal}
                                disabled={modalLoading}
                                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <form onSubmit={handleSaveComboModal} className="p-6 space-y-5 max-h-[calc(85vh-120px)] overflow-y-auto">
                            {modalError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                    {modalError}
                                </div>
                            )}

                            {/* SKU Code & WC Product ID Badges */}
                            <div className="grid grid-cols-2 gap-4 bg-blue-50/50 p-3 rounded-lg border border-blue-100 text-sm">
                                <div>
                                    <span className="text-xs text-gray-500 font-medium block">SKU Code (Read-only)</span>
                                    <span className="font-semibold text-gray-900 font-mono">{editingComboSku.sku}</span>
                                </div>
                                <div>
                                    <span className="text-xs text-gray-500 font-medium block">WooCommerce Product ID</span>
                                    <span className="font-semibold text-gray-900">
                                        {editingComboSku.woocommerce_product_id ? (
                                            <span className="text-green-700 font-mono">#{editingComboSku.woocommerce_product_id} (Connected)</span>
                                        ) : (
                                            <span className="text-gray-400 italic">Not connected</span>
                                        )}
                                    </span>
                                </div>
                            </div>

                            {/* Product Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Product Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={editComboName}
                                    onChange={(e) => setEditComboName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                    required
                                />
                            </div>

                            {/* Components Content Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-900">
                                            Bundle Components ({editComboComponents.length}) <span className="text-red-500">*</span>
                                        </label>
                                        <p className="text-xs text-gray-500">
                                            Select single SKUs and set the quantity required to make one unit of this combo.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addEditComboComponentRow}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 shadow-sm"
                                    >
                                        <Plus size={14} /> Add Component
                                    </button>
                                </div>

                                <div className="space-y-2 border border-gray-200 rounded-lg p-3 bg-gray-50/70 max-h-64 overflow-y-auto">
                                    {editComboComponents.map((comp, idx) => (
                                        <div key={idx} className="flex gap-2 items-center bg-white p-2.5 rounded-lg border border-gray-200 shadow-sm">
                                            <div className="flex-1">
                                                <select
                                                    value={comp.sku}
                                                    onChange={(e) => updateEditComboComponent(idx, 'sku', e.target.value)}
                                                    className="w-full text-sm border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                    required
                                                >
                                                    <option value="">Select Single SKU</option>
                                                    {singleSkus.map(s => (
                                                        <option key={s.id} value={s.sku}>
                                                            {s.name} ({s.sku})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="w-28">
                                                <div className="relative flex items-center">
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={comp.quantity}
                                                        onChange={(e) => updateEditComboComponent(idx, 'quantity', parseInt(e.target.value) || 1)}
                                                        className="w-full text-sm border border-gray-300 rounded-lg p-2 pr-8 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
                                                        required
                                                        title="Quantity per combo"
                                                    />
                                                    <span className="absolute right-2 text-xs text-gray-400 pointer-events-none">qty</span>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeEditComboComponentRow(idx)}
                                                disabled={editComboComponents.length <= 1}
                                                className="p-2 text-red-500 hover:text-red-700 disabled:opacity-30 disabled:hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                                                title={editComboComponents.length <= 1 ? "At least 1 component is required" : "Remove component row"}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-2.5 bg-blue-50/70 border border-blue-200/60 rounded-lg text-xs text-blue-800 space-y-1">
                                    <p className="font-medium">⚡ Automatic Synchronization:</p>
                                    <p className="text-blue-700">
                                        Saving will update HIS component breakdown, automatically recalculate available bundle inventory from component stock, and immediately sync the updated available stock to WooCommerce.
                                    </p>
                                </div>
                            </div>

                            {/* Stock Threshold & Email Alerts */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-200">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Low Stock Threshold
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={editComboThreshold}
                                        onChange={(e) => setEditComboThreshold(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                        placeholder="e.g. 10 (blank for none)"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Alert when available combos ≤ this count</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Email Alerts
                                    </label>
                                    <div className="flex items-center gap-3 mt-2">
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editComboEmailAlerts}
                                                onChange={(e) => setEditComboEmailAlerts(e.target.checked)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                        <span className="text-sm text-gray-700 font-medium">
                                            {editComboEmailAlerts ? 'Alerts Enabled' : 'Alerts Disabled'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                                <textarea
                                    value={editComboDescription}
                                    onChange={(e) => setEditComboDescription(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                    rows={2}
                                    placeholder="Optional description for this combo..."
                                />
                            </div>

                            {/* Modal Footer */}
                            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                                <button
                                    type="button"
                                    onClick={closeEditComboModal}
                                    disabled={modalLoading}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={modalLoading}
                                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-semibold shadow-sm"
                                >
                                    {modalLoading ? (
                                        <>
                                            <RefreshCw size={16} className="animate-spin" />
                                            Saving & Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <Save size={16} />
                                            Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
