/**
 * Helper function to check for low stock and send email alerts
 * This is called after stock transactions to trigger alerts in real-time
 */
export async function checkAndSendLowStockAlerts(affectedSkus: string[] = []) {
    try {
        // Only check if email alerts are enabled
        const { getLowStockEmailSettings, getSkusWithLowStock, updateLowStockEmailLastSent } = await import('@/lib/db/queries');
        const emailSettings = await getLowStockEmailSettings();
        
        if (!emailSettings || !emailSettings.enabled) {
            return { sent: false, reason: 'Email alerts disabled' };
        }

        // Get all low stock SKUs
        const lowStockData = await getSkusWithLowStock();
        const allLowStock = [...lowStockData.single, ...lowStockData.combo];

        if (allLowStock.length === 0) {
            return { sent: false, reason: 'No low stock SKUs' };
        }

        // If specific SKUs were affected, only send if any of them are in low stock
        if (affectedSkus.length > 0) {
            const affectedLowStock = allLowStock.filter(sku => 
                affectedSkus.includes(sku.sku)
            );
            
            if (affectedLowStock.length === 0) {
                return { sent: false, reason: 'Affected SKUs not in low stock' };
            }
        }

        // Send email via internal API call
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3000';
        
        try {
            const emailResponse = await fetch(`${baseUrl}/api/low-stock/send-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.CRON_SECRET || 'internal'}`
                },
                body: JSON.stringify({
                    lowStockSkus: allLowStock,
                    emailSettings
                })
            });

            if (emailResponse.ok) {
                // Update last sent timestamp
                await updateLowStockEmailLastSent();
                return { 
                    sent: true, 
                    lowStockCount: allLowStock.length,
                    affectedSkus: allLowStock.map(s => s.sku)
                };
            } else {
                const errorData = await emailResponse.json();
                console.error('Failed to send low stock email:', errorData);
                return { sent: false, reason: 'Email send failed', error: errorData };
            }
        } catch (fetchError: any) {
            console.error('Error calling email API:', fetchError);
            return { sent: false, reason: 'API call failed', error: fetchError.message };
        }
    } catch (error: any) {
        console.error('Error checking low stock alerts:', error);
        // Don't throw - this is a background operation
        return { sent: false, reason: 'Check failed', error: error.message };
    }
}
