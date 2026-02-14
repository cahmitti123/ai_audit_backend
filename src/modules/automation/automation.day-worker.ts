/**
 * Automation Day Worker
 * =====================
 * Inngest child workflow that processes a SINGLE DAY:
 *   1. Fetch fiche IDs from CRM for this specific date
 *   2. Cache sales-list summaries
 *   3. Invoke fiche workers for each fiche (bounded parallel)
 *   4. Return aggregated results for this day
 *
 * Invoked by the automation orchestrator via `step.invoke`.
 * Uses Inngest concurrency controls for bounded day parallelism.
 */

import { inngest } from "../../inngest/client.js";
import { logger } from "../../shared/logger.js";
import type { RecordingLike } from "../../utils/recording-parser.js";
import * as automationApi from "./automation.api.js";
import { processFicheFunction, type ProcessFicheResult } from "./automation.fiche-worker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProcessDayResult = {
  date: string;
  totalFiches: number;
  successful: string[];
  failed: Array<{ ficheId: string; error: string }>;
  ignored: Array<{ ficheId: string; reason: string }>;
  audits: number;
  durationMs: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function getFicheId(value: unknown): string | null {
  if (!isRecord(value)) {return null;}
  const a = getStringField(value, "ficheId");
  if (a) {return a;}
  const b = getStringField(value, "fiche_id");
  if (b) {return b;}
  const c = getStringField(value, "id");
  if (c) {return c;}
  const n = value.id;
  if (typeof n === "number" && Number.isFinite(n)) {return String(n);}
  return null;
}

function toSalesSummaryCacheInput(value: unknown): {
  id: string;
  cle: string | null;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  recordings?: RecordingLike[];
} | null {
  if (!isRecord(value)) {return null;}
  const id = getFicheId(value);
  if (!id) {return null;}
  const cle = getStringField(value, "cle");
  const recordingsRaw = value.recordings;
  const recordings = Array.isArray(recordingsRaw)
    ? recordingsRaw.filter(isRecord).map((r) => r as RecordingLike)
    : undefined;

  return {
    id,
    cle: cle || null,
    nom: getStringField(value, "nom") || "",
    prenom: getStringField(value, "prenom") || "",
    email: getStringField(value, "email") || "",
    telephone: getStringField(value, "telephone") || "",
    ...(recordings ? { recordings } : {}),
  };
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Concurrency config ───────────────────────────────────────────────────────

const DAY_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTOMATION_DAY_CONCURRENCY || 3)
);
const DAY_PER_SCHEDULE_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTOMATION_DAY_PER_SCHEDULE_CONCURRENCY || 2)
);

// ─── Inngest Function ─────────────────────────────────────────────────────────

export const processDayFunction = inngest.createFunction(
  {
    id: "automation-process-day",
    name: "Automation: Process Single Day",
    retries: 1,
    timeouts: {
      finish: "4h",
    },
    concurrency: [
      { limit: DAY_CONCURRENCY },
      { key: "event.data.schedule_id", limit: DAY_PER_SCHEDULE_CONCURRENCY },
    ],
  },
  { event: "automation/process-day" },
  async ({ event, step }): Promise<ProcessDayResult> => {
    const {
      date,
      schedule_id,
      run_id,
      audit_config_id,
      run_transcription,
      run_audits,
      max_recordings,
      max_fiches,
      only_with_recordings,
      use_rlm,
      api_key,
      only_unaudited,
      groupes,
    } = event.data as {
      date: string; // DD/MM/YYYY format
      schedule_id: string;
      run_id: string;
      audit_config_id: number;
      run_transcription: boolean;
      run_audits: boolean;
      max_recordings: number;
      max_fiches?: number;
      only_with_recordings: boolean;
      use_rlm: boolean;
      api_key?: string;
      only_unaudited?: boolean;
      groupes?: string[];
    };

    const dayStart = await step.run("capture-day-start", async () => Date.now());
    const startTime = typeof dayStart === "number" ? dayStart : Date.now();

    logger.info("Processing day", { date, schedule_id, run_id });

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Fetch fiche IDs from CRM for this specific date + cache summaries
    // ─────────────────────────────────────────────────────────────────────────

    const ficheIds = await step.run("fetch-fiches-for-day", async () => {
      const { cacheFicheSalesSummary } = await import("../fiches/fiches.cache.js");

      // Convert DD/MM/YYYY to YYYY-MM-DD for DB
      const [day, month, year] = date.split("/");
      const isoDate = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;

      let fiches: unknown[] = [];
      try {
        fiches = await automationApi.fetchFichesForDate(date, false, api_key);
      } catch (err) {
        // Re-throw so Inngest retries the day worker (CRM issues are often transient)
        logger.error("CRM fetch failed for date — will retry", {
          date,
          error: errorMessage(err),
        });
        throw err;
      }

      logger.info("CRM returned fiches for date", {
        date,
        count: fiches.length,
      });

      // Cache sales-list summaries
      const revalidatedAt = new Date();
      let cachedCount = 0;
      for (const fiche of fiches) {
        try {
          const cacheInput = toSalesSummaryCacheInput(fiche);
          if (cacheInput) {
            await cacheFicheSalesSummary(cacheInput, {
              salesDate: isoDate,
              lastRevalidatedAt: revalidatedAt,
            });
            cachedCount++;
          }
        } catch {
          // best-effort caching
        }
      }

      // Extract unique IDs
      const ids = fiches
        .map(getFicheId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const uniqueIds = [...new Set(ids)];

      logger.info("Day fiches fetched and cached", {
        date,
        crm_count: fiches.length,
        unique_ids: uniqueIds.length,
        cached: cachedCount,
      });

      return { ids: uniqueIds, totalFromCrm: fiches.length, cached: cachedCount };
    });

    const allIds: string[] = Array.isArray(ficheIds.ids) ? ficheIds.ids : [];

    if (allIds.length === 0) {
      return {
        date,
        totalFiches: 0,
        successful: [],
        failed: [],
        ignored: [],
        audits: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Apply filters (groupes, onlyUnaudited) — lightweight DB checks
    // ─────────────────────────────────────────────────────────────────────────

    const filteredIds = await step.run("filter-fiches", async () => {
      const { prisma } = await import("../../shared/prisma.js");
      let ids = [...allIds];

      // Filter by groupes (if specified)
      if (Array.isArray(groupes) && groupes.length > 0) {
        const allowedGroupes = new Set(groupes.map((g) => g.trim()).filter(Boolean));
        if (allowedGroupes.size > 0) {
          const cacheRows = await prisma.ficheCache.findMany({
            where: { ficheId: { in: ids } },
            select: { ficheId: true, groupe: true },
          });
          const ficheGroupeMap = new Map(cacheRows.map((r) => [r.ficheId, r.groupe]));
          ids = ids.filter((id) => {
            const g = ficheGroupeMap.get(id);
            // Keep fiches without group info (will be filtered after details fetch)
            if (!g || !g.trim()) {return true;}
            return allowedGroupes.has(g.trim());
          });
        }
      }

      // Filter only-unaudited (if specified)
      if (only_unaudited) {
        const auditedRows = await prisma.audit.findMany({
          where: {
            ficheCache: { ficheId: { in: ids } },
            auditConfigId: BigInt(audit_config_id),
            status: "completed",
            isLatest: true,
          },
          select: { ficheCache: { select: { ficheId: true } } },
        });
        const audited = new Set(auditedRows.map((r) => r.ficheCache.ficheId));
        ids = ids.filter((id) => !audited.has(id));
      }

      return ids;
    });

    let ficheIdsToProcess: string[] = Array.isArray(filteredIds) ? filteredIds : [];

    // Apply maxFiches limit if set (per-day portion of the global limit)
    if (typeof max_fiches === "number" && max_fiches > 0 && ficheIdsToProcess.length > max_fiches) {
      logger.info("Limiting fiches for day", { date, before: ficheIdsToProcess.length, max: max_fiches });
      ficheIdsToProcess = ficheIdsToProcess.slice(0, max_fiches);
    }

    if (ficheIdsToProcess.length === 0) {
      return {
        date,
        totalFiches: 0,
        successful: [],
        failed: [],
        ignored: [{ ficheId: "*", reason: `All ${allIds.length} fiches filtered out` }],
        audits: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Invoke fiche workers in batches (bounded parallel)
    // ─────────────────────────────────────────────────────────────────────────

    const results: ProcessDayResult = {
      date,
      totalFiches: ficheIdsToProcess.length,
      successful: [],
      failed: [],
      ignored: [],
      audits: 0,
      durationMs: 0,
    };

    const FICHE_BATCH_SIZE = toPositiveInt(process.env.AUTOMATION_FICHE_BATCH_SIZE, 5);
    const ficheChunks = chunkArray(ficheIdsToProcess, FICHE_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < ficheChunks.length; batchIdx++) {
      const batch = ficheChunks[batchIdx]!;

      const batchPromises = batch.map((ficheId) =>
        step.invoke(`day-${date.replace(/\//g, "")}-fiche-${ficheId}`, {
          function: processFicheFunction,
          data: {
            fiche_id: ficheId,
            audit_config_id,
            schedule_id,
            run_id,
            run_transcription,
            run_audits: run_audits !== false,
            max_recordings,
            only_with_recordings,
            use_rlm,
          },
        })
      );

      const batchResults = await Promise.all(batchPromises);

      for (const raw of batchResults) {
        const r = raw as unknown as ProcessFicheResult;
        if (!r || typeof r.ficheId !== "string") {continue;}

        if (r.status === "success") {
          results.successful.push(r.ficheId);
          results.audits++;
        } else if (r.status === "failed") {
          results.failed.push({ ficheId: r.ficheId, error: r.error || "Unknown error" });
        } else {
          results.ignored.push({ ficheId: r.ficheId, reason: r.error || "Skipped" });
        }
      }
    }

    results.durationMs = Date.now() - startTime;

    logger.info("Day processing complete", {
      date,
      total: ficheIdsToProcess.length,
      successful: results.successful.length,
      failed: results.failed.length,
      ignored: results.ignored.length,
      audits: results.audits,
      duration_ms: results.durationMs,
    });

    return results;
  }
);
