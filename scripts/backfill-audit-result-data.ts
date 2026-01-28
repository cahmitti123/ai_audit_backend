import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

function stripSteps(resultData: unknown): { changed: boolean; next: unknown } {
  if (!isRecord(resultData)) {return { changed: false, next: resultData };}
  const audit = resultData.audit;
  if (!isRecord(audit)) {return { changed: false, next: resultData };}
  const results = audit.results;
  if (!isRecord(results)) {return { changed: false, next: resultData };}

  if (!Object.prototype.hasOwnProperty.call(results, "steps")) {
    return { changed: false, next: resultData };
  }

  const { steps: _steps, ...restResults } = results as Record<string, unknown>;

  return {
    changed: true,
    next: {
      ...(resultData as Record<string, unknown>),
      audit: {
        ...(audit as Record<string, unknown>),
        results: restResults,
      },
    },
  };
}

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const audits = await prisma.audit.findMany({
    where: {
      id: { gt: params.afterId },
      resultData: { not: Prisma.DbNull },
    },
    orderBy: { id: "asc" },
    take: params.take,
    select: { id: true, resultData: true },
  });

  if (audits.length === 0) {
    return { processed: 0, trimmed: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = audits[audits.length - 1].id;

  let processed = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of audits) {
    processed += 1;
    const { changed, next } = stripSteps(row.resultData as unknown);
    if (!changed) {
      skipped += 1;
      continue;
    }

    await prisma.audit.update({
      where: { id: row.id },
      data: { resultData: toPrismaJsonValue(next) },
    });

    trimmed += 1;
  }

  return { processed, trimmed, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUDIT_RESULTDATA_BATCH_SIZE || "50", 10) || 50
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUDIT_RESULTDATA_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalTrimmed += r.trimmed;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          trimmed: r.trimmed,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            trimmed: totalTrimmed,
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
          trimmed: totalTrimmed,
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

