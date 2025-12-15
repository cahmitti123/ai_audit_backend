/**
 * Audit Step Re-Run Service
 * ===========================
 * Allows re-running a single audit step with optional custom prompt
 */

import { generateTimeline } from "./audits.timeline.js";
import { buildTimelineText } from "./audits.prompts.js";
import { analyzeStep } from "./audits.analyzer.js";
import { getAuditById } from "./audits.repository.js";
import { getRecordingsByFiche } from "../recordings/recordings.repository.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { getAuditConfigById } from "../audit-configs/audit-configs.repository.js";
import { logger } from "../../shared/logger.js";
import type { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
import type { Transcription, TranscriptionWord, TimelineRecording } from "../../schemas.js";
import type { AuditConfigForAnalysis, AuditStepDefinition, ProductLinkResult } from "./audits.types.js";

export interface RerunStepOptions {
  auditId: bigint;
  stepPosition: number;
  customPrompt?: string; // User's additional instructions
  customInstructions?: string; // Alternative way to provide guidance
}

type RerunAnalyzedStep = Awaited<ReturnType<typeof analyzeStep>>;

export interface RerunStepResult {
  success: boolean;
  originalStep: {
    score: number;
    conforme: string;
    commentaire: string;
    citations: number;
  };
  rerunStep: RerunAnalyzedStep;
  comparison: {
    scoreChanged: boolean;
    conformeChanged: boolean;
    citationsChanged: boolean;
    originalScore: number;
    newScore: number;
    originalConforme: string;
    newConforme: string;
  };
  metadata: {
    rerunAt: string;
    durationMs: number;
    tokensUsed: number;
  };
}

/**
 * Regenerate timeline from database for a fiche
 */
async function regenerateTimelineFromDatabase(ficheId: string) {
  logger.info("Regenerating timeline from DB", { fiche_id: ficheId });

  // Load fiche cache
  const ficheCache = await getCachedFiche(ficheId);
  if (!ficheCache) {
    throw new Error(`Fiche ${ficheId} not found in cache`);
  }

  // Load recordings with transcriptions
  const dbRecordings = await getRecordingsByFiche(ficheId);
  logger.info("Loaded recordings from database", {
    fiche_id: ficheId,
    recordings: dbRecordings.length,
  });

  // Get raw fiche data for recording enrichment
  const ficheData = ficheCache.rawData as unknown as FicheDetailsResponse;
  const rawRecordings = ficheData.recordings || [];

  // Build transcriptions array (same logic as workflow)
  const transcriptions: Transcription[] = [];

  const hasWordsArray = (value: unknown): value is { words: unknown[] } =>
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { words?: unknown }).words);

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription || !dbRec.transcriptionId) {
      logger.warn("Skipping recording (no transcription)", {
        fiche_id: ficheId,
        call_id: dbRec.callId,
      });
      continue;
    }

    // Find matching raw recording
    const rawRec = rawRecordings.find(
      (r) => {
        const maybe = r as { call_id?: unknown; callId?: unknown };
        const callId =
          typeof maybe.call_id === "string"
            ? maybe.call_id
            : typeof maybe.callId === "string"
              ? maybe.callId
              : null;
        return callId === dbRec.callId;
      }
    );
    if (!rawRec) {
      logger.warn("Could not find raw recording", {
        fiche_id: ficheId,
        call_id: dbRec.callId,
      });
      continue;
    }

    const enrichedRec = enrichRecording(rawRec);
    const url = enrichedRec.recording_url;

    if (!url) {
      logger.warn("Missing URL for recording", {
        fiche_id: ficheId,
        call_id: dbRec.callId,
      });
      continue;
    }

    // Load transcription from database (prefer full payload with word timestamps)
    let transcriptionData: {
      text: string;
      language_code?: string;
      words: TranscriptionWord[];
    };
    const dbPayload = dbRec.transcriptionData;

    if (
      dbPayload &&
      typeof dbPayload === "object" &&
      hasWordsArray(dbPayload) &&
      dbPayload.words.length > 0
    ) {
      transcriptionData = dbPayload as unknown as {
        text: string;
        language_code?: string;
        words: TranscriptionWord[];
      };
    } else if (dbRec.transcriptionText && dbRec.transcriptionText.trim().length > 0) {
      const textWords = dbRec.transcriptionText.split(/\s+/).filter(Boolean);
      const durationSeconds =
        typeof dbRec.durationSeconds === "number" && dbRec.durationSeconds > 0
          ? dbRec.durationSeconds
          : Math.max(1, Math.round(textWords.length * 0.5));
      const wordDur = Math.max(0.05, durationSeconds / Math.max(1, textWords.length));

      const words = textWords.map((word, idx) => ({
        text: word,
        start: idx * wordDur,
        end: (idx + 1) * wordDur,
        type: "word" as const,
        // Speaker unknown without diarization; keep expected shape.
        speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
      }));

      transcriptionData = {
        text: dbRec.transcriptionText,
        language_code: "fr",
        words,
      };
    } else {
      logger.warn("Recording has no transcription data", {
        fiche_id: ficheId,
        call_id: dbRec.callId,
      });
      continue;
    }

    transcriptions.push({
      recording_url: url,
      transcription_id: dbRec.transcriptionId,
      call_id: dbRec.callId,
      recording: enrichedRec,
      transcription: transcriptionData,
    });
  }

  logger.info("Built transcriptions for timeline", {
    fiche_id: ficheId,
    transcriptions: transcriptions.length,
  });

  // Generate timeline
  const timeline = generateTimeline(transcriptions);
  const timelineText = buildTimelineText(timeline);

  logger.info("Timeline regenerated", {
    fiche_id: ficheId,
    recordings: timeline.length,
    chunks: timeline.reduce((sum, r) => sum + r.total_chunks, 0),
  });

  return { timeline, timelineText };
}

/**
 * Rerun a single audit step
 */
export async function rerunAuditStep(
  options: RerunStepOptions
): Promise<RerunStepResult> {
  const startTime = Date.now();

  logger.info("Re-running audit step", {
    audit_id: String(options.auditId),
    step_position: options.stepPosition,
  });

  // 1. Load original audit
  const audit = await getAuditById(options.auditId);
  if (!audit) {
    throw new Error(`Audit ${options.auditId} not found`);
  }

  const ficheId = audit.ficheCache.ficheId;
  logger.debug("Rerun context", { fiche_id: ficheId });

  // 2. Find original step result
  const originalStepResult = audit.stepResults.find(
    (s) => s.stepPosition === options.stepPosition
  );
  if (!originalStepResult) {
    throw new Error(
      `Step ${options.stepPosition} not found in audit ${options.auditId}`
    );
  }
  logger.debug("Original step", {
    step_position: options.stepPosition,
    step_name: originalStepResult.stepName,
  });

  // 3. Load audit configuration
  const auditConfig = await getAuditConfigById(audit.auditConfigId);
  if (!auditConfig) {
    throw new Error(`Audit config ${audit.auditConfigId} not found`);
  }

  const auditConfigData: AuditConfigForAnalysis = {
    id: auditConfig.id.toString(),
    name: auditConfig.name,
    description: auditConfig.description,
    systemPrompt: auditConfig.systemPrompt,
    auditSteps: auditConfig.steps,
  };

  // 4. Find step definition
  const stepDef = auditConfigData.auditSteps.find(
    (s) => s.position === options.stepPosition
  );
  if (!stepDef) {
    throw new Error(`Step definition not found for position ${options.stepPosition}`);
  }

  // 5. Regenerate timeline from database
  const { timeline, timelineText } = await regenerateTimelineFromDatabase(ficheId);

  // 6. Link to product if needed
  let productInfo: ProductLinkResult | null = null;
  if (stepDef.verifyProductInfo) {
    logger.info("Linking fiche to product database (rerun)", { fiche_id: ficheId });
    try {
      const { linkFicheToProduct } = await import(
        "../products/products.service.js"
      );
      const linkResult = (await linkFicheToProduct(ficheId)) as ProductLinkResult;
      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
        logger.info("Product matched (rerun)", {
          fiche_id: ficheId,
          formule: linkResult.formule.libelle,
        });
      }
    } catch (error: unknown) {
      logger.warn("Product linking failed (rerun)", {
        fiche_id: ficheId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 7. Add custom prompt if provided
  const stepForAnalysis: AuditStepDefinition =
    options.customPrompt || options.customInstructions
      ? {
          ...stepDef,
          customInstructions: `\n\n📝 INSTRUCTIONS SPÉCIFIQUES DE L'UTILISATEUR:\n${
            options.customPrompt || options.customInstructions
          }`,
        }
      : stepDef;

  if (options.customPrompt || options.customInstructions) {
    logger.info("Custom instructions added (rerun)", {
      audit_id: String(options.auditId),
      step_position: options.stepPosition,
    });
  }

  // 8. Re-analyze step
  logger.info("Re-analyzing step (rerun)", {
    audit_id: String(options.auditId),
    fiche_id: ficheId,
    step_position: options.stepPosition,
  });
  const rerunResult = await analyzeStep(
    stepForAnalysis,
    auditConfigData,
    timelineText,
    `rerun-${options.auditId}-step-${options.stepPosition}`,
    ficheId,
    productInfo
  );

  const duration = Date.now() - startTime;

  // 9. Compare results
  const rerunCitations = rerunResult.points_controle.reduce(
    (sum, pc) => sum + pc.citations.length,
    0
  );
  const comparison = {
    scoreChanged: originalStepResult.score !== rerunResult.score,
    conformeChanged: originalStepResult.conforme !== rerunResult.conforme,
    citationsChanged:
      originalStepResult.totalCitations !==
      rerunCitations,
    originalScore: originalStepResult.score,
    newScore: rerunResult.score,
    originalConforme: originalStepResult.conforme,
    newConforme: rerunResult.conforme,
  };

  logger.info("Re-run complete", {
    audit_id: String(options.auditId),
    fiche_id: ficheId,
    step_position: options.stepPosition,
    original: `${comparison.originalScore}/${stepDef.weight} (${comparison.originalConforme})`,
    rerun: `${comparison.newScore}/${stepDef.weight} (${comparison.newConforme})`,
    score_changed: comparison.scoreChanged,
  });

  return {
    success: true,
    originalStep: {
      score: originalStepResult.score,
      conforme: originalStepResult.conforme,
      commentaire: originalStepResult.commentaireGlobal,
      citations: originalStepResult.totalCitations,
    },
    rerunStep: rerunResult,
    comparison,
    metadata: {
      rerunAt: new Date().toISOString(),
      durationMs: duration,
      tokensUsed: rerunResult.usage?.total_tokens || 0,
    },
  };
}

/**
 * Save rerun result and optionally update audit
 */
export async function saveRerunResult(
  options: RerunStepOptions,
  rerunResult: RerunStepResult,
  updateAudit: boolean = false
): Promise<{ saved: boolean; auditUpdated: boolean }> {
  // TODO: Create a RerunHistory table to track step re-runs
  // For now, if updateAudit is true, we'd need to:
  // 1. Update the specific step result
  // 2. Recalculate overall compliance
  // 3. Create new audit version (version++)

  if (updateAudit) {
    logger.warn("Audit update not implemented (rerun)", {
      audit_id: String(options.auditId),
      step_position: options.stepPosition,
    });
  }

  return {
    saved: true,
    auditUpdated: false,
  };
}



