## Active Context

### Current focus
- Make heavy workflows **scale across replicas** and remain correct under retries.
- Ensure frontend receives reliable progress via **SSE + webhooks**.

### Recent changes (high impact)
- **Authentication + scoped RBAC (JWT)**:
  - JWT claims now include `crm_user_id`, `groupes`, and `permissions` as **grants** (read/write + scope).
  - Role permissions are now **dynamic** via `role_permissions.can_read/can_write/scope` with scopes: `SELF | GROUP | ALL`.
  - Fiche/audit list endpoints enforce visibility scope:
    - Fiches: `/api/fiches/status/by-date` and `/api/fiches/status/by-date-range` filter by group/self scope.
    - Audits: `GET /api/audits` filters by group/self scope.
  - Chat + realtime authorization also enforce scope:
    - Chat endpoints require `chat.*` plus underlying `audits.read` / `fiches.read` and check scope before building context.
    - Pusher auth (`/api/realtime/pusher/auth`) performs per-audit/per-fiche scope checks in non-test envs (uses `audits.resultData.audit_id` lookup for tracking IDs).
  - Fiche-linked sensitive data is permission+scope protected:
    - `GET /api/recordings/:fiche_id` requires `recordings.read` and enforces scope by fiche.
    - Transcription routes require `transcriptions.read|write` and enforce scope by fiche.
  - Remaining app routers now enforce their base read/write permissions:
    - `audit-configs.read|write`, `automation.read|write`, `products.read|write`.
  - Admin role APIs support `permission_grants` (and still accept legacy `permission_keys`).
- **Audit step-level fan-out**:
  - `audit/run` orchestrates prerequisites then dispatches `audit/step.analyze` events.
  - Each step worker stores results in DB; a finalizer completes the audit once all steps exist.
- **Reruns now update stored audits**:
  - Step rerun persists the new step output into `audit_step_results` and recomputes audit compliance summary (`audits.*` score/niveau/critical).
  - Control point rerun updates normalized tables, recomputes step score/conforme deterministically, and recomputes audit compliance summary.
  - Audit trails are normalized into `audit_step_result_human_reviews` and `audit_step_result_rerun_events` (raw JSON trails removed from `audit_step_results.raw_result`).
- **RLM-style transcript tools (optional)**:
  - Enabled per-request via `use_rlm: true` (or `useRlm: true`) on audit run endpoints (no env toggle).
  - The LLM uses constrained tools (`searchTranscript`, `getTranscriptChunks`) to find/quote evidence.
  - Existing deterministic **evidence gating** still validates citations against the transcript and downgrades unsupported claims.
- **Chat history ordering**:
  - Chat endpoints use the most recent ~50 messages (returned chronologically), so long conversations don’t keep prompting on the oldest context.
- **Progressive fiche date-range fan-out**:
  - `fiches/progressive-fetch-continue` fans out per-day work.
  - Day workers emit processed events; a serialized updater updates/finalizes the job.
  - Added defensive “derived status” in job polling endpoints.
- **Automation run distribution**:
  - Replaced inline fiche detail fetching with distributed `fiche/fetch` fan-out.
  - Made fan-out event IDs deterministic to avoid duplicate dispatch on retries.
- **Automation runs listing**:
  - Added `GET /api/automation/runs` to list runs across all schedules (limit/offset).
- **Automation flow hardening**:
  - Automation now enforces `groupes` + `onlyUnaudited` selection filters, and applies `onlyWithRecordings` after fetching full fiche details.
  - Automation emits `automation/completed` and `automation/failed` domain events for event-driven consumers.
  - Automation fiche sales-list cache revalidation honors a cooldown (`AUTOMATION_REVALIDATION_COOLDOWN_MS`, default 30 minutes) based on the **most recent** `fiche_cache.last_revalidated_at` within the requested `salesDate` range (prevents repeated revalidation on frequent retries/runs).
  - Automation now honors schedule controls: `skipIfTranscribed`, `continueOnError`, and `retryFailed/maxRetries` (stall wait extension + transcription re-dispatch).
  - Schedule update validation now checks the effective config (current + patch) so DAILY/WEEKLY/MONTHLY can’t be saved without required fields.
  - Automation can enable transcript tools mode for audits via `ficheSelection.useRlm=true` (propagates `use_rlm=true` into `audit/run`).
  - Automation schedule webhook URLs are SSRF-guarded via `validateOutgoingWebhookUrl` (honors `WEBHOOK_ALLOWED_ORIGINS`).
  - Automation emits dedicated Pusher realtime events (`automation.run.*`) on `private-job-automation-run-<RUN_ID>` for frontend observability.
  - Automation email notifications can send via SMTP when `SMTP_*` env vars are configured (otherwise skipped/logged).
- **Automation run results (normalized)**:
  - Per-fiche results are stored in `automation_run_fiche_results` (status + error/reason), not in `automation_runs.result_summary` arrays.
  - Run detail endpoints reconstruct the legacy `resultSummary` shape from the table when needed.
- **Progressive fetch webhook payloads (normalized)**:
  - Webhook payload fields are stored in dedicated `webhook_deliveries.payload_*` columns and `webhook_delivery_partial_fiches`.
  - Delivery/retry reconstructs the payload from the normalized fields (legacy rows fall back to JSON payload).
- **Fiche details fetch (gateway by-id)**:
  - Fiche detail fetch no longer depends on cached `cle` (gateway refreshes internally using `fiche_id`).
  - Cache-miss and `_salesListOnly` refresh can fetch full details and best-effort persist them to DB cache.
  - `force_refresh: true` is throttled per fiche via `FICHE_FORCE_REFRESH_COOLDOWN_MS` (default 30 min) so frequent workflows (notably transcriptions) don’t repeatedly hit the CRM gateway.
- **Fiche cache JSON reduction (normalized)**:
  - Large sections of `fiche_cache.raw_data` are now stored in dedicated tables/columns and reconstructed on read to preserve API shape.
  - Response envelope scalars are stored as columns (`fiche_cache.cle`, `fiche_cache.details_success`, `fiche_cache.details_message`) instead of being duplicated inside `raw_data`.
  - Newly normalized sections include: `information`, `prospect`, `etiquettes`, `documents`, `commentaires`, `mails`, `rendez_vous`, `alertes`, `enfants`, `conjoint`, `reclamations`, `autres_contrats`, `raw_sections`, `elements_souscription`, `tarification`, `mail_devis`.
  - Automation “full details ready” polling now treats `fiche_cache_information` as the source of truth (legacy rows still fall back to raw JSON).
  - `mail_devis` is **opt-in** at read time via `include_mail_devis=true` (to avoid large payloads by default).
  - Backfill + inspection tooling (run in small batches):
    - `scripts/backfill-fiche-cache-envelope-columns.ts` migrates `cle/success/message` to columns and trims `raw_data`.
    - `scripts/backfill-fiche-cache-normalized-sections.ts` migrates + trims normalized sections even when `information` is already normalized; supports resume via `BACKFILL_FICHE_CACHE_SECTIONS_AFTER_ID` and accepts empty strings.
    - `scripts/backfill-fiche-cache-mail-devis.ts` only selects `mail_devis` JSON **objects** (skips `null` markers) and trims `raw_data`.
    - `scripts/inspect-fiche-cache-row-rawdata.ts` inspects one `fiche_cache` row to understand remaining JSON structure/shape.
- **Automation safety guardrails**:
  - Automation can ignore fiches with too many recordings via `ficheSelection.maxRecordingsPerFiche` (or env fallback `AUTOMATION_MAX_RECORDINGS_PER_FICHE`).
  - Per-fiche outcomes (successful/failed/ignored) are tracked in `automation_run_fiche_results` (run `result_summary` JSON kept minimal).
- **Transcription hardening (ElevenLabs)**:
  - Normalizes `ELEVENLABS_API_KEY` (trims whitespace / strips surrounding quotes).
  - Axios errors are rethrown as **sanitized** messages (avoid leaking headers like `xi-api-key`).
  - Lock contention logs (fiche + recording locks) are downgraded to info (expected under fan-out + retries) to reduce noise.
- **Operational hardening**:
  - Docker startup now runs `prisma migrate deploy` **and** `npm run seed:auth` to prevent schema drift and ensure RBAC roles/permissions exist (optional admin user via `AUTH_SEED_ADMIN_*`).
  - Self-hosted Inngest is configured to poll the SDK URL (`--poll-interval`) so new function IDs/events are discovered without requiring a restart.
  - API error logging downgrades expected 4xx (401/403/404) from ERROR to INFO/WARN to reduce log noise.
  - `/api/inngest` normalizes 5xx AppErrors (eg 502) to HTTP 500 to avoid Inngest engine “invalid status code” errors.
- **Batch audits**:
  - `POST /api/audits/batch` now requires Redis for progress/finalization (fails fast if `REDIS_URL` is not configured).

### Next improvements (if needed)
- Batch audit tracking (optional): add explicit batch job state + progress aggregation.
- Reduce “long polling” in automation waits by switching to event-driven aggregation.





