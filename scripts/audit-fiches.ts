#!/usr/bin/env tsx
/**
 * Audit Fiches by ID
 * ==================
 * Same pipeline as sequential-audit.ts but takes fiche IDs directly
 * instead of a date range. No CRM sales-list fetching needed.
 *
 * Usage:
 *   # Single fiche
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159
 *
 *   # Multiple fiches (comma or space separated)
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159,1788190,1762716
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159 1788190 1762716
 *
 *   # Dry run
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159,1788190 --dry-run
 *
 *   # Skip transcription (use existing DB transcriptions)
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159 --skip-transcription
 *
 *   # Re-audit even if already audited with this config
 *   npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159 --no-skip-audited
 *
 * Options:
 *   --config               Audit config ID (required)
 *   --fiches               Fiche IDs: comma-separated, space-separated, or repeated (required)
 *   --dry-run              Only list fiches, don't process
 *   --skip-transcription   Skip transcription step
 *   --stop-on-error        Stop on first error (default: continue)
 *   --no-skip-audited      Re-audit fiches that already have a completed audit
 *   --max-recordings       Max recordings per fiche (default: 50)
 */

import "dotenv/config";

import { getAuditConfigById } from "../src/modules/audit-configs/audit-configs.repository.js";
import { analyzeAllSteps } from "../src/modules/audits/audits.analyzer.js";
import { buildTimelineText } from "../src/modules/audits/audits.prompts.js";
import { saveAuditResult } from "../src/modules/audits/audits.repository.js";
import type { AuditConfigForAnalysis, ProductLinkResult } from "../src/modules/audits/audits.types.js";
import { fetchFicheDetails } from "../src/modules/fiches/fiches.api.js";
import { cacheFicheDetails } from "../src/modules/fiches/fiches.cache.js";
import { getCachedFiche } from "../src/modules/fiches/fiches.repository.js";
import { getRecordingsWithTranscriptionChunksByFiche } from "../src/modules/recordings/recordings.repository.js";
import { normalizeElevenLabsApiKey } from "../src/modules/transcriptions/transcriptions.elevenlabs.js";
import { transcribeFicheRecordings } from "../src/modules/transcriptions/transcriptions.service.js";
import type { TimelineRecording, TranscriptionWord } from "../src/schemas.js";
import { COMPLIANCE_THRESHOLDS } from "../src/shared/constants.js";
import { disconnectDb, prisma } from "../src/shared/prisma.js";
import { enrichRecording } from "../src/utils/recording-parser.js";
import { buildConversationChunksFromWords } from "../src/utils/transcription-chunks.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const HARD_MAX_RECORDINGS_PER_FICHE = 50;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5_000;

// ─── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(): {
  auditConfigId: number;
  ficheIds: string[];
  dryRun: boolean;
  skipTranscription: boolean;
  stopOnError: boolean;
  skipAudited: boolean;
  maxRecordings: number;
} {
  const args = process.argv.slice(2);

  const getFlag = (name: string): boolean => args.includes(name);
  const getValue = (name: string): string | null => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1]! : null;
  };

  const configRaw = getValue("--config");
  const maxRecordingsRaw = getValue("--max-recordings");

  // Collect all fiche IDs: everything after --fiches until the next flag
  const ficheIds: string[] = [];
  const fichesIdx = args.indexOf("--fiches");
  if (fichesIdx !== -1) {
    for (let i = fichesIdx + 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.startsWith("--")) {break;}
      // Split on commas and spaces
      const ids = arg.split(/[\s,]+/).filter(Boolean);
      ficheIds.push(...ids);
    }
  }

  if (!configRaw || ficheIds.length === 0) {
    console.error(
      "\nUsage: npx tsx scripts/audit-fiches.ts --config <id> --fiches <id1> [id2] [id3,...]\n"
    );
    console.error("Required:");
    console.error("  --config              Audit config ID");
    console.error("  --fiches              One or more fiche IDs (comma or space separated)");
    console.error("\nOptional:");
    console.error("  --dry-run             Only list fiches, don't process");
    console.error("  --skip-transcription  Skip transcription (use existing DB transcriptions)");
    console.error("  --stop-on-error       Stop on first error (default: continue)");
    console.error("  --no-skip-audited     Re-audit even if already audited");
    console.error(`  --max-recordings <N>  Max recordings per fiche (default: ${HARD_MAX_RECORDINGS_PER_FICHE})`);
    console.error("\nExamples:");
    console.error("  npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159");
    console.error("  npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159,1788190,1762716");
    console.error("  npx tsx scripts/audit-fiches.ts --config 1 --fiches 1791159 1788190 1762716");
    process.exit(1);
  }

  const auditConfigId = Number.parseInt(configRaw, 10);
  if (!Number.isFinite(auditConfigId) || auditConfigId <= 0) {
    console.error(`Invalid audit config ID: ${configRaw}`);
    process.exit(1);
  }

  // Dedupe and validate fiche IDs
  const uniqueIds = [...new Set(ficheIds)].filter((id) => /^\d+$/.test(id));
  if (uniqueIds.length === 0) {
    console.error("No valid fiche IDs provided (must be numeric)");
    process.exit(1);
  }
  if (uniqueIds.length < ficheIds.length) {
    console.warn(`Deduplicated ${ficheIds.length} → ${uniqueIds.length} fiche IDs`);
  }

  const maxRecordingsParsed = maxRecordingsRaw ? Number.parseInt(maxRecordingsRaw, 10) : HARD_MAX_RECORDINGS_PER_FICHE;
  const maxRecordings = Number.isFinite(maxRecordingsParsed) && maxRecordingsParsed > 0
    ? Math.min(maxRecordingsParsed, HARD_MAX_RECORDINGS_PER_FICHE)
    : HARD_MAX_RECORDINGS_PER_FICHE;

  return {
    auditConfigId,
    ficheIds: uniqueIds,
    dryRun: getFlag("--dry-run"),
    skipTranscription: getFlag("--skip-transcription"),
    stopOnError: getFlag("--stop-on-error"),
    skipAudited: !getFlag("--no-skip-audited"),
    maxRecordings,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  if (ms < 1000) {return `${ms}ms`;}
  if (ms < 60_000) {return `${(ms / 1000).toFixed(1)}s`;}
  if (ms < 3_600_000) {return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;}
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries = DEFAULT_MAX_RETRIES
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.includes("not configured")) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logWarn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${msg} — retrying in ${delay / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Timeline from DB ─────────────────────────────────────────────────────────

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
    text: word, start: idx * wordDur, end: (idx + 1) * wordDur, type: "word",
    speaker_id: idx % 20 < 10 ? "speaker_0" : "speaker_1",
  }));
}

async function rebuildTimelineFromDatabase(ficheId: string): Promise<TimelineRecording[]> {
  const dbRecordings = await getRecordingsWithTranscriptionChunksByFiche(ficheId);
  const timeline: TimelineRecording[] = [];

  for (const dbRec of dbRecordings) {
    if (!dbRec.hasTranscription) {continue;}
    if (!dbRec.recordingUrl) {continue;}

    let chunks = dbRec.transcriptionChunks.map((ch) => ({
      chunk_index: ch.chunkIndex, start_timestamp: ch.startTimestamp,
      end_timestamp: ch.endTimestamp, message_count: ch.messageCount,
      speakers: ch.speakers, full_text: ch.fullText,
    }));

    if (chunks.length === 0) {
      const payload = dbRec.transcriptionData;
      const words = toTranscriptionWords(payload);
      if (words) {
        chunks = buildConversationChunksFromWords(words);
      } else if (typeof dbRec.transcriptionText === "string" && dbRec.transcriptionText.trim()) {
        chunks = buildConversationChunksFromWords(buildSyntheticWordsFromText(dbRec.transcriptionText, dbRec.durationSeconds));
      } else {
        continue;
      }
    }

    timeline.push({
      recording_index: timeline.length, call_id: dbRec.callId,
      start_time: dbRec.startTime?.toISOString() || "", duration_seconds: dbRec.durationSeconds ?? 0,
      recording_url: dbRec.recordingUrl, recording_date: dbRec.recordingDate ?? "",
      recording_time: dbRec.recordingTime ?? "", from_number: dbRec.fromNumber ?? "",
      to_number: dbRec.toNumber ?? "", total_chunks: chunks.length, chunks,
    });
  }
  return timeline;
}

function enrichCitationsWithMetadata(auditResults: { steps: unknown[] }, timeline: ReadonlyArray<TimelineRecording>) {
  const timelineMap = new Map(timeline.map((rec) => [rec.recording_index, {
    recording_date: rec.recording_date || "N/A", recording_time: rec.recording_time || "N/A", recording_url: rec.recording_url || "N/A",
  }]));

  for (const step of auditResults.steps) {
    if (!isRecord(step)) {continue;}
    const points = (step as { points_controle?: unknown }).points_controle;
    if (!Array.isArray(points)) {continue;}
    for (const cp of points) {
      const citations = (cp as { citations?: unknown }).citations;
      if (!Array.isArray(citations)) {continue;}
      for (const cit of citations as Array<{ recording_index: number; recording_date?: string; recording_time?: string; recording_url?: string }>) {
        const meta = timelineMap.get(cit.recording_index);
        if (meta) { cit.recording_date = meta.recording_date; cit.recording_time = meta.recording_time; cit.recording_url = meta.recording_url; }
        else { cit.recording_date = "N/A"; cit.recording_time = "N/A"; cit.recording_url = "N/A"; }
      }
    }
  }
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", blue: "\x1b[34m", magenta: "\x1b[35m",
};

function log(msg: string) { console.log(`${c.dim}[${new Date().toISOString().slice(11, 19)}]${c.reset} ${msg}`); }
function logStep(step: string, msg: string) { console.log(`${c.dim}[${new Date().toISOString().slice(11, 19)}]${c.reset} ${c.cyan}[${step}]${c.reset} ${msg}`); }
function logSuccess(msg: string) { console.log(`${c.dim}[${new Date().toISOString().slice(11, 19)}]${c.reset} ${c.green}OK${c.reset} ${msg}`); }
function logError(msg: string) { console.error(`${c.dim}[${new Date().toISOString().slice(11, 19)}]${c.reset} ${c.red}ERR${c.reset} ${msg}`); }
function logWarn(msg: string) { console.warn(`${c.dim}[${new Date().toISOString().slice(11, 19)}]${c.reset} ${c.yellow}WARN${c.reset} ${msg}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const globalStart = Date.now();

  console.log("");
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`${c.bold}  Audit Fiches by ID${c.reset}`);
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`  Config ID       : ${c.cyan}${config.auditConfigId}${c.reset}`);
  console.log(`  Fiches          : ${c.cyan}${config.ficheIds.length}${c.reset} — ${config.ficheIds.slice(0, 10).join(", ")}${config.ficheIds.length > 10 ? "..." : ""}`);
  console.log(`  Dry run         : ${config.dryRun ? `${c.yellow}YES${c.reset}` : "no"}`);
  console.log(`  Transcribe      : ${config.skipTranscription ? `${c.yellow}SKIP${c.reset}` : "yes"}`);
  console.log(`  On error        : ${config.stopOnError ? `${c.red}STOP${c.reset}` : `${c.green}continue${c.reset}`}`);
  console.log(`  Skip audited    : ${config.skipAudited ? `${c.green}yes${c.reset}` : "no"}`);
  console.log(`  Max recordings  : ${config.maxRecordings}`);
  console.log(`============================================================\n`);

  // ── Validate config ─────────────────────────────────────────────────────────

  logStep("INIT", "Validating audit config...");
  const auditConfigRow = await getAuditConfigById(BigInt(config.auditConfigId));
  if (!auditConfigRow) {
    logError(`Audit config ${config.auditConfigId} not found`);
    process.exit(1);
  }
  const auditConfig: AuditConfigForAnalysis = {
    id: auditConfigRow.id.toString(), name: auditConfigRow.name,
    description: auditConfigRow.description, systemPrompt: auditConfigRow.systemPrompt,
    auditSteps: auditConfigRow.steps,
  };
  logSuccess(`Audit config: "${auditConfig.name}" — ${auditConfig.auditSteps.length} step(s)`);

  let elevenLabsKey: string | null = null;
  if (!config.skipTranscription) {
    elevenLabsKey = normalizeElevenLabsApiKey(process.env.ELEVENLABS_API_KEY);
    if (!elevenLabsKey) {
      logError("ELEVENLABS_API_KEY not configured. Use --skip-transcription to skip.");
      process.exit(1);
    }
    logSuccess("ElevenLabs API key validated");
  }

  const needsProductInfo = auditConfig.auditSteps.some((s) => s.verifyProductInfo === true);

  // ── Skip already-audited ────────────────────────────────────────────────────

  let ficheIds = [...config.ficheIds];

  if (config.skipAudited && ficheIds.length > 0) {
    logStep("FILTER", "Checking for already-audited fiches...");
    const rows = await prisma.audit.findMany({
      where: {
        ficheCache: { ficheId: { in: ficheIds } },
        auditConfigId: BigInt(config.auditConfigId),
        status: "completed",
        isLatest: true,
      },
      select: { ficheCache: { select: { ficheId: true } } },
    });
    const alreadyAudited = new Set(rows.map((r) => r.ficheCache.ficheId));
    if (alreadyAudited.size > 0) {
      const before = ficheIds.length;
      ficheIds = ficheIds.filter((id) => !alreadyAudited.has(id));
      log(`  Skipped ${alreadyAudited.size} already-audited (${before} → ${ficheIds.length})`);
    }
  }

  if (ficheIds.length === 0) {
    logWarn("No fiches to process. Exiting.");
    await disconnectDb();
    return;
  }

  // ── Dry run ─────────────────────────────────────────────────────────────────

  if (config.dryRun) {
    console.log(`\n${c.bold}Fiches to process (${ficheIds.length}):${c.reset}`);
    for (let i = 0; i < ficheIds.length; i++) { console.log(`  ${i + 1}. ${ficheIds[i]}`); }
    console.log(`\n${c.yellow}Dry run — nothing done.${c.reset}\n`);
    await disconnectDb();
    return;
  }

  // ── Process ─────────────────────────────────────────────────────────────────

  console.log(`\n${c.bold}Processing ${ficheIds.length} fiche(s)...${c.reset}\n`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const results: Array<{ ficheId: string; status: string; score?: number; niveau?: string; recs: number; time: string; error?: string }> = [];

  for (let i = 0; i < ficheIds.length; i++) {
    const ficheId = ficheIds[i]!;
    const ficheStart = Date.now();
    const tag = `[${i + 1}/${ficheIds.length}]`;

    console.log(`${c.bold}${c.blue}────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.bold}${tag} Fiche ${ficheId}${c.reset}`);
    console.log(`${c.blue}────────────────────────────────────────────────────${c.reset}`);

    try {
      // ── A: Fetch details ──────────────────────────────────────────────

      logStep("DETAILS", `Fetching fiche ${ficheId}...`);
      const t0 = Date.now();
      let ficheData;
      try {
        ficheData = await withRetry(`details ${ficheId}`, () => fetchFicheDetails(ficheId));
        if (ficheData.recordings) { ficheData.recordings = ficheData.recordings.map(enrichRecording); }
        await cacheFicheDetails(ficheData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          logWarn(`Fiche ${ficheId} not found (404) — skipping`);
          results.push({ ficheId, status: "skipped", recs: 0, time: elapsed(ficheStart), error: "404" });
          skipCount++;
          continue;
        }
        throw err;
      }

      const recsCount = ficheData.recordings?.length ?? 0;
      const prospect = ficheData.prospect ? `${ficheData.prospect.prenom || ""} ${ficheData.prospect.nom || ""}`.trim() : "N/A";
      logSuccess(`Details ok (${elapsed(t0)}) — recordings: ${recsCount}, prospect: ${prospect}`);

      // ── Guard: too many recordings ────────────────────────────────────

      if (recsCount > config.maxRecordings) {
        logWarn(`${recsCount} recordings > ${config.maxRecordings} — skipping`);
        results.push({ ficheId, status: "skipped", recs: recsCount, time: elapsed(ficheStart), error: `>${config.maxRecordings} recs` });
        skipCount++;
        continue;
      }

      // ── B: Transcribe ─────────────────────────────────────────────────

      if (!config.skipTranscription && recsCount > 0 && elevenLabsKey) {
        logStep("TRANSCRIBE", `Transcribing ${recsCount} recording(s)...`);
        const t1 = Date.now();
        const key = elevenLabsKey;
        const tx = await withRetry(`transcribe ${ficheId}`, () => transcribeFicheRecordings(ficheId, key));
        logSuccess(`Transcription ok (${elapsed(t1)}) — total: ${tx.total}, transcribed: ${tx.transcribed}, new: ${tx.newTranscriptions}${tx.failed ? `, failed: ${tx.failed}` : ""}`);
      } else if (config.skipTranscription) {
        logStep("TRANSCRIBE", `${c.yellow}Skipped${c.reset}`);
      }

      // ── C: Timeline ───────────────────────────────────────────────────

      logStep("TIMELINE", "Building from DB...");
      const timeline = await rebuildTimelineFromDatabase(ficheId);
      const totalChunks = timeline.reduce((s, r) => s + (r.total_chunks || 0), 0);
      logSuccess(`Timeline: ${timeline.length} recording(s), ${totalChunks} chunks`);

      if (timeline.length === 0) {
        logWarn(`Empty timeline — skipping audit`);
        results.push({ ficheId, status: "skipped", recs: recsCount, time: elapsed(ficheStart), error: "empty timeline" });
        skipCount++;
        continue;
      }

      // ── D: Product link ───────────────────────────────────────────────

      let productInfo: ProductLinkResult | null = null;
      if (needsProductInfo) {
        try {
          const { linkFicheToProduct } = await import("../src/modules/products/products.service.js");
          const link = await linkFicheToProduct(ficheId);
          if (link.matched && link.formule) { productInfo = link; }
        } catch { /* non-fatal */ }
      }

      // ── E: GPT analysis ───────────────────────────────────────────────

      logStep("AUDIT", `Running analysis (${auditConfig.auditSteps.length} steps)...`);
      const t2 = Date.now();
      const auditId = `fiches-audit-${ficheId}-${config.auditConfigId}-${Date.now()}`;
      const timelineText = buildTimelineText(timeline);

      const auditResults = await withRetry(`audit ${ficheId}`, () =>
        analyzeAllSteps(auditConfig, timeline, timelineText, auditId, ficheId, productInfo)
      );
      enrichCitationsWithMetadata(auditResults, timeline);
      logSuccess(`Analysis done (${elapsed(t2)}) — ok: ${auditResults.statistics.successful}, fail: ${auditResults.statistics.failed}, tokens: ${auditResults.statistics.total_tokens}`);

      // ── F: Compliance + save ──────────────────────────────────────────

      logStep("SAVE", "Saving audit...");
      const totalWeight = auditConfig.auditSteps.reduce((s, st) => s + st.weight, 0);
      const earnedWeight = auditResults.steps.reduce((s, st) => {
        const score = (st as { score?: unknown }).score;
        if (typeof score !== "number") {return s;}
        const mw = (st as { step_metadata?: { weight?: unknown } }).step_metadata?.weight;
        return s + Math.min(score, typeof mw === "number" ? mw : score);
      }, 0);
      const scorePercent = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

      const criticalTotal = auditConfig.auditSteps.filter((s) => s.isCritical).length;
      const criticalPassed = auditResults.steps.filter((s) => {
        const meta = (s as { step_metadata?: { is_critical?: unknown } }).step_metadata;
        const isCritical = Boolean(meta && (meta as { is_critical?: unknown }).is_critical);
        return isCritical && (s as { conforme?: unknown }).conforme === "CONFORME";
      }).length;

      let niveau = "INSUFFISANT";
      if (criticalPassed < criticalTotal) { niveau = "REJET"; }
      else if (scorePercent >= COMPLIANCE_THRESHOLDS.EXCELLENT) { niveau = "EXCELLENT"; }
      else if (scorePercent >= COMPLIANCE_THRESHOLDS.BON) { niveau = "BON"; }
      else if (scorePercent >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) { niveau = "ACCEPTABLE"; }

      const compliance = {
        score: Number(scorePercent.toFixed(2)), niveau,
        points_critiques: `${criticalPassed}/${criticalTotal}`,
        poids_obtenu: earnedWeight, poids_total: totalWeight,
      };

      const cached = await getCachedFiche(ficheId);
      if (!cached) { throw new Error(`Fiche ${ficheId} not in cache — cannot save`); }

      const prospectName = `${cached.prospectPrenom || ""} ${cached.prospectNom || ""}`.trim() || "N/A";
      const groupe = typeof cached.groupe === "string" && cached.groupe.trim() ? cached.groupe.trim() : "N/A";

      const saved = await saveAuditResult({
        audit: {
          config: { id: auditConfig.id, name: auditConfig.name, description: auditConfig.description },
          fiche: { fiche_id: ficheId, prospect_name: prospectName, groupe },
          results: { ...auditResults, compliance }, compliance,
        },
        statistics: {
          recordings_count: timeline.length, transcriptions_count: timeline.length,
          timeline_chunks: totalChunks, successful_steps: auditResults.statistics.successful,
          failed_steps: auditResults.statistics.failed,
          total_time_seconds: auditResults.statistics.total_time_seconds,
          total_tokens: auditResults.statistics.total_tokens,
        },
        metadata: {
          started_at: new Date(ficheStart).toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - ficheStart,
        },
      }, cached.id);

      logSuccess(
        `${c.bold}Score: ${compliance.score}% — ${compliance.niveau}${c.reset} ` +
          `(critical: ${compliance.points_critiques}, audit_id: ${saved.id})`
      );

      results.push({ ficheId, status: "success", score: compliance.score, niveau, recs: recsCount, time: elapsed(ficheStart) });
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Fiche ${ficheId} failed: ${msg}`);
      if (err instanceof Error && err.stack) { logError(`  ${c.dim}${err.stack.split("\n").slice(0, 3).join(" | ")}${c.reset}`); }
      results.push({ ficheId, status: "failed", recs: 0, time: elapsed(ficheStart), error: msg.slice(0, 80) });
      failCount++;
      if (config.stopOnError) { logError("Stopping (--stop-on-error)"); break; }
    }

    log(`${c.dim}Done in ${elapsed(ficheStart)}${c.reset}\n`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log(`\n${c.bold}============================================================${c.reset}`);
  console.log(`${c.bold}  RESULTS${c.reset}`);
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`  Total    : ${results.length}`);
  console.log(`  Success  : ${c.green}${successCount}${c.reset}`);
  console.log(`  Failed   : ${failCount > 0 ? `${c.red}${failCount}${c.reset}` : "0"}`);
  console.log(`  Skipped  : ${skipCount > 0 ? `${c.yellow}${skipCount}${c.reset}` : "0"}`);
  console.log(`  Duration : ${elapsed(globalStart)}`);
  console.log(`============================================================\n`);

  if (results.length > 0) {
    console.log(`  ${"#".padStart(3)}  ${"Fiche ID".padEnd(12)}  ${"Status".padEnd(8)}  ${"Recs".padStart(4)}  ${"Score".padStart(6)}  ${"Niveau".padEnd(14)}  ${"Time".padEnd(8)}  Error`);
    console.log(`  ${"─".repeat(90)}`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const sc = r.status === "success" ? c.green : r.status === "failed" ? c.red : c.yellow;
      console.log(
        `  ${String(i + 1).padStart(3)}  ${r.ficheId.padEnd(12)}  ${sc}${r.status.padEnd(8)}${c.reset}  ${String(r.recs).padStart(4)}  ${(r.score !== undefined ? `${r.score}%` : "—").padStart(6)}  ${(r.niveau ?? "—").padEnd(14)}  ${r.time.padEnd(8)}  ${r.error ? `${c.dim}${r.error}${c.reset}` : ""}`
      );
    }
    console.log("");
  }

  await disconnectDb();
  if (failCount > 0) { process.exit(1); }
}

main().catch(async (err) => {
  console.error(`\n${c.red}${c.bold}FATAL:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) { console.error(`${c.dim}${err.stack}${c.reset}`); }
  try { await disconnectDb(); } catch { /* ignore */ }
  process.exit(1);
});
