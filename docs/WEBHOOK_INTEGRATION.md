# Webhook Integration

## Overview

The system receives webhooks from WooCommerce for order and product updates. All webhooks are verified using HMAC SHA256 signatures before processing.

## Webhook Security

### Signature Verification

All webhooks must include a valid HMAC SHA256 signature in the `X-WC-Webhook-Signature` header.

**Verification Process:**
1. Extract signature from `X-WC-Webhook-Signature` header
2. Calculate HMAC SHA256 of request body using `WOOCOMMERCE_WEBHOOK_SECRET`
3. Compare calculated signature with received signature
4. Reject if signatures don't match

**Implementation:**
```typescript
const signature = request.headers.get('X-WC-Webhook-Signature');
const calculatedSignature = crypto
  .createHmac('sha256', process.env.WOOCOMMERCE_WEBHOOK_SECRET!)
  .update(body)
  .digest('hex');

if (signature !== calculatedSignature) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
}
```

## Order Webhooks

### `order.pending-consult`

Triggered when an order requires consultation.

**Stock Updates:**
- Increments `pending_consult` count
- Updates `available_for_purchase` (recalculated)
- Updates `backorder` if `available_for_purchase = 0`
- Creates `stock_transaction` record

**Webhook Payload:**
```json
{
  "id": 1001,
  "status": "pending-consult",
  "line_items": [
    {
      "sku": "SKU-001",
      "quantity": 2
    }
  ]
}
```

### `order.pending-review`

Triggered when an order requires review.

**Stock Updates:**
- Increments `pending_review` count
- Updates `available_for_purchase` (recalculated)
- Updates `backorder` if `available_for_purchase = 0`
- Creates `stock_transaction` record

### `order.processing`

Triggered when an order moves to processing status.

**Stock Updates:**
- If order was in `pending-consult` or `pending-review`:
  - Decrements from pending status
  - Increments `processing` count
- If order goes directly to processing:
  - Increments `processing` count
- Updates `available_for_purchase` (recalculated)
- Updates `backorder` if `available_for_purchase = 0`
- **Does NOT** deduct from `in_warehouse`
- Creates `stock_transaction` record

**Important:** This is the key difference from the old system. Processing no longer deducts from `in_warehouse`.

### `order.nv-pending-pickup`

Triggered when an order is ready for pickup/delivery.

**Stock Updates:**
- Deducts from `in_warehouse`
- Deducts from previous status (`processing`, `pending_consult`, or `pending_review`)
- Updates `available_for_purchase` (recalculated)
- Creates `stock_transaction` record

**This is the ONLY webhook that deducts from `in_warehouse`.**

### `order.cancelled`

Triggered when an order is cancelled.

**Stock Updates:**
- If order was in `nv-pending-pickup` or `processing` (created after 2026-01-01):
  - Restores to `in_warehouse`
- Removes from current status (`processing`, `pending_consult`, or `pending_review`)
- Updates `available_for_purchase` (recalculated)
- Deducts from `backorder` if stock was restored
- Creates `stock_transaction` record

### `order.refunded`

Similar to `order.cancelled`, restores stock if applicable.

## Product Webhooks

### `product.updated`

Triggered when a product is updated in WooCommerce.

**Actions:**
- Logs the update to `wc_webhook_logs`
- Does not change stock (stock is managed by HIS system)

## Webhook Processing Flow

```
1. Webhook Received
   ↓
2. Verify HMAC Signature
   ↓
3. Parse Webhook Payload
   ↓
4. Determine Order Status
   ↓
5. Get Current Stock State
   ↓
6. Calculate New Stock State
   ↓
7. Create Stock Transaction
   ↓
8. Log to wc_webhook_logs
   ↓
9. Return Success Response
```

## Idempotency

Webhooks are processed idempotently by:
- Checking if a webhook with the same `entity_id` and `webhook_event` was recently processed
- Using transaction timestamps to prevent duplicate processing
- Logging all webhook events for audit purposes

## Error Handling

### Webhook Logging Failure

If webhook processing succeeds but logging fails:
- Stock changes remain (not rolled back)
- Error is logged to `activity_logs` with action `webhook_log_failed_after_stock_deduction`
- Manual reconciliation may be required

### Invalid Webhook

If webhook signature is invalid:
- Request is rejected with 401 status
- No stock changes are made
- Error is logged

### Processing Error

If webhook processing fails:
- Error is logged to `wc_webhook_logs` with `success: false`
- Stock changes are rolled back (if transaction was started)
- Error message is returned

## Webhook Configuration in WooCommerce

### Required Webhooks

1. **Order Updated**
   - URL: `https://your-domain.com/api/webhooks/orders`
   - Event: `Order updated`
   - Secret: Set `WOOCOMMERCE_WEBHOOK_SECRET` in `.env.local`

2. **Product Updated** (optional)
   - URL: `https://your-domain.com/api/webhooks/products`
   - Event: `Product updated`
   - Secret: Same as above

### Webhook Delivery

- Webhooks are delivered via HTTP POST
- WooCommerce retries failed deliveries
- System should handle duplicate webhooks gracefully

## Testing Webhooks

### Local Development

Use tools like:
- [ngrok](https://ngrok.com/) to expose local server
- [RequestBin](https://requestbin.com/) to inspect webhook payloads
- Postman to simulate webhook requests

### Webhook Payload Inspection

All webhook payloads are stored in `wc_webhook_logs.details` as JSONB for inspection.

## Related Documentation

- [Order Status System](./ORDER_STATUS_SYSTEM.md) - Status definitions
- [Stock Management Flow](./STOCK_MANAGEMENT_FLOW.md) - Flow diagrams
- [API Reference](./API_REFERENCE.md) - API endpoints
