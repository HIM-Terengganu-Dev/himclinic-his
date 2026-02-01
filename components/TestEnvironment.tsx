'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { FlaskConical, Play, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface TestSku {
    sku: string;
    name: string;
    type: 'single' | 'combo';
}

export default function TestEnvironment() {
    const { data: session } = useSession();
    const [testSkus, setTestSkus] = useState<TestSku[]>([]);
    const [selectedSku, setSelectedSku] = useState<string>('');
    const [orderId, setOrderId] = useState<string>('99999');
    const [quantity, setQuantity] = useState<number>(1);
    const [selectedEvent, setSelectedEvent] = useState<string>('order.processing');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ success: boolean; message: string; details?: any } | null>(null);
    const [currentStock, setCurrentStock] = useState<Record<string, any>>({});
    const [loadingStock, setLoadingStock] = useState(false);
    const [comboComponents, setComboComponents] = useState<Array<{ sku: string; quantity: number; name?: string }>>([]);

    // Fetch available SKUs
    useEffect(() => {
        fetchTestSkus();
    }, []);

    const fetchTestSkus = async () => {
        try {
            const response = await fetch('/api/test/dummy-skus');
            const data = await response.json();
            if (data.success) {
                const skus: TestSku[] = [
                    ...(data.singleSkus || []).map((s: any) => ({ sku: s.sku, name: s.name, type: 'single' as const })),
                    ...(data.comboSkus || []).map((c: any) => ({ sku: c.sku, name: c.name, type: 'combo' as const }))
                ];
                setTestSkus(skus);
                if (skus.length > 0 && !selectedSku) {
                    setSelectedSku(skus[0].sku);
                }
            }
        } catch (error) {
            console.error('Error fetching test SKUs:', error);
        }
    };

    const fetchCurrentStock = async (sku: string) => {
        if (!sku) return;
        setLoadingStock(true);
        try {
            // Include dummy SKUs in the inventory fetch for test environment
            const response = await fetch(`/api/inventory?t=${Date.now()}&includeDummy=true`);
            const data = await response.json();
            if (data.success) {
                setCurrentStock({
                    [sku]: {
                        inWarehouse: data.inWarehouseStock?.[sku] || 0,
                        availableForPurchase: data.availableForPurchaseStock?.[sku] || 0,
                        processing: data.processingStock?.[sku] || 0,
                        pendingConsult: data.pendingConsultStock?.[sku] || 0,
                        pendingReview: data.pendingReviewStock?.[sku] || 0,
                        backorder: data.backOrderStock?.[sku] || 0,
                    }
                });
            }
        } catch (error) {
            console.error('Error fetching current stock:', error);
        } finally {
            setLoadingStock(false);
        }
    };

    const triggerTestEvent = async () => {
        if (!selectedSku || !orderId || quantity <= 0) {
            setResult({ success: false, message: 'Please fill in all required fields' });
            return;
        }

        setLoading(true);
        setResult(null);

        try {
            const response = await fetch('/api/test/webhook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    orderId: parseInt(orderId),
                    event: selectedEvent,
                    lineItems: [{
                        sku: selectedSku,
                        quantity: quantity,
                        name: testSkus.find(s => s.sku === selectedSku)?.name || selectedSku
                    }]
                }),
            });

            const data = await response.json();
            setResult(data);
            
            // Refresh stock after event
            if (data.success) {
                setTimeout(async () => {
                    await fetchCurrentStock(selectedSku);
                    // If combo SKU, also refresh component stock
                    if (comboComponents.length > 0) {
                        for (const comp of comboComponents) {
                            await fetchCurrentStock(comp.sku);
                        }
                    }
                }, 1000);
            }
        } catch (error: any) {
            setResult({ success: false, message: error.message || 'Failed to trigger test event' });
        } finally {
            setLoading(false);
        }
    };

    const handleSkuChange = async (sku: string) => {
        setSelectedSku(sku);
        await fetchCurrentStock(sku);
        
        // If it's a combo SKU, fetch its components
        const selectedSkuData = testSkus.find(s => s.sku === sku);
        if (selectedSkuData?.type === 'combo') {
            await fetchComboComponents(sku);
        } else {
            setComboComponents([]);
        }
    };
    
    const fetchComboComponents = async (comboSku: string) => {
        try {
            const response = await fetch(`/api/test/combo-details?sku=${comboSku}`);
            const data = await response.json();
            if (data.success && data.components) {
                setComboComponents(data.components);
                // Also fetch stock for all components
                await Promise.all(data.components.map((comp: any) => fetchCurrentStock(comp.sku)));
            } else {
                setComboComponents([]);
            }
        } catch (error) {
            console.error('Error fetching combo components:', error);
            setComboComponents([]);
        }
    };

    useEffect(() => {
        if (selectedSku) {
            fetchCurrentStock(selectedSku);
            // If it's a combo SKU, fetch its components
            const selectedSkuData = testSkus.find(s => s.sku === selectedSku);
            if (selectedSkuData?.type === 'combo') {
                fetchComboComponents(selectedSku);
            } else {
                setComboComponents([]);
            }
        }
    }, [selectedSku, testSkus]);

    const eventOptions = [
        { value: 'order.pending-consult', label: 'Pending Consult' },
        { value: 'order.pending-review', label: 'Pending Review' },
        { value: 'order.processing', label: 'Processing' },
        { value: 'order.nv-pending-pickup', label: 'NV Pending Pickup' },
        { value: 'order.cancelled', label: 'Cancelled' },
    ];

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <FlaskConical className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Test Environment</h2>
                    <p className="text-sm text-gray-500 mt-1">Manually trigger webhook events to test order status transitions</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: Test Controls */}
                <div className="space-y-6">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                            <div className="text-sm text-yellow-800">
                                <p className="font-semibold mb-1">Test Environment Notice</p>
                                <p className="mb-2">This environment allows you to manually trigger webhook events for testing. Use test order IDs (e.g., 99999+) to avoid conflicts with real orders.</p>
                                <p className="font-semibold text-red-700">⚠️ IMPORTANT: Only SKUs with description = "dummy sku" are allowed in the test environment. Real SKUs are blocked for safety.</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Test SKU *
                            </label>
                            <select
                                value={selectedSku}
                                onChange={(e) => handleSkuChange(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select a SKU</option>
                                {testSkus.map((sku) => (
                                    <option key={sku.sku} value={sku.sku}>
                                        {sku.sku} - {sku.name} ({sku.type})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Order ID *
                            </label>
                            <input
                                type="number"
                                value={orderId}
                                onChange={(e) => setOrderId(e.target.value)}
                                placeholder="e.g., 99999"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">Use test order IDs (99999+) to avoid conflicts</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Quantity *
                            </label>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                                min="1"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Webhook Event *
                            </label>
                            <select
                                value={selectedEvent}
                                onChange={(e) => setSelectedEvent(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                {eventOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={triggerTestEvent}
                            disabled={loading || !selectedSku || !orderId || quantity <= 0}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? (
                                <>
                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                    Triggering...
                                </>
                            ) : (
                                <>
                                    <Play className="w-5 h-5" />
                                    Trigger Test Event
                                </>
                            )}
                        </button>

                        {result && (
                            <div className={`p-4 rounded-lg border ${
                                result.success 
                                    ? 'bg-green-50 border-green-200' 
                                    : 'bg-red-50 border-red-200'
                            }`}>
                                <div className="flex items-start gap-2">
                                    {result.success ? (
                                        <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                                    ) : (
                                        <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <p className={`font-medium ${
                                            result.success ? 'text-green-800' : 'text-red-800'
                                        }`}>
                                            {result.success ? 'Success' : 'Error'}
                                        </p>
                                        <p className={`text-sm mt-1 ${
                                            result.success ? 'text-green-700' : 'text-red-700'
                                        }`}>
                                            {result.message}
                                        </p>
                                        {result.details && (
                                            <pre className="text-xs mt-2 p-2 bg-white rounded border overflow-auto max-h-40">
                                                {JSON.stringify(result.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Current Stock Status */}
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Stock Status</h3>
                        {selectedSku ? (
                            loadingStock ? (
                                <div className="flex items-center justify-center py-8">
                                    <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
                                </div>
                            ) : currentStock[selectedSku] ? (
                                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">In Warehouse</p>
                                            <p className="text-2xl font-bold text-gray-900">
                                                {currentStock[selectedSku].inWarehouse || 0}
                                            </p>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">Available for Purchase</p>
                                            <p className="text-2xl font-bold text-blue-600">
                                                {currentStock[selectedSku].availableForPurchase || 0}
                                            </p>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">Processing</p>
                                            <p className="text-2xl font-bold text-orange-600">
                                                {currentStock[selectedSku].processing || 0}
                                            </p>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">Pending Consult</p>
                                            <p className="text-2xl font-bold text-yellow-600">
                                                {currentStock[selectedSku].pendingConsult || 0}
                                            </p>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">Pending Review</p>
                                            <p className="text-2xl font-bold text-yellow-600">
                                                {currentStock[selectedSku].pendingReview || 0}
                                            </p>
                                        </div>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                                            <p className="text-xs text-gray-500 mb-1">Backorder</p>
                                            <p className="text-2xl font-bold text-red-600">
                                                {currentStock[selectedSku].backorder || 0}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            await fetchCurrentStock(selectedSku);
                                            if (comboComponents.length > 0) {
                                                for (const comp of comboComponents) {
                                                    await fetchCurrentStock(comp.sku);
                                                }
                                            }
                                        }}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Refresh Stock
                                    </button>
                                    
                                    {/* Show combo components if this is a combo SKU */}
                                    {comboComponents.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-gray-200">
                                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Component SKUs</h4>
                                            <div className="space-y-3">
                                                {comboComponents.map((comp) => (
                                                    <div key={comp.sku} className="bg-white p-3 rounded-lg border border-gray-200">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div>
                                                                <p className="text-sm font-medium text-gray-900">{comp.sku}</p>
                                                                <p className="text-xs text-gray-500">{comp.name || comp.sku}</p>
                                                                <p className="text-xs text-gray-400 mt-1">Qty per combo: {comp.quantity}</p>
                                                            </div>
                                                        </div>
                                                        {currentStock[comp.sku] ? (
                                                            <div className="grid grid-cols-3 gap-2 mt-2">
                                                                <div>
                                                                    <p className="text-xs text-gray-500">In Warehouse</p>
                                                                    <p className="text-lg font-bold text-gray-900">
                                                                        {currentStock[comp.sku].inWarehouse || 0}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs text-gray-500">Available</p>
                                                                    <p className="text-lg font-bold text-blue-600">
                                                                        {currentStock[comp.sku].availableForPurchase || 0}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <p className="text-xs text-gray-500">Processing</p>
                                                                    <p className="text-lg font-bold text-orange-600">
                                                                        {currentStock[comp.sku].processing || 0}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-gray-400">No stock data</p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
                                    <p>No stock data available for this SKU</p>
                                </div>
                            )
                        ) : (
                            <div className="bg-gray-50 rounded-lg p-8 text-center text-gray-500">
                                <p>Select a SKU to view stock status</p>
                            </div>
                        )}
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-900 mb-2">Test Workflow</h4>
                        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                            <li>Select a test SKU</li>
                            <li>Enter a test order ID (99999+)</li>
                            <li>Set quantity</li>
                            <li>Choose webhook event</li>
                            <li>Trigger event and observe stock changes</li>
                            <li>Check Activity Log to verify transactions</li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    );
}
