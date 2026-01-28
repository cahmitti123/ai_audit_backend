import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function arr<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function jsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const out: Record<string, unknown> = {};

  // FicheCache.rawData
  {
    const row = await prisma.ficheCache.findFirst({
      where: { rawData: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        ficheId: true,
        rawData: true,
        hasRecordings: true,
        recordingsCount: true,
      },
    });

    if (row) {
      const raw = row.rawData as unknown;
      const prospect = isRecord(raw) ? raw.prospect : null;
      const information = isRecord(raw) ? raw.information : null;
      const recs = isRecord(raw) ? raw.recordings : null;
      const rec0 = arr(recs)[0];

      out.ficheCache = {
        id: row.id.toString(),
        ficheId: row.ficheId,
        hasRecordings: row.hasRecordings,
        recordingsCount: row.recordingsCount,
        rawDataKeys: objKeys(raw),
        rawDataProspectKeys: objKeys(prospect),
        rawDataInformationKeys: objKeys(information),
        rawDataRecordingsInlinedCount: arr(recs).length,
        rawDataFirstRecordingKeys: objKeys(rec0),
        rawDataJsonBytes: jsonBytes(raw),
      };
    }
  }

  // Recording.transcriptionData
  {
    const row = await prisma.recording.findFirst({
      where: { transcriptionData: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { transcriptionChunks: true } } },
    });

    if (row) {
      const t = row.transcriptionData as unknown;
      const words = isRecord(t) ? t.words : null;
      const w0 = arr(words)[0];

      out.recording = {
        id: row.id.toString(),
        ficheCacheId: row.ficheCacheId.toString(),
        callId: row.callId,
        transcriptionDataKeys: objKeys(t),
        wordsCount: arr(words).length,
        firstWordKeys: objKeys(w0),
        transcriptionTextLen:
          typeof row.transcriptionText === "string"
            ? row.transcriptionText.length
            : null,
        transcriptionLanguageCode: row.transcriptionLanguageCode,
        transcriptionLanguageProbability: row.transcriptionLanguageProbability,
        transcriptionChunksCount: row._count.transcriptionChunks,
        transcriptionDataJsonBytes: jsonBytes(t),
      };
    }
  }

  // AuditStepResult.rawResult
  {
    const row = await prisma.auditStepResult.findFirst({
      where: { rawResult: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        auditId: true,
        stepPosition: true,
        rawResult: true,
        _count: { select: { controlPoints: true, humanReviews: true, rerunEvents: true } },
      },
    });

    if (row) {
      const rr = row.rawResult as unknown;
      const points = isRecord(rr) ? rr.points_controle : null;
      const p0 = arr(points)[0];
      const cits = isRecord(p0) ? p0.citations : null;
      const c0 = arr(cits)[0];
      const human = isRecord(rr) ? rr.human_review : null;
      const reruns = isRecord(rr) ? rr.rerun_history : null;

      out.auditStepResult = {
        id: row.id.toString(),
        auditId: row.auditId.toString(),
        stepPosition: row.stepPosition,
        rawResultKeys: objKeys(rr),
        pointsCount: arr(points).length,
        controlPointsCount: row._count.controlPoints,
        firstPointKeys: objKeys(p0),
        citationsCountFirstPoint: arr(cits).length,
        firstCitationKeys: objKeys(c0),
        humanReviewCount: arr(human).length,
        rerunHistoryCount: arr(reruns).length,
        humanReviewsCount: row._count.humanReviews,
        rerunEventsCount: row._count.rerunEvents,
        rawResultJsonBytes: jsonBytes(rr),
      };
    }
  }

  // Audit.resultData
  {
    const row = await prisma.audit.findFirst({
      where: { resultData: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: { id: true, resultData: true },
    });

    if (row) {
      const rd = row.resultData as unknown;
      const audit = isRecord(rd) ? rd.audit : null;
      const results = isRecord(audit) ? audit.results : null;
      const steps = isRecord(results) ? results.steps : null;

      out.audit = {
        id: row.id.toString(),
        resultDataKeys: objKeys(rd),
        auditKeys: objKeys(audit),
        resultsKeys: objKeys(results),
        stepsCount: arr(steps).length,
        firstStepKeys: objKeys(arr(steps)[0]),
        resultDataJsonBytes: jsonBytes(rd),
      };
    }
  }

  // AutomationSchedule (selection is now normalized; show reconstructed object size)
  {
    const row = await prisma.automationSchedule.findFirst({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        ficheSelectionMode: true,
        ficheSelectionDateRange: true,
        ficheSelectionCustomStartDate: true,
        ficheSelectionCustomEndDate: true,
        ficheSelectionGroupes: true,
        ficheSelectionOnlyWithRecordings: true,
        ficheSelectionOnlyUnaudited: true,
        ficheSelectionUseRlm: true,
        ficheSelectionMaxFiches: true,
        ficheSelectionMaxRecordingsPerFiche: true,
        ficheSelectionFicheIds: true,
      },
    });

    if (row) {
      const fs = {
        mode: row.ficheSelectionMode,
        ...(row.ficheSelectionDateRange ? { dateRange: row.ficheSelectionDateRange } : {}),
        ...(row.ficheSelectionCustomStartDate
          ? { customStartDate: row.ficheSelectionCustomStartDate }
          : {}),
        ...(row.ficheSelectionCustomEndDate
          ? { customEndDate: row.ficheSelectionCustomEndDate }
          : {}),
        ...(Array.isArray(row.ficheSelectionGroupes) && row.ficheSelectionGroupes.length > 0
          ? { groupes: row.ficheSelectionGroupes }
          : {}),
        ...(row.ficheSelectionOnlyWithRecordings ? { onlyWithRecordings: true } : {}),
        ...(row.ficheSelectionOnlyUnaudited ? { onlyUnaudited: true } : {}),
        ...(row.ficheSelectionUseRlm ? { useRlm: true } : {}),
        ...(typeof row.ficheSelectionMaxFiches === "number"
          ? { maxFiches: row.ficheSelectionMaxFiches }
          : {}),
        ...(typeof row.ficheSelectionMaxRecordingsPerFiche === "number"
          ? { maxRecordingsPerFiche: row.ficheSelectionMaxRecordingsPerFiche }
          : {}),
        ...(Array.isArray(row.ficheSelectionFicheIds) && row.ficheSelectionFicheIds.length > 0
          ? { ficheIds: row.ficheSelectionFicheIds }
          : {}),
      };
      out.automationSchedule = {
        id: row.id.toString(),
        ficheSelectionKeys: objKeys(fs),
        ficheSelectionJsonBytes: jsonBytes(fs),
      };
    }
  }

  // AutomationRun.configSnapshot/resultSummary/errorDetails
  {
    const row = await prisma.automationRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { id: true, configSnapshot: true, resultSummary: true, errorDetails: true },
    });

    if (row) {
      out.automationRun = {
        id: row.id.toString(),
        configSnapshotKeys: objKeys(row.configSnapshot),
        configSnapshotJsonBytes: jsonBytes(row.configSnapshot),
        resultSummaryKeys: objKeys(row.resultSummary),
        resultSummaryJsonBytes: jsonBytes(row.resultSummary),
        errorDetailsKeys: objKeys(row.errorDetails),
        errorDetailsJsonBytes: jsonBytes(row.errorDetails),
      };
    }
  }

  // NOTE: Intentionally prints only keys/counts/sizes (no sensitive values).
  console.log(JSON.stringify(out, null, 2));
}

await main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

