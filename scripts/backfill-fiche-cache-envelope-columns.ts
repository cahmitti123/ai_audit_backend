import "dotenv/config";

import type { Prisma } from "@prisma/client";

import { prisma } from "../src/shared/prisma.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

type CandidateRow = {
  id: bigint;
  raw_data: unknown;
  cle: string | null;
  details_success: boolean | null;
  details_message: string | null;
  information_cle: string | null;
};

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT
      fc.id,
      fc.raw_data,
      fc.cle,
      fc.details_success,
      fc.details_message,
      info.cle AS information_cle
    FROM fiche_cache fc
    LEFT JOIN fiche_cache_information info ON info.fiche_cache_id = fc.id
    WHERE fc.id > ${params.afterId}
      AND fc.raw_data IS NOT NULL
      AND (
        (fc.raw_data::jsonb ? 'cle')
        OR (fc.raw_data::jsonb ? 'success')
        OR (fc.raw_data::jsonb ? 'message')
        OR fc.cle IS NULL
        OR fc.details_success IS NULL
        OR fc.details_message IS NULL
      )
    ORDER BY fc.id ASC
    LIMIT ${params.take}
  `;

  if (rows.length === 0) {
    return {
      processed: 0,
      updated: 0,
      trimmed: 0,
      skipped: 0,
      nextAfterId: params.afterId,
    };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let updated = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const raw = row.raw_data as unknown;
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }

    const cleFromRaw =
      typeof raw.cle === "string" && raw.cle.trim().length > 0 ? raw.cle.trim() : null;
    const cleFromInfo =
      typeof row.information_cle === "string" && row.information_cle.trim().length > 0
        ? row.information_cle.trim()
        : null;

    const cleToSet =
      row.cle !== null ? null : cleFromRaw ?? cleFromInfo;

    const successFromRaw = typeof raw.success === "boolean" ? raw.success : null;
    const messageFromRaw = typeof raw.message === "string" ? raw.message : null;

    const detailsSuccessToSet =
      row.details_success !== null ? null : successFromRaw;
    const detailsMessageToSet =
      row.details_message !== null ? null : messageFromRaw;

    const nextRaw: Record<string, unknown> = { ...raw };
    let shouldTrim = false;

    // If we have (or are setting) these scalars, remove them from JSON to reduce storage.
    if (row.cle !== null || cleFromRaw !== null || cleFromInfo !== null) {
      if ("cle" in nextRaw) {
        delete nextRaw.cle;
        shouldTrim = true;
      }
    }

    if (row.details_success !== null || successFromRaw !== null) {
      if ("success" in nextRaw) {
        delete nextRaw.success;
        shouldTrim = true;
      }
    }

    if (row.details_message !== null || messageFromRaw !== null) {
      if ("message" in nextRaw) {
        delete nextRaw.message;
        shouldTrim = true;
      }
    }

    const shouldUpdateColumns =
      cleToSet !== null || detailsSuccessToSet !== null || detailsMessageToSet !== null;

    if (!shouldUpdateColumns && !shouldTrim) {
      skipped += 1;
      continue;
    }

    const data: Prisma.FicheCacheUpdateInput = {
      ...(cleToSet !== null ? { cle: cleToSet } : {}),
      ...(detailsSuccessToSet !== null ? { detailsSuccess: detailsSuccessToSet } : {}),
      ...(detailsMessageToSet !== null ? { detailsMessage: detailsMessageToSet } : {}),
      ...(shouldTrim ? { rawData: toPrismaJsonValue(nextRaw) } : {}),
    };

    await prisma.ficheCache.update({ where: { id: row.id }, data });

    updated += 1;
    if (shouldTrim) {trimmed += 1;}
  }

  return { processed, updated, trimmed, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_ENVELOPE_BATCH_SIZE || "50", 10) || 50
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_ENVELOPE_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalUpdated += r.updated;
    totalTrimmed += r.trimmed;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          updated: r.updated,
          trimmed: r.trimmed,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            updated: totalUpdated,
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
          updated: totalUpdated,
          trimmed: totalTrimmed,
          skipped: totalSkipped,
        },
      },
      null,
      2
    )
  );
}

await main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

