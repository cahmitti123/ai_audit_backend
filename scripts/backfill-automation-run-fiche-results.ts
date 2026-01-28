import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type CandidateRow = {
  id: bigint;
  result_summary: unknown;
};

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT id, result_summary
    FROM automation_runs
    WHERE id > ${params.afterId}
      AND result_summary IS NOT NULL
      AND (
        (result_summary::jsonb ? 'successful')
        OR (result_summary::jsonb ? 'failed')
        OR (result_summary::jsonb ? 'ignored')
      )
    ORDER BY id ASC
    LIMIT ${params.take}
  `;

  if (rows.length === 0) {
    return {
      processed: 0,
      createdRows: 0,
      trimmedRuns: 0,
      skipped: 0,
      nextAfterId: params.afterId,
    };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let createdRows = 0;
  let trimmedRuns = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const runId = row.id;
    const rs = row.result_summary as unknown;
    if (!isRecord(rs)) {
      skipped += 1;
      continue;
    }

    const existingCount = await prisma.automationRunFicheResult.count({
      where: { runId },
    });

    // If already backfilled, just trim JSON.
    if (existingCount > 0) {
      await prisma.automationRun.update({
        where: { id: runId },
        data: { resultSummary: toPrismaJsonValue({}) },
      });
      trimmedRuns += 1;
      continue;
    }

    const successful = toStringArray(rs.successful);
    const failedRaw = Array.isArray(rs.failed) ? rs.failed : [];
    const ignoredRaw = Array.isArray(rs.ignored) ? rs.ignored : [];

    const failed = failedRaw
      .map((f) => {
        if (!isRecord(f)) {return null;}
        const ficheId = typeof f.ficheId === "string" ? f.ficheId : null;
        const error = typeof f.error === "string" ? f.error : null;
        if (!ficheId) {return null;}
        return { ficheId, error: error ?? "Unknown error" };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const ignored = ignoredRaw
      .map((f) => {
        if (!isRecord(f)) {return null;}
        const ficheId = typeof f.ficheId === "string" ? f.ficheId : null;
        const reason = typeof f.reason === "string" ? f.reason : null;
        const recordingsCount =
          typeof f.recordingsCount === "number" && Number.isFinite(f.recordingsCount)
            ? Math.trunc(f.recordingsCount)
            : null;
        if (!ficheId) {return null;}
        return { ficheId, reason: reason ?? "Ignored", recordingsCount };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const createRows: Array<Prisma.AutomationRunFicheResultCreateManyInput> = [
      ...successful.map((ficheId) => ({
        runId,
        ficheId,
        status: "successful",
      })),
      ...failed.map((f) => ({
        runId,
        ficheId: f.ficheId,
        status: "failed",
        error: f.error,
      })),
      ...ignored.map((f) => ({
        runId,
        ficheId: f.ficheId,
        status: "ignored",
        ignoreReason: f.reason,
        recordingsCount: f.recordingsCount,
      })),
    ];

    if (createRows.length === 0) {
      // Nothing to backfill; keep JSON as-is.
      skipped += 1;
      continue;
    }

    await prisma.$transaction([
      prisma.automationRunFicheResult.deleteMany({ where: { runId } }),
      prisma.automationRunFicheResult.createMany({
        data: createRows,
        skipDuplicates: true,
      }),
      prisma.automationRun.update({
        where: { id: runId },
        data: { resultSummary: toPrismaJsonValue({}) },
      }),
    ]);

    createdRows += createRows.length;
    trimmedRuns += 1;
  }

  return {
    processed,
    createdRows,
    trimmedRuns,
    skipped,
    nextAfterId,
  };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUTOMATION_RUN_RESULTS_BATCH_SIZE || "50", 10) ||
      50
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUTOMATION_RUN_RESULTS_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalCreatedRows = 0;
  let totalTrimmedRuns = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalCreatedRows += r.createdRows;
    totalTrimmedRuns += r.trimmedRuns;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          createdRows: r.createdRows,
          trimmedRuns: r.trimmedRuns,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            createdRows: totalCreatedRows,
            trimmedRuns: totalTrimmedRuns,
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
          createdRows: totalCreatedRows,
          trimmedRuns: totalTrimmedRuns,
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

