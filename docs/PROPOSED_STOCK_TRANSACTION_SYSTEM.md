# Proposed Stock Transaction System

## Current Problems

1. **Multiple Sources of Truth**: WooCommerce stock, pending_consultation_stock table, webhook logs, stock_movements table
2. **Complex Reconstruction**: Frontend has to reconstruct stock history from multiple sources
3. **Pending Stock Complexity**: Pending stock is tracked separately, causing display issues
4. **Inconsistent Data**: Different views show different values (collapsed vs expanded)
5. **Bidirectional Sync**: Reading from WC and writing back to WC creates complexity and potential conflicts

## Design Philosophy

**HIS Database is the Source of Truth**
- ✅ **WooCommerce sends events via webhooks** (we listen, don't read)
- ✅ **We record all stock changes in our transaction table**
- ✅ **We don't read stock from WooCommerce** (except one-time initial reconciliation)
- ✅ **We don't write stock to WooCommerce automatically** (WC manages its own stock)
- ✅ **Display and calculations use our database only**

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    WOOCOMMERCE                              │
│  - Manages its own stock                                    │
│  - Sends webhooks when orders change                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Webhook Events
                       │ (order.processing, order.pending-consult, etc.)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    HIS SYSTEM                               │
│  - Receives webhook                                         │
│  - Records transaction in stock_transactions table          │
│  - Updates current stock state                              │
│  - Displays from transactions table                         │
└─────────────────────────────────────────────────────────────┘
```

**No bidirectional sync. One-way: WC → HIS (via webhooks)**

## Proposed Solution: Single Transaction Table

### Core Concept

**One table, one source of truth**: All stock changes are recorded as transactions. Current stock = latest transaction's `stock_after`.

**Key Principles:**
- **HIS Database is Source of Truth**: We don't read from WooCommerce, we don't write to WooCommerce automatically
- **Webhooks Only**: WooCommerce sends events via webhooks, we record them as transactions
- **One-Time Reconciliation**: Initial stock count from WC, then never read from WC again
- **Simple Display**: Just query transactions table, no complex reconstruction

---

## Database Schema

### 1. Stock Transactions Table

```sql
CREATE TABLE inventory_management.stock_transactions (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) NOT NULL,
    single_sku_id INTEGER REFERENCES inventory_management.single_skus(id) ON DELETE SET NULL,
    
    -- Transaction details
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN (
        'order_pending_consult',  -- Order enters pending-consult (deducts stock, adds to pending)
        'order_pending_review',   -- Order enters pending-review (deducts stock, adds to pending)
        'order_processing',       -- Order processes (removes from pending if was pending, or deducts if direct)
        'order_cancelled',        -- Order cancelled (restores stock, removes from pending if was pending)
        'manual_add',             -- Manual stock in
        'manual_subtract',        -- Manual stock out
        'manual_set',             -- Reconciliation/set
        'reconciliation',         -- Initial reconciliation (one-time)
        'refund_return'           -- Refund/return (restores stock)
    )),
    
    -- Stock changes
    quantity_change INTEGER NOT NULL,  -- Positive = increase, Negative = decrease
    stock_before INTEGER NOT NULL,     -- Stock count before this transaction
    stock_after INTEGER NOT NULL,       -- Stock count after this transaction
    
    -- Pending stock changes
    pending_before INTEGER NOT NULL DEFAULT 0,  -- Pending count before this transaction
    pending_after INTEGER NOT NULL DEFAULT 0,   -- Pending count after this transaction
    
    -- Source information
    source_type VARCHAR(50),             -- 'order', 'manual', 'stock_take', 'refund'
    source_id INTEGER,                   -- Order ID, procurement_update ID, etc.
    source_event VARCHAR(100),          -- 'order.processing', 'order.pending-consult', etc.
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES inventory_management.users(id) ON DELETE SET NULL,
    details JSONB,                      -- Additional context (order details, notes, etc.)
    
    -- Indexes
    CONSTRAINT stock_transactions_sku_idx UNIQUE NULLS NOT DISTINCT (sku, id)  -- For efficient querying
);

CREATE INDEX idx_stock_transactions_sku ON inventory_management.stock_transactions(sku);
CREATE INDEX idx_stock_transactions_created_at ON inventory_management.stock_transactions(created_at);
CREATE INDEX idx_stock_transactions_source ON inventory_management.stock_transactions(source_type, source_id);
CREATE INDEX idx_stock_transactions_type ON inventory_management.stock_transactions(transaction_type);
```

### 2. Current Stock View (Materialized View)

```sql
CREATE MATERIALIZED VIEW inventory_management.current_stock AS
SELECT 
    sku,
    single_sku_id,
    stock_after as current_stock,
    pending_after as current_pending,
    (stock_after + pending_after) as display_stock,
    MAX(created_at) as last_updated
FROM inventory_management.stock_transactions
WHERE id IN (
    SELECT MAX(id) 
    FROM inventory_management.stock_transactions 
    GROUP BY sku
)
GROUP BY sku, single_sku_id, stock_after, pending_after;

CREATE UNIQUE INDEX idx_current_stock_sku ON inventory_management.current_stock(sku);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_current_stock()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_management.current_stock;
END;
$$ LANGUAGE plpgsql;
```

---

## Transaction Types and Logic

### 1. Order Enters Pending-Consult

```typescript
// Transaction: order_pending_consult
{
    sku: "iqn100/4tab",
    transaction_type: "order_pending_consult",
    quantity_change: -3,           // Deduct 3 from stock
    stock_before: 97,
    stock_after: 94,
    pending_before: 0,
    pending_after: 3,             // Add 3 to pending
    source_type: "order",
    source_id: 11314,
    source_event: "order.pending-consult"
}
```

**Result**: Stock = 94, Pending = 3, Display = 94 + 3

### 2. Another Order Enters Pending-Review (Same SKU)

```typescript
// Get current state from latest transaction
const currentState = await getCurrentStockState("iqn100/4tab");
// currentState = { stock: 94, pending: 3 }

// Transaction: order_pending_review
{
    sku: "iqn100/4tab",
    transaction_type: "order_pending_review",
    quantity_change: -1,           // Deduct 1 from stock
    stock_before: 94,
    stock_after: 93,
    pending_before: 3,             // Previous pending
    pending_after: 4,              // Add 1 to pending (3 + 1)
    source_type: "order",
    source_id: 11964,
    source_event: "order.pending-review"
}
```

**Result**: Stock = 93, Pending = 4, Display = 93 + 4

### 3. Order Processes After Pending

```typescript
// Get current state
const currentState = await getCurrentStockState("iqn100/4tab");
// currentState = { stock: 93, pending: 4 }

// Transaction: order_processing
{
    sku: "iqn100/4tab",
    transaction_type: "order_processing",
    quantity_change: 0,            // No stock change (already deducted)
    stock_before: 93,
    stock_after: 93,
    pending_before: 4,
    pending_after: 1,              // Remove 3 from pending (4 - 3)
    source_type: "order",
    source_id: 11314,
    source_event: "order.processing",
    details: { wasFromPending: true, pendingRemoved: 3 }
}
```

**Result**: Stock = 93, Pending = 1, Display = 93 + 1

### 4. Order Processes Directly (No Pending)

```typescript
// Get current state
const currentState = await getCurrentStockState("iqn100/4tab");
// currentState = { stock: 64, pending: 1 }

// Transaction: order_processing
{
    sku: "iqn100/4tab",
    transaction_type: "order_processing",
    quantity_change: -3,           // Deduct 3 from stock
    stock_before: 64,
    stock_after: 61,
    pending_before: 1,             // Pending from other orders (unchanged)
    pending_after: 1,              // Pending unchanged
    source_type: "order",
    source_id: 12009,
    source_event: "order.processing",
    details: { wasFromPending: false }
}
```

**Result**: Stock = 61, Pending = 1, Display = 61 + 1

### 5. Manual Stock Update

```typescript
// Transaction: manual_add, manual_subtract, or manual_set
{
    sku: "him1",
    transaction_type: "manual_add",
    quantity_change: 10,
    stock_before: 61,
    stock_after: 71,
    pending_before: 1,
    pending_after: 1,              // Pending unchanged
    source_type: "manual",
    source_id: procurementUpdateId,
    created_by: userId
}
```

---

## Helper Functions

### Get Current Stock State

```typescript
async function getCurrentStockState(sku: string): Promise<{
    stock: number;
    pending: number;
    display: number;
}> {
    const result = await db.query(`
        SELECT 
            stock_after as stock,
            pending_after as pending,
            (stock_after + pending_after) as display
        FROM inventory_management.stock_transactions
        WHERE sku = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [sku]);
    
    if (result.rows.length === 0) {
        // No transactions yet - this should only happen before initial reconciliation
        // After reconciliation, there should always be at least one transaction
        throw new Error(`No stock transactions found for SKU: ${sku}. Please run reconciliation.`);
    }
    
    return {
        stock: result.rows[0].stock,
        pending: result.rows[0].pending,
        display: result.rows[0].display
    };
}
```

### Create Transaction

```typescript
async function createStockTransaction(data: {
    sku: string;
    singleSkuId?: number;
    transactionType: 'order_pending_consult' | 'order_pending_review' | 'order_processing' | 'order_cancelled' | 'manual_add' | 'manual_subtract' | 'manual_set' | 'reconciliation' | 'refund_return';
    quantityChange: number;
    stockBefore: number;
    stockAfter: number;
    pendingBefore: number;
    pendingAfter: number;
    sourceType?: string;
    sourceId?: number;
    sourceEvent?: string;
    createdBy?: number;
    details?: any;
}): Promise<StockTransaction> {
    // Validate: stock_after should equal stock_before + quantity_change
    if (data.stockAfter !== data.stockBefore + data.quantityChange) {
        throw new Error(`Stock calculation mismatch: ${data.stockBefore} + ${data.quantityChange} ≠ ${data.stockAfter}`);
    }
    
    const result = await db.query(`
        INSERT INTO inventory_management.stock_transactions (
            sku, single_sku_id, transaction_type,
            quantity_change, stock_before, stock_after,
            pending_before, pending_after,
            source_type, source_id, source_event,
            created_by, details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
    `, [
        data.sku,
        data.singleSkuId,
        data.transactionType,
        data.quantityChange,
        data.stockBefore,
        data.stockAfter,
        data.pendingBefore,
        data.pendingAfter,
        data.sourceType,
        data.sourceId,
        data.sourceEvent,
        data.createdBy,
        JSON.stringify(data.details || {})
    ]);
    
    // Note: We don't sync to WooCommerce automatically
    // WC manages its own stock, we just record what happens
    // Exception: Manual updates and stock takes may need to sync to WC if needed
    
    return result.rows[0];
}
```

---

## How It Works

### 1. Order Events (Webhooks Only)

**WooCommerce sends webhook → We record transaction → Done**

```typescript
// Webhook: order.pending-consult
// WC has already deducted stock (we don't need to know the exact number)
// We just record what happened based on the webhook data

await createStockTransaction({
    sku: "iqn100/4tab",
    transactionType: "order_pending_consult",  // or "order_pending_review"
    quantityChange: -3,  // From webhook lineItems
    stockBefore: currentState.stock,
    stockAfter: currentState.stock - 3,
    pendingBefore: currentState.pending,
    pendingAfter: currentState.pending + 3,
    sourceId: orderId,
    sourceEvent: "order.pending-consult"  // or "order.pending-review"
});
```

**We don't read from WC, we don't write to WC. We just record.**

### 2. Manual Updates

**User updates stock → We record transaction → Done (no WC sync)**

```typescript
// Manual stock update
await createStockTransaction({
    sku: "him1",
    transactionType: "manual_add",
    quantityChange: 10,
    stockBefore: currentState.stock,
    stockAfter: currentState.stock + 10,
    pendingBefore: currentState.pending,
    pendingAfter: currentState.pending,  // Unchanged
    sourceType: "manual",
    sourceId: procurementUpdateId
});

// No WC sync - our DB is source of truth
// WC stock may drift, but that's okay - we don't rely on it
```

### 3. Stock Takes

**User does stock take → We record transaction → Done (no WC sync)**

Similar to manual updates. Our DB is source of truth.

---

## Migration Strategy

### Phase 1: Reconciliation (One-Time Setup)

1. **Create transaction table** (empty)
2. **Reconcile current stock** (ONCE, at migration time):
   - Get current stock from WooCommerce for each SKU (last time we read from WC)
   - Get current pending stock from `pending_consultation_stock` table
   - Create initial "reconciliation" transaction for each SKU:
     ```sql
     INSERT INTO stock_transactions (
         transaction_type: 'reconciliation',
         stock_before: 0,
         stock_after: <current_wc_stock>,
         pending_before: 0,
         pending_after: <current_pending>,
         details: { reconciliation: true, date: '2026-01-26', wc_stock: <wc_stock> }
     )
     ```
3. **After reconciliation**: Never read from WC again, only listen to webhooks

### Phase 2: Dual Write (Transition Period)

1. **Keep existing system running**
2. **Write to both**:
   - Existing webhook logs, pending_consultation_stock, stock_movements
   - New stock_transactions table
3. **Display from transactions table** (new code)
4. **Verify consistency** between old and new systems

### Phase 3: Cutover

1. **Switch all reads to transactions table**
2. **Remove old tables** (or keep for historical reference)
3. **Single source of truth**: stock_transactions

---

## Benefits

### 1. Simplicity
- **One table** for all stock changes
- **No reconstruction** needed in frontend
- **Clear audit trail** of every change

### 2. Accuracy
- **Current stock = sum of transactions**
- **No discrepancies** between sources
- **Easy to reconcile** if issues arise

### 3. Performance
- **Fast queries** with indexes
- **Materialized view** for current stock
- **No complex joins** needed

### 4. Maintainability
- **Single code path** for stock changes
- **Easy to debug** (just query transactions)
- **Clear transaction history**

### 5. Display Logic
- **Simple query**: Get latest transaction for SKU
- **Show**: `stock_after + pending_after`
- **History**: Query all transactions for SKU, ordered by date

---

## Activity Log Display (Simplified)

```typescript
// Get transactions for display
const transactions = await db.query(`
    SELECT 
        t.*,
        CASE 
            WHEN t.transaction_type IN ('order_pending_consult', 'order_pending_review') THEN 
                CONCAT(':', t.stock_before + t.pending_before, '→', t.stock_after, '+', t.pending_after)
            WHEN t.transaction_type = 'order_processing' AND t.pending_before > 0 THEN
                CONCAT(':', t.stock_after, '+', t.pending_before, '→', t.stock_after, '+', t.pending_after)
            WHEN t.transaction_type = 'order_processing' THEN
                CONCAT(':', t.stock_before + t.pending_before, '→', t.stock_after, '+', t.pending_after)
            ELSE
                CONCAT(':', t.stock_before, '→', t.stock_after)
        END as display_format
    FROM inventory_management.stock_transactions t
    WHERE t.sku = $1
    ORDER BY t.created_at DESC
    LIMIT 100
`, [sku]);
```

**No complex reconstruction needed!** Just format the transaction data.

---

## Example: Order #11964 Pending

### Current System (Complex)
1. Query webhook logs
2. Find pending-consult logs before this order
3. Calculate pending from other orders
4. Reconstruct previousStock
5. Display

### New System (Simple)
```sql
-- Get latest transaction before order #11964
SELECT stock_after, pending_after 
FROM stock_transactions 
WHERE sku = 'iqn100/4tab' 
AND created_at < (SELECT created_at FROM stock_transactions WHERE source_id = 11964 LIMIT 1)
ORDER BY created_at DESC LIMIT 1;
-- Result: stock = 94, pending = 3

-- Create transaction for order #11964
INSERT INTO stock_transactions (
    sku, transaction_type, quantity_change,
    stock_before: 94, stock_after: 93,
    pending_before: 3, pending_after: 4,
    source_id: 11964
);

-- Display: 94+3→93+4 (from transaction data)
```

---

## Next Steps

1. **Review this proposal**
2. **Create migration script** for reconciliation
3. **Implement transaction functions**
4. **Update webhook handler** to write transactions
5. **Update frontend** to read from transactions
6. **Test thoroughly**
7. **Cutover**

---

## Key Differences from Current System

### Current System
```
WC Stock → Webhook → Read from WC → Calculate → Write to WC → Display (reconstruct from logs)
```

### New System
```
WC Stock → Webhook → Record Transaction → Display (from transactions)
```

**No reading from WC, no writing to WC (except optional manual sync)**

---

## Important Considerations

### 1. Single SKU Orders

**WC automatically deducts stock** → Webhook tells us → We record transaction

```typescript
// Webhook: order.processing (single SKU)
// WC has already deducted stock
// We just record it

const currentState = await getCurrentStockState(sku);
await createStockTransaction({
    sku,
    transactionType: "order_processing",
    quantityChange: -lineItem.quantity,  // From webhook
    stockBefore: currentState.stock,
    stockAfter: currentState.stock - lineItem.quantity,
    pendingBefore: currentState.pending,
    pendingAfter: currentState.pending,
    sourceId: orderId
});
```

**We trust WC's deduction, we just record it.**

### 2. Combo SKU Orders

**WC deducts combo stock** → Webhook tells us → We deduct components ourselves → Record transactions

```typescript
// Webhook: order.processing (combo SKU)
// WC deducted combo stock (we don't care)
// We need to deduct components ourselves

for (const component of comboComponents) {
    const currentState = await getCurrentStockState(component.sku);
    await createStockTransaction({
        sku: component.sku,
        transactionType: "order_processing",
        quantityChange: -component.quantity,
        stockBefore: currentState.stock,
        stockAfter: currentState.stock - component.quantity,
        pendingBefore: currentState.pending,
        pendingAfter: currentState.pending,
        sourceId: orderId
    });
}
```

**We manage component stock ourselves, WC doesn't know about components.**

### 3. Manual Updates

**User updates stock** → We record transaction → Optionally sync to WC (optional)

If you want WC to reflect manual updates, sync it. But WC stock is not our source of truth.

### 4. Reconciliation

**One-time initial reconciliation** → After that, never read from WC again

Only needed once at migration time. After that, all stock comes from transactions.

---

## Questions to Consider

1. **Manual Updates Sync**: Should manual updates sync to WooCommerce?
   - **Answer**: No - our DB is source of truth. WC stock may drift, but we don't rely on it.

2. **Stock Takes Sync**: Should stock takes sync to WooCommerce?
   - **Answer**: No - our DB is source of truth.

3. **Combo SKU Stock in WC**: Should we update combo SKU stock in WC after component deductions?
   - **Answer**: No - WC manages its own stock. We only record what happens via webhooks.
   - **Note**: WC doesn't know about combo components anyway, so this doesn't matter.

4. **Historical Data**: Keep old tables for reference or migrate everything?
   - **Recommendation**: Keep for reference, but new system doesn't use them

5. **Reconciliation Frequency**: After initial reconciliation, do we need periodic reconciliation?
   - **Recommendation**: Optional daily/weekly reconciliation job to detect drift (but shouldn't happen if webhooks work correctly)

