# Workflow reliability — verification checklist (stuck → fixed)

**Scope**: verify (and debug) automation runs in the **scaled Docker** setup (multiple `server` replicas behind nginx `lb`, self-hosted Inngest), using:

- **Workflow logs** (preferred): `workflow_logs` via `/api/*/logs` endpoints when `WORKFLOW_LOG_DB_ENABLED=1`
- **DB status** (always): `automation_runs`, `automation_logs`, `automation_run_fiche_results`, `fiche_cache`, `recordings`, `audits`

This checklist is meant to cover: **reproduce a “stuck” run → apply fixes → prove it’s fixed**.

---

## 0) Preconditions (make the system observable)

### 0.1 Confirm the deployment topology

- Scaled stack: `docker-compose.prod.scale.yml`
- API base URL (LB): `http://localhost:${SERVER_PORT:-3002}`
- Inngest UI: `http://localhost:${INNGEST_PORT:-8288}` (often bound to localhost in VPS setups; use SSH tunnel if needed)

### 0.2 Enable workflow logs in DB (recommended)

To make “what happened where?” debuggable across replicas:

- Set `WORKFLOW_LOG_DB_ENABLED=1`
- Ensure migrations are applied (Docker startup already runs `prisma migrate deploy`)

If DB workflow logs are disabled, `/api/*/logs` endpoints will return `data: []` (you can still use `automation_logs` + stdout).

### 0.3 Optional: write per-run log files

- `AUTOMATION_DEBUG_LOG_TO_FILE=1` writes `./automation-debug-logs/automation-run-<RUN_ID>.txt`
- `WORKFLOW_DEBUG_LOG_TO_FILE=1` (or per-workflow flags like `TRANSCRIPTION_DEBUG_LOG_TO_FILE=1`) writes `./workflow-debug-logs/*.txt`

Note: in multi-replica deployments, fan-out workers may run on different containers, so file logs are best-effort and are less complete than DB workflow logs.

---

## 1) Baseline: pick a “stuck” automation run

### 1.1 Identify a run id

**Option A (API)**:

- `GET /api/automation/schedules/:id` and find a recent run with `status="running"`
- `GET /api/automation/schedules/:id/runs?limit=...&offset=...`

**Option B (DB)**:

```sql
select id, schedule_id, status, started_at
from automation_runs
where status = 'running'
order by started_at asc
limit 20;
```

### 1.1.1 (Optional) Reproduce the “404 fiche → stuck gate” case on demand

This is the quickest end-to-end reproduction for “a terminal fiche blocks the whole run”.

1) Find a fiche id that is missing upstream:

- `GET /api/fiches/<FICHE_ID>?refresh=true`
  - **expected**: HTTP `404` with `code=NOT_FOUND`
  - note: `refresh=true` requires `fiches.write`

2) Trigger an automation run that includes the fiche (manual override).

Use a **test schedule** id (requires `automation.write`):

```http
POST /api/automation/trigger
Content-Type: application/json

{
  "scheduleId": "<SCHEDULE_ID>",
  "overrideFicheSelection": {
    "mode": "manual",
    "ficheIds": ["<FICHE_ID>"]
  }
}
```

3) Capture the created `run_id` and follow the rest of this checklist to prove:

- **pre-fix**: run can stall until `AUTOMATION_*_MAX_WAIT_MS`
- **fixed**: run finishes deterministically and records a terminal outcome for the fiche

### 1.2 Capture the baseline evidence (logs + status)

**API**:

- `GET /api/automation/runs/:id`
- `GET /api/automation/runs/:id/logs?level=debug`

**DB (automation logs)**:

```sql
select level, timestamp, message, metadata
from automation_logs
where run_id = <RUN_ID>
order by timestamp asc;
```

**Workflow logs (DB + API, if enabled)**:

Workflow logs live in `workflow_logs` and are most useful for the *child* workflows once you have a `fiche_id` or an `audit_db_id`:

- **Transcription logs**: `GET /api/transcriptions/:fiche_id/logs`
- **Audit logs**: `GET /api/audits/:audit_id/logs` (note: `audit_id` here is the **audit DB id**)

---

## 2) Identify which stage is “stuck” (from the run logs)

In `automation_logs` you should be able to classify the stall into one of:

- **Fiche details**: look for “Fiche details progress”
- **Transcription**: look for “Transcription progress”
- **Audits**: look for “Audit progress”

Once you know the stage, use the matching **completion signal** below.

---

## 3) Fiche details stage — verify completion and diagnose stalls

### 3.1 Completion signal

Automation considers a fiche “ready” when full details exist (i.e. it is **not** sales-list-only / incomplete).

**API spot check**:

- `GET /api/fiches/:fiche_id/status`
- `GET /api/fiches/:fiche_id/cache`

**DB spot check** (useful fields):

```sql
select fiche_id,
       sales_date,
       details_success,
       details_message,
       updated_at
from fiche_cache
where fiche_id = '<FICHE_ID>';
```

### 3.2 Reproduce / confirm the 404-not-found case (the “terminal skip” test)

Pick a fiche that is missing upstream:

- `GET /api/fiches/<FICHE_ID>?refresh=true`
  - **expected**: HTTP `404` with `code=NOT_FOUND`

If this returns 404, it is a good “terminal” test input.

### 3.3 “Stuck before fix” vs “Fixed” (expected behavior)

**Stuck (pre-fix) indicators**:

- Automation logs repeatedly show fiche details progress but **never shrink the waiting set**
- Stdout / worker logs (and optionally workflow logs) show a terminal error like:
  - `NonRetriableError: Fiche <FICHE_ID> not found`
- Run stays `status="running"` until `AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS` (or later stages) time out.

**Fixed indicators (target behavior)**:

- A 404 fiche becomes **terminal** and stops blocking the run:
  - `fiche_cache.details_success=false`
  - `fiche_cache.details_message` carries a stable marker (e.g. `NOT_FOUND`)
  - `automation_run_fiche_results` contains a row for that fiche with `status="failed"` and a clear error message (e.g. “Fiche not found (404)”)
- Automation run completes with `status="completed"` or `status="partial"` (not “running forever”).

**DB verification**:

```sql
select fiche_id, status, error, ignore_reason, recordings_count
from automation_run_fiche_results
where run_id = <RUN_ID>
order by fiche_id asc;
```

---

## 4) Transcription stage — verify completion and diagnose stalls

### 4.1 Completion signal

Automation treats transcription as complete when **all targeted recordings** have `has_transcription=true` (or the fiche is terminal/failed and excluded).

**API**:

- `GET /api/transcriptions/:fiche_id/status`
- (optional) `GET /api/transcriptions/:fiche_id/logs`

**DB**:

```sql
select fiche_id,
       count(*) as total_recordings,
       count(*) filter (where has_transcription) as transcribed_recordings
from recordings
where fiche_id = '<FICHE_ID>'
group by fiche_id;
```

### 4.2 What “fixed” looks like for terminal fiches

If fiche details are terminal (e.g. NOT_FOUND), transcription should **not** keep re-dispatching for that fiche and should not keep it in the waiting set.

---

## 5) Audit stage — verify completion and diagnose stalls

### 5.1 Completion signal

Automation polls audits created for the run (`audits.automation_run_id=<RUN_ID>`) until they reach `completed|failed` (or the fiche is terminal).

**API**:

- `GET /api/audits?automation_run_ids=<RUN_ID>&latest_only=false`
- `GET /api/audits/grouped?group_by=status&automation_run_ids=<RUN_ID>`

**DB**:

```sql
select status, count(*) as count
from audits
where automation_run_id = <RUN_ID>
group by status
order by status;
```

---

## 6) Scheduler recovery (“not stuck” guarantee)

After a run finishes, the schedule should no longer be considered running.

**DB**:

```sql
select id, is_active, last_run_at, last_run_status, updated_at
from automation_schedules
where id = <SCHEDULE_ID>;
```

**Expected**:

- `last_run_status` is updated to `completed|partial|failed` (or equivalent status string)
- Subsequent scheduler ticks can trigger the next run as due

If `last_run_status` stays `"running"` after the run is terminal, the scheduler will keep skipping it and you’ll see “already running” behavior.

---

## 7) Scaled Docker sanity: Inngest ↔ LB connectivity (operational check)

This is a common cause of “runs don’t progress” in scaled setups.

### 7.1 Symptoms

- Inngest container logs show DNS errors like `lookup lb ... no such host`
- Or repeated `502` while invoking the SDK URL (`http://lb/api/inngest`)

### 7.2 Evidence

- **No workflow logs** for expected fan-out work (because invocations never reached the SDK)
- Stdout logs show errors at the Inngest layer rather than within workflow functions

### 7.3 What to check

- All services share the same compose network (`ai-audit-network`)
- `inngest` is using the intended SDK URL:
  - `inngest start --sdk-url http://lb/api/inngest --poll-interval ...`
- The nginx LB proxy is configured to retry upstreams for `/api/inngest` (see `deploy/nginx-lb.conf`)

---

## 8) Operational knobs (timeouts, rate limits, replicas)

This section is the “quick reference”. Full reference lives in `docs/env.md`.

### 8.1 Replicas

- Scale API servers:

```bash
docker compose -f docker-compose.prod.scale.yml up -d --build --scale server=3
```

- Keep these in sync with the actual scale:
  - `SERVER_REPLICAS` (used for cluster-wide concurrency derivation)
  - `INNGEST_SERVER_REPLICAS` / `INNGEST_PARALLELISM_PER_SERVER` (see `docs/env.md`)

**Why it matters**: many global concurrency defaults are derived from:
\[
INNGEST\_PARALLELISM\_PER\_SERVER \times INNGEST\_SERVER\_REPLICAS
\]
If replicas are overstated, you may exceed provider quotas; if understated, throughput is unnecessarily low.

### 8.2 Automation timeouts (stage gates)

These control “how long a run may wait” before marking remaining work as failed and finishing deterministically:

- `AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS`
- `AUTOMATION_FICHE_DETAILS_POLL_INTERVAL_SECONDS`
- `AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS`
- `AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS`
- `AUTOMATION_AUDIT_MAX_WAIT_MS`
- `AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS`

### 8.3 Rate limits / provider throttles

ElevenLabs transcription throttling:

- `TRANSCRIPTION_ELEVENLABS_RATE_LIMIT_PER_MINUTE`
- `TRANSCRIPTION_ELEVENLABS_MAX_ATTEMPTS`
- `TRANSCRIPTION_ELEVENLABS_BACKOFF_BASE_SECONDS`
- `TRANSCRIPTION_ELEVENLABS_BACKOFF_MAX_SECONDS`

Cluster-wide concurrency caps (use these to enforce “soft rate limits” across replicas):

- `FICHE_FETCH_CONCURRENCY`
- `TRANSCRIPTION_RECORDING_WORKER_CONCURRENCY`
- `AUDIT_STEP_WORKER_CONCURRENCY`
- (and others listed in `docs/env.md`)

### 8.4 LB / proxy timeouts (nginx)

In scaled Docker, nginx config is part of “timeouts” too (see `deploy/nginx-lb.conf`):

- `/api/inngest`: `proxy_read_timeout 3600s` + fast upstream failover on `502/503/504`
- `/api/realtime/*` (SSE): buffering off + long read/send timeouts

---

## Appendix: “one shot” DB triage queries

### A.1 Oldest running automation runs

```sql
select id, schedule_id, status, started_at
from automation_runs
where status = 'running'
order by started_at asc
limit 20;
```

### A.2 Per-fiche outcomes for a run

```sql
select fiche_id, status, error, ignore_reason, recordings_count
from automation_run_fiche_results
where run_id = <RUN_ID>
order by fiche_id asc;
```

### A.3 Workflow logs for a fiche (if enabled)

```sql
select created_at, workflow, level, function_id, step_name, message, data
from workflow_logs
where workflow = 'transcription'
  and entity_type = 'fiche'
  and entity_id = '<FICHE_ID>'
order by created_at asc
limit 500;
```

### A.4 Workflow logs for an audit (if enabled)

```sql
select created_at, workflow, level, function_id, step_name, message, data
from workflow_logs
where workflow = 'audit'
  and trace_id = '<AUDIT_DB_ID>'
order by created_at asc
limit 500;
```

