# Operations

## Inngest

- The Inngest handler is mounted at: `POST /api/inngest` (see `src/app.ts`).
- Local dev runner/UI:

```bash
npm run inngest
```

### Inngest patterns (important)

- **Do not nest `step.*` calls inside `step.run`** (avoid Inngest `NESTING_STEPS`).
  - Good: compute inside `step.run`, then call `step.sendEvent` at top-level.
  - When emitting multiple events, prefer a single `step.sendEvent("some-step", eventsArray)`.

## Automation scheduling

- Scheduler tick function: `scheduledAutomationCheck` in `src/modules/automation/automation.workflows.ts`
- Cron cadence:
  - Default: **every minute**
  - Override: `AUTOMATION_SCHEDULER_CRON` (e.g. `*/15 * * * *`)
- “Due” detection:
  - Window-based and timezone-aware cron matching (see helpers in `src/modules/automation/automation.service.ts`)

## Webhooks

### Central sender

Webhook delivery is centralized in `src/shared/webhook.ts`.

If `FRONTEND_WEBHOOK_URL` is not configured, the system will still publish the event to realtime/SSE topics (so local UI can still work via SSE).

### SSRF protection (user-provided webhook URLs)

For user-provided webhook URLs (notably progressive fetch), URLs are validated with `validateOutgoingWebhookUrl()` in `src/shared/webhook-security.ts`.

- Use `WEBHOOK_ALLOWED_ORIGINS` to explicitly allow known frontend origins.
- Without an allowlist, private IP ranges are blocked to reduce SSRF risk.

### Logging

Webhook failures log **axios `code`**, **HTTP `status`**, and **URL path** (without leaking secrets).

## Realtime (SSE)

SSE endpoints live under `/api/realtime/*` and are backed by Redis Streams when `REDIS_URL` is configured.

- Supports resume via `Last-Event-ID` (Redis mode)
- Sends periodic heartbeats to keep connections alive behind proxies





