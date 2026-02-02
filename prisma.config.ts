import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx seed.ts",
  },
  datasource: {
    // Prisma ORM v7+ expects the datasource URL to live in prisma.config.ts (not schema.prisma).
    // Prefer a direct connection for migrations when available.
    // NOTE: in Docker Compose, `${DIRECT_URL}` may be injected as an empty string when not set.
    // Use `||` (not `??`) so an empty DIRECT_URL doesn't mask a valid DATABASE_URL.
    url: process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() || "",
  },
});

