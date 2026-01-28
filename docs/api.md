# API

The API exposes REST endpoints under `/api/*` and publishes OpenAPI docs at `/api-docs`.

For detailed request/response payloads (and frontend-ready DTOs), see `docs/BACKEND_FRONTEND_CONTRACT.md`.

## Frontend integration notes (recent changes)

If you’re updating the frontend, start here:

- **Reruns now update stored audits**: step reruns and control-point reruns persist updates (step summary + normalized control points/trails) and recompute audit compliance; UI should refetch `GET /api/audits/:audit_id` after rerun completion.
- **Automation has dedicated realtime events**: `automation.run.*` events are emitted on `private-job-automation-run-{run_id}` (see contract + checklist).
- **Automation run results are normalized**: per-fiche outcomes live in `automation_run_fiche_results`; run detail endpoints can reconstruct the legacy `resultSummary` shape even when `automation_runs.result_summary` is minimal.
- **Batch audits require Redis**: `POST /api/audits/batch` returns `503` if Redis is not configured; UI must handle this.
- **Fiche details `mail_devis` is opt-in**: `GET /api/fiches/:fiche_id` omits `mail_devis` by default; request it with `?include_mail_devis=true` (field is optional and may be `null` if not available).
- **Recording transcription `words` can be empty**: transcription storage is being normalized; `GET /api/transcriptions/:fiche_id/recordings/:call_id` may return `transcription.words: []` — use `transcription.text` as the primary display field.
- **Chat SSE error events**: when a streaming error happens after headers are sent, the server emits `data: {"type":"error","error":"...","code":"STREAM_ERROR"}` before `[DONE]`.
- **Optional API token auth**: if `API_AUTH_TOKEN`/`API_AUTH_TOKENS` is set, all `/api/*` calls (including Pusher auth + chat) require `Authorization: Bearer ...` or `X-API-Key: ...`.

See:
- `docs/BACKEND_FRONTEND_CONTRACT.md` (migration notes + DTOs)
- `docs/audit-verification-checklist.md` (deep behavior + debugging)

## Interactive API docs

- Swagger UI: `http://localhost:3002/api-docs`
- OpenAPI JSON: `http://localhost:3002/api-docs.json`

## Health

- `GET /health`

## Core resource groups (routes are mounted in `src/app.ts`)

### Fiches (`/api/fiches`)

- `GET /api/fiches/search?date=YYYY-MM-DD`
- `GET /api/fiches/:fiche_id?refresh=true|false&include_mail_devis=true|false`
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
- `GET /api/audits` supports additional fiche filters:
  - `sales_dates` (CSV `YYYY-MM-DD`)
  - `sales_date_from` / `sales_date_to` (YYYY-MM-DD range)
  - `has_recordings` (`true|false`)
  - `recordings_count_min` / `recordings_count_max` (ints)
  - `fetched_at_from` / `fetched_at_to` (ISO 8601 datetime)
  - `last_revalidated_from` / `last_revalidated_to` (ISO 8601 datetime)
- `GET /api/audits/grouped-by-fiches`
- `GET /api/audits/grouped`
- `GET /api/audits/control-points/statuses`
- `POST /api/audits/run`
- `POST /api/audits` (alias of `/api/audits/run`)
- `POST /api/audits/run-latest`
- `POST /api/audits/batch`
- `GET /api/audits/by-fiche/:fiche_id`
- `GET /api/audits/:audit_id`
- `PATCH /api/audits/:audit_id`
- `DELETE /api/audits/:audit_id`
- `POST /api/audits/:audit_id/steps/:step_position/rerun`
- `PATCH /api/audits/:audit_id/steps/:step_position/review`
- `POST /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/rerun`
- `GET /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index`
- `PATCH /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/review`

#### Audit transcript mode (legacy prompt vs RLM-style tools)

- Default is **prompt** mode (the full transcript timeline is embedded into the audit step prompt).
- To enable **tools** mode (RLM-style transcript access layer), send `use_rlm: true` (or `useRlm: true`) in the JSON body of:
  - `POST /api/audits/run`
  - `POST /api/audits` (alias)
  - `POST /api/audits/run-latest`
  - `POST /api/audits/batch`
- Completed audits include the chosen approach in `resultData.metadata.approach` (also duplicated under `resultData.audit.results.approach`).

#### AB testing (script: prompt vs tools)

- A standalone runner exists at `scripts/ab-test-audits.ts`.
- It samples random fiches from the DB, runs **two audits per fiche** (prompt vs tools), waits for completion, then writes a benchmark report to `data/ab-tests/`.
- Run it with:
  - `npm run abtest:audits -- --count 5 --audit-config-id 13`
  - `npm run abtest:audits -- --count 10 --sales-date 2026-01-19`

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

#### Safety: ignore fiches with too many recordings

- Set `AUTOMATION_MAX_RECORDINGS_PER_FICHE` (env) or schedule `ficheSelection.maxRecordingsPerFiche` (overrides env) to a positive integer.
- When enabled, automation will **skip** fiches where `recordingsCount` is greater than the threshold; skipped fiches are reported in the run summary.

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





