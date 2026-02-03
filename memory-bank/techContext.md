## Tech Context

### Stack
- **Node.js** (Docker base `node:20-alpine`)
- **TypeScript** (`tsc` build)
- **Express** API server
- **Prisma** ORM (Postgres)
- **Inngest** self-hosted (Docker)
- **Redis** (locks + realtime event streams)

### Local / Docker runtime
- `docker-compose.prod.scale.yml` runs:
  - `server` (scaled replicas)
  - `lb` (nginx load balancer, exposes API)
  - `inngest` (self-hosted)
  - `redis`
- Server container runs `prisma migrate deploy` + `npm run seed:auth` on startup to apply pending migrations and upsert RBAC roles/permissions (optional admin user via `AUTH_SEED_ADMIN_*`).

### Important environment variables (no secrets here)
- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_URL` (e.g., `redis://redis:6379`)
- **Inngest**: `INNGEST_BASE_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- **AI**: `OPENAI_API_KEY`, `OPENAI_MODEL_AUDIT`, `OPENAI_MODEL_CHAT`
- **Audit long-context mode**:
  - Per-request toggle: send `use_rlm: true` (or `useRlm: true`) on audit run endpoints to enable transcript-tools mode (out-of-prompt evidence lookup).
- **Transcription**: `ELEVENLABS_API_KEY`
- **Scheduler**: `AUTOMATION_SCHEDULER_CRON` (default every minute)
- **Automation safety**: `AUTOMATION_MAX_RECORDINGS_PER_FICHE` (if >0, skip fiches whose `recordingsCount` is above the threshold; schedule can override via `ficheSelection.maxRecordingsPerFiche`)
- **Webhook security**: `WEBHOOK_ALLOWED_ORIGINS` (SSRF allowlist)
- **Automation email (optional)**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TIMEOUT_MS`





