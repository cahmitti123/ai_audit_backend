## System Patterns

### Architecture
- **Express + TypeScript** API (`src/app.ts`, `src/server.ts`)
- **Prisma/Postgres** for persistence (`src/shared/prisma.ts`, `prisma/schema.prisma`)
- **Inngest** for background workflows (`src/inngest/*`, `src/modules/*/*.workflows.ts`)
- **Redis** for cross-replica coordination (`src/shared/redis.ts`, `src/shared/redis-lock.ts`)

### Domain modules
- `src/modules/fiches`: CRM fiche caching, progressive fetch jobs
- `src/modules/transcriptions`: ElevenLabs transcription + DB storage
- `src/modules/audits`: LLM audits, step results, finalization
- `src/modules/automation`: schedules + automation runs
- `src/modules/realtime`: Pusher endpoints (`/api/realtime/pusher/*`)
- `src/shared/webhook.ts`: centralized realtime event publisher (Pusher)

### Inngest workflow design (critical)
- Prefer **orchestrator → fan‑out workers → aggregator/finalizer**.
- **Never nest `step.*` calls inside `step.run`** (avoid `NESTING_STEPS`).
- Use deterministic event IDs for idempotency when dispatching fan-out work.

### Key fan-out boundaries
- **Audit**:
  - Orchestrator: `audit/run`
  - Worker: `audit/step.analyze` (one step per event, stores `audit_step_results.raw_result`)
  - Finalizer: triggered by `audit/step.analyzed` and finalizes once all steps exist
  - Transcript context strategies:
    - **prompt** (default): embed full `timelineText` in each step prompt
    - **tools** (optional): keep timeline out of the prompt; LLM uses constrained transcript tools (`searchTranscript`, `getTranscriptChunks`) to fetch evidence
- **Progressive fiche fetch (date range)**:
  - Orchestrator: `fiches/progressive-fetch-continue`
  - Worker: `fiches/cache-sales-list` (single date-range sales search + DB caching)
  - Updater: `fiches/progressive-fetch-day.processed` (serialized per jobId; emitted after caching to drive progress/finalization)
  - Legacy: `fiches/progressive-fetch-day` remains available but is no longer used by the main flow (avoids per-day CRM fan-out)
- **Automation**:
  - Orchestrator: `automation/run`
  - Fan-out: `fiche/fetch` (details), `fiche/transcribe`, `audit/run`
  - Safeguard: can ignore fiches with too many recordings (`ficheSelection.maxRecordingsPerFiche` or env `AUTOMATION_MAX_RECORDINGS_PER_FICHE`)

### Fiche details fetching (important prerequisite)
- Fiche “full details” fetch uses the gateway **by fiche_id** (`/api/fiches/by-id/:fiche_id`); the gateway refreshes `cle` internally.
- Cache-miss is allowed: fiche details can be fetched/cached even if the fiche was never pre-cached via sales-list/date-range.

### Realtime pattern
- Publish domain events via Pusher (see `src/shared/webhook.ts` and `src/shared/pusher.ts`)
- Clients subscribe to entity channels: `private-job-*`, `private-audit-*`, `private-fiche-*`, plus `private-global`





