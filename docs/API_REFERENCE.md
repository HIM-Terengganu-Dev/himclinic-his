# API Reference

## Base URL

All API endpoints are prefixed with `/api`.

## Authentication

Most endpoints require authentication via NextAuth.js session. Admin-only endpoints require `role: 'admin'`.

## Inventory Endpoints

### GET `/api/inventory`

Fetch current inventory for all SKUs with all 6 statuses.

**Response:**
```json
{
  "inventory": {
    "SKU-001": {
      "inWarehouse": 100,
      "availableForPurchase": 85,
      "processing": 5,
      "pendingConsult": 5,
      "pendingReview": 5,
      "backorder": 0
    }
  },
  "comboAvailability": [
    {
      "sku": "COMBO-001",
      "name": "Combo Product",
      "available": 10,
      "components": [
        { "sku": "SKU-001", "required": 2, "available": 42 }
      ]
    }
  ]
}
```

### POST `/api/procurement/update`

Manual stock update (add, subtract, or set).

**Request Body:**
```json
{
  "sku": "SKU-001",
  "operation": "add", // "add", "subtract", or "set"
  "quantity": 10,
  "notes": "Stock received from supplier"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Stock updated successfully",
  "previousStock": 100,
  "newStock": 110
}
```

**Status Updates:**
- `add`: Increases `in_warehouse`, deducts from `backorder` if present
- `subtract`: Decreases `in_warehouse`
- `set`: Sets `in_warehouse` to exact value

### POST `/api/stock/update`

Update stock for a single SKU (legacy endpoint).

**Request Body:**
```json
{
  "sku": "SKU-001",
  "quantity": 100
}
```

## Order Endpoints

### GET `/api/orders/[orderId]/component-deductions`

Get detailed component deduction information for an order.

**Response:**
```json
{
  "success": true,
  "componentDeductions": [
    {
      "sku": "SKU-001",
      "inWarehouseBefore": 100,
      "inWarehouseAfter": 95,
      "availableForPurchaseBefore": 85,
      "availableForPurchaseAfter": 80,
      "processingBefore": 5,
      "processingAfter": 10,
      "pendingConsultBefore": 5,
      "pendingConsultAfter": 5,
      "pendingReviewBefore": 5,
      "pendingReviewAfter": 5,
      "backorderBefore": 0,
      "backorderAfter": 0
    }
  ]
}
```

## SKU Endpoints

### GET `/api/skus/single`

List all single SKUs.

**Response:**
```json
{
  "skus": [
    {
      "id": 1,
      "sku": "SKU-001",
      "name": "Product Name",
      "description": "Product description",
      "wc_product_id": 12345
    }
  ]
}
```

### POST `/api/skus/single`

Create a new single SKU.

**Request Body:**
```json
{
  "sku": "SKU-001",
  "name": "Product Name",
  "description": "Product description",
  "wc_product_id": 12345
}
```

### PUT `/api/skus/single`

Update an existing single SKU.

**Request Body:**
```json
{
  "id": 1,
  "sku": "SKU-001",
  "name": "Updated Name",
  "description": "Updated description",
  "wc_product_id": 12345
}
```

### GET `/api/skus/combo`

List all combo SKUs.

**Response:**
```json
{
  "skus": [
    {
      "id": 1,
      "sku": "COMBO-001",
      "name": "Combo Product",
      "description": "Combo description",
      "wc_product_id": 12346,
      "components": [
        { "sku": "SKU-001", "quantity": 2 },
        { "sku": "SKU-002", "quantity": 1 }
      ]
    }
  ]
}
```

### POST `/api/skus/combo`

Create a new combo SKU.

**Request Body:**
```json
{
  "sku": "COMBO-001",
  "name": "Combo Product",
  "description": "Combo description",
  "wc_product_id": 12346,
  "components": [
    { "sku": "SKU-001", "quantity": 2 },
    { "sku": "SKU-002", "quantity": 1 }
  ]
}
```

### PUT `/api/skus/combo`

Update an existing combo SKU.

**Request Body:**
```json
{
  "id": 1,
  "sku": "COMBO-001",
  "name": "Updated Combo",
  "components": [
    { "sku": "SKU-001", "quantity": 3 }
  ]
}
```

## Activity Log Endpoints

### GET `/api/activity-logs`

Fetch HIS System activity logs (manual changes).

**Query Parameters:**
- `limit`: Number of logs to return (default: 20)
- `offset`: Pagination offset
- `type`: Filter by action type
- `sku`: Filter by SKU
- `dateFrom`: Start date (ISO format)
- `dateTo`: End date (ISO format)

**Response:**
```json
{
  "logs": [
    {
      "id": 1,
      "user_name": "John Doe",
      "user_email": "john@example.com",
      "action": "procurement_update",
      "affected_sku": "SKU-001",
      "details": {
        "operation": "add",
        "quantity": 10
      },
      "success": true,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 100
}
```

### GET `/api/webhook-logs`

Fetch WooCommerce webhook logs.

**Query Parameters:**
- `limit`: Number of logs to return (default: 20)
- `offset`: Pagination offset
- `type`: Filter by webhook type ('order' or 'product')
- `sku`: Filter by SKU
- `orderStatus`: Filter by order status
- `dateFrom`: Start date (ISO format)
- `dateTo`: End date (ISO format)

**Response:**
```json
{
  "logs": [
    {
      "id": 1,
      "webhook_type": "order",
      "webhook_event": "order.processing",
      "entity_id": 1001,
      "entity_sku": "COMBO-001",
      "status": "processing",
      "current_status": "processing",
      "affected_skus": ["SKU-001", "SKU-002"],
      "combo_updates": [
        {
          "sku": "SKU-001",
          "newStock": 95
        }
      ],
      "success": true,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ],
  "total": 500
}
```

## Webhook Endpoints

### POST `/api/webhooks/orders`

Handle WooCommerce order webhooks.

**Headers:**
- `X-WC-Webhook-Source`: WooCommerce webhook source
- `X-WC-Webhook-Signature`: HMAC SHA256 signature

**Request Body:**
WooCommerce order webhook payload.

**Supported Events:**
- `order.pending-consult`
- `order.pending-review`
- `order.processing`
- `order.nv-pending-pickup`
- `order.cancelled`
- `order.refunded`

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

### POST `/api/webhooks/products`

Handle WooCommerce product webhooks.

**Headers:**
- `X-WC-Webhook-Source`: WooCommerce webhook source
- `X-WC-Webhook-Signature`: HMAC SHA256 signature

**Request Body:**
WooCommerce product webhook payload.

## Refund/Return Endpoint

### POST `/api/refund-return`

Process refund/return for an order.

**Request Body:**
```json
{
  "orderId": 1001,
  "sku": "SKU-001",
  "quantity": 1,
  "reason": "Customer return"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Refund processed successfully",
  "stockRestored": true
}
```

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error message",
  "details": {}
}
```

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Internal Server Error

## Rate Limiting

Currently no rate limiting is implemented. Consider adding rate limiting for production use.

## Related Documentation

- [Webhook Integration](./WEBHOOK_INTEGRATION.md) - Webhook handling details
- [Order Status System](./ORDER_STATUS_SYSTEM.md) - Status definitions
- [Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md) - Flow diagrams
