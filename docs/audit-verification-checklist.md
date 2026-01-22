## Audit pipeline — deep verification checklist (living doc)

**Scope**: end-to-end audit run (HTTP → Inngest → DB → realtime/Pusher) + batch + reruns + human review.  
**Last updated**: 2026-01-21  
**Last verified**: `npm run build` ✅, `npm test` ✅ (see repo scripts).  

### How to use this doc

- Treat this as the **single checklist** for verifying correctness + debuggability.
- For each section:
  - Confirm expected behavior in code + runtime logs.
  - Record any findings under “Notes / findings”.
  - If you change behavior, update the “Expected” and “Debug” subsections here.

### Legend

- **`[x]`** verified recently
- **`[ ]`** not yet verified / needs verification
- **`[ ] (gap)`** known gap / improvement opportunity (documented so we don’t forget)

---

### Glossary (IDs and why debugging is confusing without this)

#### Identifiers you will see

- **`fiche_id`**: CRM fiche identifier (string).
- **`audit_db_id`**: Postgres/Prisma `audits.id` (BigInt, serialized as string in JSON).
- **`audit_id` (tracking id)**: a string like `audit-${fiche_id}-${audit_config_id}-${timestamp}` used in realtime payloads.
- **`event_id`**: Inngest event id returned by `inngest.send(...)`.

#### Critical mapping rule (do not mix these)

- **Realtime/Pusher payloads** use `audit_id` (tracking id) most of the time.
- **DB/API detail endpoints** use `audit_db_id` (BigInt string).
- **Inngest domain event `audit/completed`** uses legacy `audit_id = audit_db_id` (field name is confusing), but also includes `audit_db_id` + `audit_tracking_id`.

If you’re debugging “where did my audit go?”, always decide which ID space you’re in first.

#### Recent improvements (debuggability)

- Realtime events now include **`audit_db_id`** (when known), so you can jump from a Pusher message → `GET /api/audits/:audit_db_id`.
- Channel routing now also considers **`audit_db_id`**, so many audit events are published to **both**:
  - `audit` channel for tracking id (`audit_id`)
  - `audit` channel for DB id (`audit_db_id`)

### Frontend migration summary (what changed and what to adapt)

If you’re updating the frontend, the key behavioral changes are:

- **Audit identifiers**:
  - Prefer `audit_db_id` for REST navigation (`GET /api/audits/:audit_db_id`) and Pusher subscription (`private-audit-{audit_db_id}`) when available.
  - Realtime payloads may include both `audit_id` (tracking) and `audit_db_id` (DB); channel routing can publish to both.
- **Reruns now mutate stored audits**:
  - Step reruns and control-point reruns now update the stored audit step rows (`audit_step_results`) and recompute audit-level compliance summary.
  - UI should treat rerun as **async → refetch** after receiving `audit.step_completed` with `rerun_id`.
- **Automation realtime (new)**:
  - Automation emits `automation.run.started|selection|completed|failed` on `private-job-automation-run-{run_id}` (job id is `automation-run-{run_id}`).
- **Batch audits require Redis**:
  - `POST /api/audits/batch` returns `503` if Redis is not configured; UI must handle this.
- **Optional API token auth**:
  - If enabled (`API_AUTH_TOKEN`/`API_AUTH_TOKENS`), all `/api/*` requests (including `/api/realtime/pusher/auth` and chat streaming) require `Authorization: Bearer ...` or `X-API-Key: ...`.

See `docs/BACKEND_FRONTEND_CONTRACT.md` for the frontend DTOs and the suggested integration flow.

---

### Architecture summary (what actually happens)

```mermaid
flowchart TD
  A[HTTP POST /api/audits/run] -->|inngest.send audit/run| B[runAuditFunction]
  B --> C{Prereqs OK?}
  C -->|fetch fiche if needed| F[fetchFicheFunction]
  C -->|transcribe if needed| T[transcribeFicheFunction]
  B --> D[createPendingAudit -> audits row (running)]
  B --> E[build timeline from DB]
  B --> R[Redis cache audit context]
  B -->|sendEvent audit/step.analyze (N steps)| S[auditStepAnalyzeFunction]
  S -->|upsert audit_step_results| DB1[(DB)]
  S -->|sendEvent audit/step.analyzed| G[finalizeAuditFromStepsFunction]
  G -->|evidence gating + scoring| DB2[(DB finalize)]
  G -->|Pusher events| P[Pusher publish]
```

---

## 0) Configuration & observability (make debugging easy)

### 0.1 Environment variables that materially change audit behavior

**Audit + LLM**
- `OPENAI_API_KEY` (required for audits)
- `OPENAI_MODEL_AUDIT` (default used by analyzer, fallback `"gpt-5.2"`)
- `AUDIT_EVIDENCE_GATING` (`"0"` disables deterministic citation gating; default enabled)
- `AUDIT_EVIDENCE_MIN_QUOTE_CHARS` (default `12`) — minimum normalized quote length to accept a citation during evidence gating
- `PRODUCT_VECTORSTORE_FALLBACK` (`"1"` enables vector store fallback for product verification when DB match is missing; default disabled)

**Audit orchestration concurrency**
- `AUDIT_RUN_CONCURRENCY` (global cap for `audit/run`)
- `AUDIT_RUN_PER_FICHE_CONCURRENCY` (per-fiche cap; default 1, protects against overlapping audits for same fiche)
- `AUDIT_STEP_WORKER_CONCURRENCY` (global cap for `audit/step.analyze` workers)
- `AUDIT_STEP_PER_AUDIT_CONCURRENCY` (per-audit cap for step workers)

**Audit context caching**
- `REDIS_URL` (if missing: audit context caching is disabled and workers rebuild timeline from DB)
- `AUDIT_CONTEXT_TTL_SECONDS` (Redis cache TTL; default 6h)
- `AUDIT_STEP_TIMELINE_EXCERPT` (`"0"` disables per-step excerpt optimization; default enabled)
- `AUDIT_STEP_TIMELINE_MAX_CHUNKS` (excerpt chunk cap; default 40)

**Batch audits (Redis-backed progress)**
- `AUDIT_BATCH_STATE_TTL_SECONDS` (Redis TTL for batch progress state; default 6h)
- `BATCH_AUDIT_PROGRESS_CONCURRENCY` (Inngest concurrency cap for batch progress updaters)

**Transcription (prerequisite)**
- `ELEVENLABS_API_KEY` (required when transcription is invoked)
- `TRANSCRIPTION_RECORDING_CONCURRENCY` (local transcription bounded parallelism)

**Automation (schedules + orchestration)**
- `AUTOMATION_SCHEDULER_CRON` (cron for `scheduledAutomationCheck`; default `*/1 * * * *`)
- `AUTOMATION_SCHEDULER_WINDOW_MINUTES` (scheduler “due window” when deciding if a schedule should run; default 20, min 5)
- `FICHE_SALES_CACHE_CONCURRENCY` (limits DB writes when caching sales summaries during automation date revalidation; default 10)
- `AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS` (max wait for distributed `fiche/fetch` to produce full details; default 10m, min 60s)
- `AUTOMATION_FICHE_DETAILS_POLL_INTERVAL_SECONDS` (DB poll interval for fiche details readiness; default 20s, min 5s)
- `AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS` (max wait for transcriptions during automation; default 15m, min 60s)
- `AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS` (DB poll interval for transcription completion; default 30s, min 5s)
- `AUTOMATION_AUDIT_MAX_WAIT_MS` (max wait for audits during automation; default 30m, min 60s)
- `AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS` (DB poll interval for audit completion; default 60s, min 5s)
- `AUTOMATION_MAX_RECORDINGS_PER_FICHE` (global safeguard: ignore fiches with too many recordings; schedule can override via `ficheSelection.maxRecordingsPerFiche`)
- SMTP (optional, for automation email notifications):
  - `SMTP_HOST`, `SMTP_PORT` (default 587)
  - `SMTP_USER`, `SMTP_PASS` (optional; supports unauthenticated relay)
  - `SMTP_FROM` (from address; falls back to `SMTP_USER`)
  - `SMTP_SECURE=1` (or use port 465)
  - `SMTP_TIMEOUT_MS` (default 10000; connection/greeting/socket timeout)

**Pusher realtime**
- `PUSHER_APP_ID`, `PUSHER_KEY` (or `NEXT_PUBLIC_PUSHER_KEY`), `PUSHER_SECRET`, `PUSHER_CLUSTER`
- `PUSHER_USE_PRIVATE_CHANNELS` (`"0"` disables `private-` prefix)
- `PUSHER_MAX_PAYLOAD_BYTES` (default ~9000 bytes to stay under Pusher limits)
- `PUSHER_DRY_RUN=1` (log-only mode; no outbound Pusher network calls)

**API auth (optional, recommended for any public deployment)**
- `API_AUTH_TOKEN` (single token) / `API_AUTH_TOKENS` (CSV list for rotation)
  - When set, all `/api/*` endpoints (except `/api/inngest`) require:
    - `Authorization: Bearer <token>` or `X-API-Key: <token>`

### 0.2 Correlation (what to log / keep)

For every audit run, you want to be able to correlate:
- `fiche_id`
- `audit_id` (tracking)
- `audit_db_id` (DB)
- `audit_config_id`
- `inngest event_id` for `audit/run` (returned by HTTP route)

Current status:
- [x] Realtime payloads carry `audit_db_id` once the audit row is created.
- [x] The Inngest `event_id` is included in audit realtime payloads (e.g. `audit.started.event_id`).

### 0.3 Inngest function IDs (useful for UI/search)

Audits:
- `run-audit` (`audit/run`)
- `audit-step-analyze` (`audit/step.analyze`)
- `audit-finalize-from-steps` (`audit/step.analyzed`)
- `batch-audit` (`audit/batch`)
- `batch-audit-progress-completed` (`audit/completed`)
- `batch-audit-progress-failed` (`audit/failed`)
- `rerun-audit-step` (`audit/step-rerun`)
- `rerun-audit-step-control-point` (`audit/step-control-point-rerun`)

Fiches:
- `fetch-fiche` (`fiche/fetch`)
- `revalidate-fiches-for-date` (`fiches/revalidate-date`)
- `cache-sales-list-for-date-range` (`fiches/cache-sales-list`)
- `progressive-fetch-continue` (`fiches/progressive-fetch-continue`)
- `progressive-fetch-day` (`fiches/progressive-fetch-day`)
- `progressive-fetch-update-job` (`fiches/progressive-fetch-day.processed`)

Transcriptions:
- `transcribe-fiche` (`fiche/transcribe`)
- `transcribe-recording` (`transcription/recording.transcribe`)
- `finalize-fiche-transcription` (`transcription/recording.transcribed`)

Automation:
- `run-automation` (`automation/run`)
- `scheduled-automation-check` (cron trigger; dispatches `automation/run`)

### 0.4 Redis keys (audit context)

When Redis is enabled, `runAuditFunction` writes:
- `audit:{audit_db_id}:config`
- `audit:{audit_db_id}:timelineText`
- `audit:{audit_db_id}:timeline`
- `audit:{audit_db_id}:productInfo` (optional)
- `audit:{audit_db_id}:step:{position}:timelineText` (optional per-step excerpt)

Workers and finalizer read these keys and fall back to DB rebuilds if missing.

### 0.5 Security / access control (current state)

- [ ] (gap) This backend has no user/org auth system yet (no JWT/session/tenant membership).
  - **Current reality**
    - There is no “caller identity” in request context (no `req.user`, no `org_id`/tenant model).
    - Many resources are keyed by `fiche_id` / `audit_db_id` only (and chat conversations are keyed by `audit_id` / `fiche_id`).
  - **Short-term mitigation**: enable API token auth via `API_AUTH_TOKEN(S)` to prevent anonymous access.
    - When enabled, it protects **all** `/api/*` endpoints (including `/api-docs` / `/api-docs.json`), except `/api/inngest`.
    - Accepted headers: `Authorization: Bearer <token>` or `X-API-Key: <token>`.
  - **Longer-term options**
    - Add JWT/session auth + `users/orgs/memberships` tables and stamp `org_id` on persisted rows (audits, transcriptions, chat, schedules).
    - Or proxy sensitive endpoints (notably Pusher auth + chat) through a trusted Next.js API route that already has user session context.
- [ ] (gap) Even with API token auth, Pusher “private channel auth” endpoint still does not validate user membership (only naming allowlists).
  - **Current behavior**
    - It validates channel names + allowlisted prefixes only (see `src/shared/pusher.ts` + `src/modules/realtime/realtime.routes.ts`).
    - Presence channels require `user_id`, but there is **no validation** of that `user_id` against any user store.
  - **Risk**
    - Any caller who can hit `/api/realtime/pusher/auth` can subscribe to allowlisted channels if they can guess identifiers.
  - **Recommended**
    - Add real auth + membership checks (or proxy this endpoint through Next.js).
    - Encode tenant ownership into channel names (e.g. `private-org-{orgId}-audit-{auditId}`) and verify the requester’s membership before signing.

### 0.6 If/when adding real auth (recommended checklist)

- Add an auth middleware (JWT/session) that attaches `req.user` and `req.orgId` (or equivalent).
- Stamp `org_id` (and optionally `user_id`) on persisted entities:
  - audits + step results
  - transcriptions + recordings
  - chat conversations/messages
  - automation schedules/runs/logs
- Update Pusher auth:
  - validate membership/ownership for `audit-*`, `fiche-*`, `job-*`, `global`
  - never trust `user_id` provided by the client for presence channels; derive it from auth context
- Propagate identity into workflows:
  - add `trigger_user_id` / `org_id` to Inngest events where relevant (`audit/run`, `fiche/transcribe`, `automation/run`)
  - include identity in webhook meta where needed for downstream correlation

---

## 1) HTTP entrypoints (audits API)

**Primary files**
- `src/modules/audits/audits.routes.ts`
- `src/modules/audits/audits.rerun.routes.ts`

### 1.0 Read/list endpoints (DB-backed)

- [x] `GET /api/audits` list audits (filters + pagination)
  - Uses `parseListAuditsQuery` (Zod) → `auditsService.listAudits`
  - Returns `{ success, data, pagination }`
- [x] List query params (parsed by `parseListAuditsQuery`)
  - CSV lists (comma-separated strings):
    - `fiche_ids`
    - `status` (`pending|running|completed|failed`)
    - `audit_config_ids`
    - `groupes`
    - `sales_dates`
    - `niveau` (`EXCELLENT|BON|ACCEPTABLE|INSUFFISANT|REJET|PENDING`)
    - `automation_schedule_ids`
    - `automation_run_ids`
    - `trigger_source`
  - Strings:
    - `groupe_query`, `agence_query`, `prospect_query`
    - `sales_date_from`, `sales_date_to` (YYYY-MM-DD strings; not date-parsed here)
    - `q` (generic search)
  - Date strings (parsed with `new Date(...)`, invalid → 400):
    - `date_from`, `date_to`
    - `fetched_at_from`, `fetched_at_to`
    - `last_revalidated_from`, `last_revalidated_to`
  - Boolean strings:
    - `is_compliant`, `has_recordings`, `has_failed_steps`
    - `latest_only` (default true), `include_deleted` (default false)
  - Numeric strings:
    - `recordings_count_min`, `recordings_count_max`
    - `score_min`, `score_max`
    - `duration_min_ms`, `duration_max_ms`
    - `tokens_min`, `tokens_max`
    - `limit` (clamped 1–500, default 100), `offset` (>=0, default 0)
  - Sorting:
    - `sort_by` (`created_at|completed_at|score_percentage|duration_ms`, default `created_at`)
    - `sort_order` (`asc|desc`, default `desc`)
- [x] `GET /api/audits/grouped-by-fiches` list audits grouped by fiche
  - Uses same filters + pagination shape as list
- [x] `GET /api/audits/grouped` flexible aggregation (explicit `group_by=...`)
  - Allowed `group_by`: `fiche`, `audit_config`, `status`, `niveau`, `automation_schedule`, `automation_run`, `groupe`, `created_day`, `score_bucket`
  - **Expected**: reject unknown `group_by` with 400 validation error
- [x] `GET /api/audits/by-fiche/:fiche_id` list audit history for a fiche
  - Supports `?include_details=true`
- [x] `GET /api/audits/:audit_id` get audit detail by DB id
- [x] `GET /api/audits/control-points/statuses` list allowed checkpoint status values (UI dropdown)
- [x] `GET /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index` read a single stored checkpoint (status + comment)

### 1.0.1 Chat endpoints (audit QA, streaming)

**Primary file**
- `src/modules/chat/chat.routes.ts` (mounted under `/api`)

- [x] `GET /api/audits/:audit_id/chat/history` returns stored conversation messages
- [x] `POST /api/audits/:audit_id/chat` streams assistant response over SSE (`text/event-stream`)
- [x] `GET /api/fiches/:fiche_id/chat/history` returns stored conversation messages
- [x] `POST /api/fiches/:fiche_id/chat` streams assistant response over SSE (`text/event-stream`)
  - Note: history is capped to the **most recent 50** messages (returned in chronological order) for performance.

**SSE wire format (what the frontend should parse)**
- Many events: `data: {"text":"..."}`
- Optional final citations event: `data: {"citations":[...]}`
- Terminal event: `data: [DONE]`
 - Error event (when streaming fails mid-flight): `data: {"type":"error","code":"STREAM_ERROR","error":"..."}`

**Citation behavior (important)**
- Chat responses embed citations using `[CITATION:{...}]` markers inside the model output.
- The server:
  - streams text chunks **without** citation markers to the UI
  - collects the full response server-side
  - extracts citations from markers and validates them against the referenced transcript chunk
  - enriches `recording_url`, `recording_date`, `recording_time` from the timeline
- Invalid/unverifiable citations are dropped (result may contain 0 citations).

**Potential issues**
- [x] (fixed) Once SSE headers are sent, central error handler can’t respond; chat routes now self-emit a structured SSE error (`code=STREAM_ERROR`) and still terminate with `[DONE]`.
- [ ] (gap) These endpoints have no user/org access control.
  - Mitigation: enable API token auth via `API_AUTH_TOKEN(S)` to prevent anonymous access.
  - Note: conversations are keyed by `audit_id` / `fiche_id` only (no per-user isolation today).
  - Risk: if the API token is shared across multiple human users, any token holder can read any audit/fiche chat history by ID.
  - Recommended: add `owner_user_id`/`org_id` to chat tables and enforce it in routes.

### 1.0.2 Audit metadata update / soft delete

- [x] `PATCH /api/audits/:audit_id` update non-result metadata (notes/linkage/soft-delete)
  - Valid body fields (see `updateAuditInputSchema`):
    - `notes` (string | null)
    - `deleted` (boolean) — sets/clears `deletedAt`
    - `automation_schedule_id`, `automation_run_id` (BigInt strings)
    - `trigger_source`, `trigger_user_id` (strings)
- [x] `DELETE /api/audits/:audit_id` soft-deletes the audit (sets `deletedAt`)

**Visibility defaults**
- List endpoints default to `latest_only=true` and `include_deleted=false` (deleted audits are hidden unless explicitly requested).

### 1.1 Run endpoints

- [x] `POST /api/audits/run` queues `audit/run`
- [x] `POST /api/audits` is alias of run (also accepts automation linkage fields)
- [x] `POST /api/audits/run-latest` queues `audit/run` with latest active config
- [x] `use_rlm` / `useRlm` is accepted and forwarded

**Expected**
- Response returns `event_id` **and** tracking `audit_id`, not `audit_db_id`.
- Frontend should track progress via:
  - `fiche` channel (recommended), because payload includes `fiche_id`
  - optionally audit tracking id channel using the returned `audit_id`
  - once `audit.started` arrives, you can capture:
    - `audit_db_id` (REST id)
    - `event_id` (Inngest id)

**Notes**
- [x] Routes return the **tracking `audit_id`**, so clients can subscribe to `audit-*` immediately if desired.

### 1.2 Batch

- [x] `POST /api/audits/batch` queues `audit/batch`

**Expected**
- Response returns `{ batch_id, event_ids, fiche_ids, audit_config_id }`
- Progress/completion is delivered via realtime events:
  - `batch.progress`
  - `batch.completed`
 - `batch_id` in realtime payloads matches the `batch_id` returned by the HTTP route.

**Implementation notes (how batch actually works)**
- `audit/batch` (`batchAuditFunction`) does **not** “wait for completion” in the HTTP request; it:
  - emits an initial `batch.progress` (started)
  - requires Redis and initializes Redis state
  - fans out `audit/run` for each fiche (deterministic IDs)
  - returns immediately
- Completion/progress is driven by separate functions listening to:
  - `audit/completed` (emitted by audit finalizer)
  - `audit/failed` (emitted by `audit/run.onFailure`)

**Redis keys (batch audit)**
- `audit:batch:{batch_id}:meta` (hash counters: total/succeeded/failed + started time)
- `audit:batch:{batch_id}:pending` (set of remaining fiche_ids)
- `audit:batch:{batch_id}:finalized` (SETNX guard; ensures “completed” only once)
- `audit:batch:index:{audit_config_id}:{fiche_id} -> batch_id` (lookup on completed/failed)

**Potential issues**
- [x] Batch realtime events publish to:
  - `global` (because event name starts with `batch.`)
  - `job-{batch_id}` (derived from `batch_id` for easier subscription)
- [x] Redis is a hard requirement for batch audits:
  - `POST /api/audits/batch` returns `503` if Redis is not configured (`REDIS_URL` missing/unusable)
  - This avoids “silent” batches where progress/finalization can’t be tracked

### 1.2.1 Automation-triggered audits (fan-out)

**Primary file**
- `src/modules/automation/automation.workflows.ts`

- [x] Full automation orchestration is documented in **section 2.6** (schedule → selection → fiche fetch → transcription → audits → finalize).
- [x] Automation fans out **many** `audit/run` events with linkage fields:
  - `automation_schedule_id`
  - `automation_run_id`
  - `trigger_source: "automation"`
- [x] Fan-out event IDs are deterministic (`automation-{runId}-audit-{ficheId}-{configId}`) to avoid duplicate dispatch on retries.

**Debug**
- If an automation run “hangs” waiting for audits:
  - Check `AUTOMATION_AUDIT_MAX_WAIT_MS` and `AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS`
  - Confirm audits are being created after the automation `startTime` (the polling query uses `createdAt >= startedAt`)

### 1.3 Human review (post-run QA)

- [x] `PATCH /api/audits/:audit_id/steps/:step_position/review`
- [x] `PATCH /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/review`

**Expected**
- **Step review** (`.../steps/:step_position/review`):
  - Updates step summary fields (conforme/score/etc) **and** appends an audit trail entry into `rawResult.human_review`
  - Recomputes audit-level compliance summary fields (so list endpoints stay consistent)
- **Control point review** (`.../control-points/:control_point_index/review`):
  - Updates `rawResult.points_controle[i].statut` and/or `.commentaire`
  - Appends an audit trail entry into `rawResult.human_review`
  - Does **not** recompute step score/conforme or audit compliance today (it’s an annotation/override at raw level only)

### 1.4 Reruns (async, **do** update stored audit)

- [x] `POST /api/audits/:audit_id/steps/:step_position/rerun` → `audit/step-rerun`
- [x] `POST /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/rerun` → `audit/step-control-point-rerun`

**Expected**
- Reruns send rerun webhooks + events **and** update stored audit rows (so UI fetch reflects the rerun).
  - Step rerun persists the new step result into `audit_step_results` (including `raw_result`) and recomputes audit-level compliance summary fields on `audits` (score/niveau/critical).
  - Control point rerun updates `audit_step_results.raw_result.points_controle[i]`, **recomputes step score/conforme deterministically** from checkpoint statuses, and recomputes audit-level compliance summary.
  - Both rerun paths keep an audit trail in `audit_step_results.raw_result.rerun_history`.
  - Realtime uses the same event names as normal step analysis (`audit.step_started`, `audit.step_completed`) but includes `rerun_id` and (for control points) `rerun_scope`.
  - In rerun flows, the `audit_id` field is the **audit DB id** (because the HTTP route takes the audit DB id).
  - Implementation detail: the rerun analysis itself calls `analyzeStep(...)`, which also emits `audit.step_started`/`audit.step_completed` using a **distinct** `audit_id` prefix (`rerun-{audit_db_id}-...`) to avoid colliding with the original audit channel.

**Potential issues**
- [x] UI expectation fixed: reruns now update the stored audit (`audit_step_results` + audit compliance summary).
  - Note: this is **mutating** (no audit versioning yet), but is auditable via `raw_result.rerun_history`.
- [x] Rerun HTTP endpoints validate `audit_id` as BigInt at the edge (400 on invalid).
- [x] Step rerun `rerun_id` includes `event.id` (unique per rerun).

---

## 2) Inngest typing + registration

**Primary files**
- `src/inngest/client.ts` (typed schemas)
- `src/inngest/index.ts` (function aggregator)
- `src/app.ts` (`/api/inngest` mount)

- [x] All audit events are typed (`AuditsEvents`) and registered in `Events` record.
- [x] All audit functions are exported via `src/modules/audits/index.ts` and served by `/api/inngest`.

### 2.1 Audit completion/failure domain events (used by batch progress)

- [x] `audit/completed` is emitted by the audit finalizer (after DB finalize + webhooks)
  - Payload includes `fiche_id`, `audit_config_id`, `score`, `niveau`, `duration_ms`, `use_rlm`
  - **Important**: legacy field name `audit_id` in this event is actually `audit_db_id` (BigInt as string)
  - For clarity, payload also includes:
    - `audit_db_id`
    - `audit_tracking_id`
- [x] `audit/failed` is emitted by `runAuditFunction.onFailure`
  - Used by batch progress updater to count failures
  - Payload includes `fiche_id`, `audit_config_id`, `error`, `retry_count`
  - May include `audit_db_id` / `audit_tracking_id` when resolvable in `onFailure`

### 2.2 Batch audit event payload (`audit/batch`)

- [x] `audit/batch` now includes a `batch_id` (string) in event data (propagated from HTTP) so batch realtime payloads are correlatable.

**Known operational caveat**
- [x] Self-hosted Inngest now polls the SDK URL for function definition changes (no restart required).
  - We run `inngest start --sdk-url ... --poll-interval ${INNGEST_POLL_INTERVAL:-60}` in Docker Compose, so newly added function IDs/events should be discovered within the poll window.
  - If you need immediate pickup after deploy, restarting the `inngest` service/container is still a valid “force refresh” shortcut.

---

## 2.5) Prerequisites: fiche caching + transcription (audits depend on these)

### 2.5.1 Fiche caching (“sales list only” vs “full details”)

**Primary files**
- `src/modules/fiches/fiches.cache.ts` (`getFicheWithCache`, `cacheFicheDetails`)
- `src/modules/fiches/fiches.api.ts` (`fetchFicheDetails`, `fetchSalesWithCalls`)
- `src/modules/fiches/fiches.workflows.ts` (`fetchFicheFunction`)
- `src/modules/fiches/fiches.repository.ts` (`getCachedFiche`)

- [x] Minimal caches created from sales list are marked with `_salesListOnly: true`.
- [x] `fetchFicheFunction` treats `_salesListOnly` cache as “needs fetch” and refreshes full details.
- [x] `runAuditFunction` also treats `_salesListOnly` cache as “needs fetch” (prevents running audits on incomplete fiche data).
- [x] Cache-miss behavior: `getFicheWithCache` will fetch fiche details from the gateway (by `fiche_id`) and best-effort persist them to DB cache.
  - If refresh fails but we already have **full** cached details, it returns cached data (stale-but-usable) instead of failing.
  - If cache is **sales-list-only** and refresh fails, it fails (because audit prerequisites require full details/recordings).
- [x] External fetch behavior: `fichesApi.fetchFicheDetails` calls the gateway `GET /api/fiches/by-id/:fiche_id` (no `cle` param required; gateway refreshes internally).
  - If `FICHE_API_AUTH_TOKEN` is set, it is sent as `Authorization: Bearer ...`.
  - Axios errors are sanitized (no leaking query params/headers).
  - Error mapping: upstream 404 → HTTP 404 (`code=NOT_FOUND`), other upstream failures → HTTP 502 (`code=EXTERNAL_API_ERROR`).

**Debug**
- If audits are running with `recordings_count = 0` unexpectedly:
  - Verify fiche rawData has `_salesListOnly: true`
  - Confirm `fiche/fetch` has been run to persist full details + recordings

### 2.5.2 Transcription pipeline (required for timeline)

**Primary files**
- `src/modules/transcriptions/transcriptions.workflows.ts` (`transcribeFicheFunction`)
- `src/modules/transcriptions/transcriptions.service.ts` (`getFicheTranscriptionStatus`)

- [x] Audit orchestrator checks transcription status and invokes transcription when incomplete.
- [x] Transcription workflow handles `0` recordings without failing (fast no-op completion).

**How transcription works (distributed, cross-replica)**
- Orchestrator event: `fiche/transcribe` (`transcribeFicheFunction`)
  - Loads a JSON-safe transcription “plan” from DB (`ficheCache.recordings`) so it can fan-out per recording.
  - Emits `transcription.status_check`, then `transcription.started`.
  - If `totalRecordings === 0` or everything is already transcribed:
    - emits `fiche/transcribed` immediately (no-op) and returns success.
  - Else:
    - tries to use Redis for aggregation + locks (preferred)
    - fans out `transcription/recording.transcribe` per recording with deterministic ids (`transcription-recording-{run_id}-{call_id}`)
    - if Redis is unavailable, falls back to DB polling until the targeted recordings are transcribed (or timeout).
- Per-recording worker: `transcription/recording.transcribe` (`transcribeRecordingFunction`)
  - Uses a per-recording Redis lock (`lock:transcription:recording:{fiche_id}:{call_id}`) to prevent duplicate work across replicas.
  - Writes transcription to DB and emits `transcription/recording.transcribed`.
- Finalizer: `transcription/recording.transcribed` (`finalizeFicheTranscriptionFunction`)
  - Aggregates per-recording results (Redis mode) and emits `transcription.completed` / `transcription.failed` and `fiche/transcribed`.

**Redis keys (transcription runs, when Redis is enabled)**
- Run state:
  - `transcription:fiche:{fiche_id}:run:{run_id}:meta`
  - `transcription:fiche:{fiche_id}:run:{run_id}:pending`
  - `transcription:fiche:{fiche_id}:run:{run_id}:failed`
  - `transcription:fiche:{fiche_id}:activeRun`
- Locks:
  - `lock:transcription:fiche:{fiche_id}`
  - `lock:transcription:recording:{fiche_id}:{call_id}`

**Potential issues**
- [x] `runAuditFunction` treats `total_recordings = 0` as “complete” (skips transcription invocation).

### 2.5.3 Fiches module (exports surface area)

Goal: don’t miss hidden prerequisite surface area.

**Primary entry**: `src/modules/fiches/index.ts`

- [x] HTTP routes: `fichesRouter` (`src/modules/fiches/fiches.routes.ts`)
  - Includes: sales search, fiche details fetch/cache, status endpoints, and progressive fetch job endpoints.
- [x] Inngest workflows: `fichesFunctions` (`src/modules/fiches/fiches.workflows.ts`)
  - [x] `fetchFicheFunction` (`fiche/fetch`)
  - [x] `revalidateFichesFunction` (`fiches/revalidate`)
  - [x] `cacheSalesListFunction` (`fiches/cache-sales-list`)
  - [x] `progressiveFetchContinueFunction` (`fiches/progressive-fetch-continue`)
  - [x] `progressiveFetchDayFunction` (`fiches/progressive-fetch-day`)
  - [x] `progressiveFetchUpdateJobFunction` (`fiches/progressive-fetch-day.processed`)
- [x] Service façade: `fichesService` (`src/modules/fiches/fiches.service.ts`)
- [x] Cache orchestration: `fichesCache` (`src/modules/fiches/fiches.cache.ts`)
- [x] DB repository: `fichesRepository` (`src/modules/fiches/fiches.repository.ts`)
- [x] External API client: `fichesApi` (`src/modules/fiches/fiches.api.ts`)
- [x] Revalidation helpers: `fichesRevalidation` (`src/modules/fiches/fiches.revalidation.ts`)
- [x] Zod schemas/types: `fiches.schemas.ts` (exports types inferred from schemas)
- [x] Inngest event typing: `FichesEvents` (`src/modules/fiches/fiches.events.ts`)

### 2.5.4 Transcriptions module (exports surface area)

**Primary entry**: `src/modules/transcriptions/index.ts`

- [x] HTTP routes: `transcriptionsRouter` (`src/modules/transcriptions/transcriptions.routes.ts`)
  - Includes: queue transcription (`POST /api/transcriptions/:fiche_id`), status, per-recording transcription fetch, batch queue.
- [x] Service façade: `transcriptionsService` (`src/modules/transcriptions/transcriptions.service.ts`)
- [x] DB repository: `transcriptionsRepository` (`src/modules/transcriptions/transcriptions.repository.ts`)
- [x] Types: `transcriptions.types.ts`
- [x] Inngest workflows: `transcriptionsFunctions` (`src/modules/transcriptions/transcriptions.workflows.ts`)
  - [x] `transcribeFicheFunction` (`fiche/transcribe`)
  - [x] `transcribeRecordingFunction` (`transcription/recording.transcribe`)
  - [x] `finalizeFicheTranscriptionFunction` (`transcription/recording.transcribed`)
- [x] Inngest event typing: `TranscriptionsEvents` (`src/modules/transcriptions/transcriptions.events.ts`)
- [x] Provider client: `transcriptions.elevenlabs.ts`
  - Normalizes `ELEVENLABS_API_KEY` (trim + strip surrounding quotes)
  - Never rethrows raw AxiosError (sanitized messages avoid leaking headers like `xi-api-key`)

---

## 2.6) Automation flow (schedules → run orchestration → fan-out)

Automation is an additional “meta-orchestrator” that can:
- select fiches (manual or date-range)
- ensure prerequisites (fiche details → transcriptions)
- fan-out audits and track completion
- persist a run summary + logs

**Primary files**
- `src/modules/automation/automation.routes.ts` (HTTP)
- `src/modules/automation/automation.workflows.ts` (Inngest workflows)
- `src/modules/automation/automation.service.ts` (cron/date logic + helpers)
- `src/modules/automation/automation.repository.ts` (Prisma)
- `src/modules/automation/automation.schemas.ts` (Zod)
- `src/modules/automation/automation.events.ts` (typed events)
- `src/modules/automation/automation.cron.ts` (cron matcher)
- `src/modules/automation/automation.api.ts` (external API + notifications)
- `prisma/schema.prisma` (`AutomationSchedule`, `AutomationRun`, `AutomationLog`)

### 2.6.1 HTTP entrypoints (`/api/automation/*`)

- [x] `POST /api/automation/schedules` create schedule
- [x] `GET /api/automation/schedules?include_inactive=true|false` list schedules
- [x] `GET /api/automation/schedules/:id` get schedule (includes last 10 runs)
- [x] `PATCH /api/automation/schedules/:id` update schedule
- [x] `DELETE /api/automation/schedules/:id` delete schedule
- [x] `POST /api/automation/trigger` queues `automation/run`
  - Input: `{ scheduleId, overrideFicheSelection? }`
  - Response: `{ success, message, schedule_id, event_ids }`
- [x] `GET /api/automation/diagnostic` returns Inngest “mode” + config hints
- [x] `GET /api/automation/schedules/:id/runs?limit=&offset=` list runs (pagination)
- [x] `GET /api/automation/runs/:id` run detail (includes logs)
- [x] `GET /api/automation/runs/:id/logs?level=` logs (optional filter)

**Security note**
- [ ] (gap) These endpoints have no user/org access control.
  - Mitigation: enable API token auth via `API_AUTH_TOKEN(S)` to prevent anonymous access.
  - Risk: schedule creation can trigger large fan-out work + outbound webhook calls; treat schedule management as privileged.

### 2.6.2 Inngest functions + events (automation domain)

**Functions (IDs)**
- [x] `run-automation` (`automation/run`) — main run orchestrator
  - retries: 2
  - timeout: `finish=2h`
- [x] `scheduled-automation-check` (cron) — scheduler tick (dispatches `automation/run`)
  - concurrency: limit 1 (prevents overlapping ticks)
  - retries: 1

**Events**
- [x] `automation/run` is dispatched by:
  - `POST /api/automation/trigger`
  - `scheduledAutomationCheck` (cron)
- [x] `automation/completed` is emitted by `runAutomationFunction` on completion (status: `completed|partial|failed`)
- [x] `automation/failed` is emitted by `runAutomationFunction` on catastrophic failure

**Payload contract**
- `automation/completed`:
  - `schedule_id`, `run_id`, `status`
  - `total_fiches`, `successful_fiches`, `failed_fiches`, `duration_ms`
- `automation/failed`:
  - `schedule_id`, `run_id`, `error`

**Correlation**
- Use `run_id` to fetch details/logs:
  - `GET /api/automation/runs/:id`
  - `GET /api/automation/runs/:id/logs`

**Idempotency (deterministic IDs to avoid duplicate fan-out under retries)**
- Scheduler dispatch id: `automation-schedule-{schedule_id}-{dueAtMs}`
- Per-run fan-out ids:
  - fiche details: `automation-{runId}-fetch-{ficheId}` → `fiche/fetch`
  - transcription: `automation-{runId}-transcribe-{ficheId}` → `fiche/transcribe`
  - audits: `automation-{runId}-audit-{ficheId}-{configId}` → `audit/run`
- Run result events:
  - `automation/completed`: `automation-completed-{runId}`
  - `automation/failed`: `automation-failed-{runId}`

### 2.6.3 Scheduler logic (cron + timezone)

- [x] `scheduledAutomationCheck` runs on cron `AUTOMATION_SCHEDULER_CRON` (default every minute) with concurrency=1 (prevents overlapping ticks).
- [x] Schedules are considered “due” when:
  - a cron expression matches a time within `AUTOMATION_SCHEDULER_WINDOW_MINUTES` (default 20, min 5)
  - and `lastRunAt < dueAt` (prevents re-dispatch)
- [x] Prevent overlapping runs:
  - scheduler skips schedules with `lastRunStatus="running"` (one run at a time per schedule)
  - “stuck run” escape hatch: if `lastRunStatus="running"` for \(\ge\) 2h15m, scheduler allows retrigger and logs a warning
- [x] Cron derivation:
  - `DAILY|WEEKLY|MONTHLY`: `automation.service.generateCronExpression` (from `timeOfDay` + optional day fields)
  - `CRON`: uses stored `cronExpression`
- [x] Cron matching:
  - `automation.service.getMostRecentScheduledTimeWithinWindow` uses `automation.cron.ts` (`parseCronExpression` + `cronMatches`)
  - Timezone-aware matching uses `Intl.DateTimeFormat` (invalid timezone falls back to UTC)
  - Cron semantics: when both day-of-month and day-of-week are restricted (not `*`), matcher uses **OR** semantics (common cron behavior).
- [x] After dispatch, the scheduler calls `markAutomationScheduleTriggered` (sets `lastRunAt=dueAt`, `lastRunStatus="running"`).
  - note: scheduler includes `due_at` in the `automation/run` event payload; the run workflow uses it for correlation and schedule state.

### 2.6.4 `runAutomationFunction` (run workflow, step-by-step)

**Step 1: Load schedule**
- Validates schedule exists + `isActive=true`
- Validates `ficheSelection` via Zod (`validateFicheSelection`)
- Normalizes `specificAuditConfigs` (BigInt → number list)

**Step 2: Create run + logging**
- Creates `automation_runs` row (status=`running`)
- All workflow logs are appended to `automation_logs` (useful for post-mortems)

**Step 3: Select fiches**
- **Manual mode**: parse fiche IDs from `ficheIds[]` (splits on spaces/commas/newlines), apply `maxFiches`.
- **Date-range / filter mode**:
  - Builds a list of dates (DD/MM/YYYY) via `automationService.calculateDatesToQuery`
  - Revalidates each date (batch of 3 concurrent) via `automationApi.fetchFichesForDate(...)`
    - HTTP: `GET {FICHE_API_BASE_URL}/api/fiches/search/by-date?date=DD/MM/YYYY&criteria_type=1&include_recordings=true&force_new_session=false`
    - Auth: if the schedule defines `externalApiKey`, it is sent as `Authorization: Bearer <apiKey>`
    - Each fiche is cached as a sales summary via `cacheFicheSalesSummary(...)` (marked `_salesListOnly: true`)
    - Date failures are logged; automation continues and falls back to existing cache when present
  - Reads candidates from DB via `getFichesByDateRangeWithStatus(startDate,endDate)` (YYYY-MM-DD)
  - Applies DB-level filters (on the DB snapshot):
    - `groupes` (exact match on fiche `groupe`)
    - `onlyUnaudited=true` (keeps fiches with `audit.total === 0`)
  - Applies `maxFiches`
  - Note: `onlyWithRecordings` is applied after full fiche details are fetched.

**Step 4: No ficheIds**
- Marks run completed with 0 totals and emits `automation/completed`.

**Step 5: Prerequisites fan-out (distributed)**
- **Fiche details**:
  - Fans out `fiche/fetch` for each fiche (deterministic IDs)
  - Implementation detail: automation does **not** call `automationApi.fetchFicheDetails`; it relies on the `fiche/fetch` workflow which uses the fiche module’s gateway-by-id fetch (no `cle` prerequisite).
  - Polls DB for “full details” readiness (rawData `_salesListOnly === false`)
  - Classifies:
    - failures: missing fiche cache or still sales-list-only
    - `fichesWithRecordings` vs `fichesWithoutRecordings`
    - ignores fiches with too many recordings:
      - schedule override `ficheSelection.maxRecordingsPerFiche`
      - else env fallback `AUTOMATION_MAX_RECORDINGS_PER_FICHE`
    - if `onlyWithRecordings=true`, fiches with 0 recordings are ignored (`reason="No recordings"`)
- **Transcriptions** (if enabled):
  - Fans out `fiche/transcribe` with `wait_for_completion=false`
  - If `skipIfTranscribed=true`, only dispatches transcription events for fiches that are not fully transcribed
  - Waits/polls at the run level using a DB aggregate over `recordings` (not per-fiche queries)
  - If `retryFailed=true` + `maxRetries>0`, it can re-dispatch `fiche/transcribe` for incomplete fiches when progress stalls
  - Marks remaining fiches as failed after timeout/stall
- **Audits** (if enabled):
  - Resolves config IDs from:
    - schedule `specificAuditConfigs`
    - `getAutomaticAuditConfigs()` (`runAutomatically=true`)
  - Fans out `audit/run` for each `(fiche, config)` (deterministic IDs), with linkage:
    - `automation_schedule_id`, `automation_run_id`, `trigger_source="automation"`
    - if `ficheSelection.useRlm=true`, also sets `use_rlm=true` (transcript tools mode)
  - Polls DB for completed/failed counts since the run started, then attributes per-fiche failures/incomplete work
  - If `continueOnError=false`, the audit stage is skipped if earlier stages produced failures
  - If `retryFailed=true` + `maxRetries>0`, the audit wait loop will extend “stall” windows before giving up (does not create duplicate audits)

**Step 6: Finalize**
- Updates `automation_runs` (status=`completed|partial|failed`, counts, resultSummary)
- Updates `automation_schedules` stats (`lastRunStatus`, counters)

**Step 7: Notifications**
- If configured:
  - webhook: `automationApi.sendNotificationWebhook(schedule.webhookUrl, payload)`
    - URL is validated via `validateOutgoingWebhookUrl` (SSRF guard; honors `WEBHOOK_ALLOWED_ORIGINS`)
  - email: `automationApi.sendEmailNotification(schedule.notifyEmails, ...)`

**Run events**
- Emits `automation/completed` (or `automation/failed`) for downstream systems that prefer events over polling.

### 2.6.5 Persistence + correlation to audits

- `AutomationSchedule` / `AutomationRun` / `AutomationLog` are BigInt-keyed tables (serialize ids to string in JSON).
- Audits created by automation store:
  - `automation_schedule_id`
  - `automation_run_id`
  - `trigger_source="automation"`
- These fields are queryable via `GET /api/audits` filters (`automation_schedule_ids`, `automation_run_ids`, `trigger_source`).

**Example queries**
- All audits for a run: `GET /api/audits?automation_run_ids=<RUN_ID>&latest_only=false`
- Failures for a run: `GET /api/audits?automation_run_ids=<RUN_ID>&status=failed&latest_only=false`
- Group outcomes (status buckets): `GET /api/audits/grouped?group_by=status&automation_run_ids=<RUN_ID>`

### 2.6.6 Automation module (exports surface area)

**Primary entry**: `src/modules/automation/index.ts`

- [x] HTTP routes: `automationRouter` (`src/modules/automation/automation.routes.ts`)
- [x] Inngest workflows: `automationFunctions` (`src/modules/automation/automation.workflows.ts`)
  - [x] `runAutomationFunction` (`automation/run`)
  - [x] `scheduledAutomationCheck` (cron)
- [x] Service façade: `automationService` (`src/modules/automation/automation.service.ts`)
  - Cron derivation + timezone matching helpers
- [x] DB repository: `automationRepository` (`src/modules/automation/automation.repository.ts`)
  - schedules/runs/logs CRUD + `markAutomationScheduleTriggered` + `getAutomaticAuditConfigs`
- [x] External API + notifications: `automationApi` (`src/modules/automation/automation.api.ts`)
  - sales-list revalidation: `fetchFichesForDate(date, onlyWithRecordings, apiKey?)`
    - Calls `/api/fiches/search/by-date` and returns `response.data.fiches` (throws on error)
  - notifications:
    - `sendNotificationWebhook(webhookUrl, payload)` (best-effort; logs errors, does not throw)
    - `sendEmailNotification(...)` (best-effort SMTP; skipped if `SMTP_HOST` is not configured)
  - note: `fetchFicheDetails(...)` exists here but automation does not use it (automation relies on `fiche/fetch` workflow + fiche module client)
- [x] Zod schemas/types: `automation.schemas.ts`
- [x] Inngest event typing: `AutomationEvents` (`src/modules/automation/automation.events.ts`)
- [x] Cron matcher: `automation.cron.ts` (used by scheduler logic)

### 2.6.7 Known gaps / improvements (automation)

- [x] Schedule fields `continueOnError`, `retryFailed`, `maxRetries` are enforced by the workflow:
  - `continueOnError=false`: skip downstream stages (transcription/audits) if failures occurred upstream.
  - `retryFailed=true` + `maxRetries>0`:
    - extends stall waits for fiche detail fetch + audits
    - re-dispatches `fiche/transcribe` for incomplete fiches when transcription progress stalls
  - Limitation: does **not** “rerun failed audits” (it avoids creating duplicate audits by design).
- [x] `skipIfTranscribed=true` is honored:
  - automation pre-checks transcription completion and only dispatches `fiche/transcribe` for fiches that are not fully transcribed.
- [x] If `runAudits=true` but **no audit configs resolve** (e.g. `useAutomaticAudits=true` but no configs are marked `runAutomatically=true`, and `specificAuditConfigs=[]`), automation:
  - skips audit fan-out
  - marks fiches as failed with error `No audit configs resolved` so the misconfiguration is visible
- [x] Automation can toggle transcript tools mode (`use_rlm`) for audits:
  - set `ficheSelection.useRlm=true` (schedule or override) → automation dispatches `audit/run` with `use_rlm: true`.
- [x] Automation emits dedicated Pusher realtime events (best-effort):
  - **Channel**: `private-job-automation-run-<RUN_ID>` (derived from payload `job_id="automation-run-<RUN_ID>"`)
  - **Events**: `automation.run.started`, `automation.run.selection`, `automation.run.completed`, `automation.run.failed`
  - **Fallback observability**: `GET /api/automation/runs/:id/logs` + webhook/email + `automation/completed|automation/failed` domain events
- [x] Automation webhook notifications are SSRF-guarded:
  - `schedule.webhookUrl` is validated via `validateOutgoingWebhookUrl` (blocks private IPs unless allowlisted via `WEBHOOK_ALLOWED_ORIGINS`)
  - delivery is also validated again at send time (defense in depth)
- [x] Automation email notifications are supported (best-effort) via SMTP:
  - set `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`/`SMTP_PASS` (optional), `SMTP_FROM` (or it falls back to `SMTP_USER`)
  - `SMTP_SECURE=1` (or port 465) enables SMTPS
  - if SMTP is not configured, emails are skipped (logged)
- [x] `automationApi.fetchFichesForDate(..., onlyWithRecordings=true)` is **best-effort**:
  - if upstream returns an explicit recordings signal (e.g. `recordings`, `recordings_count`, `has_recordings`), it filters at the API layer
  - if not, it does **not** drop fiches here; the workflow still enforces `onlyWithRecordings` after full fiche details are fetched
- [x] Automation date revalidation caching no longer requires `cle` (sales summaries are cached even when `cle` is missing).

### 2.7 Realtime module (exports surface area)

**Primary entry**: `src/modules/realtime/index.ts`

- [x] HTTP routes: `realtimeRouter` (`src/modules/realtime/realtime.routes.ts`)
  - [x] `POST /api/realtime/pusher/auth` (private/presence channel auth)
  - [x] `POST /api/realtime/pusher/test` (publish a test event; supports dry-run)
- [x] Zod schemas: `src/modules/realtime/realtime.schemas.ts`
- [x] Uses shared Pusher helpers: `src/shared/pusher.ts` (allowlist, name validation, publish)

### 2.8 Chat module (exports surface area)

**Primary entry**: `src/modules/chat/index.ts` (mounted under `/api`)

- [x] HTTP routes: `chatRouter` (`src/modules/chat/chat.routes.ts`)
  - [x] Audit chat: `GET /api/audits/:audit_id/chat/history`, `POST /api/audits/:audit_id/chat`
  - [x] Fiche chat: `GET /api/fiches/:fiche_id/chat/history`, `POST /api/fiches/:fiche_id/chat`
- [x] Service layer: `chat.service.ts` (context building + SSE streaming + citation extraction)
- [x] Repository layer: `chat.repository.ts` (`chat_conversations` + `chat_messages`)
- [ ] (gap) No user/org access control today (see 0.5 + 1.0.1).

---

## 3) Orchestrator: `audit/run` → prerequisites → fan-out

**Primary file**: `src/modules/audits/audits.workflows.ts` (`runAuditFunction`)

- [x] Concurrency: global limit + per-fiche guard (default 1)
- [x] Ensures fiche is cached **and full** (treats `_salesListOnly` cache as “needs fetch”; invokes `fetchFicheFunction` if needed)
- [x] Ensures transcriptions (invokes `transcribeFicheFunction` if needed)
- [x] Loads audit config, creates audit DB row (status=running)
- [x] Builds timeline from DB transcriptions
- [x] Caches context in Redis (best-effort)
- [x] Fans out `audit/step.analyze` with deterministic ids (idempotent per step)

### 3.1 Failure mode hardening

- [x] (fixed) `onFailure` now sends `audit.failed` with the correct tracking `audit_id` when available.

**Potential issues**
- [x] `onFailure` first tries to match the running audit by `resultData.audit_id === event.id` (tracking id), then falls back to “latest running audit for fiche+config”.
- [x] (fixed) Fiche detail fetch no longer depends on cached `cle`.
  - `fichesApi.fetchFicheDetails` uses the gateway “by-id” endpoint (fiche_id only); the gateway handles `cle` refresh internally.
  - `fetchFicheFunction` / fiche cache refresh can fetch & cache details even if the fiche was never pre-cached via sales-list/date-range.

### 3.2 Large timelines (Inngest step payload limit)

**Risk**
- Inngest step outputs have a size limit (~4MB). Large timelines must not be returned as step outputs.

**Potential issues**
- [x] Timeline generation no longer returns `{ timeline, timelineText }` as a step output.
  - Timeline + timelineText are cached to Redis (when available); the step output is small metadata only.

### 3.3 Idempotency & dedupe map (why retries don’t double-spend)

**HTTP → Inngest event IDs**
- `POST /api/audits/run` and `POST /api/audits` use event id: `audit-{fiche_id}-{audit_config_id}-{Date.now()}`
  - This is **unique**, not deterministic (allows multiple runs for same fiche/config).
  - This id is also used as the **tracking `audit_id`** for realtime/webhooks (and returned by the HTTP route).
- `POST /api/audits/batch` uses event id: `batch-audit-{batchId}` where `batchId = batch-{Date.now()}`

**Audit step fan-out IDs (deterministic)**
- Step events use: `id: audit-step-{audit_db_id}-{step_position}`
  - Prevents duplicate step dispatch if `audit/run` retries after fan-out
- Worker has a second guard: “skip if step result already exists” (DB idempotency)

**Batch fan-out IDs (deterministic within a batch)**
- Each audit in a batch uses: `id: batch-{batchId}-audit-{fiche_id}-{audit_config_id}`
  - Prevents duplicate audit dispatch if `audit/batch` retries after fan-out

**DB uniqueness constraints (hard stop)**
- `audit_step_results` has unique `(audit_id, step_position)`; upserts are safe under retries/concurrency.

---

## 4) Step worker: `audit/step.analyze` (distributed)

**Primary file**: `src/modules/audits/audits.workflows.ts` (`auditStepAnalyzeFunction`)

- [x] Idempotency: skips if step result already exists
- [x] Loads context from Redis; falls back to DB rebuild
- [x] Calls analyzer in `step.run` (prevents double OpenAI spend on retries)
- [x] Writes `audit_step_results` (upsert) + emits `audit/step.analyzed`
- [x] (fixed) Sanitizes null bytes before DB writes (prevents Postgres text failures)

**Potential issues**
- [x] Realtime correlation: step events can include `audit_db_id` when available (distributed pipeline passes it into analyzer webhooks).
  - Caveat: legacy `analyzeAllSteps` path may still emit step events without `audit_db_id`.

---

## 5) Analyzer: prompt vs tools (RLM-style transcript tools)

**Primary files**
- `src/modules/audits/audits.analyzer.ts`
- `src/modules/audits/audits.prompts.ts`
- `src/modules/audits/audits.transcript-tools.ts`

- [x] Prompt mode embeds timelineText in prompt
- [x] Tools mode uses `searchTranscript` + `getTranscriptChunks` and requires at least one tool call
- [x] Output is schema constrained (`AuditStepSchema`)

### 5.1 Tools mode details (how we force evidence lookup)

- Tools mode is selected when `transcriptMode === "tools"` **and** a structured `timeline[]` is provided.
  - If tools mode is requested but timeline is missing/empty → analyzer logs a warning and falls back to prompt mode.
- Default tool-loop limits (override via `AuditOptions`):
  - `maxToolSteps` (default 8, minimum 2)
  - `maxSearchResults` (default 25)
  - `maxChunkFetch` (default 20)
  - `maxChunkChars` (default 20_000)
- The tools-mode call uses a controlled loop:
  - First step forces `toolChoice: "required"` (ensures at least one tool call)
  - Last step forces `toolChoice: "none"` (ensures final output is plain JSON)
  - Middle steps allow `toolChoice: "auto"`
- Generation settings are conservative (`temperature: 0`) and still schema-constrained.

### 5.2 Product verification context (optional)

- For steps with `verifyProductInfo === true`:
  - If fiche→product DB match is available, analyzer uses DB guarantees.
  - Vector store fallback requires `PRODUCT_VECTORSTORE_FALLBACK=1` (opt-in).

**Potential issues**
- [x] `use_rlm` defaults to `false` (prompt mode) when omitted (docs/types aligned).

---

## 6) Evidence gating (deterministic)

**Primary file**: `src/modules/audits/audits.evidence.ts`

- [x] Validates citations by checking quoted text exists in referenced chunk text
- [x] Removes invalid citations
- [x] Downgrades PRESENT/PARTIEL to ABSENT when no valid citations remain
- [x] Can reduce step score / conforme (never increases)

### 6.1 Gating rules (exact behavior)

- **Normalization**: both quote and transcript chunk text are normalized (lowercase, accents removed, non-alnum collapsed).
- **Citation validity**:
  - Requires `recording_index` + `chunk_index`
  - Requires non-empty `texte` with normalized length ≥ 12
  - Valid if normalized chunk text `includes(normalized quoted text)`
- **Control point enforcement**:
  - If `statut` is `ABSENT` or `NON_APPLICABLE` → citations are cleared
  - If `statut` is `PRESENT` or `PARTIEL` but ends with 0 valid citations → downgraded to `ABSENT` and `[Auto-check]` note appended to `commentaire`
  - `minutages` are recomputed from remaining citations
- **Step score gating (never increases)**:
  - Excludes `NON_APPLICABLE` points from the denominator
  - Derives ratio where `PRESENT=1`, `PARTIEL=0.5`, else `0`
  - Sets `derivedScore = round(ratio * weight)` capped to `[0..weight]`
  - If `derivedScore < originalScore` → reduce `step.score` and append `[Auto-check]` note to `commentaire_global`
- **Step conforme/niveau gating (downward-only)**:
  - `ratio >= 0.85` → `CONFORME`, `ratio >= 0.4` → `PARTIEL`, else `NON_CONFORME`
  - Only applies if this is **stricter** than the original (e.g. `CONFORME → PARTIEL/NON_CONFORME`)
  - Recomputes `niveau_conformite`:
    - `CONFORME` → `EXCELLENT` if ratio ≥ 0.95 else `BON`
    - `PARTIEL` → `ACCEPTABLE`
    - `NON_CONFORME` → `INSUFFISANT`

**Potential issues**
- [x] (mitigated) Very short quotes are rejected by default (12 chars normalized), which can aggressively remove citations.
  - Tune via `AUDIT_EVIDENCE_MIN_QUOTE_CHARS` if your transcripts/quotes are short.

---

## 7) Finalizer: `audit/step.analyzed` → finalize audit

**Primary file**: `src/modules/audits/audits.workflows.ts` (`finalizeAuditFromStepsFunction`)

- [x] Waits until all step rows exist
- [x] Sends `audit.progress` updates
- [x] Enriches citations with recording metadata
- [x] Runs evidence gating
- [x] Computes compliance + persists audit + emits completion events
- [x] Cleans Redis context

**Potential issues**
- [x] Mapping clarified: Inngest `audit/completed` still has legacy `audit_id = audit_db_id`, but it also includes both:
  - `audit_db_id`
  - `audit_tracking_id`

---

## 8) Realtime / Pusher publishing (webhooks)

**Primary files**
- `src/shared/webhook.ts` (event names + payload)
- `src/shared/pusher.ts` (channels, payload truncation, auth allowlist)

- Note: `sendWebhook(...)` is a legacy name — it currently publishes **Pusher realtime events**, not outbound HTTP webhooks.

- [x] Channels are derived from payload (`audit_id`, `fiche_id`, `job_id`) plus `global` fallback.
- [x] Channels are also derived from `audit_db_id` when present (so events can route to DB-id audit channel too).
- [x] Payloads are truncated when exceeding `PUSHER_MAX_PAYLOAD_BYTES` (default ~9KB).
- [x] `PUSHER_DRY_RUN=1` logs publish attempts without sending (good for debugging).

### 8.0 Channel naming conventions (what to subscribe to)

Channel naming is defined in `src/shared/pusher.ts`:

- **Global**: `private-global` (or `global` if public channels)
- **Fiche**: `private-fiche-{fiche_id}`
- **Audit (tracking)**: `private-audit-{audit_id}`
- **Audit (DB id)**: `private-audit-{audit_db_id}`
- **Job**: `private-job-{job_id}`

Notes:
- The channel builder prefixes `audit-` / `fiche-` / `job-` automatically; if `audit_id` already starts with `audit-...`, the final channel will look like `private-audit-audit-...` (ugly but functional).
- Recommendation for frontend: always subscribe to **`fiche-{fiche_id}`**; it receives audit events because payloads include `fiche_id`.
- For batch audits: subscribe to **`job-{batch_id}`** to receive `batch.*` events without relying on `global`.

### 8.1 Audit webhook events: what is actually emitted today

- [x] Emitted by current pipeline:
  - `audit.started`
  - `audit.fiche_fetch_started`
  - `audit.fiche_fetch_completed`
  - `audit.transcription_check`
  - `audit.config_loaded`
  - `audit.timeline_generated`
  - `audit.analysis_started`
  - `audit.progress`
  - `audit.step_started`
  - `audit.step_completed`
  - `audit.step_failed`
  - `audit.compliance_calculated`
  - `audit.completed`
  - `audit.failed`

### 8.1.1 Payload contract (minimum fields to expect)

All audit events are **plain objects** (no wrapper), and should be treated as append-only (new fields may appear).

Common fields:
- `fiche_id` (string) — used for fiche channel routing
- `audit_id` (string) — tracking id (used for audit channel routing)
- `audit_db_id` (string, optional) — DB id (used for audit channel routing when present)
- `event_id` (string, optional) — Inngest event id for the workflow event that emitted this realtime message
- `approach` (object, optional): `{ use_rlm: boolean; transcript_mode: "prompt" | "tools" }`

Event-specific highlights:
- `audit.started`: `audit_config_id`, `audit_config_name`, `total_steps`
- `audit.progress`: `completed_steps`, `total_steps`, `failed_steps`, `current_phase`, `progress_percentage`
- `audit.step_*`: `step_position`, `step_name` (+ step metrics on completed)
- `audit.completed`: score fields + tokens + duration

Rerun-specific fields (when a payload is for a rerun, not a normal audit run):
- `rerun_id` (string)
- `rerun_scope` (optional string: `"control_point"`)
- `control_point_index` (number, 1-based) — for control point reruns
- `status` may be `"rerunning"` or `"rerun_completed"` instead of `"processing"/"completed"`

### 8.1.2 Batch webhook events

- [x] Emitted by batch audit pipeline:
  - `batch.progress`
  - `batch.completed`

**Payload contract**
- `batch_id` (string)
- `operation_type` (string: `"audit"` | `"transcription"`)
- `total` (number)
- `completed` (number)
- `failed` (number)
- `progress_percentage` (number, 0–100) — `batch.progress` only
- `duration_ms` (number) — `batch.completed` only

**Correlation**
- `batch_id` matches the `batch_id` returned by `POST /api/audits/batch`.

**Channel routing**
- Batch events are treated as **global** events (`event.startsWith("batch.")`) and will always publish to the `global` channel.
- Additionally, because payload contains `batch_id`, they are also published to the job channel: `job-{batch_id}` (recommended for UI subscription).

### 8.1.3 Payload truncation (when Pusher max bytes is exceeded)

If a payload exceeds `PUSHER_MAX_PAYLOAD_BYTES`, the backend will publish a **truncated** payload:
- `truncated: true`
- Only a small set of correlation keys is preserved (so the UI can still route + fetch full data via REST).

Keys preserved in truncated payloads (best-effort, depends on payload shape):
- `audit_id`, `audit_db_id`, `audit_config_id`, `fiche_id`, `event_id`
- `batch_id`, `job_id` / `jobId`
- `rerun_id`, `rerun_scope`, `step_position`, `step_name`, `control_point_index`
- Common progress keys: `completed_steps`, `total_steps`, `failed_steps`, `current_phase`, `progress_percentage`

Recommended UI behavior:
- If `truncated: true`, treat the realtime message as a **pointer** and fetch full details via REST.

### 8.2 Debug playbook (realtime)

- **If you see no events**
  - Check env: `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
  - Enable `PUSHER_DRY_RUN=1` and watch backend logs
- **If events are “missing details”**
  - Pusher payload may be truncated; fetch full results via `GET /api/audits/:audit_db_id`
- **If you don’t know the audit channel**
  - Subscribe to `fiche-{fiche_id}` channel; audit payloads include `fiche_id` and will be published there too.

### 8.3 Pusher auth endpoint (private channels)

To debug auth/subscription issues:

- [x] Verify `POST /api/realtime/pusher/auth` works for:
  - `private-audit-*`
  - `private-fiche-*`
  - `private-job-*`
  - `private-global`
- [x] Verify invalid channel names are rejected (sanitization rules in `src/shared/pusher.ts`)
- [ ] (gap) This endpoint does not validate user/org access (only naming allowlists).
  - Mitigation: enable API token auth via `API_AUTH_TOKEN(S)` to prevent anonymous access.
  - Current allowlist behavior: only certain prefixes are authorized (`private-audit-*`, `private-fiche-*`, `private-job-*`, `private-global`, plus a few future/test prefixes in `isAllowedAuthChannel`).
  - Presence channels: `user_id` is required but **not** validated against any real user store (no membership model yet).
  - Recommended: add real auth + membership checks per channel entity.

---

## 9) Persistence (Prisma/Postgres)

**Primary**
- `prisma/schema.prisma` (`audits`, `audit_step_results`)
- `prisma/migrations/20251213180500_add_audit_step_result_raw_result/migration.sql`

- [x] `audit_step_results.raw_result` exists and is unique per `(audit_id, step_position)`
- [x] Repository sanitizes null bytes before writing large result payloads

### 9.1 `audits` table (what fields matter operationally)

Core identifiers:
- `audits.id` (BigInt) = **audit_db_id** (REST path param)
- `audits.result_data` (JSON) stores “running” metadata at creation and the final audit payload on completion

Status lifecycle (today):
- `pending` (Prisma default; typically not used in new pipeline)
- `running` (set by `createPendingAudit`)
- `completed` (set by `updateAuditWithResults`)
- `failed` (set by `markAuditAsFailed`)

Observability/search fields:
- `trigger_source`, `trigger_user_id`
- `automation_schedule_id`, `automation_run_id`
- `notes`, `deleted_at` (soft delete)
- `is_latest`, `version` (versioning metadata)

### 9.2 `audit_step_results` table (why the system is cross-replica safe)

- Unique constraint: `(audit_id, step_position)` ensures **one row per step per audit**
- `raw_result` JSON is written by distributed workers and then overwritten with the final (enriched + gated) step at audit finalization.
- “Summary” columns (`conforme`, `score`, `commentaire_global`, etc.) are duplicated for:
  - fast list/detail queries
  - grouping/statistics

### 9.3 Human review writes (audit trail)

- Step review updates:
  - step summary fields (`conforme`, `score`, etc.)
  - `raw_result.human_review[]` (append-only trail)
- Control point review updates:
  - `raw_result.points_controle[i].statut` and/or `.commentaire`
  - `raw_result.human_review[]` (append-only trail)

### 9.4 BigInt + JSON safety rules

- Never return raw `bigint` in JSON responses; serialize as string (many endpoints use `jsonResponse` helper).
- Sanitize `\u0000` null bytes before writing to Postgres `TEXT` columns (already applied for audit + step writes).

---

## 10) Day-2 debugging checklist (common incidents)

### 10.0 Always capture these first

- [ ] `fiche_id`
- [ ] `audit_db_id` (REST id)
- [ ] `audit_id` tracking (if available from realtime)
- [ ] `audit_config_id`
- [ ] Response header `X-Backend-Instance` (which replica served the request)

### 10.1 “Audit stuck in running”

- [ ] Check `audits.status` and `audit_step_results` row count for that audit
- [ ] Confirm Inngest ran the finalizer (`Finalize Audit from Step Results`)
- [ ] If Redis is down, verify fallback rebuild works (it should, but is slower)

**Quick DB queries (Postgres)**

Find running audits older than 30 minutes:

```sql
select id, "fiche_cache_id", "audit_config_id", status, "started_at"
from audits
where status = 'running'
  and "started_at" < now() - interval '30 minutes'
order by "started_at" asc;
```

Count how many steps have been written for an audit:

```sql
select a.id as audit_id,
       count(s.id) as step_rows,
       max(s."step_position") as max_step_pos
from audits a
left join audit_step_results s on s.audit_id = a.id
where a.id = <AUDIT_DB_ID>
group by a.id;
```

### 10.2 “Audit completed but UI shows no progress”

- [ ] Confirm Pusher is configured and private channel auth is working (`/api/realtime/pusher/auth`)
- [ ] Confirm frontend is subscribed to `fiche-*` channel (recommended) or otherwise knows the tracking `audit_id`

### 10.3 “Step results exist but citations are empty”

- [ ] Evidence gating likely removed invalid citations (check `audit_step_results.raw_result` commentary fields)
- [ ] Verify citation indices are 0-based and quote text matches chunk text exactly

### 10.4 “Batch audit started but never completes”

- [ ] Confirm Redis is configured (`REDIS_URL`) — without Redis, batch completion tracking is best-effort and may be unavailable
- [ ] Confirm frontend is subscribed to `global` channel (batch events publish there)
- [ ] Inngest checks:
  - `Batch Process Audits` ran and returned `batch_id`
  - `Batch Audit Progress (Completed)` is receiving `audit/completed`
  - `Batch Audit Progress (Failed)` is receiving `audit/failed`
- [ ] Redis keys to inspect (if you have access):
  - `audit:batch:{batch_id}:meta`
  - `audit:batch:{batch_id}:pending` (should shrink to empty)
  - `audit:batch:{batch_id}:finalized` (set once)

### 10.5 “Automation schedule didn’t trigger”

- [ ] Confirm `scheduled-automation-check` ran (Inngest function: `Check Scheduled Automations`)
- [ ] Check env:
  - `AUTOMATION_SCHEDULER_CRON`
  - `AUTOMATION_SCHEDULER_WINDOW_MINUTES`
- [ ] Confirm schedule is active and schedulable:
  - `isActive=true`
  - `scheduleType != MANUAL`
  - required fields exist (e.g. `timeOfDay` for DAILY/WEEKLY/MONTHLY)
- [ ] Confirm schedule timezone is valid (invalid timezone falls back to UTC; can cause “unexpected dueAt”)
- [ ] Confirm `lastRunAt < dueAt` (scheduler won’t re-dispatch if it thinks it already ran)
- [ ] Confirm schedule is not currently considered running:
  - if `lastRunStatus="running"`, scheduler will skip it (to avoid overlaps)
  - “stuck run” escape hatch: after ~2h15m in `"running"`, scheduler allows retrigger and logs a warning

**Quick DB queries (Postgres)**

Recent schedules:

```sql
select id, name, is_active, schedule_type, cron_expression, timezone,
       time_of_day, day_of_week, day_of_month,
       last_run_at, last_run_status, updated_at
from automation_schedules
order by updated_at desc
limit 20;
```

### 10.6 “Automation run stuck / partial / failed”

- [ ] Fetch run + logs:
  - `GET /api/automation/runs/:id`
  - `GET /api/automation/runs/:id/logs`
- [ ] Realtime (if Pusher is enabled):
  - subscribe to `private-job-automation-run-<RUN_ID>`
  - watch `automation.run.started|selection|completed|failed`
- [ ] Identify which stage stalled from logs:
  - fiche details wait: `"Fiche details progress"`
  - transcription wait: `"Transcription progress"`
  - audit wait: `"Audit progress"`
- [ ] If fiche details are stalling:
  - check `AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS` + `AUTOMATION_FICHE_DETAILS_POLL_INTERVAL_SECONDS`
  - confirm `ficheCache.rawData._salesListOnly` eventually becomes `false` (means full details cached)
- [ ] If transcriptions are stalling:
  - check `AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS` + `AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS`
  - confirm recording rows exist and `hasTranscription=true` advances
- [ ] If audits are stalling:
  - check `AUTOMATION_AUDIT_MAX_WAIT_MS` + `AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS`
  - confirm audits are created after the automation run start (the poll query uses `createdAt >= startedAt`)
- [ ] If “0 audits ran”:
  - confirm schedule has `specificAuditConfigs` OR there are configs with `runAutomatically=true`

**Quick DB queries (Postgres)**

Find long-running automation runs:

```sql
select id, schedule_id, status, started_at, total_fiches, successful_fiches, failed_fiches
from automation_runs
where status = 'running'
  and started_at < now() - interval '30 minutes'
order by started_at asc;
```

Recent logs for a run:

```sql
select level, timestamp, message
from automation_logs
where run_id = <RUN_ID>
order by timestamp desc
limit 50;
```

---

## 11) Audit module inventory (exports checklist)

Goal: don’t miss hidden surface area. This is a **file-by-file inventory** of exports to verify.

### 11.1 `audits.workflows.ts` (Inngest workflows)

- [x] `runAuditFunction` (`audit/run`)
- [x] `auditStepAnalyzeFunction` (`audit/step.analyze`)
- [x] `finalizeAuditFromStepsFunction` (`audit/step.analyzed`)
- [x] `batchAuditFunction` (`audit/batch`)
- [x] `batchAuditProgressOnCompletedFunction` (`audit/completed`)
- [x] `batchAuditProgressOnFailedFunction` (`audit/failed`)

### 11.2 `audits.events.ts` (typed Inngest event payloads)

- [x] `AuditsEvents` includes:
  - [x] `audit/run` (includes optional `use_rlm`, automation linkage)
  - [x] `audit/step.analyze` (fan-out worker; includes `audit_db_id` + tracking `audit_id`)
  - [x] `audit/step.analyzed` (finalizer trigger; includes `ok` + optional `error`)
  - [x] `audit/completed` (used by batch aggregator; **field name `audit_id` is DB id**)
  - [x] `audit/failed` (used by batch aggregator)
  - [x] `audit/batch` + `audit/batch.completed`
  - [x] `audit/step-rerun` + `audit/step-rerun-completed`
  - [x] `audit/step-control-point-rerun` + `audit/step-control-point-rerun-completed`

**Potential issues**
- [x] `audit/run` typing/docs align: missing `use_rlm` is treated as `false` (prompt mode).

### 11.3 `audits.repository.ts` (DB operations)

- [x] `createPendingAudit` (creates `audits` row, stores tracking `audit_id` in `resultData` while running)
- [x] `updateAuditWithResults` (finalizes audit, writes step summaries, overwrites `resultData` with final payload)
- [x] `markAuditAsFailed`
- [x] `updateAuditMetadata`
- [x] `saveAuditResult` (legacy runner path; only used by `audits.runner.ts`, not by `audit/run` distributed pipeline)
- [x] `getAuditsByFiche`
- [x] `getAuditById`
- [x] `listAudits`
- [x] `groupAudits`, `getAuditsGroupedByFichesRaw`
- [x] Human review:
  - `applyHumanReviewToAuditStepResult`
  - `applyHumanReviewToAuditControlPoint`
  - `updateAuditComplianceSummary`

**Potential issues**
- [x] Final audit `resultData` now preserves both:
  - `audit_db_id`
  - `audit_tracking_id`

### 11.4 `audits.service.ts` (business logic façade)

- [x] Delegates CRUD/queries to repository (`getAuditById`, `listAudits`, `groupAudits`, ...)
- [x] Review flows recompute audit compliance after human edits
- [x] Derived stats functions:
  - `getGlobalAuditStatistics` uses Prisma DB aggregation (counts + averages) over:
    - `isLatest=true`, `deletedAt=null`
    - optional `dateFrom/dateTo` + `auditConfigIds` filters
    - averages computed over `status="completed"` audits only
  - `calculateComplianceRate` counts only `status === "completed"` audits (helper)

**Potential issues**
- [x] `getGlobalAuditStatistics` now uses DB aggregation (no `limit: 10000` sampling).

### 11.5 `audits.schemas.ts` (Zod / API typing)

- [x] Request validators used by HTTP routes:
  - `parseListAuditsQuery` (list + grouped list endpoints)
  - `validateReviewAuditStepResultInput`
  - `validateReviewAuditControlPointInput`
  - `validateUpdateAuditInput`
- [x] `validateRunAuditInput` / `validateBatchAuditInput` are used by `audits.routes.ts` (run/batch parsing is centralized).
- [x] `runAuditResponseSchema` / `batchAuditResponseSchema` match current HTTP responses.

### 11.6 `audits.analyzer.ts` (LLM analysis engine)

- [x] `analyzeStep` (single step; emits `audit.step_*` realtime events)
- [x] `analyzeAllSteps` (legacy monolithic runner; only used by `audits.runner.ts`, not used by distributed pipeline)

### 11.7 Prompt/text building (`audits.prompts.ts`, `audits.timeline.ts`)

- [x] `buildTimelineText`, `buildStepPrompt`, transcript-tools prompts
- [x] `generateTimeline` (legacy timeline generator; main pipeline uses DB rebuild + `buildTimelineText`)

### 11.8 Transcript tools (`audits.transcript-tools.ts`)

- [x] `createTranscriptTools` provides `searchTranscript` + `getTranscriptChunks` for tools-mode audits

### 11.9 Evidence gating (`audits.evidence.ts`)

- [x] `validateAndGateAuditStepResults` (deterministically validates/strips citations and can downgrade compliance)

### 11.10 Product verification (`audits.vector-store.ts`)

- [x] Vector store search + prompt context formatting for product verification checkpoints (optional, per-step)

### 11.11 Reruns (`audits.rerun.*`)

- [x] `audits.rerun.workflows.ts`: `rerunAuditStepFunction`, `rerunAuditStepControlPointFunction`
- [x] `audits.rerun.ts`: `rerunAuditStep` + persistence helpers
- [x] `audits.control-point.rerun.ts`: `rerunAuditStepControlPoint`

**Potential issues**
- [x] Rerun flows emit multiple “step” realtime events:
  - Analyzer emits `audit.step_*` under a distinct `audit_id` prefix (`rerun-{audit_db_id}-...`)
  - Explicit rerun events include `rerun_id` / `rerun_scope`
  - Consumers should treat `rerun_id`/`rerun_scope` as the authoritative rerun signal.

### 11.12 Legacy/unused paths (confirm intent)

- [x] `audits.runner.ts` (legacy synchronous orchestrator) is not invoked by `audit/run` (distributed pipeline is source of truth)
  - `runAudit(...)` currently has no call sites (it is exported for legacy/backwards compatibility only).
- [x] `audits.double-check.ts` exists but is not wired into `audit/run`
  - `doubleCheckStep(...)` currently has no call sites.

---

## 12) Notes / findings (append-only)

- 2026-01-20: `runAuditFunction.onFailure` now uses stored tracking `audit_id` when emitting `audit.failed` (and includes `audit_db_id` when it can be resolved).
- 2026-01-20: Step worker now sanitizes null bytes before writing step results to Postgres.
- 2026-01-20: Audit phase events were added (`audit.*_loaded|*_generated|analysis_started`) and audit events now include `audit_db_id` when known.
- 2026-01-20: Pusher channel derivation now includes `audit_db_id` when present (publishes to DB-id audit channel too).
- 2026-01-20: Step-level realtime events (`audit.step_*`) now include `audit_db_id` when emitted from the distributed pipeline.
- 2026-01-20: `runAuditFunction` now treats fiche cache marked `_salesListOnly: true` as “incomplete” and triggers a fiche fetch before auditing.
- 2026-01-20: Batch progress percentage (`batch.progress`) is now clamped and safe when `total = 0`.
- 2026-01-20: Batch audits now propagate `batch_id` from HTTP → `audit/batch` → realtime payloads (so progress events can be correlated to the request).
- 2026-01-20: Rerun endpoints validate `audit_id` early (400 on invalid) and step rerun IDs are unique per run (`rerun_id` includes `event.id`).
- 2026-01-20: Final audit `resultData` now preserves `audit_db_id` + `audit_tracking_id` for correlation even after completion.
- 2026-01-20: `runAuditFunction` skips transcription when `total_recordings = 0`.
- 2026-01-20: Inngest `audit/completed` and `audit/failed` events now include `audit_db_id` / `audit_tracking_id` when available (reduces ID confusion).
- 2026-01-20: Audit realtime payloads now include `event_id` (Inngest event id) for easier cross-linking to Inngest runs.
- 2026-01-20: Pusher payload truncation now preserves key audit/step/rerun identifiers (`step_position`, `rerun_id`, etc.) when forced to shrink.
- 2026-01-20: Batch realtime events now also publish to `job-{batch_id}` channel (in addition to `global`) for cleaner subscriptions.
- 2026-01-20: `POST /api/audits/run` and `POST /api/audits` now return the tracking `audit_id`; `runAuditFunction` uses the Inngest event id as the tracking id for consistency.
- 2026-01-20: `validateRunAuditInput` / `validateBatchAuditInput` are now actively used by HTTP routes; response schemas align to current responses.
- 2026-01-20: `runAuditFunction.onFailure` now prefers matching the running audit by `resultData.audit_id` (tracking id) before falling back to “latest running audit”.
- 2026-01-20: `getGlobalAuditStatistics` now uses Prisma DB aggregation (removes the `limit: 10000` approximation risk).
- 2026-01-20: Timeline generation no longer returns large `{ timeline, timelineText }` step outputs (reduces risk of hitting Inngest ~4MB step output limit); it caches to Redis and returns small metadata.
- 2026-01-21: Evidence gating quote-length threshold is now configurable via `AUDIT_EVIDENCE_MIN_QUOTE_CHARS` (default remains 12).
- 2026-01-21: Added optional API token auth (`API_AUTH_TOKEN(S)`) for `/api/*` endpoints (except `/api/inngest`).
- 2026-01-21: Chat SSE streaming now emits structured error payloads (`type: "error"`, `code: "STREAM_ERROR"`) and still terminates with `[DONE]`.
- 2026-01-21: Fiche detail fetch no longer depends on cached `cle` (gateway “by-id” endpoint uses fiche_id only and refreshes `cle` internally).
- 2026-01-21: Fiche upstream failures are now mapped to correct HTTP status codes (`404` for not found, `502` for upstream errors) via `FicheApiError` extending `AppError`.
- 2026-01-21: Automation flow was documented end-to-end (section 2.6) and the day-2 debugging playbook now includes automation incidents.
- 2026-01-21: `runAutomationFunction` now enforces `groupes` + `onlyUnaudited` selection filters and applies `onlyWithRecordings` after fetching full fiche details.
- 2026-01-21: Automation now emits `automation/completed` and `automation/failed` domain events (in addition to DB logs + optional webhook/email notifications).
- 2026-01-21: Chat history now returns the most recent ~50 messages (chronological) instead of the oldest messages (better context + UX).
- 2026-01-21: Automation hardening: `skipIfTranscribed` is honored, `continueOnError` gates downstream stages, `retryFailed/maxRetries` extends stall waits + can re-dispatch transcriptions, automation webhook URLs are SSRF-guarded, date revalidation caching no longer requires `cle`, “no audit configs resolved” misconfiguration surfaces as per-fiche failures, and `ficheSelection.useRlm=true` now propagates `use_rlm=true` into `audit/run`.
- 2026-01-21: Scheduler hardening: prevents overlapping runs per schedule via `lastRunStatus="running"` gating (with a “stuck run” escape hatch after ~2h15m) and includes `due_at` in `automation/run` events for correlation.
- 2026-01-21: Automation now emits dedicated Pusher realtime events on `private-job-automation-run-<RUN_ID>` (`automation.run.started|selection|completed|failed`) for frontend observability.
- 2026-01-21: Automation email notifications now support SMTP (optional) via `SMTP_*` env vars; if unset, emails are skipped (logged).
- 2026-01-21: Batch audits now require Redis (`POST /api/audits/batch` returns 503 if `REDIS_URL` is not configured) to avoid silent “no progress tracking” behavior.
- 2026-01-21: `automationApi.fetchFichesForDate(..., onlyWithRecordings=true)` now best-effort filters when upstream returns recordings metadata; full enforcement still happens after full fiche details fetch.

