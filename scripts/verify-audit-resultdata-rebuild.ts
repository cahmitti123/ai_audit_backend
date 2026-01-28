import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { getAuditById } from "../src/modules/audits/audits.service.js";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const auditId = BigInt(process.env.AUDIT_ID || "1762");

  const db = await prisma.audit.findUnique({
    where: { id: auditId },
    select: { id: true, resultData: true },
  });
  if (!db) {
    throw new Error(`Audit ${auditId.toString()} not found`);
  }

  const stored = db.resultData as unknown;
  const storedSteps =
    isRecord(stored) &&
    isRecord(stored.audit) &&
    isRecord(stored.audit.results) &&
    Array.isArray(stored.audit.results.steps)
      ? stored.audit.results.steps
      : null;

  const api = await getAuditById(auditId);
  if (!api) {
    throw new Error(`Audit ${auditId.toString()} not found (service)`);
  }

  const apiResult = api.resultData as unknown;
  const apiSteps =
    isRecord(apiResult) &&
    isRecord(apiResult.audit) &&
    isRecord(apiResult.audit.results) &&
    Array.isArray(apiResult.audit.results.steps)
      ? apiResult.audit.results.steps
      : null;

  console.log(
    JSON.stringify(
      {
        auditId: auditId.toString(),
        storedStepsCount: storedSteps ? storedSteps.length : 0,
        apiStepsCount: apiSteps ? apiSteps.length : 0,
      },
      null,
      2
    )
  );
}

await main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

