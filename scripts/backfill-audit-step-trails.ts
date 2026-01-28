import "dotenv/config";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

import {
  extractLegacyHumanReviewEntries,
  extractLegacyRerunHistoryEntries,
  legacyHumanReviewsToRows,
  legacyRerunHistoryToRows,
} from "../src/modules/audits/audits.trails.js";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

type CandidateRow = {
  id: bigint;
  audit_id: bigint;
  step_position: number;
  raw_result: unknown;
  human_reviews_count: number;
  rerun_events_count: number;
};

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT
      asr.id,
      asr.audit_id,
      asr.step_position,
      asr.raw_result,
      COALESCE(hr.cnt, 0)::int AS human_reviews_count,
      COALESCE(re.cnt, 0)::int AS rerun_events_count
    FROM audit_step_results asr
    LEFT JOIN (
      SELECT audit_id, step_position, COUNT(*) AS cnt
      FROM audit_step_result_human_reviews
      GROUP BY audit_id, step_position
    ) hr
      ON hr.audit_id = asr.audit_id AND hr.step_position = asr.step_position
    LEFT JOIN (
      SELECT audit_id, step_position, COUNT(*) AS cnt
      FROM audit_step_result_rerun_events
      GROUP BY audit_id, step_position
    ) re
      ON re.audit_id = asr.audit_id AND re.step_position = asr.step_position
    WHERE asr.id > ${params.afterId}
      AND asr.raw_result IS NOT NULL
      AND (
        (asr.raw_result::jsonb ? 'human_review')
        OR
        (asr.raw_result::jsonb ? 'rerun_history')
      )
    ORDER BY asr.id ASC
    LIMIT ${params.take}
  `;

  if (rows.length === 0) {
    return {
      processed: 0,
      migratedHumanEntries: 0,
      migratedRerunEntries: 0,
      trimmed: 0,
      skipped: 0,
      nextAfterId: params.afterId,
    };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let migratedHumanEntries = 0;
  let migratedRerunEntries = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const raw = row.raw_result as unknown;
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }

    const legacyHuman = extractLegacyHumanReviewEntries(raw);
    const legacyRerun = extractLegacyRerunHistoryEntries(raw);

    const needHuman = row.human_reviews_count === 0 && legacyHuman.length > 0;
    const needRerun = row.rerun_events_count === 0 && legacyRerun.length > 0;

    if (!needHuman && !needRerun) {
      skipped += 1;
      continue;
    }

    const now = new Date();

    const humanRows = needHuman
      ? legacyHumanReviewsToRows({
          auditId: row.audit_id,
          stepPosition: row.step_position,
          entries: legacyHuman,
          fallbackDate: now,
        })
      : [];

    const rerunRows = needRerun
      ? legacyRerunHistoryToRows({
          auditId: row.audit_id,
          stepPosition: row.step_position,
          entries: legacyRerun,
          fallbackDate: now,
        })
      : [];

    const nextRaw: Record<string, unknown> = { ...raw };
    if (needHuman) {
      delete nextRaw.human_review;
    }
    if (needRerun) {
      delete nextRaw.rerun_history;
    }

    await prisma.$transaction([
      ...(humanRows.length > 0
        ? [
            prisma.auditStepResultHumanReview.createMany({
              data: humanRows,
            }),
          ]
        : []),
      ...(rerunRows.length > 0
        ? [
            prisma.auditStepResultRerunEvent.createMany({
              data: rerunRows,
            }),
          ]
        : []),
      prisma.auditStepResult.update({
        where: { id: row.id },
        data: { rawResult: toPrismaJsonValue(nextRaw) },
      }),
    ]);

    migratedHumanEntries += humanRows.length;
    migratedRerunEntries += rerunRows.length;
    trimmed += 1;
  }

  return {
    processed,
    migratedHumanEntries,
    migratedRerunEntries,
    trimmed,
    skipped,
    nextAfterId,
  };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUDIT_TRAILS_BATCH_SIZE || "50", 10) || 50
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUDIT_TRAILS_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalMigratedHumanEntries = 0;
  let totalMigratedRerunEntries = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalMigratedHumanEntries += r.migratedHumanEntries;
    totalMigratedRerunEntries += r.migratedRerunEntries;
    totalTrimmed += r.trimmed;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          migratedHumanEntries: r.migratedHumanEntries,
          migratedRerunEntries: r.migratedRerunEntries,
          trimmed: r.trimmed,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            migratedHumanEntries: totalMigratedHumanEntries,
            migratedRerunEntries: totalMigratedRerunEntries,
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
          migratedHumanEntries: totalMigratedHumanEntries,
          migratedRerunEntries: totalMigratedRerunEntries,
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

