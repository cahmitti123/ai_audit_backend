## Backend ↔ Frontend Contract (NCA Audit backend)

**Audience**: Next.js/browser frontend (REST + SSE + webhooks + chat streaming)  
**Backend repo**: this workspace (`ai-audit`)  
**Backend base URL (dev default)**: `http://localhost:3002`  
**Swagger/OpenAPI (exported by backend)**: `GET /api-docs.json` (OpenAPI **3.0.0**) and UI at `GET /api-docs`

### Inputs limitation (important)

Your original request referenced **frontend-repo** files:
- `docs/FRONTEND_INTEGRATION.md`
- `src/types/*.types.ts`

Those files are **not present** in this backend workspace, so this document is **backend-verified only** (routes + validators + runtime behavior). If you want a strict “frontend expectation diff”, share those frontend files or point me at the frontend repo.

---

## Global HTTP behavior

### Base paths

- **Non-API**:
  - `GET /health`
  - `GET /api-docs` (Swagger UI)
  - `GET /api-docs.json` (OpenAPI JSON)
- **API routers** (mounted in `src/app.ts`):
  - `/api/fiches/*`
  - `/api/recordings/*`
  - `/api/transcriptions/*`
  - `/api/audit-configs/*`
  - `/api/audits/*` (includes step re-run endpoints)
  - `/api/automation/*`
  - `/api/products/*`
  - `/api/realtime/*` (SSE)
  - `/api/*` (chat endpoints are mounted here)
  - `/api/webhooks/*` (testing endpoints)
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

**No authentication or authorization middleware is enforced in routes.**  
Assume **public access** to all endpoints unless you add auth.

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

## Fiches API (`/api/fiches/*`)

### GET `/api/fiches/search`

- **Purpose**: Fetch CRM “sales list with calls” for a single day (via external API), optionally enriched with DB status.
- **Query**:
  - `date` (required, string `YYYY-MM-DD`)
  - `includeStatus` (optional, string; anything except `"false"` means true)
- **Response 200** (no `success` wrapper; it returns the service result directly):
  - If `includeStatus=false`: `{ fiches: SalesFicheWithRecordings[]; total: number }`
  - Else: `{ fiches: SalesFicheWithStatus[]; total: number }`
- **Errors**:
  - `400`: validation error (missing/invalid date)
  - `500`: unexpected errors

### GET `/api/fiches/:fiche_id(\\d+)`

- **Purpose**: Get fiche “full details” from DB cache; may fetch full details from CRM if only minimal sales-list cache exists.
- **Query**:
  - `refresh=true` (optional) forces CRM refresh (requires fiche already cached to get `cle`)
- **Response 200**: returns the cached/full fiche payload (BigInt-safe). Shape matches `FicheDetailsResponse` in `src/modules/fiches/fiches.schemas.ts`.
- **Errors**:
  - `400` (`code=VALIDATION_ERROR`): if fiche is not in cache (message: *“Fetch via date range endpoint first to get cle.”*), or if `refresh=true` but `cle` is missing.
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
  - Emits Inngest event `fiches/progressive-fetch-continue` (idempotent per job).
  - Realtime SSE emits:
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
- **Response 200**:

```json
{ "success": true, "data": [/* prisma recording rows */], "count": 2 }
```

Notes:
- Shape is Prisma recording rows (BigInt → string if present).

---

## Transcriptions API (`/api/transcriptions/*`)

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

### GET `/api/audits`

- **Purpose**: list audits with filtering + pagination.
- **Query**:
  - `fiche_ids` (optional CSV)
  - `status` (optional CSV: pending,running,completed,failed)
  - `is_compliant` (optional `"true"|"false"`)
  - `date_from` / `date_to` (optional strings; passed to `new Date(...)`)
  - `audit_config_ids` (optional CSV)
  - `sort_by` (optional: `created_at|completed_at|score_percentage|duration_ms`)
  - `sort_order` (optional: `asc|desc`)
  - `limit` (optional string → int; clamped 1..500)
  - `offset` (optional string → int; >=0)
- **Response 200**:
  - `{ success:true, data: AuditWithFiche[], pagination: { total, limit, offset, current_page, total_pages, has_next_page, has_prev_page } }`
- **Errors**:
  - `500` with `{ success:false, error:"Invalid query parameters" }` if parsing fails.

### GET `/api/audits/grouped-by-fiches`

- **Purpose**: audits grouped by fiche with summary + pagination.
- **Query**: same as `/api/audits`.
- **Response 200**:
  - `{ success:true, data: FicheWithAudits[], pagination: {...} }`

### POST `/api/audits/run`

- **Purpose**: queue audit run via Inngest.
- **Body** (as implemented):
  - `audit_config_id` (**required**, preferred): audit config id (string or number; code does `parseInt(...)`)
  - `audit_id` (**legacy alias**, accepted): same as `audit_config_id` (backwards compatible)
  - `fiche_id` (**required**): string/number
  - `user_id` (optional string)
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

### POST `/api/audits/run-latest`

- **Purpose**: queue audit run using latest active audit config.
- **Body**:
  - `fiche_id` (**required**)
  - `user_id` (optional)
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
- **Errors**:
  - `404`: `{ success:false, error:"Audit not found" }`

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
- **Errors**:
  - `400`: invalid step_position

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
  - Preserves the original AI output by appending an entry into `raw_result.human_review` (audit trail).
- **Response 200**:
  - `{ success:true, data: AuditStepResult }`
- **Errors**:
  - `400`: invalid `audit_id`, `step_position`, or body
  - `404`: step result not found

---

## Audit Configs API (`/api/audit-configs/*`)

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

### GET `/api/audits/:audit_id/chat/history`

- **Response 200**: `{ success:true, data:{ conversationId, ficheId, auditId, messages, messageCount } }`

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
  - On streaming error after headers: `data: {"error":"..."}`

Important: chat uses **DB-only** transcription data (multi-replica safe).

---

## Realtime SSE API (`/api/realtime/*`)

### GET `/api/realtime/audits/:auditId`
### GET `/api/realtime/fiches/:ficheId`
### GET `/api/realtime/jobs/:jobId`

- **Purpose**: realtime event stream backed by Redis Streams when `REDIS_URL` is configured; falls back to in-process emitter if not.
- **Headers**:
  - Response sets:
    - `Content-Type: text/event-stream; charset=utf-8`
    - `Cache-Control: no-cache, no-transform`
    - `Connection: keep-alive`
    - `X-Accel-Buffering: no`
- **Reconnect / resume**:
  - Send `Last-Event-ID: <redis-stream-id>` header **OR** query `?lastEventId=<id>`.
  - If omitted, server uses `$` (new events only).
- **Heartbeat**:
  - Comment line every 15s: `: heartbeat <epochMs>`
- **Event framing**:
  - `event: <evt.type>`
  - `data: <JSON.stringify(evt)>`
  - where `evt` matches `RealtimeEvent` in `src/shared/realtime.ts`.

---

## Webhooks (backend → frontend)

There are **two** webhook mechanisms in this backend:

### 1) Global “system webhook” (configured by env)

- **Destination**: `process.env.FRONTEND_WEBHOOK_URL`
- **Secret**: `process.env.WEBHOOK_SECRET` (optional)
- **Payload** (`src/shared/webhook.ts`):

```json
{
  "event": "audit.progress",
  "timestamp": "2025-12-14T12:34:56.789Z",
  "source": "audit-service",
  "data": { "..." : "..." }
}
```

- **Headers**:
  - `Content-Type: application/json`
  - `User-Agent: AI-Audit-Webhook/1.0`
  - `X-Webhook-Event: <eventType>`
  - `X-Webhook-Delivery-Id: <uuid>`
  - `X-Webhook-Attempt: <n>`
  - `X-Webhook-Timestamp: <payload.timestamp>`
  - `X-Webhook-Source: <source>`
  - If `WEBHOOK_SECRET` set:
    - `X-Webhook-Signature: sha256=<hex>` where hex is HMAC-SHA256(body)
    - `X-Webhook-Signature-V2: sha256=<hex>` where hex is HMAC-SHA256(`${timestamp}.${body}`)
- **Retries**:
  - Non-`.progress` events: `WEBHOOK_MAX_ATTEMPTS` (default 3) with backoff (2s,4s,8s,... capped 30s)
  - `.progress` events: `maxAttempts = 1` (no retries)
- **Event names**:
  - See `WebhookEventType` union in `src/shared/webhook.ts` (audit.*, transcription.*, batch.*, notification).

### 2) Progressive fetch job webhooks (per-request URL)

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
// Realtime SSE event envelope (/api/realtime/*)
// --------------------------------------------

export type RealtimeEvent<T = unknown> = {
  id?: string; // Redis stream id (present when Redis is enabled)
  topic: string; // audit:{auditId} | fiche:{ficheId} | job:{jobId}
  type: string; // event name
  timestamp: ISODateTimeString;
  source: string;
  data: T;
};

export type RealtimeTopics =
  | { kind: "audit"; topic: `audit:${string}` }
  | { kind: "fiche"; topic: `fiche:${string}` }
  | { kind: "job"; topic: `job:${string}` };

// --------------------------------------------
// Global system webhooks (env FRONTEND_WEBHOOK_URL)
// --------------------------------------------

export type SystemWebhookEventType =
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
  | "notification";

export type SystemWebhookPayload = {
  event: SystemWebhookEventType;
  timestamp: ISODateTimeString;
  source: string;
  data: Record<string, unknown>;
};

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

export type ProgressiveFetchRealtimeCreated = RealtimeEvent<{
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
}>;

export type ProgressiveFetchRealtimeProgress = RealtimeEvent<{
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
}>;

export type ProgressiveFetchRealtimeTerminal = RealtimeEvent<{
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
}>;

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
- **Progressive fetch**:
  - Call `GET /api/fiches/status/by-date-range?...`
  - If `meta.backgroundJobId` exists, either:
    - subscribe to `GET /api/realtime/jobs/:jobId` and listen for `fiches.progressive_fetch.*` events, **or**
    - poll `GET /api/fiches/webhooks/fiches?jobId=...`
- **Realtime audit/transcription progress**:
  - subscribe to `GET /api/realtime/fiches/:ficheId` and/or `GET /api/realtime/audits/:auditId`
  - handle `RealtimeEvent` envelopes and resume with `Last-Event-ID`.
- **Chat streaming**:
  - treat response as SSE and parse `data:` lines; stop on `[DONE]`.
- **Webhook verification (recommended)**:
  - verify `X-Webhook-Signature-V2` using HMAC-SHA256 of `${X-Webhook-Timestamp}.${rawBody}` with your shared secret.
  - dedupe by `X-Webhook-Delivery-Id`.


