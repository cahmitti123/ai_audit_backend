/**
 * Prisma Client Singleton
 * ========================
 * Shared database client instance
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
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
