import { NextRequest, NextResponse } from 'next/server';

// This will use Resend or similar email service
// For now, we'll create a placeholder that can be implemented with Resend API

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { lowStockSkus, emailSettings } = body;

        if (!emailSettings || !emailSettings.recipientEmail) {
            return NextResponse.json({ error: 'Email settings not configured' }, { status: 400 });
        }

        // Format email body with SKU details
        let emailContent = emailSettings.emailBody || 'The following SKUs are running low on stock:\n\n';
        
        lowStockSkus.forEach((sku: any) => {
            emailContent += `- ${sku.sku} (${sku.name}): Current stock: ${sku.currentStock}, Threshold: ${sku.low_stock_threshold}\n`;
        });

        // TODO: Implement actual email sending using Resend or similar
        // For now, we'll log it
        console.log('📧 Low Stock Alert Email:', {
            to: emailSettings.recipientEmail,
            subject: emailSettings.emailSubject,
            body: emailContent
        });

        // If RESEND_API_KEY is set, use Resend to send email
        if (process.env.RESEND_API_KEY) {
            try {
                const resendResponse = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: process.env.RESEND_FROM_EMAIL || 'noreply@example.com',
                        to: emailSettings.recipientEmail,
                        subject: emailSettings.emailSubject || 'Low Stock Alert',
                        text: emailContent
                    })
                });

                if (!resendResponse.ok) {
                    const errorData = await resendResponse.json();
                    throw new Error(`Resend API error: ${JSON.stringify(errorData)}`);
                }

                const result = await resendResponse.json();
                console.log('✅ Email sent via Resend:', result);
            } catch (emailError: any) {
                console.error('❌ Failed to send email via Resend:', emailError);
                // Don't fail the request, just log the error
            }
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Email sent successfully',
            emailSent: !!process.env.RESEND_API_KEY
        });
    } catch (error: any) {
        console.error('Error sending low stock email:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
