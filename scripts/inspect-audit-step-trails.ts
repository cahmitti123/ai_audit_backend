import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {return value;}
  return value === undefined || value === null ? [] : [value];
}

function safeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {return Math.trunc(value);}
  if (typeof value === "bigint") {return Number(value);}
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

async function main() {
  const out: Record<string, unknown> = {};

  const counts = await prisma.$queryRaw<
    Array<{
      human_review_rows: unknown;
      rerun_history_rows: unknown;
      both_rows: unknown;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE raw_result IS NOT NULL AND (raw_result::jsonb ? 'human_review'))::bigint AS human_review_rows,
      COUNT(*) FILTER (WHERE raw_result IS NOT NULL AND (raw_result::jsonb ? 'rerun_history'))::bigint AS rerun_history_rows,
      COUNT(*) FILTER (WHERE raw_result IS NOT NULL AND (raw_result::jsonb ? 'human_review') AND (raw_result::jsonb ? 'rerun_history'))::bigint AS both_rows
    FROM audit_step_results
  `;

  out.counts = {
    rowsWithHumanReview: safeInt(counts[0]?.human_review_rows),
    rowsWithRerunHistory: safeInt(counts[0]?.rerun_history_rows),
    rowsWithBoth: safeInt(counts[0]?.both_rows),
  };

  const humanSample = await prisma.$queryRaw<
    Array<{ id: bigint; audit_id: bigint; step_position: number; raw_result: unknown }>
  >`
    SELECT id, audit_id, step_position, raw_result
    FROM audit_step_results
    WHERE raw_result IS NOT NULL AND (raw_result::jsonb ? 'human_review')
    ORDER BY id DESC
    LIMIT 1
  `;

  if (humanSample[0]) {
    const raw = humanSample[0].raw_result as unknown;
    const rr = isRecord(raw) ? raw : null;
    const reviews = rr ? asArray(rr.human_review) : [];
    const first = reviews[0];
    const prev = isRecord(first) ? first.previous : null;
    const ov = isRecord(first) ? first.override : null;

    out.sampleHumanReview = {
      id: humanSample[0].id.toString(),
      auditId: humanSample[0].audit_id.toString(),
      stepPosition: humanSample[0].step_position,
      reviewCount: reviews.length,
      firstEntryKeys: objKeys(first),
      previousKeys: objKeys(prev),
      overrideKeys: objKeys(ov),
    };
  }

  const rerunSample = await prisma.$queryRaw<
    Array<{ id: bigint; audit_id: bigint; step_position: number; raw_result: unknown }>
  >`
    SELECT id, audit_id, step_position, raw_result
    FROM audit_step_results
    WHERE raw_result IS NOT NULL AND (raw_result::jsonb ? 'rerun_history')
    ORDER BY id DESC
    LIMIT 1
  `;

  if (rerunSample[0]) {
    const raw = rerunSample[0].raw_result as unknown;
    const rr = isRecord(raw) ? raw : null;
    const hist = rr ? asArray(rr.rerun_history) : [];
    const first = hist[0];
    const prev = isRecord(first) ? first.previous : null;
    const next = isRecord(first) ? first.next : null;

    out.sampleRerunHistory = {
      id: rerunSample[0].id.toString(),
      auditId: rerunSample[0].audit_id.toString(),
      stepPosition: rerunSample[0].step_position,
      entryCount: hist.length,
      firstEntryKeys: objKeys(first),
      previousKeys: objKeys(prev),
      nextKeys: objKeys(next),
    };
  }

  // NOTE: Intentionally prints only keys/counts (no sensitive values).
  console.log(JSON.stringify(out, null, 2));
}

await main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

