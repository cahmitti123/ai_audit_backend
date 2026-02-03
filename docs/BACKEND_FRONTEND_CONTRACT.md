## Backend ↔ Frontend Contract (NCA Audit backend)

**Audience**: Next.js/browser frontend (REST + Pusher Channels + webhooks + chat streaming (SSE))  
**Backend repo**: this workspace (`ai-audit`)  
**Backend base URL (dev default)**: `http://localhost:3002`  
**Swagger/OpenAPI (exported by backend)**: `GET /api-docs.json` (OpenAPI **3.0.0**) and UI at `GET /api-docs`

### Inputs limitation (important)

Your original request referenced **frontend-repo** files:
- `docs/FRONTEND_INTEGRATION.md`
- `src/types/*.types.ts`

Those files are **not present** in this backend workspace, so this document is **backend-verified only** (routes + validators + runtime behavior). If you want a strict “frontend expectation diff”, share those frontend files or point me at the frontend repo.

---

## Frontend migration notes (2026-01-21+)

This section is the **high-signal summary of changes** that typically require frontend updates.

### 1) Audit IDs (tracking vs DB id)

You will see two different “audit id” concepts:

- **`audit_db_id`**: the Postgres `audits.id` (BigInt, serialized as a string).  
  Use this for REST calls like `GET /api/audits/:audit_id`.
- **`audit_id` (tracking id)**: a string like `audit-{fiche_id}-{audit_config_id}-{timestamp}` used for some realtime payloads.

**What changed**:
- Realtime payloads now often include **`audit_db_id`** (when known), so the UI can refetch details via `GET /api/audits/:audit_db_id`.
- Channel routing may publish to **both** audit channels when both IDs exist:
  - `private-audit-{audit_id}` (tracking id)
  - `private-audit-{audit_db_id}` (DB id)

**Frontend recommendation**:
- Treat `audit_db_id` as canonical for navigation + REST.
- When subscribing for realtime, prefer `private-audit-{audit_db_id}` whenever you have it.

### 2) Reruns now mutate stored audits (important)

**What changed**:
- `POST /api/audits/:audit_id/steps/:step_position/rerun` now **updates** the stored step result (`audit_step_results`) and recomputes audit compliance summary (`audits.*` score/niveau/critical).
- Control-point rerun now updates the **normalized control point tables** (`audit_step_result_control_points` + citations), recomputes step score/conforme deterministically, and recomputes audit compliance summary.
- Audit trails are now **normalized** (`audit_step_result_human_reviews`, `audit_step_result_rerun_events`). For backwards compatibility, audit detail endpoints still expose `human_review` / `rerun_history` under each step payload in `resultData`.
- `audits.resultData` is stored as a workflow snapshot (heavy `results.steps` arrays are stripped). Audit detail endpoints rebuild/overlay the latest step payloads from DB so reruns/overrides are visible.

**Frontend recommendation**:
- Treat rerun as **“run async then refetch”**:
  - Start a spinner after the rerun HTTP call returns `{ event_id }`
  - Wait for `audit.step_completed` with `rerun_id` (and optionally `rerun_scope`) on `private-audit-{audit_db_id}`
  - Refetch `GET /api/audits/:audit_db_id` to render the updated stored results

### 3) Automation run realtime (new Pusher events)

Automation runs now emit dedicated Pusher events on a job channel:

- **Channel**: `private-job-automation-run-{run_id}`  
  (implemented as `private-job-{job_id}` where `job_id = "automation-run-{run_id}"`)
- **Events**:
  - `automation.run.started`
  - `automation.run.selection`
  - `automation.run.completed`
  - `automation.run.failed`

**Frontend recommendation**:
- After triggering automation, subscribe to `private-job-automation-run-{run_id}` to display selection + completion status without polling.

### 4) Batch audits require Redis

`POST /api/audits/batch` now hard-requires Redis for progress/finalization.

**Frontend recommendation**:
- Handle `503 SERVICE_UNAVAILABLE` and show “Batch audits unavailable (Redis not configured)”.

### 5) Authentication (JWT + RBAC) (new)

All `/api/*` routes used by the frontend now require **authentication**.

- **User sessions (preferred)**:
  - `POST /api/auth/login` → returns an **access token** (JWT)
  - Send it on every API call: `Authorization: Bearer <access_token>`
  - Use `GET /api/auth/me` to fetch current `roles` + `permissions` (**structured grants**) + scope context (`crm_user_id`, `groupes`) for UI gating.
- **Refresh token (cookie, rotated)**:
  - On login/refresh, the backend sets an HttpOnly cookie (default `refresh_token`, scoped to `Path=/api/auth`)
  - Use it via:
    - `POST /api/auth/refresh`
    - `POST /api/auth/logout`
  - Frontend must call those with `credentials: "include"` (or `withCredentials: true`) so cookies are stored/sent.
- **Machine-to-machine token (optional)**:
  - If `API_AUTH_TOKEN`/`API_AUTH_TOKENS` is configured, the backend also accepts:
    - `Authorization: Bearer <api_token>` **or** `X-API-Key: <api_token>`
  - Treat this as a server-side secret (do **not** use from browsers).

Important: private channel auth (`POST /api/realtime/pusher/auth`) now requires a **user access token** and the `realtime.auth` permission (see realtime section below).

### 6) Webhook URL SSRF guard (automation + progressive fetch)

User-provided webhook URLs are validated server-side. In production, invalid/unsafe webhook URLs are rejected (HTTP `400`) unless explicitly allowlisted via `WEBHOOK_ALLOWED_ORIGINS`.

### 7) Fiche details: `mail_devis` is opt-in (payload size)

**What changed**:
- `GET /api/fiches/:fiche_id` omits `mail_devis` by default to keep the default fiche details payload smaller.
- To include it, request `?include_mail_devis=true`.
- When requested, `mail_devis` may still be `null` (no mail devis available) and should be treated as an optional field.

**Frontend recommendation**:
- Only request `include_mail_devis=true` when the UI actually needs to render the “Mail Devis” view.

### 8) JSON storage reduction (normalized tables/columns; API preserved)

This backend is actively reducing raw JSON storage by normalizing stable structures into tables/columns, while keeping the **API response shapes backward compatible** by reconstructing legacy payloads at read time.

Examples (non-exhaustive):
- **Fiche cache**: many `fiche_cache.raw_data` sections are now stored in dedicated tables/columns and re-attached on read.
- **Automation runs**: per-fiche outcomes live in `automation_run_fiche_results` (so `automation_runs.result_summary` can stay minimal); API can rebuild the legacy `resultSummary` shape from the table.
- **Webhooks**: progressive fetch webhook deliveries store canonical payload fields in columns/rows (payload sent to the webhook URL remains the same).
- **Audits**: control points + citations + trails are normalized; audit detail endpoints still expose legacy `points_controle` / `human_review` / `rerun_history` in `resultData`.
- **Transcriptions**: transcription chunks are normalized; some endpoints may return `words: []` and you should rely on `text` for display.
- **Products**: gamme/formule document URLs are normalized into the `documents` table; legacy JSON is kept minimal and reconstructed for API compatibility.

---

## Global HTTP behavior

### Base paths

- **Non-API**:
  - `GET /health`
  - `GET /api-docs` (Swagger UI)
  - `GET /api-docs.json` (OpenAPI JSON)
- **API routers** (mounted in `src/app.ts`):
  - `/api/auth/*` (JWT login/refresh/logout/me)
  - `/api/admin/*` (users/roles/permissions management)
  - `/api/fiches/*`
  - `/api/recordings/*`
  - `/api/transcriptions/*`
  - `/api/audit-configs/*`
  - `/api/audits/*` (includes step re-run endpoints)
  - `/api/automation/*`
  - `/api/products/*`
  - `/api/realtime/*` (Pusher Channels)
  - `/api/*` (chat endpoints are mounted here)
  - `/api/inngest/*` (**internal** Inngest handler; not intended for frontend)

### CORS (browser access)

Hard-coded allowlist in `src/app.ts`:
- `http://localhost:3000`
- `http://localhost:3001`
- `http://localhost:5173`
- `http://localhost:5174`
- `https://qa-nca-latest.vercel.app`

`credentials: true` is enabled.

### Response header for replica debugging

Every response includes:
- `X-Backend-Instance: <hostname|pid-...>`

### Error responses (global middleware)

Most unhandled errors (including Zod validation errors) become:

```json
{
  "success": false,
  "error": "Human readable message",
  "code": "OPTIONAL_MACHINE_CODE",
  "stack": "ONLY_IN_NODE_ENV=development"
}
```

Notes:
- The global handler uses `code` values from `src/shared/errors.ts` (e.g. `NOT_FOUND`, `VALIDATION_ERROR`, `INVALID_JSON`).
- Several routes **return errors manually** (often `{ success:false, error:"..." }` and sometimes also `message`), so error shapes are **not perfectly uniform** today.

### BigInt + Date serialization

- Any route using `jsonResponse()` or `ok()` will serialize **BigInt → string**.
- `Date` instances are left as `Date` in-memory, but JSON serialization emits ISO strings (e.g. `"2025-12-14T12:34:56.789Z"`).

### Auth / permissions

This backend implements **user authentication** (JWT) and **RBAC** (roles/permissions).

#### Access token (JWT)
- Obtain via:
  - `POST /api/auth/login` (email/password), or
  - `POST /api/auth/refresh` (refresh cookie / refresh token rotation)
- Send on every authenticated API request:
  - `Authorization: Bearer <access_token>`

#### Refresh token (cookie, rotated)
- On login/refresh, the backend sets an HttpOnly cookie (default name `refresh_token`, `Path=/api/auth`).
- Browser clients must call refresh/logout with credentials enabled:
  - `fetch(..., { credentials: "include" })`
- Refresh tokens are **rotated** on every refresh.

#### Roles/permissions (for UI gating)
- `GET /api/auth/me` returns:
  - `roles: string[]`
  - `crm_user_id: string | null` (CRM user id)
  - `groupes: string[]` (team/group names; “team” == “groupe”)
  - `permissions: PermissionGrant[]` (effective RBAC grants)
- A **PermissionGrant** is:

```ts
type PermissionScope = "SELF" | "GROUP" | "ALL";

type PermissionGrant = {
  key: string;                // e.g. "audits", "fiches", "admin.roles"
  read: boolean;
  write: boolean;
  read_scope: PermissionScope;
  write_scope: PermissionScope;
};
```

- **Permission string suffixes**: backend guards accept strings like `audits.read`, `audits.write`, `audits.run`, `fiches.fetch`, `chat.use`, `realtime.auth`, etc.
  - Suffixes are mapped to the underlying grant’s `read|write` on the **base key** (example: `audits.run` checks key `audits` with `write=true`).
  - Scope enforcement uses the user’s `*_scope` for the relevant key (self/group/all).
- `403` responses use `code: "AUTHORIZATION_ERROR"`.

#### Machine API token (optional)
- If `API_AUTH_TOKEN` or `API_AUTH_TOKENS` is set, the backend also accepts:
  - `Authorization: Bearer <api_token>` or `X-API-Key: <api_token>`
- In code, API tokens are treated as **trusted callers** and bypass `requirePermission()` checks.
  - Do **not** use API tokens from browsers.

#### Protected routes (summary)
- All `/api/*` routes are protected **except**:
  - `/api/auth/*` (bootstrap/login/refresh)
  - `/api/inngest/*` (Inngest uses its own signing)
- `GET /health` and `/api-docs*` remain public.

---

## Canonical REST endpoints (browser-callable)

Below is the **full list** of routes defined in `src/modules/*/*.routes.ts` plus `src/app.ts`.

### Health & docs

#### GET `/health`

- **Purpose**: backend liveness.
- **Auth**: none.
- **Response 200**:

```json
{
  "status": "ok",
  "timestamp": "2025-12-14T12:34:56.789Z",
  "service": "ai-audit-system",
  "version": "2.3.0",
  "instance": "pid-12345"
}
```

#### GET `/api-docs` / GET `/api-docs.json`

- **Purpose**: Swagger UI + OpenAPI JSON exported from JSDoc comments (`swagger-jsdoc` scans `./src/app.ts` and `./src/modules/**/*.routes.ts`).
- **OpenAPI version**: `3.0.0` (see `src/config/swagger.ts`).
- **Repo copy (last exported from a running server)**: `docs/openapi.swagger.json`

---

## Authentication API (`/api/auth/*`)

### POST `/api/auth/login`

- **Purpose**: login with email/password and receive an access token (JWT). Also sets refresh cookie.
- **Auth**: none (bootstrap).
- **Body**:

```json
{ "email": "admin@example.com", "password": "change-me" }
```

- **Response 200** (`success` wrapper; access token in JSON, refresh token in cookie):

```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "1",
      "email": "admin@example.com",
      "crm_user_id": "349",
      "groupes": ["NCA R1"],
      "roles": ["admin"],
      "permissions": [
        { "key": "audits", "read": true, "write": true, "read_scope": "ALL", "write_scope": "ALL" },
        { "key": "fiches", "read": true, "write": true, "read_scope": "ALL", "write_scope": "ALL" }
      ]
    }
  }
}
```

Notes:
- The refresh cookie is scoped to `Path=/api/auth`, so it is only sent to `/api/auth/*`.
- For cross-origin frontends, call login with `credentials: "include"` so the browser accepts `Set-Cookie`.

### POST `/api/auth/refresh`

- **Purpose**: rotate refresh token and return a new access token (JWT).
- **Auth**: requires refresh cookie by default.
- **Body**:
  - Optional `refresh_token` for non-cookie clients (CLI/tests).

```json
{ "refresh_token": "optional" }
```

- **Response 200**: same shape as login.

### POST `/api/auth/logout`

- **Purpose**: revoke refresh token and clear refresh cookie.
- **Auth**: requires refresh cookie by default.
- **Response 200**:

```json
{ "success": true, "data": { "logged_out": true } }
```

### POST `/api/auth/invite/accept`

- **Purpose**: first-time password setup for an **INVITED** user (one-time invite token).
- **Auth**: none (bootstrap via invite token).
- **Body**:

```json
{ "invite_token": "opaque-token-from-admin", "password": "new-password" }
```

- **Response 200**: same response shape as `POST /api/auth/login` (returns access token + sets refresh cookie).
- **Errors**:
  - `401` invalid/expired invite token
  - `400` validation errors (missing fields / weak password if enforced)

### GET `/api/auth/me`

- **Purpose**: returns current user identity + roles/permissions (use for UI gating).
- **Auth**: requires access token:
  - `Authorization: Bearer <access_token>`
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "1",
      "email": "admin@example.com",
      "crm_user_id": "349",
      "groupes": ["NCA R1"],
      "roles": ["admin"],
      "permissions": [
        { "key": "audits", "read": true, "write": true, "read_scope": "ALL", "write_scope": "ALL" },
        { "key": "fiches", "read": true, "write": true, "read_scope": "ALL", "write_scope": "ALL" }
      ]
    }
  }
}
```

---

## Admin API (`/api/admin/*`)

These endpoints are intended for an admin UI and require RBAC permissions:
- `admin.users.read` / `admin.users.write`
- `admin.roles.read` / `admin.roles.write`
- `admin.permissions.read`

### GET `/api/admin/users`
- **Response 200**: `{ success:true, data:{ users:[...], count } }`

### POST `/api/admin/users`
- **Body**:

```json
{ "email": "user@example.com", "password": "change-me", "role_keys": ["viewer"] }
```

### PATCH `/api/admin/users/:userId`
- **Body**: one of `status`, `password`, `role_keys`.

### GET `/api/admin/roles`
### GET `/api/admin/permissions`

### GET `/api/admin/crm/users`

- **Purpose**: list CRM users (from the gateway) and annotate whether each one is already linked to an app user.
- **Permission**: `admin.users.read`
- **Response 200**: `{ success:true, data:{ utilisateurs:[...], count } }`

### GET `/api/admin/crm/teams`

- **Purpose**: list CRM groups (“groupes”) from the gateway.
- **Permission**: `admin.users.read`
- **Query**:
  - `include_users=true|false` (default `false`)
- **Response 200**: `{ success:true, data:{ groupes:[...], count } }`

### POST `/api/admin/users/from-crm`

- **Purpose**: “one-click” create/link an app user from a CRM user id, assign roles, and (if needed) generate an invite token for first-time password setup.
- **Permission**: `admin.users.write`
- **Body**:

```json
{ "crm_user_id": "348", "role_keys": ["viewer"], "crm_group_id": "51" }
```

- **Response 201**:
  - Returns `user`, and also both `team` and `groupe` (aliases; same structure) when a CRM group can be inferred.
  - Returns `invite_token` when the created/linked user has no password yet (status `INVITED`).
- **Next step**: if `invite_token` is non-null, call `POST /api/auth/invite/accept` to set the password and obtain a session.

Note:
- If you authenticate with an API token (when `API_AUTH_TOKEN(S)` is configured), permission checks are bypassed (treated as a trusted caller). Browsers should use user JWTs instead.

---

## Fiches API (`/api/fiches/*`)

Notes:
- **Permission**:
  - All `/api/fiches/*` routes require `fiches.read` (user JWT). (Machine API tokens bypass permission checks.)
  - Any operation that forces an upstream fetch/refresh requires `fiches.write` (ex: `?refresh=true`).
- **Scope enforcement** (user JWT only):
  - Uses the effective grant for key `fiches`.
  - `read_scope=ALL`: no restriction
  - `read_scope=GROUP`: only fiches whose `groupe` is included in `user.groupes`
  - `read_scope=SELF`: only fiches whose `information.attribution_user_id` equals `user.crm_user_id`

### GET `/api/fiches/search`

- **Purpose**: Fetch CRM “sales list with calls” for a single day (via external API), optionally enriched with DB status.
- **Query**:
  - `date` (required, string `YYYY-MM-DD`)
  - `includeStatus` (optional, string; anything except `"false"` means true)
- **Response 200** (no `success` wrapper; it returns the service result directly):
  - If `includeStatus=false`: `{ fiches: SalesFicheWithRecordings[]; total: number }`
  - Else: `{ fiches: SalesFicheWithStatus[]; total: number }`
- **Scope**: response is filtered to only include in-scope fiches for the caller (SELF/GROUP/ALL).
- **Errors**:
  - `400`: validation error (missing/invalid date)
  - `500`: unexpected errors

### GET `/api/fiches/:fiche_id(\\d+)`

- **Purpose**: Get fiche “full details” from DB cache; may fetch full details from CRM if only minimal sales-list cache exists.
- **Query**:
  - `refresh=true` (optional) forces refresh from the gateway/CRM (does not require a cached `cle`; gateway refreshes internally)
  - `include_mail_devis=true` (optional) includes the (large) `mail_devis` object in the response; otherwise the field is omitted by default
- **Permissions**:
  - Requires `fiches.read`
  - If `refresh=true`, requires `fiches.write`
- **Scope**: out-of-scope fiche ids return `403` (forbidden).
- **Response 200**: returns the cached/full fiche payload (BigInt-safe). Shape matches `FicheDetailsResponse` in `src/modules/fiches/fiches.schemas.ts`.
- **Errors**:
  - `404`: fiche not found (gateway/CRM)
  - `502`: gateway/CRM error while fetching fiche details
  - `500`: other internal errors.

### GET `/api/fiches/:fiche_id(\\d+)/cache`

- **Purpose**: return minimal cache metadata for a fiche.
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "ficheId": "1762209",
    "groupe": "GROUPE",
    "prospectNom": "DOE",
    "prospectPrenom": "JANE",
    "recordingsCount": 2,
    "fetchedAt": "2025-12-14T12:34:56.789Z",
    "expiresAt": "2025-12-17T12:34:56.789Z"
  }
}
```

- **Errors**:
  - `404`: `{ success:false, error:"Fiche not cached" }`

### GET `/api/fiches/:fiche_id(\\d+)/status`

- **Purpose**: transcription + audit status for a fiche (DB-only).
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "ficheId": "1762209",
    "hasData": true,
    "transcription": {
      "total": 2,
      "transcribed": 1,
      "pending": 1,
      "percentage": 50,
      "isComplete": false,
      "lastTranscribedAt": "2025-12-14T12:00:00.000Z"
    },
    "audit": {
      "total": 1,
      "completed": 1,
      "pending": 0,
      "running": 0,
      "compliant": 1,
      "nonCompliant": 0,
      "averageScore": 85,
      "latestAudit": {
        "id": "123",
        "overallScore": "85/100",
        "scorePercentage": "85.00",
        "niveau": "BON",
        "isCompliant": true,
        "status": "completed",
        "completedAt": "2025-12-14T12:10:00.000Z",
        "auditConfig": { "id": "13", "name": "Audit Rapide" }
      }
    }
  }
}
```

- **Errors**:
  - `404`: `{ success:false, error:"Fiche not found in database", message:"..." }`

### POST `/api/fiches/status/batch`

- **Purpose**: bulk status lookup for multiple fiche IDs.
- **Body**:

```json
{ "ficheIds": ["1762209", "1753254"] }
```

- **Response 200**:

```json
{
  "success": true,
  "data": {
    "1762209": { "hasData": true, "transcription": { "...": "..." }, "audit": { "...": "..." } },
    "1753254": { "hasData": false, "transcription": { "...": "..." }, "audit": { "...": "..." } }
  }
}
```

- **Errors**:
  - `400`: validation error (`ficheIds must be an array`)

### GET `/api/fiches/status/by-date`

- **Purpose**: DB-only list of all cached fiches for a specific day, including status + audits + recordings summary.
- **Query**:
  - `date` (required, `YYYY-MM-DD`)
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "date": "2025-12-14",
    "total": 12,
    "fiches": [
      {
        "ficheId": "1762209",
        "groupe": "GROUPE",
        "agenceNom": "AGENCE",
        "prospectNom": "DOE",
        "prospectPrenom": "JANE",
        "prospectEmail": "jane@example.com",
        "prospectTel": "0600000000",
        "fetchedAt": "2025-12-14T10:00:00.000Z",
        "createdAt": "2025-12-14T10:00:00.000Z",
        "transcription": { "total": 2, "transcribed": 2, "pending": 0, "percentage": 100, "isComplete": true },
        "audit": {
          "total": 1,
          "completed": 1,
          "pending": 0,
          "running": 0,
          "compliant": 1,
          "nonCompliant": 0,
          "averageScore": 85,
          "latestAudit": null,
          "audits": []
        },
        "recordings": [
          { "id": "1", "callId": "CALL1", "hasTranscription": true, "transcribedAt": "2025-12-14T10:05:00.000Z", "startTime": "2025-12-14T09:00:00.000Z", "durationSeconds": 120 }
        ]
      }
    ]
  }
}
```

- **Errors**:
  - `400`: invalid/missing date

### GET `/api/fiches/status/by-date-range` (progressive fetch)

- **Purpose**: returns currently cached data immediately + schedules background fetch/caching for missing days.
- **Query**:
  - `startDate` (required, `YYYY-MM-DD`)
  - `endDate` (required, `YYYY-MM-DD`)
  - `webhookUrl` (optional, URL) — per-job webhook destination (SSRF-guarded)
  - `webhookSecret` (optional, string) — stored per job and used to sign webhook requests (HMAC)
  - `refresh=true` (optional) — forces a CRM refetch + cache revalidation for **all** dates in the range (runs in background; response still returns immediately with cached data)
- **Response 200** (note: this endpoint is *not* wrapped under `data`):

```json
{
  "success": true,
  "startDate": "2025-12-01",
  "endDate": "2025-12-03",
  "total": 5,
  "fiches": [],
  "meta": {
    "complete": false,
    "partial": true,
    "backgroundJobId": "cku1zqk1w0000abcd1234",
    "totalDaysRequested": 3,
    "daysFetched": 0,
    "daysRemaining": 3,
    "daysCached": 0,
    "cacheCoverage": {
      "datesWithData": [],
      "datesMissing": ["2025-12-01", "2025-12-02", "2025-12-03"]
    }
  }
}
```

- **Background behavior**:
  - Creates `ProgressiveFetchJob` (DB) when there are missing dates.
    - If `refresh=true`, a job is created even when the range is already fully cached (so the cache can be revalidated).
  - Emits Inngest event `fiches/progressive-fetch-continue` (idempotent per job).
  - Realtime emits (Pusher):
    - `fiches.progressive_fetch.created`
    - `fiches.progressive_fetch.progress`
    - `fiches.progressive_fetch.complete`
    - `fiches.progressive_fetch.failed`
- **Errors**:
  - `400`: invalid date format / invalid range / webhookUrl rejected by SSRF guard

### GET `/api/fiches/webhooks/fiches` (polling job status)

- **Purpose**: polling alternative to webhooks/SSE for progressive fetch job progress.
- **Query**:
  - `jobId` (required)
- **Response 200**:

```json
{
  "success": true,
  "jobId": "cku1zqk1w0000abcd1234",
  "event": "progress",
  "timestamp": "2025-12-14T12:34:56.789Z",
  "data": {
    "status": "processing",
    "progress": 66,
    "completedDays": 2,
    "totalDays": 3,
    "totalFiches": 12,
    "currentFichesCount": 7,
    "datesCompleted": ["2025-12-01", "2025-12-02"],
    "datesRemaining": ["2025-12-03"],
    "datesFailed": [],
    "error": null,
    "partialData": [],
    "dataUrl": null
  }
}
```

- **Errors**:
  - `404`: `{ success:false, error:"Notification not found", jobId:"..." }`

### GET `/api/fiches/jobs/:jobId`

- **Purpose**: fetch job + last 10 webhook deliveries (debug).
- **Response 200**:

```json
{
  "success": true,
  "job": {
    "id": "cku1zqk1w0000abcd1234",
    "status": "processing",
    "progress": 66,
    "completedDays": 2,
    "totalDays": 3,
    "totalFiches": 12,
    "startDate": "2025-12-01",
    "endDate": "2025-12-03",
    "datesAlreadyFetched": ["2025-12-01", "2025-12-02"],
    "datesRemaining": ["2025-12-03"],
    "datesFailed": [],
    "error": null,
    "createdAt": "2025-12-14T12:00:00.000Z",
    "updatedAt": "2025-12-14T12:34:56.789Z",
    "completedAt": null,
    "webhookDeliveries": [
      {
        "id": "cku1zqk1w0000deliv0001",
        "event": "progress",
        "status": "sent",
        "statusCode": 200,
        "attempt": 1,
        "sentAt": "2025-12-14T12:30:00.000Z",
        "createdAt": "2025-12-14T12:30:00.000Z"
      }
    ]
  }
}
```

- **Errors**:
  - `404`: `{ success:false, error:"Job not found" }`

### GET `/api/fiches/jobs`

- **Purpose**: list progressive fetch jobs.
- **Query**:
  - `status` (optional): `pending|processing|complete|failed`
  - `limit` (optional, default 20)
- **Response 200**:

```json
{
  "success": true,
  "jobs": [
    {
      "id": "cku1zqk1w0000abcd1234",
      "status": "processing",
      "progress": 66,
      "startDate": "2025-12-01",
      "endDate": "2025-12-03",
      "completedDays": 2,
      "totalDays": 3,
      "totalFiches": 12,
      "datesFailed": [],
      "createdAt": "2025-12-14T12:00:00.000Z",
      "completedAt": null,
      "webhookDeliveriesCount": 3
    }
  ],
  "total": 1
}
```

---

## Recordings API (`/api/recordings/*`)

### GET `/api/recordings/:fiche_id`

- **Purpose**: list DB recordings for a fiche.
- **Permission**: requires `recordings.read`.
- **Scope**: out-of-scope fiche ids return `403` (forbidden), based on the `recordings` grant scope (SELF/GROUP/ALL).
- **Response 200**:

```json
{ "success": true, "data": [/* prisma recording rows */], "count": 2 }
```

Notes:
- Shape is Prisma recording rows (BigInt → string if present).

---

## Transcriptions API (`/api/transcriptions/*`)

Notes:
- **Permissions**:
  - `POST /api/transcriptions/:fiche_id` and `POST /api/transcriptions/batch` require `transcriptions.write`
  - `GET /api/transcriptions/:fiche_id/status` and `GET /api/transcriptions/:fiche_id/recordings/:call_id` require `transcriptions.read`
- **Scope**: all endpoints enforce scope for the underlying fiche id (SELF/GROUP/ALL) using the `transcriptions` grant.

### POST `/api/transcriptions/:fiche_id`

- **Purpose**: queue transcription workflow in Inngest.
- **Query**:
  - `priority` (optional): `high|normal|low` (defaults to `normal`)
- **Response 200**:

```json
{
  "success": true,
  "message": "Transcription job queued",
  "fiche_id": "1762209",
  "event_id": "01K..."
}
```

### GET `/api/transcriptions/:fiche_id/status`

- **Purpose**: get transcription status for all recordings of a fiche (DB).
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "ficheId": "1762209",
    "total": 2,
    "transcribed": 1,
    "pending": 1,
    "percentage": 50,
    "recordings": [
      {
        "callId": "CALL1",
        "hasTranscription": true,
        "transcriptionId": "tl_...",
        "transcribedAt": "2025-12-14T12:00:00.000Z",
        "recordingDate": "14/12/2025",
        "recordingTime": "12:00",
        "durationSeconds": 120
      }
    ]
  }
}
```

### GET `/api/transcriptions/:fiche_id/recordings/:call_id`

- **Purpose**: get transcription payload for a specific recording.
- **Response 200**:

```json
{
  "success": true,
  "data": {
    "call_id": "CALL1",
    "recording_url": "https://...",
    "duration_seconds": 120,
    "transcription_id": "tl_...",
    "transcription": {
      "text": "....",
      "language_code": "fr",
      "words": []
    },
    "has_transcription": true
  }
}
```

- **Note**:
  - `transcription.words` may be empty (the backend progressively normalizes transcription storage into chunks and may clear word-level JSON). Use `transcription.text` as the primary display field.

- **Errors**:
  - `404` `{ success:false, error:"Recording not found" }`
  - `404` `{ success:false, error:"No transcription available for this recording" }`
  - `404` `{ success:false, error:"Transcription data not found in DB" }`

Important: This handler is **DB-only** (no local file cache fallback), which is **safe across multiple replicas**.

### POST `/api/transcriptions/batch`

- **Purpose**: queue transcription for multiple fiches (fan-out to Inngest).
- **Body**:

```json
{ "fiche_ids": ["1762209", "1753254"], "priority": "normal" }
```

- **Response 200**:

```json
{
  "success": true,
  "message": "2 transcription jobs queued",
  "fiche_ids": ["1762209", "1753254"],
  "event_ids": ["01K...", "01K..."]
}
```

- **Errors**:
  - `400` `{ success:false, error:"Invalid request - fiche_ids array required" }`

---

## Audits API (`/api/audits/*`)

Notes:
- **Permissions**:
  - Read endpoints require `audits.read`
  - Run/queue endpoints require `audits.run` (maps to the `audits` grant `write=true`)
  - Re-run endpoints require `audits.rerun` (maps to the `audits` grant `write=true`)
  - Human review / metadata update / delete endpoints require `audits.write`
- **Scope enforcement** (user JWT only):
  - Uses the effective grant for key `audits`.
  - List/group endpoints are automatically restricted by `read_scope` (SELF/GROUP/ALL).
  - Single-resource endpoints (`/by-fiche/:fiche_id`, `/:audit_id`, review/patch/delete) check scope against the audit’s linked fiche.
  - Run endpoints validate the target `fiche_id` is in-scope before queuing work.

### Audit transcript mode (legacy prompt vs RLM-style tools)

This backend supports two transcript long-context strategies for audits:

- **prompt** (default): full transcript timeline is embedded into each audit step prompt.
- **tools** (optional, RLM-style): keeps the timeline out of the prompt and exposes constrained transcript tools (`searchTranscript`, `getTranscriptChunks`) for evidence lookup.

Enable **tools** mode per request by sending `use_rlm: true` (alias: `useRlm: true`) on:
- `POST /api/audits/run`
- `POST /api/audits` (alias of `/api/audits/run`)
- `POST /api/audits/run-latest`
- `POST /api/audits/batch`

The chosen approach is persisted on completed audits under:
- `resultData.metadata.approach`
- `resultData.audit.approach`
- `resultData.audit.results.approach`

Shape: `{ use_rlm: boolean; transcript_mode: "prompt" | "tools" }`.

### GET `/api/audits`

- **Purpose**: list audits with filtering + pagination.
- **Query**:
  - `fiche_ids` (optional CSV)
  - `groupes` (optional CSV) — filter by `fiche_cache.groupe`
  - `groupe_query` (optional string) — case-insensitive contains on `fiche_cache.groupe`
  - `agence_query` (optional string) — case-insensitive contains on `fiche_cache.agence_nom`
  - `prospect_query` (optional string) — searches `prospect_nom|prospect_prenom|prospect_email|prospect_tel|ficheId`
  - `sales_dates` (optional CSV `YYYY-MM-DD`) — filter by `fiche_cache.sales_date`
  - `sales_date_from` / `sales_date_to` (optional `YYYY-MM-DD`) — range on `fiche_cache.sales_date`
  - `has_recordings` (optional `"true"|"false"`) — filter by `fiche_cache.has_recordings`
  - `recordings_count_min` / `recordings_count_max` (optional ints) — range on `fiche_cache.recordings_count`
  - `fetched_at_from` / `fetched_at_to` (optional ISO datetime) — range on `fiche_cache.fetched_at`
  - `last_revalidated_from` / `last_revalidated_to` (optional ISO datetime) — range on `fiche_cache.last_revalidated_at`
  - `status` (optional CSV: pending,running,completed,failed)
  - `is_compliant` (optional `"true"|"false"`)
  - `date_from` / `date_to` (optional strings; passed to `new Date(...)`)
  - `audit_config_ids` (optional CSV)
  - `niveau` (optional CSV: EXCELLENT,BON,ACCEPTABLE,INSUFFISANT,REJET,PENDING)
  - `score_min` / `score_max` (optional numbers) — filters `scorePercentage`
  - `duration_min_ms` / `duration_max_ms` (optional ints)
  - `tokens_min` / `tokens_max` (optional ints)
  - `has_failed_steps` (optional `"true"|"false"`) — based on `failedSteps`
  - `automation_schedule_ids` (optional CSV) — audits triggered by an automation schedule
  - `automation_run_ids` (optional CSV) — audits triggered by an automation run
  - `trigger_source` (optional CSV) — e.g. `api,batch,automation`
  - `q` (optional string) — free-text search across fiche id / prospect name / config name / error message
  - `latest_only` (optional `"true"|"false"`, default true)
  - `include_deleted` (optional `"true"|"false"`, default false)
  - `sort_by` (optional: `created_at|completed_at|score_percentage|duration_ms`)
  - `sort_order` (optional: `asc|desc`)
  - `limit` (optional string → int; clamped 1..500)
  - `offset` (optional string → int; >=0)
- **Response 200**:
  - `{ success:true, data: AuditWithFiche[], pagination: { total, limit, offset, current_page, total_pages, has_next_page, has_prev_page } }`
- **Errors**:
  - `400` (`code=VALIDATION_ERROR`) if query parsing/validation fails.

### GET `/api/audits/grouped-by-fiches`

- **Purpose**: audits grouped by fiche with summary + pagination.
- **Query**: same as `/api/audits`.
- **Response 200**:
  - `{ success:true, data: FicheWithAudits[], pagination: {...} }`

### GET `/api/audits/grouped`

- **Purpose**: grouped/aggregated audits for dashboards.
- **Query**:
  - All filters supported by `GET /api/audits` (above)
  - `group_by` (**required**): one of:
    - `fiche` | `groupe` | `audit_config` | `status` | `niveau` | `automation_schedule` | `automation_run` | `created_day` | `score_bucket`
  - `bucket_size` (optional int) — only used when `group_by=score_bucket` (default 10)
  - Pagination uses `limit`/`offset` over **groups** (not audits)
- **Response 200**:
  - `{ success:true, data: Group[], pagination: {...}, meta: { group_by, bucket_size, truncated } }`

### POST `/api/audits/run`

- **Purpose**: queue audit run via Inngest.
- **Body** (as implemented):
  - `audit_config_id` (**required**, preferred): audit config id (string or number; code does `parseInt(...)`)
  - `audit_id` (**legacy alias**, accepted): same as `audit_config_id` (backwards compatible)
  - `fiche_id` (**required**): string/number
  - `user_id` (optional string)
  - `use_rlm` (optional boolean, alias: `useRlm`): if `true`, uses the **RLM-style transcript tools** approach; if omitted/false, uses the legacy **prompt** approach.
- **Response 200**:

```json
{
  "success": true,
  "message": "Audit queued for processing",
  "event_id": "01K...",
  "fiche_id": "1762209",
  "audit_config_id": 13,
  "metadata": { "timestamp": "2025-12-14T12:34:56.789Z", "status": "queued" }
}
```

- **Errors**:
  - `400`: `{ success:false, error:"Missing required parameters", message:"Both audit_config_id (or audit_id) and fiche_id are required" }`

Important: Prefer sending `audit_config_id`. `audit_id` is kept only for backwards compatibility.

### POST `/api/audits`

- **Purpose**: CRUD-friendly alias for `POST /api/audits/run` (same behavior).
- **Body**: same as `/api/audits/run`, plus optional:
  - `automation_schedule_id` (string) — if you want to tag the audit as coming from a schedule
  - `automation_run_id` (string)
  - `trigger_source` (string; default `"api"`)

### POST `/api/audits/run-latest`

- **Purpose**: queue audit run using latest active audit config.
- **Body**:
  - `fiche_id` (**required**)
  - `user_id` (optional)
  - `use_rlm` (optional boolean, alias: `useRlm`): same behavior as `/api/audits/run`.
- **Response 200**:
  - `{ success:true, message, event_id, fiche_id, audit_config_id, audit_config_name, metadata }`
- **Errors**:
  - `400`: missing fiche_id
  - `404`: no active config

### POST `/api/audits/batch`

- **Purpose**: queue batch audit (Inngest fan-out).
- **Body**:
  - `fiche_ids` (**required** array of strings)
  - `audit_config_id` (optional)
  - `user_id` (optional)
  - `use_rlm` (optional boolean, alias: `useRlm`): same behavior as `/api/audits/run` (applied to all audits in the batch)
- **Response 200**:
  - `{ success:true, message, fiche_ids, audit_config_id, batch_id, event_ids }`
- **Errors**:
  - `400`: invalid fiche_ids

### GET `/api/audits/by-fiche/:fiche_id`

- **Purpose**: list audits for a fiche.
- **Query**:
  - `include_details=true|false` (optional)
- **Response 200**:
  - `{ success:true, data: AuditWithConfig[]|AuditDetail[], count:number }`

### GET `/api/audits/:audit_id`

- **Purpose**: get audit detail payload.
- **Response 200**:
  - `{ success:true, data: AuditDetail }`
- **Note (resultData “latest view”)**:
  - The API returns `resultData` as a *latest view* rebuilt/overlaid from DB step results, so it reflects reruns and human overrides even though `audits.resultData` is stored as a lightweight workflow snapshot.
- **Note (approach tracking)**:
  - Completed audits include an `approach` object indicating whether `use_rlm` was used and which `transcript_mode` ran (`prompt|tools`).
  - You can read it from any of:
    - `resultData.metadata.approach`
    - `resultData.audit.approach`
    - `resultData.audit.results.approach`
- **Errors**:
  - `404`: `{ success:false, error:"Audit not found" }`

### PATCH `/api/audits/:audit_id`

- **Purpose**: update audit metadata (notes / soft delete / optional linkage fields).
- **Body**:
  - `notes` (optional string|null)
  - `deleted` (optional boolean) — soft-delete (`true`) or restore (`false`)
  - `automation_schedule_id` (optional string|null)
  - `automation_run_id` (optional string|null)
  - `trigger_source` (optional string|null)
  - `trigger_user_id` (optional string|null)

### DELETE `/api/audits/:audit_id`

- **Purpose**: soft-delete an audit (sets `deletedAt`; does not remove DB rows).

### POST `/api/audits/:audit_id/steps/:step_position/rerun`

- **Purpose**: queue rerun/re-analysis of a single audit step.
- **Path**:
  - `audit_id` (string)
  - `step_position` (int > 0)
- **Body** (optional):
  - `customPrompt` (string)
  - `customInstructions` (string; alias)
- **Response 200**:
  - `{ success:true, message:"Step re-run queued", event_id, audit_id, step_position }`
- **Behavior (important)**:
  - The rerun runs asynchronously (Inngest).
  - When it completes, the backend **persists the rerun into the stored audit**:
    - updates `audit_step_results` summary fields for that step
    - persists per-control-point results into normalized tables (`audit_step_result_control_points` + citations)
    - stores an audit trail entry (normalized; audit detail endpoints still expose `human_review` / `rerun_history` under the step payload in `resultData` for compatibility)
    - recomputes audit-level compliance summary (`audits.*` score/niveau/critical)
  - Frontend should refetch `GET /api/audits/:audit_id` after receiving `audit.step_completed` with `rerun_id`.
- **Errors**:
  - `400`: invalid step_position

### POST `/api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/rerun`

- **Purpose**: queue rerun/re-analysis of a **single control point** ("sub-step") inside a step, with optional custom prompt.
- **Path**:
  - `audit_id` (string)
  - `step_position` (int > 0)
  - `control_point_index` (int > 0, **1-based** index in the step's configured `controlPoints` array)
- **Body** (optional):
  - `customPrompt` (string)
  - `customInstructions` (string; alias)
- **Response 200**:
  - `{ success:true, message:"Control point re-run queued", event_id, audit_id, step_position, control_point_index }`
- **Notes**:
  - Rebuilds transcript context from DB + includes previous control point result in the rerun prompt for better contextualisation.
  - On completion, the backend **updates the stored audit** by updating the normalized control point row (fallback to legacy `raw_result.points_controle` for unbackfilled rows) and recomputing step score/conforme deterministically (then recomputes audit compliance summary).
  - Realtime uses `audit.step_started` / `audit.step_completed` with `rerun_id` and:
    - `rerun_scope: "control_point"`
    - `control_point_index`
- **Errors**:
  - `400`: invalid `step_position` or `control_point_index`

### GET `/api/audits/control-points/statuses`

- **Purpose**: list allowed checkpoint (control point) status values for UI dropdowns.
- **Response 200**:
  - `{ success:true, data: { statuses: ["PRESENT","ABSENT","PARTIEL","NON_APPLICABLE"] } }`

### GET `/api/audits/:audit_id/steps/:step_position/control-points/:control_point_index`

- **Purpose**: fetch the current stored status + comment for a single checkpoint (control point) inside a step.
- **Path**:
  - `audit_id` (BigInt string)
  - `step_position` (int > 0)
  - `control_point_index` (int > 0, **1-based** index in the step's configured `controlPoints` array; prefers normalized tables, falls back to legacy `rawResult.points_controle`)
- **Response 200**:
  - `{ success:true, data: { auditId, stepPosition, controlPointIndex, point, statut, commentaire } }`
- **Errors**:
  - `400`: invalid path params
  - `404`: step/control point not found or rawResult not available

### PATCH `/api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/review`

- **Purpose**: human override of a checkpoint status/comment.
- **Body** (validated by `validateReviewAuditControlPointInput()`):
  - `statut` (optional): `"PRESENT" | "ABSENT" | "PARTIEL" | "NON_APPLICABLE"`
  - `commentaire` (optional string)
  - `reviewer` (optional string): stored for audit trail
  - `reason` (optional string): stored for audit trail
- **Behavior**:
  - Updates the normalized control point row (`audit_step_result_control_points`) and/or `.commentaire` (legacy rows may still update `raw_result.points_controle[i]` until backfilled)
  - Stores an audit trail entry (normalized; also reflected under `human_review` in the step payload returned in `resultData`)
- **Response 200**:
  - `{ success:true, data: { auditId, stepPosition, controlPointIndex, point, statut, commentaire } }`
- **Errors**:
  - `400`: invalid path params or body
  - `404`: step/control point not found or rawResult not available

### PATCH `/api/audits/:audit_id/steps/:step_position/review`

- **Purpose**: human QA override of a single step result (accept/reject/partial), even if the AI decided otherwise.
- **Path**:
  - `audit_id` (BigInt string)
  - `step_position` (int > 0)
- **Body** (validated by `validateReviewAuditStepResultInput()`):
  - `conforme` (**required**): `"CONFORME" | "NON_CONFORME" | "PARTIEL"`
  - `traite` (optional boolean)
  - `score` (optional int >= 0)
  - `niveauConformite` (optional): `"EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET"`
  - `reviewer` (optional string): stored for audit trail
  - `reason` (optional string): stored for audit trail
- **Behavior**:
  - Updates the step summary fields in `audit_step_results` (so existing audit detail endpoints reflect the override).
  - Recomputes and persists the audit-level compliance summary (`score_percentage`, `niveau`, `is_compliant`, `critical_*`) from the current step results (best-effort).
  - Preserves the original AI output by storing an audit trail entry (normalized; also reflected under `human_review` in the step payload returned in `resultData`).
- **Response 200**:
  - `{ success:true, data: AuditStepResult }`
- **Errors**:
  - `400`: invalid `audit_id`, `step_position`, or body
  - `404`: step result not found

---

## Audit Configs API (`/api/audit-configs/*`)

Notes:
- All routes require `audit-configs.read`.
- Mutating routes (`POST|PUT|DELETE`) require `audit-configs.write`.

### GET `/api/audit-configs`

- **Query**:
  - `include_inactive=true|false`
  - `include_steps=true|false`
  - `include_stats=true|false`
- **Response 200**:
  - With `include_stats=true`: `{ success:true, data:[...], count }` (stats shape comes from service)
  - Else: `{ success:true, data:[...], count }`

### GET `/api/audit-configs/:id`

- **Query**:
  - `include_stats=true|false`
- **Response 200**:
  - `{ success:true, data: config }` or `{ success:true, data: { ...config, stats } }`
- **Errors**:
  - `404` NotFoundError via global error handler

### POST `/api/audit-configs`

- **Body**: validated by `validateCreateAuditConfigInput()` (Zod).
- **Response 201**: `{ success:true, data: config }`

### PUT `/api/audit-configs/:id`
### DELETE `/api/audit-configs/:id`
### POST `/api/audit-configs/:config_id/steps`
### PUT `/api/audit-configs/steps/:step_id`
### DELETE `/api/audit-configs/steps/:step_id`
### PUT `/api/audit-configs/:config_id/steps/reorder`
### GET `/api/audit-configs/:config_id/validate`
### GET `/api/audit-configs/:config_id/stats`

All are implemented in `src/modules/audit-configs/audit-configs.routes.ts` and validated by Zod schemas in `src/modules/audit-configs/audit-configs.schemas.ts`.

---

## Automation API (`/api/automation/*`)

Notes:
- All routes require `automation.read`.
- Mutating routes (`POST|PATCH|DELETE` + trigger) require `automation.write`.

### POST `/api/automation/schedules`

- **Purpose**: create schedule.
- **Body**: validated by `validateCreateAutomationScheduleInput()` (Zod).
- **Response 201**: `{ success:true, data: AutomationSchedule }`

### GET `/api/automation/schedules`

- **Query**:
  - `include_inactive=true|false`
- **Response 200**: `{ success:true, data: AutomationSchedule[], count }`

### GET `/api/automation/schedules/:id`
### PATCH `/api/automation/schedules/:id`
### DELETE `/api/automation/schedules/:id`

- `:id` is a **string** path param, but is interpreted as **BigInt** internally.

### POST `/api/automation/trigger`

- **Purpose**: trigger schedule run (Inngest event `automation/run`).
- **Body**: validated by `validateTriggerAutomationInput()`.
- **Response 200**:

```json
{
  "success": true,
  "message": "Automation triggered successfully",
  "schedule_id": 13,
  "event_ids": ["01K..."]
}
```

Important: `scheduleId` in the request is currently validated as a **number**, but schedule IDs in DB are **BigInt** and API responses use **string IDs**. See “Known issues / proposed fixes”.

### GET `/api/automation/diagnostic`

- **Purpose**: returns diagnostics about Inngest configuration based on env.

### GET `/api/automation/schedules/:id/runs`

- **Query**:
  - `limit` (default 20)
  - `offset` (default 0)
- **Response 200**: `{ success:true, data: AutomationRun[], count, limit, offset }`

### GET `/api/automation/runs/:id`
### GET `/api/automation/runs/:id/logs`

- `/logs` query:
  - `level` optional (string)
- Response includes `count`.

---

## Products API (`/api/products/*`)

Notes:
- All routes require `products.read`.
- Mutating routes (`POST|PUT|DELETE`) require `products.write`.

### GET `/api/products/stats`
### GET `/api/products/search?q=...`
### GET `/api/products/link-fiche/:ficheId`
### CRUD
- Groupes: `/groupes`, `/groupes/:id`
- Gammes: `/gammes`, `/gammes/:id`
- Formules: `/formules`, `/formules/:id`

All implemented in `src/modules/products/products.routes.ts`.

Important: `POST /api/products/gammes` and `POST /api/products/formules` accept `groupeId`/`gammeId` as **numeric strings or numbers** (coerced to BigInt server-side).

---

## Chat API (streaming) (`/api/*`)

Notes:
- **Permissions**:
  - History endpoints require `chat.read` + the underlying resource read permission:
    - Audit history: `audits.read`
    - Fiche history: `fiches.read`
  - Streaming chat endpoints require `chat.use` (maps to `chat` grant `write=true`) + the underlying resource read permission.
- **Scope**: chat endpoints enforce scope for the referenced audit/fiche (prevents cross-groupe data access via LLM context).

### GET `/api/audits/:audit_id/chat/history`

- **Response 200**: `{ success:true, data:{ conversationId, ficheId, auditId, messages, messageCount } }`
- **Note**:
  - Returns the **most recent ~50 messages** for the conversation (DB query is `take: 50`), so the frontend should treat this as a window, not the full history.
  - Messages are returned in chronological order (oldest → newest).

### GET `/api/fiches/:fiche_id/chat/history`

- **Response 200**: `{ success:true, data:{ conversationId, ficheId, messages, messageCount } }`
- **Note**:
  - Returns the **most recent ~50 messages** for the conversation (DB query is `take: 50`), so the frontend should treat this as a window, not the full history.
  - Messages are returned in chronological order (oldest → newest).

### POST `/api/audits/:audit_id/chat`
### POST `/api/fiches/:fiche_id/chat`

- **Purpose**: stream AI response as SSE.
- **Request body**:

```json
{ "message": "..." }
```

- **Response**: `Content-Type: text/event-stream`
  - Many chunks: `data: {"text":"..."}`
  - Final citations (optional): `data: {"citations":[ ... ]}`
  - Completion: `data: [DONE]`
  - On streaming error after headers: `data: {"type":"error","error":"...","code":"STREAM_ERROR"}`

Important: chat uses **DB-only** transcription data (multi-replica safe).

---

## Realtime SSE API (`/api/realtime/*`)

Legacy SSE realtime endpoints have been **removed**. Use Pusher Channels instead:

- `POST /api/realtime/pusher/auth`
- `POST /api/realtime/pusher/test`
- Subscribe to entity channels (`private-audit-*`, `private-fiche-*`, `private-job-*`, `private-global`)

---

## Realtime Pusher API (`/api/realtime/pusher/*`)

This backend can publish realtime events via **Pusher Channels**.

- **Docs**:
  - Setup + overview: `docs/REALTIME.md`
  - Frontend event catalog: `docs/FRONTEND_PUSHER_EVENTS.md`
- **Channels**:
  - `private-audit-{auditId}` (may be tracking id or DB id)
    - When payload contains `audit_db_id`, the backend may also publish to `private-audit-{audit_db_id}` for easy “notify → refetch”.
  - `private-fiche-{ficheId}`
  - `private-job-{jobId}` (derived from `jobId` or `job_id` in the payload)
    - Progressive fetch uses a job id like `ck...`
    - Automation runs use `job_id = "automation-run-{run_id}"` → channel `private-job-automation-run-{run_id}`
    - Batch uses `batch_id` which is routed to `private-job-{batch_id}`
  - `private-global` (batch + notification + any unscoped events)
- **Event names**: mostly identical to existing webhook/SSE event names (e.g. `audit.progress`, `transcription.completed`, `fiches.progressive_fetch.progress`)
  - New: automation emits `automation.run.*` events for run-level UX (`started|selection|completed|failed`).
- **Payloads**: Pusher publishes the existing **domain payload object** (the same object that used to live under `.data` in system webhook payloads / SSE envelopes). No additional wrapper is added.

### POST `/api/realtime/pusher/auth`

- **Purpose**: sign subscriptions for **private/presence** channels (Pusher JS `authEndpoint`).
- **Auth**:
  - Requires a **user access token** (JWT) via `Authorization: Bearer <access_token>`.
  - Requires permission: `realtime.auth`.
  - `user_id` for presence channels is derived from the JWT; client-provided `user_id` is ignored.
- **Authorization rules (coarse RBAC by channel kind)**:
  - `private-audit-*` requires `audits.read`
  - `private-fiche-*` requires `fiches.read`
  - `private-job-*` requires one of: `automation.read` / `audits.read` / `fiches.read`
  - `private-global` and `presence-global` are allowed for users with `realtime.auth`
  - `presence-org-*` requires `automation.read`
- **Scope enforcement (SELF/GROUP/ALL)**:
  - In non-test environments, the auth endpoint also enforces scope for:
    - `private-audit-*` (based on the audit’s linked fiche, or by deriving `fiche_id` from tracking ids like `audit-<ficheId>-...`)
    - `private-fiche-*` (based on `fiche_cache.groupe` and `fiche_cache_information.attribution_user_id`)
- **Body**:

```json
{ "socket_id": "123.456", "channel_name": "private-audit-audit-123" }
```

- **Response 200**: Pusher auth payload (raw, not wrapped)

```json
{ "auth": "PUSHER_KEY:signature" }
```

### POST `/api/realtime/pusher/test`

- **Purpose**: publish a simple event for quick end-to-end verification.
- **Auth**: required (any authenticated caller; in practice use a user JWT).
- **Body** (optional):
  - `channel` (default: `private-realtime-test` or `realtime-test`)
  - `event` (default: `realtime.test`)
  - `payload` (default: `{ message, ts }`)

---

## Webhooks (backend → frontend)

### Progressive fetch job webhooks (per-request URL)

- **Triggered by**: `/api/fiches/status/by-date-range?webhookUrl=...`
- **Destination**: `webhookUrl` stored on `ProgressiveFetchJob`
- **Secret**: `webhookSecret` stored on `ProgressiveFetchJob` (optional)
- **Payload** (`src/modules/fiches/fiches.webhooks.ts`):

```json
{
  "event": "progress",
  "jobId": "cku1zqk1w0000abcd1234",
  "timestamp": "2025-12-14T12:34:56.789Z",
  "data": {
    "status": "processing",
    "progress": 66,
    "completedDays": 2,
    "totalDays": 3,
    "totalFiches": 12,
    "currentFichesCount": 7,
    "latestDate": "2025-12-02",
    "partialData": [
      {
        "ficheId": "1762209",
        "groupe": "GROUPE",
        "prospectNom": "DOE",
        "prospectPrenom": "JANE",
        "recordingsCount": 2,
        "createdAt": "2025-12-14T10:00:00.000Z"
      }
    ]
  }
}
```

- **Headers**:
  - `X-Webhook-Event: progress|complete|failed`
  - `X-Webhook-Job-Id: <jobId>`
  - `X-Webhook-Delivery-Id: <deliveryId>`
  - `X-Webhook-Attempt: <n>`
  - `X-Webhook-Timestamp: <payload.timestamp>`
  - If secret set:
    - `X-Webhook-Signature: sha256=<hex>`
    - `X-Webhook-Signature-V2: sha256=<hex>`
- **Retries**:
  - Default 3 attempts with exponential backoff (2s,4s,8s,... capped 30s)
  - Delivery attempts + results stored in DB (`WebhookDelivery` table)
- **SSRF guard**:
  - Per-request `webhookUrl` is validated by `validateOutgoingWebhookUrl()` (see env `WEBHOOK_ALLOWED_ORIGINS`).

---

## Frontend-ready TypeScript contract (copy/paste)

This is a **frontend DTO + event** contract that matches runtime behavior.
Notes:
- `Date` values are serialized as ISO strings on the wire.
- BigInt IDs are serialized as strings by most endpoints (`jsonResponse`/`ok`).

```ts
// docs/BACKEND_FRONTEND_CONTRACT.md — frontend DTOs

export type ISODateString = string; // "YYYY-MM-DD"
export type ISODateTimeString = string; // ISO 8601

export type ApiErrorResponse = {
  success: false;
  error: string;
  code?: string;
  message?: string;
  stack?: string; // dev only
};

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

// --------------------------------------------
// Authentication (JWT)
// --------------------------------------------

export type PermissionScope = "SELF" | "GROUP" | "ALL";

export type PermissionGrantDto = {
  key: string; // e.g. "audits", "fiches", "admin.roles"
  read: boolean;
  write: boolean;
  read_scope: PermissionScope;
  write_scope: PermissionScope;
};

export type AuthUserDto = {
  id: string; // BigInt serialized as string
  email: string;
  crm_user_id: string | null;
  groupes: string[];
  roles: string[];
  permissions: PermissionGrantDto[];
};

export type AuthTokensDto = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number; // seconds
  user: AuthUserDto;
};

export type LoginRequest = { email: string; password: string };
export type LoginResponse = ApiSuccessResponse<AuthTokensDto>;

export type RefreshRequest = { refresh_token?: string };
export type RefreshResponse = ApiSuccessResponse<AuthTokensDto>;

export type LogoutResponse = ApiSuccessResponse<{ logged_out: true }>;
export type MeResponse = ApiSuccessResponse<{ user: AuthUserDto }>;

// --------------------------------------------
// Health
// --------------------------------------------

export type HealthResponse = {
  status: "ok";
  timestamp: ISODateTimeString;
  service: "ai-audit-system";
  version: "2.3.0";
  instance: string;
};

// --------------------------------------------
// Realtime (Pusher Channels)
// --------------------------------------------
//
// Legacy realtime (SSE under `/api/realtime/*` + backend→frontend “system webhooks”) has been removed.
// Pusher publishes the domain payload object (no wrapper).
//
// Channels:
// - private-audit-{auditId}
// - private-fiche-{ficheId}
// - private-job-{jobId}
// - private-global
//
// Full event catalog + payload fields: see `docs/FRONTEND_PUSHER_EVENTS.md`
//
// Optional: union of the main event names:
export type RealtimeEventName =
  | "audit.started"
  | "audit.fiche_fetch_started"
  | "audit.fiche_fetch_completed"
  | "audit.config_loaded"
  | "audit.transcription_check"
  | "audit.timeline_generated"
  | "audit.analysis_started"
  | "audit.step_started"
  | "audit.step_completed"
  | "audit.step_failed"
  | "audit.progress"
  | "audit.compliance_calculated"
  | "audit.completed"
  | "audit.failed"
  | "transcription.started"
  | "transcription.status_check"
  | "transcription.recording_started"
  | "transcription.recording_completed"
  | "transcription.recording_failed"
  | "transcription.progress"
  | "transcription.completed"
  | "transcription.failed"
  | "batch.progress"
  | "batch.completed"
  | "notification"
  | "fiches.progressive_fetch.created"
  | "fiches.progressive_fetch.progress"
  | "fiches.progressive_fetch.complete"
  | "fiches.progressive_fetch.failed"
  | "automation.run.started"
  | "automation.run.selection"
  | "automation.run.completed"
  | "automation.run.failed";

// --------------------------------------------
// Progressive fetch webhooks (/api/fiches/status/by-date-range?webhookUrl=...)
// --------------------------------------------

export type ProgressiveFetchWebhookEvent = "progress" | "complete" | "failed";

export type ProgressiveFetchWebhookPayload = {
  event: ProgressiveFetchWebhookEvent;
  jobId: string;
  timestamp: ISODateTimeString;
  data: {
    status: string;
    progress?: number;
    completedDays?: number;
    totalDays?: number;
    totalFiches?: number;
    currentFichesCount?: number;
    latestDate?: ISODateString;
    error?: string;
    dataUrl?: string;
    partialData?: Array<{
      ficheId: string;
      groupe: string | null;
      prospectNom: string | null;
      prospectPrenom: string | null;
      recordingsCount: number;
      createdAt: ISODateTimeString;
    }>;
  };
};

export type ProgressiveFetchPusherCreatedPayload = {
  jobId: string;
  status: "processing" | string;
  startDate: ISODateString;
  endDate: ISODateString;
  progress: number;
  completedDays: number;
  totalDays: number;
  totalFiches: number;
  datesCompleted: ISODateString[];
  datesRemaining: ISODateString[];
  datesFailed: ISODateString[];
};

export type ProgressiveFetchPusherProgressPayload = {
  jobId: string;
  status: "processing";
  startDate: ISODateString;
  endDate: ISODateString;
  progress: number;
  completedDays: number;
  totalDays: number;
  totalFiches: number;
  datesCompleted: ISODateString[];
  datesRemaining: ISODateString[];
  datesFailed: ISODateString[];
  latestDate: ISODateString;
};

export type ProgressiveFetchPusherTerminalPayload = {
  jobId: string;
  status: "complete" | "failed";
  startDate: ISODateString;
  endDate: ISODateString;
  progress: 100;
  completedDays: number;
  totalDays: number;
  totalFiches: number;
  datesCompleted: ISODateString[];
  datesRemaining: [];
  datesFailed: ISODateString[];
};

// --------------------------------------------
// Automation (REST + realtime)
// --------------------------------------------

export type AutomationFicheSelectionDto = {
  mode: "date_range" | "manual" | "filter";
  dateRange?: "last_24h" | "yesterday" | "last_week" | "last_month" | "custom";
  customStartDate?: ISODateString;
  customEndDate?: ISODateString;
  groupes?: string[];
  onlyWithRecordings?: boolean;
  onlyUnaudited?: boolean;
  useRlm?: boolean;
  maxFiches?: number;
  maxRecordingsPerFiche?: number;
  ficheIds?: string[];
};

export type AutomationScheduleDto = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  scheduleType: "MANUAL" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRON";
  cronExpression: string | null;
  timezone: string;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  ficheSelection: AutomationFicheSelectionDto;
  runTranscription: boolean;
  skipIfTranscribed: boolean;
  transcriptionPriority: string;
  runAudits: boolean;
  useAutomaticAudits: boolean;
  specificAuditConfigs: number[];
  continueOnError: boolean;
  retryFailed: boolean;
  maxRetries: number;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  webhookUrl: string | null;
  notifyEmails: string[];
  externalApiKey: string | null;
  lastRunAt: ISODateTimeString | null;
  lastRunStatus: string | null;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
};

export type AutomationRunDto = {
  id: string;
  scheduleId: string;
  status: string;
  startedAt: ISODateTimeString;
  completedAt: ISODateTimeString | null;
  durationMs: number | null;
  totalFiches: number;
  successfulFiches: number;
  failedFiches: number;
  transcriptionsRun: number;
  auditsRun: number;
  errorMessage: string | null;
  errorDetails: unknown | null;
  configSnapshot: unknown;
  resultSummary: unknown | null;
};

// Realtime: automation run events are published on `private-job-automation-run-{run_id}`
// (payload contains `job_id: "automation-run-{run_id}"`).

export type AutomationRunStartedPusherPayload = {
  job_id: string;
  schedule_id: string;
  run_id: string;
  due_at: ISODateTimeString | null;
  status: "running";
};

export type AutomationRunSelectionPusherPayload = {
  job_id: string;
  schedule_id: string;
  run_id: string;
  mode: "date_range" | "manual" | "filter";
  dateRange: string | null;
  groupes?: string[];
  groupes_count: number;
  onlyWithRecordings: boolean;
  onlyUnaudited: boolean;
  maxFiches: number | null;
  maxRecordingsPerFiche: number | null;
  useRlm: boolean;
  total_fiches: number;
};

export type AutomationRunCompletedPusherPayload = {
  job_id: string;
  schedule_id: string;
  run_id: string;
  status: "completed" | "partial" | "failed";
  total_fiches: number;
  successful_fiches: number;
  failed_fiches: number;
  ignored_fiches?: number;
  transcriptions_run?: number;
  audits_run?: number;
  duration_ms?: number;
  // Present for early returns (no fiches, no dates, etc.)
  reason?: string;
};

export type AutomationRunFailedPusherPayload = {
  job_id: string;
  schedule_id: string;
  run_id: string;
  status: "failed";
  error: string;
  duration_ms: number;
};

// --------------------------------------------
// Chat streaming citations (from src/schemas.ts)
// --------------------------------------------

export type ChatCitation = {
  texte: string;
  minutage: string; // "MM:SS"
  minutage_secondes: number;
  speaker: string; // "speaker_0", ...
  recording_index: number; // 0-based
  chunk_index: number; // 0-based
  recording_date: string; // "DD/MM/YYYY"
  recording_time: string; // "HH:MM"
  recording_url: string;
};
```

---

## Known issues / inconsistencies (flagged from code)

- **OpenAPI is 3.0.0, not 3.1.0** (`src/config/swagger.ts`).  
  - **Fix**: decide if you truly want 3.1; update swagger config + verify downstream tooling.

- **Audits run endpoint field naming mismatch**:
  - `POST /api/audits/run` accepts both `audit_config_id` (**preferred**) and legacy `audit_id` (backwards compatible).

---

## Frontend action list (practical)

- **Base URL**: keep using `http://localhost:3002` (or the load balancer URL in prod). API paths stay the same.
- **Authentication**:
  - Call `POST /api/auth/login` → store `access_token` (JWT) in memory.
  - Attach `Authorization: Bearer <access_token>` to **all** `/api/*` calls (including `POST /api/realtime/pusher/auth`).
  - When you get a `401` due to expiry, call `POST /api/auth/refresh` (with `credentials: "include"`) then retry the failed call.
  - On logout, call `POST /api/auth/logout` (with `credentials: "include"`) and clear the in-memory access token.
- **Progressive fetch**:
  - Call `GET /api/fiches/status/by-date-range?...`
  - If `meta.backgroundJobId` exists, either:
    - subscribe via **Pusher** to channel `private-job-{jobId}` and listen for `fiches.progressive_fetch.*` events, **or**
    - poll `GET /api/fiches/webhooks/fiches?jobId=...`
- **Realtime audit/transcription progress**:
  - subscribe via **Pusher** to `private-fiche-{ficheId}` and/or `private-audit-{auditId}`
  - listen for `audit.*`, `transcription.*`, `batch.*`, `notification` events (see `docs/FRONTEND_PUSHER_EVENTS.md`)
- **Chat streaming**:
  - treat response as SSE and parse `data:` lines; stop on `[DONE]`.


