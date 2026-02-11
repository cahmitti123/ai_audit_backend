/* eslint-disable no-console */
/**
 * clean-nonsales-fiches.ts
 * ========================
 * One-off script that removes cached fiches which are NOT actual sales.
 *
 * The old gateway endpoint (/search/by-date-with-calls) had no sales filter,
 * so the fiche_cache table may contain non-sale fiches. This script queries
 * the gateway's /sales-with-calls endpoint week-by-week, compares against
 * cached data, and immediately deletes any non-sales.
 *
 * Usage:
 *   npx tsx src/scripts/clean-nonsales-fiches.ts --dry-run        # preview (default)
 *   npx tsx src/scripts/clean-nonsales-fiches.ts --execute         # delete
 *   npx tsx src/scripts/clean-nonsales-fiches.ts --execute --concurrency=5
 */

import axios from "axios";

import { gateway } from "../shared/gateway-client.js";
import { prisma } from "../shared/prisma.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFicheId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {return null;}
  const rec = value as Record<string, unknown>;
  for (const key of ["ficheId", "fiche_id", "id"]) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) {return v;}
    if (typeof v === "number" && Number.isFinite(v)) {return String(v);}
  }
  return null;
}

/** Group sorted dates (YYYY-MM-DD, descending) into weekly ranges. */
function groupIntoWeeks(dates: string[]): Array<{ start: string; end: string }> {
  if (dates.length === 0) {return [];}

  // Sort ascending for grouping, then reverse the result
  const sorted = [...dates].sort();
  const weeks: Array<{ start: string; end: string }> = [];

  let weekStart = sorted[0];
  let weekEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i];
    const prev = new Date(weekEnd + "T00:00:00Z");
    const curr = new Date(d + "T00:00:00Z");
    const diffDays = (curr.getTime() - prev.getTime()) / 86_400_000;

    // Same week = within 7 days of the week start AND not spanning > 7 days total
    const spanDays =
      (curr.getTime() - new Date(weekStart + "T00:00:00Z").getTime()) / 86_400_000;

    if (diffDays <= 1 && spanDays < 7) {
      weekEnd = d;
    } else {
      weeks.push({ start: weekStart, end: weekEnd });
      weekStart = d;
      weekEnd = d;
    }
  }
  weeks.push({ start: weekStart, end: weekEnd });

  // Return most recent first
  return weeks.reverse();
}

// ---------------------------------------------------------------------------
// Gateway call — one per week range
// ---------------------------------------------------------------------------

let _gatewayDebugDone = false;

async function fetchSalesFicheIdsForRange(
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    status_id: "53",
    include_recordings: "false",
    include_transcriptions: "false",
  });

  const url = gateway.url("/api/fiches/sales-with-calls", params);

  // No auth headers — endpoint works without auth; stale tokens cause empty results.
  const response = await axios.get(url, { timeout: 120_000 });
  const data = response.data;

  // Debug first successful call
  if (!_gatewayDebugDone) {
    _gatewayDebugDone = true;
    console.log("  [DEBUG] Gateway URL:", url);
    console.log("  [DEBUG] Status:", response.status);
    console.log("  [DEBUG] Keys:", data ? Object.keys(data) : "null");
    console.log("  [DEBUG] fiches array:", Array.isArray(data?.fiches), "total:", data?.total);
    if (Array.isArray(data?.fiches) && data.fiches.length > 0) {
      console.log("  [DEBUG] First fiche id:", data.fiches[0].id, "type:", typeof data.fiches[0].id);
    }
  }

  const fiches: unknown[] = Array.isArray(data?.fiches) ? (data.fiches as unknown[]) : [];
  const ids = new Set<string>();
  for (const f of fiches) {
    const id = extractFicheId(f);
    if (id) {ids.add(id);}
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Deletion — immediate, per-week
// ---------------------------------------------------------------------------

interface WeekResult {
  week: string;
  cached: number;
  gatewaySales: number;
  toDelete: number;
  deleted: number;
  auditsDeleted: number;
  conversationsDeleted: number;
  ficheResultsDeleted: number;
  error?: string;
}

async function processWeek(
  start: string,
  end: string,
  execute: boolean,
  label: string
): Promise<WeekResult> {
  const weekLabel = start === end ? start : `${start} → ${end}`;

  // 1. Get cached fiches for this date range
  const cachedFiches = await prisma.ficheCache.findMany({
    where: {
      salesDate: { gte: start, lte: end },
    },
    select: { id: true, ficheId: true },
  });

  if (cachedFiches.length === 0) {
    console.log(`${label} ${weekLabel}: 0 cached — skip`);
    return { week: weekLabel, cached: 0, gatewaySales: 0, toDelete: 0, deleted: 0, auditsDeleted: 0, conversationsDeleted: 0, ficheResultsDeleted: 0 };
  }

  // 2. Fetch actual sales from gateway (single call for the whole week)
  let gatewayIds: Set<string>;
  try {
    gatewayIds = await fetchSalesFicheIdsForRange(start, end);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${label} ${weekLabel}: GATEWAY ERROR — ${msg}`);
    return { week: weekLabel, cached: cachedFiches.length, gatewaySales: 0, toDelete: 0, deleted: 0, auditsDeleted: 0, conversationsDeleted: 0, ficheResultsDeleted: 0, error: msg };
  }

  // 3. Diff
  const cachedIdMap = new Map(cachedFiches.map((f) => [f.ficheId, f.id]));
  const toDeleteIds: bigint[] = [];
  const toDeleteFicheIds: string[] = [];

  for (const [ficheId, cacheId] of cachedIdMap) {
    if (!gatewayIds.has(ficheId)) {
      toDeleteIds.push(cacheId);
      toDeleteFicheIds.push(ficheId);
    }
  }

  if (toDeleteIds.length === 0) {
    console.log(`${label} ${weekLabel}: ${cachedFiches.length} cached, ${gatewayIds.size} sales — clean`);
    return { week: weekLabel, cached: cachedFiches.length, gatewaySales: gatewayIds.size, toDelete: 0, deleted: 0, auditsDeleted: 0, conversationsDeleted: 0, ficheResultsDeleted: 0 };
  }

  console.log(`${label} ${weekLabel}: ${cachedFiches.length} cached, ${gatewayIds.size} sales — ${toDeleteIds.length} to remove`);

  // 4. Delete immediately
  if (!execute) {
    return { week: weekLabel, cached: cachedFiches.length, gatewaySales: gatewayIds.size, toDelete: toDeleteIds.length, deleted: 0, auditsDeleted: 0, conversationsDeleted: 0, ficheResultsDeleted: 0 };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const audits = await tx.audit.deleteMany({ where: { ficheCacheId: { in: toDeleteIds } } });
      const convos = await tx.chatConversation.deleteMany({ where: { ficheId: { in: toDeleteFicheIds } } });
      const results = await tx.automationRunFicheResult.deleteMany({ where: { ficheId: { in: toDeleteFicheIds } } });
      const caches = await tx.ficheCache.deleteMany({ where: { id: { in: toDeleteIds } } });
      return { audits: audits.count, convos: convos.count, results: results.count, caches: caches.count };
    }, { timeout: 120_000 });

    console.log(`${label}   DELETED: ${result.caches} fiches, ${result.audits} audits, ${result.convos} convos, ${result.results} run-results`);

    return {
      week: weekLabel, cached: cachedFiches.length, gatewaySales: gatewayIds.size,
      toDelete: toDeleteIds.length, deleted: result.caches,
      auditsDeleted: result.audits, conversationsDeleted: result.convos, ficheResultsDeleted: result.results,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${label}   DELETE ERROR: ${msg}`);
    return {
      week: weekLabel, cached: cachedFiches.length, gatewaySales: gatewayIds.size,
      toDelete: toDeleteIds.length, deleted: 0, auditsDeleted: 0, conversationsDeleted: 0, ficheResultsDeleted: 0, error: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Concurrent worker pool
// ---------------------------------------------------------------------------

async function processWeeksWithConcurrency(
  weeks: Array<{ start: string; end: string }>,
  concurrency: number,
  execute: boolean
): Promise<WeekResult[]> {
  const results: WeekResult[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= weeks.length) {break;}
      const w = weeks[i];
      const label = `[${i + 1}/${weeks.length}]`;
      const result = await processWeek(w.start, w.end, execute, label);
      results.push(result);
      // Tiny delay to avoid gateway hammering
      await sleep(200);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, weeks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const dryRun = !execute;
  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg
    ? Math.max(1, Math.min(10, Number(concurrencyArg.split("=")[1])))
    : DEFAULT_CONCURRENCY;

  console.log("=".repeat(70));
  console.log("  CLEAN NON-SALES FICHES FROM DATABASE");
  console.log(`  Mode: ${dryRun ? "DRY RUN (no changes)" : "EXECUTE (will delete!)"}`);
  console.log(`  Concurrency: ${concurrency} workers`);
  console.log("=".repeat(70));
  console.log();

  // 1. Get all distinct cached dates
  const rawDates = await prisma.ficheCache.findMany({
    select: { salesDate: true },
    distinct: ["salesDate"],
    where: { salesDate: { not: null } },
    orderBy: { salesDate: "desc" },
  });

  const dates = rawDates
    .map((r) => r.salesDate)
    .filter((d): d is string => typeof d === "string" && d.length > 0);

  const nullDateCount = await prisma.ficheCache.count({ where: { salesDate: null } });

  // 2. Group into weeks
  const weeks = groupIntoWeeks(dates);

  console.log(`Found ${dates.length} distinct cached dates → ${weeks.length} week ranges`);
  if (nullDateCount > 0) {
    console.log(`  (${nullDateCount} fiches with NULL salesDate — skipped)`);
  }
  console.log();

  // 3. Process all weeks concurrently, deleting as we go
  const startTime = Date.now();
  const results = await processWeeksWithConcurrency(weeks, concurrency, execute);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // 4. Summary
  const totalCached = results.reduce((s, r) => s + r.cached, 0);
  const totalGateway = results.reduce((s, r) => s + r.gatewaySales, 0);
  const totalToDelete = results.reduce((s, r) => s + r.toDelete, 0);
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  const totalAudits = results.reduce((s, r) => s + r.auditsDeleted, 0);
  const totalConvos = results.reduce((s, r) => s + r.conversationsDeleted, 0);
  const totalFicheResults = results.reduce((s, r) => s + r.ficheResultsDeleted, 0);
  const totalErrors = results.filter((r) => r.error).length;

  console.log();
  console.log("=".repeat(70));
  console.log("  SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Weeks processed:      ${weeks.length} (from ${dates.length} dates)`);
  console.log(`  Total cached fiches:  ${totalCached}`);
  console.log(`  Total gateway sales:  ${totalGateway}`);
  console.log(`  Non-sales found:      ${totalToDelete}`);
  if (dryRun) {
    console.log(`  Mode:                 DRY RUN — nothing was deleted`);
    console.log();
    console.log("  To actually delete, run with --execute:");
    console.log("    npx tsx src/scripts/clean-nonsales-fiches.ts --execute");
  } else {
    console.log(`  Fiches deleted:       ${totalDeleted}`);
    console.log(`  Audits deleted:       ${totalAudits}`);
    console.log(`  Conversations deleted: ${totalConvos}`);
    console.log(`  Run-results deleted:  ${totalFicheResults}`);
  }
  if (totalErrors > 0) {
    console.log(`  Errors:               ${totalErrors}`);
  }
  console.log(`  Elapsed:              ${elapsed}s`);
  console.log("=".repeat(70));
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
