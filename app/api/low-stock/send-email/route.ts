import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

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

        if (!process.env.RESEND_API_KEY) {
            return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
        }

        // Initialize Resend only when the API route is called, not at module load time
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Format email body with SKU details
        // The email body template is stored in database (emailSettings.emailBody)
        // We'll replace placeholders or append SKU details
        let emailContent = emailSettings.emailBody || 'The following SKUs are running low on stock:\n\n';
        
        // Append SKU details to the email body
        const skuList = lowStockSkus.map((sku: any) => 
            `- ${sku.sku} (${sku.name}): Current stock: ${sku.currentStock}, Threshold: ${sku.low_stock_threshold}`
        ).join('\n');
        
        emailContent += skuList;

        // Use Resend SDK to send email
        const senderEmail = emailSettings.sender_email || process.env.RESEND_FROM_EMAIL || 'noreply@example.com';
        const recipientEmail = Array.isArray(emailSettings.recipientEmail) 
            ? emailSettings.recipientEmail 
            : [emailSettings.recipientEmail];
        const emailSubject = emailSettings.emailSubject || 'Low Stock Alert';

        const { data, error } = await resend.emails.send({
            from: senderEmail,
            to: recipientEmail,
            subject: emailSubject,
            text: emailContent,
        });

        if (error) {
            console.error('❌ Failed to send email via Resend:', error);
            return NextResponse.json({ 
                error: 'Failed to send email', 
                details: error 
            }, { status: 500 });
        }

        console.log('✅ Email sent via Resend:', data);

        return NextResponse.json({ 
            success: true, 
            message: 'Email sent successfully',
            emailId: data?.id
        });
    } catch (error: any) {
        console.error('Error sending low stock email:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}
