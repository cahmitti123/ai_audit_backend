# Database Setup Guide

## Overview

This application fetches audit configurations from a **separate external database**. The audit configs are stored in another application's Supabase database and accessed in **read-only mode**.

## Database Architecture

```
┌─────────────────────────────────────┐
│   Your Application (ai-audit)       │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Fiche API                  │  │
│  │   (devis-mutuelle...)        │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   External Audit Config DB   │  │
│  │   (Supabase EU North 1)      │◄─┼─── READ ONLY
│  │   - AuditConfig              │  │
│  │   - AuditStep                │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │   Your App Database          │  │
│  │   (Supabase US East 2)       │  │
│  │   (Optional - for your data) │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Environment Variables

### Required for Audit Config Database

```bash
# External Audit Config Database (Read Only)
AUDIT_CONFIG_DATABASE_URL="postgresql://postgres.xxx:password@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
AUDIT_CONFIG_DIRECT_URL="postgresql://postgres.xxx:password@aws-1-eu-north-1.pooler.supabase.com:5432/postgres"
```

These credentials connect to the **external application's database** to fetch audit configurations.

### Optional - Your App's Database

```bash
# Your Local Database (Optional)
DATABASE_URL="postgresql://postgres.xxx:password@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.xxx:password@aws-1-us-east-2.pooler.supabase.com:5432/postgres"
```

These are for **your app's own database** if you want to store additional data. Not required for basic audit functionality.

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

This will automatically run `prisma generate` to create the Prisma client.

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` and add your audit config database credentials:

```bash
# External Audit Config Database credentials
AUDIT_CONFIG_DATABASE_URL="postgresql://postgres.zcpqttipahcmzleyyoxw:sIG1PUHAgTEbBTWv@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
AUDIT_CONFIG_DIRECT_URL="postgresql://postgres.zcpqttipahcmzleyyoxw:sIG1PUHAgTEbBTWv@aws-1-eu-north-1.pooler.supabase.com:5432/postgres"
```

### 3. Test Database Connection

```bash
npm run test:db
```

**Expected Output:**

```
================================================================================
TEST AUDIT CONFIG DATABASE CONNECTION
================================================================================

🔌 Testing database connection...

✓ Connected to audit config database
✓ Found 3 audit configurations in database

📋 Fetching latest audit configuration...

✓ Successfully fetched audit config:
  • ID: 1
  • Name: Audit Qualité 18 Points
  • Description: Configuration d'audit en 18 étapes
  • Steps: 18

📊 Audit Steps:
  1. Présentation Cabinet/Agent (HIGH - CRITICAL)
  2. Annonce ORIAS (HIGH - CRITICAL)
  ...

================================================================================
✅ ALL TESTS PASSED
================================================================================
```

### 4. Run the Pipeline

```bash
npm run pipeline
```

The pipeline will automatically:

1. Fetch the fiche data from the API
2. Fetch the latest active audit config from the database
3. Process transcriptions
4. Generate timeline
5. Perform the audit

## Database Schema

The application uses these models from the external database:

### AuditConfig

```typescript
{
  id: BigInt
  name: String
  description?: String
  prompt?: String
  isActive: Boolean
  createdAt: DateTime
  updatedAt: DateTime
  steps: AuditStep[]
}
```

### AuditStep

```typescript
{
  id: BigInt
  auditConfigId: BigInt
  name: String
  description?: String
  prompt: String
  controlPoints: String[]
  keywords: String[]
  severityLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  isCritical: Boolean
  position: Int
  chronologicalImportant: Boolean
  weight: Int
  verifyProductInfo: Boolean
}
```

## Prisma Client

The application uses a separate Prisma client configured to connect to the external audit config database.

### Generate Prisma Client Manually

```bash
npm run prisma:generate
```

### View Prisma Schema

```bash
cat prisma/schema.prisma
```

## Service API

### Fetch Latest Audit Config

```typescript
import { fetchLatestAuditConfig } from "./services/audit-config.js";

const config = await fetchLatestAuditConfig();
console.log(config.name);
console.log(config.auditSteps.length);
```

### Fetch All Active Configs

```typescript
import { fetchActiveAuditConfigs } from "./services/audit-config.js";

const configs = await fetchActiveAuditConfigs();
configs.forEach((config) => {
  console.log(config.name);
});
```

### Fetch Config by ID

```typescript
import { fetchAuditConfigById } from "./services/audit-config.js";

const config = await fetchAuditConfigById(1);
```

### Disconnect

```typescript
import { disconnectAuditConfigDb } from "./services/audit-config.js";

await disconnectAuditConfigDb();
```

## Troubleshooting

### Error: Cannot connect to database

**Check:**

1. Environment variables are set correctly
2. Database credentials are valid
3. Network connection is working
4. Firewall allows connection to Supabase

**Test:**

```bash
npm run test:db
```

### Error: No active audit configuration found

**Solution:**
Ensure there's at least one audit config in the database with `isActive = true`.

### Error: Prisma client not generated

**Solution:**

```bash
npm run prisma:generate
```

### Error: Wrong database connection

**Check:**

- `AUDIT_CONFIG_DATABASE_URL` points to the **external app's database** (EU North 1)
- `DATABASE_URL` points to **your app's database** (US East 2) - if you have one

## Security Notes

⚠️ **Important:**

- The audit config database credentials are for **READ-ONLY** access
- Never write to the external database
- Keep credentials secure in `.env` file
- Don't commit `.env` to version control

## Migration Notes

### From JSON to Database

**Before (v2.1.0):**

```typescript
const auditConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
```

**After (v2.2.0):**

```typescript
const auditConfig = await fetchLatestAuditConfig();
```

The config structure remains the same, so no other code changes are needed!

## Support

If you have issues:

1. Run `npm run test:db` to diagnose
2. Check your `.env` file
3. Verify database credentials with the database administrator
4. Check Supabase dashboard for connection issues
