# 🚀 Quick Start Guide

## Authentication Setup (5 Minutes)

### Step 1: Copy Environment File

```bash
cp .env.local.example .env.local
```

### Step 2: Fill in Required Values

Open `.env.local` and add:

#### 🛒 WooCommerce (You already have these)
```env
WOOCOMMERCE_STORE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx
```

#### 🔐 NextAuth Secret
Generate a random secret:

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Copy the output and paste:
```env
NEXTAUTH_SECRET=paste-here
NEXTAUTH_URL=http://localhost:3000
```

#### 📧 Google OAuth

1. Go to: https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID
3. Add redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy the credentials:

```env
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
```

#### ✅ Whitelist Your Email

**IMPORTANT:** Add YOUR Gmail address here:

```env
ALLOWED_EMAILS=your-email@gmail.com,team@himclinic.com
ADMIN_EMAILS=your-email@gmail.com
```

> Only emails in `ALLOWED_EMAILS` can log in!

### Step 3: Start the Server

```bash
npm run dev
```

### Step 4: Test Login

1. Open: http://localhost:3000
2. Click "Sign in with Google"
3. ✅ If your email is in ALLOWED_EMAILS → You're in!
4. ❌ If not → You'll see "Access Denied" at `/auth/error`

---

## Fixed Issues ✅

### 1. **404 on `/login?error=true`** → Now redirects to `/auth/error`
### 2. **Using `.env.local`** → Example file created
### 3. **Access Denied Page** → Beautiful error page at `/auth/error`
### 4. **Email Whitelist** → Only authorized users can login

---

## How It Works

```
User tries to login
    ↓
Google Authentication
    ↓
Check if email in ALLOWED_EMAILS
    ↓
  YES → Dashboard ✅
    ↓
  NO → Access Denied ❌ (/auth/error)
```

---

## Troubleshooting

### "Access Denied" after login?

**Fix:** Add your email to `ALLOWED_EMAILS` in `.env.local`:

```env
ALLOWED_EMAILS=your-actual-email@gmail.com,other@email.com
```

Then restart: `npm run dev`

### "Configuration Error"?

**Fix:** Make sure these are set:
- ✅ `GOOGLE_CLIENT_ID`
- ✅ `GOOGLE_CLIENT_SECRET`
- ✅ `NEXTAUTH_SECRET`

### "Callback URL mismatch"?

**Fix:** In Google Console, add:
```
http://localhost:3000/api/auth/callback/google
```

---

## Admin vs Staff Access

### Admin Users (in `ADMIN_EMAILS`):
- ✅ All features
- ✅ SKU Management tab
- ✅ Future admin-only features

### Regular Staff:
- ✅ Dashboard
- ✅ Procurement updates
- ✅ Activity logs
- ❌ SKU Management (hidden)

---

## Production Deployment

When deploying to Vercel:

1. Add all environment variables in Vercel dashboard
2. Change `NEXTAUTH_URL` to your domain
3. Update Google OAuth redirect URI to production URL

Example:
```env
NEXTAUTH_URL=https://inventory.himclinic.com
```

---

**Need more help?** Check `ENVIRONMENT_SETUP.md` for detailed instructions!

