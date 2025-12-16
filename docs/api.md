# API

The API exposes REST endpoints under `/api/*` and publishes OpenAPI docs at `/api-docs`.

## Interactive API docs

- Swagger UI: `http://localhost:3002/api-docs`
- OpenAPI JSON: `http://localhost:3002/api-docs.json`

## Health

- `GET /health`

## Core resource groups (routes are mounted in `src/app.ts`)

### Fiches (`/api/fiches`)

- `GET /api/fiches/search?date=YYYY-MM-DD`
- `GET /api/fiches/:fiche_id?refresh=true|false`
- `GET /api/fiches/:fiche_id/cache`
- `GET /api/fiches/:fiche_id/status`
- `POST /api/fiches/status/batch`
- `GET /api/fiches/status/by-date?date=YYYY-MM-DD`
- `GET /api/fiches/status/by-date-range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- `GET /api/fiches/jobs`
- `GET /api/fiches/jobs/:jobId`

### Recordings (`/api/recordings`)

- `GET /api/recordings/:fiche_id`

### Transcriptions (`/api/transcriptions`)

- `POST /api/transcriptions/:fiche_id?priority=high|normal|low`
- `GET /api/transcriptions/:fiche_id/status`
- `GET /api/transcriptions/:fiche_id/recordings/:call_id`
- `POST /api/transcriptions/batch`

### Audit configs (`/api/audit-configs`)

- `GET /api/audit-configs`
- `GET /api/audit-configs/:id`
- `POST /api/audit-configs`
- `PUT /api/audit-configs/:id`
- `DELETE /api/audit-configs/:id`
- `POST /api/audit-configs/:config_id/steps`
- `PUT /api/audit-configs/steps/:step_id`
- `DELETE /api/audit-configs/steps/:step_id`
- `PUT /api/audit-configs/:config_id/steps/reorder`
- `GET /api/audit-configs/:config_id/validate`
- `GET /api/audit-configs/:config_id/stats`

### Audits (`/api/audits`)

- `GET /api/audits`
- `GET /api/audits/grouped-by-fiches`
- `POST /api/audits/run`
- `POST /api/audits/run-latest`
- `POST /api/audits/batch`
- `GET /api/audits/by-fiche/:fiche_id`
- `GET /api/audits/:audit_id`
- `POST /api/audits/:audit_id/steps/:step_position/rerun`

### Automation (`/api/automation`)

- `POST /api/automation/schedules`
- `GET /api/automation/schedules`
- `GET /api/automation/schedules/:id`
- `PATCH /api/automation/schedules/:id`
- `DELETE /api/automation/schedules/:id`
- `POST /api/automation/trigger`
- `GET /api/automation/diagnostic`
- `GET /api/automation/schedules/:id/runs`
- `GET /api/automation/runs/:id`
- `GET /api/automation/runs/:id/logs`

### Products (`/api/products`)

- `GET /api/products/stats`
- `GET /api/products/search?q=...`
- `GET /api/products/link-fiche/:ficheId`
- `GET|POST /api/products/groupes`
- `GET|PUT|DELETE /api/products/groupes/:id`
- `GET|POST /api/products/gammes`
- `GET|PUT|DELETE /api/products/gammes/:id`
- `GET|POST /api/products/formules`
- `GET|PUT|DELETE /api/products/formules/:id`

### Realtime (Pusher) (`/api/realtime/pusher`)

- `POST /api/realtime/pusher/auth`
- `POST /api/realtime/pusher/test`

### Chat (mounted under `/api`)

- `GET /api/audits/:audit_id/chat/history`
- `POST /api/audits/:audit_id/chat` (streaming)
- `GET /api/fiches/:fiche_id/chat/history`
- `POST /api/fiches/:fiche_id/chat` (streaming)

### Webhooks

- Progressive fetch supports an optional **per-request webhookUrl** (see `docs/BACKEND_FRONTEND_CONTRACT.md`).





