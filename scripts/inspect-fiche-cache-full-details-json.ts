import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function jsonBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const row = await prisma.ficheCache.findFirst({
    where: {
      // Prefer a row that has normalized "full details"
      information: { isNot: null },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      information: true,
      prospectDetails: true,
      _count: {
        select: {
          documents: true,
          commentaires: true,
          mails: true,
          rendezVous: true,
          alertes: true,
          enfants: true,
          etiquettes: true,
          recordings: true,
        },
      },
    },
  });

  if (!row) {
    console.log(
      JSON.stringify(
        { ok: false, message: "No ficheCache row found with normalized information" },
        null,
        2
      )
    );
    return;
  }

  const raw = row.rawData as unknown;

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: row.id.toString(),
        ficheId: row.ficheId,
        rawDataKeys: objKeys(raw),
        rawDataJsonBytes: jsonBytes(raw),
        counts: {
          recordings: row._count.recordings,
          etiquettes: row._count.etiquettes,
          documents: row._count.documents,
          commentaires: row._count.commentaires,
          mails: row._count.mails,
          rendezVous: row._count.rendezVous,
          alertes: row._count.alertes,
          enfants: row._count.enfants,
        },
        hasNormalized: {
          information: Boolean(row.information),
          prospect: Boolean(row.prospectDetails),
        },
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

