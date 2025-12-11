# Environment Variables Setup Guide

This guide explains how to set up all required environment variables for the Telehealth Inventory Management System.

## Quick Setup

1. **Copy the example file:**
   ```bash
   cp .env.local.example .env.local
   ```

2. **Fill in all values in `.env.local`**

3. **Restart your development server:**
   ```bash
   npm run dev
   ```

---

## Required Variables

### 1. WooCommerce API Credentials

Get these from your WooCommerce admin panel:

1. Go to **WooCommerce > Settings > Advanced > REST API**
2. Click **Add Key**
3. Give it a description (e.g., "Inventory System")
4. Set permissions to **Read/Write**
5. Click **Generate API Key**
6. Copy the **Consumer Key** and **Consumer Secret**

```env
WOOCOMMERCE_STORE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### 2. NextAuth Secret

Generate a secure random string:

**On Mac/Linux:**
```bash
openssl rand -base64 32
```

**On Windows (PowerShell):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

**Or use this online generator:**
https://generate-secret.vercel.app/32

```env
NEXTAUTH_SECRET=your-generated-secret-here
NEXTAUTH_URL=http://localhost:3000
```

> **Production:** Change `NEXTAUTH_URL` to your actual domain (e.g., `https://inventory.himclinic.com`)

---

### 3. Google OAuth Setup

#### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Google+ API** (if not already enabled)

#### Step 2: Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Web application**
4. Give it a name (e.g., "HIM Clinic Inventory")

#### Step 3: Add Authorized Redirect URIs

Add these URLs (both are needed):

**For Development:**
```
http://localhost:3000/api/auth/callback/google
```

**For Production:**
```
https://your-domain.com/api/auth/callback/google
```

#### Step 4: Copy Credentials

After creating, copy the **Client ID** and **Client Secret**:

```env
GOOGLE_CLIENT_ID=123456789-abc...xyz.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abc123...xyz789
```

---

### 4. Access Control (Email Whitelist)

#### Allowed Emails

Add all staff members who should have access to the system:

```env
ALLOWED_EMAILS=admin@himclinic.com,staff1@himclinic.com,staff2@himclinic.com
```

**Format:**
- Comma-separated list (no spaces)
- Use the exact Google account email addresses
- Anyone NOT on this list will see "Access Denied"

#### Admin Emails

Add emails for users who should have admin privileges:

```env
ADMIN_EMAILS=admin@himclinic.com
```

**Admin privileges include:**
- ✅ SKU Management tab
- ✅ Future admin-only features

**Regular staff can:**
- ✅ View inventory
- ✅ Update procurement stock
- ✅ View activity logs

---

## Example Configuration

Here's a complete example `.env.local` file:

```env
# WooCommerce
WOOCOMMERCE_STORE_URL=https://shop.himclinic.com
WOOCOMMERCE_CONSUMER_KEY=ck_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
WOOCOMMERCE_CONSUMER_SECRET=cs_9z8y7x6w5v4u3t2s1r0q9p8o7n6m5l4k

# NextAuth
NEXTAUTH_SECRET=kJ8h3F2d9L0mN4bV7cX1zQ5wE6rT8yU2iO0pA3sD7fG1hJ4kL9mN
NEXTAUTH_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=123456789-abc123def456ghi789jkl012mno345pqr.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz12

# Access Control
ALLOWED_EMAILS=admin@himclinic.com,dr.sarah@himclinic.com,nurse.john@himclinic.com
ADMIN_EMAILS=admin@himclinic.com
```

---

## Testing Your Setup

### 1. Check Environment Variables

Create a test page or check the logs:

```bash
npm run dev
```

Look for any errors related to missing variables.

### 2. Test Google OAuth

1. Open `http://localhost:3000`
2. Click "Sign in with Google"
3. You should be redirected to Google
4. After signing in:
   - ✅ **If your email is in ALLOWED_EMAILS:** You'll see the dashboard
   - ❌ **If NOT in the whitelist:** You'll see "Access Denied"

### 3. Test WooCommerce Connection

After logging in:
1. The dashboard should load inventory
2. Check the browser console for errors
3. If you see WooCommerce API errors, double-check your credentials

---

## Troubleshooting

### "Access Denied" Error

**Cause:** Your email is not in the `ALLOWED_EMAILS` list

**Solution:**
1. Open `.env.local`
2. Add your Google account email to `ALLOWED_EMAILS`
3. Restart the dev server (`npm run dev`)
4. Try logging in again

### 404 Error on Google Callback

**Cause:** Redirect URI not configured in Google Console

**Solution:**
1. Go to Google Cloud Console > Credentials
2. Edit your OAuth client
3. Add: `http://localhost:3000/api/auth/callback/google`
4. Save and try again

### "Configuration" Error

**Cause:** Missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`

**Solution:**
1. Verify these variables are in `.env.local`
2. Make sure there are no extra spaces
3. Restart the dev server

### WooCommerce Connection Failed

**Cause:** Invalid API credentials or wrong URL

**Solution:**
1. Verify `WOOCOMMERCE_STORE_URL` has `https://` prefix
2. Regenerate API keys in WooCommerce
3. Ensure API permissions are set to **Read/Write**

---

## Security Notes

⚠️ **NEVER commit `.env.local` to Git!**

✅ **DO:**
- Keep `.env.local` private
- Use different credentials for development and production
- Rotate secrets periodically
- Limit WooCommerce API permissions to only what's needed

❌ **DON'T:**
- Share your `.env.local` file
- Commit secrets to version control
- Use the same secrets across multiple projects
- Share your Google OAuth client secret publicly

---

## Production Deployment (Vercel)

When deploying to Vercel:

1. Go to your project settings
2. Navigate to **Environment Variables**
3. Add all variables from your `.env.local`
4. For `NEXTAUTH_URL`, use your production domain
5. Update Google OAuth redirect URIs to include production URL

**Example Production Variables:**

```env
NEXTAUTH_URL=https://inventory.himclinic.com
# ... (other variables same as development)
```

---

## Need Help?

If you're stuck:

1. Check the [Next.js Environment Variables docs](https://nextjs.org/docs/basic-features/environment-variables)
2. Check the [NextAuth.js documentation](https://next-auth.js.org/configuration/options)
3. Verify all values are correct (no typos, no extra spaces)
4. Restart your development server after ANY changes to `.env.local`

---

**Last Updated:** December 2025




