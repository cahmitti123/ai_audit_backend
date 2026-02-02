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
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});

