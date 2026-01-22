/**
 * Audit Runner
 * ============
 * Orchestrates the complete audit pipeline
 */

import "dotenv/config";

import { existsSync,mkdirSync, writeFileSync } from "fs";

import type { TimelineRecording } from "../../schemas.js";
import {
  COMPLIANCE_THRESHOLDS,
} from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import {
  getAuditConfigById,
  getLatestActiveConfig,
} from "../audit-configs/audit-configs.repository.js";
import { fetchFicheDetails } from "../fiches/fiches.api.js";
import { cacheFicheDetails } from "../fiches/fiches.cache.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import type { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
import { updateRecordingTranscription } from "../recordings/recordings.repository.js";
import { TranscriptionService } from "../transcriptions/transcriptions.elevenlabs.js";
import { analyzeAllSteps } from "./audits.analyzer.js";
import { buildTimelineText } from "./audits.prompts.js";
import { saveAuditResult } from "./audits.repository.js";
import { generateTimeline } from "./audits.timeline.js";
import type { AuditConfigForAnalysis, ProductLinkResult } from "./audits.types.js";

const DATA_DIR = "./data";

type AuditAnalysisResults = Awaited<ReturnType<typeof analyzeAllSteps>>;

/**
 * Enrich citations with recording metadata from timeline
 */
function enrichCitationsWithMetadata(
  auditResults: Pick<AuditAnalysisResults, "steps">,
  timeline: ReadonlyArray<TimelineRecording>
) {
  // Create a lookup map for quick access
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

  let enrichedCount = 0;
  let missingUrlCount = 0;

  // Iterate through all steps and their control points
  for (const step of auditResults.steps) {
    if (!("points_controle" in step)) {continue;}
    const points = (step as { points_controle?: unknown }).points_controle;
    if (!Array.isArray(points)) {continue;}

    for (const controlPoint of points) {
      const citations = (controlPoint as { citations?: unknown }).citations;
      if (!Array.isArray(citations)) {continue;}

      for (const citation of citations as Array<{ recording_index: number; recording_date?: string; recording_time?: string; recording_url?: string }>) {
        // Look up recording metadata using recording_index
        const metadata = timelineMap.get(citation.recording_index);
        if (metadata) {
          citation.recording_date = metadata.recording_date;
          citation.recording_time = metadata.recording_time;
          citation.recording_url = metadata.recording_url;
          enrichedCount++;

          if (!metadata.recording_url || metadata.recording_url === "N/A") {
            missingUrlCount++;
          }
        } else {
          // If no metadata found, set to N/A to make it explicit
          citation.recording_date = "N/A";
          citation.recording_time = "N/A";
          citation.recording_url = "N/A";
        }
      }
    }
  }

  logger.info("Enriched citations with recording metadata", {
    citations_enriched: enrichedCount,
  });
  if (missingUrlCount > 0) {
    logger.warn("Some citations have missing recording URLs", {
      missing_urls: missingUrlCount,
    });
  }

  return auditResults;
}

export interface AuditOptions {
  auditConfigId?: number;
  ficheId: string;
  useLatest?: boolean;
  saveToFile?: boolean;
}

export interface AuditResult {
  audit: {
    id: bigint;
    config: {
      id: string;
      name: string;
      description: string | null;
    };
    fiche: {
      fiche_id: string;
      prospect_name: string;
      groupe: string;
    };
    results: AuditAnalysisResults & {
      compliance: {
        score: number;
        niveau: string;
        points_critiques: string;
        poids_obtenu: number;
        poids_total: number;
      };
    };
    compliance: {
      score: number;
      niveau: string;
      points_critiques: string;
      poids_obtenu: number;
      poids_total: number;
    };
  };
  statistics: {
    recordings_count: number;
    transcriptions_count: number;
    timeline_chunks: number;
    successful_steps: number;
    failed_steps: number;
    total_time_seconds: number;
    total_tokens: number;
  };
  metadata: {
    started_at: string;
    completed_at: string;
    duration_ms: number;
  };
}

/**
 * Run complete audit pipeline
 */
export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  logger.info("AI audit pipeline started", {
    fiche_id: options.ficheId,
    audit_config_id: options.auditConfigId ?? null,
    use_latest: Boolean(options.useLatest),
  });

  // Create data directory
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FETCH FICHE DATA (with cache)
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("Step 1/5: Fetching fiche data", { fiche_id: options.ficheId });

  const cached = await getCachedFiche(options.ficheId);

  let ficheData: FicheDetailsResponse & { _salesListOnly?: boolean; cle?: string };
  let ficheCacheId: bigint;
  if (cached) {
    logger.info("Using cached fiche data", { fiche_id: options.ficheId });
    ficheData = cached.rawData as FicheDetailsResponse & { _salesListOnly?: boolean; cle?: string };
    ficheCacheId = cached.id;

    // Check if cached data is only sales list (minimal data without recordings)
    if (ficheData._salesListOnly) {
      logger.warn("Cached data is sales list only; fetching full details", {
        fiche_id: options.ficheId,
      });

      // Note: Product verification check will happen after config is loaded
      // For now, fetch without mail_devis (will refetch later if needed)
      ficheData = await fetchFicheDetails(options.ficheId);
      const refreshedCache = await cacheFicheDetails(ficheData as FicheDetailsResponse);
      ficheCacheId = refreshedCache.id;
      logger.info("Fiche refreshed with full details", {
        fiche_id: options.ficheId,
        fiche_cache_id: String(ficheCacheId),
      });
    }
  } else {
    logger.info("Cache miss; fetching fiche details from API", { fiche_id: options.ficheId });
    ficheData = await fetchFicheDetails(options.ficheId);
    const refreshedCache = await cacheFicheDetails(ficheData as FicheDetailsResponse);
    ficheCacheId = refreshedCache.id;
  }

  if (!ficheData.information) {
    throw new Error(`Fiche ${options.ficheId} is missing information section`);
  }
  if (!ficheData.prospect) {
    throw new Error(`Fiche ${options.ficheId} is missing prospect section`);
  }

  const info = ficheData.information;
  const prospect = ficheData.prospect;

  ficheData.recordings = ficheData.recordings.map(enrichRecording);

  logger.info("Fiche loaded", {
    fiche_id: info.fiche_id,
    recordings: ficheData.recordings.length,
    prospect: `${prospect.prenom} ${prospect.nom}`,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. LOAD AUDIT CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("Step 2/5: Loading audit configuration", { fiche_id: options.ficheId });

  let auditConfig: AuditConfigForAnalysis;
  if (options.useLatest) {
    const latest = await getLatestActiveConfig();
    if (!latest) {throw new Error("No active audit configuration found");}
    auditConfig = {
      id: latest.id.toString(),
      name: latest.name,
      description: latest.description,
      systemPrompt: latest.systemPrompt,
      auditSteps: latest.steps,
    };
  } else {
    if (!options.auditConfigId) {
      throw new Error("auditConfigId required when useLatest is false");
    }
    const config = await getAuditConfigById(BigInt(options.auditConfigId));
    if (!config) {throw new Error(`Audit config ${options.auditConfigId} not found`);}
    auditConfig = {
      id: config.id.toString(),
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      auditSteps: config.steps,
    };
  }

  logger.info("Audit config loaded", {
    config_id: String(auditConfig.id),
    name: auditConfig.name,
    steps: auditConfig.auditSteps.length,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2.5. CHECK PRODUCT VERIFICATION REQUIREMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  // If at least one audit step has verifyProductInfo=true, fetch product from database

  const needsProductInfo = auditConfig.auditSteps.some(
    (step) => step.verifyProductInfo === true
  );

  let productInfo: ProductLinkResult | null = null;

  if (needsProductInfo) {
    logger.info("Audit requires product verification; linking fiche to product DB", {
      fiche_id: options.ficheId,
    });

    try {
      // Import product service dynamically
      const { linkFicheToProduct } = await import(
        "../products/products.service.js"
      );

      // Link fiche to product
      const linkResult = await linkFicheToProduct(options.ficheId);

      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
        logger.info("Product matched successfully", {
          groupe: linkResult.formule.gamme.groupe.libelle,
          gamme: linkResult.formule.gamme.libelle,
          formule: linkResult.formule.libelle,
          garanties: linkResult.formule._counts.garanties,
          categories: linkResult.formule._counts.categories,
          items: linkResult.formule._counts.items,
        });
      } else {
        logger.warn("No matching product found in database", {
          searched: `${linkResult.searchCriteria.groupe_nom} > ${linkResult.searchCriteria.gamme_nom} > ${linkResult.searchCriteria.formule_nom}`,
        });
      }
    } catch (error: unknown) {
      logger.warn("Failed to link fiche to product", {
        fiche_id: options.ficheId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. TRANSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("Step 3/5: Transcribing audio", { fiche_id: options.ficheId });
  const transcriptionService = new TranscriptionService(
    process.env.ELEVENLABS_API_KEY!
  );

  const transcriptions = await transcriptionService.transcribeAll(
    ficheData.recordings
  );
  logger.info("Transcriptions completed", {
    fiche_id: options.ficheId,
    transcriptions: transcriptions.length,
  });

  // Update database with transcription IDs in parallel
  const dbUpdatePromises = transcriptions
    .filter((t) => t.transcription_id && t.call_id)
    .map((t) =>
      updateRecordingTranscription(
        ficheCacheId,
        t.call_id!,
        t.transcription_id!,
        t.transcription.text,
        t.transcription
      )
    );

  await Promise.all(dbUpdatePromises);
  logger.info("Saved transcription IDs and text to database", {
    count: dbUpdatePromises.length,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. GENERATE TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("Step 4/5: Generating timeline", { fiche_id: options.ficheId });
  const timeline = generateTimeline(transcriptions);
  const totalChunks = timeline.reduce((sum, r) => sum + r.total_chunks, 0);
  logger.info("Timeline generated", {
    recordings: timeline.length,
    chunks: totalChunks,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. RUN AUDIT
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("Step 5/5: Running AI audit", { fiche_id: options.ficheId });

  // Generate audit ID for webhook tracking
  const auditId = `audit-${options.ficheId}-${Date.now()}`;

  const timelineText = buildTimelineText(timeline);
  const auditResults = await analyzeAllSteps(
    auditConfig,
    timeline,
    timelineText,
    auditId,
    info.fiche_id,
    productInfo // Pass product database info to analyzer
  );

  // Enrich citations with recording metadata (date/time)
  enrichCitationsWithMetadata(auditResults, timeline);
  logger.info("Citations enriched with recording metadata");

  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATE COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════════════
  const totalWeight = auditConfig.auditSteps.reduce((sum, s) => sum + s.weight, 0);

  // Cap each step's score at its maximum weight
  const earnedWeight = auditResults.steps.reduce((sum, s) => {
    const score = (s as { score?: unknown }).score;
    if (typeof score !== "number") {return sum;}
    const metaWeight = (s as { step_metadata?: { weight?: unknown } }).step_metadata?.weight;
    const maxWeight = typeof metaWeight === "number" ? metaWeight : score;
    return sum + Math.min(score, maxWeight);
  }, 0);

  const score = (earnedWeight / totalWeight) * 100;

  const criticalTotal = auditConfig.auditSteps.filter((s) => s.isCritical).length;
  const criticalPassed = auditResults.steps.filter((s) => {
    const meta = (s as { step_metadata?: { is_critical?: unknown } }).step_metadata;
    const isCritical = Boolean(meta && (meta as { is_critical?: unknown }).is_critical);
    const conforme = (s as { conforme?: unknown }).conforme;
    return isCritical && conforme === "CONFORME";
  }).length;

  let niveau = "INSUFFISANT";
  if (criticalPassed < criticalTotal) {
    niveau = "REJET";
  } else if (score >= COMPLIANCE_THRESHOLDS.EXCELLENT) {
    niveau = "EXCELLENT";
  } else if (score >= COMPLIANCE_THRESHOLDS.BON) {
    niveau = "BON";
  } else if (score >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) {
    niveau = "ACCEPTABLE";
  }

  const compliance = {
    score: Number(score.toFixed(2)),
    niveau,
    points_critiques: `${criticalPassed}/${criticalTotal}`,
    poids_obtenu: earnedWeight,
    poids_total: totalWeight,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PREPARE RESULT
  // ═══════════════════════════════════════════════════════════════════════════
  const completedAt = new Date().toISOString();
  const duration = Date.now() - startTime;

  // Save to database first to get the ID
  const savedAudit = await saveAuditResult(
    {
      audit: {
        config: {
          id: auditConfig.id,
          name: auditConfig.name,
          description: auditConfig.description,
        },
        fiche: {
          fiche_id: info.fiche_id,
          prospect_name: `${prospect.prenom} ${prospect.nom}`,
          groupe: info.groupe,
        },
        results: {
          ...auditResults,
          compliance,
        },
        compliance,
      },
      statistics: {
        recordings_count: ficheData.recordings.length,
        transcriptions_count: transcriptions.length,
        timeline_chunks: totalChunks,
        successful_steps: auditResults.statistics.successful,
        failed_steps: auditResults.statistics.failed,
        total_time_seconds: auditResults.statistics.total_time_seconds,
        total_tokens: auditResults.statistics.total_tokens,
      },
      metadata: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: duration,
      },
    },
    ficheCacheId
  );

  logger.info("Audit saved to database", { audit_db_id: String(savedAudit.id) });

  const result: AuditResult = {
    audit: {
      id: savedAudit.id,
      config: {
        id: auditConfig.id,
        name: auditConfig.name,
        description: auditConfig.description,
      },
      fiche: {
        fiche_id: info.fiche_id,
        prospect_name: `${prospect.prenom} ${prospect.nom}`,
        groupe: info.groupe,
      },
      results: {
        ...auditResults,
        compliance,
      },
      compliance,
    },
    statistics: {
      recordings_count: ficheData.recordings.length,
      transcriptions_count: transcriptions.length,
      timeline_chunks: totalChunks,
      successful_steps: auditResults.statistics.successful,
      failed_steps: auditResults.statistics.failed,
      total_time_seconds: auditResults.statistics.total_time_seconds,
      total_tokens: auditResults.statistics.total_tokens,
    },
    metadata: {
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: duration,
    },
  };

  // Save to file if requested
  if (options.saveToFile !== false) {
    const filename = `${DATA_DIR}/audit_${options.ficheId}_${Date.now()}.json`;
    writeFileSync(filename, JSON.stringify(result, null, 2));
    logger.info("Results saved to file", { filename });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  logger.info("AUDIT COMPLETED", {
    score_pct: Number(score.toFixed(2)),
    niveau,
    critical: `${criticalPassed}/${criticalTotal}`,
    duration_seconds: Number((duration / 1000).toFixed(1)),
  });

  return result;
}
