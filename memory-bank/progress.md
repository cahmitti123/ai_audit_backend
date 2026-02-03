## Progress

### Working now
- **Authentication + scoped RBAC (JWT)**:
  - Roles/permissions are managed dynamically (read/write + `SELF|GROUP|ALL` scope) and shipped in JWT claims.
  - Fiches/audits visibility is restricted by user scope (self/group/all) to support “team/groupe” partitioning.
  - Chat + realtime access for audits/fiches is scope-checked (prevents cross-team subscriptions/LLM context leaks).
  - Recordings/transcriptions endpoints are permission-checked and scope-checked by fiche id (prevents direct ID-guess data leaks).
  - Other core routers (`audit-configs`, `automation`, `products`) are now permission-checked (read vs write).
- **Scaled backend** behind nginx load balancer (3 replicas).
- **Audit pipeline** executes in parallel at the **step** level across replicas.
- **Optional audit transcript tools mode** (`use_rlm: true` per request) keeps long timelines out of prompts and lets the LLM fetch/quote evidence via constrained tools.
- **Progressive fiche date-range jobs** run distributed per day and correctly finalize.
- **Batch audits** require Redis for progress/finalization (`POST /api/audits/batch` returns 503 if `REDIS_URL` is not configured).
- **Automation runs** distribute fiche detail fetch across replicas and fan out transcription/audit work.
- Automation now enforces `groupes` + `onlyUnaudited` selection filters, applies `onlyWithRecordings` after fetching full fiche details, and emits `automation/completed|automation/failed` domain events.
- Automation honors schedule controls (`skipIfTranscribed`, `continueOnError`, `retryFailed/maxRetries`) and SSRF-guards schedule webhook URLs.
- Automation can run audits in transcript tools mode by setting `ficheSelection.useRlm=true` (propagates `use_rlm=true` into `audit/run`).
- Automation emits dedicated Pusher realtime events (`automation.run.*`) on `private-job-automation-run-<RUN_ID>`.
- Automation can send email notifications via SMTP when `SMTP_*` env vars are configured (otherwise skipped/logged).
- Automation run per-fiche outcomes are normalized in `automation_run_fiche_results` (run `result_summary` JSON kept minimal; detail endpoint reconstructs legacy shape when needed).
- Fiche detail fetch works by `fiche_id` only (gateway refreshes `cle` internally), so audits/transcriptions can fetch/cache fiche details even if the fiche was never pre-cached via sales-list/date-range.
- **Automation safety** can skip/ignore fiches with too many recordings (`maxRecordingsPerFiche` / `AUTOMATION_MAX_RECORDINGS_PER_FICHE`) to protect fan-out + provider quota.
- Progressive fetch webhook deliveries store payload fields in columns/rows (payload JSON kept minimal) and can retry by reconstructing the payload.
- Fiche cache (`fiche_cache.raw_data`) is being progressively normalized into tables/columns; stable envelope scalars are stored as columns (`fiche_cache.cle`, `fiche_cache.details_success`, `fiche_cache.details_message`) and read paths reconstruct the legacy API shape so clients are unaffected.
- Fiche cache backfills are running in small batches; many full-detail rows now have near-empty `raw_data` (often `{}`), with legacy API shape reconstructed from normalized tables.
- Recording transcription backfill is in progress: transcription chunks are being created and `recordings.transcription_data` is being cleared (see `scripts/transcription-chunks-status.ts`).
- **ElevenLabs transcription** validates/normalizes `ELEVENLABS_API_KEY` and sanitizes Axios errors (avoid leaking request headers in logs).
- TypeScript build is green (`npm run build`).
- Docker startup runs `prisma migrate deploy` + `npm run seed:auth` so DB schema stays aligned with Prisma and RBAC roles/permissions exist (prevents runtime authZ “empty roles” issues).

### Verified smoke tests (local)
- Created progressive fetch job for missing dates and confirmed it progressed to **complete** via `/api/fiches/jobs/:jobId`.
- Triggered an automation run with manual fiche selection and confirmed it uses distributed `fiche/fetch` fan-out.

### Known caveats
- Self-hosted Inngest polls the SDK URL for function definition changes (so new function IDs/events should appear within the poll window; restart only if you need immediate pickup).
- Automation runs that rely on “automatic audit configs” will show **0 configs** if no configs are marked automatic.





