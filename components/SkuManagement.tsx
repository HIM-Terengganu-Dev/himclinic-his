'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Trash2, Box, Layers, RefreshCw } from 'lucide-react';

interface SingleSku {
    id: number;
    sku: string;
    name: string;
    woocommerce_product_id: number;
}

interface ComboSku {
    id: number;
    sku: string;
    name: string;
    woocommerce_product_id: number;
    components: { sku: string; quantity: number }[];
}

export default function SkuManagement() {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<'single' | 'combo'>('single');
    const [singleSkus, setSingleSkus] = useState<SingleSku[]>([]);
    const [comboSkus, setComboSkus] = useState<ComboSku[]>([]);
    const [loading, setLoading] = useState(false);

    // Form States
    const [sku, setSku] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    // Combo Form State
    const [components, setComponents] = useState<{ sku: string; quantity: number }[]>([{ sku: '', quantity: 1 }]);

    useEffect(() => {
        fetchSkus();
    }, [activeTab]);

    const fetchSkus = async () => {
        setLoading(true);
        try {
            if (activeTab === 'single') {
                const res = await fetch('/api/skus/single');
                const data = await res.json();
                if (data.skus) setSingleSkus(data.skus);
            } else {
                const res = await fetch('/api/skus/combo');
                const data = await res.json();
                if (data.skus) setComboSkus(data.skus);

                // Also fetch single SKUs for component selector if empty
                if (singleSkus.length === 0) {
                    const resSingle = await fetch('/api/skus/single');
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

    const handleCreateSingle = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/skus/single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, name, description })
            });
            const data = await res.json();
            if (data.success) {
                alert('Single SKU Created Successfully!');
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
            } else {
                alert('Error: ' + data.error);
            }
        } catch (error) {
            console.error(error);
            alert('Failed to create SKU');
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

            const res = await fetch('/api/skus/combo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, name, description, components: validComponents })
            });
            const data = await res.json();
            if (data.success) {
                alert('Combo SKU Created Successfully!');
                fetchSkus();
                setSku('');
                setName('');
                setDescription('');
                setComponents([{ sku: '', quantity: 1 }]);
            } else {
                alert('Error: ' + data.error);
            }
        } catch (error) {
            console.error(error);
            alert('Failed to create Combo SKU');
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

    return (
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
                <div className="lg:col-span-1 border-r border-gray-100 pr-8">
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

                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">WC ID</th>
                                    {activeTab === 'combo' && (
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Components</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {activeTab === 'single' ? (
                                    singleSkus.map((sku) => (
                                        <tr key={sku.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sku.sku}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sku.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sku.woocommerce_product_id}</td>
                                        </tr>
                                    ))
                                ) : (
                                    comboSkus.map((sku) => (
                                        <tr key={sku.id}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sku.sku}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sku.name}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{sku.woocommerce_product_id}</td>
                                            <td className="px-6 py-4 text-sm text-gray-500">
                                                <div className="flex flex-col gap-1">
                                                    {sku.components.map((c, i) => (
                                                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                                            {c.quantity}x {c.sku}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                                {((activeTab === 'single' && singleSkus.length === 0) || (activeTab === 'combo' && comboSkus.length === 0)) && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No SKUs found.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
