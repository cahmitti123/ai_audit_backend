import type { Prisma } from "@prisma/client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {return value;}
  return value === undefined || value === null ? [] : [value];
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toNullableBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {return null;}
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {return null;}
  return new Date(ms);
}

export function extractLegacyHumanReviewEntries(rawResult: unknown): unknown[] {
  if (!isRecord(rawResult)) {return [];}
  return toArray(rawResult.human_review);
}

export function extractLegacyRerunHistoryEntries(rawResult: unknown): unknown[] {
  if (!isRecord(rawResult)) {return [];}
  return toArray(rawResult.rerun_history);
}

export function stripAuditTrailsFromRawResult(rawResult: unknown): unknown {
  if (!isRecord(rawResult)) {return rawResult;}
  const next: Record<string, unknown> = { ...rawResult };
  delete next.human_review;
  delete next.rerun_history;
  return next;
}

export function legacyHumanReviewsToRows(params: {
  auditId: bigint;
  stepPosition: number;
  entries: unknown[];
  fallbackDate: Date;
}): Prisma.AuditStepResultHumanReviewCreateManyInput[] {
  const { auditId, stepPosition, entries, fallbackDate } = params;
  const rows: Prisma.AuditStepResultHumanReviewCreateManyInput[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {continue;}
    const reviewedAt = parseIsoDate(entry.at) ?? fallbackDate;
    const reviewer = toNullableString(entry.by);
    const reason = toNullableString(entry.reason);

    const kind =
      typeof entry.kind === "string" && entry.kind === "control_point"
        ? "control_point"
        : "step";

    const prev = isRecord(entry.previous) ? entry.previous : null;
    const ov = isRecord(entry.override) ? entry.override : null;

    rows.push({
      auditId,
      stepPosition,
      reviewedAt,
      reviewer,
      reason,
      kind,
      controlPointIndex: toNullableInt(entry.control_point_index),
      point: toNullableString(entry.point),

      previousTraite: prev ? toNullableBool(prev.traite) : null,
      previousConforme: prev ? toNullableString(prev.conforme) : null,
      previousScore: prev ? toNullableInt(prev.score) : null,
      previousNiveauConformite: prev ? toNullableString(prev.niveau_conformite) : null,

      overrideTraite: ov ? toNullableBool(ov.traite) : null,
      overrideConforme: ov ? toNullableString(ov.conforme) : null,
      overrideScore: ov ? toNullableInt(ov.score) : null,
      overrideNiveauConformite: ov ? toNullableString(ov.niveau_conformite) : null,

      previousStatut: prev ? toNullableString(prev.statut) : null,
      previousCommentaire: prev ? toNullableString(prev.commentaire) : null,
      overrideStatut: ov ? toNullableString(ov.statut) : null,
      overrideCommentaire: ov ? toNullableString(ov.commentaire) : null,
    });
  }

  return rows;
}

export function legacyRerunHistoryToRows(params: {
  auditId: bigint;
  stepPosition: number;
  entries: unknown[];
  fallbackDate: Date;
}): Prisma.AuditStepResultRerunEventCreateManyInput[] {
  const { auditId, stepPosition, entries, fallbackDate } = params;
  const rows: Prisma.AuditStepResultRerunEventCreateManyInput[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {continue;}
    const occurredAt = parseIsoDate(entry.at) ?? fallbackDate;
    const kind = typeof entry.kind === "string" ? entry.kind : "unknown";
    const prev = isRecord(entry.previous) ? entry.previous : null;
    const next = isRecord(entry.next) ? entry.next : null;

    rows.push({
      auditId,
      stepPosition,
      occurredAt,
      kind,
      rerunId: toNullableString(entry.rerun_id),
      eventId: toNullableString(entry.event_id),
      customPrompt: toNullableString(entry.custom_prompt),
      controlPointIndex: toNullableInt(entry.control_point_index),
      point: toNullableString(entry.point),

      previousScore: prev ? toNullableInt(prev.score) : null,
      previousConforme: prev ? toNullableString(prev.conforme) : null,
      previousTotalCitations: prev ? toNullableInt(prev.total_citations) : null,
      nextScore: next ? toNullableInt(next.score) : null,
      nextConforme: next ? toNullableString(next.conforme) : null,
      nextTotalCitations: next ? toNullableInt(next.total_citations) : null,

      previousStatut: prev ? toNullableString(prev.statut) : null,
      previousCommentaire: prev ? toNullableString(prev.commentaire) : null,
      previousCitations: prev ? toNullableInt(prev.citations) : null,
      previousStepScore: prev ? toNullableInt(prev.step_score) : null,
      previousStepConforme: prev ? toNullableString(prev.step_conforme) : null,

      nextStatut: next ? toNullableString(next.statut) : null,
      nextCommentaire: next ? toNullableString(next.commentaire) : null,
      nextCitations: next ? toNullableInt(next.citations) : null,
      nextStepScore: next ? toNullableInt(next.step_score) : null,
      nextStepConforme: next ? toNullableString(next.step_conforme) : null,
    });
  }

  return rows;
}

