# Environment variables

This repo uses **one canonical env template**: `.env.example`.

- **Local dev**: `cp .env.example .env`
- **Docker/VPS**: `cp .env.example .env.production` (or `.env`) then run Compose with `--env-file`

This document explains **what each variable does**, **what happens if it’s missing**, and **where to get it** (when applicable).

---

## Minimal setup (recommended)

### Local development (minimum)

- `DATABASE_URL` (and usually `DIRECT_URL`)
- `FICHE_API_BASE_URL` (and `FICHE_API_AUTH_TOKEN` if your gateway requires it)
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`

### Docker / production (minimum)

- Everything from local dev, plus typically:
- `INNGEST_DEV="0"`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_BASE_URL`
- `REDIS_URL` (required for some endpoints like batch audits; strongly recommended in prod)
- `PUSHER_*` (only if you want Pusher realtime; otherwise Pusher publishing is disabled)
- `WEBHOOK_ALLOWED_ORIGINS` (recommended SSRF allowlist when using outbound webhooks)

---

## Reference (by area)

## Runtime / server

### `NODE_ENV`
- **What it does**: Controls runtime mode (`"development"` vs `"production"`), affecting security defaults (e.g. webhook URL validation) and some dev behaviors.
- **If missing**: some components assume development defaults; you should set this explicitly in production.
- **Where to get it**: you choose the value (`"development"` locally, `"production"` in production).

### `PORT`
- **What it does**: HTTP port the Node server listens on.
- **If missing**: defaults depend on the runtime environment; most deployments should set it explicitly (commonly `3002`).
- **Where to get it**: you choose the value.

## Database

### `DATABASE_URL`
- **What it does**: Main Postgres connection string used by Prisma for all DB reads/writes.
- **If missing**: the server will fail to start or any DB access will throw.
- **Where to get it**:
  - Local Postgres: construct `postgresql://USER:PASSWORD@HOST:PORT/DB`
  - Hosted Postgres (Supabase / RDS / DO): copy the “connection string” from your provider.

### `DIRECT_URL`
- **What it does**: Optional “direct” Postgres connection string (useful with poolers/pgbouncer setups).
- **If missing**: Prisma will fall back to `DATABASE_URL` for direct connections.
- **Where to get it**: usually provided alongside `DATABASE_URL` by your Postgres provider (often the same value in simple setups).

---

## Fiche (CRM gateway)

### `FICHE_API_BASE_URL`
- **What it does**: Base URL for the CRM/gateway API used to fetch fiche details/sales lists.
- **If missing**: fiche endpoints, transcription prerequisites, and audits that need fiche data will fail.
- **Where to get it**: your internal gateway deployment URL (or your CRM API base URL).

### `FICHE_API_AUTH_TOKEN`
- **What it does**: Optional auth token sent to the gateway/CRM (when required).
- **If missing**:
  - If your gateway is public/unauthed: nothing.
  - If your gateway expects auth: upstream calls will fail (typically `401/403`).
- **Where to get it**: from your gateway/CRM system (the token/credential you provision there).

### `FICHE_SALES_INCLUDE_RECORDINGS`
- **What it does**: Controls whether sales-list fetches ask the gateway to include recordings metadata.
  - `"1"` = include recordings metadata in sales-list responses (recommended)
  - `"0"` = omit recordings metadata
- **If missing**: treated as `"0"` in Node runs (the code checks `=== "1"`). In Docker Compose prod files, it defaults to `"1"` via `${FICHE_SALES_INCLUDE_RECORDINGS:-1}`.
- **Where to get it**: you choose the value (it’s a behavior flag).

---

## Optional auth for this backend (API token)

### `API_AUTH_TOKEN`
- **What it does**: Enables a simple API token auth middleware for `/api/*` (except `/api/inngest`).
- **If missing**: API token auth is **disabled** (all API routes remain public unless you add other auth).
- **Where to get it**: you generate it (example: `openssl rand -hex 32`).

### `API_AUTH_TOKENS`
- **What it does**: Comma-separated list of valid tokens (supports rotation).
- **If missing**: only `API_AUTH_TOKEN` is considered (if set).
- **Where to get it**: you generate them (same as above).

---

## User authentication (JWT + RBAC)

This backend supports **user sessions** using:
- **Access token**: JWT, sent as `Authorization: Bearer <jwt>`
- **Refresh token**: DB-backed, **rotated** on refresh (cookie-friendly)

Auth endpoints:
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Admin endpoints (require permissions):
- `GET/POST/PATCH /api/admin/users...`
- `GET /api/admin/roles`
- `GET /api/admin/permissions`

### `JWT_ACCESS_SECRET`
- **What it does**: HMAC secret used to sign/verify JWT access tokens.
- **If missing**: JWT auth will fail (login/refresh/me will error).
- **Where to get it**: generate a random secret (example: `openssl rand -hex 32`).

### `JWT_ISSUER`
- **What it does**: JWT `iss` claim used to validate tokens.
- **If missing**: defaults to `"ai-audit"`.
- **Where to get it**: you choose the value (keep consistent across environments).

### `JWT_AUDIENCE`
- **What it does**: JWT `aud` claim used to validate tokens.
- **If missing**: defaults to `"ai-audit"`.
- **Where to get it**: you choose the value (keep consistent across environments).

### `AUTH_ACCESS_TTL_SECONDS`
- **What it does**: Access token TTL in seconds.
- **If missing**: defaults to 900 (15 minutes).
- **Where to get it**: you choose the value.

### `AUTH_REFRESH_TTL_SECONDS`
- **What it does**: Refresh token TTL in seconds.
- **If missing**: defaults to 2,592,000 (30 days).
- **Where to get it**: you choose the value.

### `AUTH_REFRESH_COOKIE_NAME`
- **What it does**: Cookie name used for refresh tokens (when using cookies).
- **If missing**: defaults to `"refresh_token"`.
- **Where to get it**: you choose the value.

### `AUTH_COOKIE_SECURE`
- **What it does**: Sets the refresh cookie `Secure` attribute.
- **If missing**: defaults to `true` in production, `false` otherwise.
- **Where to get it**: set to `"1"` in production when using HTTPS.

### `AUTH_COOKIE_SAMESITE`
- **What it does**: Sets the refresh cookie `SameSite` attribute (`lax|strict|none`).
- **If missing**: defaults to `"lax"`.
- **Where to get it**:
  - same-site frontend/backend: `"lax"` is usually OK
  - cross-site frontend/backend: use `"none"` **and** `AUTH_COOKIE_SECURE="1"`

### `AUTH_SEED_ADMIN_EMAIL` / `AUTH_SEED_ADMIN_PASSWORD`
- **What it does**: When set, `npm run seed` creates (or updates) an initial admin user and assigns the `admin` role.
- **If missing**: user seeding is skipped (roles/permissions are still created).
- **Where to get it**: you choose values (do not commit real credentials).

---

## AI (OpenAI / Anthropic)

### `OPENAI_API_KEY`
- **What it does**: Auth for OpenAI API calls (audits, chat, optional vector store).
- **If missing**: audits/chat will fail when they attempt an OpenAI call.
- **Where to get it**: OpenAI dashboard → API keys ([OpenAI API keys](https://platform.openai.com/api-keys)).

### `OPENAI_MODEL_AUDIT`
- **What it does**: Model name used for audit workloads.
- **If missing**: defaults to `"gpt-5.2"`.
- **Where to get it**: choose from OpenAI supported models ([OpenAI models](https://platform.openai.com/docs/models)).

### `OPENAI_MODEL_CHAT`
- **What it does**: Model name used for chat workloads.
- **If missing**: defaults to `OPENAI_MODEL` (if set) or `"gpt-5.2"`.
- **Where to get it**: choose from OpenAI supported models ([OpenAI models](https://platform.openai.com/docs/models)).

### `OPENAI_MODEL`
- **What it does**: Legacy fallback model name used by chat when `OPENAI_MODEL_CHAT` is not set.
- **If missing**: chat falls back to `"gpt-5.2"`.
- **Where to get it**: choose from OpenAI supported models ([OpenAI models](https://platform.openai.com/docs/models)).

### `OPENAI_TEMPERATURE_CHAT`
- **What it does**: Chat sampling temperature (lower = more deterministic).
- **If missing**: defaults to `0`.
- **Where to get it**: you choose the value.

### `OPENAI_MAX_TOKENS_CHAT`
- **What it does**: Max token budget for chat responses.
- **If missing**: defaults to `3000`.
- **Where to get it**: you choose the value.

### `ANTHROPIC_API_KEY`
- **What it does**: Reserved for Anthropic integration.
- **If missing**: no effect today (this backend currently doesn’t call Anthropic).
- **Where to get it**: Anthropic console (if/when you enable Anthropic usage).

---

## Audit correctness / anti-hallucination controls

### `AUDIT_EVIDENCE_GATING`
- **What it does**: Enables deterministic post-processing that validates citations against transcript chunks and downgrades unsupported “PRESENT” claims.
- **If missing**: defaults to enabled (`"1"` behavior). Set to `"0"` to disable.
- **Where to get it**: you choose the value (recommended to keep enabled).

### `AUDIT_EVIDENCE_MIN_QUOTE_CHARS`
- **What it does**: Minimum normalized quote length for a citation to be considered valid.
- **If missing**: defaults to `12`.
- **Where to get it**: you choose the value.

### `AUDIT_STEP_TIMELINE_EXCERPT`
- **What it does**: When enabled, step prompts include only an excerpt of the timeline to reduce context overflow.
- **If missing**: defaults to `"1"` in most Docker envs; in `.env.example` it’s set to `"1"`.
- **Where to get it**: you choose the value.

### `AUDIT_STEP_TIMELINE_MAX_CHUNKS`
- **What it does**: Max number of timeline chunks included in an excerpted prompt.
- **If missing**: defaults to `40`.
- **Where to get it**: you choose the value.

---

## Product verification (Vector Store)

### `PRODUCT_VECTORSTORE_FALLBACK`
- **What it does**: Enables optional fallback to OpenAI Vector Store for product matching/verification.
- **If missing**: defaults to `"0"` (off).
- **Where to get it**: you choose the value.

### `VECTOR_STORE_ID`
- **What it does**: OpenAI Vector Store ID (e.g. `vs_...`) used when vector store fallback is enabled.
- **If missing**: the code has a built-in default ID, but it may not exist in your OpenAI account — set this if you rely on vector store behavior.
- **Where to get it**: OpenAI dashboard where you manage vector stores (copy the `vs_...` ID).

### `VECTOR_STORE_MAX_RESULTS`
- **What it does**: Limits how many vector store hits are used per query.
- **If missing**: defaults to `5`.
- **Where to get it**: you choose the value.

---

## Transcription (ElevenLabs)

### `ELEVENLABS_API_KEY`
- **What it does**: Auth for ElevenLabs transcription API.
- **If missing**: transcription endpoints and automation transcription stages will fail when they try to call ElevenLabs.
- **Where to get it**: ElevenLabs dashboard → API keys ([ElevenLabs API keys](https://elevenlabs.io/app/settings/api-keys)).

### `TRANSCRIPTION_ELEVENLABS_RATE_LIMIT_PER_MINUTE`
- **What it does**: Global cap (per minute) for per-recording transcription workers (`transcription/recording.transcribe`) to avoid ElevenLabs `429 Too Many Requests`.
- **If missing**: defaults to `10`.
- **Where to get it**: you choose the value (depends on your ElevenLabs plan/quota).

### `TRANSCRIPTION_ELEVENLABS_MAX_ATTEMPTS`
- **What it does**: Maximum number of attempts per recording when ElevenLabs returns transient errors (429/5xx).
- **If missing**: defaults to `6`.
- **Where to get it**: you choose the value.

### `TRANSCRIPTION_ELEVENLABS_BACKOFF_BASE_SECONDS`
- **What it does**: Base backoff used between retry attempts after transient ElevenLabs errors.
- **If missing**: defaults to `2`.
- **Where to get it**: you choose the value.

### `TRANSCRIPTION_ELEVENLABS_BACKOFF_MAX_SECONDS`
- **What it does**: Maximum backoff cap used between retry attempts.
- **If missing**: defaults to `60`.
- **Where to get it**: you choose the value.

---

## Inngest (workflows orchestration)

### `INNGEST_DEV`
- **What it does**:
  - `"1"`: development mode (pairs well with `npm run inngest`)
  - `"0"`: production/self-hosted/cloud mode (uses event key; can use `INNGEST_BASE_URL` for self-hosted)
- **If missing**: treated as dev when `NODE_ENV=development`; otherwise treated as non-dev.
- **Where to get it**: you choose the value.

### `INNGEST_EVENT_KEY`
- **What it does**: Event auth key used to send events to Inngest.
- **If missing**:
  - In dev mode: typically OK (local dev server).
  - In non-dev mode: events will fail unless you’re using a setup that doesn’t require it (most do).
- **Where to get it**:
  - **Self-hosted**: you generate it (example: `openssl rand -hex 16`)
  - **Inngest Cloud**: from the Inngest dashboard.

### `INNGEST_SIGNING_KEY`
- **What it does**: Signing key used by the Inngest server to sign requests to your `/api/inngest` endpoint.
- **If missing/mismatched**: the Inngest server won’t be able to invoke your functions (signature verification fails).
- **Where to get it**:
  - **Self-hosted**: generate it (example: `openssl rand -hex 32`)
  - **Inngest Cloud**: from the Inngest dashboard.

### `INNGEST_BASE_URL`
- **What it does**: Base URL for a self-hosted Inngest server (example Docker: `http://inngest:8288`).
- **If missing**: the SDK will use Inngest Cloud base URL (requires working cloud credentials and outbound internet).
- **Where to get it**: your self-hosted Inngest URL (Docker internal service name, or external hostname).

### `INNGEST_POLL_INTERVAL`
- **What it does**: Used by the **self-hosted Inngest server** to periodically poll your SDK endpoint for new/changed functions.
- **If missing**: Docker Compose uses a safe default (`60s`) via `${INNGEST_POLL_INTERVAL:-60}`.
- **Where to get it**: you choose the value (seconds).

---

## Redis (coordination + cross-replica realtime)

### `REDIS_URL`
- **What it does**: Redis connection string used for coordination (locks/streams) and cross-replica realtime.
- **If missing**:
  - Some features will degrade or be disabled (the code returns `null` clients when Redis is not configured).
  - Some endpoints fail fast (example: `POST /api/audits/batch` returns `503` when Redis is not configured).
- **Where to get it**:
  - Local dev: `redis://localhost:6379`
  - Docker: `redis://redis:6379`
  - Hosted Redis: from your provider (Upstash, ElastiCache, etc.).

---

## Webhooks (SSRF protection)

### `WEBHOOK_ALLOWED_ORIGINS`
- **What it does**: Comma-separated allowlist of permitted webhook URL origins for **user-provided** webhook URLs (SSRF protection).
  - Example: `WEBHOOK_ALLOWED_ORIGINS="https://app.example.com,https://staging.example.com"`
- **If missing**:
  - In **development**, localhost-style URLs are allowed.
  - In **production**, localhost/private IPs are blocked; public hosts are allowed.
- **Where to get it**: you choose the value (should match your frontend/server endpoints that will receive webhooks).

---

## Pusher (optional realtime)

### `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`
- **What it does**: Enables Pusher Channels publishing for realtime updates.
- **If missing**: Pusher publishing is disabled (backend logs a warning once).
- **Where to get it**: Pusher Channels dashboard ([Pusher Channels](https://dashboard.pusher.com/)).

### `NEXT_PUBLIC_PUSHER_KEY`
- **What it does**: Optional fallback for the Pusher key if you share env with a Next.js frontend (the backend will use it if `PUSHER_KEY` is empty).
- **If missing**: backend uses `PUSHER_KEY`.
- **Where to get it**: same as `PUSHER_KEY`.

### `PUSHER_USE_PRIVATE_CHANNELS`
- **What it does**: Controls whether channel names are prefixed with `private-`.
- **If missing**: defaults to enabled (`"1"` behavior).
- **Where to get it**: you choose the value.

### `PUSHER_MAX_PAYLOAD_BYTES`
- **What it does**: Payload size guard (Pusher has tight message size limits). Payloads larger than this are truncated.
- **If missing**: defaults to `9000`.
- **Where to get it**: you choose the value.

### `PUSHER_DRY_RUN`
- **What it does**: If set to `"1"`, the backend logs events it *would* publish but does not call Pusher.
- **If missing**: defaults to `"0"` behavior (publishes normally).
- **Where to get it**: you choose the value.

---

## Automation + workflow tuning (advanced)

These are optional and safe to leave unset unless you’re tuning throughput or timeouts.

### Scaling baseline

### `INNGEST_PARALLELISM_PER_SERVER`
- **What it does**: Default parallelism per server instance.
- **If missing**: defaults to `10`.
- **Where to get it**: you choose the value.

### `INNGEST_SERVER_REPLICAS` / `SERVER_REPLICAS`
- **What it does**: Number of API server replicas (used to scale global concurrency caps).
- **If missing**: defaults to `1`.
- **Where to get it**: set it to match your deployment (Docker Compose `--scale server=N`).

### Global concurrency caps (across all replicas)
- **If missing**: defaults are derived from `INNGEST_PARALLELISM_PER_SERVER * INNGEST_SERVER_REPLICAS` (or `SERVER_REPLICAS`).
- **Where to get it**: you choose the values.

- `AUDIT_RUN_CONCURRENCY`: caps concurrent `audit/run` orchestrations across the whole cluster.
- `TRANSCRIPTION_FICHE_CONCURRENCY`: caps concurrent fiche-level transcription orchestrations.
- `FICHE_FETCH_CONCURRENCY`: caps concurrent fiche detail fetch fan-out workers.
- `AUDIT_STEP_WORKER_CONCURRENCY`: caps concurrent audit step worker executions (`audit/step.analyze`).
- `TRANSCRIPTION_RECORDING_WORKER_CONCURRENCY`: caps concurrent per-recording transcription workers.
- `TRANSCRIPTION_FINALIZER_CONCURRENCY`: caps concurrent transcription “finalizer” work.
- `BATCH_AUDIT_PROGRESS_CONCURRENCY`: caps concurrent batch progress updater work (Redis-backed).
- `PROGRESSIVE_FETCH_DAY_CONCURRENCY`: caps concurrent per-day progressive fiche fetch workers.

### Per-entity caps
- **If missing**: each has a conservative built-in default (commonly `1` or `10` depending on the key).
- **Where to get it**: you choose the values.

- `AUDIT_RUN_PER_FICHE_CONCURRENCY`: max concurrent audits per fiche (prevents duplicate parallel audits for the same fiche).
- `AUDIT_STEP_PER_AUDIT_CONCURRENCY`: max concurrent step workers for a single audit.
- `TRANSCRIPTION_RECORDING_PER_FICHE_CONCURRENCY`: max concurrent recording transcriptions for a single fiche.

### In-process parallelism (per server instance)
- **If missing**: defaults are derived from `INNGEST_PARALLELISM_PER_SERVER` (or safe constants in a few flows).
- **Where to get it**: you choose the values.

- `AUDIT_STEP_CONCURRENCY`: in-process parallelism inside the audit step analyzer (per Node instance).
- `TRANSCRIPTION_RECORDING_CONCURRENCY`: in-process parallelism for per-recording transcription work (per Node instance).
- `FICHE_SALES_CACHE_CONCURRENCY`: in-process parallelism for caching fiche sales summaries (used by sales-list/date revalidation flows).

### TTLs / internal tuning
- **If missing**: safe defaults are used.
- **Where to get it**: you choose the values.

- `TRANSCRIPTION_PROGRESS_WEBHOOK_FREQUENCY`: how often progress webhooks are emitted during long transcription runs (every N items).
- `TRANSCRIPTION_RUN_STATE_TTL_SECONDS`: Redis TTL for transcription run state.
- `TRANSCRIPTION_LOCK_TTL_MS`: distributed lock TTL for transcription fan-out coordination.
- `AUDIT_BATCH_STATE_TTL_SECONDS`: Redis TTL for batch audit progress state.

### Automation scheduler

#### `AUTOMATION_SCHEDULER_CRON`
- **What it does**: Cron schedule for the automation “scheduler tick”.
- **If missing**: defaults to every minute in most envs.
- **Where to get it**: you choose the value.

#### `AUTOMATION_SCHEDULER_WINDOW_MINUTES`
- **What it does**: “Due” detection window size (timezone-aware).
- **If missing**: defaults to `20`.
- **Where to get it**: you choose the value.

#### Automation run polling
- **If missing**: safe defaults are used.
- **Where to get it**: you choose the values.

- `AUTOMATION_FICHE_DETAILS_MAX_WAIT_MS`: max time automation waits for fiche details fan-out to complete before marking remaining fiches as failed.
- `AUTOMATION_FICHE_DETAILS_POLL_INTERVAL_SECONDS`: poll interval for fiche details completion checks.
- `AUTOMATION_TRANSCRIPTION_MAX_WAIT_MS`: max time automation waits for transcription completion.
- `AUTOMATION_TRANSCRIPTION_POLL_INTERVAL_SECONDS`: poll interval for transcription completion checks.
- `AUTOMATION_AUDIT_MAX_WAIT_MS`: max time automation waits for audit completion.
- `AUTOMATION_AUDIT_POLL_INTERVAL_SECONDS`: poll interval for audit completion checks.

#### Automation debug log file (optional)

##### `AUTOMATION_DEBUG_LOG_TO_FILE`
- **What it does**: When enabled, the `automation/run` orchestrator writes a plain-text debug log file to `./automation-debug-logs/automation-run-<RUN_ID>.txt` and appends every automation `log()` entry to it (level + message + metadata).
- **If missing**: defaults to disabled.
- **Where to get it**: you choose the value (`"1"` to enable, `"0"`/empty to disable).

#### Safety guard

##### `AUTOMATION_MAX_RECORDINGS_PER_FICHE`
- **What it does**: If > 0, ignores fiches whose `recordingsCount` exceeds the threshold (protects fan-out + provider quota).
- **If missing**: defaults to disabled (`0`).
- **Where to get it**: you choose the value.

---

## Email (optional SMTP)

If SMTP is not configured, email notifications are **skipped** (best-effort logging).

### `SMTP_HOST`
- **What it does**: SMTP server hostname.
- **If missing**: email notifications are disabled.
- **Where to get it**: your email provider SMTP settings.

### `SMTP_PORT`
- **What it does**: SMTP port (commonly `587` STARTTLS or `465` implicit TLS).
- **If missing**: defaults to `587`.
- **Where to get it**: your email provider SMTP settings.

### `SMTP_SECURE`
- **What it does**: `"1"` enables implicit TLS (usually port `465`).
- **If missing**: defaults to `"0"` (STARTTLS).
- **Where to get it**: your email provider SMTP settings.

### `SMTP_USER`, `SMTP_PASS`
- **What it does**: SMTP credentials.
- **If missing**: email notifications are disabled (or will fail auth).
- **Where to get it**: your email provider SMTP credentials (often “app passwords”).

### `SMTP_FROM`
- **What it does**: Sender address for notification emails.
- **If missing**: falls back to `SMTP_USER`.
- **Where to get it**: your email provider / verified sender configuration.

### `SMTP_TIMEOUT_MS`
- **What it does**: Network timeouts for SMTP connections.
- **If missing**: defaults to `10000` ms.
- **Where to get it**: you choose the value.

---

## Docker Compose port bindings (optional)

These control **host port bindings** in the production compose files.

- `SERVER_PORT`: host port for the API (defaults to `3002`)
- `INNGEST_PORT`: host port for the Inngest UI/API (defaults to `8288`)
- `INNGEST_CONNECT_PORT`: host port for Inngest Connect (defaults to `8289`)
- `REDIS_PORT`: host port for Redis (defaults to `6379`; in prod we bind to localhost)

