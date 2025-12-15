# Performance Notes

## Progressive fetch (`/api/fiches/status/by-date-range`)

This endpoint returns cached data immediately and continues fetching missing dates in the background, while reporting progress via:

- Webhooks (if `webhookUrl` is provided and passes SSRF validation)
- Realtime/SSE updates (Redis-backed when `REDIS_URL` is configured)

## Known tuning points

Progressive fetch performance is primarily impacted by:

- External CRM/API latency (`FICHE_API_BASE_URL`)
- Internal parallelism (batch size / concurrency in the fiche workflow code)
- Webhook delivery overhead (avoid sending extremely large payloads too frequently)

If you need to tune behavior, start by reviewing `src/modules/fiches/fiches.workflows.ts`.





