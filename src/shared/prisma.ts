/**
 * Prisma Client Singleton
 * ========================
 * Shared database client instance
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// NOTE: in Docker Compose, `${DIRECT_URL}` / `${DATABASE_URL}` may be injected as empty strings
// when not set. Use `||` (not `??`) so an empty value doesn't mask the fallback.
const connectionString =
  process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or DIRECT_URL) is required to create PrismaClient (set it in your environment or .env file).",
  );
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });

export async function disconnectDb() {
  await prisma.$disconnect();
}
