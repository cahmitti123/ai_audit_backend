### Frontend Realtime Events (Pusher)

This document is the **frontend contract** for realtime events delivered via **Pusher Channels**.

- **Transport**: Pusher Channels (not SSE).
- **Event name**: mostly the same strings as the legacy system webhooks/SSE event names.
  - New: `automation.run.*` events for automation-run UX (`started|selection|completed|failed`).
- **Payload**: **the domain payload object only** (the same object that used to be `payload.data` in system webhooks, and `evt.data` in SSE envelopes).  
  There is **no wrapper** around it for Pusher.
- **Chat streaming** remains SSE (`/api/*/chat`) and is **not** covered here.

Notes:
- Pusher is **notify → refetch**. Do not treat events as durable; clients can miss events while offline.
- Payloads may be **truncated** if they exceed size limits. When truncation happens, the backend keeps key identifiers/counts (e.g. `audit_id`, `fiche_id`, `jobId`, progress counters).

---

### Channels (scoping)

All channel names are deterministic and contain no `:` characters.

- **Audit channel**: `private-audit-{auditId}`
- **Fiche channel**: `private-fiche-{ficheId}`
- **Job channel**: `private-job-{jobId}`
- **Global channel**: `private-global` (batch + notifications + unscoped events)

Routing rules:
- If a payload contains **`audit_id`**: publish to `private-audit-{audit_id}`
- If a payload contains **`audit_db_id`**: also publish to `private-audit-{audit_db_id}` (so UI can “notify → refetch” by DB id)
- If a payload contains **`fiche_id`**: publish to `private-fiche-{fiche_id}`
- If a payload contains **`jobId`** or **`job_id`**: publish to `private-job-{jobId}`
- If a payload contains **`batch_id`**: publish to `private-job-{batch_id}` (batch progress is treated as a “job” channel)
- If none apply (or for `notification`): publish to `private-global`

---

## Audit events (`audit.*`)

### Common fields (most `audit.*` payloads)

- `audit_id` (string)
  - In the normal audit pipeline, this is often a **tracking id** (not the DB id).
  - In rerun payloads, `audit_id` is typically the **audit DB id** (because rerun HTTP routes take the DB id).
- `audit_db_id` (string | optional): when present, this is the canonical DB id to use for `GET /api/audits/:audit_db_id`.
- `event_id` (string | optional): Inngest event id (useful for correlating async runs).
- `approach` (object | optional): `{ use_rlm: boolean; transcript_mode: "prompt" | "tools" }`

### `audit.started`
- **Meaning**: an audit run has started.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `audit_config_id` (string)
  - `audit_config_name` (string)
  - `total_steps` (number)
  - `started_at` (ISO datetime string)
  - `status` = `"started"`

### `audit.fiche_fetch_started`
- **Meaning**: audit pipeline started fetching fiche details (from cache or CRM).
- **Channel(s)**: audit + fiche
- **Payload**:
  - `fiche_id` (string)
  - `from_cache` (boolean)
  - `status` = `"fetching"`

### `audit.fiche_fetch_completed`
- **Meaning**: fiche details are available for the audit.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `fiche_id` (string)
  - `recordings_count` (number)
  - `prospect_name` (string)
  - `from_cache` (boolean)
  - `status` = `"fetched"`

### `audit.config_loaded`
- **Meaning**: an audit config was loaded (informational).
- **Channel(s)**: audit + fiche
- **Payload**:
  - `config_id` (string)
  - `config_name` (string)
  - `steps_count` (number)
  - `status` = `"loaded"`

### `audit.transcription_check`
- **Meaning**: audit pipeline checked transcription completeness.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `fiche_id` (string)
  - `total_recordings` (number)
  - `transcribed` (number)
  - `needs_transcription` (number)
  - `status` = `"checked"`

### `audit.timeline_generated`
- **Meaning**: audit timeline/summary text was generated from recordings.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `fiche_id` (string)
  - `recordings_count` (number)
  - `total_chunks` (number)
  - `status` = `"generated"`

### `audit.analysis_started`
- **Meaning**: audit analysis phase started (LLM step analysis fan-out begins).
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `total_steps` (number)
  - `model` (string)
  - `status` = `"analyzing"`

### `audit.step_started`
- **Meaning**: an audit step analysis started (or a step rerun started).
- **Channel(s)**:
  - normal steps: audit + fiche
  - rerun: audit
- **Payload (normal step)**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `step_position` (number)
  - `step_name` (string)
  - `total_steps` (number)
  - `step_weight` (number)
  - `is_critical` (boolean)
  - `status` = `"processing"`
- **Payload (step rerun)** (distinguish by presence of `rerun_id`):
  - `rerun_id` (string)
  - `rerun_scope` (optional): `"control_point"` when rerunning a single checkpoint (sub-step)
  - `audit_id` (string)
  - `step_position` (number)
  - `control_point_index` (optional number; 1-based, only when `rerun_scope="control_point"`)
  - `started_at` (ISO datetime string)
  - `status` = `"rerunning"`

### `audit.step_completed`
- **Meaning**: an audit step completed (or a step rerun completed).
- **Channel(s)**:
  - normal steps: audit + fiche
  - rerun: audit
- **Payload (normal step)**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `step_position` (number)
  - `step_name` (string)
  - `score` (number)
  - `max_score` (number)
  - `conforme` (boolean)
  - `total_citations` (number)
  - `tokens_used` (number)
  - `status` = `"completed"`
- **Payload (step rerun)** (distinguish by presence of `rerun_id`):
  - `rerun_id` (string)
  - `rerun_scope` (optional): `"control_point"` when rerunning a single checkpoint (sub-step)
  - `audit_id` (string)
  - `step_position` (number)
  - `control_point_index` (optional number; 1-based, only when `rerun_scope="control_point"`)
  - `original` (unknown object)
  - `rerun` (unknown object)
  - `comparison` (unknown object)
  - `completed_at` (ISO datetime string)
  - `status` = `"rerun_completed"`

### `audit.step_failed`
- **Meaning**: an audit step failed.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `step_position` (number)
  - `step_name` (string)
  - `error` (string)
  - `status` = `"failed"`

### `audit.progress`
- **Meaning**: aggregate audit progress after step completions/failures.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `completed_steps` (number)
  - `total_steps` (number)
  - `failed_steps` (number)
  - `current_phase` (string)
  - `progress_percentage` (number)
  - `status` = `"in_progress"`

### `audit.compliance_calculated`
- **Meaning**: overall compliance score and level were computed.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `overall_score` (string)
  - `score_percentage` (string)
  - `niveau` (string)
  - `is_compliant` (boolean)
  - `critical_issues` (string)
  - `status` = `"calculated"`

### `audit.completed`
- **Meaning**: audit completed successfully.
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `overall_score` (string)
  - `score_percentage` (string)
  - `niveau` (string)
  - `is_compliant` (boolean)
  - `successful_steps` (number)
  - `failed_steps` (number)
  - `total_tokens` (number)
  - `duration_seconds` (number)
  - `completed_at` (ISO datetime string)
  - `status` = `"completed"`

### `audit.failed`
- **Meaning**: audit failed (possibly with partial results).
- **Channel(s)**: audit + fiche
- **Payload**:
  - `audit_id` (string)
  - `fiche_id` (string)
  - `error` (string)
  - `failed_phase` (string | optional)
  - `failed_at` (ISO datetime string)
  - `status` = `"failed"`
  - `partial_results` (object | optional)
    - `completed_steps` (number)
    - `total_steps` (number)
    - `failed_steps` (number)

---

## Automation run events (`automation.run.*`)

These events are dedicated to **automation run UX** (run started, selection, completion, failure).

- **Channel**: `private-job-automation-run-{run_id}`
  - Implemented as `private-job-{job_id}` where `job_id = "automation-run-{run_id}"`
- **Payloads**: use snake_case fields (as emitted by the workflow).

### `automation.run.started`
- **Meaning**: an automation run record was created and marked as running.
- **Channel(s)**: job
- **Payload**:
  - `job_id` (string) = `automation-run-{run_id}`
  - `schedule_id` (string)
  - `run_id` (string)
  - `due_at` (ISO datetime string | null)
  - `status` = `"running"`

### `automation.run.selection`
- **Meaning**: fiche selection has been resolved (manual ids or date/filter mode).
- **Channel(s)**: job
- **Payload** (stable subset):
  - `job_id`, `schedule_id`, `run_id`
  - `mode` (`"manual" | "date_range" | "filter"`)
  - `dateRange` (string | null)
  - `groupes` (string[] | optional)
  - `groupes_count` (number)
  - `onlyWithRecordings` (boolean)
  - `onlyUnaudited` (boolean)
  - `maxFiches` (number | null)
  - `maxRecordingsPerFiche` (number | null)
  - `useRlm` (boolean)
  - `total_fiches` (number)

### `automation.run.completed`
- **Meaning**: automation run completed (success/partial/failed) OR ended early (no fiches/dates/etc).
- **Channel(s)**: job
- **Payload** (stable subset):
  - `job_id`, `schedule_id`, `run_id`
  - `status` (`"completed" | "partial" | "failed"`)
  - `total_fiches`, `successful_fiches`, `failed_fiches`
  - `ignored_fiches` (number | optional)
  - `transcriptions_run` (number | optional)
  - `audits_run` (number | optional)
  - `duration_ms` (number | optional)
  - `reason` (string | optional) — present for early returns (ex: `"no_fiches_manual"`)

### `automation.run.failed`
- **Meaning**: catastrophic failure (run marked failed).
- **Channel(s)**: job
- **Payload**:
  - `job_id`, `schedule_id`, `run_id`
  - `status` = `"failed"`
  - `error` (string)
  - `duration_ms` (number)

## Transcription events (`transcription.*`)

All transcription events are scoped to a fiche.

### `transcription.started`
- **Meaning**: fiche transcription workflow started.
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `total_recordings` (number)
  - `priority` (string)
  - `started_at` (ISO datetime string)
  - `status` = `"started"`

### `transcription.status_check`
- **Meaning**: a status check was performed (how many recordings still need transcription).
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `total_recordings` (number)
  - `already_transcribed` (number)
  - `needs_transcription` (number)
  - `is_complete` (boolean)
  - `status` = `"checked"`

### `transcription.recording_started`
- **Meaning**: one recording transcription started.
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `call_id` (string)
  - `recording_index` (number)
  - `total_to_transcribe` (number)
  - `recording_url` (string | optional)
  - `status` = `"processing"`

### `transcription.recording_completed`
- **Meaning**: one recording transcription completed.
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `call_id` (string)
  - `transcription_id` (string)
  - `recording_index` (number)
  - `total_to_transcribe` (number)
  - `status` = `"completed"`

### `transcription.recording_failed`
- **Meaning**: one recording transcription failed.
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `call_id` (string)
  - `error` (string)
  - `recording_index` (number)
  - `total_to_transcribe` (number)
  - `status` = `"failed"`

### `transcription.progress`
- **Meaning**: aggregate transcription progress for a fiche.
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `total_recordings` (number)
  - `transcribed` (number)
  - `pending` (number)
  - `failed` (number)
  - `progress_percentage` (number)
  - `status` = `"in_progress"`

### `transcription.completed`
- **Meaning**: fiche transcription completed (all recordings done).
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `total_recordings` (number)
  - `transcribed` (number)
  - `failed` (number)
  - `duration_seconds` (number)
  - `completed_at` (ISO datetime string)
  - `status` = `"completed"`

### `transcription.failed`
- **Meaning**: fiche transcription workflow failed (may include partial stats).
- **Channel(s)**: fiche
- **Payload**:
  - `fiche_id` (string)
  - `error` (string)
  - `failed_at` (ISO datetime string)
  - `status` = `"failed"`
  - `partial_results` (object | optional)
    - `total` (number)
    - `transcribed` (number)
    - `failed` (number)

---

## Batch events (`batch.*`)

Batch events are published to **global** and also to a **job channel** keyed by `batch_id`:

- `private-global`
- `private-job-{batch_id}`

### `batch.progress`
- **Meaning**: progress update for a batch operation.
- **Channel(s)**: job + global
- **Payload**:
  - `batch_id` (string)
  - `operation_type` (`"audit"` | `"transcription"`)
  - `total` (number)
  - `completed` (number)
  - `failed` (number)
  - `progress_percentage` (number)

### `batch.completed`
- **Meaning**: batch operation finished.
- **Channel(s)**: job + global
- **Payload**:
  - `batch_id` (string)
  - `operation_type` (`"audit"` | `"transcription"`)
  - `total` (number)
  - `completed` (number)
  - `failed` (number)
  - `duration_ms` (number)

---

## Notification event (`notification`)

Notifications are global.

### `notification`
- **Meaning**: generic UI notification (toast/snackbar-style).
- **Channel(s)**: global
- **Payload**:
  - `type` (`"success"` | `"error"` | `"info"` | `"warning"`)
  - `message` (string)
  - `description` (string | optional)
  - `duration` (number, ms)

---

## Progressive fetch job events (`fiches.progressive_fetch.*`)

These events report background caching/fetching of fiches by date range.

### `fiches.progressive_fetch.created`
- **Meaning**: background progressive fetch job created.
- **Channel(s)**: job
- **Payload**:
  - `jobId` (string)
  - `status` (string)
  - `startDate` (string, `YYYY-MM-DD`)
  - `endDate` (string, `YYYY-MM-DD`)
  - `progress` (number)
  - `completedDays` (number)
  - `totalDays` (number)
  - `totalFiches` (number)
  - `datesCompleted` (string[])
  - `datesRemaining` (string[])
  - `datesFailed` (string[])

### `fiches.progressive_fetch.progress`
- **Meaning**: job progress update after processing a date.
- **Channel(s)**: job
- **Payload**:
  - `jobId` (string)
  - `status` = `"processing"`
  - `startDate` (string, `YYYY-MM-DD`)
  - `endDate` (string, `YYYY-MM-DD`)
  - `progress` (number)
  - `completedDays` (number)
  - `totalDays` (number)
  - `totalFiches` (number)
  - `datesCompleted` (string[])
  - `datesRemaining` (string[])
  - `datesFailed` (string[])
  - `latestDate` (string, `YYYY-MM-DD`)

### `fiches.progressive_fetch.complete`
- **Meaning**: job finished successfully.
- **Channel(s)**: job
- **Payload**:
  - `jobId` (string)
  - `status` = `"complete"`
  - `startDate` (string, `YYYY-MM-DD`)
  - `endDate` (string, `YYYY-MM-DD`)
  - `progress` = `100`
  - `completedDays` (number)
  - `totalDays` (number)
  - `totalFiches` (number)
  - `datesCompleted` (string[])
  - `datesRemaining` (empty array)
  - `datesFailed` (string[])

### `fiches.progressive_fetch.failed`
- **Meaning**: job finished with failures.
- **Channel(s)**: job
- **Payload**:
  - `jobId` (string)
  - `status` = `"failed"`
  - `startDate` (string, `YYYY-MM-DD`)
  - `endDate` (string, `YYYY-MM-DD`)
  - `progress` = `100`
  - `completedDays` (number)
  - `totalDays` (number)
  - `totalFiches` (number)
  - `datesCompleted` (string[])
  - `datesRemaining` (empty array)
  - `datesFailed` (string[])



