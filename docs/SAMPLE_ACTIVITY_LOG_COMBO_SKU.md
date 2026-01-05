# Sample Activity Log Record - WooCommerce Tab

## Scenario
Order #12345 with combo SKU "kom/tad5(30tab)+tad20(4tab)" (quantity: 1)

## Database Record (wc_webhook_logs table)

```json
{
  "id": 1234,
  "webhook_type": "order",
  "webhook_event": "order.processing",
  "entity_id": 12345,
  "entity_sku": "kom/tad5(30tab)+tad20(4tab)",
  "entity_name": "Order #12345",
  "status": "processing",
  "stock_quantity": null,
  "previous_stock_quantity": null,
  "affected_skus": ["kom/tad5(30tab)+tad20(4tab)"],
  "combo_updates": [
    {
      "sku": "kom/tad5(30tab)+tad20(4tab)",
      "newStock": 5
    }
  ],
  "details": {
    "orderId": 12345,
    "status": "processing",
    "lineItems": [
      {
        "sku": "kom/tad5(30tab)+tad20(4tab)",
        "name": "KOMBO Ekstra Pil Harian 5mg + Pil Hujung Minggu 20mg",
        "quantity": 1
      }
    ],
    "comboSkusOrdered": [
      {
        "sku": "kom/tad5(30tab)+tad20(4tab)",
        "quantity": 1
      }
    ],
    "componentDeductions": [
      {
        "sku": "tad5/10tab",
        "previousStock": 87,
        "newStock": 84,
        "deductedQty": 3,
        "isWcSide": false
      },
      {
        "sku": "tad20/4tab",
        "previousStock": 220,
        "newStock": 219,
        "deductedQty": 1,
        "isWcSide": false
      }
    ],
    "affectedSingleSkus": ["tad5/10tab", "tad20/4tab"],
    "note": "Combo SKU(s) ordered. System deducted component single SKU stocks and updated combo availability."
  },
  "ip_address": "192.168.1.100",
  "user_agent": "WooCommerce/8.0.0",
  "success": true,
  "error_message": null,
  "created_at": "2026-01-15T14:30:25+08:00"
}
```

## Display in Activity Log > WooCommerce Tab

| Column | Value |
|--------|-------|
| **Time** | 2026-01-15 14:30:25 |
| **Type** | order |
| **Event** | Processing |
| **Entity** | Order #12345<br>processing |
| **SKU** | kom/tad5(30tab)+tad20(4tab) |
| **Component Deductions** | tad5/10tab: 87 → 84<br>tad20/4tab: 220 → 219 |
| **Combo Updates** | kom/tad5(30tab)+tad20(4tab): → 5 |
| **Status** | ✅ Success |

## Key Points

1. **Combo SKU is single string**: "kom/tad5(30tab)+tad20(4tab)" is stored as one SKU string (not split)

2. **Component Deductions**:
   - **tad5/10tab**: Deducted 3 units (87 → 84) - **No (WC) label** (HIS-side)
   - **tad20/4tab**: Deducted 1 unit (220 → 219) - **No (WC) label** (HIS-side)
   - Both components are marked as `isWcSide: false` because WooCommerce does NOT deduct component stocks for combo SKUs

3. **Combo Updates**: The combo SKU availability was recalculated and updated to 5 units

4. **Note**: The system note indicates "Combo SKU(s) ordered. System deducted component single SKU stocks..."

## Component Breakdown

For combo SKU "kom/tad5(30tab)+tad20(4tab)" (from database):
- Component 1: `tad5/10tab` × 3 = 3 units deducted
- Component 2: `tad20/4tab` × 1 = 1 unit deducted

Both components are deducted by HIS system, not WooCommerce.

