## Backend tests (ai-audit)

### What exists today

We added a **DB-free HTTP test suite** using:
- **Vitest** (runner)
- **Supertest** (HTTP assertions against the Express app)

The tests intentionally avoid requiring Postgres/Redis/Inngest to be running.

### Run tests

From `ai-audit/`:

- `npm test` (single run)
- `npm run test:watch` (watch mode)

### Integration tests (REAL DB + REAL external API)

These tests will:
- talk to your **real Postgres** using `DATABASE_URL`
- call the **real CRM/Fiche API** using `FICHE_API_BASE_URL` (or default CRM base URL)
- cache a real fiche into your DB, then hit real endpoints like `GET /api/fiches/:id`

They are **disabled by default**. Enable explicitly:

#### PowerShell (Windows)

```powershell
$env:RUN_INTEGRATION_TESTS="1"

# Optional: tests will auto-load your local `.env` when RUN_INTEGRATION_TESTS=1.
# If you prefer, you can still set/override values here:
# $env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME"
# $env:DIRECT_URL=$env:DATABASE_URL
# $env:FICHE_API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"

# Optional: pin a specific date. If omitted, tests will auto-search recent days for a date that has fiches.
# $env:INTEGRATION_SALES_DATE="2025-12-01"

npm test
```

Notes:
- If `INTEGRATION_SALES_DATE` has no fiches (or fiches without `cle`), the test will fail with a clear message; just pick another date.

### What the tests cover

- Core HTTP behavior:
  - `GET /health`
  - `GET /api-docs.json`
  - `/api/*` unknown route → structured 404
  - invalid JSON body → 400 `INVALID_JSON`
- Validation-only checks (no DB required) for:
  - fiches date-range progressive fetch query validation
  - batch endpoints required fields
  - audits run endpoint required fields
  - chat required fields / invalid BigInt path param
  - automation trigger body validation
- DB-free utility endpoints:
  - `GET /api/automation/diagnostic`
  - webhook test endpoint input validation
  - realtime SSE headers (`/api/realtime/jobs/:jobId`)

### Safety (no accidental external calls)

The global test setup (`tests/setup.ts`) forces:
- `FRONTEND_WEBHOOK_URL=""` (disables outbound webhooks)
- `REDIS_URL=""` (forces realtime to use in-memory mode)

### Next: DB-backed integration tests (optional)

If you want true integration tests (create schedule, run audit, etc.), we should:
- run a dedicated Postgres container for tests
- run migrations
- seed minimal rows
- point `DATABASE_URL` to the test database

We can add that as a separate suite (e.g. `tests/integration/*.spec.ts`) gated by an env var like `RUN_INTEGRATION_TESTS=1`.


