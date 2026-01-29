# Stock Deduction and Pending Orders Flow

## Overview
This flowchart shows when stock is deducted and how pending orders work.

---

## Main Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW ORDER RECEIVED                            │
│                    (WooCommerce Webhook)                         │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Order Status? │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ pending-consult│   │pending-review │   │  processing   │
│   or           │   │   or          │   │  (direct)     │
│ pending-review │   │               │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Order Type?   │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Single SKU   │   │  Combo SKU    │   │  Mixed Order  │
│   Order       │   │   Order       │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Stock Action │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  WC Deducts   │   │  HIS Deducts  │   │  Both Actions │
│  Stock        │   │  Components   │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Pending Stock │
                    │  Tracking?     │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Add to       │   │  No Pending   │   │  Remove from  │
│  Pending      │   │  Tracking     │   │  Pending      │
│  (if pending- │   │  (if direct   │   │  (if was in   │
│   consult/    │   │   processing) │   │   pending)    │
│   review)     │   │               │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Log to DB     │
                    │  (stock_movements)│
                    └────────────────┘
```

---

## Detailed Flow: Pending-Consult/Review Orders

```
┌─────────────────────────────────────────────────────────────────┐
│          ORDER ENTERS pending-consult OR pending-review        │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Order Type?   │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Single SKU   │   │  Combo SKU    │   │  Mixed Order  │
│               │   │               │   │               │
│  WC deducts   │   │  WC deducts   │   │  WC deducts   │
│  stock        │   │  combo stock  │   │  single SKU   │
│  (WC-side)    │   │  (WC-side)    │   │  (WC-side)    │
│               │   │               │   │               │
│  Example:     │   │  Example:    │   │  Example:    │
│  97 → 94      │   │  (combo)     │   │  him1: 64→63 │
│  (qty: 3)     │   │               │   │  (qty: 1)    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Add to       │
                    │  Pending Stock│
                    │  Tracking     │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Dashboard     │
                    │  Display:     │
                    │  94 + 3       │
                    │  (WC + Pending)│
                    └────────────────┘
```

---

## Detailed Flow: Processing Orders

### Case 1: Order Goes Directly to Processing (No Pending)

```
┌─────────────────────────────────────────────────────────────────┐
│          ORDER GOES DIRECTLY TO processing                      │
│          (No pending-consult/review)                           │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Order Type?   │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Single SKU   │   │  Combo SKU    │   │  Mixed Order  │
│               │   │               │   │               │
│  WC deducts   │   │  HIS deducts  │   │  WC deducts   │
│  stock        │   │  components   │   │  single SKU   │
│  (WC-side)    │   │  (HIS-side)   │   │  (WC-side)    │
│               │   │               │   │  HIS deducts  │
│  Example:     │   │  Example:     │   │  components   │
│  64 → 61      │   │  iqn100/4tab: │   │  (HIS-side)   │
│  (qty: 3)     │   │  97 → 94      │   │               │
│               │   │  (qty: 3)     │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  No Pending    │
                    │  Tracking     │
                    │  (order didn't│
                    │   go through  │
                    │   pending)    │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Dashboard     │
                    │  Display:      │
                    │  61 + 1        │
                    │  (WC + Pending │
                    │   from OTHER   │
                    │   orders)      │
                    └────────────────┘
```

### Case 2: Order Processes After Pending-Consult/Review

```
┌─────────────────────────────────────────────────────────────────┐
│          ORDER PROCESSES AFTER pending-consult/review            │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Check: Was    │
                    │  stock already│
                    │  deducted?    │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  YES - Stock  │
                    │  was deducted │
                    │  in pending    │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Order Type?   │
                    └────────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Single SKU   │   │  Combo SKU    │   │  Mixed Order  │
│               │   │               │   │               │
│  WC stock     │   │  WC stock     │   │  WC stock     │
│  unchanged    │   │  unchanged    │   │  unchanged    │
│  (already     │   │  (already     │   │  (already     │
│   deducted)   │   │   deducted)   │   │   deducted)   │
│               │   │               │   │               │
│  HIS deducts  │   │  HIS deducts  │   │  HIS deducts  │
│  components   │   │  components   │   │  components   │
│  (if combo)   │   │  (HIS-side)   │   │  (if combo)   │
│               │   │               │   │               │
│  Example:     │   │  Example:     │   │               │
│  (no change)  │   │  iqn100/4tab: │   │               │
│               │   │  94 → 93      │   │               │
│               │   │  (qty: 1)     │   │               │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                    │
        │                   │                    │
        └───────────────────┴────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Remove from   │
                    │  Pending Stock │
                    │  Tracking      │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Dashboard     │
                    │  Display:      │
                    │  93 + 1        │
                    │  (WC + Pending │
                    │   from OTHER   │
                    │   orders)      │
                    └────────────────┘
```

---

## Key Rules

### 1. Stock Deduction Rules

| Order Type | Who Deducts | When | Example |
|------------|-------------|------|---------|
| **Single SKU** | WooCommerce (WC-side) | Immediately when order status changes | `him1`: 64 → 61 (qty: 3) |
| **Combo SKU** | HIS System (HIS-side) | When processing (or pending if pending-consult/review) | `iqn100/4tab`: 97 → 94 (qty: 3) |
| **Mixed Order** | Both (WC for single, HIS for combo) | When processing (or pending if pending-consult/review) | `him1`: 64 → 63 (WC), `iqn100/4tab`: 97 → 94 (HIS) |

### 2. Pending Stock Rules

| Scenario | Action | Dashboard Display |
|----------|--------|-------------------|
| **Order enters pending-consult/review** | Add to pending tracking | `WC Stock + Pending` (e.g., `94 + 3`) |
| **Order processes after pending** | Remove from pending tracking | `WC Stock + Other Pending` (e.g., `93 + 1`) |
| **Order processes directly (no pending)** | No pending tracking | `WC Stock + Other Pending` (e.g., `61 + 1`) |
| **Order cancelled from pending** | Remove from pending tracking | `WC Stock + Other Pending` |

### 3. Display Logic Rules

| Display Format | Meaning | Example |
|----------------|---------|---------|
| `:97→94+3` | WC stock before → WC stock after + pending added | Order enters pending-consult |
| `:94+3→93+4` | WC stock + pending before → WC stock after + total pending | Order #11964 enters pending (order #11314 already pending) |
| `:93+4→93+1` | WC stock + total pending → WC stock + remaining pending | Order #11314 processes (removes its +3, leaves +1 from order #11964) |
| `:64+1→61+1` | WC stock + pending → WC stock after + pending (unchanged) | Order processes directly (pending from other orders unchanged) |

---

## Example Timeline

```
Time 10:15:18 - Order #11314 enters pending-consult
├─ WC Stock: 97 → 94 (deducted 3)
├─ Pending: +3 (added)
└─ Display: 94 + 3

Time 10:25:12 - Order #11964 enters pending-consult
├─ WC Stock: 94 → 93 (deducted 1)
├─ Pending: +3 (from #11314) + 1 (this order) = +4
└─ Display: 94 + 3 → 93 + 4

Time 11:57:34 - Order #11314 processes
├─ WC Stock: 93 (unchanged, already deducted)
├─ Pending: +4 - 3 (removed #11314's pending) = +1 (from #11964)
└─ Display: 93 + 4 → 93 + 1
```

---

## Common Issues and Solutions

### Issue 1: Pending stock not showing for order #11964
**Problem**: Order #11964 shows `:94→93+1` instead of `94+3→93+4`
**Cause**: Not finding order #11314's pending-consult log in history
**Solution**: Check `allWcLogs` includes all pending-consult logs, use `actualLogEntry` for pending-consult orders

### Issue 2: Different display when collapsed vs expanded
**Problem**: Same row shows different values when collapsed vs expanded
**Cause**: Using grouped log instead of actual log entry
**Solution**: Find actual log entry (processing or pending-consult) from history when collapsed

### Issue 3: Wrong previousStock for orders that went through pending
**Problem**: Shows `96→93` instead of `97→94` (accounting for other orders)
**Cause**: Using `currentStock + pendingQty` instead of pending log's `wcStock`
**Solution**: Use pending log's `wcStock + quantity` for accurate previousStock

