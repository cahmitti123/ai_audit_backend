#!/usr/bin/env tsx
/**
 * Sequential Audit Script
 * =======================
 * Standalone script that replicates the automation workflow EXACTLY,
 * but processes fiches ONE-BY-ONE instead of fanning out via Inngest.
 *
 * Designed for overnight unattended runs of 2000+ fiches.
 *
 * Per-fiche pipeline (mirrors automation → fiche/fetch → fiche/transcribe → audit/run):
 *   1. Fetch full fiche details from CRM → store in DB   (≡ fiche/fetch with force_refresh)
 *   2. Transcribe recordings → store in DB               (≡ fiche/transcribe)
 *   3. Build timeline from DB transcriptions              (≡ audit/run: rebuildTimelineFromDatabase)
 *   4. Run GPT analysis on all audit steps                (≡ audit/run: analyzeAllSteps)
 *   5. Calculate compliance + save audit to DB            (≡ audit/run: finalize)
 *   6. Move to next fiche
 *
 * Usage:
 *   tsx scripts/sequential-audit.ts --start 2025-02-01 --end 2025-02-10 --config 5
 *   tsx scripts/sequential-audit.ts --start 2025-02-01 --end 2025-02-10 --config 5 --dry-run
 *   tsx scripts/sequential-audit.ts --start 2025-02-01 --end 2025-02-10 --config 5 --only-with-recordings
 *
 * Defaults optimized for overnight runs:
 *   - Continues on error (use --stop-on-error to override)
 *   - Skips fiches already audited with this config (use --no-skip-audited to override)
 *   - Skips fiches with >50 recordings (safety limit, same as automation)
 *   - Retries transient failures up to 3 times with exponential backoff
 *   - Writes progress to a file for crash recovery / monitoring
 *   - Logs ETA and throughput periodically
 *
 * Arguments:
 *   --start                  Start date (YYYY-MM-DD)
 *   --end                    End date (YYYY-MM-DD)
 *   --config                 Audit config ID (number)
 *   --dry-run                (optional) Only list fiches, don't process
 *   --only-with-recordings   (optional) Skip fiches that have 0 recordings
 *   --skip-transcription     (optional) Skip transcription step (use existing DB transcriptions)
 *   --stop-on-error          (optional) Stop on first error (default: continue)
 *   --no-skip-audited        (optional) Re-audit fiches that already have a completed audit
 *   --max-fiches             (optional) Limit the number of fiches to process
 *   --max-recordings         (optional) Max recordings per fiche (default: 50)
 */

import "dotenv/config";

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

import { getAuditConfigById } from "../src/modules/audit-configs/audit-configs.repository.js";
import { analyzeAllSteps } from "../src/modules/audits/audits.analyzer.js";
import { buildTimelineText } from "../src/modules/audits/audits.prompts.js";
import { saveAuditResult } from "../src/modules/audits/audits.repository.js";
import type { AuditConfigForAnalysis, ProductLinkResult } from "../src/modules/audits/audits.types.js";
import { fetchFichesForDate } from "../src/modules/automation/automation.api.js";
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
const RETRY_BASE_DELAY_MS = 5_000; // 5s, 10s, 20s backoff

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(): {
  startDate: string;
  endDate: string;
  auditConfigId: number;
  dryRun: boolean;
  onlyWithRecordings: boolean;
  skipTranscription: boolean;
  stopOnError: boolean;
  skipAudited: boolean;
  maxFiches: number | null;
  maxRecordings: number;
} {
  const args = process.argv.slice(2);

  const getFlag = (name: string): boolean => args.includes(name);
  const getValue = (name: string): string | null => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1]! : null;
  };

  const startDate = getValue("--start");
  const endDate = getValue("--end");
  const configRaw = getValue("--config");
  const maxFichesRaw = getValue("--max-fiches");
  const maxRecordingsRaw = getValue("--max-recordings");

  if (!startDate || !endDate || !configRaw) {
    console.error(
      "\nUsage: tsx scripts/sequential-audit.ts --start YYYY-MM-DD --end YYYY-MM-DD --config <audit_config_id>\n"
    );
    console.error("Required arguments:");
    console.error("  --start                  Start date (YYYY-MM-DD)");
    console.error("  --end                    End date (YYYY-MM-DD)");
    console.error("  --config                 Audit config ID (number)");
    console.error("\nOptional:");
    console.error("  --dry-run                Only list fiches, don't process");
    console.error("  --only-with-recordings   Skip fiches without recordings");
    console.error("  --skip-transcription     Skip transcription (use existing DB transcriptions)");
    console.error("  --stop-on-error          Stop on first error (default: continue)");
    console.error("  --no-skip-audited        Re-audit fiches that already have a completed audit");
    console.error("  --max-fiches <N>         Limit number of fiches to process");
    console.error(`  --max-recordings <N>     Max recordings per fiche (default: ${HARD_MAX_RECORDINGS_PER_FICHE})`);
    process.exit(1);
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate)) {
    console.error(`Invalid start date format: ${startDate} (expected YYYY-MM-DD)`);
    process.exit(1);
  }
  if (!dateRegex.test(endDate)) {
    console.error(`Invalid end date format: ${endDate} (expected YYYY-MM-DD)`);
    process.exit(1);
  }

  const auditConfigId = Number.parseInt(configRaw, 10);
  if (!Number.isFinite(auditConfigId) || auditConfigId <= 0) {
    console.error(`Invalid audit config ID: ${configRaw}`);
    process.exit(1);
  }

  const maxFiches = maxFichesRaw ? Number.parseInt(maxFichesRaw, 10) : null;
  if (maxFiches !== null && (!Number.isFinite(maxFiches) || maxFiches <= 0)) {
    console.error(`Invalid --max-fiches value: ${maxFichesRaw}`);
    process.exit(1);
  }

  const maxRecordingsParsed = maxRecordingsRaw ? Number.parseInt(maxRecordingsRaw, 10) : HARD_MAX_RECORDINGS_PER_FICHE;
  const maxRecordings = Number.isFinite(maxRecordingsParsed) && maxRecordingsParsed > 0
    ? Math.min(maxRecordingsParsed, HARD_MAX_RECORDINGS_PER_FICHE)
    : HARD_MAX_RECORDINGS_PER_FICHE;

  return {
    startDate,
    endDate,
    auditConfigId,
    dryRun: getFlag("--dry-run"),
    onlyWithRecordings: getFlag("--only-with-recordings"),
    skipTranscription: getFlag("--skip-transcription"),
    stopOnError: getFlag("--stop-on-error"),
    skipAudited: !getFlag("--no-skip-audited"),   // default: skip already-audited
    maxFiches,
    maxRecordings,
  };
}

/** Convert YYYY-MM-DD to DD/MM/YYYY (format expected by fetchFichesForDate) */
function toSlashDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Generate all dates between start and end (inclusive) in YYYY-MM-DD format */
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T00:00:00.000Z");

  while (current <= end) {
    const yyyy = current.getUTCFullYear();
    const mm = String(current.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(current.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/** Extract fiche ID from a CRM API response object */
function extractFicheId(fiche: unknown): string | null {
  if (typeof fiche !== "object" || fiche === null) {return null;}
  const obj = fiche as Record<string, unknown>;
  for (const key of ["ficheId", "fiche_id", "id"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) {return val.trim();}
    if (typeof val === "number" && Number.isFinite(val)) {return String(val);}
  }
  return null;
}

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

/** Retry an async function with exponential backoff. */
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

      // Don't retry non-retriable errors
      if (msg.includes("404") || msg.toLowerCase().includes("not found") || msg.includes("not configured")) {
        throw err;
      }

      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt); // 5s, 10s, 20s
        logWarn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${msg} — retrying in ${delay / 1000}s`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── Timeline from DB (replicates audits.workflows.ts rebuildTimelineFromDatabase) ─

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
    const speaker_id =
      typeof w.speaker_id === "string" ? (w.speaker_id as string) : undefined;
    const logprob = typeof w.logprob === "number" ? w.logprob : undefined;

    if (text === null || start === null || end === null) {continue;}

    words.push({
      text,
      start,
      end,
      type,
      ...(speaker_id ? { speaker_id } : {}),
      ...(logprob !== undefined ? { logprob } : {}),
    });
  }

  return words.length > 0 ? words : null;
}

function buildSyntheticWordsFromText(
  text: string,
  durationSeconds: number | null
): TranscriptionWord[] {
  const textWords = text.split(/\s+/).filter(Boolean);
  if (textWords.length === 0) {return [];}

  const duration =
    typeof durationSeconds === "number" && durationSeconds > 0
      ? durationSeconds
      : Math.max(1, Math.round(textWords.length * 0.5));

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
      } else if (
        typeof dbRec.transcriptionText === "string" &&
        dbRec.transcriptionText.trim()
      ) {
        const syntheticWords = buildSyntheticWordsFromText(
          dbRec.transcriptionText,
          dbRec.durationSeconds
        );
        chunks = buildConversationChunksFromWords(syntheticWords);
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
 * Same logic as audits.runner.ts enrichCitationsWithMetadata.
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

    for (const controlPoint of points) {
      const citations = (controlPoint as { citations?: unknown }).citations;
      if (!Array.isArray(citations)) {continue;}

      for (const citation of citations as Array<{
        recording_index: number;
        recording_date?: string;
        recording_time?: string;
        recording_url?: string;
      }>) {
        const metadata = timelineMap.get(citation.recording_index);
        if (metadata) {
          citation.recording_date = metadata.recording_date;
          citation.recording_time = metadata.recording_time;
          citation.recording_url = metadata.recording_url;
        } else {
          citation.recording_date = "N/A";
          citation.recording_time = "N/A";
          citation.recording_url = "N/A";
        }
      }
    }
  }
}

// ─── Progress file (crash recovery) ──────────────────────────────────────────

function getProgressFilePath(startDate: string, endDate: string, configId: number): string {
  return pathResolve(process.cwd(), `.sequential-audit-progress-${startDate}-${endDate}-cfg${configId}.json`);
}

interface ProgressData {
  startedAt: string;
  config: { startDate: string; endDate: string; auditConfigId: number };
  completed: string[];   // fiche IDs that finished (success or skip)
  failed: string[];      // fiche IDs that failed
}

function loadProgress(filePath: string): ProgressData | null {
  if (!existsSync(filePath)) {return null;}
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as ProgressData;
  } catch {
    return null;
  }
}

function saveProgress(filePath: string, data: ProgressData): void {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // best-effort — never crash the pipeline for a progress write
  }
}

// ─── Color helpers (ANSI) ─────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${c.dim}[${ts}]${c.reset} ${msg}`);
}

function logStep(step: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${c.dim}[${ts}]${c.reset} ${c.cyan}[${step}]${c.reset} ${msg}`);
}

function logSuccess(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`${c.dim}[${ts}]${c.reset} ${c.green}OK${c.reset} ${msg}`);
}

function logError(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`${c.dim}[${ts}]${c.reset} ${c.red}ERR${c.reset} ${msg}`);
}

function logWarn(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.warn(`${c.dim}[${ts}]${c.reset} ${c.yellow}WARN${c.reset} ${msg}`);
}

// ─── Log file (persistent output for overnight monitoring) ────────────────────

let logFilePath: string | null = null;

function initLogFile(startDate: string, endDate: string, configId: number): void {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  logFilePath = pathResolve(process.cwd(), `sequential-audit-${startDate}-${endDate}-cfg${configId}-${ts}.log`);
  try {
    writeFileSync(logFilePath, `Sequential Audit Log — started ${new Date().toISOString()}\n`, "utf8");
  } catch {
    logFilePath = null;
  }
}

function fileLog(line: string): void {
  if (!logFilePath) {return;}
  try {
    appendFileSync(logFilePath, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // best-effort
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface FicheResult {
  ficheId: string;
  status: "success" | "failed" | "skipped";
  recordingsCount: number;
  transcribed?: number;
  score?: number;
  niveau?: string;
  error?: string;
  durationMs: number;
}

async function main() {
  const config = parseArgs();
  const globalStart = Date.now();

  // Init persistent log file
  initLogFile(config.startDate, config.endDate, config.auditConfigId);

  console.log("");
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`${c.bold}  Sequential Audit Script${c.reset}`);
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`  Date range      : ${c.cyan}${config.startDate}${c.reset} to ${c.cyan}${config.endDate}${c.reset}`);
  console.log(`  Config ID       : ${c.cyan}${config.auditConfigId}${c.reset}`);
  console.log(`  Dry run         : ${config.dryRun ? `${c.yellow}YES${c.reset}` : "no"}`);
  console.log(`  Recordings      : ${config.onlyWithRecordings ? "only with recordings" : "all fiches"}`);
  console.log(`  Transcribe      : ${config.skipTranscription ? `${c.yellow}SKIP${c.reset}` : "yes"}`);
  console.log(`  On error        : ${config.stopOnError ? `${c.red}STOP${c.reset}` : `${c.green}continue${c.reset}`}`);
  console.log(`  Skip audited    : ${config.skipAudited ? `${c.green}yes${c.reset}` : "no"}`);
  console.log(`  Max recordings  : ${config.maxRecordings}`);
  if (config.maxFiches) {console.log(`  Max fiches      : ${config.maxFiches}`);}
  if (logFilePath) {console.log(`  Log file        : ${c.dim}${logFilePath}${c.reset}`);}
  console.log(`============================================================\n`);

  fileLog(`Config: ${JSON.stringify({ ...config, startDate: config.startDate, endDate: config.endDate })}`);

  // ── Step 0: Validate prerequisites ──────────────────────────────────────────

  logStep("INIT", "Validating audit config...");
  const auditConfigRow = await getAuditConfigById(BigInt(config.auditConfigId));
  if (!auditConfigRow) {
    logError(`Audit config ${config.auditConfigId} not found in database`);
    process.exit(1);
  }
  const auditConfig: AuditConfigForAnalysis = {
    id: auditConfigRow.id.toString(),
    name: auditConfigRow.name,
    description: auditConfigRow.description,
    systemPrompt: auditConfigRow.systemPrompt,
    auditSteps: auditConfigRow.steps,
  };
  logSuccess(
    `Audit config: "${auditConfig.name}" — ${auditConfig.auditSteps.length} step(s), ` +
    `${auditConfig.auditSteps.filter((s) => s.isCritical).length} critical`
  );

  let elevenLabsKey: string | null = null;
  if (!config.skipTranscription) {
    elevenLabsKey = normalizeElevenLabsApiKey(process.env.ELEVENLABS_API_KEY);
    if (!elevenLabsKey) {
      logError("ELEVENLABS_API_KEY not configured. Use --skip-transcription to skip.");
      process.exit(1);
    }
    logSuccess("ElevenLabs API key validated");
  }

  const needsProductInfo = auditConfig.auditSteps.some(
    (s) => s.verifyProductInfo === true
  );

  // ── Step 1: Fetch all fiche IDs from the date range ─────────────────────────

  logStep("FETCH", `Fetching fiches for date range ${config.startDate} to ${config.endDate}...`);

  const dates = generateDateRange(config.startDate, config.endDate);
  log(`  Generated ${dates.length} date(s) to query`);

  const allFicheIds = new Set<string>();
  for (const isoDate of dates) {
    const slashDate = toSlashDate(isoDate);
    try {
      const fiches = await withRetry(`CRM fetch ${isoDate}`, () => fetchFichesForDate(slashDate, false));
      const ids = fiches.map(extractFicheId).filter((id): id is string => id !== null);
      for (const id of ids) {allFicheIds.add(id);}
      log(`  ${isoDate}: ${ids.length} fiche(s)`);
    } catch (err) {
      logWarn(`  ${isoDate}: failed to fetch — ${err instanceof Error ? err.message : String(err)}`);
    }

    // Small delay between API calls to avoid hammering CRM
    if (dates.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  let ficheIds: string[] = Array.from(allFicheIds);
  log(`\n  Total unique fiches: ${c.bold}${ficheIds.length}${c.reset}`);
  fileLog(`Total unique fiches from CRM: ${ficheIds.length}`);

  // ── Step 1b: Optionally filter fiches with recordings ───────────────────────

  if (config.onlyWithRecordings && ficheIds.length > 0) {
    logStep("FILTER", "Filtering fiches with recordings (checking DB)...");
    const cacheRows = await prisma.ficheCache.findMany({
      where: { ficheId: { in: ficheIds } },
      select: { ficheId: true, hasRecordings: true, recordingsCount: true },
    });
    const withRecordings = new Set(
      cacheRows
        .filter((r) => r.hasRecordings || (r.recordingsCount !== null && r.recordingsCount > 0))
        .map((r) => r.ficheId)
    );
    const cachedFicheIds = new Set(cacheRows.map((r) => r.ficheId));
    const before = ficheIds.length;
    ficheIds = ficheIds.filter((id) => withRecordings.has(id) || !cachedFicheIds.has(id));
    log(`  Before: ${before} → After: ${ficheIds.length} (removed ${before - ficheIds.length} without recordings)`);
  }

  // ── Step 1c: Skip already-audited fiches ────────────────────────────────────

  if (config.skipAudited && ficheIds.length > 0) {
    logStep("FILTER", "Checking for already-audited fiches...");
    // Query in batches of 500 to avoid hitting query param limits
    const alreadyAudited = new Set<string>();
    const batchSize = 500;
    for (let batchStart = 0; batchStart < ficheIds.length; batchStart += batchSize) {
      const batch = ficheIds.slice(batchStart, batchStart + batchSize);
      const rows = await prisma.audit.findMany({
        where: {
          ficheCache: { ficheId: { in: batch } },
          auditConfigId: BigInt(config.auditConfigId),
          status: "completed",
          isLatest: true,
        },
        select: { ficheCache: { select: { ficheId: true } } },
      });
      for (const row of rows) {
        alreadyAudited.add(row.ficheCache.ficheId);
      }
    }

    if (alreadyAudited.size > 0) {
      const before = ficheIds.length;
      ficheIds = ficheIds.filter((id) => !alreadyAudited.has(id));
      log(`  Skipped ${alreadyAudited.size} already-audited fiches (${before} → ${ficheIds.length})`);
      fileLog(`Skipped ${alreadyAudited.size} already-audited fiches`);
    } else {
      log(`  No already-audited fiches found`);
    }
  }

  // ── Step 1d: Load progress file for crash recovery ──────────────────────────

  const progressFilePath = getProgressFilePath(config.startDate, config.endDate, config.auditConfigId);
  const previousProgress = loadProgress(progressFilePath);
  if (previousProgress && previousProgress.completed.length > 0) {
    const alreadyDone = new Set(previousProgress.completed);
    const before = ficheIds.length;
    ficheIds = ficheIds.filter((id) => !alreadyDone.has(id));
    log(`  ${c.magenta}Resuming:${c.reset} skipped ${alreadyDone.size} fiches from previous run (${before} → ${ficheIds.length})`);
    fileLog(`Resuming: skipped ${alreadyDone.size} fiches from previous progress file`);
  }

  // Apply max fiches limit
  if (config.maxFiches && ficheIds.length > config.maxFiches) {
    logWarn(`Limiting to first ${config.maxFiches} fiches (out of ${ficheIds.length})`);
    ficheIds = ficheIds.slice(0, config.maxFiches);
  }

  if (ficheIds.length === 0) {
    logWarn("No fiches to process. Exiting.");
    await disconnectDb();
    return;
  }

  // ── Dry run ─────────────────────────────────────────────────────────────────

  if (config.dryRun) {
    console.log(`\n${c.bold}Fiches that would be processed (${ficheIds.length}):${c.reset}`);
    for (let i = 0; i < ficheIds.length; i++) {
      console.log(`  ${i + 1}. ${ficheIds[i]}`);
    }
    console.log(`\n${c.yellow}Dry run — no processing done.${c.reset}\n`);
    await disconnectDb();
    return;
  }

  // ── Step 2: Process each fiche sequentially ─────────────────────────────────

  console.log(`\n${c.bold}Processing ${ficheIds.length} fiche(s) sequentially...${c.reset}\n`);
  fileLog(`Starting processing of ${ficheIds.length} fiches`);

  const results: FicheResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const ficheTimesMs: number[] = []; // rolling window for ETA

  // Progress tracking
  const progress: ProgressData = {
    startedAt: new Date().toISOString(),
    config: { startDate: config.startDate, endDate: config.endDate, auditConfigId: config.auditConfigId },
    completed: previousProgress?.completed ?? [],
    failed: previousProgress?.failed ?? [],
  };

  // Graceful shutdown
  let shutdownRequested = false;
  const onSignal = () => {
    if (shutdownRequested) {
      console.log("\nForce exit.");
      process.exit(1);
    }
    shutdownRequested = true;
    console.log(`\n${c.yellow}${c.bold}Shutdown requested — finishing current fiche then exiting...${c.reset}`);
    fileLog("SIGINT received — graceful shutdown");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  for (let i = 0; i < ficheIds.length; i++) {
    if (shutdownRequested) {
      log(`${c.yellow}Shutdown: stopping after ${i} fiches${c.reset}`);
      break;
    }

    const ficheId = ficheIds[i]!;
    const ficheStart = Date.now();
    const progressStr = `[${i + 1}/${ficheIds.length}]`;

    console.log(`${c.bold}${c.blue}────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.bold}${progressStr} Fiche ${ficheId}${c.reset}`);
    console.log(`${c.blue}────────────────────────────────────────────────────${c.reset}`);

    const result: FicheResult = {
      ficheId,
      status: "success",
      recordingsCount: 0,
      durationMs: 0,
    };

    try {
      // ── STEP A: Fetch full details from CRM and cache in DB ─────────────

      logStep("DETAILS", `Fetching advanced info for fiche ${ficheId}...`);
      const detailsStart = Date.now();

      let ficheData;
      try {
        ficheData = await withRetry(`fetch details ${ficheId}`, () => fetchFicheDetails(ficheId));

        if (ficheData.recordings) {
          ficheData.recordings = ficheData.recordings.map(enrichRecording);
        }

        await cacheFicheDetails(ficheData);
        result.recordingsCount = ficheData.recordings?.length ?? 0;

        logSuccess(
          `Details fetched and cached (${elapsed(detailsStart)}) — recordings: ${result.recordingsCount}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          logWarn(`Fiche ${ficheId} not found (404) — skipping`);
          result.status = "skipped";
          result.error = "Not found (404)";
          result.durationMs = Date.now() - ficheStart;
          results.push(result);
          skipCount++;
          progress.completed.push(ficheId);
          saveProgress(progressFilePath, progress);
          fileLog(`SKIP ${ficheId} — 404`);
          continue;
        }
        throw err;
      }

      // ── GUARD: Skip fiches with too many recordings ─────────────────────

      if (result.recordingsCount > config.maxRecordings) {
        logWarn(`Fiche ${ficheId} has ${result.recordingsCount} recordings (>${config.maxRecordings}) — skipping`);
        result.status = "skipped";
        result.error = `Too many recordings (${result.recordingsCount}>${config.maxRecordings})`;
        result.durationMs = Date.now() - ficheStart;
        results.push(result);
        skipCount++;
        progress.completed.push(ficheId);
        saveProgress(progressFilePath, progress);
        fileLog(`SKIP ${ficheId} — ${result.recordingsCount} recordings (>${config.maxRecordings})`);
        continue;
      }

      // ── GUARD: Skip fiches without recordings ───────────────────────────

      if (config.onlyWithRecordings && result.recordingsCount === 0) {
        logWarn(`Fiche ${ficheId} has 0 recordings — skipping`);
        result.status = "skipped";
        result.error = "No recordings";
        result.durationMs = Date.now() - ficheStart;
        results.push(result);
        skipCount++;
        progress.completed.push(ficheId);
        saveProgress(progressFilePath, progress);
        fileLog(`SKIP ${ficheId} — no recordings`);
        continue;
      }

      // ── STEP B: Transcribe recordings ───────────────────────────────────

      if (!config.skipTranscription && result.recordingsCount > 0 && elevenLabsKey) {
        logStep("TRANSCRIBE", `Transcribing ${result.recordingsCount} recording(s)...`);
        const txStart = Date.now();
        const capturedKey = elevenLabsKey;

        const txResult = await withRetry(
          `transcribe ${ficheId}`,
          () => transcribeFicheRecordings(ficheId, capturedKey)
        );
        result.transcribed = txResult.transcribed;

        if (txResult.error) {logWarn(`Transcription warning: ${txResult.error}`);}

        logSuccess(
          `Transcription done (${elapsed(txStart)}) — ` +
            `total: ${txResult.total}, transcribed: ${txResult.transcribed}, ` +
            `new: ${txResult.newTranscriptions}` +
            (txResult.failed ? `, failed: ${txResult.failed}` : "")
        );
      } else if (config.skipTranscription) {
        logStep("TRANSCRIBE", `${c.yellow}Skipped${c.reset} (using existing DB transcriptions)`);
      }

      // ── STEP C: Build timeline from DB ──────────────────────────────────

      logStep("TIMELINE", "Building timeline from DB transcriptions...");

      const timeline = await rebuildTimelineFromDatabase(ficheId);
      const totalChunks = timeline.reduce((sum, r) => sum + (r.total_chunks || 0), 0);

      logSuccess(`Timeline: ${timeline.length} recording(s), ${totalChunks} chunks`);

      if (timeline.length === 0) {
        logWarn(`Empty timeline for fiche ${ficheId} — skipping audit`);
        result.status = "skipped";
        result.error = "Empty timeline";
        result.durationMs = Date.now() - ficheStart;
        results.push(result);
        skipCount++;
        progress.completed.push(ficheId);
        saveProgress(progressFilePath, progress);
        fileLog(`SKIP ${ficheId} — empty timeline`);
        continue;
      }

      // ── STEP D: Link product (optional) ─────────────────────────────────

      let productInfo: ProductLinkResult | null = null;
      if (needsProductInfo) {
        try {
          const { linkFicheToProduct } = await import("../src/modules/products/products.service.js");
          const linkResult = await linkFicheToProduct(ficheId);
          if (linkResult.matched && linkResult.formule) {
            productInfo = linkResult;
          }
        } catch {
          // non-fatal
        }
      }

      // ── STEP E: Run GPT analysis ────────────────────────────────────────

      logStep("AUDIT", `Running AI analysis (${auditConfig.auditSteps.length} steps)...`);
      const auditStart = Date.now();
      const auditId = `script-audit-${ficheId}-${config.auditConfigId}-${Date.now()}`;

      const timelineText = buildTimelineText(timeline);

      const auditResults = await withRetry(`audit ${ficheId}`, () =>
        analyzeAllSteps(auditConfig, timeline, timelineText, auditId, ficheId, productInfo)
      );

      enrichCitationsWithMetadata(auditResults, timeline);

      logSuccess(
        `Analysis done (${elapsed(auditStart)}) — ` +
          `ok: ${auditResults.statistics.successful}, fail: ${auditResults.statistics.failed}, ` +
          `tokens: ${auditResults.statistics.total_tokens}`
      );

      // ── STEP F: Calculate compliance + save ─────────────────────────────

      logStep("SAVE", "Saving audit...");

      const totalWeight = auditConfig.auditSteps.reduce((sum, s) => sum + s.weight, 0);
      const earnedWeight = auditResults.steps.reduce((sum, s) => {
        const score = (s as { score?: unknown }).score;
        if (typeof score !== "number") {return sum;}
        const metaWeight = (s as { step_metadata?: { weight?: unknown } }).step_metadata?.weight;
        const maxWeight = typeof metaWeight === "number" ? metaWeight : score;
        return sum + Math.min(score, maxWeight);
      }, 0);

      const scorePercent = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

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

      const savedAudit = await saveAuditResult(
        {
          audit: {
            config: { id: auditConfig.id, name: auditConfig.name, description: auditConfig.description },
            fiche: { fiche_id: ficheId, prospect_name: prospectName, groupe },
            results: { ...auditResults, compliance },
            compliance,
          },
          statistics: {
            recordings_count: timeline.length,
            transcriptions_count: timeline.length,
            timeline_chunks: totalChunks,
            successful_steps: auditResults.statistics.successful,
            failed_steps: auditResults.statistics.failed,
            total_time_seconds: auditResults.statistics.total_time_seconds,
            total_tokens: auditResults.statistics.total_tokens,
          },
          metadata: {
            started_at: new Date(ficheStart).toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - ficheStart,
          },
        },
        cachedFiche.id
      );

      result.score = compliance.score;
      result.niveau = compliance.niveau;

      logSuccess(
        `${c.bold}Score: ${compliance.score}% — ${compliance.niveau}${c.reset} ` +
          `(critical: ${compliance.points_critiques}, audit_id: ${savedAudit.id})`
      );

      result.status = "success";
      successCount++;
      progress.completed.push(ficheId);
      fileLog(`OK ${ficheId} — score=${compliance.score}% niveau=${compliance.niveau} recs=${result.recordingsCount} time=${elapsed(ficheStart)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.status = "failed";
      result.error = msg;
      failCount++;
      progress.failed.push(ficheId);

      logError(`Fiche ${ficheId} failed: ${msg}`);
      fileLog(`FAIL ${ficheId} — ${msg}`);

      if (config.stopOnError) {
        logError("Stopping (--stop-on-error is set)");
        result.durationMs = Date.now() - ficheStart;
        results.push(result);
        saveProgress(progressFilePath, progress);
        break;
      }
    }

    result.durationMs = Date.now() - ficheStart;
    results.push(result);
    ficheTimesMs.push(result.durationMs);
    saveProgress(progressFilePath, progress);

    // ── Periodic throughput/ETA log (every 10 fiches) ───────────────────

    const processed = i + 1;
    if (processed % 10 === 0 || processed === ficheIds.length) {
      const remaining = ficheIds.length - processed;
      const recentTimes = ficheTimesMs.slice(-20); // last 20 fiches
      const avgMs = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
      const etaMs = remaining * avgMs;
      const throughput = (processed / ((Date.now() - globalStart) / 1000)) * 3600; // per hour

      console.log(
        `\n${c.magenta}${c.bold}  PROGRESS: ${processed}/${ficheIds.length}${c.reset}` +
          ` — ok: ${c.green}${successCount}${c.reset}` +
          ` fail: ${failCount > 0 ? `${c.red}${failCount}${c.reset}` : "0"}` +
          ` skip: ${skipCount > 0 ? `${c.yellow}${skipCount}${c.reset}` : "0"}` +
          ` — avg: ${(avgMs / 1000).toFixed(0)}s/fiche` +
          ` — ${c.cyan}ETA: ${elapsed(Date.now() - etaMs).replace("-", "")}${c.reset}` +
          ` — ~${Math.round(throughput)} fiches/h` +
          ` — elapsed: ${elapsed(globalStart)}\n`
      );
      fileLog(`PROGRESS ${processed}/${ficheIds.length} ok=${successCount} fail=${failCount} skip=${skipCount} avg=${(avgMs / 1000).toFixed(0)}s eta=${elapsed(Date.now() - etaMs)} throughput=${Math.round(throughput)}/h`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const totalDuration = elapsed(globalStart);

  console.log(`\n${c.bold}============================================================${c.reset}`);
  console.log(`${c.bold}  SUMMARY${c.reset}`);
  console.log(`${c.bold}============================================================${c.reset}`);
  console.log(`  Total fiches : ${results.length}`);
  console.log(`  Successful   : ${c.green}${successCount}${c.reset}`);
  console.log(`  Failed       : ${failCount > 0 ? `${c.red}${failCount}${c.reset}` : "0"}`);
  console.log(`  Skipped      : ${skipCount > 0 ? `${c.yellow}${skipCount}${c.reset}` : "0"}`);
  console.log(`  Duration     : ${totalDuration}`);
  if (ficheTimesMs.length > 0) {
    const avgMs = ficheTimesMs.reduce((a, b) => a + b, 0) / ficheTimesMs.length;
    console.log(`  Avg per fiche: ${(avgMs / 1000).toFixed(1)}s`);
  }
  console.log(`============================================================\n`);

  fileLog(`DONE total=${results.length} ok=${successCount} fail=${failCount} skip=${skipCount} duration=${totalDuration}`);

  // Detailed results table
  if (results.length > 0 && results.length <= 200) {
    // Only print full table for reasonable sizes; for 2000 fiches the log file has all details
    console.log(`${c.bold}Detailed results:${c.reset}\n`);
    console.log(
      `  ${"#".padStart(4)}  ${"Fiche ID".padEnd(12)}  ${"Status".padEnd(8)}  ${"Recs".padStart(4)}  ${"TX".padStart(4)}  ${"Score".padStart(6)}  ${"Niveau".padEnd(14)}  ${"Time".padEnd(8)}  Error`
    );
    console.log(`  ${"─".repeat(100)}`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const statusColor =
        r.status === "success" ? c.green : r.status === "failed" ? c.red : c.yellow;
      const score = r.score !== undefined ? `${r.score}%` : "—";
      const niveau = r.niveau ?? "—";
      const tx = r.transcribed !== undefined ? `${r.transcribed}` : "—";
      const time = `${(r.durationMs / 1000).toFixed(0)}s`;
      const error = r.error ? `${c.dim}${r.error.slice(0, 40)}${c.reset}` : "";

      console.log(
        `  ${String(i + 1).padStart(4)}  ${r.ficheId.padEnd(12)}  ${statusColor}${r.status.padEnd(8)}${c.reset}  ${String(r.recordingsCount).padStart(4)}  ${tx.padStart(4)}  ${score.padStart(6)}  ${niveau.padEnd(14)}  ${time.padEnd(8)}  ${error}`
      );
    }
    console.log("");
  } else if (results.length > 200) {
    console.log(`${c.dim}(${results.length} results — see log file for full details)${c.reset}\n`);
  }

  // Cleanup: remove progress file on fully successful run
  if (failCount === 0 && !shutdownRequested) {
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(progressFilePath);
    } catch {
      // ignore
    }
  }

  await disconnectDb();

  if (failCount > 0) {
    console.log(`${c.yellow}Tip: Re-run the same command to retry failed fiches (progress is saved).${c.reset}\n`);
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(`\n${c.red}${c.bold}FATAL ERROR:${c.reset} ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(`${c.dim}${err.stack}${c.reset}`);
  }
  fileLog(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  try {
    await disconnectDb();
  } catch {
    // ignore
  }
  process.exit(1);
});
