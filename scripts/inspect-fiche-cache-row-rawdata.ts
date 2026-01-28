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

function describe(value: unknown) {
  if (value === null) {
    return { type: "null" as const };
  }
  if (Array.isArray(value)) {
    const first = value[0];
    const firstPreview =
      isRecord(first) ? Object.fromEntries(Object.entries(first).slice(0, 12)) : first;
    return {
      type: "array" as const,
      length: value.length,
      firstType:
        first === null ? "null" : Array.isArray(first) ? "array" : typeof first,
      firstKeys: objKeys(first),
      firstPreview,
    };
  }
  if (isRecord(value)) {
    return { type: "object" as const, keys: Object.keys(value) };
  }
  return { type: typeof value };
}

async function main() {
  const idRaw = process.env.FICHE_CACHE_ID;
  const ficheIdRaw = process.env.FICHE_ID;

  const row =
    typeof idRaw === "string" && idRaw.trim()
      ? await prisma.ficheCache.findUnique({
          where: { id: BigInt(idRaw) },
          select: {
            id: true,
            ficheId: true,
            rawData: true,
            cle: true,
            detailsSuccess: true,
            detailsMessage: true,
            information: { select: { id: true } },
            prospectDetails: { select: { id: true } },
          },
        })
      : typeof ficheIdRaw === "string" && ficheIdRaw.trim()
        ? await prisma.ficheCache.findUnique({
            where: { ficheId: ficheIdRaw.trim() },
            select: {
              id: true,
              ficheId: true,
              rawData: true,
              cle: true,
              detailsSuccess: true,
              detailsMessage: true,
              information: { select: { id: true } },
              prospectDetails: { select: { id: true } },
            },
          })
        : null;

  if (!row) {
    throw new Error("Provide FICHE_CACHE_ID or FICHE_ID env var");
  }

  const raw = row.rawData as unknown;
  const rec = isRecord(raw) ? raw : null;

  const pick = (k: string): unknown =>
    rec && Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;

  console.log(
    JSON.stringify(
      {
        id: row.id.toString(),
        ficheId: row.ficheId,
        hasNormalized: {
          information: Boolean(row.information),
          prospect: Boolean(row.prospectDetails),
        },
        envelopeColumns: {
          cle: row.cle,
          detailsSuccess: row.detailsSuccess,
          detailsMessage: row.detailsMessage,
        },
        rawData: {
          keys: objKeys(raw),
          bytes: jsonBytes(raw),
          success: describe(pick("success")),
          message: describe(pick("message")),
          cle: describe(pick("cle")),
          documents: describe(pick("documents")),
          mails: describe(pick("mails")),
          rendez_vous: describe(pick("rendez_vous")),
          alertes: describe(pick("alertes")),
          enfants: describe(pick("enfants")),
          reclamations: describe(pick("reclamations")),
          autres_contrats: describe(pick("autres_contrats")),
          raw_sections: describe(pick("raw_sections")),
          elements_souscription: describe(pick("elements_souscription")),
          tarification: describe(pick("tarification")),
          mail_devis: describe(pick("mail_devis")),
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

