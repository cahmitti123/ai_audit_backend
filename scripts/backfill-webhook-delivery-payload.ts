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

function toIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

type CandidateRow = {
  id: string;
  payload: unknown;
};

async function backfillOnce(params: { take: number; afterId: string }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT id, payload
    FROM webhook_deliveries
    WHERE payload_timestamp IS NULL
      AND id > ${params.afterId}
    ORDER BY id ASC
    LIMIT ${params.take}
  `;

  if (rows.length === 0) {
    return { processed: 0, backfilled: 0, trimmed: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let backfilled = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const payload = row.payload as unknown;
    if (!isRecord(payload)) {
      skipped += 1;
      continue;
    }

    const timestamp = toStringOrNull(payload.timestamp);
    const data = isRecord(payload.data) ? (payload.data as Record<string, unknown>) : null;
    const status = data ? toStringOrNull(data.status) : null;

    if (!timestamp || !status) {
      // Not a recognized payload, keep as-is.
      skipped += 1;
      continue;
    }

    const partialDataRaw = data && Array.isArray(data.partialData) ? data.partialData : [];
    const partialRows = partialDataRaw
      .map((f, idx) => {
        if (!isRecord(f)) {return null;}
        const ficheId = toStringOrNull(f.ficheId);
        const recordingsCount =
          typeof f.recordingsCount === "number" && Number.isFinite(f.recordingsCount)
            ? Math.trunc(f.recordingsCount)
            : null;
        const ficheCreatedAt = toStringOrNull(f.createdAt);

        if (!ficheId || recordingsCount === null || !ficheCreatedAt) {return null;}

        return {
          deliveryId: row.id,
          rowIndex: idx + 1,
          ficheId,
          groupe: typeof f.groupe === "string" ? f.groupe : null,
          prospectNom: typeof f.prospectNom === "string" ? f.prospectNom : null,
          prospectPrenom: typeof f.prospectPrenom === "string" ? f.prospectPrenom : null,
          recordingsCount,
          ficheCreatedAt,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    await prisma.$transaction([
      prisma.webhookDeliveryPartialFiche.deleteMany({
        where: { deliveryId: row.id },
      }),
      ...(partialRows.length > 0
        ? [prisma.webhookDeliveryPartialFiche.createMany({ data: partialRows })]
        : []),
      prisma.webhookDelivery.update({
        where: { id: row.id },
        data: {
          payloadTimestamp: timestamp,
          payloadStatus: status,
          payloadProgress: data ? toIntOrNull(data.progress) : null,
          payloadCompletedDays: data ? toIntOrNull(data.completedDays) : null,
          payloadTotalDays: data ? toIntOrNull(data.totalDays) : null,
          payloadTotalFiches: data ? toIntOrNull(data.totalFiches) : null,
          payloadCurrentFichesCount: data ? toIntOrNull(data.currentFichesCount) : null,
          payloadLatestDate: data ? toStringOrNull(data.latestDate) : null,
          payloadError: data ? toStringOrNull(data.error) : null,
          payloadDataUrl: data ? toStringOrNull(data.dataUrl) : null,
          // Reduce JSON storage once normalized.
          payload: toPrismaJsonValue({}),
        },
      }),
    ]);

    backfilled += 1;
    trimmed += 1;
  }

  return { processed, backfilled, trimmed, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_WEBHOOK_PAYLOAD_BATCH_SIZE || "100", 10) || 100
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_WEBHOOK_PAYLOAD_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalBackfilled = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = "";

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalBackfilled += r.backfilled;
    totalTrimmed += r.trimmed;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          backfilled: r.backfilled,
          trimmed: r.trimmed,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            backfilled: totalBackfilled,
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
          backfilled: totalBackfilled,
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

