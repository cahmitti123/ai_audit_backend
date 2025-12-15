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
- Server container runs `prisma migrate deploy` on startup to apply pending migrations.

### Important environment variables (no secrets here)
- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_URL` (e.g., `redis://redis:6379`)
- **Inngest**: `INNGEST_BASE_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- **AI**: `OPENAI_API_KEY`, `OPENAI_MODEL_AUDIT`, `OPENAI_MODEL_CHAT`
- **Transcription**: `ELEVENLABS_API_KEY`
- **Scheduler**: `AUTOMATION_SCHEDULER_CRON` (default every minute)
- **Webhook security**: `WEBHOOK_ALLOWED_ORIGINS` (SSRF allowlist)





