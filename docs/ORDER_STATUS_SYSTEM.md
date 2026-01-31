# Order Status System

## Overview

The system tracks inventory across **6 distinct statuses** for each SKU. This allows precise tracking of stock at different stages of the order fulfillment process.

## The 6 Statuses

### 1. **in_warehouse** (In Warehouse)
- **Definition**: Total physical stock available in the warehouse
- **Initialization**: Set through reconciliation or manual procurement updates
- **Deduction**: Only deducted when `nv-pending-pickup` webhook is received
- **Addition**: Added through manual procurement updates or reconciliation
- **Calculation**: `in_warehouse = pending_consult + pending_review + processing + available_for_purchase`

### 2. **available_for_purchase** (Available for Purchase)
- **Definition**: Stock available for new orders
- **Calculation**: `in_warehouse - pending_consult - pending_review - processing`
- **Behavior**: Automatically calculated, not directly set
- **Purpose**: Shows how much stock can be allocated to new orders

### 3. **processing** (Processing)
- **Definition**: Orders that have moved to processing status
- **Trigger**: `order.processing` webhook
- **Source**: 
  - Moves from `pending-consult` or `pending-review` if order was pending
  - Added directly if order goes straight to processing (no consultation/review needed)
- **Important**: Does NOT deduct from `in_warehouse`
- **Deduction**: Removed when order moves to `nv-pending-pickup`

### 4. **pending_consult** (Pending Consultation)
- **Definition**: Orders awaiting consultation
- **Trigger**: `order.pending-consult` webhook
- **Behavior**: Increments count, does NOT deduct from `in_warehouse`
- **Transition**: Moves to `processing` when `order.processing` webhook received
- **Cancellation**: Removed if order cancelled from pending status

### 5. **pending_review** (Pending Review)
- **Definition**: Orders awaiting review
- **Trigger**: `order.pending-review` webhook
- **Behavior**: Increments count, does NOT deduct from `in_warehouse`
- **Transition**: Moves to `processing` when `order.processing` webhook received
- **Cancellation**: Removed if order cancelled from pending status

### 6. **backorder** (Backorder)
- **Definition**: Display-only metric for orders placed when stock is unavailable
- **Calculation**: Added when `available_for_purchase = 0` but an order comes in
- **Behavior**: 
  - Does NOT affect other status counts
  - Deducted when stock is added through procurement or reconciliation
  - Purely informational for display purposes

## Status Transitions

### Normal Order Flow

```
Order Created
    ↓
pending-consult (or pending-review)
    ↓
processing
    ↓
nv-pending-pickup
    ↓
[Stock Deducted from in_warehouse]
```

### Direct Processing Flow

```
Order Created
    ↓
processing (no pending stage)
    ↓
nv-pending-pickup
    ↓
[Stock Deducted from in_warehouse]
```

### Cancellation Flow

```
Order in pending-consult/review
    ↓
order.cancelled webhook
    ↓
[Remove from pending status]
[No in_warehouse change]

OR

Order in processing
    ↓
order.cancelled webhook
    ↓
[Remove from processing]
[Restore to in_warehouse if created after 2026-01-01]
```

## Status Calculations

### Available for Purchase
```typescript
available_for_purchase = Math.max(0, 
    in_warehouse - pending_consult - pending_review - processing
)
```

### Backorder
```typescript
// When order comes in and available_for_purchase = 0
if (available_for_purchase === 0 && orderQuantity > 0) {
    backorder += orderQuantity
}

// When stock is added
if (stockAdded > 0 && backorder > 0) {
    backorder = Math.max(0, backorder - stockAdded)
}
```

## Database Schema

Each `stock_transaction` record stores before/after values for all 6 statuses:

```sql
CREATE TABLE stock_transactions (
    -- ... other fields ...
    in_warehouse_before INTEGER NOT NULL,
    in_warehouse_after INTEGER NOT NULL,
    processing_before INTEGER NOT NULL,
    processing_after INTEGER NOT NULL,
    pending_consult_before INTEGER NOT NULL,
    pending_consult_after INTEGER NOT NULL,
    pending_review_before INTEGER NOT NULL,
    pending_review_after INTEGER NOT NULL,
    backorder_before INTEGER NOT NULL,
    backorder_after INTEGER NOT NULL
);
```

## Webhook Events and Status Updates

### `order.pending-consult`
- Increments: `pending_consult_after = pending_consult_before + quantity`
- Updates: `available_for_purchase` (recalculated)
- Updates: `backorder` (if available = 0)

### `order.pending-review`
- Increments: `pending_review_after = pending_review_before + quantity`
- Updates: `available_for_purchase` (recalculated)
- Updates: `backorder` (if available = 0)

### `order.processing`
- If from pending: 
  - Decrements: `pending_consult_after` or `pending_review_after`
  - Increments: `processing_after = processing_before + quantity`
- If direct:
  - Increments: `processing_after = processing_before + quantity`
- Updates: `available_for_purchase` (recalculated)
- Updates: `backorder` (if available = 0)
- **Does NOT** change `in_warehouse`

### `order.nv-pending-pickup`
- Decrements: `in_warehouse_after = in_warehouse_before - quantity`
- Decrements: Previous status (`processing`, `pending_consult`, or `pending_review`)
- Updates: `available_for_purchase` (recalculated)

### `order.cancelled`
- If from `nv-pending-pickup` or `processing` (after 2026-01-01):
  - Restores: `in_warehouse_after = in_warehouse_before + quantity`
- Removes from: `processing`, `pending_consult`, or `pending_review`
- Updates: `available_for_purchase` (recalculated)
- Updates: `backorder` (deducts if stock restored)

## Example Scenarios

### Scenario 1: Normal Order Flow
1. Order #1001 created for SKU "ABC-001" (quantity: 2)
2. Webhook: `order.pending-consult`
   - `pending_consult`: 0 → 2
   - `available_for_purchase`: 10 → 8
3. Webhook: `order.processing`
   - `pending_consult`: 2 → 0
   - `processing`: 0 → 2
   - `available_for_purchase`: 8 → 8 (no change)
4. Webhook: `order.nv-pending-pickup`
   - `in_warehouse`: 10 → 8
   - `processing`: 2 → 0

### Scenario 2: Direct Processing
1. Order #1002 created for SKU "ABC-001" (quantity: 1)
2. Webhook: `order.processing` (no pending stage)
   - `processing`: 0 → 1
   - `available_for_purchase`: 8 → 7
3. Webhook: `order.nv-pending-pickup`
   - `in_warehouse`: 8 → 7
   - `processing`: 1 → 0

### Scenario 3: Backorder
1. `in_warehouse`: 5
2. `processing`: 3
3. `pending_consult`: 2
4. `available_for_purchase`: 0 (5 - 3 - 2 = 0)
5. Order #1003 created (quantity: 2)
6. Webhook: `order.pending-consult`
   - `pending_consult`: 2 → 4
   - `backorder`: 0 → 2 (available was 0)
   - `available_for_purchase`: 0 → 0

## Key Rules

1. **in_warehouse is only deducted by `nv-pending-pickup`**
2. **processing does NOT deduct in_warehouse**
3. **pending-consult/review do NOT deduct in_warehouse**
4. **available_for_purchase is always calculated, never set directly**
5. **backorder is display-only and doesn't affect other counts**
6. **An order can only be in ONE status at a time** (not 5 in processing and 3 in pending-consult)

## Related Documentation

- [Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md) - Detailed flow diagrams
- [Database Schema](./DATABASE_SCHEMA.md) - Database structure
- [Webhook Integration](./WEBHOOK_INTEGRATION.md) - Webhook handling details
