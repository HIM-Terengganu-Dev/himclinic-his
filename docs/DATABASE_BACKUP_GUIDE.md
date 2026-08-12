# Neon Database Backup Guide

This repository includes automated and manual backup solutions for the Neon PostgreSQL database.

## 1. Local Manual Backup

Run on-demand backup before schema migrations or major updates.

### Usage
```bash
npm run db:backup
# OR
bash scripts/backup-db.sh
```

### How It Works
- Reads `DATABASE_URL` from `.env`.
- Uses `pg_dump` with custom compressed format (`.dump`).
- Saves backup file in `./backups/neon_backup_YYYYMMDD_HHMMSS.dump`.
- Automatically retains backups for 7 days locally.

---

## 2. Automated Daily Backup (GitHub Actions)

Daily offsite backup configured in [.github/workflows/neon-backup.yml](file:///.github/workflows/neon-backup.yml).

### Features
- **Schedule**: Runs automatically every day at 00:00 UTC.
- **Manual Trigger**: Can be run manually from GitHub Actions tab (`workflow_dispatch`).
- **Retention**: Stores compressed `.dump` artifacts on GitHub Actions for 30 days.

### Setup Required on GitHub:
1. Go to Repository **Settings** > **Secrets and variables** > **Actions**.
2. Add Repository Secret:
   - `DATABASE_URL`: Your full Neon PostgreSQL connection string (`postgres://...sslmode=require`).

---

## 3. How to Restore a Backup File

### Option A: Using NPM Script (Automated)
```bash
# Restore latest backup in ./backups/
npm run db:restore

# OR specify custom backup file
npm run db:restore backups/neon_backup_20260812083448.dump
```

### Option B: Manual CLI Commands

* **For `.dump` files (Binary compressed format)**:
  ```bash
  /opt/homebrew/opt/libpq/bin/pg_restore --clean --no-owner --no-acl -d "$DATABASE_URL" backups/neon_backup_YYYYMMDD_HHMMSS.dump
  ```

* **For `.sql` files (Plain SQL text format)**:
  ```bash
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -f backups/neon_backup_YYYYMMDD_HHMMSS.sql
  ```
