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

The backend still supports **per-request webhooks** for progressive fetch jobs (optional).

### SSRF protection (user-provided webhook URLs)

For user-provided webhook URLs (notably progressive fetch), URLs are validated with `validateOutgoingWebhookUrl()` in `src/shared/webhook-security.ts`.

- Use `WEBHOOK_ALLOWED_ORIGINS` to explicitly allow known frontend origins.
- Without an allowlist, private IP ranges are blocked to reduce SSRF risk.

### Logging

Webhook failures log **axios `code`**, **HTTP `status`**, and **URL path** (without leaking secrets).

## Realtime (Pusher)

Realtime domain events are published via **Pusher Channels**.

- Endpoints: `POST /api/realtime/pusher/auth`, `POST /api/realtime/pusher/test`
- Event catalog + payloads: `docs/FRONTEND_PUSHER_EVENTS.md`

## Audit long-context strategy (RLM-style transcript tools)

By default, each audit step embeds the full timeline text in the LLM prompt.

To reduce context bloat / “context rot” on very long transcripts, you can enable an **out-of-prompt transcript access** mode inspired by “Recursive Language Models” **per request**:

- Send `use_rlm: true` in `POST /api/audits/run` (or `POST /api/audits`, `POST /api/audits/run-latest`, `POST /api/audits/batch`)
- Default is unchanged: if omitted/false, the audit uses the legacy prompt approach.

In `use_rlm=true` mode, the LLM can call constrained server-side tools to:

- `searchTranscript`: find relevant transcript chunks by keyword matching
- `getTranscriptChunks`: fetch exact chunk text + metadata for quoting/citations

Important operational notes:

- Evidence enforcement is still handled by `AUDIT_EVIDENCE_GATING=1` (recommended). Hallucinated citations are dropped and unsupported “PRESENT” claims are conservatively downgraded.
- For best consistency across replicas, keep `REDIS_URL` configured so workers and the finalizer share the same cached timeline. If Redis is missing, the system rebuilds the timeline from DB.





