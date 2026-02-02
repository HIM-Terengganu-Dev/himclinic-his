'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Bell, Mail, Settings, Save, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { fetchWithRole } from '@/lib/utils/fetchWithRole';

interface EmailSettings {
    id?: number;
    enabled: boolean;
    recipient_email: string;
    sender_email?: string;
    email_subject: string;
    email_body: string;
    last_sent_at?: string;
}

interface LowStockSku {
    id: number;
    sku: string;
    name: string;
    currentStock: number;
    low_stock_threshold: number;
}

export default function LowStockAlerts() {
    const { data: session } = useSession();
    const [emailSettings, setEmailSettings] = useState<EmailSettings>({
        enabled: false,
        recipient_email: '',
        sender_email: '',
        email_subject: 'Low Stock Alert',
        email_body: 'The following SKUs are running low on stock:\n\n'
    });
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [lowStockSkus, setLowStockSkus] = useState<{ single: LowStockSku[]; combo: LowStockSku[] }>({ single: [], combo: [] });
    const [checkingStock, setCheckingStock] = useState(false);

    useEffect(() => {
        fetchEmailSettings();
        checkLowStock();
    }, []);

    const fetchEmailSettings = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithRole('/api/low-stock/email-settings');
            if (!res.ok) throw new Error('Failed to fetch email settings');
            const data = await res.json();
            if (data.success && data.settings) {
                setEmailSettings(data.settings);
            }
        } catch (err: any) {
            console.error('Error fetching email settings:', err);
            setError(err.message || 'Failed to load email settings');
        } finally {
            setLoading(false);
        }
    };

    const checkLowStock = async () => {
        setCheckingStock(true);
        try {
            const res = await fetchWithRole('/api/low-stock/check');
            if (!res.ok) throw new Error('Failed to check low stock');
            const data = await res.json();
            if (data.success && data.lowStockSkus) {
                setLowStockSkus(data.lowStockSkus);
            }
        } catch (err: any) {
            console.error('Error checking low stock:', err);
        } finally {
            setCheckingStock(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await fetchWithRole('/api/low-stock/email-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled: emailSettings.enabled,
                    recipientEmail: emailSettings.recipient_email,
                    senderEmail: emailSettings.sender_email,
                    emailSubject: emailSettings.email_subject,
                    emailBody: emailSettings.email_body
                })
            });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to save settings');
            }
            const data = await res.json();
            if (data.success) {
                setSuccess('Email settings saved successfully!');
                setTimeout(() => setSuccess(null), 3000);
            }
        } catch (err: any) {
            console.error('Error saving email settings:', err);
            setError(err.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const allLowStock = [...lowStockSkus.single, ...lowStockSkus.combo];

    return (
        <div className="space-y-6">
            {/* Success/Error Messages */}
            {success && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {success}
                </div>
            )}
            {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {/* Email Settings Panel */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-lg flex items-center justify-center">
                        <Mail className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Email Alert Settings</h3>
                        <p className="text-sm text-gray-500">Configure automatic email notifications for low stock</p>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-8 text-gray-500">Loading settings...</div>
                ) : (
                    <div className="space-y-4">
                        {/* Enable/Disable Toggle */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                                <label className="text-sm font-medium text-gray-900">Enable Email Alerts</label>
                                <p className="text-xs text-gray-500 mt-1">Automatically send emails when stock is low</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={emailSettings.enabled}
                                    onChange={(e) => setEmailSettings({ ...emailSettings, enabled: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>

                        {/* Recipient Email */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email</label>
                            <input
                                type="email"
                                value={emailSettings.recipient_email}
                                onChange={(e) => setEmailSettings({ ...emailSettings, recipient_email: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="admin@example.com"
                                required
                            />
                        </div>

                        {/* Email Subject */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
                            <input
                                type="text"
                                value={emailSettings.email_subject}
                                onChange={(e) => setEmailSettings({ ...emailSettings, email_subject: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="Low Stock Alert"
                            />
                        </div>

                        {/* Email Body */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
                            <textarea
                                value={emailSettings.email_body}
                                onChange={(e) => setEmailSettings({ ...emailSettings, email_body: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                rows={6}
                                placeholder="The following SKUs are running low on stock:&#10;&#10;{SKU details will be appended here}"
                            />
                            <p className="text-xs text-gray-500 mt-1">Use {'{SKU}'}, {'{NAME}'}, {'{CURRENT_STOCK}'}, {'{THRESHOLD}'} as placeholders</p>
                        </div>

                        {/* Save Button */}
                        <div className="flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                                <Save className="w-4 h-4" />
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>

                        {/* Last Sent Info */}
                        {emailSettings.last_sent_at && (
                            <div className="text-xs text-gray-500 pt-2 border-t">
                                Last email sent: {new Date(emailSettings.last_sent_at).toLocaleString()}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Current Low Stock Status */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-tr from-orange-600 to-red-500 rounded-lg flex items-center justify-center">
                            <Bell className="text-white w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-gray-900">Current Low Stock Status</h3>
                            <p className="text-sm text-gray-500">SKUs currently below threshold</p>
                        </div>
                    </div>
                    <button
                        onClick={checkLowStock}
                        disabled={checkingStock}
                        className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-5 h-5 ${checkingStock ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {checkingStock ? (
                    <div className="text-center py-8 text-gray-500">Checking stock levels...</div>
                ) : allLowStock.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                        <p>No SKUs are currently below their low stock threshold</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {allLowStock.map((sku) => (
                            <div key={sku.id} className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-semibold text-gray-900">{sku.sku} - {sku.name}</div>
                                        <div className="text-sm text-gray-600 mt-1">
                                            Current: <span className="font-medium text-orange-700">{sku.currentStock}</span> | 
                                            Threshold: <span className="font-medium">{sku.low_stock_threshold}</span>
                                            <span className="text-xs text-gray-500 ml-2">(Alert when ≤ {sku.low_stock_threshold})</span>
                                        </div>
                                    </div>
                                    <div className="text-orange-600">
                                        <AlertTriangle className="w-6 h-6" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
