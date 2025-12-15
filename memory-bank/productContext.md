## Product Context

### Problem this solves
- Call/fiche processing is heavy (fetching, transcription, LLM analysis) and must be **reliable**, **parallel**, and **observable**.
- Frontend needs **progressive data** (partial immediately, background completion) + **realtime progress**.

### How it should work (user-visible)
- **Fiches date range**: return cached data immediately; if missing dates exist, create a **background job** and stream progress (SSE) / optionally send webhooks.
- **Single audit**: one audit request triggers a workflow that runs multiple audit steps in parallel (bounded), then finalizes once all steps are stored.
- **Automation**: schedules trigger runs that select fiches, ensure details/recordings, optionally transcribe, then run audits.

### Realtime expectations
- Works across **multiple backend replicas** (no single-instance memory assumptions).
- Events are delivered through **Redis-backed streams** + SSE endpoints, and optionally through **webhooks** for Next.js server routes.





