## Automation checklist (end-to-end)

This document is a **deep verification checklist** for the automation “autopilot” flow:

- Select fiches for a period (or manual list)
- Ensure **full fiche details** + **recordings** are cached
- Run **transcriptions**
- Run **audits**
- Finalize run + expose results (DB + realtime)

Primary implementation: `src/modules/automation/automation.workflows.ts` (`runAutomationFunction`).

---

## 1) What “working automation” means (definition of done)

An automation run is considered correct when, for the chosen selection:

- **Selection**: all intended fiches are included (no silent drops due to incomplete sales-list data).
- **Prerequisites**: each fiche is upgraded to **full details** (not sales-list-only).
- **Recordings**: if the fiche has recordings, DB has `recordings` rows and **`recordingUrl` is not blank**.
- **Transcription**: if configured, all recordings reach `hasTranscription=true` (or the fiche is marked failed).
- **Audits**: if configured, all requested audits are created and finish (`completed` or `failed`) and are linked to the automation run.
- **Run summary** is accurate: `successful`, `failed`, `ignored` match what actually happened.

---

## 2) Data model (what the automation relies on)

### 2.1 Core tables

- **`fiche_cache` (`FicheCache`)**
  - **`salesDate`**: the CRM date (“YYYY-MM-DD”) used by date-range selection.
  - **`rawData`**:
    - sales-list-only rows include `_salesListOnly=true`
    - full details rows include `success=true` and `information.fiche_id`
  - **`hasRecordings` / `recordingsCount`**: quick signals used during orchestration.
- **`recordings` (`Recording`)**
  - **`recordingUrl`**: required for transcription.
  - **`hasTranscription`**: primary completion signal for automation polling.
- **`audits` (`Audit`)**
  - **`status`**: `pending|running|completed|failed`
  - **`automationRunId` / `automationScheduleId`**: links audits to a specific automation run/schedule.

### 2.2 Important invariants

- **Date-range selection depends on `FicheCache.salesDate`.**
  - If fiches are cached without `salesDate`, the automation will not “see” them for that period.
- **Full details prerequisite depends on `FicheCache.rawData` not being sales-list-only.**
- **Transcription completion depends on `Recording.hasTranscription`, not on webhooks.**
- **Audit completion tracking should use `Audit.automationRunId` (not `createdAt` windows).**

---

## 3) End-to-end flow (what the code does)

### 3.1 Trigger

Event: `automation/run`

- Loads schedule config (`AutomationSchedule`)
- Creates a run row (`AutomationRun`) and marks schedule “running”

### 3.2 Selection (build the fiche list)

File: `src/modules/automation/automation.workflows.ts`

Modes:

- **manual**: uses `ficheIds` directly (after parsing/dedup).
- **date_range / filter**:
  - Computes dates via `automationService.calculateDatesToQuery()`
  - Revalidates sales list cache for those dates (sales summary caching)
  - Reads DB range via `getFichesByDateRangeWithStatus(startDate, endDate)`
  - Applies **safe prefilters** (only those that won’t silently drop unknown data)

Key rule:

- **Do not enforce `onlyWithRecordings` or strict group filtering before full details.**
  - Sales list rows can be incomplete; full details is authoritative.

### 3.3 Prerequisite 1: full fiche details (distributed)

Event fan-out: `fiche/fetch` for each fiche ID.

Worker: `src/modules/fiches/fiches.workflows.ts` (`fetchFicheFunction`)

Cache rules:

- If cache is missing/expired/sales-list-only/incomplete, fetch full details and store:
  - `fiche_cache.rawData` (full details)
  - `recordings` rows (if present)

Automation waits by polling `fiche_cache` until all fiches are “full details” or timeout/stall.

### 3.4 Post-fetch filters (authoritative stage)

After full details are present, the automation can safely enforce:

- **`groupes`**: now `FicheCache.groupe` is reliable.
- **`onlyWithRecordings`**: now recordings signals are reliable.
- **`maxRecordingsPerFiche`**: ignore fiches that would explode fan-out/provider quota.

### 3.5 Prerequisite 2: transcription (distributed)

Event fan-out: `fiche/transcribe` for each fiche with recordings.

Worker: `src/modules/transcriptions/transcriptions.workflows.ts` (`transcribeFicheFunction`)

- Plans work from DB (`ficheCache.recordings`)
- Fans out per recording (`transcription/recording.transcribe`)
- Recording worker writes transcription back to DB (`Recording.hasTranscription=true`)
- Automation waits by polling DB for completion

### 3.6 Audits (distributed)

Event fan-out: `audit/run` for each `(fiche, config)` pair.

Worker: `src/modules/audits/audits.workflows.ts` (`runAuditFunction`)

- Ensures fiche cached (invokes `fetchFicheFunction` if needed)
- Ensures transcription (invokes `transcribeFicheFunction` if needed)
- Creates audit row linked to `automationRunId`
- Fans out step workers; finalizer completes audit async

Automation waits by polling audits linked to `automationRunId`.

---

## 4) Scenario matrix (all important combinations)

### 4.1 Selection scenarios

- **manual**
  - Expected: exact fiches list processed.
  - Risk: fiche not cached -> must be fetched by `fiche/fetch`.
- **date_range**
  - Expected: all fiches whose `salesDate` is within range are included.
  - Risk: missing `salesDate` on cached fiches will cause silent omissions.
- **filter**
  - Same as date_range but with additional constraints (group/unaudited/etc).

### 4.2 Filtering scenarios

- **`groupes`**
  - Best practice: prefilter only when groupe is already known, but finalize filter only after `fiche/fetch`.
- **`onlyWithRecordings`**
  - Must be enforced after `fiche/fetch` (sales list can lie or omit recordings).
- **`onlyUnaudited`**
  - Uses DB audit status; can be applied early (doesn’t depend on full details).

### 4.3 Execution toggles

- **runTranscription=false, runAudits=true**
  - `audit/run` will still trigger transcription if needed; expect longer audits and more provider usage.
- **runTranscription=true, skipIfTranscribed=true**
  - Only fiches whose recordings are not fully transcribed should be enqueued.
- **runAudits=false**
  - Automation should stop after transcription stage (or after fiche fetch if transcription is also disabled).

### 4.4 Failure behavior

- **continueOnError=true**
  - Expected: failures don’t block remaining fiches.
- **continueOnError=false**
  - Expected: any failures in a stage block subsequent stages.
- **retryFailed=true + maxRetries>0**
  - Expected: when progress stalls, the automation should re-trigger missing prerequisite work (especially fiche fetch + transcription).

---

## 5) Verification checklist (step-by-step)

### 5.1 Selection correctness

- **Check `salesDate` coverage**
  - Verify fiches in the range have `fiche_cache.sales_date` set.
- **Check no silent drops**
  - If `groupes` is enabled, confirm fiches with unknown group are not dropped *before* `fiche/fetch`.

### 5.2 Fiche details correctness

For a sample fiche in the run:

- `fiche_cache.raw_data._salesListOnly` must be absent/false
- `fiche_cache.raw_data.success === true`
- `fiche_cache.raw_data.information.fiche_id` matches `fiche_cache.fiche_id`
- If recordings exist:
  - `recordings` rows exist
  - `recordings.recording_url` is not empty

### 5.3 Transcription correctness

For each fiche with recordings:

- `Recording.hasTranscription=true` for all recordings
- If not:
  - confirm the failure reason is recorded (missing URL, provider errors, etc.)
  - confirm automation run marks fiche as failed (not “completed”)

### 5.4 Audit correctness

- Ensure audits are linked to the run:
  - `audits.automation_run_id = <AutomationRun.id>`
- For each config requested:
  - exactly one **latest** audit (`isLatest=true`) per `(fiche, config)` should exist for the run
  - audit eventually reaches `completed` or `failed`

---

## 6) Common failure modes (and what to check first)

### 6.1 “Automation didn’t process all fiches in the period”

Most common causes:

- Missing `salesDate` for cached fiches
- Over-aggressive early filtering (group / recordings) before full details exist
- Fan-out too large (events sent in one huge batch)

### 6.2 “Automation didn’t launch all `fiche/fetch` / `fiche/transcribe` / `audit/run`”

Most common causes:

- Fan-out arrays too big for a single send
- Long-running upstream API calls leading to timeouts/stalls without retries

### 6.3 “Audits never counted as finished”

Most common causes:

- Polling logic using `createdAt` windows rather than `automationRunId`
- Audits failing before creating an audit DB record

---

## 7) Where to look in code (quick map)

- **Automation orchestrator**: `src/modules/automation/automation.workflows.ts`
- **Fiche detail fetch worker**: `src/modules/fiches/fiches.workflows.ts` (`fetchFicheFunction`)
- **Sales-list caching**: `src/modules/fiches/fiches.cache.ts` (`cacheFicheSalesSummary`)
- **Transcription orchestrator/worker/finalizer**: `src/modules/transcriptions/transcriptions.workflows.ts`
- **Audit orchestrator/steps/finalizer**: `src/modules/audits/audits.workflows.ts`

