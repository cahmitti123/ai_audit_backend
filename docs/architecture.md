# Architecture

## High-level

This service is a TypeScript/Express backend that:

1. Fetches **fiches** (sales/call records) from an external API
2. Stores/cache them in **Postgres** (via Prisma)
3. Fetches **recordings** per fiche
4. Transcribes audio recordings (ElevenLabs)
5. Runs AI audit workflows (OpenAI) via **Inngest**
6. Emits progress/results via **webhooks** and **SSE** (Redis-backed when available)

## Repository layout

```
src/
  app.ts            Express app factory + route mounting
  server.ts         Entrypoint (starts HTTP server)
  config/swagger.ts Swagger/OpenAPI generation
  inngest/          Inngest client + function aggregator
  modules/          Domain modules (routes/services/repos/workflows)
  shared/           Cross-cutting utilities (prisma, webhook, redis, logger, errors)
  utils/            Small utilities (concurrency, payload sizing, parsing)
```

## Domain modules

Each module follows a simple layering:

- **routes**: HTTP endpoints + validation
- **service**: orchestration/business logic
- **repository**: persistence via Prisma
- **workflows/events**: Inngest functions + event types (when needed)

Modules under `src/modules/*`:

- `fiches`: fiche fetching, caching, progressive fetch jobs
- `recordings`: recordings lookup
- `transcriptions`: transcription workflows + status endpoints
- `audit-configs`: CRUD for audit configs + steps
- `audits`: audit workflows, reruns, evidence/timeline, vector-store integration
- `automation`: scheduling + automated runs
- `products`: insurance product DB + matching/linking to fiches
- `realtime`: SSE endpoints (Redis streams when configured)
- `webhooks`: webhook testing endpoints (delivery is centralized in `src/shared/webhook.ts`)
- `chat`: streaming chat endpoints over audits/fiches





