/**
 * Prisma Client Singleton
 * ========================
 * Shared database client instance
 */

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function disconnectDb() {
  await prisma.$disconnect();
}

