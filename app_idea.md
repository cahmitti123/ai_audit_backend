# Main Idea (NestJS rewrite)
This will be a backend for a **callcenter QA audit** app.

Key requirements:
- **Authentication + authorization** (admin + API consumers)
- Frontend communicates through **API Keys**
- Admin can **generate / revoke / rotate API Keys**
- **Granular roles & permissions**:
  - CRUD operations (create/read/update/delete + custom actions)
  - Scope per permission: **self / team / org / all**
  - Roles can be assigned to **users** and/or **groups** (team membership)
- The app should be **dockerized**, horizontally scalable (multiple instances)
- Use **Redis** + **Inngest** for cross-instance job dispatching and coordination
- Database: **Postgres (Supabase)**

---

## Target architecture (professional + scalable)
- **Two runtimes**
  - **API app** (NestJS HTTP): REST/JSON + SSE/webhooks, stateless
  - **Worker app** (NestJS + Inngest functions): background workflows (audits, transcriptions, progressive fetch, automation)
- **Persistence**
  - Postgres (Supabase) for business data
  - Redis for coordination (locks, idempotency keys, pub/sub/streams if needed)
  - Optional object storage (S3/Supabase Storage) for **large payloads** (audio, raw provider payloads)

---

## Core modules (platform)
### `ConfigModule`
- Typed env validation (fail fast at boot)
- Separate configs per environment (dev/staging/prod)

### `DatabaseModule` (Prisma recommended)
- Prisma client lifecycle (singleton per process)
- Transactions helpers + soft delete patterns (if needed)

### `RedisModule`
- Shared Redis connection
- Distributed locks + rate limit counters + idempotency keys

### `WorkflowsModule` (Inngest integration)
- Registers Inngest client and functions
- Enforces patterns: orchestrator → fan-out → finalizer
- Deterministic event IDs for idempotency
- Concurrency limits per tenant/team/audit/job

### `HttpModule` (API hardening)
- Global exception filter (safe errors, no header leaks)
- Request validation (DTOs)
- Request ID + structured logs
- CORS + Helmet + body size limits

### `ObservabilityModule`
- Pino logs (JSON), metrics, tracing hooks
- Audit-safe logging (PII / secret redaction)

### `HealthModule`
- Liveness/readiness endpoints
- Checks Postgres + Redis + Inngest connectivity

---

## Identity & access control modules (must-have)
### `AuthModule`
- Admin authentication (JWT/session) for backoffice access
- Password hashing + refresh token rotation (or SSO later)

### `ApiKeysModule`
- Create / list / revoke / rotate API keys
- Store **only hashed keys** (never store plaintext key)
- Optional: key expiry, last-used timestamp, per-key quotas

### `UsersModule`
- CRUD users
- Invite flow (optional), deactivate/lock users

### `TeamsModule`
- CRUD teams
- Membership management (add/remove users, roles per team)

### `RolesPermissionsModule` (RBAC + scopes)
- Define roles
- Define permissions as: `(resource, action, scope)`
- Scopes: `SELF` | `TEAM` | `ORG` | `ALL`
- Policies/guards in NestJS to enforce access consistently

### `TenancyModule` (recommended)
- Organizations/workspaces
- Data isolation rules (every domain entity belongs to an org)

---

## Domain modules (from current backend, kept and improved)
### `AuditConfigsModule`
- Manage audit templates/configs (e.g. “18 points”)
- Versioning of configs (immutable versions, active version pointer)
- Mark configs as “automatic” for automation runs

### `AuditsModule`
- Create audit runs for a fiche/recording/transcription
- Step fan-out analysis (one worker per control point)
- Evidence gating (validate citations against transcript)
- Transcript context strategies:
  - **Prompt mode**: embed full timeline/transcript in the step prompt (simple, expensive tokens)
  - **Tools mode**: keep transcript out of the prompt; LLM uses constrained tools (`searchTranscript`, `getTranscriptChunks`) to fetch evidence (robust for long calls)
- Optional: transcript **vector store** for fast retrieval (kept as an implementation detail, not a domain requirement)
- Finalizer/aggregator: completes audit once all step results exist
- Rerun flows:
  - Rerun entire audit
  - Rerun specific control point(s)

### `FichesModule`
- CRM integration (fetch fiche list/details)
- Caching strategy (avoid refetching; TTL + revalidation)
- Progressive fetch (date range → per-day fan-out → finalize)
- Optional webhook callbacks for progress updates

### `JobsModule` (recommended)
- Track long-running jobs explicitly in DB (status, progress, errors)
- Progressive fetch jobs (start/end dates, per-day status, retries)
- Webhook delivery attempts (queue, retry, dead-letter)

### `RecordingsModule`
- Link recordings to fiches
- Parse/normalize recording metadata
- Optional: download to storage, track storage location

### `TranscriptionsModule`
- Provider integration (ElevenLabs)
- Store transcript (structured) + timestamps
- Retry policy + provider error sanitization
- Optional: async transcription fan-out per recording

### `AutomationModule`
- Schedule definitions (cron + timezone)
- Run orchestration:
  - Select fiches
  - Fetch details/recordings
  - Transcribe if needed
  - Run audits
- Guardrails:
  - Skip fiches with too many recordings (configurable)
  - Per-tenant quotas/concurrency

### `RealtimeModule`
- Primary realtime: **Pusher Channels** (notify → refetch)
- SSE is reserved for **streaming** endpoints (chat); no durable “realtime state” over SSE
- Cross-instance delivery (no in-memory event state)

### `WebhooksModule`
- Outgoing webhooks for domain events (job progress, audit completed, etc.)
- SSRF protection (allowlist, safe URL validation)
- Retries + dead-letter tracking

### `ProductsModule` (business domain)
- CRUD products (insurance products, etc.)
- Used by audits/automation rules when needed

### `ChatModule` (optional)
- LLM chat endpoints for internal tools/backoffice (bounded + audited)

---

## No raw JSON in DB (explicit)
- Default rule: **do not store raw JSON/JSONB blobs in Postgres** for core domain data (avoid `Json` columns).
- Model information as **tables + rows + columns** so it’s queryable, consistent, and migration-driven.
- Store **typed columns** for what we query/filter on (status, timestamps, ids, scores, decisions).
- If we must preserve full provider payloads (CRM / ElevenLabs / OpenAI):
  - Store them in **object storage** (Supabase Storage / S3)
  - Keep only a **reference** (object key) + checksum + timestamps in Postgres
- Store only what is needed for:
  - reproducibility (config version, model name, prompt version)
  - auditability (evidence references, step decision, timestamps)
  - operations (status, retry count, last error *sanitized*)

### Replace “JSON everywhere” with relational schema (goal)
- **Automation selection config**: no `ficheSelection: Json`
  - Use tables/columns for selection mode, date ranges, groupes filters, limits, and safety thresholds.
- **Audit outputs**: no giant `resultData: Json`
  - Store typed outcomes + step/control-point rows + evidence rows.
  - If raw LLM payload is required for debugging, store it in object storage only.
- **Logs**: no `metadata: Json` stored in DB by default
  - Use structured logs to stdout + external log storage; keep DB logs minimal and typed if needed.

---

## Security & robustness features (baseline)
- Per-API-key rate limiting + quotas (Redis counters)
- Idempotency keys for POST endpoints (prevent duplicate jobs)
- Strict input validation (DTOs), no `any`
- Consistent error taxonomy (4xx vs 5xx) + safe messages
- Background jobs are retryable and idempotent

---

## Non-negotiable fixes vs the current backend (avoid repeating errors)
- **Auth everywhere**: the current backend is effectively public. New backend must enforce API key + RBAC on *every* route.
- **One error shape**: no mixed `{ success:false, error }` vs `{ message }` vs raw outputs. Enforce a single `ApiError` response.
- **One ID type on the wire**: treat all DB IDs as **strings** (BigInt-safe). Do not validate schedule ids as numbers.
- **Canonical field names**: pick one set (`auditConfigId`, `ficheId`, `useRlm`) and only keep legacy aliases as deprecated.
- **No JSON blobs**: replace `ficheSelection/configSnapshot/resultSummary/errorDetails/metadata` JSON blobs with relational tables/columns.
- **No fake realtime auth**: Pusher private channel auth must verify the authenticated user/org and channel ownership.
- **No local disk / in-memory workflow state**: workflows must be multi-replica safe (DB/Redis only).

---

## API conventions (new backend)
### Base paths + versioning
- Canonical: `/api/v1/*`
- Optional temporary compatibility: keep `/api/*` as a thin proxy to `/api/v1/*` during migration.

### Authentication
- **API Key** (server-to-server / Next.js backend): `Authorization: ApiKey <plaintext>` (preferred) or `X-API-Key`.
- **Admin UI**: session/JWT (cookie) + RBAC, separate from API keys (recommended).
- Every request resolves to: `tenantId`, optional `userId`, and `permissions`.

### Response envelopes (consistent)
- Success:
  - `{ "success": true, "data": <payload>, "meta"?: <meta> }`
- Error:
  - `{ "success": false, "error": "Human message", "code": "MACHINE_CODE", "details"?: <validation details>, "requestId": "..." }`

### IDs + dates
- IDs are strings on the wire (BigInt-safe): `auditId`, `scheduleId`, etc.
- Dates: ISO strings; “YYYY-MM-DD” for calendar dates.

### Pagination
- Standard query: `limit`, `offset`
- Standard response meta: `{ total, limit, offset, hasNextPage }`

### Idempotency
- `Idempotency-Key` header supported on “queue/run” endpoints (audit run, transcription run, automation trigger, progressive fetch).
- Persist `(tenantId, key, route)` with a short TTL + response replay to prevent double-submits.

---

## Feature parity inventory (current backend → NestJS modules)
This is the **full feature list** we must preserve, but implemented cleanly in the new architecture.

### `FichesModule` (CRM + cache + status)
#### HTTP (controllers)
- `GET /fiches/search?date=YYYY-MM-DD&includeStatus=true|false`
  - Fetch “sales list with calls” for a day (CRM) + optional DB enrichment.
- `GET /fiches/:ficheId?refresh=true|false`
  - Return fiche full details (from cache; may refresh CRM if possible).
- `GET /fiches/:ficheId/cache`
  - Minimal cache view (ttl, recordingsCount, fetchedAt, expiresAt).
- `GET /fiches/:ficheId/status`
  - DB-only status summary (transcription + audits).
- `POST /fiches/status/batch`
  - Bulk status lookup for fiche ids.
- `GET /fiches/status/by-date?date=YYYY-MM-DD`
  - DB-only list of fiches for a day with status summaries.
- `GET /fiches/status/by-date-range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&refresh=true|false&webhookUrl?&webhookSecret?`
  - Return cached data immediately + create a progressive fetch job for missing days (or refresh job).
- `GET /fiches/jobs?status=pending|processing|complete|failed&limit=20`
- `GET /fiches/jobs/:jobId`
- Optional polling fallback (keep, but prefer realtime): `GET /fiches/jobs/:jobId/updates`

#### Workflows/events (Inngest)
- `fiche/fetch` → fetch & cache a fiche (distributed)
- `fiche/fetched` → emitted after caching
- `fiches/revalidate-date` → revalidate all fiches for a date (batch)
- Progressive fetch:
  - Orchestrator: `fiches/progressive-fetch-continue`
  - Worker: `fiches/progressive-fetch-day`
  - Serialized updater/finalizer: `fiches/progressive-fetch-day.processed` (serialized by `jobId`)

#### Realtime events (Pusher)
- Channel: `private-job-{jobId}`
- Events: `fiches.progressive_fetch.created|progress|complete|failed`
- Principle: notify → frontend refetches authoritative REST state.

#### Storage (avoid metadata)
- Replace `FicheCache.rawData: Json` with:
  - typed fiche columns used for search/filtering (groupe, agency, prospect, salesDate, recordingsCount, etc.)
  - optional `crm_raw_ref` (object storage key) if you must preserve raw payloads
- Keep TTL/revalidation fields: `fetchedAt`, `expiresAt`, `lastRevalidatedAt`

#### Anti-patterns to avoid
- “refresh requires prior cache”: instead, design a clean prerequisite path (fetch sales list → get needed CRM keys → then refresh details).
- Do not return mixed response shapes per endpoint (always use the envelope).

---

### `RecordingsModule`
#### HTTP (controllers)
- `GET /recordings/:ficheId` → list recordings for a fiche (DB-only)

#### Storage (avoid metadata)
- Keep recording fields typed (callId, url, startTime, durationSeconds, direction…).
- Do **not** store transcription blobs inside `Recording`. Link to `Transcription` entities.

---

### `TranscriptionsModule` (ElevenLabs)
#### HTTP (controllers)
- `POST /transcriptions/:ficheId?priority=high|normal|low`
  - Queue transcription workflow for all recordings of a fiche.
- `POST /transcriptions/batch`
  - Queue transcription for multiple fiches.
- `GET /transcriptions/:ficheId/status`
  - DB-only status summary (counts + per recording status).
- `GET /transcriptions/:ficheId/recordings/:callId`
  - Return the transcript for a recording (DB-only; multi-replica safe).

#### Workflows/events (Inngest)
- Orchestrator: `fiche/transcribe`
  - Supports `wait_for_completion` (true by default for audit prerequisites).
- Fan-out worker: `transcription/recording.transcribe`
- Per-recording result: `transcription/recording.transcribed`
- Final event: `fiche/transcribed`

#### Realtime events (Pusher)
- Channel: `private-fiche-{ficheId}`
- Events: `transcription.started|status_check|recording_started|recording_completed|recording_failed|progress|completed|failed`

#### Storage (avoid metadata)
- Store typed transcript core:
  - `text`, `language`, timestamps, speaker labels, segments
- Keep raw provider payload optional:
  - object storage reference (`elevenlabs_raw_ref`) + checksum + TTL policy
- Sanitize provider errors (never leak headers like API keys).

---

### `AuditConfigsModule` (templates + steps)
#### HTTP (controllers)
- `GET /audit-configs?includeInactive=true|false&includeSteps=true|false&includeStats=true|false`
- `GET /audit-configs/:id`
- `POST /audit-configs`
- `PUT /audit-configs/:id`
- `DELETE /audit-configs/:id`
- Steps:
  - `POST /audit-configs/:configId/steps`
  - `PUT /audit-configs/steps/:stepId`
  - `DELETE /audit-configs/steps/:stepId`
  - `PUT /audit-configs/:configId/steps/reorder`
- Validation/stats:
  - `GET /audit-configs/:configId/validate`
  - `GET /audit-configs/:configId/stats`

#### Storage (avoid metadata)
- Config + steps are already mostly typed; keep them that way.
- Prefer immutable config versions + “active version” pointer (so audits can reference a version without snapshotting JSON).

---

### `AuditsModule` (LLM audits + evidence + review)
#### HTTP (controllers)
- Listing + analytics:
  - `GET /audits` (filters + pagination)
  - `GET /audits/grouped-by-fiches`
  - `GET /audits/grouped` (dashboards; `group_by=...`)
- Run/queue:
  - `POST /audits/run` (canonical) — **accept legacy alias** `POST /audits` temporarily
  - `POST /audits/run-latest`
  - `POST /audits/batch`
- Read:
  - `GET /audits/by-fiche/:ficheId`
  - `GET /audits/:auditId`
- Update/soft delete:
  - `PATCH /audits/:auditId` (notes, soft delete, linkage fields)
  - `DELETE /audits/:auditId` (soft delete)
- Rerun:
  - `POST /audits/:auditId/steps/:stepPosition/rerun`
  - `POST /audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/rerun`
- Human review:
  - `PATCH /audits/:auditId/steps/:stepPosition/review`
  - `GET /audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex`
  - `PATCH /audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/review`
  - `GET /audits/control-points/statuses`

#### Workflows/events (Inngest)
- Orchestrator: `audit/run`
  - Emits `audit/step.analyze` (fan-out) with deterministic event IDs
- Worker: `audit/step.analyze` → stores step result
- Aggregation/finalization driver: `audit/step.analyzed`
- Terminal: `audit/completed` | `audit/failed`
- Batch:
  - `audit/batch` → fan-out audit/run events
  - `audit/batch.completed`
- Reruns:
  - `audit/step-rerun` / `audit/step-rerun-completed`
  - `audit/step-control-point-rerun` / `audit/step-control-point-rerun-completed`

#### Realtime events (Pusher)
- Channels:
  - `private-audit-{auditId}`
  - `private-fiche-{ficheId}`
- Events:
  - `audit.started|fiche_fetch_started|fiche_fetch_completed|config_loaded|transcription_check|timeline_generated|analysis_started|step_started|step_completed|step_failed|progress|compliance_calculated|completed|failed`

#### Transcript strategy (keep both, but model it cleanly)
- Canonical request field (new): `transcriptMode: "prompt" | "tools"`
- Backwards compatible alias (current): `use_rlm: true` / `useRlm: true` → maps to `"tools"`

#### Storage (avoid metadata)
- Avoid `Audit.resultData: Json` as the default “source of truth”.
- Store typed audit outcome fields:
  - `status`, `overallScore`, `scorePercentage`, `niveau`, `isCompliant`, token counts, timings
- Store typed step results + control point results in tables (instead of hiding everything in `raw_result`):
  - `AuditStepResult` (summary fields)
  - `AuditControlPointResult` (status/comment/citations)
  - `AuditEvidence` (normalized citations: recordingIndex, chunkIndex, timestamps, speaker, excerpt)
  - `HumanReview` audit trail entries (who/when/why/what changed)
- Keep raw LLM payload optional (debug-only):
  - object storage ref + checksum + TTL (do not keep forever by default)

---

### `AutomationModule` (schedules + runs)
#### HTTP (controllers)
- Schedules:
  - `POST /automation/schedules`
  - `GET /automation/schedules?includeInactive=true|false`
  - `GET /automation/schedules/:id`
  - `PATCH /automation/schedules/:id`
  - `DELETE /automation/schedules/:id`
- Runs:
  - `POST /automation/trigger`
  - `GET /automation/schedules/:id/runs?limit&offset`
  - `GET /automation/runs/:id`
  - `GET /automation/runs/:id/logs?level=...`
- Diagnostic:
  - `GET /automation/diagnostic`

#### Workflows/events (Inngest)
- Cron tick: `scheduledAutomationCheck`
- Orchestrator: `automation/run`
  - Fans out to `fiche/fetch`, `fiche/transcribe`, `audit/run`
- Terminal: `automation/completed` | `automation/failed`

#### Guardrails (keep + strengthen)
- `maxRecordingsPerFiche` (schedule override) and env fallback
- Per-tenant concurrency limits (Redis/Inngest concurrency keys)
- Quotas + backpressure (do not explode fan-out)

#### Storage (avoid metadata)
- Replace `AutomationSchedule.ficheSelection: Json` with typed selection:
  - selection mode (date range / manual / filters)
  - date range fields
  - groupes filters (join table)
  - onlyWithRecordings, onlyUnaudited, maxFiches, maxRecordingsPerFiche
- Replace `configSnapshot/resultSummary/errorDetails/metadata` JSON blobs with typed summary tables:
  - `AutomationRunFicheResult` rows (status per fiche + ids of created audits/transcriptions)
  - `AutomationRunIgnoredFiche` rows (reason)
  - `AutomationLog` with typed fields (level, message, context keys) + external log storage for deep debug

---

### `ProductsModule`
#### HTTP (controllers)
- `GET /products/stats`
- `GET /products/search?q=...`
- `GET /products/link-fiche/:ficheId`
- CRUD:
  - `/products/groupes`
  - `/products/gammes`
  - `/products/formules`

#### Storage (avoid metadata)
- Current product schema is already mostly relational; keep it relational.
- If “documents” must remain flexible, store it as structured rows when possible (avoid dumping arbitrary JSON blobs).

---

### `RealtimeModule` (Pusher)
#### HTTP (controllers)
- `POST /realtime/pusher/auth` (private channel auth)
- `POST /realtime/pusher/test` (admin-only)

#### Channels + routing (keep contract)
- `private-audit-{auditId}`, `private-fiche-{ficheId}`, `private-job-{jobId}`, `private-global`
- Route events based on payload identifiers (`audit_id`, `fiche_id`, `jobId`), otherwise global.
- Payloads may be truncated if too large; keep critical ids/counters.

---

### `ChatModule` (streaming)
#### HTTP (controllers)
- `GET /audits/:auditId/chat/history`
- `POST /audits/:auditId/chat` (SSE streaming)
- `GET /fiches/:ficheId/chat/history`
- `POST /fiches/:ficheId/chat` (SSE streaming)

#### Notes (robustness)
- DB-only transcript access (no filesystem cache).
- Rate limit + cost controls (LLM tokens) per tenant/user.
- Store only what you need (messages), and keep citations structured.

---

## Internal tooling (recommended, from current repo scripts)
- **AB testing audits (prompt vs tools)**:
  - Keep as a CLI command (not a public API route).
  - Stores benchmark results to a safe location (DB table or files in an admin-only bucket).

---

## Workflows & end-to-end flows (required in the new backend)
This section explains **how the system works end-to-end** in the new NestJS architecture (API app + Worker app).

### Global workflow principles (do this for every flow)
- **Stateless API**: API controllers never rely on memory; they only read/write DB and enqueue workflows.
- **Idempotent workflows**: every workflow must be safe under retries, duplicate events, and replica restarts.
- **Deterministic fan-out IDs**: for per-step/per-day/per-recording events, the event ID is deterministic (`{parentId}:{childKey}`) to avoid duplicates.
- **DB is the source of truth**: realtime/webhooks are notify-only; clients must refetch authoritative state.
- **One canonical ID per entity**:
  - `auditId`, `scheduleId`, `automationRunId`, `jobId` are **DB ids (strings)** and reused across REST + workflows + realtime.
  - If you need a workflow correlation id, use `runId` (UUID) but don’t expose it as the primary ID.

---

## Authentication & authorization flows (must be implemented first)
These flows are foundational; every other flow depends on them.

### Flow: Authenticate API requests (API key)
**Trigger**: any `/api/v1/*` request from the frontend backend or another service.

1. Extract API key from `Authorization: ApiKey <plaintext>` (preferred) or `X-API-Key`.
2. Parse key format:
   - `ak_<prefix>.<secret>`
3. Lookup `api_keys` row by `(tenantId?, keyPrefix)`:
   - if multi-tenant by hostname, resolve tenant first
   - otherwise store `keyPrefix` globally unique and resolve `tenantId` from the key row
4. Verify secret:
   - compare `hash(secret)` to `api_keys.keyHash`
5. Check key status:
   - `ACTIVE` only
   - ensure not expired
6. Load role assignments for the key:
   - `api_key_role_assignments` → `role_permissions`
7. Build an `AuthContext`:
   - `tenantId`, `apiKeyId`, optional `userId` (usually null), computed permission set
8. Apply rate limits:
   - per key, per tenant (Redis counters)
9. Request proceeds to controllers with `request.auth = AuthContext`.

### Flow: Authenticate admin users (session/JWT)
**Trigger**: admin UI operations (creating users, configs, schedules, api keys).

1. Admin logs in (`/auth/login`) and receives a secure cookie session or JWT.
2. Each request:
   - verifies session/JWT
   - loads user roles (`user_role_assignments`)
   - computes permissions
3. Apply stricter rate limits and audit logging (admin actions are sensitive).

### Flow: Authorize every request (RBAC + scopes)
1. A controller endpoint declares required permission(s) via decorator.
2. `PermissionsGuard` checks if the permission exists for the principal.
3. Repository layer applies scope filters (`SELF|TEAM|ORG`) using typed columns:
   - never rely on “frontend sent tenantId”
4. If denied:
   - return `AUTH_FORBIDDEN` (consistent error shape)

### Flow: Create and rotate API keys (admin-only)
**Create**
1. Generate a random secret (plaintext returned once).
2. Hash and store `keyHash`, store `keyPrefix` for lookup.
3. Create `api_key_role_assignments` rows (typed).
4. Return `{ apiKey, plaintextKey }` once.

**Rotate**
1. Revoke old key (`status=REVOKED`, `revokedAt`).
2. Create a new key row (new prefix + hash).
3. Copy role assignments (or require explicit selection).
4. Return new plaintext key once.

---

## CRM (Fiches) — how CRM data enters the system
### What CRM provides (assumptions to encode in design)
- **Sales list by date**: returns many fiches for a day + lightweight fields + recordings metadata.
- **Fiche details**: requires a CRM “key” (ex: `cle`) obtained from the sales list/stub.

### Cache layers (what we cache, without JSON)
Treat CRM ingestion as **two cache layers** (both stored as typed columns/rows):

1. **Sales-list cache (stub)**
   - Created/updated by `GET /fiches/search?date=...`
   - Minimum fields for UI list + filters + later detail refresh:
     - `crmFicheId`, `salesDate`, `groupe`, `agenceNom`, prospect fields
     - `crmCle` (or equivalent CRM “detail key”)
     - recordings summary (`hasRecordings`, `recordingsCount`)
   - Records must be upserted idempotently.

2. **Details cache (full fiche details)**
   - Created/updated by `GET /fiches/:ficheId` (when needed) and by audit prerequisites.
   - Only persist typed details you actually need for:
     - audit logic
     - product linking / verification
     - UI detail screens
   - If CRM payload is huge and you need it for debugging only:
     - store it in object storage and reference it via `external_payload_refs`.

### Cache freshness policy (TTL + stale-while-revalidate)
Design goal: **return fast**, but ensure audits run on fresh-enough data.

- **Stub TTL**
  - `fiches.expiresAt` controls whether a stub is considered fresh.
- **Details TTL**
  - `fiches.detailsExpiresAt` controls whether details are considered fresh.
- **Stale-while-revalidate**
  - Most endpoints return cached data immediately and, if stale, enqueue refresh in the background (unless `refresh=true`, which forces refresh now/asap).
- **Never block UI for large ranges**
  - Date-range endpoint always returns immediately and uses a job for completion.

Recommended env knobs (for the new backend):
- `CRM_STUB_TTL_HOURS` (example default: 24)
- `CRM_DETAILS_TTL_HOURS` (example default: 72)
- `CRM_MAX_CONCURRENT_REQUESTS_PER_TENANT` (protect CRM)

### Revalidation flows (important)
You need both **on-demand revalidation** and **scheduled revalidation**.

#### Flow: Revalidate sales list for a date (manual/admin or automation)
**Trigger options**
- Admin/API: `POST /api/v1/fiches/revalidate-date` (recommended new endpoint)
- Worker cron: nightly revalidate “yesterday” + last N days (configurable)
- Progressive fetch jobs: revalidate all days in a requested range when `refresh=true`

**Worker-side workflow** (recommended event: `fiches/revalidate-date`)
1. Compute date range to revalidate (one date per event by default).
2. Acquire a distributed lock: `lock:fiches:revalidate:{tenantId}:{date}`
3. Call CRM sales list for that date.
4. Upsert stubs + recordings list, update `fetchedAt`, `expiresAt`, `lastRevalidatedAt`.
5. Emit an internal event `fiches/revalidated` (optional) and/or publish a notification event.

**Failure behavior**
- If CRM is down: mark run failed in logs and retry later (don’t corrupt cache).
- Never partially overwrite critical fields with nulls unless CRM explicitly states deletion.

#### Flow: Revalidate details for a fiche (on-demand)
**Trigger options**
- API: `GET /api/v1/fiches/:ficheId?refresh=true`
- Worker: audit prerequisite when details are stale

Steps:
1. Ensure the fiche stub exists and has `crmCle`.
2. Lock: `lock:fiche:details:{tenantId}:{ficheId}` (short TTL).
3. Fetch details from CRM.
4. Upsert typed details columns and update `detailsFetchedAt`, `detailsExpiresAt`.
5. If the CRM payload is needed for debug: store to object storage and attach `external_payload_refs` (never DB JSON).

**Edge cases**
- If `crmCle` is missing: the system must be able to recover by re-fetching the sales list for the fiche’s `salesDate` (or a search window), then updating the fiche stub.
- If CRM returns “not found”: mark fiche as `isActive=false` or keep a `crmDeletedAt` timestamp (typed) instead of deleting rows.

### Flow: Distributed fiche fetch (`fiche/fetch`) — used by audits + automation
This is the “unit of work” for caching a fiche across replicas.

**Trigger**: Inngest event `fiche/fetch` with `{ fiche_id, force_refresh? }`

1. Worker resolves fiche row by `crmFicheId`.
2. Acquire a lock: `lock:fiche:fetch:{tenantId}:{ficheId}` (short TTL).
3. If stub missing or stale (or `force_refresh=true`):
   - call CRM sales list (date-based) to re-hydrate the stub and ensure `crmCle` exists
4. If details missing/stale (or `force_refresh=true`):
   - call CRM fiche details using `crmCle`
5. Upsert typed fields + recordings list.
6. Emit `fiche/fetched` with:
   - `{ fiche_id, cached: true, recordings_count, fetch_duration_ms }`

**Idempotency**
- This workflow must be safe to run multiple times. The DB unique constraints must prevent duplicates.

### Flow: Proactive refresh on expiry (`fiche/cache.expired`)
Optional but helpful for keeping cache warm.

**Trigger**: a scheduled worker scans for fiche stubs close to expiry and emits `fiche/cache.expired`.

1. Find fiches where `expiresAt < now + threshold` (typed query; indexed).
2. Emit `fiche/cache.expired` events (bounded fan-out).
3. The handler dispatches `fiche/fetch` with `force_refresh=true`.

### Flow: Cache sales list for a date range (`fiches/cache-sales-list`)
This is a “cache warmer” for automation and for heavy usage periods.

**Trigger options**
- Admin endpoint: `POST /api/v1/fiches/cache-sales-list` (recommended) with `{ startDate, endDate }`
- Automation pre-step when it needs ranges not in cache

**Worker behavior**
1. For each date in range, call CRM sales list.
2. Upsert fiche stubs and recordings.
3. Optionally emit a batch progress event (notify-only).

### Flow: Fetch sales list for one day (search endpoint)
**Trigger**: `GET /api/v1/fiches/search?date=YYYY-MM-DD&includeStatus=true|false`

1. API validates date, authorizes `fiches:read`.
2. API calls CRM “sales list” for that date.
3. API upserts fiche stubs into DB:
   - Store typed searchable fields (groupe, agenceNom, prospectNom, salesDate, recordingsCount…)
   - Store CRM detail key (ex: `crmCle`) so later detail refresh is possible without hacks.
   - Store recordings rows (or update existing) as typed fields.
   - Update cache TTL timestamps (`fetchedAt`, `expiresAt`).
4. API returns the list (optionally enriched with DB status counters).

**Fix vs old backend**:
- Don’t require “fiche already cached” to do a refresh later; store the CRM key (`crmCle`) on initial ingest.

### Flow: Fetch fiche full details (on demand)
**Trigger**: `GET /api/v1/fiches/:ficheId?refresh=true|false`

1. API validates `ficheId`, authorizes `fiches:read`.
2. API reads fiche stub from DB.
3. If `refresh=true` OR full details missing/stale:
   - Call CRM details endpoint using `crmCle`.
   - Upsert typed detail fields (only what is needed for UI/audit logic).
   - Optional: store raw CRM payload in object storage (`crm_raw_ref`) with TTL (debug/audit reasons only).
4. Return fiche details DTO (BigInt-safe strings).

### Flow: Progressive cache fill for a date range (job)
**Trigger**: `GET /api/v1/fiches/status/by-date-range?startDate=...&endDate=...&refresh=...&webhookUrl?&webhookSecret?`

Goal: return cached data immediately, then fill missing days in the background.

1. API validates range, authorizes `fiches:read`.
2. API queries DB for cached fiches in range and returns immediately with:
   - `data`: cached fiches
   - `meta`: completeness + `jobId` if background continuation is needed
3. If missing days exist (or `refresh=true`):
   - Create `ProgressiveFetchJob` (DB) with the missing dates list, status `processing`.
   - Publish realtime: `fiches.progressive_fetch.created` (channel `private-job-{jobId}`).
   - Enqueue workflow: event `fiches/progressive-fetch-continue` (idempotent by `jobId`).

**Worker-side workflow**
- `fiches/progressive-fetch-continue` (orchestrator):
  - Fan-out `fiches/progressive-fetch-day` for each remaining date.
- `fiches/progressive-fetch-day` (worker):
  - Calls CRM sales list for that day
  - Upserts fiche stubs + recordings + TTL fields
  - Emits `fiches/progressive-fetch-day.processed` with `{ ok, cached, fichesCount }`
- `fiches/progressive-fetch-day.processed` (serialized updater by `jobId`):
  - Updates job progress counters + date lists
  - Emits realtime `fiches.progressive_fetch.progress`
  - On terminal: set job to `complete|failed`, emit realtime `...complete|...failed`
  - If `webhookUrl` set: enqueue webhook delivery attempts (SSRF-guarded + signed + retried)

### Flow: Compute fiche status (DB-only, no CRM calls)
These endpoints power the UI “status badges” and must be fast and safe across replicas.

**Triggers**
- `GET /api/v1/fiches/:ficheId/status`
- `POST /api/v1/fiches/status/batch`
- `GET /api/v1/fiches/status/by-date?date=...`

Rules:
- Never call CRM or providers here (avoid surprise latency and rate-limit issues).
- Derive status from typed tables:
  - transcription status: `recordings` + `transcripts` + latest `transcription_runs`
  - audit status: `audits` (latest_only) + `audit_step_results`
- Prefer precomputed counters where appropriate:
  - store `recordingsCount` on `fiches`
  - store `successfulSteps/failedSteps` on `audits`

Implementation notes:
- For `batch` status, use a single query with `IN (...)` and return a keyed map.
- For “by-date”, filter on `fiches.salesDate` (indexed) and include minimal related data.

---

## Transcriptions — end-to-end
### Flow: Transcribe a fiche (user-triggered)
**Trigger**: `POST /api/v1/transcriptions/:ficheId?priority=high|normal|low`

1. API validates `ficheId`, authorizes `transcriptions:create`.
2. API creates a `TranscriptionRun` row (status `queued|running`) and returns an ack (plus `runId` if you expose it internally).
3. API enqueues workflow event `fiche/transcribe` with `wait_for_completion=false` (default for UI-triggered runs).

**Worker-side workflow**
- `fiche/transcribe` (orchestrator):
  - Load recordings for fiche from DB
  - Decide which recordings need transcription (skip already transcribed if configured)
  - Publish realtime `transcription.started` + `transcription.status_check`
  - Fan-out `transcription/recording.transcribe` (deterministic ID = `runId:callId`)
  - If `wait_for_completion=true`, wait durably for completion signal (or query run status) before returning.
- `transcription/recording.transcribe` (worker):
  - Call provider (ElevenLabs), store transcript entities + link to recording
  - Emit realtime `transcription.recording_*`
  - Emit `transcription/recording.transcribed` with `{ ok, cached, error? }`
- Finalizer (triggered by `transcription/recording.transcribed`, serialized by `runId`):
  - Update run counters + emit realtime `transcription.progress`
  - When all recordings processed: mark run complete, emit realtime `transcription.completed` + event `fiche/transcribed`

**Non-negotiables**
- Provider errors must be sanitized (never leak API keys/headers).
- Transcription storage is DB-only; never depend on local file caches.

### Transcription idempotency + dedupe (critical for multi-replica)
Problems to avoid (current backend risk): duplicate transcriptions for the same recording under retries.

Rules:
- A transcript is uniquely identified by `(tenantId, recordingId, provider)`.
- Enforce a DB unique constraint so two workers can’t create duplicates.
- A `TranscriptionRunItem` is uniquely identified by `(runId, recordingId)`.
- If a worker receives a duplicate `transcription/recording.transcribe` event:
  - It should **reuse** the existing transcript if present (treat as `cached=true`).

### Provider retry policy (ElevenLabs)
Recommended approach:
- `maxAttempts` per recording (example: 3)
- Exponential backoff with jitter (example: 2s → 4s → 8s)
- Classify errors:
  - **retryable**: 429, 5xx, network timeouts
  - **non-retryable**: 4xx validation, unsupported audio, missing recording URL

Store only typed fields:
- on each failure, update:
  - `transcription_run_items.status = FAILED`
  - `errorMessage` (sanitized)
  - `attempt`
- if you need the raw provider response for debugging:
  - store it in object storage via `external_payload_refs`

### Flow: Transcribe as an audit prerequisite (durable wait)
**Trigger**: audit orchestrator dispatches `fiche/transcribe` with `wait_for_completion=true`

Goal: audit workflow must not proceed until the fiche is “transcription complete enough”.

1. Audit orchestrator checks transcription completeness:
   - total recordings vs recordings with transcripts
2. If missing transcripts:
   - Dispatch `fiche/transcribe` with `wait_for_completion=true` and desired priority
3. Transcription orchestrator runs fan-out and finalizes:
   - On completion, it emits `fiche/transcribed`
4. Audit orchestrator continues after it observes:
   - either the `fiche/transcribed` event
   - or DB shows all recordings have transcripts (fallback)

### Transcript segmentation rules (for evidence + citations)
To make audits and chat robust, transcripts must be segmented predictably.

- Persist per recording:
  - `transcripts` row (provider + language)
  - `transcript_segments` rows ordered by `sequence`
- Each segment should have:
  - `startMs`, `endMs`, `speaker`, `text`
- Evidence/citations should always reference `transcriptSegmentId` (not raw timestamps only).

### Re-transcription flow (rare, but required)
Use when:
- provider improved model
- transcript is corrupted/invalid
- human reports bad transcript

Approach:
- add a `transcripts.isActive` flag or `transcripts.version`
- keep old transcript rows (auditability) and mark new as active
- audits must reference the transcript version they used (typed column on `audits` or join)

### Flow: Batch transcriptions (fan-out)
**Trigger**: `POST /api/v1/transcriptions/batch`

1. API validates `ficheIds[]` + `priority` and authorizes `transcriptions:run` (ORG scope recommended).
2. API creates a `transcription_batch` row (recommended typed table) and returns `batchId`.
3. Worker event `transcription/batch` (recommended):
   - enqueues `fiche/transcribe` for each fiche
   - uses deterministic event IDs (`batchId:ficheId`) to prevent duplicates
   - emits `batch.progress` and `batch.completed`

### Flow: Read transcription status (DB-only, cheap)
These endpoints must never call ElevenLabs (multi-replica safe).

- `GET /api/v1/transcriptions/:ficheId/status`
  - derived from `recordings` + `transcripts`
- `GET /api/v1/transcriptions/:ficheId/recordings/:callId`
  - loads transcript + segments by `recording.callId`

---

## Audits — end-to-end (CRM → transcription → timeline → step fan-out → finalization)
### Audit building blocks (steps, checkpoints, evidence) — no JSON
This is the core of the product: **audit configs define steps; steps define control points (checkpoints)**; runs produce typed results + typed evidence rows.

#### Config → steps → control points
- `audit_configs` → `audit_config_versions` → `audit_steps` → `audit_step_control_points`
- Control points are indexed (1-based for UI, 0-based internally is fine, but choose one and standardize).

#### Audit run → typed results
- `audits`
- `audit_step_results` (1 row per configured step)
- `audit_control_point_results` (1 row per control point per step result)
- `audit_evidence` (many rows; each row points to a real transcript segment)

#### Why this matters
- “Avoid metadata” means:
  - no `raw_result: Json`
  - no arrays of checkpoints hidden in a blob
  - no citations arrays stored as JSON
  - everything is queryable and enforceable by constraints

### Checkpoints (control points) — status semantics
Control points (aka checkpoints) are the smallest auditable unit.

#### Allowed statuses (keep parity with current backend UI)
- `PRESENT`: the agent clearly performed/said the required thing
- `ABSENT`: the required thing is missing
- `PARTIEL`: partially present or ambiguous
- `NON_APPLICABLE`: not applicable for this call/fiche/product context

#### How status is stored
- `audit_control_point_results.statut` is the canonical value.
- `audit_control_point_results.commentaire` is an explanation (short text).
- Evidence for the control point lives in `audit_evidence` rows (never JSON arrays).

#### How status affects step outcome (policy)
You must define a deterministic rule, for example:
- If any control point is `ABSENT` in a step → step becomes `NON_CONFORME`
- If all are `PRESENT` → `CONFORME`
- If mix of `PRESENT` + `PARTIEL` → `PARTIEL`
- `NON_APPLICABLE` points are excluded from scoring (or reduce max score), depending on policy

Make this rule explicit in `AuditScoringService` and test it.

### Transcript strategies (prompt vs tools) — deeper behavior
#### Prompt mode (`transcriptMode="prompt"`)
- The step prompt receives a bounded “timeline” text.
- Risks: token explosion, truncation, weaker citation reliability.
- Must enforce:
  - maximum timeline size (chars/tokens)
  - chunk count limit
  - consistent formatting so citations are possible (speaker + time + excerpt)

#### Tools mode (`transcriptMode="tools"`)
- The step prompt does **not** include the full transcript.
- The model uses constrained tools:
  - `searchTranscript(query) -> segmentIds[]`
  - `getTranscriptChunks(segmentIds) -> segments`
- Benefits:
  - long calls supported
  - evidence becomes segment-id-addressable

### Timeline generation (for prompt mode + for UI summaries)
Rules (recommended):
- Timeline is constructed from `transcript_segments` across all recordings of the fiche.
- Sort by recording start time, then `segment.sequence`.
- Output a canonical text format per segment, e.g.:
  - `[recording=1][speaker=speaker_0][00:12.340-00:16.900] ...text...`
- Chunking:
  - fixed maximum chars per chunk (or tokens) so prompts remain bounded
  - store `timelineChunks` count on `audits` for observability

### Evidence gating algorithm (must-have)
Goal: **never persist hallucinated evidence**.

Acceptance criteria for a citation:
- It references a real `transcriptSegmentId`, OR it can be mapped to one deterministically.
- The quoted excerpt must match the transcript segment text (exact or fuzzy within threshold).
- The time bounds must fall within the segment bounds (if time provided).

Recommended gating process (per control point / per step):
1. Convert all model “citations” into candidate evidence references.
2. For each candidate:
   - resolve to a `transcriptSegmentId`
   - verify excerpt match
   - verify bounds
3. Drop invalid citations and record:
   - `citationsCount` per control point
   - `totalCitations` per step
4. If a control point decision depends on dropped citations:
   - downgrade to `PARTIEL` or `NON_APPLICABLE` (policy decision)
   - attach a typed reviewer-like note (not JSON) explaining “insufficient evidence” (optional column or separate table)

### Scoring + compliance rules (explicit)
Make the math explicit and deterministic so reruns and reviews are explainable.

- Each step has:
  - `weight` (default 5)
  - `isCritical` boolean
- Each step result has:
  - `score` and `maxScore` (typed)
- Audit summary:
  - `maxScore = Σ(step.maxScore)`
  - `overallScore = Σ(step.score)`
  - `scorePercentage = overallScore / maxScore * 100`
  - `niveau` is derived by thresholds (define in config, not hardcoded in code)
  - `isCompliant` depends on:
    - critical steps rule (e.g. all critical must be `CONFORME`)
    - percentage threshold rule

### Flow resilience (audit correctness under retries)
- `audit/run` must be idempotent by `(tenantId, auditId)`.
- `audit/step.analyze` event IDs are deterministic (`auditId:stepPosition`) so retries do not duplicate work.
- DB enforces uniqueness for step results.
- Finalizer is serialized by `auditId` so compliance is computed once per “latest” state.

### Audit prerequisite policies (recordings/transcripts)
Make these policies explicit so behavior is predictable.

#### Recordings policy
- If `recordingsCount = 0`:
  - either block audit and mark `FAILED` with `code=NO_RECORDINGS`
  - or allow audit with a “no evidence possible” outcome (usually not desired)

#### Transcript completeness policy
Options (choose one and encode as config):
1. **Strict** (recommended for compliance audits)
   - audit requires 100% of recordings transcribed
   - if any recording transcription fails → audit fails with `TRANSCRIPTION_INCOMPLETE`
2. **Best-effort**
   - audit proceeds with available transcripts
   - stores `missingTranscriptsCount` typed column on audit for transparency
   - evidence gating still applies (may reduce compliance)

#### Model/prompt versioning (reproducibility without JSON)
- Store typed columns:
  - `audits.model`
  - `audits.promptVersion`
  - `audits.transcriptMode`
- If you need to preserve full prompts/responses for auditability:
  - store them in object storage via `external_payload_refs` (never DB JSON)

### Cost controls (must-have)
- Per tenant:
  - max tokens/day (LLM)
  - max concurrent audits
- Per audit:
  - max parallel steps
  - max tokens/step
  - max transcript chunks (prompt mode)

Enforcement points:
- API (before enqueue): reject if quota exceeded
- Worker (before LLM call): re-check quota to protect against race conditions

### Flow: Run an audit (single fiche)
**Trigger**: `POST /api/v1/audits/run`

**API (HTTP) responsibilities**
1. Validate input: `ficheId`, `auditConfigId`, optional `transcriptMode` (`prompt|tools`).
2. Authorize `audits:create` for the tenant scope.
3. Apply `Idempotency-Key` (prevent double queue from UI retries).
4. Create `Audit` row (status `queued|running`) using DB id as canonical `auditId`.
5. Enqueue workflow event `audit/run` with `{ auditId, ficheId, auditConfigId, transcriptMode, triggerSource }`.
6. Return `{ auditId }` immediately.

**Worker workflow (orchestrator)**
1. Emit realtime `audit.started` (channel `private-audit-{auditId}` + `private-fiche-{ficheId}`).
2. Ensure fiche details are available:
   - If missing/stale: dispatch `fiche/fetch` and wait for DB to reflect cached state.
   - Emit realtime `audit.fiche_fetch_started` / `audit.fiche_fetch_completed`.
3. Load audit config version + steps:
   - Emit realtime `audit.config_loaded`.
4. Ensure transcripts are present:
   - Compute transcription completeness.
   - If missing and policy allows: dispatch `fiche/transcribe` with `wait_for_completion=true`.
   - Emit realtime `audit.transcription_check`.
5. Build transcript context:
   - `prompt` mode: create timeline text chunks (bounded) and embed into prompts.
   - `tools` mode: store chunk index + enable LLM tools (`searchTranscript`, `getTranscriptChunks`).
   - Emit realtime `audit.timeline_generated`.
6. Fan-out step analysis:
   - Emit realtime `audit.analysis_started`.
   - For each step: enqueue `audit/step.analyze` with deterministic event id `auditId:stepPosition`.
7. Return (or continue) while finalizer completes the audit.

**Worker workflow (step worker: `audit/step.analyze`)**
1. Emit realtime `audit.step_started`.
2. Run LLM call with selected transcript strategy (prompt/tools).
3. Evidence gating (critical):
   - Validate that each citation refers to an actual transcript segment (by ids/timestamps + excerpt match).
   - If unsupported: downgrade claims and mark as “not evidenced” (do not store hallucinated evidence).
4. Persist typed results:
   - Step summary fields
   - Control point results
   - Evidence rows (citations)
   - Optional raw LLM payload reference (debug-only + TTL)
5. Emit realtime `audit.step_completed` OR `audit.step_failed`.
6. Emit event `audit/step.analyzed` for aggregation.

**Worker workflow (finalizer: triggered by `audit/step.analyzed`, serialized by `auditId`)**
1. Recompute progress counts, emit realtime `audit.progress`.
2. When all steps finished (ok or failed):
   - Compute overall compliance (`overallScore`, `scorePercentage`, `niveau`, `isCompliant`, critical rules)
   - Persist audit summary fields
   - Emit realtime `audit.compliance_calculated`
   - Emit realtime terminal: `audit.completed` or `audit.failed`
   - Emit internal events `audit/completed` or `audit/failed`

### Flow: Rerun a step (async)
**Trigger**: `POST /api/v1/audits/:auditId/steps/:stepPosition/rerun`

1. API authorizes `audits:update`.
2. API enqueues event `audit/step-rerun` with `{ auditId, stepPosition, customPrompt? }`.
3. Worker reruns analysis for that step and persists a **revision**:
   - Keep previous results (audit trail)
   - Update current “latest” step result pointer
4. Emit realtime `audit.step_started`/`audit.step_completed` with `rerun_id` markers (or a dedicated `audit.step_rerun.*` in the new contract).

### Flow: Rerun a single control point (checkpoint) (async)
**Trigger**: `POST /api/v1/audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/rerun`

Goal: rerun only one checkpoint without re-running the whole step.

1. API validates:
   - `auditId` exists and belongs to tenant
   - `stepPosition` and `controlPointIndex` are valid for the audit config version
2. API authorizes `audits:rerun` (recommended admin-only).
3. API creates an `audit_reruns` row:
   - `scope=CONTROL_POINT`, `stepPosition`, `controlPointIndex`, `status=QUEUED`
4. API enqueues event `audit/step-control-point-rerun` with:
   - `{ audit_id, step_position, control_point_index, custom_prompt? }`
5. Worker loads:
   - the current step result
   - the specific control point definition
   - transcript segments (prefer tools-mode retrieval)
6. Worker runs a constrained analysis:
   - only answer the single checkpoint
   - generate citations that map to transcript segments
7. Evidence gating runs again (same algorithm).
8. Persist results:
   - update only the targeted `audit_control_point_results` row (and its evidence rows)
   - update derived step counters (`citationsCount`, `totalCitations`, maybe `conforme/score` if the step scoring depends on checkpoint status)
   - recompute audit compliance summary (best-effort)
9. Mark rerun row `COMPLETED|FAILED`.
10. Emit realtime:
   - `audit.step_started` and `audit.step_completed` with `rerun_id`, `rerun_scope="control_point"`, `control_point_index`
   - (optional) a dedicated `audit.control_point_rerun.*` event if you want cleaner UI semantics

**Important**
- Do not embed `original`/`rerun`/`comparison` full objects in realtime payloads.
- If you need a diff report, store it in object storage and include only a `comparison_ref`.

### Flow: Human review (override)
**Trigger**:
- `PATCH /api/v1/audits/:auditId/steps/:stepPosition/review`
- `PATCH /api/v1/audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/review`

1. API validates reviewer permissions (`audits:review`).
2. Update typed fields (step/control point) and append a `HumanReview` audit trail entry.
3. Recompute audit compliance summary (best-effort) and publish realtime progress/completed if needed.

### Flow: Batch audits (fan-out)
**Trigger**: `POST /api/v1/audits/batch`

Goal: queue many audits safely (no thundering herd, no duplicates).

1. API validates `ficheIds[]` and optional `auditConfigId` / `transcriptMode`.
2. API authorizes `audits:run` at `ORG` scope (recommended admin-only).
3. API creates a `batch` row (recommended typed table: `audit_batches`) and returns `batchId`.
4. Worker event `audit/batch`:
   - selects the target fiches (bounded)
   - enqueues `audit/run` for each fiche with deterministic IDs (e.g. `batchId:ficheId`)
   - emits realtime `batch.progress` updates
5. When all queued audits reach terminal state (or a timeout):
   - emit `batch.completed`
   - store batch summary (typed columns)

---

## Automation — end-to-end (schedules → selection → fan-out → summary)
### Due detection (timezone-safe, no duplicate runs)
Key problem to solve: cron ticks happen frequently and in multiple replicas; you must avoid triggering the same schedule twice.

Recommended design:
- For each schedule, compute a **due window**:
  - e.g. for “daily at 09:00 Europe/Paris”, the window is that minute (or a 5-min tolerance window)
- Enforce idempotency in DB:
  - unique `(scheduleId, windowStart)` in a table like `automation_run_windows`
- When a schedule is due:
  - create the run row and the run-window row in a single transaction
  - if the unique constraint conflicts, another replica already triggered it → skip safely

### Selection modes (typed, relational)
The schedule must be representable without JSON:
- **Manual**: rows in `automation_schedule_manual_fiches`
- **Date range**:
  - explicit `startDate/endDate` columns on the run (so the run is reproducible)
  - selection uses cached fiches in DB; if cache coverage is low, the runner may first ingest from CRM for that range
- **Filters** (typed columns + join tables):
  - groupes (join table)
  - onlyWithRecordings, onlyUnaudited, maxFiches

### Automation run execution model (bounded fan-out)
Avoid “fan-out explosion”. For a run with N fiches and M audit configs:
- worst-case tasks = `N * (fetch + transcribe + M audits)`
- you must bound concurrency by:
  - tenant
  - schedule/run
  - provider quotas (CRM, ElevenLabs, OpenAI)

Recommended approach:
- Create `automation_run_fiches` rows first (selected/ignored)
- Process fiches with a per-fiche worker event (optional but clean):
  - event: `automation/fiche.process` with deterministic ID `runId:ficheId`
- Each fiche worker:
  - ensures fiche details
  - transcribes if needed
  - runs audits (one or many configs)
  - writes typed results rows
- Finalizer aggregates from `automation_run_fiches` and marks run terminal

### Guardrails (must be enforced before work is queued)
- `maxFiches` clamp (hard cap)
- `maxRecordingsPerFiche` skip with typed reason (store in `automation_run_fiches.ignoreReason`)
- per-tenant quotas:
  - max LLM tokens/day
  - max transcription seconds/day
  - max CRM calls/minute
- “kill switch”:
  - allow schedule disable (`isActive=false`) to stop future runs
  - allow run cancel (set `automation_runs.status=CANCELLED` and stop enqueueing more work)

### Automation failure semantics
- **completed**: all selected fiches processed successfully
- **partial**: at least one success and at least one failure/ignored
- **failed**: all selected fiches failed or the run crashed before meaningful progress

Store failures as typed fields:
- `automation_run_fiches.errorMessage` (sanitized)
- per audit/transcription linkage tables store status/error per child job

### Flow: Scheduler tick (cron)
**Trigger**: Inngest cron `scheduledAutomationCheck`

1. Worker queries active schedules that are “due” (timezone-aware).
2. For each due schedule, enqueue `automation/run` (idempotent per schedule + due window).

### Flow: Run a schedule
**Trigger**: `automation/run`

1. Create `AutomationRun` row (status `running`) and attach `scheduleId`.
2. Build fiche selection (typed, not JSON):
   - date-range / manual ids / filters
3. Apply guardrails:
   - `maxFiches`, `maxRecordingsPerFiche`, quota limits
   - Store ignored fiches with reason
4. For each selected fiche (bounded fan-out):
   - Ensure details: `fiche/fetch`
   - If configured: `fiche/transcribe`
   - Run audits:
     - either “automatic configs” or a configured list of audit config ids
     - enqueue `audit/run` per config (deterministic ids)
5. Aggregate completion:
   - Update per-fiche results table (success/failed/ignored + created audit ids)
   - Update run summary counters
6. Mark run `completed|partial|failed`
7. Emit internal events `automation/completed|automation/failed`
8. Publish notify events (choose one):
   - Use existing `batch.*` events for UI progress, or
   - Add `automation.*` realtime events (recommended) with channels `private-automation-run-{runId}`

**Worker implementation details (recommended structure)**
- Orchestrator `automation/run`:
  - creates the run + run_fiches rows
  - fans out per-fiche work (bounded concurrency)
- Per-fiche worker `automation/fiche.process` (recommended):
  - locks `lock:automation:fiche:{runId}:{ficheId}`
  - loads the fiche (or creates/ingests it if missing)
  - applies guardrails (recordings count, quotas)
  - dispatches transcription/audits (and optionally waits, depending on schedule config)
  - writes typed linkage rows:
    - `automation_run_transcriptions`
    - `automation_run_audits`
  - updates `automation_run_fiches.status`
- Finalizer (serialized by `runId`):
  - recomputes counters
  - marks terminal status
  - emits `automation.completed|automation.failed` + realtime

**Audit config selection rules**
- If `useAutomaticAudits=true`:
  - select configs where `runAutomatically=true` and latest version is active
- Else:
  - use `automation_schedule_audit_configs` rows (typed)

**Cancellation**
- Provide `POST /api/v1/automation/runs/:id/cancel` (recommended)
- Behavior:
  - mark run `CANCELLED`
  - workers must stop enqueueing new tasks for that run
  - already-running tasks may finish, but results are ignored (or recorded as “cancelled”)

---

## Audit configs — lifecycle flows (versioned, reproducible)
The new backend must support editing configs without breaking reproducibility of historical audits.

### Flow: Create a new audit config
**Trigger**: `POST /api/v1/audit-configs`

1. API authorizes `audit_configs:create` (ORG).
2. Create `audit_configs` row (name/description flags).
3. Create initial `audit_config_versions` row (version=1, inactive by default).
4. Return config + version id.

### Flow: Add/update steps and control points
**Triggers**
- `POST /api/v1/audit-configs/:configId/steps`
- `PUT /api/v1/audit-configs/steps/:stepId`
- `PUT /api/v1/audit-configs/:configId/steps/reorder`

Rules:
- Steps belong to a **config version** (not directly to config).
- Updating steps should create a **new config version** (recommended) instead of mutating the active one.
- Control points are rows (`audit_step_control_points`) not arrays.

### Flow: Validate a config version
**Trigger**: `GET /api/v1/audit-configs/:configId/validate`

Validation checks (examples):
- step positions are contiguous (1..N)
- each step has at least 1 control point (if required by your audit model)
- weights are in allowed range
- no duplicate control point indices per step

### Flow: Activate a config version (publish)
**Trigger**: `POST /api/v1/audit-configs/:configId/versions/:version/activate` (recommended new endpoint)

1. API authorizes `audit_configs:update`.
2. Deactivate previous active version (typed update).
3. Activate requested version.
4. Future audits run against this version unless a specific version is requested.

### Flow: Stats
**Trigger**: `GET /api/v1/audit-configs/:configId/stats`

Rules:
- Stats are computed from typed tables:
  - audits count by status
  - average score, compliance rate
  - failure rate per step/control point (optional)

---

## Products — end-to-end flows (catalog + linking + verification)
The products domain supports audits that verify product info was communicated correctly.

### Flow: Ingest/update product catalog (admin)
**Triggers**: CRUD endpoints under `/api/v1/products/*`

Rules:
- Keep products relational (no JSON blobs).
- If you must store external “documents”, prefer rows (Document table) instead of JSON arrays.

### Flow: Link a fiche to product(s)
**Trigger**: `GET /api/v1/products/link-fiche/:ficheId` (current behavior)

Recommended implementation (typed, deterministic):
1. Load fiche details (typed fields).
2. Apply matching rules:
   - based on product codes in fiche details (preferred)
   - else heuristic matching on product names (less reliable)
3. Persist typed link rows:
   - `fiche_product_links` (recommended table): `(ficheId, productId, confidence, method)`
4. Return linked products + confidence.

### Flow: Audit step “verify product info”
Some audit steps have `verifyProductInfo=true`.

Worker behavior:
1. Load linked products (typed rows).
2. Use transcript tools (preferred) to search for required product claims.
3. Record results as:
   - control point statuses + evidence rows (no JSON)
4. If product link confidence is low:
   - downgrade to `PARTIEL` or `NON_APPLICABLE` (policy decision) and store a typed reason.

---

## Chat — end-to-end (streaming + citations)
### Flow: Chat on a fiche or audit
**Triggers**
- `POST /api/v1/fiches/:ficheId/chat` (SSE stream)
- `POST /api/v1/audits/:auditId/chat` (SSE stream)

1. API authorizes `chat:create` for the scope (self/team/org).
2. Load or create a `ChatConversation` (keyed by `{ tenantId, ficheId, auditId? }`).
3. Store the user message.
4. Build context safely:
   - If audit chat: include audit summary + step results (typed), not giant raw JSON
   - Fetch transcript chunks via the same “tools mode” approach when possible (avoid prompt stuffing)
5. Stream assistant response (SSE):
   - Send incremental `{ text }` chunks
   - Send final `{ citations: [...] }` object
   - End with `[DONE]`
6. Store assistant message + citations (typed evidence rows).

**Controls**
- Rate limit by tenant/user + daily token budget.
- Timeouts + cancellation handling.

---

## Realtime + Webhooks — delivery flows
### Realtime (Pusher) principles (keep contract)
- Channels:
  - `private-audit-{auditId}`
  - `private-fiche-{ficheId}`
  - `private-job-{jobId}`
  - `private-global`
- Events are **notify-only**; the UI must refetch REST state.
- Payload truncation is allowed (keep critical ids/counters).

### Pusher auth (must be real security in the new backend)
**Trigger**: `POST /api/v1/realtime/pusher/auth`

1. Authenticate the requester (admin session or API key).
2. Authorize channel ownership:
   - If subscribing to `private-fiche-{ficheId}`, verify the tenant has access to that fiche.
   - If subscribing to `private-audit-{auditId}`, verify tenant owns that audit.
3. Sign and return the Pusher auth payload.

### Outgoing webhooks (optional but recommended)
- Support tenant-level webhook subscriptions for:
  - `audit.completed`, `audit.failed`
  - `transcription.completed`, `transcription.failed`
  - `automation.completed`, `automation.failed`
  - `fiches.progressive_fetch.*`
- Always:
  - SSRF allowlist validation
  - HMAC signatures
  - Retries with backoff + dead-letter tracking
  - Delivery logs viewable in admin UI

### Flow: Publish realtime event (single responsibility)
Goal: make publishing consistent, safe, and size-bounded.

1. Domain code emits a domain event (in worker or API).
2. `RealtimePublisher`:
   - determines channel(s) based on payload identifiers
   - truncates payload if needed
   - publishes via Pusher
3. On failure:
   - log sanitized error (no secrets)
   - do not crash the workflow (notify-only)

### Flow: Outgoing webhook delivery (typed, durable, retried)
Webhooks must be durable and observable because they affect customer integrations.

1. A domain event occurs (audit completed, job progressed, etc.).
2. `WebhookPayloadBuilder`:
   - builds the JSON payload in-memory
   - stores it in object storage
   - creates `external_payload_refs` row (payload reference)
3. `WebhookDispatcher` selects subscriptions interested in that event type.
4. For each subscription, create a `webhook_deliveries` row (typed):
   - `status=PENDING`, `attempt=1`, `payloadRefId=...`
5. Delivery worker attempts HTTP POST:
   - SSRF guard validates destination (allowlist)
   - signs payload with HMAC (secret is encrypted at rest)
   - sets standard headers (suggested):
     - `X-Webhook-Event`
     - `X-Webhook-Delivery-Id`
     - `X-Webhook-Timestamp`
     - `X-Webhook-Signature: sha256=<hex>`
6. On response:
   - if 2xx: mark `SENT`, store `statusCode`, store a truncated response body if needed
   - else: mark `FAILED`, compute `nextRetryAt` (backoff), increment attempt
7. When attempts exhausted:
   - mark `DEAD_LETTERED`
   - expose via admin UI (deliveries list + filters)

**No JSON in DB**
- The webhook payload is stored in object storage.
- The DB stores only:
  - status fields
  - response code
  - error message (sanitized)
  - reference to payload object key

---

## Deep spec (new backend should contain)
This section is intentionally more concrete: **what you will actually implement**, with a relational schema mindset (**no JSON columns**) and multi-replica safety.

---

## NestJS workspace layout (recommended)
Use a NestJS **monorepo** with two apps + shared libs.

### Apps
- `apps/api`
  - HTTP controllers (REST), auth, realtime auth endpoints, chat SSE
  - Only does lightweight orchestration and enqueues workflows
- `apps/worker`
  - Inngest functions/workers only
  - No public HTTP routes except Inngest handler + health

### Shared libs (examples)
- `libs/contracts`
  - DTOs, enums, event names, shared types (no secrets)
- `libs/database`
  - Prisma client + migrations + repository helpers (tenant scoping)
- `libs/auth`
  - API key parsing, hashing, guards, RBAC evaluation
- `libs/integrations`
  - CRM client, OpenAI client, ElevenLabs client, Pusher client, storage client
- `libs/observability`
  - logger, metrics, tracing, redaction helpers

---

## Relational data model (no JSON columns)
Below is the **target table-level spec**. Names are indicative; you can rename them to fit Prisma conventions.

### Tenancy & identity
#### `tenants`
- **columns**: `id`, `name`, `slug`, `isActive`, `createdAt`, `updatedAt`
- **notes**: every business entity references `tenantId`

#### `users`
- **columns**: `id`, `tenantId`, `email`, `passwordHash`, `fullName`, `isActive`, `lastLoginAt`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, email)`

#### `teams`
- **columns**: `id`, `tenantId`, `name`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, name)`

#### `team_members`
- **columns**: `id`, `tenantId`, `teamId`, `userId`, `createdAt`
- **indexes**: unique `(teamId, userId)`

#### `roles`
- **columns**: `id`, `tenantId`, `name`, `description`, `isSystem`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, name)`

#### `permissions` (static catalog)
- **columns**: `id`, `resource`, `action`, `description`
- **notes**: seeded at boot/migrations (not user-editable)

#### `role_permissions`
- **columns**: `id`, `roleId`, `permissionId`, `scope`
- **scope enum**: `SELF | TEAM | ORG | ALL`
- **indexes**: unique `(roleId, permissionId, scope)`

#### `user_role_assignments`
- **columns**: `id`, `tenantId`, `userId`, `roleId`, `scope`, `teamId?`, `createdAt`
- **notes**:
  - `teamId` is optional; when set, role applies within that team
  - when `teamId` is null, role applies at org scope

#### `api_keys`
- **columns**:
  - `id`, `tenantId`, `name`
  - `keyPrefix` (public identifier for lookup)
  - `keyHash` (hash of secret; never store plaintext)
  - `status` (`ACTIVE|REVOKED|EXPIRED`)
  - `expiresAt?`, `lastUsedAt?`, `createdByUserId?`, `createdAt`, `revokedAt?`
- **indexes**: unique `(tenantId, keyPrefix)`
- **recommended format**: `ak_<prefix>.<secret>` where `<prefix>` identifies the DB row

#### `api_key_role_assignments`
- **columns**: `id`, `apiKeyId`, `roleId`, `scope`, `teamId?`
- **goal**: API keys have explicit roles/permissions like users

#### `admin_audit_log` (system audit trail)
- **columns**: `id`, `tenantId`, `actorType` (`USER|API_KEY`), `actorId`, `action`, `resource`, `resourceId`, `createdAt`
- **notes**: store typed context only; avoid JSON “metadata” fields

---

### CRM / fiches
#### `fiches`
- **columns** (minimum):
  - `id` (DB id), `tenantId`, `crmFicheId` (string from CRM)
  - `salesDate` (`YYYY-MM-DD`), `groupe`, `agenceNom`
  - `prospectNom`, `prospectPrenom`, `prospectEmail`, `prospectTel`
  - `crmCle` (the CRM detail key required to refresh fiche details)
  - `hasRecordings`, `recordingsCount`
  - `fetchedAt`, `expiresAt`, `lastRevalidatedAt?`
  - `detailsFetchedAt?`, `detailsExpiresAt?`
  - `createdAt`, `updatedAt`
- **indexes**:
  - unique `(tenantId, crmFicheId)`
  - `(tenantId, salesDate)`
  - `(tenantId, groupe)`

#### `recordings`
- **columns**:
  - `id`, `tenantId`, `ficheId`
  - `callId` (CRM call id), `recordingUrl`
  - `recordingDate?`, `recordingTime?`
  - `direction?`, `answered?`, `fromNumber?`, `toNumber?`
  - `startTime?`, `durationSeconds?`
  - `createdAt`, `updatedAt`
- **indexes**: unique `(ficheId, callId)`

#### `external_payload_refs` (generic object-storage references)
Used whenever you would have stored raw JSON in DB.
- **columns**:
  - `id`, `tenantId`
  - `provider` (`CRM|ELEVENLABS|OPENAI|INTERNAL`)
  - `entityType` (`FICHE|RECORDING|TRANSCRIPT|AUDIT_STEP|WEBHOOK_DELIVERY|...`)
  - `entityId` (string)
  - `objectKey` (storage key/path)
  - `sha256`, `contentType?`, `sizeBytes?`
  - `createdAt`, `expiresAt?`

---

### Products (catalog + fiche linking)
This mirrors the current backend’s insurance catalog domain, but stays relational (no JSON blobs).

#### `product_groupes`
- **columns**: `id`, `tenantId`, `code` (e.g. `"01"`), `libelle`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, code)`

#### `product_gammes`
- **columns**: `id`, `tenantId`, `groupeId`, `code`, `libelle`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, groupeId, code)`

#### `product_formules`
- **columns**:
  - `id`, `tenantId`, `gammeId`, `code`, `libelle`
  - typed guarantee fields (if stable) or normalized guarantee tables (recommended)
  - `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, gammeId, code)`

#### `product_documents`
- **columns**: `id`, `tenantId`, `gammeId?`, `formuleId?`, `documentType`, `url`, `createdAt`
- **indexes**: `(tenantId, documentType)`

#### `fiche_product_links`
- **columns**:
  - `id`, `tenantId`, `ficheId`
  - `groupeId?`, `gammeId?`, `formuleId?`
  - `confidence` (0..1), `method` (`CODE_MATCH|HEURISTIC|MANUAL`)
  - `createdAt`, `createdByUserId?`
- **indexes**:
  - unique `(tenantId, ficheId, formuleId)` (or whichever product entity you consider canonical)

---

### Transcriptions
#### `transcription_runs`
- **columns**:
  - `id`, `tenantId`, `ficheId`
  - `status` (`QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED`)
  - `priority` (`HIGH|NORMAL|LOW`)
  - counters: `totalRecordings`, `completedCount`, `cachedCount`, `failedCount`
  - `startedAt?`, `completedAt?`, `durationMs?`, `errorMessage?`
  - `createdAt`, `updatedAt`

#### `transcription_run_items`
- **columns**:
  - `id`, `runId`, `recordingId`
  - `status` (`QUEUED|RUNNING|COMPLETED|FAILED|CACHED_SKIPPED`)
  - `attempt`, `startedAt?`, `completedAt?`, `errorMessage?`
  - `providerTranscriptionId?`
- **indexes**: unique `(runId, recordingId)`

#### `transcripts`
- **columns**:
  - `id`, `tenantId`, `recordingId`
  - `provider` (`ELEVENLABS`), `languageCode`, `durationSeconds?`
  - `createdAt`
- **notes**: do not store provider JSON; use `external_payload_refs` if needed

#### `transcript_segments`
- **columns**:
  - `id`, `transcriptId`, `sequence`
  - `speaker`, `startMs`, `endMs`, `text`
- **indexes**: `(transcriptId, sequence)`

#### (optional) `transcript_embeddings`
- **columns**: `id`, `segmentId`, `embedding` (pgvector), `model`, `createdAt`
- **goal**: supports fast retrieval without dumping transcript into prompts

---

### Audit configs (versioned, relational)
#### `audit_configs`
- **columns**: `id`, `tenantId`, `name`, `description?`, `isActive`, `runAutomatically`, `createdAt`, `updatedAt`

#### `audit_config_versions`
- **columns**: `id`, `auditConfigId`, `version`, `systemPromptText?`, `isActive`, `createdAt`
- **indexes**: unique `(auditConfigId, version)`

#### `audit_steps`
- **columns**:
  - `id`, `configVersionId`, `position`
  - `name`, `description?`, `promptText`
  - `severity` (`LOW|MEDIUM|HIGH|CRITICAL`)
  - `isCritical`, `weight`
  - `chronologicalImportant`, `verifyProductInfo`
- **indexes**: unique `(configVersionId, position)`

#### `audit_step_control_points`
- **columns**: `id`, `auditStepId`, `index`, `labelText`
- **indexes**: unique `(auditStepId, index)`

#### `audit_step_keywords` (optional)
- **columns**: `id`, `auditStepId`, `keyword`
- **notes**: avoid `String[]` arrays; store one row per keyword

---

### Audit runs (typed results + evidence rows)
#### `audits`
- **columns**:
  - `id`, `tenantId`, `ficheId`, `configVersionId`
  - linkage: `automationScheduleId?`, `automationRunId?`
  - trigger: `triggerSource` (`API|AUTOMATION|BATCH`), `triggerUserId?`, `triggerApiKeyId?`
  - `transcriptMode` (`PROMPT|TOOLS`), `model`
  - status: `status` (`QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED`)
  - summary: `overallScore`, `maxScore`, `scorePercentage`, `niveau`, `isCompliant`
  - counters: `successfulSteps`, `failedSteps`, `totalTokens`, `timelineChunks`
  - timings: `startedAt?`, `completedAt?`, `durationMs?`
  - `errorMessage?`, `notes?`, `deletedAt?`
  - `createdAt`, `updatedAt`

#### `audit_step_results`
- **columns**:
  - `id`, `auditId`, `auditStepId`
  - `status` (`PENDING|RUNNING|COMPLETED|FAILED`)
  - summary fields: `traite`, `conforme` (`CONFORME|NON_CONFORME|PARTIEL`), `score`, `maxScore`, `niveauConformite`
  - text: `commentaireGlobal`
  - counters: `totalCitations`, `totalTokens`
  - `createdAt`, `updatedAt`
- **indexes**: unique `(auditId, auditStepId)`

#### `audit_control_point_results`
- **columns**:
  - `id`, `stepResultId`, `controlPointId`
  - `statut` (`PRESENT|ABSENT|PARTIEL|NON_APPLICABLE`)
  - `commentaire?`
  - counters: `citationsCount`
  - `createdAt`, `updatedAt`
- **indexes**: unique `(stepResultId, controlPointId)`

#### `audit_evidence`
- **columns**:
  - `id`, `auditId`, `stepResultId`, `controlPointResultId?`
  - `recordingId`, `transcriptSegmentId`
  - `excerptText` (what was quoted), `speaker`
  - `startMs`, `endMs`
  - optional denorm for UI: `recordingIndex`, `chunkIndex`
  - `createdAt`
- **notes**: this replaces any “citations array in JSON” with queryable evidence rows

#### `audit_reviews` + `audit_review_changes`
- `audit_reviews` columns: `id`, `tenantId`, `auditId`, `reviewerUserId`, `reason?`, `createdAt`
- `audit_review_changes` columns: `id`, `reviewId`, `entityType`, `entityId`, `fieldName`, `oldValueText?`, `newValueText?`
- **goal**: human overrides are auditable without storing JSON diffs

#### `audit_reruns` (optional but recommended)
- **columns**:
  - `id`, `tenantId`, `auditId`
  - `scope` (`STEP|CONTROL_POINT`), `stepPosition`, `controlPointIndex?`
  - `status` (`QUEUED|RUNNING|COMPLETED|FAILED`)
  - `customPromptText?`, `createdByUserId?`
  - `startedAt?`, `completedAt?`, `errorMessage?`
- **notes**: if you need full “original vs rerun vs comparison”, store comparisons in object storage via `external_payload_refs`

---

### Automation (typed schedule + typed run outputs)
#### `automation_schedules`
- **columns** (subset):
  - `id`, `tenantId`, `name`, `description?`, `isActive`
  - `scheduleType` (`MANUAL|DAILY|WEEKLY|MONTHLY|CRON`), `timezone`
  - `cronExpression?`, `timeOfDay?`, `dayOfWeek?`, `dayOfMonth?`
  - selection flags: `onlyWithRecordings`, `onlyUnaudited`, `maxFiches?`, `maxRecordingsPerFiche?`
  - execution: `runTranscription`, `skipIfTranscribed`, `transcriptionPriority`
  - audits: `runAudits`, `useAutomaticAudits`
  - error handling: `continueOnError`, `retryFailed`, `maxRetries`
  - `createdByUserId?`, `createdAt`, `updatedAt`

#### `automation_schedule_groupes`
- **columns**: `id`, `scheduleId`, `groupeCode`

#### `automation_schedule_manual_fiches`
- **columns**: `id`, `scheduleId`, `crmFicheId`

#### `automation_schedule_audit_configs`
- **columns**: `id`, `scheduleId`, `auditConfigId` (or `configVersionId` if you want pinned versions)

#### `automation_runs`
- **columns**:
  - `id`, `tenantId`, `scheduleId`
  - `status` (`RUNNING|COMPLETED|PARTIAL|FAILED`)
  - counters: `totalFiches`, `successfulFiches`, `failedFiches`, `ignoredFiches`, `auditsRun`, `transcriptionsRun`
  - timings: `startedAt`, `completedAt?`, `durationMs?`
  - `errorMessage?`
  - `createdAt`

#### `automation_run_fiches`
- **columns**:
  - `id`, `runId`, `ficheId`
  - `status` (`SELECTED|IGNORED|SUCCESS|FAILED`)
  - `ignoreReason?`, `errorMessage?`
  - `recordingsCount?`
- **indexes**: unique `(runId, ficheId)`

#### `automation_run_transcriptions`
- **columns**: `id`, `runFicheId`, `transcriptionRunId`, `status`, `errorMessage?`

#### `automation_run_audits`
- **columns**: `id`, `runFicheId`, `auditId`, `status`, `errorMessage?`

#### `automation_run_logs` (minimal, typed)
- **columns**: `id`, `runId`, `level`, `message`, `contextType?`, `contextId?`, `createdAt`
- **notes**: deep context goes to structured logs, not DB JSON

---

### Jobs (progressive fetch)
#### `progressive_fetch_jobs`
- **columns**: `id`, `tenantId`, `startDate`, `endDate`, `status`, `createdAt`, `createdByUserId?`
- **status**: `PENDING|PROCESSING|COMPLETE|FAILED|CANCELLED`

#### `progressive_fetch_job_days`
- **columns**: `id`, `jobId`, `date`, `status`, `fichesCount`, `errorMessage?`, `startedAt?`, `completedAt?`
- **indexes**: unique `(jobId, date)`

---

### Webhooks (no payload JSON in DB)
#### `webhook_subscriptions`
- **columns**: `id`, `tenantId`, `name`, `url`, `isActive`, `secretEncrypted`, `createdAt`, `updatedAt`

#### `webhook_subscription_events`
- **columns**: `id`, `subscriptionId`, `eventType`
- **notes**: one row per event type (no string arrays)

#### `webhook_deliveries`
- **columns**:
  - `id`, `tenantId`, `subscriptionId`, `eventType`
  - `entityType`, `entityId`
  - `status` (`PENDING|SENT|FAILED|DEAD_LETTERED`)
  - attempt: `attempt`, `maxAttempts`, `nextRetryAt?`
  - response: `statusCode?`, `responseBodyTruncated?`, `errorMessage?`
  - payload reference: `payloadRefId` (FK to `external_payload_refs`)
  - `createdAt`, `sentAt?`

---

### Chat (streaming + stored conversations)
#### `chat_conversations`
- **columns**: `id`, `tenantId`, `ficheId`, `auditId?`, `title?`, `createdAt`, `updatedAt`
- **indexes**: unique `(tenantId, ficheId, auditId)`

#### `chat_messages`
- **columns**:
  - `id`, `conversationId`, `role` (`USER|ASSISTANT|SYSTEM`)
  - `content` (text)
  - `model?`, `tokensIn?`, `tokensOut?`, `latencyMs?`
  - `createdAt`

#### `chat_message_citations`
- **columns**:
  - `id`, `messageId`, `recordingId`, `transcriptSegmentId`
  - `excerptText`, `speaker`, `startMs`, `endMs`
- **goal**: citations are queryable and validate-able (no JSON arrays)

---

## State machines (explicit)
Define enums and keep transitions strict.

### `ProgressiveFetchJob.status`
- `PENDING` → `PROCESSING` → `COMPLETE`
- `PENDING|PROCESSING` → `FAILED`
- `PENDING|PROCESSING` → `CANCELLED`

### `TranscriptionRun.status`
- `QUEUED` → `RUNNING` → `COMPLETED`
- `QUEUED|RUNNING` → `FAILED`
- `QUEUED|RUNNING` → `CANCELLED`

### `Audit.status`
- `QUEUED` → `RUNNING` → `COMPLETED`
- `QUEUED|RUNNING` → `FAILED`
- `QUEUED|RUNNING` → `CANCELLED`
- Soft-delete is separate: `deletedAt` set/unset (does not change status)

### `AutomationRun.status`
- `RUNNING` → `COMPLETED`
- `RUNNING` → `PARTIAL`
- `RUNNING` → `FAILED`

### `WebhookDelivery.status`
- `PENDING` → `SENT`
- `PENDING` → `FAILED` → (retry) → `SENT` OR `DEAD_LETTERED`

---

## RBAC permission catalog (suggested)
Define a stable permission vocabulary and map it to guards.

### Resources
- `tenants`, `users`, `teams`, `roles`, `api_keys`
- `fiches`, `recordings`, `transcriptions`
- `audit_configs`, `audits`, `audit_reviews`
- `automation_schedules`, `automation_runs`
- `products`
- `chat`
- `webhooks`, `realtime`

### Actions (examples)
- `read`, `list`, `create`, `update`, `delete`
- domain actions: `run`, `rerun`, `review`, `trigger`, `export`, `rotate`, `revoke`, `test`

### Scopes
- `SELF`: only the user’s own entities
- `TEAM`: entities belonging to teams the user is a member of
- `ORG`: any entity in tenant
- `ALL`: super-admin / cross-tenant (should be rare; ideally not used)

---

## Cross-cutting “robust backend” features (must-have)
### Validation + DTOs
- Use a single validation approach (DTO schemas) for both apps.
- Reject unknown fields (no silent acceptance).

### Error codes
- Standardize `code` values (examples):
  - `AUTH_UNAUTHORIZED`, `AUTH_FORBIDDEN`, `AUTH_INVALID_API_KEY`
  - `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`
  - `CRM_UPSTREAM_ERROR`, `TRANSCRIPTION_PROVIDER_ERROR`, `LLM_PROVIDER_ERROR`

### Rate limits + quotas
- Per API key: requests/minute
- Per tenant: daily transcription seconds, daily LLM tokens
- Enforce using Redis counters + a small daily usage table if you need persistence

### Idempotency without JSON storage
- For queue endpoints, store **only the created entity id** keyed by `(tenantId, idempotencyKey, endpoint)`:
  - e.g. `idempotency_audit_run` → `{ tenantId, key, auditId, createdAt }`
  - `idempotency_transcription_run` → `{ tenantId, key, runId, createdAt }`

### Multi-replica safety
- No in-memory caches for correctness (only for local performance hints).
- Finalizers aggregate from DB or from “item completed” events (serialized by key).
- Concurrency keys:
  - per tenant
  - per job (`jobId`), per audit (`auditId`), per transcription run (`runId`)

---

## Realtime contract (Pusher) — exact events + payload fields
Goal: preserve the current frontend contract, but keep payloads small and typed.

### Channels (scoping)
- `private-audit-{auditId}`
- `private-fiche-{ficheId}`
- `private-job-{jobId}`
- `private-global`
- (recommended) `private-automation-run-{automationRunId}`

### Routing rules
- If payload has `audit_id` → publish to audit channel (and also fiche if `fiche_id` exists)
- If payload has `fiche_id` → publish to fiche channel
- If payload has `jobId` → publish to job channel
- Otherwise → global channel

### Payload envelope
- Pusher payload = **domain payload object only** (no wrapper).
- Payloads may be truncated if they exceed size limits. Truncation must keep:
  - entity id(s) (`audit_id`, `fiche_id`, `jobId`, `batch_id`)
  - progress counters (`completed_steps`, `total_steps`, etc.)

### Audit events (`audit.*`)
#### `audit.started`
- payload:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `audit_config_id` (string)
  - `audit_config_name` (string)
  - `total_steps` (number)
  - `started_at` (ISO datetime string)
  - `status` = `"started"`
  - optional: `approach` = `{ use_rlm: boolean; transcript_mode: "prompt" | "tools" }`
  - optional: `audit_db_id` (string) (if you keep separate tracking ids; ideally same as `audit_id`)

#### `audit.fiche_fetch_started`
- payload: `fiche_id`, `from_cache` (boolean), `status` = `"fetching"`

#### `audit.fiche_fetch_completed`
- payload: `fiche_id`, `recordings_count` (number), `prospect_name` (string), `from_cache` (boolean), `status` = `"fetched"`

#### `audit.config_loaded`
- payload: `config_id` (string), `config_name` (string), `steps_count` (number), `status` = `"loaded"`

#### `audit.transcription_check`
- payload: `fiche_id`, `total_recordings`, `transcribed`, `needs_transcription`, `status` = `"checked"`

#### `audit.timeline_generated`
- payload: `fiche_id`, `recordings_count`, `total_chunks`, `status` = `"generated"`

#### `audit.analysis_started`
- payload: `audit_id`, `fiche_id`, `total_steps`, `model`, `status` = `"analyzing"`

#### `audit.step_started`
- payload (normal step):
  - `audit_id`, `fiche_id`, `step_position`, `step_name`, `total_steps`, `step_weight`, `is_critical`
  - `status` = `"processing"`
- payload (rerun):
  - `rerun_id` (string), `audit_id` (string), `step_position` (number)
  - optional: `rerun_scope` = `"step" | "control_point"`
  - optional: `control_point_index` (number)
  - `started_at` (ISO datetime string)
  - `status` = `"rerunning"`

#### `audit.step_completed`
- payload (normal step):
  - `audit_id`, `fiche_id`, `step_position`, `step_name`
  - `score`, `max_score`, `conforme` (boolean)
  - `total_citations`, `tokens_used`
  - `status` = `"completed"`
- payload (rerun) — **new backend should NOT embed huge objects**
  - `rerun_id`, `audit_id`, `step_position`
  - `status` = `"rerun_completed"`
  - optional: `comparison_ref` (string) → reference to object storage artifact (diff/report)
  - optional: `completed_at` (ISO datetime string)

#### `audit.step_failed`
- payload: `audit_id`, `fiche_id`, `step_position`, `step_name`, `error`, `status` = `"failed"`

#### `audit.progress`
- payload: `audit_id`, `fiche_id`, `completed_steps`, `total_steps`, `failed_steps`, `current_phase`, `progress_percentage`, `status` = `"in_progress"`

#### `audit.compliance_calculated`
- payload: `audit_id`, `fiche_id`, `overall_score`, `score_percentage`, `niveau`, `is_compliant`, `critical_issues`, `status` = `"calculated"`

#### `audit.completed`
- payload:
  - `audit_id`, `fiche_id`, `overall_score`, `score_percentage`, `niveau`, `is_compliant`
  - `successful_steps`, `failed_steps`, `total_tokens`, `duration_seconds`
  - `completed_at` (ISO datetime string), `status` = `"completed"`

#### `audit.failed`
- payload: `audit_id`, `fiche_id`, `error`, `failed_phase?`, `failed_at`, `status` = `"failed"`, `partial_results?`

### Transcription events (`transcription.*`) — scoped to fiche channel
#### `transcription.started`
- payload: `fiche_id`, `total_recordings`, `priority`, `started_at`, `status` = `"started"`

#### `transcription.status_check`
- payload: `fiche_id`, `total_recordings`, `already_transcribed`, `needs_transcription`, `is_complete`, `status` = `"checked"`

#### `transcription.recording_started`
- payload: `fiche_id`, `call_id`, `recording_index`, `total_to_transcribe`, `recording_url?`, `status` = `"processing"`

#### `transcription.recording_completed`
- payload: `fiche_id`, `call_id`, `transcription_id`, `recording_index`, `total_to_transcribe`, `status` = `"completed"`

#### `transcription.recording_failed`
- payload: `fiche_id`, `call_id`, `error`, `recording_index`, `total_to_transcribe`, `status` = `"failed"`

#### `transcription.progress`
- payload: `fiche_id`, `total_recordings`, `transcribed`, `pending`, `failed`, `progress_percentage`, `status` = `"in_progress"`

#### `transcription.completed`
- payload: `fiche_id`, `total_recordings`, `transcribed`, `failed`, `duration_seconds`, `completed_at`, `status` = `"completed"`

#### `transcription.failed`
- payload: `fiche_id`, `error`, `failed_at`, `status` = `"failed"`, `partial_results?`

### Batch events (`batch.*`) — scoped to global channel
#### `batch.progress`
- payload: `batch_id`, `operation_type` (`"audit"|"transcription"`), `total`, `completed`, `failed`, `progress_percentage`

#### `batch.completed`
- payload: `batch_id`, `operation_type`, `total`, `completed`, `failed`, `duration_ms`

### Notification event (`notification`) — scoped to global channel
- payload: `type` (`success|error|info|warning`), `message`, `description?`, `duration`

### Progressive fetch job events (`fiches.progressive_fetch.*`) — scoped to job channel
#### `fiches.progressive_fetch.created`
- payload: `jobId`, `status`, `startDate`, `endDate`, `progress`, `completedDays`, `totalDays`, `totalFiches`, `datesCompleted`, `datesRemaining`, `datesFailed`

#### `fiches.progressive_fetch.progress`
- payload: `jobId`, `status` = `"processing"`, `startDate`, `endDate`, `progress`, `completedDays`, `totalDays`, `totalFiches`, `datesCompleted`, `datesRemaining`, `datesFailed`, `latestDate`

#### `fiches.progressive_fetch.complete`
- payload: `jobId`, `status` = `"complete"`, `progress` = `100`, plus the same counters and arrays

#### `fiches.progressive_fetch.failed`
- payload: `jobId`, `status` = `"failed"`, `progress` = `100`, plus the same counters and arrays

### (Recommended) Automation realtime events (`automation.*`)
If you want the UI to track automation runs without polling.
- Channel: `private-automation-run-{automationRunId}`
- Events (suggested):
  - `automation.started` (run created, selection summary)
  - `automation.progress` (selected/ignored/succeeded/failed counts)
  - `automation.completed` (final summary)
  - `automation.failed` (terminal error)

---

## DB constraints + indexes (performance + correctness)
This is the “make it robust” layer: what must be unique and what must be indexed.

### General rules
- Every table has `tenantId` (except static catalogs).
- Every query path used by list/search endpoints must have a supporting index.
- Use **unique constraints** to enforce idempotency and prevent duplicates (recordings per fiche, step results per audit, etc.).

### Must-have unique constraints (examples)
- `users`: unique `(tenantId, email)`
- `teams`: unique `(tenantId, name)`
- `team_members`: unique `(teamId, userId)`
- `roles`: unique `(tenantId, name)`
- `api_keys`: unique `(tenantId, keyPrefix)`
- `fiches`: unique `(tenantId, crmFicheId)`
- `recordings`: unique `(ficheId, callId)`
- `audit_config_versions`: unique `(auditConfigId, version)`
- `audit_steps`: unique `(configVersionId, position)`
- `audit_step_control_points`: unique `(auditStepId, index)`
- `audit_step_results`: unique `(auditId, auditStepId)`
- `audit_control_point_results`: unique `(stepResultId, controlPointId)`
- `progressive_fetch_job_days`: unique `(jobId, date)`
- `chat_conversations`: unique `(tenantId, ficheId, auditId)`

### Must-have indexes (examples)
- `fiches`:
  - `(tenantId, salesDate)` for by-date and range searches
  - `(tenantId, groupe)` for filters
  - `(tenantId, fetchedAt)` and `(tenantId, lastRevalidatedAt)` for ops filters
- `audits`:
  - `(tenantId, ficheId)` for by-fiche
  - `(tenantId, status)` for lists
  - `(tenantId, createdAt)` and `(tenantId, completedAt)` for sorting
  - `(tenantId, scorePercentage)` for dashboard filters/sort
- `transcription_runs`:
  - `(tenantId, ficheId)`
  - `(tenantId, status)`
- `automation_runs`:
  - `(tenantId, scheduleId)`
  - `(tenantId, status)`
  - `(tenantId, startedAt)`

---

## NestJS module implementation checklist (what each module must contain)
This is a “definition of done” checklist to keep quality high.

### `AuthModule`
- **Guards**:
  - `ApiKeyAuthGuard` (for server-to-server calls)
  - `SessionOrJwtAuthGuard` (for admin UI)
- **RBAC**:
  - `PermissionsGuard` + `@RequirePermissions()` decorator
  - `ScopeResolver` (SELF/TEAM/ORG/ALL) applied consistently in repositories
- **Services**:
  - `ApiKeysService` (create/rotate/revoke, hash verification, lastUsedAt updates)
  - `UsersAuthService` (login/logout/refresh)
- **Controllers**:
  - `/api/v1/auth/*` for admin flows
  - `/api/v1/api-keys/*` for API key management (admin only)

### `FichesModule`
- **Controllers**: all fiche endpoints (`search`, `:id`, `status`, `by-date`, `by-date-range`, `jobs`)
- **Services**:
  - `FichesIngestService` (sales list upsert)
  - `FicheDetailsService` (detail refresh via `crmCle`)
  - `FicheStatusService` (transcription + audit summary)
- **Repositories**: `FicheRepository`, `RecordingRepository`
- **Worker**: `ProgressiveFetchWorkflows` implementing `fiches/progressive-fetch-*` events
- **Integrations**: `CrmClient` with retries, timeouts, circuit breaker, safe logging

### `TranscriptionsModule`
- **Controllers**: queue + status + per-recording transcript read
- **Services**:
  - `TranscriptionPlanner` (which recordings need work)
  - `TranscriptionProviderService` (ElevenLabs)
  - `TranscriptionStorageService` (writes transcript + segments)
- **Worker**:
  - Orchestrator `fiche/transcribe`
  - Worker `transcription/recording.transcribe`
  - Finalizer serialized by `runId`
- **Realtime**: emit `transcription.*` events (keep payload small)

### `AuditConfigsModule`
- **Controllers**: CRUD configs, CRUD steps, reorder, validate, stats
- **Services**:
  - `AuditConfigVersioningService` (create version, activate version)
  - `AuditConfigValidator` (ensures steps/control points are consistent)
- **Repositories**: config + versions + steps + control points

### `AuditsModule`
- **Controllers**: run/list/get/by-fiche/rerun/review endpoints
- **Services**:
  - `AuditQueueService` (creates `Audit` row, idempotency)
  - `AuditPrerequisitesService` (ensure fiche + transcripts)
  - `AuditTimelineService` (prompt mode timeline chunks)
  - `AuditTranscriptToolsService` (tools mode: search/get chunks)
  - `AuditStepAnalyzerService` (LLM call)
  - `AuditEvidenceValidatorService` (gating)
  - `AuditScoringService` (compliance calculation)
  - `AuditReviewService` (human overrides + audit trail)
- **Worker**:
  - Orchestrator `audit/run`
  - Worker `audit/step.analyze`
  - Finalizer serialized by `auditId`
- **Storage**:
  - typed step/control-point/evidence tables (no JSON)
  - optional raw payload refs via object storage only

### `AutomationModule`
- **Controllers**: schedules CRUD, trigger, runs listing, logs, diagnostic
- **Services**:
  - `ScheduleDueCalculator` (timezone-safe)
  - `FicheSelectionService` (typed selection, no JSON config)
  - `AutomationRunnerService` (fan-out bounded + guardrails)
  - `AutomationResultsService` (typed per-fiche results + summary)
- **Worker**:
  - cron `scheduledAutomationCheck`
  - orchestrator `automation/run` + finalization

### `ChatModule`
- **Controllers**: SSE streaming + history
- **Services**:
  - `ChatContextBuilder` (audit summary + transcript chunks)
  - `ChatStreamingService` (SSE chunking, cancellation, persistence)
  - `ChatCitationService` (typed citations, validation)
- **Constraints**: strict rate limits + token budgets

### `RealtimeModule`
- **Controllers**: `/realtime/pusher/auth` and `/realtime/pusher/test` (admin-only)
- **Services**:
  - `RealtimePublisher` (routes events to channels, truncates large payloads)
  - `RealtimeAuthService` (channel ownership verification)

### `WebhooksModule`
- **Controllers**: admin-only manage subscriptions + view deliveries
- **Services**:
  - `WebhookDispatcher` (SSRF guard + signing + retries)
  - `WebhookDeliveryRepository` (typed delivery state)
  - `WebhookPayloadBuilder` (payload refs to object storage; no DB JSON)

---

## Permission matrix (endpoint → permission → scope)
This is the “who can do what” spec. It must be enforced by **guards + repository scoping**.

### Permission naming convention
- Use `resource:action` (examples: `audits:read`, `audits:run`, `audits:review`, `api_keys:rotate`).
- Scopes are always applied at query time: `SELF | TEAM | ORG | ALL`.

### Data scoping rules (how scopes map to DB)
To make `SELF/TEAM/ORG` real (without JSON), add explicit ownership fields where needed.

- **Fiches**
  - Add optional columns:
    - `fiches.assignedUserId?`
    - `fiches.assignedTeamId?`
  - Scope filters:
    - `SELF`: `assignedUserId = userId`
    - `TEAM`: `assignedTeamId IN (teams of user)`
    - `ORG`: `tenantId = tenantId`
- **Audits**
  - Authorization is derived from `audits.ficheId` (and the fiche assignment).
- **Automation schedules/runs**
  - Default `ORG` scope (these are org-level operations).
  - Optionally allow `TEAM` scope by adding `automation_schedules.teamId?` and scoping selection/results.
- **Chat**
  - Derived from fiche/audit access (plus optional “createdByUserId” for SELF-only chat).

### Endpoint matrix (v1)
Notes:
- “Admin-only” means only admin session users (not API keys) unless you explicitly allow API keys.
- All endpoints assume `tenantId` context has been resolved.

#### Health & docs
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/health` | none | Public liveness |
| GET | `/api-docs` / `/api-docs.json` | none | Consider restricting in prod |

#### Auth / admin
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | none | Admin UI only |
| POST | `/api/v1/auth/logout` | `auth:logout` | Admin UI only |
| POST | `/api/v1/auth/refresh` | `auth:refresh` | Admin UI only |

#### API keys (admin-only)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/api-keys` | `api_keys:list` (ORG) | Do not expose secrets |
| POST | `/api/v1/api-keys` | `api_keys:create` (ORG) | Returns plaintext key once |
| PATCH | `/api/v1/api-keys/:id/revoke` | `api_keys:revoke` (ORG) | |
| PATCH | `/api/v1/api-keys/:id/rotate` | `api_keys:rotate` (ORG) | Returns new plaintext key once |

#### Users/teams/roles (admin-only)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/users` | `users:list` (ORG) | |
| POST | `/api/v1/users` | `users:create` (ORG) | |
| PATCH | `/api/v1/users/:id` | `users:update` (ORG) | |
| DELETE | `/api/v1/users/:id` | `users:delete` (ORG) | Soft delete recommended |
| GET | `/api/v1/teams` | `teams:list` (ORG) | |
| POST | `/api/v1/teams` | `teams:create` (ORG) | |
| PATCH | `/api/v1/teams/:id` | `teams:update` (ORG) | |
| DELETE | `/api/v1/teams/:id` | `teams:delete` (ORG) | |
| GET | `/api/v1/roles` | `roles:list` (ORG) | |
| POST | `/api/v1/roles` | `roles:create` (ORG) | |
| PATCH | `/api/v1/roles/:id` | `roles:update` (ORG) | |
| DELETE | `/api/v1/roles/:id` | `roles:delete` (ORG) | |

#### Fiches
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/fiches/search` | `fiches:read` (TEAM/ORG) | Ingest stubs + recordings |
| GET | `/api/v1/fiches/:ficheId` | `fiches:read` (TEAM/ORG) | `refresh=true` requires `fiches:refresh` |
| GET | `/api/v1/fiches/:ficheId/cache` | `fiches:read` (TEAM/ORG) | |
| GET | `/api/v1/fiches/:ficheId/status` | `fiches:read` (TEAM/ORG) | |
| POST | `/api/v1/fiches/status/batch` | `fiches:read` (TEAM/ORG) | |
| GET | `/api/v1/fiches/status/by-date` | `fiches:read` (TEAM/ORG) | |
| GET | `/api/v1/fiches/status/by-date-range` | `fiches:read` (TEAM/ORG) | creates job; requires `jobs:create` |
| POST | `/api/v1/fiches/revalidate-date` | `fiches:revalidate` (ORG) | admin-only recommended |
| POST | `/api/v1/fiches/cache-sales-list` | `fiches:warm_cache` (ORG) | admin/automation only |
| GET | `/api/v1/fiches/jobs` | `jobs:read` (ORG) | |
| GET | `/api/v1/fiches/jobs/:jobId` | `jobs:read` (ORG) | |

#### Recordings
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/recordings/:ficheId` | `recordings:read` (TEAM/ORG) | |

#### Transcriptions
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/v1/transcriptions/:ficheId` | `transcriptions:run` (TEAM/ORG) | Idempotency recommended |
| POST | `/api/v1/transcriptions/batch` | `transcriptions:run` (ORG) | Consider admin-only |
| GET | `/api/v1/transcriptions/:ficheId/status` | `transcriptions:read` (TEAM/ORG) | |
| GET | `/api/v1/transcriptions/:ficheId/recordings/:callId` | `transcriptions:read` (TEAM/ORG) | |

#### Audit configs
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/audit-configs` | `audit_configs:read` (ORG) | |
| GET | `/api/v1/audit-configs/:id` | `audit_configs:read` (ORG) | |
| POST | `/api/v1/audit-configs` | `audit_configs:create` (ORG) | |
| PUT | `/api/v1/audit-configs/:id` | `audit_configs:update` (ORG) | |
| DELETE | `/api/v1/audit-configs/:id` | `audit_configs:delete` (ORG) | |
| POST | `/api/v1/audit-configs/:configId/steps` | `audit_configs:update` (ORG) | |
| PUT | `/api/v1/audit-configs/steps/:stepId` | `audit_configs:update` (ORG) | |
| DELETE | `/api/v1/audit-configs/steps/:stepId` | `audit_configs:update` (ORG) | |
| PUT | `/api/v1/audit-configs/:configId/steps/reorder` | `audit_configs:update` (ORG) | |
| GET | `/api/v1/audit-configs/:configId/validate` | `audit_configs:read` (ORG) | |
| GET | `/api/v1/audit-configs/:configId/stats` | `audit_configs:read` (ORG) | |
| POST | `/api/v1/audit-configs/:configId/versions/:version/activate` | `audit_configs:update` (ORG) | publish/activate version |

#### Audits
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/audits` | `audits:read` (TEAM/ORG) | heavy filters; protect with indexes |
| GET | `/api/v1/audits/grouped-by-fiches` | `audits:read` (TEAM/ORG) | |
| GET | `/api/v1/audits/grouped` | `audits:read` (TEAM/ORG) | dashboards |
| POST | `/api/v1/audits/run` | `audits:run` (TEAM/ORG) | idempotency required |
| POST | `/api/v1/audits/run-latest` | `audits:run` (TEAM/ORG) | |
| POST | `/api/v1/audits/batch` | `audits:run` (ORG) | consider admin-only |
| GET | `/api/v1/audits/by-fiche/:ficheId` | `audits:read` (TEAM/ORG) | |
| GET | `/api/v1/audits/:auditId` | `audits:read` (TEAM/ORG) | |
| PATCH | `/api/v1/audits/:auditId` | `audits:update` (TEAM/ORG) | notes + soft delete |
| DELETE | `/api/v1/audits/:auditId` | `audits:delete` (TEAM/ORG) | soft delete |
| POST | `/api/v1/audits/:auditId/steps/:stepPosition/rerun` | `audits:rerun` (ORG) | consider admin-only |
| POST | `/api/v1/audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/rerun` | `audits:rerun` (ORG) | |
| PATCH | `/api/v1/audits/:auditId/steps/:stepPosition/review` | `audits:review` (TEAM/ORG) | human override |
| GET | `/api/v1/audits/control-points/statuses` | `audits:read` (ORG) | static catalog |
| GET | `/api/v1/audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex` | `audits:read` (TEAM/ORG) | |
| PATCH | `/api/v1/audits/:auditId/steps/:stepPosition/control-points/:controlPointIndex/review` | `audits:review` (TEAM/ORG) | |

#### Automation
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/v1/automation/schedules` | `automation_schedules:create` (ORG) | admin-only recommended |
| GET | `/api/v1/automation/schedules` | `automation_schedules:read` (ORG) | |
| GET | `/api/v1/automation/schedules/:id` | `automation_schedules:read` (ORG) | |
| PATCH | `/api/v1/automation/schedules/:id` | `automation_schedules:update` (ORG) | |
| DELETE | `/api/v1/automation/schedules/:id` | `automation_schedules:delete` (ORG) | |
| POST | `/api/v1/automation/trigger` | `automation_runs:trigger` (ORG) | idempotency recommended |
| GET | `/api/v1/automation/schedules/:id/runs` | `automation_runs:read` (ORG) | |
| GET | `/api/v1/automation/runs/:id` | `automation_runs:read` (ORG) | |
| POST | `/api/v1/automation/runs/:id/cancel` | `automation_runs:cancel` (ORG) | admin-only |
| GET | `/api/v1/automation/runs/:id/logs` | `automation_runs:read` (ORG) | |
| GET | `/api/v1/automation/diagnostic` | `automation:diagnostic` (ORG) | admin-only |

#### Products
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/products/stats` | `products:read` (ORG) | |
| GET | `/api/v1/products/search` | `products:read` (ORG) | |
| GET | `/api/v1/products/link-fiche/:ficheId` | `products:read` (ORG) | |
| GET/POST | `/api/v1/products/groupes` | `products:*` (ORG) | split into read/create |
| GET/PUT/DELETE | `/api/v1/products/groupes/:id` | `products:*` (ORG) | |
| GET/POST | `/api/v1/products/gammes` | `products:*` (ORG) | |
| GET/PUT/DELETE | `/api/v1/products/gammes/:id` | `products:*` (ORG) | |
| GET/POST | `/api/v1/products/formules` | `products:*` (ORG) | |
| GET/PUT/DELETE | `/api/v1/products/formules/:id` | `products:*` (ORG) | |

#### Chat (SSE)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/audits/:auditId/chat/history` | `chat:read` (TEAM/ORG) | |
| POST | `/api/v1/audits/:auditId/chat` | `chat:create` (TEAM/ORG) | SSE streaming |
| GET | `/api/v1/fiches/:ficheId/chat/history` | `chat:read` (TEAM/ORG) | |
| POST | `/api/v1/fiches/:ficheId/chat` | `chat:create` (TEAM/ORG) | SSE streaming |

#### Realtime (Pusher)
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/v1/realtime/pusher/auth` | `realtime:subscribe` (TEAM/ORG) | must enforce channel ownership |
| POST | `/api/v1/realtime/pusher/test` | `realtime:test` (ORG) | admin-only |

#### Webhooks (admin-only)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/webhooks/subscriptions` | `webhooks:read` (ORG) | |
| POST | `/api/v1/webhooks/subscriptions` | `webhooks:create` (ORG) | |
| PATCH | `/api/v1/webhooks/subscriptions/:id` | `webhooks:update` (ORG) | |
| DELETE | `/api/v1/webhooks/subscriptions/:id` | `webhooks:delete` (ORG) | |
| GET | `/api/v1/webhooks/deliveries` | `webhooks:read` (ORG) | |
| POST | `/api/v1/webhooks/test` | `webhooks:test` (ORG) | admin-only |

---

## DTO / contract catalog (REST + SSE + Pusher)
These are the types your codebase should implement in `libs/contracts`.

### Common primitives
```ts
export type BigIntString = string; // DB ids serialized to string
export type ISODateString = string; // "YYYY-MM-DD"
export type ISODateTimeString = string; // ISO 8601

export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> };
export type ApiError = {
  success: false;
  error: string;
  code: string;
  requestId: string;
  details?: unknown; // validation details (typed per validator)
};

export type PaginationMeta = {
  total: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
};
```

---

### Auth / API keys DTOs
```ts
export type LoginRequestDto = { email: string; password: string };
export type LoginResponseDto = { userId: BigIntString; tenantId: BigIntString };

export type ApiKeyDto = {
  id: BigIntString;
  name: string;
  keyPrefix: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt?: ISODateTimeString | null;
  lastUsedAt?: ISODateTimeString | null;
  createdAt: ISODateTimeString;
};

export type CreateApiKeyRequestDto = {
  name: string;
  // role assignments (recommended)
  roles?: Array<{ roleId: BigIntString; scope: "SELF" | "TEAM" | "ORG" | "ALL"; teamId?: BigIntString }>;
  expiresAt?: ISODateTimeString;
};

export type CreateApiKeyResponseDto = {
  apiKey: ApiKeyDto;
  // returned once:
  plaintextKey: string;
};
```

---

### Fiches DTOs
```ts
export type RecordingDto = {
  id: BigIntString;
  ficheId: BigIntString;
  callId: string;
  recordingUrl: string;
  recordingDate?: string | null;
  recordingTime?: string | null;
  startTime?: ISODateTimeString | null;
  durationSeconds?: number | null;
  direction?: string | null;
  answered?: boolean | null;
};

export type FicheSummaryDto = {
  id: BigIntString;
  crmFicheId: string;
  salesDate?: ISODateString | null;
  groupe?: string | null;
  agenceNom?: string | null;
  prospectNom?: string | null;
  prospectPrenom?: string | null;
  prospectEmail?: string | null;
  prospectTel?: string | null;
  hasRecordings: boolean;
  recordingsCount?: number | null;
  fetchedAt: ISODateTimeString;
  expiresAt: ISODateTimeString;
  lastRevalidatedAt?: ISODateTimeString | null;
  assignedUserId?: BigIntString | null;
  assignedTeamId?: BigIntString | null;
};

export type FicheDetailsDto = FicheSummaryDto & {
  recordings: RecordingDto[];
  detailsFetchedAt?: ISODateTimeString | null;
  detailsExpiresAt?: ISODateTimeString | null;
};

export type FicheStatusDto = {
  ficheId: BigIntString;
  transcription: {
    total: number;
    transcribed: number;
    pending: number;
    percentage: number;
    isComplete: boolean;
    lastTranscribedAt?: ISODateTimeString | null;
  };
  audit: {
    total: number;
    completed: number;
    pending: number;
    running: number;
    compliant: number;
    nonCompliant: number;
    averageScore?: number | null;
    latestAudit?: { id: BigIntString; status: string; completedAt?: ISODateTimeString | null } | null;
  };
};

export type ProgressiveFetchJobDto = {
  jobId: string; // cuid/uuid
  startDate: ISODateString;
  endDate: ISODateString;
  status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED" | "CANCELLED";
  progress: number; // 0..100
  createdAt: ISODateTimeString;
};
```

---

### Transcriptions DTOs
```ts
export type TranscriptionRunDto = {
  id: BigIntString;
  ficheId: BigIntString;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  priority: "HIGH" | "NORMAL" | "LOW";
  totalRecordings: number;
  completedCount: number;
  cachedCount: number;
  failedCount: number;
  startedAt?: ISODateTimeString | null;
  completedAt?: ISODateTimeString | null;
  errorMessage?: string | null;
};

export type TranscriptSegmentDto = {
  id: BigIntString;
  sequence: number;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptDto = {
  id: BigIntString;
  recordingId: BigIntString;
  provider: "ELEVENLABS";
  languageCode: string;
  segments: TranscriptSegmentDto[];
};
```

---

### Audit DTOs (typed, no JSON)
```ts
export type TranscriptMode = "prompt" | "tools";

export type RunAuditRequestDto = {
  ficheId: BigIntString;
  auditConfigId: BigIntString;
  transcriptMode?: TranscriptMode; // default "prompt"
};

export type RunAuditResponseDto = {
  auditId: BigIntString;
  status: "QUEUED" | "RUNNING";
};

export type AuditEvidenceDto = {
  id: BigIntString;
  recordingId: BigIntString;
  transcriptSegmentId: BigIntString;
  excerptText: string;
  speaker: string;
  startMs: number;
  endMs: number;
};

export type AuditControlPointResultDto = {
  id: BigIntString;
  controlPointIndex: number;
  labelText: string;
  statut: "PRESENT" | "ABSENT" | "PARTIEL" | "NON_APPLICABLE";
  commentaire?: string | null;
  citationsCount: number;
};

export type AuditStepResultDto = {
  id: BigIntString;
  stepPosition: number;
  stepName: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isCritical: boolean;
  weight: number;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  conforme?: "CONFORME" | "NON_CONFORME" | "PARTIEL" | null;
  score?: number | null;
  maxScore?: number | null;
  niveauConformite?: string | null;
  commentaireGlobal?: string | null;
  totalCitations: number;
  totalTokens: number;
  controlPoints: AuditControlPointResultDto[];
};

export type AuditDto = {
  id: BigIntString;
  ficheId: BigIntString;
  configVersionId: BigIntString;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  transcriptMode: TranscriptMode;
  model: string;
  overallScore?: number | null;
  maxScore?: number | null;
  scorePercentage?: number | null;
  niveau?: string | null;
  isCompliant?: boolean | null;
  successfulSteps: number;
  failedSteps: number;
  totalTokens: number;
  startedAt?: ISODateTimeString | null;
  completedAt?: ISODateTimeString | null;
  stepResults: AuditStepResultDto[];
};

export type ReviewAuditStepRequestDto = {
  conforme: "CONFORME" | "NON_CONFORME" | "PARTIEL";
  traite?: boolean;
  score?: number;
  niveauConformite?: string;
  reason?: string;
};

export type ReviewControlPointRequestDto = {
  statut?: "PRESENT" | "ABSENT" | "PARTIEL" | "NON_APPLICABLE";
  commentaire?: string;
  reason?: string;
};
```

---

### Automation DTOs (typed selection, no JSON)
```ts
export type ScheduleType = "MANUAL" | "DAILY" | "WEEKLY" | "MONTHLY" | "CRON";

export type AutomationScheduleDto = {
  id: BigIntString;
  name: string;
  description?: string | null;
  isActive: boolean;
  scheduleType: ScheduleType;
  timezone: string;
  cronExpression?: string | null;
  timeOfDay?: string | null; // "HH:MM"
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  onlyWithRecordings: boolean;
  onlyUnaudited: boolean;
  maxFiches?: number | null;
  maxRecordingsPerFiche?: number | null;
  runTranscription: boolean;
  skipIfTranscribed: boolean;
  transcriptionPriority: "HIGH" | "NORMAL" | "LOW";
  runAudits: boolean;
  useAutomaticAudits: boolean;
  createdAt: ISODateTimeString;
};

export type AutomationRunDto = {
  id: BigIntString;
  scheduleId: BigIntString;
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  totalFiches: number;
  successfulFiches: number;
  failedFiches: number;
  ignoredFiches: number;
  auditsRun: number;
  transcriptionsRun: number;
  startedAt: ISODateTimeString;
  completedAt?: ISODateTimeString | null;
  errorMessage?: string | null;
};

export type TriggerAutomationRequestDto = { scheduleId: BigIntString };
export type TriggerAutomationResponseDto = { runId: BigIntString; status: "RUNNING" };
```

---

### Chat SSE contract
SSE is for streaming only. Payloads are JSON lines in `data:` frames.

```ts
export type ChatPostRequestDto = { message: string };

export type ChatCitationDto = {
  excerptText: string;
  speaker: string;
  startMs: number;
  endMs: number;
  recordingId: BigIntString;
  transcriptSegmentId: BigIntString;
};

// SSE frames:
export type ChatStreamChunk = { text: string };
export type ChatStreamCitations = { citations: ChatCitationDto[] };
export type ChatStreamError = { error: string; code?: string };
// Stream terminator:
// data: [DONE]
```

---

### Pusher event type catalog (TypeScript)
```ts
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
  | "automation.started"
  | "automation.progress"
  | "automation.completed"
  | "automation.failed";
```
