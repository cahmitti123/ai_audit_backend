## Backend implementation summary (for frontend project concept)

**Repo**: `ai-audit` (Express + TypeScript + Prisma/Postgres)  
**Last updated**: 2026-02  
**Goal of this doc**: give a *frontend-friendly*, end-to-end explanation of what was implemented on the backend (AuthN/AuthZ + CRM linking + scope enforcement + realtime), and how the frontend should integrate.

Related canonical docs (more detailed, more “contract-like”):
- `docs/BACKEND_FRONTEND_CONTRACT.md` (API contract + payload examples)
- `docs/api.md` (endpoint index + integration notes)
- `docs/FRONTEND_PUSHER_EVENTS.md` (Pusher channels/events/payloads)
- `docs/env.md` (env vars, including auth + seeding)

---

## 1) What we implemented (high level)

- **JWT authentication**:
  - Access token in `Authorization: Bearer <jwt>`
  - Refresh token as an **opaque token** stored in DB *hashed* and delivered via **HttpOnly cookie**
  - Refresh token rotation + revocation on logout
- **Dynamic RBAC (roles/permissions)** with **per-permission grants**:
  - Each permission grant has:
    - `read: boolean`
    - `write: boolean`
    - `read_scope` / `write_scope`: `SELF | GROUP | ALL`
- **CRM user linking + “team = groupe” concept**:
  - App user is linked to a CRM user via `crm_user_id`
  - App user belongs to one or more CRM groups (“groupes”) via `teams` membership
- **One-click user creation from CRM users**:
  - Admin can create/link an app user from CRM users
  - Newly created users can be **INVITED** and set their password on first login
- **Visibility scope enforcement across all fiche-linked data**:
  - A user only sees **fiches/audits/recordings/transcriptions/chat/realtime** that match their scope (`SELF|GROUP|ALL`)
- **Realtime access enforcement**:
  - Pusher private channel auth now requires JWT + RBAC permission and checks entity scope.

### Response conventions (envelope + BigInt)

- **Most REST endpoints** respond with a standard envelope:
  - **Success**: `{ "success": true, "data": <payload> }`
  - **Error**: `{ "success": false, "error": "<message>", "code"?: "<ERROR_CODE>" }`
- **BigInt IDs** (users, roles, audits, messages, etc.) are serialized as **strings** in JSON.
- **Intentional exceptions** (not wrapped in `{ success: true, data: ... }`):
  - **Chat streaming** endpoints respond as `text/event-stream` (SSE-style stream).
  - **Pusher auth** endpoint must return the **raw Pusher auth payload** (Pusher requirement).
  - Some **fiches/CRM-shaped** endpoints may return legacy shapes directly (see `docs/BACKEND_FRONTEND_CONTRACT.md`).

---

## 2) HTTP auth boundary (what requires auth)

In `src/app.ts` the backend mounts routers so that **all app APIs require authentication** at the router level:

- **Public**:
  - `/api/auth/*` (login/refresh/logout/me/invite accept)
  - `/api/inngest` (Inngest SDK endpoint)
  - `/health`
  - `/api-docs`, `/api-docs.json`
- **Auth required** (all of these are wrapped with `requireAuth()`):
  - `/api/admin/*`
  - `/api/fiches/*`
  - `/api/recordings/*`
  - `/api/transcriptions/*`
  - `/api/audit-configs/*`
  - `/api/audits/*` (including rerun routes)
  - `/api/automation/*`
  - `/api/products/*`
  - `/api/realtime/*`
  - `/api/*` chat routes

Important implementation detail:
- The backend supports an optional **machine API token** (if configured) and treats it as a trusted caller. The **frontend app** should use **user JWTs**.
- `POST /api/realtime/pusher/auth` explicitly requires a **user JWT** (not a machine token), because it authenticates a *user* to private channels.

---

## 3) Authentication (JWT + refresh token)

### 3.1 Tokens

- **Access token**: short-lived JWT signed with `JWT_ACCESS_SECRET`
- **Refresh token**: long-lived opaque token
  - Stored **hashed** in `refresh_tokens.token_hash`
  - Rotated on every refresh (old token revoked, new token minted)

### 3.2 Cookies

Refresh token is set as an **HttpOnly cookie** on:
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/invite/accept`

Cookie defaults:
- cookie name: `AUTH_REFRESH_COOKIE_NAME` (default `refresh_token`)
- `path: "/api/auth"`
- `secure` defaults to `true` in production (can be overridden via `AUTH_COOKIE_SECURE`)
- `sameSite` is controlled via `AUTH_COOKIE_SAMESITE` (`lax|strict|none`)

Cross-site + CORS notes (critical for frontend):
- **CORS allowlist**: the backend’s CORS config in `src/app.ts` must include your frontend origin. If your frontend URL is not in the allowlist, the browser will block requests and/or drop cookies.
- **Cross-site cookies**: if frontend and backend are on different “sites” (different registrable domains), set:
  - `AUTH_COOKIE_SAMESITE="none"`
  - `AUTH_COOKIE_SECURE="1"`
  - and use HTTPS (required for `SameSite=None` cookies)

Frontend implication:
- For `/api/auth/*` calls, use `credentials: "include"` so the refresh cookie is stored and sent.

### 3.3 Auth endpoints (frontend usage)

Auth responses are wrapped in the standard envelope: `{ success: true, data: ... }`.

- **`POST /api/auth/login`**
  - Input: `{ email, password }`
  - Output (`data`): `{ access_token, token_type: "Bearer", expires_in, user }`
  - Side effect: sets refresh cookie

- **`POST /api/auth/refresh`**
  - Input: optional `{ refresh_token }` (not required if cookie exists)
  - Output (`data`): `{ access_token, token_type, expires_in, user }`
  - Side effect: rotates refresh cookie

- **`POST /api/auth/logout`**
  - Input: optional `{ refresh_token }` (not required if cookie exists)
  - Side effect: revokes token + clears cookie
  - Output (`data`): `{ logged_out: true }`

- **`POST /api/auth/invite/accept`**
  - Input: `{ invite_token, password }`
  - Output (`data`): `{ access_token, token_type, expires_in, user }`
  - Side effect: sets refresh cookie

- **`GET /api/auth/me`**
  - Requires `Authorization: Bearer <access_token>`
  - Returns the latest user snapshot from DB (roles/permissions/team membership)
  - Output (`data`): `{ user: <AuthUserDto> }`

Example (login / refresh / invite accept response shape):

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 900,
    "user": {
      "id": "1",
      "email": "admin@example.com",
      "crm_user_id": "349",
      "groupes": ["NCA R1"],
      "roles": ["admin"],
      "permissions": [
        { "key": "audits", "read": true, "write": true, "read_scope": "ALL", "write_scope": "ALL" }
      ]
    }
  }
}
```

### 3.4 User status + invite behavior

- Users have a `status`: `INVITED | ACTIVE | DISABLED`
- **`ACTIVE`** users with a password can use `/login`.
- **`INVITED`** users cannot log in; they must set a password via `POST /api/auth/invite/accept`.
- **`DISABLED`** users are blocked from normal auth flows.

`invite/accept` behavior:
- Invite tokens are one-time and stored only as a **hash** in DB (with `expiresAt` and `usedAt`).
- Accepting an invite sets the user password and flips status to `ACTIVE`, then returns a normal session.

---

## 4) Authorization (RBAC) + permission grants

### 4.1 Base permission keys (what you see in JWT + `/me`)

Permissions are stored and granted as **base keys** (not suffix keys):

- `fiches`
- `audits`
- `audit-configs`
- `automation`
- `recordings`
- `transcriptions`
- `products`
- `chat`
- `realtime`
- `admin.users`
- `admin.roles`
- `admin.permissions`

### 4.2 PermissionGrant shape returned to the frontend

The backend returns **effective grants** computed from all assigned roles:

```ts
type PermissionScope = "SELF" | "GROUP" | "ALL";

type PermissionGrant = {
  key: string;
  read: boolean;
  write: boolean;
  read_scope: PermissionScope;
  write_scope: PermissionScope;
};
```

Merge rules (when multiple roles give the same permission key):
- `read` is true if **any** role grants read
- `write` is true if **any** role grants write
- scope takes the **most permissive** one per action: `ALL > GROUP > SELF`

### 4.3 Route-level permission checks (suffix convention)

Backend guards use a helper `requirePermission("...")` that accepts suffixes like:
- `.read`, `.write`, `.run`, `.rerun`, `.fetch`, `.use`, `.auth`, `.test`

Those suffixes are mapped to:
- base key = everything before the suffix
- action = `read` or `write`

Example:
- `requirePermission("audits.read")` checks `key="audits"` and `grant.read === true`
- `requirePermission("audits.run")` checks `key="audits"` and `grant.write === true`

Frontend implication:
- UI can simply use the base-key grants (`read/write`) and doesn’t need to reproduce suffix mapping.

### 4.4 Admin APIs to manage RBAC (roles + permissions)

These endpoints power an “Admin → Roles/Permissions” UI.

- **List permissions** (for building role editors)
  - `GET /api/admin/permissions` (requires `admin.permissions.read`)
  - Returns all known permission keys (base keys) + descriptions.

- **List roles**
  - `GET /api/admin/roles` (requires `admin.roles.read`)
  - Returns each role with:
    - `permissions: string[]` (legacy-style list of keys)
    - `permission_grants: Array<{ key, read, write, scope }>` (the real source of truth)
  - Optional: fetch one role by id
    - `GET /api/admin/roles/:roleId` (requires `admin.roles.read`)

- **Create role**
  - `POST /api/admin/roles` (requires `admin.roles.write`)
  - Body supports:
    - `permission_grants` (**recommended**): `[{ key, read, write, scope: "SELF"|"GROUP"|"ALL" }, ...]`
    - `permission_keys` (**legacy/back-compat**): `["audits.read", "audits.run", ...]`
      - Backend infers read/write from the suffix and defaults `scope` to **GROUP**.

- **Update role**
  - `PATCH /api/admin/roles/:roleId` (requires `admin.roles.write`)
  - Same `permission_grants` / `permission_keys` behavior as create.

- **Delete role**
  - `DELETE /api/admin/roles/:roleId` (requires `admin.roles.write`)
  - Safety rules:
    - Protected roles (`admin`, `operator`, `viewer`) cannot be deleted.
    - A role assigned to users cannot be deleted until it’s unassigned (prevents accidentally locking users out).

Important:
- In the DB, a role-permission row stores a single `scope`.  
  Effective grants expose `read_scope` and `write_scope` after merging multiple roles.
- `:roleId` is the **numeric role id** (BigInt serialized as string), not the role key.

### 4.5 Admin APIs to manage users

- `GET /api/admin/users` (requires `admin.users.read`)
- `POST /api/admin/users` (requires `admin.users.write`)
  - Body: `{ email, password, role_keys?: string[] }`
- `PATCH /api/admin/users/:userId` (requires `admin.users.write`)
  - Body can update: `{ status?: "INVITED"|"ACTIVE"|"DISABLED", password?: string, role_keys?: string[] }`
  - `:userId` is the **numeric user id** (BigInt serialized as string).

### 4.6 Admin APIs to manage teams / groupes (app-side)

Why this exists:
- **GROUP scope** is enforced using the authenticated user’s `groupes[]`, which comes from the user’s `UserTeam` memberships.
- Teams here are the app-side representation of “groupes” (usually synced from CRM).

Endpoints:
- `GET /api/admin/teams?include_users=true|false` (requires `admin.users.read`)
  - Returns app teams with `membres_count`, and optionally `members[]`.
- `POST /api/admin/teams/sync-from-crm?sync_members=true|false` (requires `admin.users.write`)
  - Upserts teams from the CRM groupes endpoint.
  - If `sync_members=true`: **adds missing memberships** for linked users (`User.crm_user_id` present). It does **not** remove memberships.
- `POST /api/admin/teams` (requires `admin.users.write`)
  - Upserts a team by `crm_group_id` (useful for manual correction if needed).
- `PATCH /api/admin/teams/:teamId` (requires `admin.users.write`)
  - Updates `name` and/or `responsable_*` metadata.
- `DELETE /api/admin/teams/:teamId?force=true` (requires `admin.users.write`)
  - If the team has members, you must pass `force=true` (or remove members first).
- Membership management:
  - `POST /api/admin/teams/:teamId/members` (requires `admin.users.write`) body `{ user_id }`
  - `DELETE /api/admin/teams/:teamId/members/:userId` (requires `admin.users.write`)

Critical note (scope correctness):
- For GROUP scope to work, `Team.name` should match the fiche’s `groupe` string stored in cache (typically the CRM group “nom”).
- Renaming teams can unintentionally hide data from users (because scope matching is string-based today).

---

## 5) Scope model (SELF / GROUP / ALL)

Scopes exist to ensure **users only see sales/audits belonging to their scope**.

### 5.1 What “SELF” means

User can only access fiches where fiche attribution belongs to them:
- A fiche is “self-visible” if its `attributionUserId` matches the user’s `crm_user_id`.

### 5.2 What “GROUP” means

User can only access fiches where fiche group belongs to one of their groupes:
- A fiche is “group-visible” if its `groupe` is in the user’s `groupes[]`

### 5.3 ALL

No scope filtering.

### 5.4 Where scope is enforced

Scope is enforced for **fiche-linked data**:
- fiches (sales + fiche cache + status)
- audits (lists + details + run + rerun + review)
- recordings
- transcriptions
- chat (history + message)
- realtime Pusher channel auth for `private-fiche-*` and `private-audit-*`

Note:
- The backend may return **404** or **403** for out-of-scope access depending on endpoint (the intent is to avoid data leakage by ID guessing).

### 5.5 How scope is resolved (source fields)

Scope checks are implemented using the **fiche cache** in Postgres as the source of truth:

- **Group scope** checks match against:
  - `fiche_cache.groupe` and/or
  - `fiche_cache_information.groupe`
- **Self scope** checks match against:
  - `fiche_cache_information.attribution_user_id` (CRM user id)
  - compared to the authenticated user’s `crm_user_id`

Practical implication:
- Many endpoints rely on cache for performance. If a fiche is not yet cached, some endpoints may not be able to prove scope and can deny access until fiche details exist in cache.
- Some audit-related checks have a **best-effort CRM fallback** (to avoid false-deny when cache is missing), but the general expectation is that fiche details are cached early in workflows.

---

## 6) CRM integration: users + groupes

We integrated “team” as “groupe”:
- CRM has **users** and **groupes**
- App stores groupes as `Team` rows + `UserTeam` memberships
- The JWT `/me` response exposes `groupes: string[]` as the **group names** (CRM `nom`)

### CRM gateway endpoints used
From the gateway:
- `GET /api/utilisateurs`
- `GET /api/utilisateurs/groupes?include_users=true|false`

Backend wraps these under admin routes:
- `GET /api/admin/crm/users`
- `GET /api/admin/crm/teams?include_users=true|false`

---

## 7) “One-click” user creation from CRM + invite flow

### 7.1 Admin creates/links a user from a CRM user

Endpoint:
- `POST /api/admin/users/from-crm` (requires `admin.users.write`)

What it does:
- Finds CRM user by `crm_user_id`
- Creates or links an app `User` using:
  - strict linking by `crm_user_id`
  - safe fallback linking by email (with conflict checks)
- Assigns roles (`role_keys`)
- Looks up CRM group membership (or uses forced `crm_group_id`)
- Upserts `Team` and `UserTeam`
- If the user has **no passwordHash** (INVITED), it creates a **one-time invite token** and returns it.

Response includes:
- `user` (including `crm_user_id`)
- `team` and `groupe` (aliases, same object)
- `invite_token` (string | null)

### 7.2 First login password setup

Endpoint:
- `POST /api/auth/invite/accept`

What it does:
- Validates invite token (stored as hash in DB with expiry)
- Sets password
- Marks token used
- Returns access token + sets refresh cookie (same shape as `/login`)

Frontend implication:
- You can implement an “Activate account / Set password” screen that takes `invite_token` and a new password, then logs the user in immediately.

---

## 8) Module-by-module permission + scope behavior

### 8.1 Fiches (`/api/fiches/*`)

Default router guard:
- `fichesRouter.use(requirePermission("fiches.read"))`

Additional rules:
- Some operations (like forcing refresh) require `fiches.write`.
- Lists/searches are scope-filtered (GROUP/SELF) before returning results.
- Single fiche details and cached endpoints are scope-checked.

### 8.2 Audits (`/api/audits/*`)

Permissions:
- `audits.read` for reading/listing
- `audits.run` for starting audits (write-like)
- `audits.write` for edits/reviews/deletes (write-like)
- `audits.rerun` for rerun endpoints (write-like)

Scope:
- Audit visibility/writability is enforced based on the audit’s linked fiche.

### 8.3 Recordings (`/api/recordings/:fiche_id`)

Permission:
- `recordings.read`

Scope:
- enforced by fiche visibility (SELF/GROUP/ALL)

### 8.4 Transcriptions (`/api/transcriptions/*`)

Permissions:
- `transcriptions.read` for statuses/reads
- `transcriptions.write` for starting transcription (single/batch)

Scope:
- enforced by fiche visibility, including batch validation (all ids must be in scope)

### 8.5 Chat (`/api/audits/:audit_id/chat*` and `/api/fiches/:fiche_id/chat*`)

Permissions:
- `chat.read` for history
- `chat.use` for sending messages
- also requires `audits.read` or `fiches.read` depending on route

Scope:
- backend resolves the audit’s ficheId (or ficheId directly) and denies out-of-scope access before building any LLM context.

Streaming format (important):
- Chat “send” endpoints stream as **SSE-style** `text/event-stream`:
  - multiple events: `data: {"text":"..."}` (incremental chunks)
  - optional final event: `data: {"citations":[...]}` (if citations exist)
  - end sentinel: `data: [DONE]`
  - on streaming failure (after headers): `data: {"type":"error","error":"...","code":"STREAM_ERROR"}`

Frontend implication:
- You generally can’t use native `EventSource` because you need to attach the **Authorization header**. Use `fetch()` + readable stream parsing.

### 8.6 Realtime / Pusher (`/api/realtime/pusher/auth`)

Permission:
- `realtime.auth`

Scope:
- enforced for subscriptions to `private-fiche-*` and `private-audit-*` by checking the linked fiche group/attribution.

Frontend implication:
- Configure Pusher auth endpoint to include `Authorization: Bearer <access_token>`.

### 8.7 Audit configs / Automation / Products

These are not fiche-scoped visibility problems; they’re protected by read/write permissions:
- `audit-configs.read` / `audit-configs.write`
- `automation.read` / `automation.write` (and write-like actions such as triggers)
- `products.read` / `products.write`

---

## 9) Realtime event contract (Pusher)

The frontend consumes realtime via **Pusher Channels** private channels.

- **Channels** (examples):
  - `private-audit-{auditId}`
  - `private-fiche-{ficheId}`
  - `private-job-{jobId}`
  - `private-global`

- **Behavior**:
  - This is **notify → refetch**. Events can be missed while offline.
  - Payloads may be truncated if too large.

For the complete list and payload shapes, use:
- `docs/FRONTEND_PUSHER_EVENTS.md`

### 9.1 Pusher auth endpoint behavior (frontend setup detail)

Endpoint:
- `POST /api/realtime/pusher/auth` (requires user JWT + `realtime.auth`)

Request body (Pusher sends this):
- `socket_id: string`
- `channel_name: string`
- `user_info?: object` (presence channels)

Response:
- On success: returns the **raw Pusher auth payload** (not wrapped in `{ success: true, data: ... }`).
- On failure: returns `{ success: false, error: "..." }` with a 4xx/5xx status.

Presence channels:
- Backend sets `user_id` to the authenticated user id and includes `user_info.email` and `user_info.roles`.

Frontend implication:
- Configure your Pusher client so the auth request includes:
  - `Authorization: Bearer <access_token>`
  - (and optionally `withCredentials: true`, depending on your setup)

---

## 10) Seeding (roles/permissions + optional admin user)

### 10.1 What happens in Docker

Container startup runs:
- `npx prisma migrate deploy`
- `npm run seed:auth`
- then starts the server

### 10.2 What is seeded

- **Roles and permissions** are always upserted (idempotent).
- **No user is created** unless you set:
  - `AUTH_SEED_ADMIN_EMAIL`
  - `AUTH_SEED_ADMIN_PASSWORD`

So “0 users in DB” is expected until you either:
- set the seed admin env vars, or
- create users via admin endpoints (`/api/admin/users` or `/api/admin/users/from-crm`)

---

## 11) Frontend integration checklist (recommended)

### Auth session strategy

- Use `credentials: "include"` on `/api/auth/*` requests.
- Store the **access token** (JWT) client-side and send it as `Authorization: Bearer ...`.
- On app boot:
  - call `POST /api/auth/refresh` to get a valid access token + user snapshot
- On `401`:
  - attempt one refresh → retry original request
  - if refresh fails → redirect to login

### Permission gating

- Build helpers around `PermissionGrant[]`:
  - `canRead(key)` / `canWrite(key)`
  - show scope labels: `SELF|GROUP|ALL`
- Hide admin UI unless `admin.users/admin.roles/admin.permissions` grants allow.
- Always handle `403/404` defensively; backend is source of truth.

### Onboarding from CRM

- Admin flow:
  - list CRM users (`GET /api/admin/crm/users`)
  - create/link app user (`POST /api/admin/users/from-crm`)
  - show/copy `invite_token` when present
- User flow:
  - set password via `POST /api/auth/invite/accept`
  - user is now logged in (access token + refresh cookie)

### Realtime

- Configure Pusher auth to call `POST /api/realtime/pusher/auth` with JWT header.
- Subscribe to `private-*` channels for audits/fiches/jobs.
- Treat events as “poke”: **refetch** the actual resource state.

