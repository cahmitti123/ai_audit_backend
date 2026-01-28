import "dotenv/config";

import type { Prisma} from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.ficheCache.findMany({
    where: { id: { gt: params.afterId } },
    orderBy: { id: "asc" },
    take: params.take,
    include: { _count: { select: { recordings: true } } },
  });

  if (rows.length === 0) {
    return { processed: 0, stripped: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let stripped = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const raw = row.rawData as unknown;
    if (!isRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, "recordings")) {
      skipped += 1;
      continue;
    }

    // Safety: don't strip if this cache row has no recordings in the normalized table yet.
    // In that case, rawData.recordings might be the only copy.
    if (row._count.recordings === 0) {
      skipped += 1;
      continue;
    }

    const { recordings: _recordings, ...rest } = raw;

    await prisma.ficheCache.update({
      where: { id: row.id },
      data: { rawData: toPrismaJsonValue(rest) },
    });

    stripped += 1;
  }

  return { processed, stripped, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_RAWDATA_BATCH_SIZE || "200", 10) || 200
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_RAWDATA_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalStripped = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalStripped += r.stripped;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          stripped: r.stripped,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            stripped: totalStripped,
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
          stripped: totalStripped,
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

