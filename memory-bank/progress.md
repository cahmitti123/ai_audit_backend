## Progress

### Working now
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
- Fiche detail fetch works by `fiche_id` only (gateway refreshes `cle` internally), so audits/transcriptions can fetch/cache fiche details even if the fiche was never pre-cached via sales-list/date-range.
- **Automation safety** can skip/ignore fiches with too many recordings (`maxRecordingsPerFiche` / `AUTOMATION_MAX_RECORDINGS_PER_FICHE`) to protect fan-out + provider quota.
- **ElevenLabs transcription** validates/normalizes `ELEVENLABS_API_KEY` and sanitizes Axios errors (avoid leaking request headers in logs).
- TypeScript build is green (`npm run build`).
- Docker startup runs `prisma migrate deploy` so DB schema stays aligned with Prisma (prevents runtime column-missing crashes).

### Verified smoke tests (local)
- Created progressive fetch job for missing dates and confirmed it progressed to **complete** via `/api/fiches/jobs/:jobId`.
- Triggered an automation run with manual fiche selection and confirmed it uses distributed `fiche/fetch` fan-out.

### Known caveats
- Self-hosted Inngest polls the SDK URL for function definition changes (so new function IDs/events should appear within the poll window; restart only if you need immediate pickup).
- Automation runs that rely on “automatic audit configs” will show **0 configs** if no configs are marked automatic.





