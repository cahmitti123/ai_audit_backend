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

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toNumberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toIntOr(value: unknown, fallback: number): number {
  return Math.trunc(toNumberOr(value, fallback));
}

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const candidates = await prisma.auditStepResult.findMany({
    where: {
      id: { gt: params.afterId },
      rawResult: { not: Prisma.DbNull },
      controlPoints: { none: {} },
    },
    orderBy: { id: "asc" },
    take: params.take,
    select: {
      id: true,
      auditId: true,
      stepPosition: true,
      rawResult: true,
    },
  });

  if (candidates.length === 0) {
    return { processed: 0, backfilled: 0, trimmed: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = candidates[candidates.length - 1].id;

  let processed = 0;
  let backfilled = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of candidates) {
    processed += 1;

    const raw = row.rawResult as unknown;
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }

    const pointsRaw = raw.points_controle;
    if (!Array.isArray(pointsRaw) || pointsRaw.length === 0) {
      skipped += 1;
      continue;
    }

    const controlPointsData = pointsRaw.map((cp, idx) => {
      const rec = isRecord(cp) ? cp : {};
      return {
        auditId: row.auditId,
        stepPosition: row.stepPosition,
        controlPointIndex: idx + 1,
        point: typeof rec.point === "string" ? rec.point : "",
        statut: typeof rec.statut === "string" ? rec.statut : "ABSENT",
        commentaire: typeof rec.commentaire === "string" ? rec.commentaire : "",
        minutages: toStringArray(rec.minutages),
        erreurTranscriptionNotee: Boolean(rec.erreur_transcription_notee),
        variationPhonetiqueUtilisee:
          typeof rec.variation_phonetique_utilisee === "string"
            ? rec.variation_phonetique_utilisee
            : null,
      };
    });

    const citationsData = pointsRaw.flatMap((cp, cpIdx) => {
      const cpRec = isRecord(cp) ? cp : {};
      const citationsRaw = Array.isArray(cpRec.citations) ? cpRec.citations : [];
      const controlPointIndex = cpIdx + 1;

      return citationsRaw
        .map((c, cIdx) => {
          if (!isRecord(c)) {return null;}
          return {
            auditId: row.auditId,
            stepPosition: row.stepPosition,
            controlPointIndex,
            citationIndex: cIdx + 1,
            texte: typeof c.texte === "string" ? c.texte : "",
            minutage: typeof c.minutage === "string" ? c.minutage : "",
            minutageSecondes: toNumberOr(c.minutage_secondes, 0),
            speaker: typeof c.speaker === "string" ? c.speaker : "",
            recordingIndex: toIntOr(c.recording_index, 0),
            chunkIndex: toIntOr(c.chunk_index, 0),
            recordingDate: typeof c.recording_date === "string" ? c.recording_date : "N/A",
            recordingTime: typeof c.recording_time === "string" ? c.recording_time : "N/A",
            recordingUrl: typeof c.recording_url === "string" ? c.recording_url : "N/A",
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
    });

    const nextRaw = {
      step_metadata: raw.step_metadata ?? null,
      usage: raw.usage ?? null,
      ...(raw.human_review !== undefined ? { human_review: raw.human_review } : {}),
      ...(raw.rerun_history !== undefined ? { rerun_history: raw.rerun_history } : {}),
    };

    await prisma.$transaction([
      prisma.auditStepResultControlPoint.deleteMany({
        where: { auditId: row.auditId, stepPosition: row.stepPosition },
      }),
      prisma.auditStepResultControlPoint.createMany({
        data: controlPointsData,
        skipDuplicates: true,
      }),
      ...(citationsData.length > 0
        ? [
            prisma.auditStepResultCitation.createMany({
              data: citationsData,
              skipDuplicates: true,
            }),
          ]
        : []),
      prisma.auditStepResult.update({
        where: {
          auditId_stepPosition: {
            auditId: row.auditId,
            stepPosition: row.stepPosition,
          },
        },
        data: {
          rawResult: toPrismaJsonValue(nextRaw),
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
    Number.parseInt(process.env.BACKFILL_AUDIT_CP_BATCH_SIZE || "25", 10) || 25
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_AUDIT_CP_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalBackfilled = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = 0n;

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

