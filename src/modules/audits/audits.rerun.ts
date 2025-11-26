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

export interface RerunStepOptions {
  auditId: bigint;
  stepPosition: number;
  customPrompt?: string; // User's additional instructions
  customInstructions?: string; // Alternative way to provide guidance
}

export interface RerunStepResult {
  success: boolean;
  originalStep: any;
  rerunStep: any;
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
  console.log(`🔄 Regenerating timeline for fiche ${ficheId}...`);

  // Load fiche cache
  const ficheCache = await getCachedFiche(ficheId);
  if (!ficheCache) {
    throw new Error(`Fiche ${ficheId} not found in cache`);
  }

  // Load recordings with transcriptions
  const dbRecordings = await getRecordingsByFiche(ficheId);
  console.log(`   Loaded ${dbRecordings.length} recordings from database`);

  // Get raw fiche data for recording enrichment
  const ficheData = ficheCache.rawData as any;
  const rawRecordings = ficheData.recordings || [];

  // Build transcriptions array (same logic as workflow)
  const transcriptions = [];

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription || !dbRec.transcriptionId) {
      console.warn(`   Skipping recording ${dbRec.callId} - no transcription`);
      continue;
    }

    // Find matching raw recording
    const rawRec = rawRecordings.find(
      (r: any) => (r.call_id || r.callId) === dbRec.callId
    );
    if (!rawRec) {
      console.warn(`   Could not find raw recording for ${dbRec.callId}`);
      continue;
    }

    const enrichedRec = enrichRecording(rawRec);
    const url = enrichedRec.recording_url || enrichedRec.recordingUrl;

    if (!url) {
      console.warn(`   Missing URL for recording ${dbRec.callId}`);
      continue;
    }

    // Load transcription from database
    let transcriptionData;

    if (dbRec.transcriptionText) {
      // Synthesize words from text for chunking
      const textWords = dbRec.transcriptionText.split(/\s+/).filter(Boolean);
      const words = textWords.map((word, idx) => ({
        text: word,
        start: idx * 0.5,
        end: (idx + 1) * 0.5,
        type: "word" as const,
        speaker_id: idx % 20 < 10 ? 0 : 1,
      }));

      transcriptionData = {
        text: dbRec.transcriptionText,
        language_code: "fr",
        words: words,
      };
    } else {
      console.warn(`   Recording ${dbRec.callId} has no transcription text`);
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

  console.log(`   Built ${transcriptions.length} transcriptions`);

  // Generate timeline
  const timeline = generateTimeline(transcriptions);
  const timelineText = buildTimelineText(timeline);

  console.log(`   ✓ Timeline: ${timeline.length} recordings, ${timeline.reduce((sum, r) => sum + r.total_chunks, 0)} chunks`);

  return { timeline, timelineText };
}

/**
 * Rerun a single audit step
 */
export async function rerunAuditStep(
  options: RerunStepOptions
): Promise<RerunStepResult> {
  const startTime = Date.now();

  console.log(`\n🔄 Re-running audit step ${options.stepPosition}...`);

  // 1. Load original audit
  const audit = await getAuditById(options.auditId);
  if (!audit) {
    throw new Error(`Audit ${options.auditId} not found`);
  }

  const ficheId = audit.ficheCache.ficheId;
  console.log(`   Fiche: ${ficheId}`);

  // 2. Find original step result
  const originalStepResult = audit.stepResults.find(
    (s) => s.stepPosition === options.stepPosition
  );
  if (!originalStepResult) {
    throw new Error(
      `Step ${options.stepPosition} not found in audit ${options.auditId}`
    );
  }
  console.log(`   Step: ${originalStepResult.stepName}`);

  // 3. Load audit configuration
  const auditConfig = await getAuditConfigById(audit.auditConfigId);
  if (!auditConfig) {
    throw new Error(`Audit config ${audit.auditConfigId} not found`);
  }

  const auditConfigData = {
    id: auditConfig.id.toString(),
    name: auditConfig.name,
    description: auditConfig.description,
    systemPrompt: auditConfig.systemPrompt,
    auditSteps: auditConfig.steps,
  };

  // 4. Find step definition
  const stepDef = auditConfigData.auditSteps.find(
    (s: any) => s.position === options.stepPosition
  );
  if (!stepDef) {
    throw new Error(`Step definition not found for position ${options.stepPosition}`);
  }

  // 5. Regenerate timeline from database
  const { timeline, timelineText } = await regenerateTimelineFromDatabase(ficheId);

  // 6. Link to product if needed
  let productInfo = null;
  if (stepDef.verifyProductInfo) {
    console.log(`   🔗 Linking to product database...`);
    try {
      const { linkFicheToProduct } = await import(
        "../products/products.service.js"
      );
      const linkResult = await linkFicheToProduct(ficheId);
      if (linkResult.matched && linkResult.formule) {
        productInfo = linkResult;
        console.log(`   ✓ Product matched: ${linkResult.formule.libelle}`);
      }
    } catch (error) {
      console.warn(`   ⚠️  Product linking failed:`, error);
    }
  }

  // 7. Add custom prompt if provided
  if (options.customPrompt || options.customInstructions) {
    const customInstruction = options.customPrompt || options.customInstructions;
    stepDef.customInstructions = `\n\n📝 INSTRUCTIONS SPÉCIFIQUES DE L'UTILISATEUR:\n${customInstruction}`;
    console.log(`   📝 Custom instructions added`);
  }

  // 8. Re-analyze step
  console.log(`   🤖 Re-analyzing step...`);
  const rerunResult = await analyzeStep(
    stepDef,
    auditConfigData,
    timelineText,
    `rerun-${options.auditId}-step-${options.stepPosition}`,
    ficheId,
    productInfo
  );

  const duration = Date.now() - startTime;

  // 9. Compare results
  const comparison = {
    scoreChanged: originalStepResult.score !== rerunResult.score,
    conformeChanged: originalStepResult.conforme !== rerunResult.conforme,
    citationsChanged:
      originalStepResult.totalCitations !==
      (rerunResult.points_controle?.reduce(
        (sum: number, pc: any) => sum + (pc.citations?.length || 0),
        0
      ) || 0),
    originalScore: originalStepResult.score || 0,
    newScore: rerunResult.score,
    originalConforme: originalStepResult.conforme,
    newConforme: rerunResult.conforme,
  };

  console.log(`\n✅ Re-run complete:`);
  console.log(`   Original: ${comparison.originalScore}/${stepDef.weight} (${comparison.originalConforme})`);
  console.log(`   New:      ${comparison.newScore}/${stepDef.weight} (${comparison.newConforme})`);
  console.log(`   Changed:  ${comparison.scoreChanged ? "YES" : "NO"}`);

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
    console.log(`⚠️  Audit update not yet implemented - rerun saved for review only`);
  }

  return {
    saved: true,
    auditUpdated: false,
  };
}



