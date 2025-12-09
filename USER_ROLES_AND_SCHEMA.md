# User Roles and Database Schema

## Available Roles

The system has **2 roles** defined in the database:

### 1. `'admin'` Role
**Full Access:**
- ✅ View Dashboard (inventory, combo SKUs)
- ✅ Update Procurement Stock
- ✅ View Activity Logs
- ✅ **SKU Management** (create/edit single and combo SKUs)
- ✅ All future admin-only features

### 2. `'user'` Role (Default)
**Standard Staff Access:**
- ✅ View Dashboard (inventory, combo SKUs)
- ✅ Update Procurement Stock
- ✅ View Activity Logs
- ❌ **No SKU Management** (tab is hidden)

---

## Users Table Schema

### Simplified Structure

```sql
CREATE TABLE inventory_management.users (
    id SERIAL PRIMARY KEY,                    -- Auto-generated
    email VARCHAR(255) UNIQUE NOT NULL,        -- REQUIRED: User's email
    name VARCHAR(255),                         -- Optional: Display name
    role VARCHAR(50) DEFAULT 'user',           -- 'admin' or 'user'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Auto-generated
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP    -- Auto-updated
);
```

### Required Fields

**Only `email` is required!**

```sql
-- Minimal insert (only email required)
INSERT INTO inventory_management.users (email)
VALUES ('user@example.com');
```

### Optional Fields

- `name` - User's display name (can be NULL)
- `role` - Defaults to `'user'` if not specified

### Auto-Generated Fields

- `id` - Primary key (auto-increment)
- `created_at` - Timestamp when user was created
- `last_login` - Timestamp of last login (auto-updated)

---

## Adding Users

### Add Admin User

```sql
INSERT INTO inventory_management.users (email, name, role)
VALUES ('admin@himclinic.com', 'Admin Name', 'admin');
```

### Add Regular Staff User

```sql
INSERT INTO inventory_management.users (email, name, role)
VALUES ('staff@himclinic.com', 'Staff Name', 'user');
```

### Add User with Default Role (user)

```sql
-- Role defaults to 'user' if not specified
INSERT INTO inventory_management.users (email, name)
VALUES ('staff@himclinic.com', 'Staff Name');
```

### Minimal Insert (Email Only)

```sql
-- Only email required, everything else has defaults
INSERT INTO inventory_management.users (email)
VALUES ('user@example.com');
```

---

## Updating User Roles

### Promote User to Admin

```sql
UPDATE inventory_management.users
SET role = 'admin'
WHERE email = 'user@example.com';
```

### Demote Admin to Regular User

```sql
UPDATE inventory_management.users
SET role = 'user'
WHERE email = 'admin@example.com';
```

---

## Authentication Flow

```
1. User clicks "Sign in with Google"
   ↓
2. Google OAuth authentication
   ↓
3. System checks database by EMAIL only
   ↓
4. User exists?
   ✅ YES → Update last_login → Grant access
   ❌ NO → Show "Access Denied" page
```

**Note:** Authentication is now **email-based only**. No `google_id` needed!

---

## Migration from Old Schema

If you have an existing database with `google_id` and `picture` columns, run:

```bash
psql $DATABASE_URL -f database/migration_remove_google_id_picture.sql
```

This will:
- Drop the `google_id` column and its index
- Drop the `picture` column
- Keep all existing users (by email)

---

## Example: Complete User Management

### View All Users

```sql
SELECT id, email, name, role, created_at, last_login
FROM inventory_management.users
ORDER BY created_at DESC;
```

### Find User by Email

```sql
SELECT * FROM inventory_management.users
WHERE email = 'user@example.com';
```

### Count Users by Role

```sql
SELECT role, COUNT(*) as count
FROM inventory_management.users
GROUP BY role;
```

### Delete User

```sql
DELETE FROM inventory_management.users
WHERE email = 'user@example.com';
```

---

## Security Notes

⚠️ **Important:**
- Only users in the `users` table can log in
- Email must match exactly (case-sensitive in some databases)
- Users must authenticate via Google OAuth first
- Role determines access level in the application

✅ **Best Practices:**
- Use unique email addresses
- Set appropriate roles (admin vs user)
- Regularly review user list
- Remove inactive users

---

**Last Updated:** December 2025

