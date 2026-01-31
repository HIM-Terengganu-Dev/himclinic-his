# Stock Management Flow

## Overview

This document describes how stock moves through the system across different statuses and operations.

## Stock Status Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    in_warehouse                              │
│              (Physical Stock in Warehouse)                    │
└───────────────┬─────────────────────────────────────────────┘
                │
                │ Deducted only by nv-pending-pickup
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│              available_for_purchase                         │
│  (Calculated: in_warehouse - pending - processing)          │
└───────────────┬─────────────────────────────────────────────┘
                │
                │ Orders come in
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌───────────────┐ ┌───────────────┐
│pending_consult│ │pending_review  │
│               │ │               │
└───────┬───────┘ └───────┬───────┘
        │                 │
        │ Move to processing
        │
        ▼
┌─────────────────────────────────────────────┐
│              processing                      │
│  (Orders being processed, no in_warehouse    │
│   deduction yet)                             │
└───────────────┬──────────────────────────────┘
                │
                │ nv-pending-pickup webhook
                │
                ▼
        [Stock Deducted from in_warehouse]
```

## Detailed Flow Scenarios

### Scenario 1: Normal Order with Consultation

```
Initial State:
- in_warehouse: 100
- available_for_purchase: 100
- processing: 0
- pending_consult: 0
- pending_review: 0
- backorder: 0

Step 1: Order #1001 created (quantity: 5)
Webhook: order.pending-consult
├─ pending_consult: 0 → 5
├─ available_for_purchase: 100 → 95 (100 - 5 - 0 - 0)
└─ in_warehouse: 100 (unchanged)

Step 2: Consultation completed
Webhook: order.processing
├─ pending_consult: 5 → 0
├─ processing: 0 → 5
├─ available_for_purchase: 95 → 95 (100 - 0 - 5 - 0)
└─ in_warehouse: 100 (unchanged)

Step 3: Ready for pickup
Webhook: order.nv-pending-pickup
├─ in_warehouse: 100 → 95
├─ processing: 5 → 0
├─ available_for_purchase: 95 → 95 (95 - 0 - 0 - 0)
└─ [Stock physically leaves warehouse]

Final State:
- in_warehouse: 95
- available_for_purchase: 95
- processing: 0
- pending_consult: 0
```

### Scenario 2: Direct Processing (No Consultation)

```
Initial State:
- in_warehouse: 100
- available_for_purchase: 100
- processing: 0

Step 1: Order #1002 created (quantity: 3)
Webhook: order.processing (no pending stage)
├─ processing: 0 → 3
├─ available_for_purchase: 100 → 97 (100 - 0 - 3 - 0)
└─ in_warehouse: 100 (unchanged)

Step 2: Ready for pickup
Webhook: order.nv-pending-pickup
├─ in_warehouse: 100 → 97
├─ processing: 3 → 0
└─ available_for_purchase: 97 → 97
```

### Scenario 3: Backorder Situation

```
Initial State:
- in_warehouse: 10
- processing: 5
- pending_consult: 3
- pending_review: 2
- available_for_purchase: 0 (10 - 5 - 3 - 2)
- backorder: 0

Step 1: Order #1003 created (quantity: 4)
Webhook: order.pending-consult
├─ pending_consult: 3 → 7
├─ available_for_purchase: 0 → 0 (10 - 5 - 7 - 2)
├─ backorder: 0 → 4 (available was 0, order came in)
└─ in_warehouse: 10 (unchanged)

Step 2: Stock received (manual procurement)
POST /api/procurement/update
├─ in_warehouse: 10 → 20
├─ backorder: 4 → 0 (stock added, backorder cleared)
├─ available_for_purchase: 0 → 8 (20 - 5 - 7 - 2)
└─ [Backorder fulfilled]
```

### Scenario 4: Order Cancellation

```
State Before Cancellation:
- in_warehouse: 95
- processing: 5
- pending_consult: 0

Step 1: Order #1001 cancelled (was in processing)
Webhook: order.cancelled
├─ processing: 5 → 0
├─ in_warehouse: 95 → 100 (restored if created after 2026-01-01)
├─ available_for_purchase: 90 → 100
└─ [Stock restored to warehouse]
```

## Manual Stock Operations

### Stock In (Add)

```
POST /api/procurement/update
{
  "operation": "add",
  "quantity": 50
}

Flow:
1. Get current in_warehouse
2. Calculate new in_warehouse = current + 50
3. Deduct from backorder if present (up to 50)
4. Recalculate available_for_purchase
5. Create stock_transaction
6. Log to activity_logs
```

### Stock Out (Subtract)

```
POST /api/procurement/update
{
  "operation": "subtract",
  "quantity": 10
}

Flow:
1. Get current in_warehouse
2. Calculate new in_warehouse = current - 10
3. Recalculate available_for_purchase
4. Create stock_transaction
5. Log to activity_logs
```

### Reconciliation (Set)

```
POST /api/procurement/update
{
  "operation": "set",
  "quantity": 100
}

Flow:
1. Set in_warehouse = 100 (exact value)
2. Recalculate available_for_purchase
3. Create stock_transaction
4. Log to activity_logs
```

## Combo SKU Flow

### Combo Order Processing

```
Order #1004: COMBO-001 (quantity: 2)
Components:
- SKU-001: 2 units per combo
- SKU-002: 1 unit per combo

Total Required:
- SKU-001: 4 units (2 combos × 2 units)
- SKU-002: 2 units (2 combos × 1 unit)

Webhook: order.processing
├─ For each component SKU:
│  ├─ processing: current → current + required_qty
│  ├─ available_for_purchase: recalculated
│  └─ in_warehouse: unchanged
└─ Log combo updates to wc_webhook_logs

Webhook: order.nv-pending-pickup
├─ For each component SKU:
│  ├─ in_warehouse: current → current - required_qty
│  ├─ processing: current → current - required_qty
│  └─ available_for_purchase: recalculated
```

## Status Calculation Rules

### Available for Purchase

```typescript
available_for_purchase = Math.max(0, 
    in_warehouse 
    - pending_consult 
    - pending_review 
    - processing
)
```

**Key Points:**
- Always calculated, never set directly
- Cannot be negative (minimum 0)
- Updates automatically when any status changes

### Backorder

```typescript
// When order comes in
if (available_for_purchase === 0 && orderQuantity > 0) {
    backorder += orderQuantity
}

// When stock added
if (stockAdded > 0 && backorder > 0) {
    backorder = Math.max(0, backorder - stockAdded)
}
```

**Key Points:**
- Display-only metric
- Does not affect other status counts
- Automatically cleared when stock is added

## Transaction Recording

Every stock change creates a `stock_transaction` record with:

- **Before values**: All 6 statuses before the change
- **After values**: All 6 statuses after the change
- **Source information**: What triggered the change (webhook, manual update, etc.)
- **Timestamp**: When the change occurred

This allows:
- Complete audit trail
- Historical state reconstruction
- Stock movement analysis

## Related Documentation

- [Order Status System](./ORDER_STATUS_SYSTEM.md) - Status definitions
- [Database Schema](./DATABASE_SCHEMA.md) - Transaction structure
- [Webhook Integration](./WEBHOOK_INTEGRATION.md) - Webhook handling
