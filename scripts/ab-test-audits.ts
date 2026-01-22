/**
 * AB Test Runner — Audits (prompt vs transcript tools)
 * ====================================================
 *
 * What it does:
 * - Samples random fiches ("sales") from Postgres (via Prisma)
 * - For each fiche, runs TWO audits with the same audit_config_id:
 *   - Variant A: legacy prompt-stuffing (use_rlm=false)
 *   - Variant B: transcript tools mode (use_rlm=true)
 * - Waits for both audits to complete by polling the DB
 * - Writes:
 *   - data/ab-tests/ab-test-audits.<timestamp>.json (full machine-readable benchmark)
 *   - data/ab-tests/ab-test-audits.<timestamp>.md (human-readable summary + diffs)
 *
 * Usage:
 *   npx tsx scripts/ab-test-audits.ts --count 5 --audit-config-id 13
 *
 * Optional:
 *   npx tsx scripts/ab-test-audits.ts --count 10 --sales-date 2026-01-19
 *
 * Notes:
 * - Requires DB connectivity (`DATABASE_URL`)
 * - Requires Inngest configuration so `inngest.send()` can enqueue events
 * - Does NOT print secrets (never logs DATABASE_URL)
 */

import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Prisma } from "@prisma/client";

import { inngest } from "../src/inngest/client.js";
import { stringifyWithBigInt } from "../src/shared/bigint-serializer.js";
import { disconnectDb,prisma } from "../src/shared/prisma.js";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimestampForFilename(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "_",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join("");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {return value;}
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  // Prisma Decimal (and similar) often come through as objects with a useful toString()
  if (typeof value === "object" && value !== null) {
    const v = value as { toString?: () => string };
    if (typeof v.toString === "function") {
      const s = v.toString();
      if (typeof s === "string" && s.trim() && s !== "[object Object]") {
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {return null;}
  if (Array.isArray(value)) {return null;}
  return value as Record<string, unknown>;
}

function readApproach(resultData: unknown): { use_rlm: boolean | null; transcript_mode: string | null } {
  const rec = asRecord(resultData);
  if (!rec) {return { use_rlm: null, transcript_mode: null };}

  // Prefer `metadata.approach` (final audit payload), fallback to root `approach` (pending record).
  const metadata = asRecord(rec.metadata);
  const audit = asRecord(rec.audit);
  const auditApproach = audit ? asRecord(audit.approach) : null;
  const metaApproach = metadata ? asRecord(metadata.approach) : null;
  const rootApproach = asRecord(rec.approach);

  const src = metaApproach ?? auditApproach ?? rootApproach;
  if (!src) {return { use_rlm: null, transcript_mode: null };}

  return {
    use_rlm: typeof src.use_rlm === "boolean" ? src.use_rlm : null,
    transcript_mode: typeof src.transcript_mode === "string" ? src.transcript_mode : null,
  };
}

function avg(values: number[]) {
  if (values.length === 0) {return null;}
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function median(values: number[]) {
  if (values.length === 0) {return null;}
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {return sorted[mid];}
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatNumber(n: number | null, digits = 2) {
  if (n === null) {return "—";}
  return n.toFixed(digits);
}

function formatInt(n: number | null) {
  if (n === null) {return "—";}
  return String(Math.round(n));
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {continue;}

    const [keyRaw, inlineValue] = token.slice(2).split("=", 2);
    const key = keyRaw.trim();
    if (!key) {continue;}

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function usageAndExit(code: number) {
   
  console.log(
    [
      "",
      "AB Test Runner — Audits (prompt vs transcript tools)",
      "",
      "Usage:",
      "  npx tsx scripts/ab-test-audits.ts --count 5 --audit-config-id 13",
      "",
      "Options:",
      "  --count             Number of fiches to sample (default: 3)",
      "  --audit-config-id   Audit config ID to run (default: latest active)",
      "  --sales-date        Optional filter (YYYY-MM-DD) on fiche_cache.sales_date",
      "  --poll-ms           Poll interval for DB status (default: 5000)",
      "  --timeout-ms        Per-audit timeout (default: 3600000 = 60min)",
      "  --help              Show this help",
      "",
      "Output:",
      "  data/ab-tests/ab-test-audits.<timestamp>.json",
      "  data/ab-tests/ab-test-audits.<timestamp>.md",
      "",
    ].join("\n")
  );
  process.exit(code);
}

type AuditWithDetails = Prisma.AuditGetPayload<{
  include: {
    stepResults: true;
    auditConfig: { select: { id: true; name: true } };
    ficheCache: { select: { ficheId: true; salesDate: true } };
  };
}>;

async function getLatestActiveAuditConfigId(): Promise<number> {
  const cfg = await prisma.auditConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!cfg) {throw new Error("No active audit configuration found");}
  return Number(cfg.id);
}

async function pickRandomFicheIds(params: {
  count: number;
  salesDate?: string;
}): Promise<string[]> {
  const count = Math.max(1, Math.min(200, Math.floor(params.count)));
  const salesDate = typeof params.salesDate === "string" && params.salesDate.trim() ? params.salesDate.trim() : null;

  // Prefer fiches that are:
  // - fully cached (not expired)
  // - have recordings
  // - and ALL recordings already have transcriptions
  // so the benchmark focuses on audit behavior, not transcription latency.
  const rows = await prisma.$queryRaw<Array<{ fiche_id: string }>>`
    SELECT fc.fiche_id
    FROM fiche_cache fc
    WHERE fc.has_recordings = TRUE
      AND fc.expires_at > NOW()
      AND (${salesDate}::text IS NULL OR fc.sales_date = ${salesDate}::text)
      AND EXISTS (
        SELECT 1
        FROM recordings r
        WHERE r.fiche_cache_id = fc.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM recordings r
        WHERE r.fiche_cache_id = fc.id
          AND (r.has_transcription IS DISTINCT FROM TRUE OR r.transcription_text IS NULL)
      )
    ORDER BY RANDOM()
    LIMIT ${count};
  `;

  return rows
    .map((r) => (typeof r.fiche_id === "string" ? r.fiche_id : ""))
    .filter((id) => Boolean(id));
}

async function waitForAuditByTriggerSource(params: {
  triggerSource: string;
  pollMs: number;
  timeoutMs: number;
}): Promise<AuditWithDetails> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    const audit = await prisma.audit.findFirst({
      where: { triggerSource: params.triggerSource },
      orderBy: { createdAt: "desc" },
      include: {
        stepResults: true,
        auditConfig: { select: { id: true, name: true } },
        ficheCache: { select: { ficheId: true, salesDate: true } },
      },
    });
    if (audit) {return audit;}
    await sleep(params.pollMs);
  }
  throw new Error(`Timeout waiting for audit to be created (triggerSource=${params.triggerSource})`);
}

async function waitForAuditTerminal(params: {
  auditDbId: bigint;
  pollMs: number;
  timeoutMs: number;
}): Promise<AuditWithDetails> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    const audit = await prisma.audit.findUnique({
      where: { id: params.auditDbId },
      include: {
        stepResults: true,
        auditConfig: { select: { id: true, name: true } },
        ficheCache: { select: { ficheId: true, salesDate: true } },
      },
    });
    if (!audit) {throw new Error(`Audit not found (id=${String(params.auditDbId)})`);}

    if (audit.status === "completed" || audit.status === "failed") {
      return audit;
    }

    await sleep(params.pollMs);
  }
  throw new Error(`Timeout waiting for audit to complete (id=${String(params.auditDbId)})`);
}

function summarizeVariant(audit: AuditWithDetails) {
  const score = toNumberOrNull(audit.scorePercentage);
  const durationMs = typeof audit.durationMs === "number" ? audit.durationMs : null;
  const totalTokens = typeof audit.totalTokens === "number" ? audit.totalTokens : null;
  const citations = audit.stepResults.reduce((sum, s) => sum + Number(s.totalCitations || 0), 0);
  const stepTokens = audit.stepResults.reduce((sum, s) => sum + Number(s.totalTokens || 0), 0);
  const approach = readApproach(audit.resultData);

  const steps = [...audit.stepResults]
    .sort((a, b) => a.stepPosition - b.stepPosition)
    .map((s) => ({
      step_position: s.stepPosition,
      step_name: s.stepName,
      score: s.score,
      weight: s.weight,
      conforme: s.conforme,
      niveau_conformite: s.niveauConformite,
      total_citations: s.totalCitations,
      total_tokens: s.totalTokens,
    }));

  return {
    audit_db_id: audit.id,
    status: audit.status,
    error_message: audit.errorMessage ?? null,
    fiche_id: audit.ficheCache.ficheId,
    sales_date: audit.ficheCache.salesDate ?? null,
    audit_config_id: audit.auditConfigId,
    audit_config_name: audit.auditConfig.name,
    created_at: audit.createdAt.toISOString(),
    started_at: audit.startedAt?.toISOString() ?? null,
    completed_at: audit.completedAt?.toISOString() ?? null,
    duration_ms: durationMs,
    score_percentage: score,
    niveau: audit.niveau,
    is_compliant: audit.isCompliant,
    critical_passed: audit.criticalPassed,
    critical_total: audit.criticalTotal,
    successful_steps: audit.successfulSteps,
    failed_steps: audit.failedSteps,
    total_tokens: totalTokens,
    total_step_tokens: stepTokens,
    total_citations: citations,
    approach,
    steps,
  };
}

function buildMarkdownReport(params: {
  exportedAt: Date;
  auditConfigId: number;
  auditConfigName: string;
  sampleSize: number;
  salesDateFilter: string | null;
  perFiche: Array<{
    fiche_id: string;
    prompt: ReturnType<typeof summarizeVariant> | null;
    tools: ReturnType<typeof summarizeVariant> | null;
  }>;
}) {
  const lines: string[] = [];
  const runAt = params.exportedAt.toISOString();

  type VariantSummary = ReturnType<typeof summarizeVariant>;
  type PerFicheRow = {
    fiche_id: string;
    prompt: VariantSummary | null;
    tools: VariantSummary | null;
  };
  type CompletedPair = {
    fiche_id: string;
    prompt: VariantSummary;
    tools: VariantSummary;
  };

  const isCompletedPair = (row: PerFicheRow): row is CompletedPair =>
    row.prompt !== null &&
    row.tools !== null &&
    row.prompt.status === "completed" &&
    row.tools.status === "completed";

  const completedPairs = (params.perFiche as PerFicheRow[]).filter(isCompletedPair);

  const promptScores = completedPairs
    .map((x) => x.prompt.score_percentage)
    .filter((v): v is number => typeof v === "number");
  const toolsScores = completedPairs
    .map((x) => x.tools.score_percentage)
    .filter((v): v is number => typeof v === "number");
  const scoreDeltas: number[] = [];
  for (const x of completedPairs) {
    const p = x.prompt.score_percentage;
    const t = x.tools.score_percentage;
    if (typeof p === "number" && typeof t === "number") {scoreDeltas.push(t - p);}
  }

  const promptTokens = completedPairs
    .map((x) => x.prompt.total_tokens)
    .filter((v): v is number => typeof v === "number");
  const toolsTokens = completedPairs
    .map((x) => x.tools.total_tokens)
    .filter((v): v is number => typeof v === "number");
  const tokenDeltas: number[] = [];
  for (const x of completedPairs) {
    const p = x.prompt.total_tokens;
    const t = x.tools.total_tokens;
    if (typeof p === "number" && typeof t === "number") {tokenDeltas.push(t - p);}
  }

  const promptDur = completedPairs
    .map((x) => x.prompt.duration_ms)
    .filter((v): v is number => typeof v === "number");
  const toolsDur = completedPairs
    .map((x) => x.tools.duration_ms)
    .filter((v): v is number => typeof v === "number");
  const durDeltas: number[] = [];
  for (const x of completedPairs) {
    const p = x.prompt.duration_ms;
    const t = x.tools.duration_ms;
    if (typeof p === "number" && typeof t === "number") {durDeltas.push(t - p);}
  }

  const promptCitations = completedPairs
    .map((x) => x.prompt.total_citations)
    .filter((v): v is number => typeof v === "number");
  const toolsCitations = completedPairs
    .map((x) => x.tools.total_citations)
    .filter((v): v is number => typeof v === "number");
  const citationDeltas: number[] = [];
  for (const x of completedPairs) {
    const p = x.prompt.total_citations;
    const t = x.tools.total_citations;
    if (typeof p === "number" && typeof t === "number") {citationDeltas.push(t - p);}
  }

  lines.push("# AB Test — Audits (prompt vs transcript tools)");
  lines.push("");
  lines.push(`- **Run at**: ${runAt}`);
  lines.push(`- **Audit config**: ${params.auditConfigName} (id: ${params.auditConfigId})`);
  lines.push(`- **Sample size**: ${params.sampleSize}`);
  if (params.salesDateFilter) {
    lines.push(`- **sales_date filter**: ${params.salesDateFilter}`);
  }
  lines.push(`- **Completed pairs**: ${completedPairs.length}/${params.perFiche.length}`);
  lines.push("");

  lines.push("## Aggregate benchmark (completed pairs only)");
  lines.push("");
  lines.push("| Metric | Prompt (mean / median) | Tools (mean / median) | Δ Tools−Prompt (mean / median) |");
  lines.push("|---|---:|---:|---:|");
  lines.push(
    `| Score (%) | ${formatNumber(avg(promptScores))} / ${formatNumber(median(promptScores))} | ${formatNumber(avg(toolsScores))} / ${formatNumber(median(toolsScores))} | ${formatNumber(avg(scoreDeltas))} / ${formatNumber(median(scoreDeltas))} |`
  );
  lines.push(
    `| Total tokens | ${formatInt(avg(promptTokens))} / ${formatInt(median(promptTokens))} | ${formatInt(avg(toolsTokens))} / ${formatInt(median(toolsTokens))} | ${formatInt(avg(tokenDeltas))} / ${formatInt(median(tokenDeltas))} |`
  );
  lines.push(
    `| Duration (ms) | ${formatInt(avg(promptDur))} / ${formatInt(median(promptDur))} | ${formatInt(avg(toolsDur))} / ${formatInt(median(toolsDur))} | ${formatInt(avg(durDeltas))} / ${formatInt(median(durDeltas))} |`
  );
  lines.push(
    `| Citations | ${formatInt(avg(promptCitations))} / ${formatInt(median(promptCitations))} | ${formatInt(avg(toolsCitations))} / ${formatInt(median(toolsCitations))} | ${formatInt(avg(citationDeltas))} / ${formatInt(median(citationDeltas))} |`
  );
  lines.push("");

  lines.push("## Per-fiche summary");
  lines.push("");
  lines.push(
    "| Fiche | Prompt status | Prompt score | Tools status | Tools score | Δ score | Prompt tokens | Tools tokens | Δ tokens | Prompt ms | Tools ms | Δ ms |"
  );
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|");

  for (const row of params.perFiche) {
    const ps = row.prompt?.status ?? "missing";
    const ts = row.tools?.status ?? "missing";
    const pScore = row.prompt?.score_percentage ?? null;
    const tScore = row.tools?.score_percentage ?? null;
    const dScore =
      typeof pScore === "number" && typeof tScore === "number" ? tScore - pScore : null;
    const pTok = row.prompt?.total_tokens ?? null;
    const tTok = row.tools?.total_tokens ?? null;
    const dTok =
      typeof pTok === "number" && typeof tTok === "number" ? tTok - pTok : null;
    const pMs = row.prompt?.duration_ms ?? null;
    const tMs = row.tools?.duration_ms ?? null;
    const dMs = typeof pMs === "number" && typeof tMs === "number" ? tMs - pMs : null;

    lines.push(
      `| ${row.fiche_id} | ${ps} | ${formatNumber(pScore)} | ${ts} | ${formatNumber(tScore)} | ${formatNumber(dScore)} | ${formatInt(pTok)} | ${formatInt(tTok)} | ${formatInt(dTok)} | ${formatInt(pMs)} | ${formatInt(tMs)} | ${formatInt(dMs)} |`
    );
  }

  lines.push("");
  lines.push("## Step-level deltas (completed pairs only)");
  lines.push("");
  lines.push(
    "For each fiche, the table shows per-step **Δ score**, **Δ tokens**, and **Δ citations** (Tools−Prompt)."
  );

  for (const row of completedPairs) {
    lines.push("");
    lines.push(`### Fiche ${row.fiche_id}`);
    lines.push("");
    lines.push("| Step | Name | Δ score | Δ tokens | Δ citations | Prompt conforme → Tools conforme |");
    lines.push("|---:|---|---:|---:|---:|---|");

    const promptSteps = new Map<number, (typeof row.prompt)["steps"][number]>(
      row.prompt!.steps.map((s) => [s.step_position, s])
    );
    const toolsSteps = new Map<number, (typeof row.tools)["steps"][number]>(
      row.tools!.steps.map((s) => [s.step_position, s])
    );
    const positions = [...new Set([...promptSteps.keys(), ...toolsSteps.keys()])].sort(
      (a, b) => a - b
    );

    for (const pos of positions) {
      const p = promptSteps.get(pos);
      const t = toolsSteps.get(pos);
      const name = (t?.step_name || p?.step_name || "").replaceAll("\n", " ");
      const dScore =
        typeof p?.score === "number" && typeof t?.score === "number" ? t.score - p.score : null;
      const dTok =
        typeof p?.total_tokens === "number" && typeof t?.total_tokens === "number"
          ? t.total_tokens - p.total_tokens
          : null;
      const dCit =
        typeof p?.total_citations === "number" && typeof t?.total_citations === "number"
          ? t.total_citations - p.total_citations
          : null;
      const pConf = p?.conforme ?? "—";
      const tConf = t?.conforme ?? "—";
      lines.push(
        `| ${pos} | ${name} | ${formatNumber(dScore)} | ${formatInt(dTok)} | ${formatInt(dCit)} | ${pConf} → ${tConf} |`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === true) {usageAndExit(0);}

  const count = toNumberOrNull(args.count) ?? 3;
  const pollMs = toNumberOrNull(args["poll-ms"]) ?? 5000;
  const timeoutMs = toNumberOrNull(args["timeout-ms"]) ?? 60 * 60 * 1000;

  const auditConfigId =
    toNumberOrNull(args["audit-config-id"]) ?? (await getLatestActiveAuditConfigId());

  const salesDate =
    typeof args["sales-date"] === "string" && args["sales-date"].trim()
      ? args["sales-date"].trim()
      : null;

  if (!Number.isFinite(auditConfigId) || auditConfigId <= 0) {
    throw new Error(`Invalid --audit-config-id: ${String(args["audit-config-id"] ?? "")}`);
  }

  const exportedAt = new Date();
  const timestamp = formatTimestampForFilename(exportedAt);
  const outDir = resolve("data", "ab-tests");
  mkdirSync(outDir, { recursive: true });

  const cfg = await prisma.auditConfig.findUnique({
    where: { id: BigInt(auditConfigId) },
    select: { id: true, name: true },
  });
  if (!cfg) {throw new Error(`Audit config not found: ${auditConfigId}`);}

   
  console.log(
    stringifyWithBigInt(
      {
        message: "AB test starting",
        audit_config_id: auditConfigId,
        audit_config_name: cfg.name,
        sample_count: count,
        sales_date: salesDate,
        poll_ms: pollMs,
        timeout_ms: timeoutMs,
      },
      2
    )
  );

  const ficheIds = await pickRandomFicheIds({ count, salesDate: salesDate ?? undefined });
  if (ficheIds.length === 0) {
    throw new Error(
      "No eligible fiches found (need has_recordings=true, expires_at>now(), and all recordings transcribed)"
    );
  }

  const runTag = `abtest:${timestamp}`;
  const perFiche: Array<{
    fiche_id: string;
    prompt: ReturnType<typeof summarizeVariant> | null;
    tools: ReturnType<typeof summarizeVariant> | null;
    triggers: { prompt: string; tools: string };
    event_ids: { prompt: string | null; tools: string | null };
  }> = [];

  for (const ficheId of ficheIds) {
    // Run variants sequentially per fiche for cleaner duration comparisons.
    const triggerPrompt = `${runTag}:${ficheId}:prompt`;
    const triggerTools = `${runTag}:${ficheId}:tools`;

    const row = {
      fiche_id: ficheId,
      prompt: null as ReturnType<typeof summarizeVariant> | null,
      tools: null as ReturnType<typeof summarizeVariant> | null,
      triggers: { prompt: triggerPrompt, tools: triggerTools },
      event_ids: { prompt: null as string | null, tools: null as string | null },
    };
    perFiche.push(row);

     
    console.log(`\n[${ficheId}] Queueing PROMPT audit...`);
    {
      const { ids } = await inngest.send({
        name: "audit/run",
        data: {
          fiche_id: ficheId,
          audit_config_id: auditConfigId,
          use_rlm: false,
          trigger_source: triggerPrompt,
          user_id: "ab-test",
        },
        id: `${triggerPrompt}:${Date.now()}`,
      });
      row.event_ids.prompt = ids?.[0] ?? null;
    }

    const createdPrompt = await waitForAuditByTriggerSource({
      triggerSource: triggerPrompt,
      pollMs,
      timeoutMs,
    });
    const finalPrompt = await waitForAuditTerminal({
      auditDbId: createdPrompt.id,
      pollMs,
      timeoutMs,
    });
    row.prompt = summarizeVariant(finalPrompt);

     
    console.log(
      `[${ficheId}] PROMPT done: status=${row.prompt.status} score=${row.prompt.score_percentage ?? "n/a"} tokens=${row.prompt.total_tokens ?? "n/a"} ms=${row.prompt.duration_ms ?? "n/a"}`
    );

     
    console.log(`\n[${ficheId}] Queueing TOOLS audit...`);
    {
      const { ids } = await inngest.send({
        name: "audit/run",
        data: {
          fiche_id: ficheId,
          audit_config_id: auditConfigId,
          use_rlm: true,
          trigger_source: triggerTools,
          user_id: "ab-test",
        },
        id: `${triggerTools}:${Date.now()}`,
      });
      row.event_ids.tools = ids?.[0] ?? null;
    }

    const createdTools = await waitForAuditByTriggerSource({
      triggerSource: triggerTools,
      pollMs,
      timeoutMs,
    });
    const finalTools = await waitForAuditTerminal({
      auditDbId: createdTools.id,
      pollMs,
      timeoutMs,
    });
    row.tools = summarizeVariant(finalTools);

     
    console.log(
      `[${ficheId}] TOOLS done: status=${row.tools.status} score=${row.tools.score_percentage ?? "n/a"} tokens=${row.tools.total_tokens ?? "n/a"} ms=${row.tools.duration_ms ?? "n/a"}`
    );
  }

  const jsonOut = resolve(outDir, `ab-test-audits.${timestamp}.json`);
  const mdOut = resolve(outDir, `ab-test-audits.${timestamp}.md`);

  const report = {
    kind: "ab-test-audits",
    exported_at: exportedAt.toISOString(),
    run_tag: runTag,
    input: {
      audit_config_id: auditConfigId,
      audit_config_name: cfg.name,
      count_requested: count,
      sales_date: salesDate,
      poll_ms: pollMs,
      timeout_ms: timeoutMs,
    },
    sampled_fiche_ids: ficheIds,
    results: perFiche,
  };

  writeFileSync(jsonOut, stringifyWithBigInt(report, 2), "utf8");

  const markdown = buildMarkdownReport({
    exportedAt,
    auditConfigId,
    auditConfigName: cfg.name,
    sampleSize: ficheIds.length,
    salesDateFilter: salesDate,
    perFiche: perFiche.map((r) => ({ fiche_id: r.fiche_id, prompt: r.prompt, tools: r.tools })),
  });
  writeFileSync(mdOut, markdown, "utf8");

   
  console.log(`\nDone.\n- JSON: ${jsonOut}\n- MD:   ${mdOut}\n`);
}

main()
  .catch((err) => {
     
    console.error("AB test failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });

