# Sample Activity Log Records - Order Processing Then Cancelled

## Scenario
Order #12347 with mixed SKUs: "iqn100/4tab" (quantity: 1) - single SKU, and "tad5/30tab" (quantity: 1) - combo SKU

**Timeline:**
1. Order enters "processing" status → Stock deducted
2. Order is "cancelled" → Stock restored

---

## 1. Processing Webhook Log (Order #12347)

### Database Record (wc_webhook_logs table)

```json
{
  "id": 1236,
  "webhook_type": "order",
  "webhook_event": "order.processing",
  "entity_id": 12347,
  "entity_sku": "iqn100/4tab",
  "entity_name": "Order #12347",
  "status": "processing",
  "stock_quantity": null,
  "previous_stock_quantity": null,
  "affected_skus": ["iqn100/4tab", "tad5/30tab"],
  "combo_updates": [
    {
      "sku": "kom/spu+iqn100",
      "newStock": 8
    },
    {
      "sku": "tad5/30tab",
      "newStock": 28
    }
  ],
  "details": {
    "orderId": 12347,
    "status": "processing",
    "lineItems": [
      {
        "sku": "iqn100/4tab",
        "name": "Pil Biru Generik 100mg",
        "quantity": 1
      },
      {
        "sku": "tad5/30tab",
        "name": "Pil Harian 5mg (Langganan Bulanan)",
        "quantity": 1
      }
    ],
    "comboSkusOrdered": [
      {
        "sku": "tad5/30tab",
        "quantity": 1
      }
    ],
    "componentDeductions": [
      {
        "sku": "iqn100/4tab",
        "previousStock": 150,
        "newStock": 149,
        "deductedQty": 1,
        "isWcSide": true
      },
      {
        "sku": "tad5/10tab",
        "previousStock": 87,
        "newStock": 84,
        "deductedQty": 3,
        "isWcSide": false
      }
    ],
    "affectedSingleSkus": ["iqn100/4tab", "tad5/10tab"],
    "note": "Combo SKU(s) ordered. System deducted component single SKU stocks and updated combo availability."
  },
  "ip_address": "192.168.1.100",
  "user_agent": "WooCommerce/8.0.0",
  "success": true,
  "error_message": null,
  "created_at": "2026-01-15T16:00:00+08:00"
}
```

### Display in Activity Log > WooCommerce Tab (Processing)

| Column | Value |
|--------|-------|
| **Time** | 2026-01-15 16:00:00 |
| **Type** | order |
| **Event** | Processing |
| **Entity** | Order #12347<br>processing |
| **SKU** | iqn100/4tab,<br>tad5/30tab |
| **Component Deductions** | iqn100/4tab: 150 → 149 (WC)<br>tad5/10tab: 87 → 84 |
| **Combo Updates** | kom/spu+iqn100: → 8<br>tad5/30tab: → 28 |
| **Status** | ✅ Success |

---

## 2. Cancellation Webhook Log (Order #12347)

### Database Record (wc_webhook_logs table)

```json
{
  "id": 1237,
  "webhook_type": "order",
  "webhook_event": "order.cancelled",
  "entity_id": 12347,
  "entity_sku": "iqn100/4tab",
  "entity_name": "Order #12347",
  "status": "cancelled",
  "stock_quantity": null,
  "previous_stock_quantity": null,
  "affected_skus": ["iqn100/4tab", "tad5/30tab"],
  "combo_updates": [
    {
      "sku": "kom/spu+iqn100",
      "newStock": 9
    },
    {
      "sku": "tad5/30tab",
      "newStock": 29
    }
  ],
  "details": {
    "orderId": 12347,
    "status": "cancelled",
    "lineItems": [
      {
        "sku": "iqn100/4tab",
        "name": "Pil Biru Generik 100mg",
        "quantity": 1
      },
      {
        "sku": "tad5/30tab",
        "name": "Pil Harian 5mg (Langganan Bulanan)",
        "quantity": 1
      }
    ],
    "comboSkusCancelled": [
      {
        "sku": "tad5/30tab",
        "quantity": 1
      }
    ],
    "componentRestorations": [
      {
        "sku": "iqn100/4tab",
        "previousStock": 149,
        "newStock": 150,
        "restoredQty": 1,
        "originalDeductionBy": "WC",
        "isWcSide": true
      },
      {
        "sku": "tad5/10tab",
        "previousStock": 84,
        "newStock": 87,
        "restoredQty": 3,
        "originalDeductionBy": "HIS",
        "isWcSide": false
      }
    ],
    "comboUpdates": [
      {
        "sku": "kom/spu+iqn100",
        "newStock": 9
      },
      {
        "sku": "tad5/30tab",
        "newStock": 29
      }
    ],
    "note": "Order cancelled. HIS system restored component single SKU stocks (from combo orders) and updated combo availability. Single SKU stocks restored by WC."
  },
  "ip_address": "192.168.1.100",
  "user_agent": "WooCommerce/8.0.0",
  "success": true,
  "error_message": null,
  "created_at": "2026-01-15T16:05:30+08:00"
}
```

### Display in Activity Log > WooCommerce Tab (Cancelled)

| Column | Value |
|--------|-------|
| **Time** | 2026-01-15 16:05:30 |
| **Type** | order |
| **Event** | Cancelled |
| **Entity** | Order #12347<br>cancelled |
| **SKU** | iqn100/4tab,<br>tad5/30tab |
| **Component Deductions** | iqn100/4tab: 149 → 150 (WC)<br>tad5/10tab: 84 → 87 |
| **Combo Updates** | kom/spu+iqn100: → 9<br>tad5/30tab: → 29 |
| **Status** | ✅ Success |

---

## Key Points

### Processing Event (16:00:00)
1. **Stock Deducted:**
   - `iqn100/4tab`: 150 → 149 (WC deducted, `isWcSide: true`)
   - `tad5/10tab`: 87 → 84 (HIS deducted as component of `tad5/30tab`, `isWcSide: false`)

2. **Combo Availability Updated:**
   - `kom/spu+iqn100`: → 8 units
   - `tad5/30tab`: → 28 units

### Cancellation Event (16:05:30)
1. **Stock Restored:**
   - `iqn100/4tab`: 149 → 150 (WC restored, `isWcSide: true`, `originalDeductionBy: "WC"`)
   - `tad5/10tab`: 84 → 87 (HIS restored, `isWcSide: false`, `originalDeductionBy: "HIS"`)

2. **Combo Availability Updated:**
   - `kom/spu+iqn100`: → 9 units (increased because `iqn100/4tab` was restored)
   - `tad5/30tab`: → 29 units (increased because `tad5/10tab` was restored)

3. **Restoration Logic:**
   - **Single SKU (`iqn100/4tab`)**: WooCommerce automatically restores stock. HIS tracks it.
   - **Combo Component (`tad5/10tab`)**: HIS system restores it because HIS originally deducted it.

4. **Note**: The system note indicates "Order cancelled. HIS system restored component single SKU stocks (from combo orders) and updated combo availability. Single SKU stocks restored by WC."

---

## Stock Flow Summary

| SKU | Processing | Cancellation | Net Change |
|-----|-----------|--------------|------------|
| `iqn100/4tab` | 150 → 149 (WC) | 149 → 150 (WC) | 0 (restored) |
| `tad5/10tab` | 87 → 84 (HIS) | 84 → 87 (HIS) | 0 (restored) |
| `kom/spu+iqn100` | → 8 | → 9 | +1 (recalculated) |
| `tad5/30tab` | → 28 | → 29 | +1 (recalculated) |

**Result:** All stocks are fully restored to their original levels before the order was processed.

