/**
 * Global test setup
 * =================
 * Ensure the app can import without requiring real external services.
 *
 * IMPORTANT:
 * - Never put real secrets here.
 * - These are safe placeholders to satisfy SDKs that may read env at import-time.
 */

import dotenv from "dotenv";

// If integration tests are enabled, load local .env so tests can use real DB/CRM settings.
// This is safe because `.env` is gitignored; DO NOT commit real secrets.
if (process.env.RUN_INTEGRATION_TESTS === "1") {
  dotenv.config({ path: ".env", override: false });
}

// Ensure consistent env
process.env.NODE_ENV = "test";

// Auth (JWT) defaults for unit tests
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-access-secret";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "ai-audit";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "ai-audit";

// Inngest: force dev-mode so it doesn't require cloud keys in tests
process.env.INNGEST_DEV = "1";

// Prisma: set a syntactically valid URL so PrismaClient can be constructed.
// Tests in this suite avoid touching the DB unless you add integration tests.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/ai_audit_test";
process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

// AI provider placeholders (some libraries validate presence at runtime)
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test-openai-key";
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-anthropic-key";

// Transcription provider placeholder
process.env.ELEVENLABS_API_KEY =
  process.env.ELEVENLABS_API_KEY || "test-elevenlabs-key";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

// External fiche API placeholder (disable outbound CRM calls in unit tests)
if (!runIntegration) {
  process.env.FICHE_API_BASE_URL = "http://example.invalid";
}

// Disable any outbound network side-effects by default in unit tests.
// Integration tests may explicitly rely on Redis/webhooks, so we don't override there.
if (!runIntegration) {
  process.env.REDIS_URL = "";
  // Ensure realtime publishing never triggers outbound requests in unit tests.
  process.env.PUSHER_DRY_RUN = process.env.PUSHER_DRY_RUN || "1";
}


