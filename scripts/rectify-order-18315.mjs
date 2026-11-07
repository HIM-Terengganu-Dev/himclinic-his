import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
const envFallback = path.resolve(__dirname, '..', '.env');
const targetEnv = fs.existsSync(envPath) ? envPath : envFallback;

const envContent = fs.readFileSync(targetEnv, 'utf-8');
let dbUrl = '';
let ddlMatch = envContent.match(/^DATABASE_URL_DDL=["']?([^"'\r\n]+)/m);
if (ddlMatch) {
    dbUrl = ddlMatch[1].trim();
} else {
    let match = envContent.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m);
    if (match) dbUrl = match[1].trim();
}

if (!dbUrl) {
    console.error('DATABASE_URL not found');
    process.exit(1);
}

const { Client } = pg;
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
    await client.query('BEGIN');

    // 1. Delete ghost transaction 6332
    const delTx = await client.query('DELETE FROM "his_db".stock_transactions WHERE id = 6332 RETURNING id, sku, source_id');
    console.log(`✅ Deleted ghost stock_transaction:`, delTx.rows);

    // 2. Delete duplicate webhook log 4001
    const delLog = await client.query('DELETE FROM "his_db".wc_webhook_logs WHERE id = 4001 RETURNING id, entity_id, webhook_event');
    console.log(`✅ Deleted duplicate wc_webhook_log:`, delLog.rows);

    // 3. Update transaction 6333 processing_before from 8 to 7
    const updTx = await client.query(`
        UPDATE "his_db".stock_transactions
        SET processing_before = 7
        WHERE id = 6333
        RETURNING id, sku, source_id, in_warehouse_before, in_warehouse_after, processing_before, processing_after
    `);
    console.log(`✅ Updated stock_transaction 6333:`, updTx.rows);

    // 4. Log to activity_logs
    const auditDetails = {
        orderId: 18315,
        sku: 'tad20/4tab',
        reason: 'Rectified Order #18315: deleted duplicate order.processing webhook log #4001 and ghost transaction #6332, corrected pickup transaction #6333 processing_before from 8 to 7.',
        deletedTransactionId: 6332,
        deletedWebhookLogId: 4001,
        updatedTransactionId: 6333,
        changes: {
            tx_6333: {
                processing_before: { from: 8, to: 7 }
            }
        }
    };

    const auditRes = await client.query(`
        INSERT INTO "his_db".activity_logs (
            action, entity_type, entity_id, details, success, created_at
        ) VALUES ($1, $2, $3, $4, true, NOW())
        RETURNING id, action, entity_id, created_at
    `, [
        'order_rectification',
        'order',
        18315,
        JSON.stringify(auditDetails)
    ]);
    console.log(`✅ Logged to activity_logs:`, auditRes.rows);

    await client.query('COMMIT');
    console.log('🎉 Rectification completed successfully.');
} catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed, rolled back:', err);
    process.exit(1);
} finally {
    await client.end();
}
