# WooCommerce API and Webhooks Documentation

This document provides a comprehensive overview of WooCommerce REST API endpoints and webhook topics, including what's currently implemented in this project.

## Table of Contents

1. [WooCommerce REST API](#woocommerce-rest-api)
2. [WooCommerce Webhooks](#woocommerce-webhooks)
3. [Current Implementation Status](#current-implementation-status)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Webhook Topics Reference](#webhook-topics-reference)

---

## WooCommerce REST API

WooCommerce provides a comprehensive REST API (v3) that allows you to interact with your store programmatically.

### Base URL

```
https://your-store.com/wp-json/wc/v3
```

### Authentication

- **Method:** HTTP Basic Authentication
- **Credentials:** Consumer Key and Consumer Secret
- **Header:** `Authorization: Basic base64(consumer_key:consumer_secret)`

### API Version

- **Current Version:** v3
- **Endpoint Format:** `/wp-json/wc/v3/{resource}`

---

## WooCommerce REST API Endpoints

### 1. Products

#### Get Products
- **Endpoint:** `GET /products`
- **Status:** ✅ Implemented
- **Used in:** `lib/services/woocommerce/client.ts`
- **Query Parameters:**
  - `page` - Page number
  - `per_page` - Items per page (max 100)
  - `status` - Product status (draft, pending, private, publish)
  - `featured` - Filter featured products (true/false)
  - `category` - Filter by category ID
  - `search` - Search products by keyword
  - `orderby` - Sort by (date, id, include, title, slug, price, popularity, rating)
  - `order` - Sort order (asc, desc)

#### Get Single Product
- **Endpoint:** `GET /products/{id}`
- **Status:** ✅ Implemented
- **Used in:** `lib/services/woocommerce/client.ts`

#### Create Product
- **Endpoint:** `POST /products`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Update Product
- **Endpoint:** `PUT /products/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Delete Product
- **Endpoint:** `DELETE /products/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

### 2. Orders

#### Get Orders
- **Endpoint:** `GET /orders`
- **Status:** ✅ Implemented
- **Used in:** 
  - `lib/services/woocommerce/client.ts`
  - `app/api/dashboard/live-events/route.ts` (for live feed)
- **Query Parameters:**
  - `page` - Page number
  - `per_page` - Items per page (max 100)
  - `status` - Order status (pending, processing, on-hold, completed, cancelled, refunded, failed)
  - `customer` - Filter by customer ID
  - `product` - Filter by product ID
  - `date_after` - Filter orders after date (ISO 8601)
  - `date_before` - Filter orders before date (ISO 8601)
  - `orderby` - Sort by (date, id, include, title, status)
  - `order` - Sort order (asc, desc)

#### Get Single Order
- **Endpoint:** `GET /orders/{id}`
- **Status:** ✅ Implemented
- **Used in:** `lib/services/woocommerce/client.ts`

#### Create Order
- **Endpoint:** `POST /orders`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Update Order
- **Endpoint:** `PUT /orders/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Delete Order
- **Endpoint:** `DELETE /orders/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

### 3. Customers

#### Get Customers
- **Endpoint:** `GET /customers`
- **Status:** ✅ Implemented
- **Used in:**
  - `lib/services/woocommerce/client.ts`
  - `app/api/dashboard/live-events/route.ts` (for registrations)
- **Query Parameters:**
  - `page` - Page number
  - `per_page` - Items per page (max 100)
  - `email` - Filter by email
  - `role` - Filter by role (customer, subscriber, etc.)
  - `search` - Search customers

#### Get Single Customer
- **Endpoint:** `GET /customers/{id}`
- **Status:** ✅ Implemented
- **Used in:** `lib/services/woocommerce/client.ts`

#### Create Customer
- **Endpoint:** `POST /customers`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Update Customer
- **Endpoint:** `PUT /customers/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

#### Delete Customer
- **Endpoint:** `DELETE /customers/{id}`
- **Status:** ❌ Not Implemented
- **Available:** Yes

### 4. Reports

#### Sales Report
- **Endpoint:** `GET /reports/sales`
- **Status:** ✅ Implemented
- **Used in:** `lib/services/woocommerce/client.ts`
- **Query Parameters:**
  - `period` - Time period (day, week, month, year)
  - `date_after` - Filter after date (ISO 8601)
  - `date_before` - Filter before date (ISO 8601)

### 5. Other Available Endpoints (Not Implemented)

#### Coupons
- `GET /coupons` - List coupons
- `GET /coupons/{id}` - Get single coupon
- `POST /coupons` - Create coupon
- `PUT /coupons/{id}` - Update coupon
- `DELETE /coupons/{id}` - Delete coupon

#### Product Variations
- `GET /products/{product_id}/variations` - List variations
- `GET /products/{product_id}/variations/{id}` - Get single variation
- `POST /products/{product_id}/variations` - Create variation
- `PUT /products/{product_id}/variations/{id}` - Update variation
- `DELETE /products/{product_id}/variations/{id}` - Delete variation

#### Product Categories
- `GET /products/categories` - List categories
- `GET /products/categories/{id}` - Get single category
- `POST /products/categories` - Create category
- `PUT /products/categories/{id}` - Update category
- `DELETE /products/categories/{id}` - Delete category

#### Product Tags
- `GET /products/tags` - List tags
- `GET /products/tags/{id}` - Get single tag
- `POST /products/tags` - Create tag
- `PUT /products/tags/{id}` - Update tag
- `DELETE /products/tags/{id}` - Delete tag

#### Product Attributes
- `GET /products/attributes` - List attributes
- `GET /products/attributes/{id}` - Get single attribute
- `POST /products/attributes` - Create attribute
- `PUT /products/attributes/{id}` - Update attribute
- `DELETE /products/attributes/{id}` - Delete attribute

#### Product Reviews
- `GET /products/reviews` - List reviews
- `GET /products/reviews/{id}` - Get single review
- `POST /products/reviews` - Create review
- `PUT /products/reviews/{id}` - Update review
- `DELETE /products/reviews/{id}` - Delete review

#### Shipping Zones
- `GET /shipping/zones` - List shipping zones
- `GET /shipping/zones/{id}` - Get single zone
- `POST /shipping/zones` - Create zone
- `PUT /shipping/zones/{id}` - Update zone
- `DELETE /shipping/zones/{id}` - Delete zone

#### Tax Rates
- `GET /taxes` - List tax rates
- `GET /taxes/{id}` - Get single tax rate
- `POST /taxes` - Create tax rate
- `PUT /taxes/{id}` - Update tax rate
- `DELETE /taxes/{id}` - Delete tax rate

#### Payment Gateways
- `GET /payment_gateways` - List payment gateways
- `GET /payment_gateways/{id}` - Get single gateway
- `PUT /payment_gateways/{id}` - Update gateway settings

#### Settings
- `GET /settings` - List settings
- `GET /settings/{group_id}` - Get settings group
- `GET /settings/{group_id}/{id}` - Get single setting
- `PUT /settings/{group_id}/{id}` - Update setting

#### System Status
- `GET /system_status` - Get system status
- `GET /system_status/tools` - List system tools

---

## WooCommerce Webhooks

Webhooks allow WooCommerce to send real-time notifications to external URLs when events occur in your store.

### Webhook Configuration

- **Location:** WooCommerce → Settings → Advanced → Webhooks
- **Delivery URL:** Your endpoint URL (e.g., `https://your-dashboard.com/api/webhooks/events`)
- **Secret:** Optional security token
- **Status:** Active/Inactive
- **API Version:** WP REST API Integration v3

### Webhook Topics (Event Types)

#### Order Events

##### Order Created
- **Topic:** `order.created`
- **Status:** ✅ Implemented
- **Triggered When:** New order is placed
- **Payload:** Full order object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `order_created` or `booking` (if consultation detected)

##### Order Updated
- **Topic:** `order.updated`
- **Status:** ✅ Implemented
- **Triggered When:** Order status or details change
- **Payload:** Updated order object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `order_updated`

##### Order Deleted
- **Topic:** `order.deleted`
- **Status:** ✅ Implemented
- **Triggered When:** Order is permanently deleted
- **Payload:** Deleted order object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `order_deleted`

##### Order Restored
- **Topic:** `order.restored`
- **Status:** ✅ Implemented
- **Triggered When:** Deleted order is restored
- **Payload:** Restored order object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `order_restored`

#### Customer Events

##### Customer Created
- **Topic:** `customer.created`
- **Status:** ✅ Implemented
- **Triggered When:** New customer account is created
- **Payload:** Full customer object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `customer_registration`

##### Customer Updated
- **Topic:** `customer.updated`
- **Status:** ✅ Implemented
- **Triggered When:** Customer information is updated
- **Payload:** Updated customer object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `customer_updated`

##### Customer Deleted
- **Topic:** `customer.deleted`
- **Status:** ✅ Implemented
- **Triggered When:** Customer account is deleted
- **Payload:** Deleted customer object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `customer_deleted`

#### Product Events

##### Product Created
- **Topic:** `product.created`
- **Status:** ✅ Implemented
- **Triggered When:** New product is added
- **Payload:** Full product object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `product_created`

##### Product Updated
- **Topic:** `product.updated`
- **Status:** ✅ Implemented
- **Triggered When:** Product information is updated
- **Payload:** Updated product object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `product_updated`

##### Product Deleted
- **Topic:** `product.deleted`
- **Status:** ✅ Implemented
- **Triggered When:** Product is deleted
- **Payload:** Deleted product object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `product_deleted`

#### Coupon Events

##### Coupon Created
- **Topic:** `coupon.created`
- **Status:** ✅ Implemented
- **Triggered When:** New coupon is created
- **Payload:** Full coupon object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `coupon_created`

##### Coupon Updated
- **Topic:** `coupon.updated`
- **Status:** ✅ Implemented
- **Triggered When:** Coupon is updated
- **Payload:** Updated coupon object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `coupon_updated`

##### Coupon Deleted
- **Topic:** `coupon.deleted`
- **Status:** ✅ Implemented
- **Triggered When:** Coupon is deleted
- **Payload:** Deleted coupon object
- **Used in:** `app/api/webhooks/events/route.ts`
- **Mapped to:** `coupon_deleted`

### Custom Webhook Actions (Not Native WooCommerce)

#### Add to Cart
- **Action:** `added_to_cart`
- **Status:** ⚠️ Requires Custom Plugin
- **Triggered When:** Product is added to cart
- **Payload:** Custom format (product, customer, quantity)
- **Note:** Not a native WooCommerce webhook. Requires custom plugin or code.
- **See:** `docs/WOOCOMMERCE_ADD_TO_CART_PLUGIN.md`

---

## Current Implementation Status

### API Endpoints Currently Used

| Endpoint | Method | Status | Used For |
|----------|--------|--------|----------|
| `/products` | GET | ✅ | Product listing, connection test |
| `/products/{id}` | GET | ✅ | Single product details |
| `/orders` | GET | ✅ | Order listing, live feed |
| `/orders/{id}` | GET | ✅ | Single order details |
| `/customers` | GET | ✅ | Customer listing, registrations |
| `/customers/{id}` | GET | ✅ | Single customer details |
| `/reports/sales` | GET | ✅ | Sales reporting |

### Webhook Topics Currently Handled

| Webhook Topic | Status | Mapped Event Type | Used In |
|---------------|--------|-------------------|---------|
| `order.created` | ✅ | `order_created` / `booking` | Live feed |
| `order.updated` | ✅ | `order_updated` | Live feed |
| `order.deleted` | ✅ | `order_deleted` | Live feed |
| `order.restored` | ✅ | `order_restored` | Live feed |
| `customer.created` | ✅ | `customer_registration` | Live feed |
| `customer.updated` | ✅ | `customer_updated` | Live feed |
| `customer.deleted` | ✅ | `customer_deleted` | Live feed |
| `product.created` | ✅ | `product_created` | Live feed |
| `product.updated` | ✅ | `product_updated` | Live feed |
| `product.deleted` | ✅ | `product_deleted` | Live feed |
| `coupon.created` | ✅ | `coupon_created` | Live feed |
| `coupon.updated` | ✅ | `coupon_updated` | Live feed |
| `coupon.deleted` | ✅ | `coupon_deleted` | Live feed |
| `added_to_cart` | ⚠️ | `add_to_cart` | Live feed (custom) |

### Not Currently Used

#### API Endpoints
- All POST/PUT/DELETE methods (read-only access)
- Coupons API
- Product variations, categories, tags, attributes
- Product reviews
- Shipping zones
- Tax rates
- Payment gateways
- Settings
- System status

#### Webhook Topics
- None (all standard webhooks are handled)

---

## API Endpoints Reference

### Our API Wrapper

**Base URL:** `/api/woocommerce`

**Query Parameters:**
- `resource` - Resource type (products, orders, customers, sales, test)
- `id` - Resource ID (for single item requests)
- `page` - Page number
- `per_page` - Items per page
- `status` - Filter by status
- `date_after` - Filter after date (ISO format)
- `date_before` - Filter before date (ISO format)
- `email` - Filter customers by email
- `role` - Filter customers by role
- `search` - Search term
- `period` - Time period for sales report (day, week, month, year)

**Examples:**
```bash
# Get products
GET /api/woocommerce?resource=products&per_page=10

# Get single product
GET /api/woocommerce?resource=products&id=123

# Get orders from last 30 days
GET /api/woocommerce?resource=orders&date_after=2024-01-01T00:00:00

# Get customers
GET /api/woocommerce?resource=customers&per_page=50

# Get sales report
GET /api/woocommerce?resource=sales&period=month

# Test connection
GET /api/woocommerce?resource=test
```

---

## Webhook Topics Reference

### Our Webhook Endpoint

**URL:** `/api/webhooks/events`

**Method:** `POST`

**Headers:**
- `Content-Type: application/json`
- `x-wc-webhook-topic` - Webhook topic (e.g., `order.created`)
- `x-wc-webhook-event` - Alternative header for topic

**Payload:** Varies by webhook topic (order object, customer object, etc.)

**Response:**
```json
{
  "success": true,
  "eventId": "webhook-1234567890-abc123",
  "eventType": "order_created"
}
```

### Webhook Topic Format

WooCommerce webhook topics follow this pattern:
```
{resource}.{action}
```

Examples:
- `order.created`
- `customer.updated`
- `product.deleted`

### Webhook Payload Structure

#### Order Webhook Payload
```json
{
  "id": 123,
  "status": "processing",
  "date_created": "2024-01-01T00:00:00",
  "total": "100.00",
  "currency": "MYR",
  "billing": {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com"
  },
  "line_items": [
    {
      "id": 456,
      "name": "Product Name",
      "quantity": 1,
      "price": "100.00"
    }
  ]
}
```

#### Customer Webhook Payload
```json
{
  "id": 789,
  "email": "customer@example.com",
  "first_name": "Jane",
  "last_name": "Smith",
  "username": "janesmith",
  "date_created": "2024-01-01T00:00:00"
}
```

#### Product Webhook Payload
```json
{
  "id": 321,
  "name": "Product Name",
  "price": "50.00",
  "status": "publish",
  "date_created": "2024-01-01T00:00:00"
}
```

---

## Rate Limits

WooCommerce REST API has rate limits based on your plan:

- **Free/Starter:** ~100 requests per minute
- **Business:** ~500 requests per minute
- **Enterprise:** Custom limits

**Best Practices:**
- Use pagination for large datasets
- Cache responses when possible
- Use webhooks for real-time updates instead of polling
- Implement exponential backoff for retries

---

## Security Considerations

1. **API Credentials:**
   - Store Consumer Key and Secret securely
   - Use environment variables (never commit to git)
   - Rotate credentials periodically

2. **Webhook Security:**
   - Use webhook secrets for verification
   - Validate webhook signatures
   - Use HTTPS for webhook delivery URLs
   - Implement rate limiting on webhook endpoint

3. **Permissions:**
   - Use Read/Write keys only when necessary
   - Prefer Read-only keys for dashboards
   - Limit API access to specific IPs if possible

---

## Related Documentation

- [WooCommerce Webhook Setup Guide](./WOOCOMMERCE_WEBHOOK_SETUP.md)
- [WooCommerce Webhook Quick Setup](./WOOCOMMERCE_WEBHOOK_QUICK_SETUP.md)
- [Add to Cart Plugin Guide](./WOOCOMMERCE_ADD_TO_CART_PLUGIN.md)
- [Environment Variables](./ENV_VARIABLES.md)

---

## Official WooCommerce Documentation

- [WooCommerce REST API Reference](https://woocommerce.github.io/woocommerce-rest-api-docs/)
- [WooCommerce Webhooks Documentation](https://woocommerce.com/document/webhooks/)

---

**Last Updated:** 2024-12-08  
**WooCommerce API Version:** v3  
**Project Status:** Read-only API access, Full webhook support





