# Sample Activity Log Record - WooCommerce Tab

## Scenario
Order #12346 with mixed SKUs: "iqn100/4tab" (quantity: 2) - single SKU, and "tad5/30tab" (quantity: 1) - combo SKU

**Note:** 
- `iqn100/4tab` is a **single SKU** (WC deducts automatically)
- `tad5/30tab` is a **combo SKU** (HIS deducts components: 3x `tad5/10tab`)
- These are separate line items in the order (comma-separated in display, but actually separate line items in WooCommerce).

## Database Record (wc_webhook_logs table)

```json
{
  "id": 1235,
  "webhook_type": "order",
  "webhook_event": "order.processing",
  "entity_id": 12346,
  "entity_sku": "iqn100/4tab",
  "entity_name": "Order #12346",
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
    "orderId": 12346,
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
  "created_at": "2026-01-15T15:45:10+08:00"
}
```

## Display in Activity Log > WooCommerce Tab

| Column | Value |
|--------|-------|
| **Time** | 2026-01-15 15:45:10 |
| **Type** | order |
| **Event** | Processing |
| **Entity** | Order #12346<br>processing |
| **SKU** | iqn100/4tab,<br>tad5/30tab |
| **Component Deductions** | iqn100/4tab: 150 → 149 (WC)<br>tad5/10tab: 87 → 84 |
| **Combo Updates** | kom/spu+iqn100: → 8<br>tad5/30tab: → 28 |
| **Status** | ✅ Success |

## Key Points

1. **Mixed SKU Types**: This order contains:
   - `iqn100/4tab` (quantity: 2) - **Single SKU** ✅
   - `tad5/30tab` (quantity: 1) - **Combo SKU** (contains 3x `tad5/10tab`)

2. **Component Deductions** (Mixed WC-side and HIS-side):
   - **iqn100/4tab**: Deducted 1 unit (150 → 149) - **Has (WC) label** (WC-side, `isWcSide: true`)
     - WooCommerce automatically deducted this single SKU (quantity: 1 in order)
   - **tad5/10tab**: Deducted 3 units (87 → 84) - **No (WC) label** (HIS-side, `isWcSide: false`)
     - This is the component of combo SKU `tad5/30tab`
     - HIS deducted it because WooCommerce does NOT deduct component stocks for combo SKUs

3. **Combo Updates**: After processing, the system recalculated and updated combo SKUs:
   - `kom/spu+iqn100` → 8 units (affected by `iqn100/4tab` deduction)
   - `tad5/30tab` → 28 units (recalculated after `tad5/10tab` component deduction)

4. **Note**: The system note indicates "Combo SKU(s) ordered. System deducted component single SKU stocks and updated combo availability."

5. **Combo SKU Ordered**: `comboSkusOrdered` contains `tad5/30tab` because it's a combo SKU that was ordered.

## Component Breakdown

For combo SKU "tad5/30tab" (from database):
- Component: `tad5/10tab` × 3 = 3 units deducted by HIS

## Comparison with Different Order Types

| Aspect | Pure Combo Order | Mixed Order (Single + Combo) | Pure Single SKU Order |
|--------|------------------|------------------------------|----------------------|
| **Example** | "kom/tad5(30tab)+tad20(4tab)" | "iqn100/4tab, tad5/30tab" | "iqn100/4tab, tad20/4tab" |
| **WC Deduction** | ❌ No | ✅ Partial (single SKUs only) | ✅ Yes (all SKUs) |
| **HIS Deduction** | ✅ Yes (all components) | ✅ Yes (combo components only) | ❌ No (only tracks) |
| **Component Labels** | No "(WC)" labels | Mixed (WC for singles, no label for combo components) | All have "(WC)" labels |
| **isWcSide** | All `false` | Mixed (`true` for singles, `false` for combo components) | All `true` |

