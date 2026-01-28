import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const totalStepResults = await prisma.auditStepResult.count();
  const stepResultsWithRawResult = await prisma.auditStepResult.count({
    where: { rawResult: { not: Prisma.DbNull } },
  });
  const withControlPoints = await prisma.auditStepResult.count({
    where: { controlPoints: { some: {} } },
  });
  const withoutControlPoints = await prisma.auditStepResult.count({
    where: { controlPoints: { none: {} } },
  });

  console.log(
    JSON.stringify(
      {
        totalStepResults,
        stepResultsWithRawResult,
        withControlPoints,
        withoutControlPoints,
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

