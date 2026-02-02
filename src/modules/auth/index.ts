/**
 * Auth Module
 * ===========
 * JWT + refresh tokens + RBAC snapshots for the app.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

export { authRouter } from "./auth.routes.js";

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

export * as authService from "./auth.service.js";

// ═══════════════════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════════════════

export * as authRepository from "./auth.repository.js";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDATION LAYER
// ═══════════════════════════════════════════════════════════════════════════

export type * from "./auth.schemas.js";
export { validateLoginInput, validateRefreshInput } from "./auth.schemas.js";

