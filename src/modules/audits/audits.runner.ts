/**
 * Audit Runner
 * ============
 * Orchestrates the complete audit pipeline
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { TranscriptionService } from "../transcriptions/transcriptions.elevenlabs.js";
import { generateTimeline } from "./audits.timeline.js";
import { analyzeAllSteps } from "./audits.analyzer.js";
import { buildTimelineText } from "./audits.prompts.js";
import {
  getAuditConfigById,
  getLatestActiveConfig,
} from "../audit-configs/audit-configs.repository.js";
import { enrichRecording } from "../../utils/recording-parser.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { cacheFicheDetails } from "../fiches/fiches.cache.js";
import { fetchFicheDetails } from "../fiches/fiches.api.js";
import { saveAuditResult } from "./audits.repository.js";
import { updateRecordingTranscription } from "../recordings/recordings.repository.js";
import {
  COMPLIANCE_THRESHOLDS,
  TIMELINE_CHUNK_SIZE,
} from "../../shared/constants.js";
import "dotenv/config";
import { FicheDetailsResponse } from "../fiches/fiches.schemas.js";
const DATA_DIR = "./data";

/**
 * Enrich citations with recording metadata from timeline
 */
function enrichCitationsWithMetadata(auditResults: any, timeline: any[]) {
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
    if (!step.points_controle) continue;

    for (const controlPoint of step.points_controle) {
      if (!controlPoint.citations) continue;

      for (const citation of controlPoint.citations) {
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

  console.log(`✓ Enriched ${enrichedCount} citations with recording metadata`);
  if (missingUrlCount > 0) {
    console.warn(
      `⚠️  ${missingUrlCount} citations have missing recording URLs`
    );
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
      description?: string;
    };
    fiche: {
      fiche_id: string;
      prospect_name: string;
      groupe: string;
    };
    results: any;
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

  console.log("\n" + "=".repeat(80));
  console.log("AI AUDIT PIPELINE");
  console.log("=".repeat(80));

  // Create data directory
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FETCH FICHE DATA (with cache)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n📂 Step 1/5: Fetching fiche data");

  const cached = await getCachedFiche(options.ficheId);

  let ficheData: any;
  let ficheCache: any;
  if (cached) {
    console.log(`✓ Using cached fiche data`);
    ficheData = cached.rawData;
    ficheCache = cached;

    // Check if cached data is only sales list (minimal data without recordings)
    if (ficheData._salesListOnly) {
      console.log(
        `⚠️ Cached data is sales list only, fetching full details...`
      );
      const cle = ficheData.cle;
      if (!cle) {
        throw new Error(
          `Cannot fetch fiche ${options.ficheId}: missing cle parameter`
        );
      }

      // Note: Product verification check will happen after config is loaded
      // For now, fetch without mail_devis (will refetch later if needed)
      ficheData = await fetchFicheDetails(options.ficheId, cle);
      ficheCache = await cacheFicheDetails(ficheData as FicheDetailsResponse);
      console.log(`✓ Fiche refreshed with full details (ID: ${ficheCache.id})`);
    }
  } else {
    throw new Error(
      `Fiche ${options.ficheId} not found in cache. Fetch via date range endpoint first to get cle.`
    );
  }

  ficheData.recordings = ficheData.recordings.map(enrichRecording);

  console.log(`✓ Fiche ID: ${ficheData.information.fiche_id}`);
  console.log(`✓ Recordings: ${ficheData.recordings.length}`);
  console.log(
    `✓ Prospect: ${ficheData.prospect.prenom} ${ficheData.prospect.nom}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. LOAD AUDIT CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n📋 Step 2/5: Loading audit configuration");

  let auditConfig: any;
  if (options.useLatest) {
    auditConfig = await getLatestActiveConfig();
    if (!auditConfig) {
      throw new Error("No active audit configuration found");
    }
  } else {
    if (!options.auditConfigId) {
      throw new Error("auditConfigId required when useLatest is false");
    }
    const config = await getAuditConfigById(BigInt(options.auditConfigId));
    if (!config) {
      throw new Error(`Audit config ${options.auditConfigId} not found`);
    }
    // Convert Prisma result to expected format
    auditConfig = {
      id: config.id.toString(),
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      auditSteps: config.steps,
    };
  }

  console.log(`✓ Config: ${auditConfig.name}`);
  console.log(`✓ Config ID: ${auditConfig.id}`);
  console.log(`✓ Steps: ${auditConfig.auditSteps.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2.5. CHECK PRODUCT VERIFICATION REQUIREMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  // If any audit step has verifyProductInfo=true, fetch product from database

  const needsProductInfo = auditConfig.auditSteps.some(
    (step: any) => step.verifyProductInfo === true
  );

  let productInfo: any = null;

  if (needsProductInfo) {
    console.log(
      `\nℹ️  Audit requires product verification - linking fiche to product database`
    );

    try {
      // Import product service dynamically
      const { linkFicheToProduct } = await import(
        "../products/products.service.js"
      );

      // Link fiche to product
      const linkResult = await linkFicheToProduct(options.ficheId);

      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
        console.log(`✓ Product matched successfully`);
        console.log(`✓ Groupe: ${linkResult.formule.gamme.groupe.libelle}`);
        console.log(`✓ Gamme: ${linkResult.formule.gamme.libelle}`);
        console.log(`✓ Formule: ${linkResult.formule.libelle}`);
        console.log(`✓ Garanties: ${linkResult.formule._counts.garanties}`);
        console.log(`✓ Categories: ${linkResult.formule._counts.categories}`);
        console.log(`✓ Items: ${linkResult.formule._counts.items}`);
      } else {
        console.warn(
          `⚠️  No matching product found in database:` +
            `\n   Searched: ${linkResult.searchCriteria.groupe_nom} > ${linkResult.searchCriteria.gamme_nom} > ${linkResult.searchCriteria.formule_nom}` +
            `\n   Audit will proceed without product verification`
        );
      }
    } catch (error: any) {
      console.warn(
        `⚠️  Failed to link fiche to product: ${error.message}` +
          `\n   Audit will proceed without product verification`
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. TRANSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n🎤 Step 3/5: Transcribing audio");
  const transcriptionService = new TranscriptionService(
    process.env.ELEVENLABS_API_KEY!
  );

  const transcriptions = await transcriptionService.transcribeAll(
    ficheData.recordings
  );
  console.log(`✓ Transcriptions completed: ${transcriptions.length}`);

  // Update database with transcription IDs in parallel
  if (ficheCache) {
    const dbUpdatePromises = transcriptions
      .filter((t) => t.transcription_id && t.call_id)
      .map((t) =>
        updateRecordingTranscription(
          ficheCache.id,
          t.call_id!,
          t.transcription_id!,
          t.transcription.text
        )
      );

    await Promise.all(dbUpdatePromises);
    console.log(
      `✓ ${dbUpdatePromises.length} transcription IDs and text saved to database`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. GENERATE TIMELINE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n📊 Step 4/5: Generating timeline");
  const timeline = generateTimeline(transcriptions);
  const totalChunks = timeline.reduce((sum, r) => sum + r.total_chunks, 0);
  console.log(
    `✓ Timeline: ${timeline.length} recordings, ${totalChunks} chunks`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. RUN AUDIT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n🤖 Step 5/5: Running AI audit");

  // Generate audit ID for webhook tracking
  const auditId = `audit-${options.ficheId}-${Date.now()}`;

  const timelineText = buildTimelineText(timeline);
  const auditResults = await analyzeAllSteps(
    auditConfig,
    timeline,
    timelineText,
    auditId,
    ficheData.information.fiche_id,
    productInfo // Pass product database info to analyzer
  );

  // Enrich citations with recording metadata (date/time)
  enrichCitationsWithMetadata(auditResults, timeline);
  console.log("✓ Citations enriched with recording metadata");

  // ═══════════════════════════════════════════════════════════════════════════
  // CALCULATE COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════════════
  const totalWeight = auditConfig.auditSteps.reduce(
    (sum: number, s: any) => sum + s.weight,
    0
  );

  // Cap each step's score at its maximum weight
  const earnedWeight = auditResults.steps
    .filter((s: any) => s.score !== undefined)
    .reduce((sum: number, s: any) => {
      const maxWeight = s.step_metadata?.weight || s.score;
      const cappedScore = Math.min(s.score, maxWeight);
      return sum + cappedScore;
    }, 0);

  const score = (earnedWeight / totalWeight) * 100;

  const criticalTotal = auditConfig.auditSteps.filter(
    (s: any) => s.isCritical
  ).length;
  const criticalPassed = auditResults.steps.filter(
    (s: any) => s.step_metadata?.is_critical && s.conforme === "CONFORME"
  ).length;

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
          fiche_id: ficheData.information.fiche_id,
          prospect_name: `${ficheData.prospect.prenom} ${ficheData.prospect.nom}`,
          groupe: ficheData.information.groupe,
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
    ficheCache.id
  );

  console.log(`\n💾 Audit saved to database (ID: ${savedAudit.id})`);

  const result: AuditResult = {
    audit: {
      id: savedAudit.id,
      config: {
        id: auditConfig.id,
        name: auditConfig.name,
        description: auditConfig.description,
      },
      fiche: {
        fiche_id: ficheData.information.fiche_id,
        prospect_name: `${ficheData.prospect.prenom} ${ficheData.prospect.nom}`,
        groupe: ficheData.information.groupe,
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
    console.log(`💾 Results saved: ${filename}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(80));
  console.log("✅ AUDIT COMPLETED");
  console.log("=".repeat(80));
  console.log(`Score: ${score.toFixed(2)}%`);
  console.log(`Niveau: ${niveau}`);
  console.log(`Points critiques: ${criticalPassed}/${criticalTotal}`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log("=".repeat(80) + "\n");

  return result;
}
