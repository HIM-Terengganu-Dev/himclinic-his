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

#### 🗄️ Database Setup (Required)

**IMPORTANT:** Users are stored in the database, not environment variables!

1. Set up your PostgreSQL database (Neon DB recommended)
2. Run the schema: `psql $DATABASE_URL -f database/schema.sql`
3. Add your first user to the database:

```sql
INSERT INTO inventory_management.users (email, name, role)
VALUES ('your-email@gmail.com', 'Your Name', 'admin');
```

> Only users in the `users` table can log in!

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
Check if user exists in database (by Google ID or email)
    ↓
  EXISTS → Update last_login → Dashboard ✅
    ↓
  NOT FOUND → Access Denied ❌ (/auth/error)
```

---

## Troubleshooting

### "Access Denied" after login?

**Fix:** Add your user to the database:

```sql
INSERT INTO inventory_management.users (email, name, role)
VALUES ('your-email@gmail.com', 'Your Name', 'user');
```

To get your Google ID, check the error logs or use Google OAuth debugger.

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

### Admin Users (role = 'admin' in database):
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

1. Add all environment variables in Vercel dashboard (including `DATABASE_URL`)
2. Change `NEXTAUTH_URL` to your domain
3. Update Google OAuth redirect URI to production URL
4. Ensure database is set up and users are added

Example:
```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
NEXTAUTH_URL=https://inventory.himclinic.com
```

---

**Need more help?** Check `ENVIRONMENT_SETUP.md` for detailed instructions!

