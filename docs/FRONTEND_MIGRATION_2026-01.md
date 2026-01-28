## Frontend migration guide (backend changes — 2026-01)

**Audience**: Next.js / browser frontend consuming this backend (REST + SSE chat + Pusher Channels + optional webhooks).  
**Goal**: summarize the backend changes that require (or may benefit from) frontend updates.

For the authoritative contract + full endpoint list, see:
- `docs/BACKEND_FRONTEND_CONTRACT.md`
- `docs/api.md`

---

## High-level: what changed?

This backend work focused on two outcomes:

- **Scale & reliability across multiple replicas** (fan-out workflows, idempotency, safer DB transactions).
- **Reduce raw JSON storage** by normalizing stable payload structures into **tables/columns** while keeping API shapes backward compatible by reconstructing legacy payloads at read-time.

As a result, most API shapes are preserved, but there are important **behavioral** changes and a few **opt-in payload fields** that the frontend should handle explicitly.

---

## Frontend action checklist (do these)

### 1) Prefer DB audit IDs for navigation + realtime

- Treat **`audit_db_id`** (stringified BigInt) as canonical for:
  - Navigation
  - `GET /api/audits/:audit_db_id`
  - Realtime subscription when available: `private-audit-{audit_db_id}`

The backend may still emit events on both:
- `private-audit-{audit_id}` (tracking id)
- `private-audit-{audit_db_id}` (DB id)

### 2) Reruns / reviews are “async then refetch”

Reruns now **mutate stored audits** (step results + recomputed audit compliance summary).

Frontend pattern:
- Trigger rerun endpoint → receive `{ event_id }` immediately
- Subscribe / listen for `audit.step_completed` (with `rerun_id`, and possibly `rerun_scope`)
- Refetch audit detail: `GET /api/audits/:audit_db_id`

### 3) Handle chat streaming SSE error events

Chat responses are streamed as SSE:
- Many chunks: `data: {"text":"..."}`
- Optional final citations: `data: {"citations":[ ... ]}`
- Done: `data: [DONE]`

If a streaming error occurs after headers are already sent, the server writes:

```json
{ "type": "error", "error": "…", "code": "STREAM_ERROR" }
```

Your SSE parser should treat that as a terminal error (and still stop on `[DONE]`).

### 4) Use the new fiche chat history endpoint (and treat history as a window)

Chat history endpoints:
- `GET /api/audits/:audit_id/chat/history`
- `GET /api/fiches/:fiche_id/chat/history`

Notes:
- Returns **~50 most recent messages** (window, not full history).
- Returned **chronologically** (oldest → newest).

### 5) Transcription payloads: `words` may be empty (normalized storage)

Transcription storage is being normalized into chunks. As a result:
- `GET /api/transcriptions/:fiche_id/recordings/:call_id` may return `transcription.words: []`.
- Always use `transcription.text` as the primary display field.

### 6) Fiche details: `mail_devis` is opt-in (payload size)

`mail_devis` can be large and is omitted by default.

To include it:
- `GET /api/fiches/:fiche_id?include_mail_devis=true`

When requested, it may still be `null` (not available).

---

## What changed under the hood (context for frontend expectations)

### A) JSON storage reduction (API compatibility preserved)

These areas were progressively normalized into structured tables/columns:
- **Fiche cache**: large sections of `fiche_cache.raw_data` → dedicated tables/columns; response is reconstructed on read.
  - Envelope scalars moved to columns: `fiche_cache.cle`, `fiche_cache.details_success`, `fiche_cache.details_message`
- **Audits**:
  - `audit_step_results.raw_result.points_controle` → normalized control point + citation tables
  - step trails (`human_review`, `rerun_history`) → normalized trail tables
  - `audits.result_data` is treated as a lightweight workflow snapshot; API returns a **latest view** by overlaying DB step results.
- **Automation**:
  - Per-fiche outcomes normalized into `automation_run_fiche_results` (so `automation_runs.result_summary` can stay minimal).
  - Run detail endpoints can rebuild the legacy `resultSummary` shape.
- **Webhooks (progressive fetch)**:
  - Webhook delivery payload fields normalized into columns/rows; delivery payload sent to the frontend webhook URL stays the same.
- **Transcriptions**:
  - Word-level transcription JSON is progressively replaced by normalized chunks.
- **Products**:
  - Gamme/Formule document URLs are normalized into the `documents` table; API continues to expose reconstructed `documents` where needed.

Frontend implication: in most places **you should not rely on internal persistence format** (JSON vs tables). Keep using the documented API shapes.

### B) Realtime: automation run job channel

Automation runs emit dedicated Pusher events on:
- Channel: `private-job-automation-run-{run_id}` (implemented as `private-job-{job_id}` with `job_id="automation-run-{run_id}"`)
- Events:
  - `automation.run.started`
  - `automation.run.selection`
  - `automation.run.completed`
  - `automation.run.failed`

### C) Audit transcript tools mode (optional)

Audit run endpoints support:
- Default: **prompt** mode (full timeline embedded in prompt)
- Optional: **tools** mode (RLM-style transcript tools), enabled per request with `use_rlm: true` (alias `useRlm: true`)

The chosen approach is persisted under `resultData.*.approach`.

---

## Quick frontend smoke-test plan

- **Fiche details**:
  - `GET /api/fiches/:fiche_id` (default)
  - `GET /api/fiches/:fiche_id?include_mail_devis=true` (field included or null)
- **Audit rerun UX**:
  - Trigger step rerun → watch `audit.step_completed` → refetch audit detail
  - Trigger control-point rerun → same pattern
- **Automation run UX**:
  - Trigger automation → subscribe to `private-job-automation-run-{run_id}` → render selection + completion/failed
- **Chat**:
  - Stream SSE and ensure you correctly parse:
    - `{"text":"..."}` chunks
    - final `{"citations":[...]}` event
    - `{"type":"error","code":"STREAM_ERROR",...}` (if it happens)
    - `[DONE]`
- **Transcriptions**:
  - Fetch a recording transcription and ensure UI works when `words: []`.

