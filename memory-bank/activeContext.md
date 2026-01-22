## Active Context

### Current focus
- Make heavy workflows **scale across replicas** and remain correct under retries.
- Ensure frontend receives reliable progress via **SSE + webhooks**.

### Recent changes (high impact)
- **Audit step-level fan-out**:
  - `audit/run` orchestrates prerequisites then dispatches `audit/step.analyze` events.
  - Each step worker stores results in DB; a finalizer completes the audit once all steps exist.
- **Reruns now update stored audits**:
  - Step rerun persists the new step output into `audit_step_results` and recomputes audit compliance summary (`audits.*` score/niveau/critical).
  - Control point rerun patches `audit_step_results.raw_result.points_controle[i]`, recomputes step score/conforme deterministically, and recomputes audit compliance summary.
  - Both paths keep an audit trail in `audit_step_results.raw_result.rerun_history`.
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
- **Automation flow hardening**:
  - Automation now enforces `groupes` + `onlyUnaudited` selection filters, and applies `onlyWithRecordings` after fetching full fiche details.
  - Automation emits `automation/completed` and `automation/failed` domain events for event-driven consumers.
  - Automation now honors schedule controls: `skipIfTranscribed`, `continueOnError`, and `retryFailed/maxRetries` (stall wait extension + transcription re-dispatch).
  - Automation can enable transcript tools mode for audits via `ficheSelection.useRlm=true` (propagates `use_rlm=true` into `audit/run`).
  - Automation schedule webhook URLs are SSRF-guarded via `validateOutgoingWebhookUrl` (honors `WEBHOOK_ALLOWED_ORIGINS`).
  - Automation emits dedicated Pusher realtime events (`automation.run.*`) on `private-job-automation-run-<RUN_ID>` for frontend observability.
  - Automation email notifications can send via SMTP when `SMTP_*` env vars are configured (otherwise skipped/logged).
- **Fiche details fetch (gateway by-id)**:
  - Fiche detail fetch no longer depends on cached `cle` (gateway refreshes internally using `fiche_id`).
  - Cache-miss and `_salesListOnly` refresh can fetch full details and best-effort persist them to DB cache.
- **Automation safety guardrails**:
  - Automation can ignore fiches with too many recordings via `ficheSelection.maxRecordingsPerFiche` (or env fallback `AUTOMATION_MAX_RECORDINGS_PER_FICHE`).
  - Ignored fiches are tracked in run summaries (`resultSummary.ignored`, `ignored_fiches`).
- **Transcription hardening (ElevenLabs)**:
  - Normalizes `ELEVENLABS_API_KEY` (trims whitespace / strips surrounding quotes).
  - Axios errors are rethrown as **sanitized** messages (avoid leaking headers like `xi-api-key`).
- **Operational hardening**:
  - Docker startup now runs `prisma migrate deploy` to prevent schema drift crashes (e.g., missing `audit_step_results.raw_result`).
  - Self-hosted Inngest is configured to poll the SDK URL (`--poll-interval`) so new function IDs/events are discovered without requiring a restart.
- **Batch audits**:
  - `POST /api/audits/batch` now requires Redis for progress/finalization (fails fast if `REDIS_URL` is not configured).

### Next improvements (if needed)
- Batch audit tracking (optional): add explicit batch job state + progress aggregation.
- Reduce “long polling” in automation waits by switching to event-driven aggregation.





