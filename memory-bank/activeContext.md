## Active Context

### Current focus
- Make heavy workflows **scale across replicas** and remain correct under retries.
- Ensure frontend receives reliable progress via **SSE + webhooks**.

### Recent changes (high impact)
- **Audit step-level fan-out**:
  - `audit/run` orchestrates prerequisites then dispatches `audit/step.analyze` events.
  - Each step worker stores results in DB; a finalizer completes the audit once all steps exist.
- **RLM-style transcript tools (optional)**:
  - Enabled per-request via `use_rlm: true` (or `useRlm: true`) on audit run endpoints (no env toggle).
  - The LLM uses constrained tools (`searchTranscript`, `getTranscriptChunks`) to find/quote evidence.
  - Existing deterministic **evidence gating** still validates citations against the transcript and downgrades unsupported claims.
- **Progressive fiche date-range fan-out**:
  - `fiches/progressive-fetch-continue` fans out per-day work.
  - Day workers emit processed events; a serialized updater updates/finalizes the job.
  - Added defensive “derived status” in job polling endpoints.
- **Automation run distribution**:
  - Replaced inline fiche detail fetching with distributed `fiche/fetch` fan-out.
  - Made fan-out event IDs deterministic to avoid duplicate dispatch on retries.
- **Operational hardening**:
  - Docker startup now runs `prisma migrate deploy` to prevent schema drift crashes (e.g., missing `audit_step_results.raw_result`).

### Next improvements (if needed)
- Batch audit tracking (optional): add explicit batch job state + progress aggregation.
- Reduce “long polling” in automation waits by switching to event-driven aggregation.





