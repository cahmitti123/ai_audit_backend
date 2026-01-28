import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const totalTranscribed = await prisma.recording.count({
    where: { hasTranscription: true },
  });

  const withChunks = await prisma.recording.count({
    where: { hasTranscription: true, transcriptionChunks: { some: {} } },
  });

  const pendingChunks = await prisma.recording.count({
    where: { hasTranscription: true, transcriptionChunks: { none: {} } },
  });

  const withLegacyTranscriptionData = await prisma.recording.count({
    where: { hasTranscription: true, transcriptionData: { not: Prisma.DbNull } },
  });

  const legacyDataPendingChunks = await prisma.recording.count({
    where: {
      hasTranscription: true,
      transcriptionChunks: { none: {} },
      transcriptionData: { not: Prisma.DbNull },
    },
  });

  console.log(
    JSON.stringify(
      {
        totalTranscribed,
        withChunks,
        pendingChunks,
        withLegacyTranscriptionData,
        legacyDataPendingChunks,
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

