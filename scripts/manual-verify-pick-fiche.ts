/**
 * Manual verification helper:
 * Pick a recently fetched fiche id with minimal safe output (no PII).
 */
import { disconnectDb, prisma } from "../src/shared/prisma.js";

async function main() {
  // Prefer a fiche with 0 recordings to avoid triggering provider calls during verification.
  const row = await prisma.ficheCache.findFirst({
    where: { recordingsCount: 0 },
    select: { ficheId: true, recordingsCount: true },
    orderBy: { fetchedAt: "desc" },
  });

  if (row) {
    console.log(JSON.stringify(row));
    return;
  }

  // Fallback: any fiche (still output-only id + recordingsCount).
  const any = await prisma.ficheCache.findFirst({
    select: { ficheId: true, recordingsCount: true },
    orderBy: { fetchedAt: "desc" },
  });

  console.log(JSON.stringify(any ?? null));
}

main()
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectDb();
    } catch {
      // ignore
    }
  });

