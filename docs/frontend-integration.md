# Frontend Integration

## Webhooks vs SSE

You typically have two options to build a realtime UI:

- **Webhooks**: backend pushes events to `FRONTEND_WEBHOOK_URL` (central sender: `src/shared/webhook.ts`)
- **SSE**: frontend subscribes directly to `/api/realtime/*`

In practice, many deployments use **both**:

- Webhooks for “push when complete”
- SSE for “live progress stream” + reconnection support

## SSE endpoints

- `GET /api/realtime/fiches/:ficheId`
- `GET /api/realtime/audits/:auditId`
- `GET /api/realtime/jobs/:jobId`

Redis mode supports resume with `Last-Event-ID`.

## Shared frontend types

The `types/` folder contains TypeScript types/utilities intended to be copied into the frontend.
See `types/README.md` for usage.

## Chat streaming

Chat endpoints stream a response using `text/event-stream`:

- `POST /api/audits/:audit_id/chat`
- `POST /api/fiches/:fiche_id/chat`

Use the corresponding `.../history` endpoints to load message history.





