# Frontend Integration

## Realtime (Pusher)

Realtime domain events are delivered via **Pusher Channels**.

- Pusher endpoints:
  - `POST /api/realtime/pusher/auth`
  - `POST /api/realtime/pusher/test`
- Channel/event catalog:
  - `docs/FRONTEND_PUSHER_EVENTS.md`

## Shared frontend types

The `types/` folder contains TypeScript types/utilities intended to be copied into the frontend.
See `types/README.md` for usage.

## Chat streaming

Chat endpoints stream a response using `text/event-stream`:

- `POST /api/audits/:audit_id/chat`
- `POST /api/fiches/:fiche_id/chat`

Use the corresponding `.../history` endpoints to load message history.





