# Authentication & Authorization Plan (JWT + RBAC) — 2026-01

**Repo**: `ai-audit` (Express + TS + Prisma + Postgres, ESM)  
**Goal**: add **real user authentication** (JWT access + refresh) and **in-app authorization** (roles/permissions) while preserving existing **optional** `API_AUTH_TOKEN(S)` machine auth.

---

## Current state (what exists today)

- **Optional machine auth**: `src/middleware/api-auth.ts`
  - Enabled only when `API_AUTH_TOKEN` or `API_AUTH_TOKENS` is set.
  - Accepts `Authorization: Bearer <token>` or `X-API-Key: <token>`.
  - Currently applied globally in `src/app.ts` to `/api*` (except `/api/inngest`).
- **Realtime**:
  - Pusher helpers + allowlisted channel names: `src/shared/pusher.ts`
  - Pusher auth endpoint: `POST /api/realtime/pusher/auth` (`src/modules/realtime/realtime.routes.ts`)
  - **No real user/org membership checks yet** (explicitly documented in code).
- **No** `User/Role/Permission` tables in Prisma yet (`prisma/schema.prisma`).

---

## Target security model

### Authentication (JWT)
- **Access token**: short-lived JWT (e.g. 10–15 minutes)
- **Refresh token**: long-lived, **rotating**, revocable (DB-backed)
- Tokens accepted from:
  - `Authorization: Bearer <access_token>` (primary)
  - optional cookie support (refresh token in HttpOnly cookie; access token via header)

### Authorization (RBAC)
- Users have **roles**
- Roles have **permissions** (string keys)
- Access token embeds:
  - `sub` = user id
  - `roles` = role keys
  - `permissions` = permission keys (computed at login/refresh)
- **Enforcement**:
  - `requireAuth()` for protected endpoints
  - `requirePermission("...")` for sensitive operations
  - Pusher channel auth requires user auth + per-channel authorization

---

## Decisions (defaults we will implement)

- **Password hashing**: use Node’s `crypto.scrypt` (no native deps; works on `node:20-alpine`)
- **JWT library**: use an ESM-friendly JWT implementation (avoid CJS friction)
- **Refresh tokens**:
  - Stored as **hash** in DB (token itself never stored)
  - Rotation on every refresh
  - Revocation on logout
- **Compatibility** with existing `API_AUTH_TOKEN(S)`:
  - Keep machine auth support.
  - Do not require machine token for `/api/auth/*`.
  - For other routes, allow either:
    - valid machine token OR valid user JWT (configurable by deployment via env).

---

## Permission matrix (v1)

### Core permissions
- **audits**
  - `audits.read`
  - `audits.run`
  - `audits.rerun`
- **audit-configs**
  - `audit-configs.read`
  - `audit-configs.write`
- **automation**
  - `automation.read`
  - `automation.run`
  - `automation.write` (schedules, notifications)
- **fiches**
  - `fiches.read`
  - `fiches.fetch` (trigger background jobs / refresh)
- **recordings**
  - `recordings.read`
- **transcriptions**
  - `transcriptions.read`
- **products**
  - `products.read`
  - `products.write`
- **chat**
  - `chat.use`
- **realtime**
  - `realtime.auth` (Pusher auth endpoint)
  - `realtime.test` (Pusher test endpoint)
- **admin**
  - `admin.users`
  - `admin.roles`
  - `admin.permissions`

### Default roles
- **admin**: all permissions
- **operator**: day-to-day operations (run/read audits, automation, fiches, chat, realtime)
- **viewer**: read-only

---

## Database changes (Prisma)

### New tables (minimum)
- `users`
- `roles`
- `permissions`
- `user_roles` (join)
- `role_permissions` (join)
- `refresh_tokens` (or sessions)

### Optional (later)
- `orgs`, `org_memberships` (multi-tenant)
- `audit_logs` (privileged actions)

---

## Backend API endpoints (v1)

### Public
- `POST /api/auth/login`
- `POST /api/auth/refresh`

### Authenticated
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Admin (requires `admin.*`)
- `POST /api/admin/users`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/roles`
- `POST /api/admin/roles/:roleId/permissions`

---

## Middleware & integration points

- Add `authContextMiddleware` (parses JWT, sets `req.auth`)
- Add guards:
  - `requireAuth()`
  - `requirePermission(key)`
- Update `src/app.ts`:
  - Mount `authRouter` at `/api/auth`
  - Keep existing routers; apply guards per router (or per route) based on matrix
- Update `src/modules/realtime/realtime.routes.ts`:
  - Require user auth for `/pusher/auth` and enforce channel authorization

---

## Seed / bootstrapping

- Add seed logic for:
  - default permissions + roles
  - initial admin user (env-driven), e.g.:
    - `AUTH_SEED_ADMIN_EMAIL`
    - `AUTH_SEED_ADMIN_PASSWORD`
- Ensure seed is idempotent (upsert).

---

## Environment variables (new)

- JWT:
  - `JWT_ISSUER`
  - `JWT_AUDIENCE`
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `AUTH_ACCESS_TTL_SECONDS` (default 900)
  - `AUTH_REFRESH_TTL_SECONDS` (default e.g. 2592000)
- Cookies (if enabled):
  - `AUTH_REFRESH_COOKIE_NAME` (default `refresh_token`)
  - `AUTH_COOKIE_SECURE` (default true in production)
  - `AUTH_COOKIE_SAMESITE` (default `lax`)
- Seed:
  - `AUTH_SEED_ADMIN_EMAIL`
  - `AUTH_SEED_ADMIN_PASSWORD`

---

## Test plan

- Auth flows:
  - login → me
  - refresh (rotation) → me
  - logout → refresh fails
- Authorization:
  - protected route returns 401 without token
  - forbidden route returns 403 without permission
- Realtime:
  - `/api/realtime/pusher/auth` rejects unauthorized channel subscriptions

---

## Rollout plan

- Phase A (additive): ship tables + auth endpoints + middleware (no route protection yet)
- Phase B: protect high-value endpoints (audit-configs, automation schedules, reruns)
- Phase C: secure Pusher auth per channel
- Phase D: tighten defaults (require auth for most `/api/*` routes used by frontend)

