## Project Brief: NCA AI Audit (Backend)

### What this repo is
- **Backend API + worker system** for the “NCA Audit” product.
- Serves a **Next.js frontend** and runs heavy background work via **Inngest**.

### Core goals
- **Fetch fiches** from the CRM and cache them (including recordings when needed).
- **Transcribe recordings** (ElevenLabs) and store full payloads in DB.
- **Run AI audits** (OpenAI GPT‑5.2 models) with strict evidence/citation handling.
- Provide **realtime updates** reliably across multiple backend replicas (SSE + webhooks).
- Support **automation schedules** (cron/timezone based) that trigger audits/transcriptions.

### Non‑negotiables (operational)
- Never commit real secrets; use placeholders.
- After substantial changes, run `npm run build` to ensure TypeScript is green.





