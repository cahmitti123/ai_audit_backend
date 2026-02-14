/**
 * Automation Fiche Worker
 * =======================
 * Lightweight Inngest child workflow that processes a SINGLE fiche end-to-end:
 *   1. Fetch full details from CRM → cache in DB
 *   2. Transcribe recordings (if needed)
 *   3. Build timeline from DB transcriptions
 *   4. Run GPT analysis on all audit steps
 *   5. Calculate compliance + save audit to DB
 *
 * Invoked by the automation orchestrator via `step.invoke`.
 * Uses Inngest concurrency controls for bounded parallelism.
 *
 * This mirrors the standalone script's proven per-fiche logic, but runs
 * inside Inngest for durability, retries, and observability.
 */

import { NonRetriableError } from "inngest";

import { inngest } from "../../inngest/client.js";
import type { TimelineRecording, TranscriptionWord } from "../../schemas.js";
import { COMPLIANCE_THRESHOLDS } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { buildConversationChunksFromWords } from "../../utils/transcription-chunks.js";
import type { AuditConfigForAnalysis, ProductLinkResult } from "../audits/audits.types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProcessFicheResult = {
  ficheId: string;
  status: "success" | "skipped" | "failed";
  recordingsCount: number;
  transcribed?: number;
  auditDbId?: string;
  score?: number;
  niveau?: string;
  error?: string;
  durationMs: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toTranscriptionWords(value: unknown): TranscriptionWord[] | null {
  if (!isRecord(value)) {return null;}
  const wordsRaw = value.words;
  if (!Array.isArray(wordsRaw) || wordsRaw.length === 0) {return null;}

  const words: TranscriptionWord[] = [];
  for (const w of wordsRaw) {
    if (!isRecord(w)) {continue;}
    const text = typeof w.text === "string" ? w.text : null;
    const start = typeof w.start === "number" ? w.start : null;
    const end = typeof w.end === "number" ? w.end : null;
    const type = typeof w.type === "string" ? w.type : "word";
    const speaker_id = typeof w.speaker_id === "string" ? (w.speaker_id as string) : undefined;
    const logprob = typeof w.logprob === "number" ? w.logprob : undefined;
    if (text === null || start === null || end === null) {continue;}
    words.push({ text, start, end, type, ...(speaker_id ? { speaker_id } : {}), ...(logprob !== undefined ? { logprob } : {}) });
  }
  return words.length > 0 ? words : null;
}

function buildSyntheticWordsFromText(text: string, durationSeconds: number | null): TranscriptionWord[] {
  const textWords = text.split(/\s+/).filter(Boolean);
  if (textWords.length === 0) {return [];}
  const duration = typeof durationSeconds === "number" && durationSeconds > 0 ? durationSeconds : Math.max(1, Math.round(textWords.length * 0.5));
  const wordDur = Math.max(0.05, duration / Math.max(1, textWords.length));
  return textWords.map((word, idx) => ({
    text: word,
    start: idx * wordDur,
    end: (idx + 1) * wordDur,
    type: "word",
    speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
  }));
}

/**
 * Build timeline from DB-stored transcriptions.
 * Same logic as `rebuildTimelineFromDatabase` in audits.workflows.ts.
 */
async function rebuildTimelineFromDatabase(ficheId: string): Promise<TimelineRecording[]> {
  const { getRecordingsWithTranscriptionChunksByFiche } = await import(
    "../recordings/recordings.repository.js"
  );
  const dbRecordings = await getRecordingsWithTranscriptionChunksByFiche(ficheId);
  const timeline: TimelineRecording[] = [];

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription) {continue;}
    if (!dbRec.recordingUrl) {continue;}

    let chunks = dbRec.transcriptionChunks.map((ch) => ({
      chunk_index: ch.chunkIndex,
      start_timestamp: ch.startTimestamp,
      end_timestamp: ch.endTimestamp,
      message_count: ch.messageCount,
      speakers: ch.speakers,
      full_text: ch.fullText,
    }));

    if (chunks.length === 0) {
      const payload = dbRec.transcriptionData;
      const words = toTranscriptionWords(payload);
      if (words) {
        chunks = buildConversationChunksFromWords(words);
      } else if (typeof dbRec.transcriptionText === "string" && dbRec.transcriptionText.trim()) {
        chunks = buildConversationChunksFromWords(
          buildSyntheticWordsFromText(dbRec.transcriptionText, dbRec.durationSeconds)
        );
      } else {
        continue;
      }
    }

    timeline.push({
      recording_index: timeline.length,
      call_id: dbRec.callId,
      start_time: dbRec.startTime?.toISOString() || "",
      duration_seconds: dbRec.durationSeconds ?? 0,
      recording_url: dbRec.recordingUrl,
      recording_date: dbRec.recordingDate ?? "",
      recording_time: dbRec.recordingTime ?? "",
      from_number: dbRec.fromNumber ?? "",
      to_number: dbRec.toNumber ?? "",
      total_chunks: chunks.length,
      chunks,
    });
  }
  return timeline;
}

/**
 * Enrich citations with recording metadata from timeline.
 */
function enrichCitationsWithMetadata(
  auditResults: { steps: unknown[] },
  timeline: ReadonlyArray<TimelineRecording>
) {
  const timelineMap = new Map(
    timeline.map((rec) => [
      rec.recording_index,
      {
        recording_date: rec.recording_date || "N/A",
        recording_time: rec.recording_time || "N/A",
        recording_url: rec.recording_url || "N/A",
      },
    ])
  );

  for (const step of auditResults.steps) {
    if (!isRecord(step)) {continue;}
    const points = (step as { points_controle?: unknown }).points_controle;
    if (!Array.isArray(points)) {continue;}
    for (const cp of points) {
      const citations = (cp as { citations?: unknown }).citations;
      if (!Array.isArray(citations)) {continue;}
      for (const cit of citations as Array<{
        recording_index: number;
        recording_date?: string;
        recording_time?: string;
        recording_url?: string;
      }>) {
        const meta = timelineMap.get(cit.recording_index);
        if (meta) {
          cit.recording_date = meta.recording_date;
          cit.recording_time = meta.recording_time;
          cit.recording_url = meta.recording_url;
        } else {
          cit.recording_date = "N/A";
          cit.recording_time = "N/A";
          cit.recording_url = "N/A";
        }
      }
    }
  }
}

// ─── Concurrency config ───────────────────────────────────────────────────────

const GLOBAL_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTOMATION_FICHE_WORKER_CONCURRENCY || 5)
);
const PER_SCHEDULE_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTOMATION_FICHE_WORKER_PER_SCHEDULE_CONCURRENCY || 3)
);
const HARD_MAX_RECORDINGS = 50;

// ─── Inngest Function ─────────────────────────────────────────────────────────

export const processFicheFunction = inngest.createFunction(
  {
    id: "automation-process-fiche",
    name: "Automation: Process Single Fiche",
    retries: 2,
    timeouts: {
      finish: "1h",
    },
    concurrency: [
      { limit: GLOBAL_CONCURRENCY },
      { key: "event.data.schedule_id", limit: PER_SCHEDULE_CONCURRENCY },
    ],
  },
  { event: "automation/process-fiche" },
  async ({ event, step }): Promise<ProcessFicheResult> => {
    const {
      fiche_id,
      audit_config_id,
      schedule_id,
      run_id,
      run_transcription,
      run_audits,
      max_recordings,
      only_with_recordings,
      use_rlm,
    } = event.data as {
      fiche_id: string;
      audit_config_id: number;
      schedule_id: string;
      run_id: string;
      run_transcription: boolean;
      run_audits: boolean;
      max_recordings?: number;
      only_with_recordings?: boolean;
      use_rlm?: boolean;
    };

    const ficheId = fiche_id;
    const maxRecordings = typeof max_recordings === "number" && max_recordings > 0
      ? Math.min(max_recordings, HARD_MAX_RECORDINGS)
      : HARD_MAX_RECORDINGS;

    const ficheStart = await step.run("capture-start-time", async () => Date.now());
    const startTime = typeof ficheStart === "number" ? ficheStart : Date.now();

    logger.info("Processing fiche", {
      fiche_id: ficheId,
      audit_config_id,
      schedule_id,
      run_id,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Fetch full details from CRM and cache in DB
    // ─────────────────────────────────────────────────────────────────────────

    const detailsResult = await step.run("fetch-details", async () => {
      const { fetchFicheDetails } = await import("../fiches/fiches.api.js");
      const { cacheFicheDetails } = await import("../fiches/fiches.cache.js");

      try {
        const ficheData = await fetchFicheDetails(ficheId);

        if (ficheData.recordings) {
          ficheData.recordings = ficheData.recordings.map(enrichRecording);
        }

        const cacheResult = await cacheFicheDetails(ficheData);
        const recordingsCount = ficheData.recordings?.length ?? 0;

        const prospect = ficheData.prospect
          ? `${ficheData.prospect.prenom || ""} ${ficheData.prospect.nom || ""}`.trim()
          : "N/A";

        logger.info("Fiche details fetched", {
          fiche_id: ficheId,
          recordings: recordingsCount,
          prospect,
          cache_id: String(cacheResult.id),
        });

        return {
          ok: true as const,
          recordingsCount,
          cacheId: String(cacheResult.id),
          prospect,
        };
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          return { ok: false as const, notFound: true, error: "Fiche not found (404)" };
        }
        throw err; // let Inngest retry transient errors
      }
    });

    // Handle NOT_FOUND
    if (!detailsResult.ok) {
      logger.warn("Fiche not found — skipping", { fiche_id: ficheId });
      return {
        ficheId,
        status: "skipped",
        recordingsCount: 0,
        error: detailsResult.error,
        durationMs: Date.now() - startTime,
      };
    }

    const recordingsCount = typeof detailsResult.recordingsCount === "number"
      ? detailsResult.recordingsCount
      : 0;

    // Guard: too many recordings
    if (recordingsCount > maxRecordings) {
      logger.warn("Too many recordings — skipping", {
        fiche_id: ficheId,
        recordings: recordingsCount,
        max: maxRecordings,
      });
      return {
        ficheId,
        status: "skipped",
        recordingsCount,
        error: `Too many recordings (${recordingsCount}>${maxRecordings})`,
        durationMs: Date.now() - startTime,
      };
    }

    // Guard: no recordings (if onlyWithRecordings)
    if (only_with_recordings && recordingsCount === 0) {
      return {
        ficheId,
        status: "skipped",
        recordingsCount: 0,
        error: "No recordings",
        durationMs: Date.now() - startTime,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Transcribe recordings
    // ─────────────────────────────────────────────────────────────────────────

    if (run_transcription && recordingsCount > 0) {
      await step.run("transcribe", async () => {
        const { normalizeElevenLabsApiKey } = await import(
          "../transcriptions/transcriptions.elevenlabs.js"
        );
        const { transcribeFicheRecordings } = await import(
          "../transcriptions/transcriptions.service.js"
        );

        const apiKey = normalizeElevenLabsApiKey(process.env.ELEVENLABS_API_KEY);
        if (!apiKey) {
          throw new NonRetriableError("ELEVENLABS_API_KEY not configured");
        }

        const txResult = await transcribeFicheRecordings(ficheId, apiKey);

        logger.info("Transcription complete", {
          fiche_id: ficheId,
          total: txResult.total,
          transcribed: txResult.transcribed,
          new: txResult.newTranscriptions,
          failed: txResult.failed ?? 0,
        });

        return {
          total: txResult.total,
          transcribed: txResult.transcribed,
          newTranscriptions: txResult.newTranscriptions,
          failed: txResult.failed ?? 0,
        };
      });
    }

    // If runAudits is false, stop here (only fetch + transcribe were needed)
    if (run_audits === false) {
      logger.info("run_audits=false — skipping audit analysis", { fiche_id: ficheId });
      return {
        ficheId,
        status: "success",
        recordingsCount,
        durationMs: Date.now() - startTime,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Build timeline from DB (fast step, ~1-5s)
    //         Separated from analysis so Inngest can checkpoint between the
    //         fast DB read and the long GPT analysis.
    // ─────────────────────────────────────────────────────────────────────────

    const timelineCheck = await step.run("build-timeline", async () => {
      const timeline = await rebuildTimelineFromDatabase(ficheId);
      const totalChunks = timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0);

      logger.info("Timeline built", {
        fiche_id: ficheId,
        recordings: timeline.length,
        chunks: totalChunks,
      });

      return {
        recordings: timeline.length,
        chunks: totalChunks,
        empty: timeline.length === 0,
      };
    });

    // Handle empty timeline (no transcribed recordings)
    if (timelineCheck.empty) {
      return {
        ficheId,
        status: "skipped",
        recordingsCount,
        error: "No transcribed recordings (empty timeline)",
        durationMs: Date.now() - startTime,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: GPT analysis + calculate compliance + save audit to DB
    //         This is the heavy step (~5-15min). It rebuilds the timeline
    //         from DB (fast) since we can't pass large objects between steps.
    // ─────────────────────────────────────────────────────────────────────────

    const auditResult = await step.run("analyze-and-save", async () => {
      // 4a. Load audit config
      const { getAuditConfigById } = await import(
        "../audit-configs/audit-configs.repository.js"
      );
      const configRow = await getAuditConfigById(BigInt(audit_config_id));
      if (!configRow) {
        throw new NonRetriableError(`Audit config ${audit_config_id} not found`);
      }
      const auditConfig: AuditConfigForAnalysis = {
        id: configRow.id.toString(),
        name: configRow.name,
        description: configRow.description,
        systemPrompt: configRow.systemPrompt,
        auditSteps: configRow.steps,
      };

      // 4b. Rebuild timeline from DB (fast — data is already in DB from step 3 check)
      const timeline = await rebuildTimelineFromDatabase(ficheId);
      const totalChunks = timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0);

      if (timeline.length === 0) {
        // Defensive: should not happen (checked in step 3), but handle gracefully
        return {
          status: "skipped" as const,
          error: "No transcribed recordings (empty timeline on rebuild)",
        };
      }

      // 4c. Link product (optional)
      let productInfo: ProductLinkResult | null = null;
      const needsProduct = auditConfig.auditSteps.some((s) => s.verifyProductInfo === true);
      if (needsProduct) {
        try {
          const { linkFicheToProduct } = await import("../products/products.service.js");
          const linkResult = await linkFicheToProduct(ficheId);
          if (linkResult.matched && linkResult.formule) {
            productInfo = linkResult;
          }
        } catch {
          // non-fatal
        }
      }

      // 4d. Run GPT analysis (the heavy part — ~5-15 minutes)
      const { analyzeAllSteps } = await import("../audits/audits.analyzer.js");
      const { buildTimelineText } = await import("../audits/audits.prompts.js");

      const auditId = `automation-fiche-${ficheId}-cfg${audit_config_id}-${Date.now()}`;
      const timelineText = buildTimelineText(timeline);

      const analysisResults = await analyzeAllSteps(
        auditConfig,
        timeline,
        timelineText,
        auditId,
        ficheId,
        productInfo,
        ...(use_rlm ? [{ model: undefined, auditDbId: undefined }] : [])
      );

      enrichCitationsWithMetadata(analysisResults, timeline);

      logger.info("Analysis complete", {
        fiche_id: ficheId,
        successful_steps: analysisResults.statistics.successful,
        failed_steps: analysisResults.statistics.failed,
        tokens: analysisResults.statistics.total_tokens,
      });

      // 4e. Calculate compliance
      const totalWeight = auditConfig.auditSteps.reduce((sum, s) => sum + s.weight, 0);
      const earnedWeight = analysisResults.steps.reduce((sum, s) => {
        const score = (s as { score?: unknown }).score;
        if (typeof score !== "number") {return sum;}
        const metaWeight = (s as { step_metadata?: { weight?: unknown } }).step_metadata?.weight;
        const maxWeight = typeof metaWeight === "number" ? metaWeight : score;
        return sum + Math.min(score, maxWeight);
      }, 0);

      const scorePercent = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

      const criticalTotal = auditConfig.auditSteps.filter((s) => s.isCritical).length;
      const criticalPassed = analysisResults.steps.filter((s) => {
        const meta = (s as { step_metadata?: { is_critical?: unknown } }).step_metadata;
        const isCritical = Boolean(meta && (meta as { is_critical?: unknown }).is_critical);
        const conforme = (s as { conforme?: unknown }).conforme;
        return isCritical && conforme === "CONFORME";
      }).length;

      let niveau = "INSUFFISANT";
      if (criticalPassed < criticalTotal) {
        niveau = "REJET";
      } else if (scorePercent >= COMPLIANCE_THRESHOLDS.EXCELLENT) {
        niveau = "EXCELLENT";
      } else if (scorePercent >= COMPLIANCE_THRESHOLDS.BON) {
        niveau = "BON";
      } else if (scorePercent >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) {
        niveau = "ACCEPTABLE";
      }

      const compliance = {
        score: Number(scorePercent.toFixed(2)),
        niveau,
        points_critiques: `${criticalPassed}/${criticalTotal}`,
        poids_obtenu: earnedWeight,
        poids_total: totalWeight,
      };

      // 4f. Save audit to DB
      const { getCachedFiche } = await import("../fiches/fiches.repository.js");
      const { saveAuditResult } = await import("../audits/audits.repository.js");

      const cachedFiche = await getCachedFiche(ficheId);
      if (!cachedFiche) {
        throw new Error(`Fiche ${ficheId} not found in cache — cannot save audit`);
      }

      const prospectName =
        `${cachedFiche.prospectPrenom || ""} ${cachedFiche.prospectNom || ""}`.trim() || "N/A";
      const groupe =
        typeof cachedFiche.groupe === "string" && cachedFiche.groupe.trim()
          ? cachedFiche.groupe.trim()
          : "N/A";

      const now = Date.now();
      const savedAudit = await saveAuditResult(
        {
          audit: {
            config: { id: auditConfig.id, name: auditConfig.name, description: auditConfig.description },
            fiche: { fiche_id: ficheId, prospect_name: prospectName, groupe },
            results: { ...analysisResults, compliance },
            compliance,
          },
          statistics: {
            recordings_count: timeline.length,
            transcriptions_count: timeline.length,
            timeline_chunks: totalChunks,
            successful_steps: analysisResults.statistics.successful,
            failed_steps: analysisResults.statistics.failed,
            total_time_seconds: analysisResults.statistics.total_time_seconds,
            total_tokens: analysisResults.statistics.total_tokens,
          },
          metadata: {
            started_at: new Date(startTime).toISOString(),
            completed_at: new Date(now).toISOString(),
            duration_ms: now - startTime,
          },
        },
        cachedFiche.id
      );

      logger.info("Audit saved", {
        fiche_id: ficheId,
        audit_id: String(savedAudit.id),
        score: compliance.score,
        niveau: compliance.niveau,
      });

      return {
        status: "success" as const,
        auditDbId: String(savedAudit.id),
        score: compliance.score,
        niveau: compliance.niveau,
        tokens: analysisResults.statistics.total_tokens,
      };
    });

    // Handle skipped from analyze step (defensive — should not happen after timeline check)
    if (auditResult.status === "skipped") {
      return {
        ficheId,
        status: "skipped",
        recordingsCount,
        error: auditResult.error,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      ficheId,
      status: "success",
      recordingsCount,
      auditDbId: auditResult.auditDbId ?? undefined,
      score: typeof auditResult.score === "number" ? auditResult.score : undefined,
      niveau: typeof auditResult.niveau === "string" ? auditResult.niveau : undefined,
      durationMs: Date.now() - startTime,
    };
  }
);
