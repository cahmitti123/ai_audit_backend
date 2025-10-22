# Changelog

## [2.2.0] - 2025-10-21

### Added

#### 🗄️ Database Integration for Audit Configs

- **Fetch audit configs from external database**
  - Connects to separate Supabase database to retrieve audit configurations
  - Uses Prisma ORM for type-safe database access
  - Read-only access to external audit config database

#### 📦 New Dependencies

- `@prisma/client` (v5.20.0) - Prisma Client for database access
- `prisma` (v5.20.0) - Prisma CLI dev dependency

#### 🛠️ New Files

1. **`prisma/schema.prisma`**

   - Prisma schema for audit config database
   - Models: `AuditConfig`, `AuditStep`
   - Enum: `AuditSeverity`

2. **`src/services/audit-config.ts`**

   - Service to fetch audit configurations from database
   - Functions: `fetchLatestAuditConfig()`, `fetchAuditConfigById()`, `fetchActiveAuditConfigs()`
   - Connection management and error handling

3. **`scripts/test-db-connection.ts`**

   - Test script to verify database connection
   - Validates audit config fetching
   - Run with: `npm run test:db`

4. **`DATABASE_SETUP.md`**
   - Comprehensive database setup guide
   - Architecture diagrams
   - Troubleshooting tips

#### ⚙️ New Environment Variables

```bash
AUDIT_CONFIG_DATABASE_URL  # External audit config DB connection (pooler)
AUDIT_CONFIG_DIRECT_URL    # Direct connection for migrations
```

#### 📜 New Scripts

```json
{
  "prisma:generate": "prisma generate",
  "postinstall": "prisma generate",
  "test:db": "tsx scripts/test-db-connection.ts"
}
```

### Changed

#### 📝 Updated Files

1. **`src/main-pipeline.ts`**

   - Replaced JSON file reading with database fetch
   - Added import for `audit-config.ts` service
   - Added database cleanup on exit
   - Better error handling with database disconnect

2. **`.env` and `.env.example`**

   - Renamed `API_BASE_URL` to `FICHE_API_BASE_URL` for clarity
   - Added audit config database credentials
   - Added clear comments separating different database connections
   - Organized environment variables by purpose

3. **`package.json`**

   - Version bumped to 2.2.0
   - Updated description
   - Added Prisma dependencies
   - Added new scripts

4. **`README.md`**
   - Updated installation steps (added database test step)
   - Added database configuration section
   - Updated pipeline steps (now 6 steps)
   - Added link to DATABASE_SETUP.md
   - Updated advantages list

### Removed

- No longer requires `config/audit_config_18_points.json` file
- Audit configs are now fetched from database

### Benefits

✅ **Centralized Configs** - All audit configs in one database
✅ **Always Up-to-Date** - No need to manually update JSON files
✅ **Type-Safe** - Prisma provides full TypeScript types
✅ **Flexible** - Easy to add/modify audit steps from database
✅ **Scalable** - Can support multiple audit configurations

### Migration Guide

#### From v2.1.0 to v2.2.0

1. **Install new dependencies:**

   ```bash
   npm install
   ```

2. **Add database credentials to `.env`:**

   ```bash
   AUDIT_CONFIG_DATABASE_URL="postgresql://..."
   AUDIT_CONFIG_DIRECT_URL="postgresql://..."
   ```

3. **Rename environment variable:**

   ```bash
   # Old
   API_BASE_URL="..."

   # New
   FICHE_API_BASE_URL="..."
   ```

4. **Test database connection:**

   ```bash
   npm run test:db
   ```

5. **Run pipeline as usual:**
   ```bash
   npm run pipeline
   ```

#### Code Changes

No code changes needed in your audit processing logic! The audit config structure remains identical.

**Before:**

```typescript
const auditConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
```

**After:**

```typescript
const auditConfig = await fetchLatestAuditConfig();
```

### Technical Details

**Database Architecture:**

- Separate Prisma client for audit config database
- Connection pooling via Supabase
- Automatic cleanup on process exit

**Prisma Schema:**

- Generator output: `node_modules/.prisma/client`
- Auto-generates TypeScript types
- Supports BigInt IDs

**Performance:**

- Database query: ~100-200ms
- Cached after first fetch
- Minimal impact on pipeline performance

---

## [2.1.0] - 2025-10-21

### Changed

#### 🌐 API Integration

- **Replaced static JSON file with live API calls**
  - The pipeline now fetches fiche data directly from the API
  - Endpoint: `GET /api/fiches/by-id/{fiche_id}?include_recordings=true&include_transcriptions=false`
  - No more need for `api-response-recordings.json` file

#### ⚙️ Configuration

- **New environment variables:**

  - `FICHE_ID`: The ID of the fiche to audit (default: "1762209")
  - `API_BASE_URL`: Base URL of the API (default: "https://api.devis-mutuelle-pas-cher.com")

- **Created `.env.example`** template file for easy setup

#### 📝 Updated Files

1. **`src/main-pipeline.ts`**

   - Added `fetchFicheData()` function to retrieve data from API
   - Imported `axios` for HTTP requests
   - Replaced file reading with API call
   - Enhanced error handling for API requests

2. **`.env`**

   - Added `FICHE_ID` and `API_BASE_URL` configuration

3. **`.env.example`**

   - Created template with all required environment variables
   - Includes documentation for each variable

4. **`README.md`**
   - Updated installation instructions
   - Added configuration section
   - Added instructions for changing fiche ID
   - Updated file structure diagram
   - Removed references to obsolete files

### How to Use

#### Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your API keys and FICHE_ID

# 2. Run the pipeline
npm run pipeline
```

#### Change Fiche ID

Method 1 - Edit `.env`:

```bash
FICHE_ID="1234567"
```

Method 2 - Command line:

```bash
FICHE_ID=1234567 npm run pipeline
```

### Benefits

✅ **No manual file downloads** - Data fetched automatically
✅ **Always up-to-date** - Real-time data from API
✅ **Flexible** - Easy to audit any fiche by changing ID
✅ **Error handling** - Clear error messages for API issues
✅ **Backward compatible** - Same data structure internally

### Technical Details

**API Request:**

```bash
curl -X 'GET' \
  'https://api.devis-mutuelle-pas-cher.com/api/fiches/by-id/1762209?include_recordings=true&include_transcriptions=false' \
  -H 'accept: application/json'
```

**Response Structure:**

- `success`: boolean
- `information`: Fiche metadata
- `prospect`: Prospect details
- `recordings[]`: Audio recordings (used for transcription)
- `commentaires[]`, `mails[]`, etc.

**Error Handling:**

- API errors (status codes)
- Network errors (no response)
- Request errors (malformed)
- Success flag validation

### Migration Notes

If you were using the old system with `api-response-recordings.json`:

1. The pipeline now fetches data automatically
2. You can remove the `config/api-response-recordings.json` file
3. Set `FICHE_ID` in `.env` to the desired fiche
4. Run `npm run pipeline` as usual

All internal processing remains the same - only the data source has changed.
