/**
 * Workflow Logs Repository
 * ========================
 * RESPONSIBILITY: Database operations only
 * - Direct Prisma calls
 * - Create/query workflow logs (cross-workflow observability)
 * - Returns raw Prisma types (BigInt)
 *
 * LAYER: Data (Database operations)
 */

import type { Prisma } from "@prisma/client";

import { serializeBigInt } from "./bigint-serializer.js";
import { prisma } from "./prisma.js";

export type WorkflowLogWorkflow =
  | "audit"
  | "transcription"
  | "automation"
  | "fiche"
  // Allow forward-compatible custom workflows
  | (string & {});

export type WorkflowLogLevel =
  | "debug"
  | "info"
  | "warning"
  | "error"
  // Allow forward-compatible custom levels
  | (string & {});

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const sanitized = serializeBigInt(value);
  // JSON.parse returns `any` in lib types; narrow to `unknown` then assert Prisma JSON type.
  const json: unknown = JSON.parse(JSON.stringify(sanitized));
  return json as Prisma.InputJsonValue;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {return undefined;}
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type CreateWorkflowLogInput = {
  workflow: WorkflowLogWorkflow;
  level: WorkflowLogLevel;
  message: string;
  data?: unknown;

  entityType?: string | null;
  entityId?: string | null;
  traceId?: string | null;
  inngestEventId?: string | null;
  functionId?: string | null;
  stepName?: string | null;

  // Optional override for testing/backfill
  createdAt?: Date;
};

/**
 * Write a single workflow log row.
 */
export async function addWorkflowLog(input: CreateWorkflowLogInput) {
  const workflow = normalizeOptionalString(input.workflow) ?? "";
  const level = normalizeOptionalString(input.level) ?? "";
  const message = normalizeOptionalString(input.message) ?? "";

  if (!workflow) {
    throw new Error("WorkflowLog.workflow is required");
  }
  if (!level) {
    throw new Error("WorkflowLog.level is required");
  }
  if (!message) {
    throw new Error("WorkflowLog.message is required");
  }

  const entityType = normalizeOptionalString(input.entityType);
  const entityId = normalizeOptionalString(input.entityId);
  const traceId = normalizeOptionalString(input.traceId);
  const inngestEventId = normalizeOptionalString(input.inngestEventId);
  const functionId = normalizeOptionalString(input.functionId);
  const stepName = normalizeOptionalString(input.stepName);

  return await prisma.workflowLog.create({
    data: {
      workflow,
      level,
      message,
      data: toPrismaJsonValue(input.data ?? {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(inngestEventId ? { inngestEventId } : {}),
      ...(functionId ? { functionId } : {}),
      ...(stepName ? { stepName } : {}),
      ...(input.createdAt instanceof Date ? { createdAt: input.createdAt } : {}),
    },
  });
}

export type GetWorkflowLogsFilters = {
  workflow?: string;
  workflows?: string[];

  level?: string;
  levels?: string[];

  entityType?: string;
  entityId?: string;
  traceId?: string;
  inngestEventId?: string;
  functionId?: string;
  stepName?: string;

  createdAfter?: Date;
  createdBefore?: Date;
};

export type GetWorkflowLogsPagination = {
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
};

export async function getWorkflowLogs(
  filters: GetWorkflowLogsFilters,
  pagination: GetWorkflowLogsPagination = {}
) {
  const limitRaw = typeof pagination.limit === "number" ? pagination.limit : 200;
  const offsetRaw = typeof pagination.offset === "number" ? pagination.offset : 0;

  const limit = Math.max(1, Math.min(1000, Math.trunc(limitRaw)));
  const offset = Math.max(0, Math.trunc(offsetRaw));
  const order: Prisma.SortOrder = pagination.order === "asc" ? "asc" : "desc";

  const workflow = normalizeOptionalString(filters.workflow);
  const workflows = Array.isArray(filters.workflows)
    ? filters.workflows
        .map((w) => normalizeOptionalString(w))
        .filter((w): w is string => typeof w === "string")
    : [];

  const level = normalizeOptionalString(filters.level);
  const levels = Array.isArray(filters.levels)
    ? filters.levels
        .map((l) => normalizeOptionalString(l))
        .filter((l): l is string => typeof l === "string")
    : [];

  const entityType = normalizeOptionalString(filters.entityType);
  const entityId = normalizeOptionalString(filters.entityId);
  const traceId = normalizeOptionalString(filters.traceId);
  const inngestEventId = normalizeOptionalString(filters.inngestEventId);
  const functionId = normalizeOptionalString(filters.functionId);
  const stepName = normalizeOptionalString(filters.stepName);

  const createdAfter =
    filters.createdAfter instanceof Date ? filters.createdAfter : undefined;
  const createdBefore =
    filters.createdBefore instanceof Date ? filters.createdBefore : undefined;

  const where: Prisma.WorkflowLogWhereInput = {
    ...(workflow ? { workflow } : {}),
    ...(workflows.length > 0 ? { workflow: { in: workflows } } : {}),
    ...(level ? { level } : {}),
    ...(levels.length > 0 ? { level: { in: levels } } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(inngestEventId ? { inngestEventId } : {}),
    ...(functionId ? { functionId } : {}),
    ...(stepName ? { stepName } : {}),
    ...(createdAfter || createdBefore
      ? {
          createdAt: {
            ...(createdAfter ? { gte: createdAfter } : {}),
            ...(createdBefore ? { lte: createdBefore } : {}),
          },
        }
      : {}),
  };

  return await prisma.workflowLog.findMany({
    where,
    orderBy: [{ createdAt: order }, { id: order }],
    take: limit,
    skip: offset,
  });
}

