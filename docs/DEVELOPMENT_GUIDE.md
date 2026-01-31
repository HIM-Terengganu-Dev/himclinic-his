# Development Guide

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Neon recommended)
- WooCommerce store with API access
- Google OAuth credentials

## Setup

### 1. Clone Repository

```bash
git clone https://github.com/HIM-Terengganu-Dev/himclinic-his.git
cd telehealth-inventory-management-system
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create `.env.local` file:

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/database
DATABASE_URL_DDL=postgresql://user:password@host:port/database

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-here

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# WooCommerce
WOOCOMMERCE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=your-consumer-key
WOOCOMMERCE_CONSUMER_SECRET=your-consumer-secret
WOOCOMMERCE_WEBHOOK_SECRET=your-webhook-secret
```

### 4. Database Setup

Run the migration script:

```bash
node database/run_order_status_overhaul_migration.js
```

Or manually run SQL migrations from `database/` folder.

### 5. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

## Development Workflow

### Making Changes

1. Create a feature branch
2. Make changes
3. Test locally
4. Run build: `npm run build`
5. Commit and push
6. Create pull request

### Code Style

- TypeScript for type safety
- ESLint for linting
- Prettier for formatting (if configured)
- Follow existing code patterns

### Database Changes

1. Create migration SQL file in `database/`
2. Test migration on development database
3. Document changes in migration file
4. Run migration script
5. Update schema documentation

## Project Structure

### Key Directories

- `app/` - Next.js App Router pages and API routes
- `components/` - React components
- `lib/` - Utility libraries and services
- `database/` - Database migrations and scripts
- `docs/` - Documentation

### Key Files

- `lib/db/queries.ts` - All database operations
- `lib/services/woocommerce.ts` - WooCommerce API client
- `app/api/webhooks/orders/route.ts` - Order webhook handler
- `components/InventoryDashboard.tsx` - Main dashboard component

## Testing

### Manual Testing

1. Test webhook processing
2. Test manual stock updates
3. Test order status transitions
4. Test activity log filtering
5. Test SKU management

### Webhook Testing

Use tools like:
- ngrok for local webhook testing
- Postman for API testing
- WooCommerce webhook logs for verification

## Debugging

### Common Issues

1. **Database Connection**
   - Check `DATABASE_URL` in `.env.local`
   - Verify database is accessible
   - Check SSL settings

2. **Webhook Failures**
   - Verify `WOOCOMMERCE_WEBHOOK_SECRET` matches
   - Check webhook signature verification
   - Review webhook logs in database

3. **Stock Calculation Errors**
   - Check `stock_transactions` table
   - Verify status calculations
   - Review activity logs

### Debug Tools

- Database query tools (pgAdmin, DBeaver)
- Next.js dev tools
- Browser DevTools
- Server logs

## Deployment

### Build for Production

```bash
npm run build
npm start
```

### Environment Variables

Set all environment variables in production:
- Database URLs
- NextAuth secrets
- Google OAuth credentials
- WooCommerce API keys

### Database Migration

Run migrations before deployment:
```bash
node database/run_order_status_overhaul_migration.js
```

### Webhook Configuration

Update WooCommerce webhook URLs to production domain:
- `https://your-domain.com/api/webhooks/orders`
- `https://your-domain.com/api/webhooks/products`

## Performance Optimization

### Database

- Add indexes for frequently queried columns
- Use connection pooling
- Optimize queries with EXPLAIN ANALYZE

### Frontend

- Implement pagination for large lists
- Add loading states
- Optimize bundle size
- Use React.memo for expensive components

### API

- Add rate limiting
- Implement caching where appropriate
- Optimize database queries
- Use async/await properly

## Security

### Best Practices

- Never commit `.env.local`
- Use strong secrets
- Verify webhook signatures
- Sanitize user inputs
- Use parameterized queries
- Implement rate limiting
- Regular security updates

### Webhook Security

- Always verify HMAC signatures
- Reject invalid signatures
- Log all webhook attempts
- Monitor for suspicious activity

## Monitoring

### Logs

- Check `wc_webhook_logs` for webhook issues
- Check `activity_logs` for system activities
- Check `stock_transactions` for stock changes
- Monitor server logs for errors

### Metrics to Track

- Webhook processing time
- Stock calculation accuracy
- API response times
- Error rates
- User activity

## Troubleshooting

### Stock Discrepancies

1. Check `stock_transactions` for all changes
2. Verify webhook processing
3. Check for duplicate webhooks
4. Review activity logs
5. Compare with WooCommerce stock

### Webhook Not Processing

1. Verify webhook URL is accessible
2. Check signature verification
3. Review webhook logs
4. Check database connection
5. Verify webhook secret matches

### Performance Issues

1. Check database indexes
2. Review query performance
3. Check for N+1 queries
4. Monitor server resources
5. Review frontend bundle size

## Contributing

1. Follow code style guidelines
2. Write clear commit messages
3. Document new features
4. Test thoroughly
5. Update documentation

## Related Documentation

- [System Overview](./SYSTEM_OVERVIEW.md) - Architecture
- [Order Status System](./ORDER_STATUS_SYSTEM.md) - Status flow
- [API Reference](./API_REFERENCE.md) - API endpoints
- [Database Schema](./DATABASE_SCHEMA.md) - Database structure
