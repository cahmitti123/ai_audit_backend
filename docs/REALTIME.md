### Realtime (Pusher) — Backend Integration

This backend delivers realtime **via Pusher Channels** (best-effort notifications; clients refetch authoritative REST state).

Legacy realtime delivery (SSE under `/api/realtime/*` + backend→frontend “system webhooks”) has been **removed**.
Chat streaming endpoints (`/api/*/chat`) remain SSE.

---

### Environment variables

Backend (server-only secrets):

- **`PUSHER_APP_ID`**: Pusher app id (server-only)
- **`PUSHER_SECRET`**: Pusher secret (server-only)
- **`PUSHER_KEY`**: Pusher key (public, but kept server-side too)
- **`PUSHER_CLUSTER`**: e.g. `eu`

Optional:

- **`PUSHER_USE_PRIVATE_CHANNELS`**: `1` (default) to use `private-*` channels; `0` for public channels
- **`PUSHER_MAX_PAYLOAD_BYTES`**: payload guard (default `9000`)
- **`PUSHER_DRY_RUN`**: `1` disables outbound publish (useful for tests)

Frontend (safe for client):

- **`NEXT_PUBLIC_PUSHER_KEY`**: same as `PUSHER_KEY`
- **`NEXT_PUBLIC_PUSHER_CLUSTER`**: same as `PUSHER_CLUSTER`

---

### Channel naming convention (current backend domain)

Pusher channels:

- **Audit**: `private-audit-{auditId}`
- **Fiche**: `private-fiche-{ficheId}`
- **Job**: `private-job-{jobId}`

If `PUSHER_USE_PRIVATE_CHANNELS=0`, the `private-` prefix is omitted.

---

### Event naming convention

Event names use dot notation and match existing backend event types:

- **Audit**: `audit.*` (see `WebhookEventType` in `src/shared/webhook.ts`)
- **Transcription**: `transcription.*`
- **Batch**: `batch.*`
- **Notifications**: `notification`
- **Progressive fetch jobs**: `fiches.progressive_fetch.*`

---

### Channel routing (scoping)

- **Audit events**: publish to `private-audit-{audit_id}` and (if present) also `private-fiche-{fiche_id}`
- **Transcription events**: publish to `private-fiche-{fiche_id}`
- **Progressive fetch job events**: publish to `private-job-{jobId}`
- **Batch + notifications**: publish to `private-global`

---

### Payload shape (Pusher vs legacy SSE)

**Pusher payloads are the existing domain “data object”** (the same object that used to live under `.data` in system webhooks / SSE envelopes).

Example: Pusher event `audit.progress` payload:

```json
{
  "audit_id": "audit-1787121-1-1765755984607",
  "fiche_id": "1787121",
  "completed_steps": 3,
  "total_steps": 5,
  "failed_steps": 0,
  "current_phase": "analysis"
}
```

If a Pusher payload exceeds the configured limit, the backend logs a warning and emits a **truncated** payload (keeping critical IDs/counts).

---

### Private channel auth endpoint

If you use private/presence channels, configure Pusher JS with an auth endpoint:

- **POST** `/api/realtime/pusher/auth`
- Body: `{ "socket_id": "...", "channel_name": "private-audit-..." }`

Important: **this backend does not enforce user/org auth today**, so the auth endpoint currently only validates channel naming rules. For real security:

- Add backend auth (JWT/session) and enforce channel ownership, **or**
- Proxy auth through a trusted Next.js API route that checks the user session and forwards to the backend.

---

### Test endpoint

To verify publish + delivery quickly:

- **POST** `/api/realtime/pusher/test`
- Body (optional):
  - `channel` (default: `private-realtime-test` or `realtime-test`)
  - `event` (default: `realtime.test`)
  - `payload` (default: `{ message, ts }`)

---

### Migration note

Frontend should subscribe to the appropriate entity-scoped channels (audit/fiche/job/global) and treat events as “notify then refetch”.
