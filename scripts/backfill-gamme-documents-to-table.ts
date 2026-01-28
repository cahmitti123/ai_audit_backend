import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {return {};}

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
    }
  }
  return out;
}

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.gamme.findMany({
    where: { id: { gt: params.afterId } },
    orderBy: { id: "asc" },
    take: params.take,
    select: {
      id: true,
      documents: true,
      _count: { select: { documentsTable: true } },
    },
  });

  if (rows.length === 0) {
    return { processed: 0, migrated: 0, cleared: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let migrated = 0;
  let cleared = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const raw = row.documents as unknown;
    const rawKeys = isRecord(raw) ? Object.keys(raw).length : 0;
    const docs = toStringRecord(raw);
    const entries = Object.entries(docs);

    // If docs already exist in the normalized table, do not overwrite them.
    // Only clear legacy JSON if it contains anything.
    if (row._count.documentsTable > 0) {
      if (rawKeys > 0) {
        await prisma.gamme.update({
          where: { id: row.id },
          data: { documents: {} },
        });
        cleared += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    // No normalized docs yet: if legacy JSON has entries, migrate them.
    if (entries.length > 0) {
      await prisma.$transaction([
        prisma.document.deleteMany({
          where: { gammeId: row.id, formuleId: null },
        }),
        prisma.document.createMany({
          data: entries.map(([documentType, url]) => ({
            gammeId: row.id,
            documentType,
            url,
          })),
        }),
        prisma.gamme.update({
          where: { id: row.id },
          data: { documents: {} },
        }),
      ]);

      migrated += entries.length;
      cleared += 1;
      continue;
    }

    // Legacy JSON had keys but no usable URLs (e.g., empty strings) → just clear it.
    if (rawKeys > 0) {
      await prisma.gamme.update({
        where: { id: row.id },
        data: { documents: {} },
      });
      cleared += 1;
    } else {
      skipped += 1;
    }
  }

  return { processed, migrated, cleared, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_GAMME_DOCS_BATCH_SIZE || "50", 10) || 50
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_GAMME_DOCS_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalMigrated = 0;
  let totalCleared = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalMigrated += r.migrated;
    totalCleared += r.cleared;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          migrated: r.migrated,
          cleared: r.cleared,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            migrated: totalMigrated,
            cleared: totalCleared,
            skipped: totalSkipped,
          },
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        totals: {
          processed: totalProcessed,
          migrated: totalMigrated,
          cleared: totalCleared,
          skipped: totalSkipped,
        },
      },
      null,
      2
    )
  );
}

await main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

