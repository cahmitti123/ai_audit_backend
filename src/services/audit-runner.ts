/**
 * Audit Runner Service
 * ====================
 * Orchestrates the complete audit pipeline as a callable function
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { TranscriptionService } from "./transcription.js";
import { generateTimeline } from "./timeline-generator.js";
import { analyzeAllSteps } from "./audit.js";
import { buildTimelineText } from "../prompts.js";
import {
  fetchLatestAuditConfig,
  fetchAuditConfigById,
} from "./audit-config.js";
import { enrichRecording } from "../utils/recording-parser.js";
import {
  cacheFiche,
  getCachedFiche,
  saveAuditResult,
  updateRecordingTranscription,
} from "./database.js";
import { fetchApiFicheDetails } from "./fiche-api.js";
import "dotenv/config";

const DATA_DIR = "./data";

interface AuditOptions {
  auditConfigId?: number;
  ficheId: string;
  useLatest?: boolean;
  saveToFile?: boolean;
}

interface AuditResult {
  audit: {
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
  if (cached) {
    console.log(`✓ Using cached fiche data`);
    ficheData = cached.rawData;
  } else {
    ficheData = await fetchApiFicheDetails(options.ficheId);
    const ficheCacheEntry = await cacheFiche(ficheData);
    console.log(`✓ Fiche cached (ID: ${ficheCacheEntry.id})`);
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
  const auditConfig = options.useLatest
    ? await fetchLatestAuditConfig()
    : await fetchAuditConfigById(options.auditConfigId!);

  console.log(`✓ Config: ${auditConfig.name}`);
  console.log(`✓ Config ID: ${auditConfig.id}`);
  console.log(`✓ Steps: ${auditConfig.auditSteps.length}`);

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

  // Update database with transcription IDs
  if (cached) {
    for (const t of transcriptions) {
      if (t.transcription_id && t.call_id) {
        await updateRecordingTranscription(
          cached.id,
          t.call_id,
          t.transcription_id
        );
      }
    }
    console.log(`✓ Transcription IDs saved to database`);
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
  const timelineText = buildTimelineText(timeline);
  const auditResults = await analyzeAllSteps(
    auditConfig,
    timeline,
    timelineText
  );

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
  } else if (score >= 90) {
    niveau = "EXCELLENT";
  } else if (score >= 75) {
    niveau = "BON";
  } else if (score >= 60) {
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

  const result: AuditResult = {
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
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE TO DATABASE & FILE
  // ═══════════════════════════════════════════════════════════════════════════
  const ficheCache = await getCachedFiche(options.ficheId);
  if (ficheCache) {
    await saveAuditResult(result, ficheCache.id);
    console.log(`\n💾 Audit saved to database`);
  }

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
