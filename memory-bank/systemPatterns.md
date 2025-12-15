## System Patterns

### Architecture
- **Express + TypeScript** API (`src/app.ts`, `src/server.ts`)
- **Prisma/Postgres** for persistence (`src/shared/prisma.ts`, `prisma/schema.prisma`)
- **Inngest** for background workflows (`src/inngest/*`, `src/modules/*/*.workflows.ts`)
- **Redis** for cross-replica coordination + realtime streams (`src/shared/redis.ts`, `src/shared/realtime.ts`, `src/shared/redis-lock.ts`)

### Domain modules
- `src/modules/fiches`: CRM fiche caching, progressive fetch jobs
- `src/modules/transcriptions`: ElevenLabs transcription + DB storage
- `src/modules/audits`: LLM audits, step results, finalization
- `src/modules/automation`: schedules + automation runs
- `src/modules/realtime`: SSE endpoints (`/api/realtime/*`)
- `src/shared/webhook.ts`: centralized webhook sender (SSRF guard + signature)

### Inngest workflow design (critical)
- Prefer **orchestrator → fan‑out workers → aggregator/finalizer**.
- **Never nest `step.*` calls inside `step.run`** (avoid `NESTING_STEPS`).
- Use deterministic event IDs for idempotency when dispatching fan-out work.

### Key fan-out boundaries
- **Audit**:
  - Orchestrator: `audit/run`
  - Worker: `audit/step.analyze` (one step per event, stores `audit_step_results.raw_result`)
  - Finalizer: triggered by `audit/step.analyzed` and finalizes once all steps exist
- **Progressive fiche fetch (date range)**:
  - Orchestrator: `fiches/progressive-fetch-continue`
  - Worker: `fiches/progressive-fetch-day` (one date per event)
  - Updater: `fiches/progressive-fetch-day.processed` (serialized per jobId)
- **Automation**:
  - Orchestrator: `automation/run`
  - Fan-out: `fiche/fetch` (details), `fiche/transcribe`, `audit/run`

### Realtime pattern
- Publish events to `topicForJob(...)`, `topicForAudit(...)`, `topicForFiche(...)`
- SSE consumers subscribe via `/api/realtime/jobs/:jobId`, `/api/realtime/audits/:auditId`, `/api/realtime/fiches/:ficheId`





