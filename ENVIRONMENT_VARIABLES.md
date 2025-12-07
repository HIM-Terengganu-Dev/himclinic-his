# Live Dashboard - Environment Variables Documentation

This document describes the environment variables required for the Live Dashboard application.
**IMPORTANT:** The actual `.env` file containing these secrets must **NEVER** be committed to version control.

## Overview
The application integrates with multiple platforms:
- **WooCommerce**: For store data and order tracking.
- **Google Analytics**: For traffic and user metrics.
- **Google Search Console**: For search performance data.
- **GetResponse**: For email marketing data.
- **Neon Database (PostgreSQL)**: For data persistence.

---

## Variable Reference

### 1. WooCommerce API Credentials
**Source:** WooCommerce > Settings > Advanced > REST API
- `WOOCOMMERCE_STORE_URL`: The base URL of the store (e.g., `https://forhimclinic.com`).
- `WOOCOMMERCE_CONSUMER_KEY`: Consumer Key (starts with `ck_`).
- `WOOCOMMERCE_CONSUMER_SECRET`: Consumer Secret (starts with `cs_`).

### 2. Google Analytics API Credentials
**Source:** Extracted from `credentials/google-analytics-service-account.json`.
- `GOOGLE_ANALYTICS_CLIENT_EMAIL`: The service account email address.
- `GOOGLE_ANALYTICS_PRIVATE_KEY`: The private key for the service account.
  - *Format:* Must include `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` headers/footers and handle newlines correctly (`\n`).
- `GOOGLE_ANALYTICS_PROPERTY_ID`: The unique Property ID for the Google Analytics property.

### 3. Google Search Console API Credentials
**Source:** Uses the same service account as Google Analytics.
- `GSC_CLIENT_EMAIL`: Service account email (typically same as `GOOGLE_ANALYTICS_CLIENT_EMAIL`).
- `GSC_PRIVATE_KEY`: Private key (typically same as `GOOGLE_ANALYTICS_PRIVATE_KEY`).
- `GSC_SITE_URL`: The site URL identifier in GSC (e.g., `sc-domain:forhimclinic.com`).

### 4. GetResponse API Credentials
**Source:** GetResponse API Settings.
- `GETRESPONSE_API_KEY`: The private API key for accessing GetResponse accounts.

### 5. Neon Database (PostgreSQL)
**Source:** Neon Dashboard.
- `HC_LIVE_DASHBOARD_DDL`: The full PostgreSQL connection string.
  - *Example Format:* `postgresql://user:password@host/dbname?sslmode=require...`

---

## Setup Instructions
1. Copy the `.env.example` file to `.env` (if an example exists) or create a new `.env` file.
2. Populate the variables with the confidential credentials.
3. Ensure `.env` is listed in your `.gitignore` file.
