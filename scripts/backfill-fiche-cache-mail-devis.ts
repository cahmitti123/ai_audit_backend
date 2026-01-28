import "dotenv/config";

import type { Prisma } from "@prisma/client";

import { mailDevisSchema } from "../src/modules/fiches/fiches.schemas.js";
import { prisma } from "../src/shared/prisma.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

type CandidateRow = { id: bigint; raw_data: unknown };

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT fc.id, fc.raw_data
    FROM fiche_cache fc
    LEFT JOIN fiche_cache_mail_devis md ON md.fiche_cache_id = fc.id
    WHERE fc.id > ${params.afterId}
      AND md.id IS NULL
      AND fc.raw_data IS NOT NULL
      AND COALESCE((fc.raw_data::jsonb->>'_salesListOnly')::boolean, false) = false
      AND (fc.raw_data::jsonb ? 'mail_devis')
      AND jsonb_typeof(fc.raw_data::jsonb->'mail_devis') = 'object'
    ORDER BY fc.id ASC
    LIMIT ${params.take}
  `;

  if (rows.length === 0) {
    return { processed: 0, backfilled: 0, trimmed: 0, skipped: 0, nextAfterId: params.afterId };
  }

  const nextAfterId = rows[rows.length - 1].id;

  let processed = 0;
  let backfilled = 0;
  let trimmed = 0;
  let skipped = 0;

  for (const row of rows) {
    processed += 1;

    const raw = row.raw_data as unknown;
    if (!isRecord(raw)) {
      skipped += 1;
      continue;
    }

    const mdRaw = (raw as { mail_devis?: unknown }).mail_devis;
    const parsed = mailDevisSchema.safeParse(mdRaw);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }

    const mailDevis = parsed.data;
    const nextRaw: Record<string, unknown> = { ...raw };
    delete nextRaw.mail_devis;

    const notesCreate = mailDevis.garanties_details.notes.map((n, idx) => ({
      rowIndex: idx + 1,
      number: n.number,
      text: n.text,
    }));

    const categoriesCreate = Object.entries(mailDevis.garanties_details.garanties).map(
      ([categoryKey, cat]) => {
        const subEntries = Object.entries(cat.subcategories);
        const subcategoriesFormat =
          subEntries.length > 0 && subEntries.every(([, v]) => Array.isArray(v))
            ? "array"
            : "named";

        const subcategoriesCreate = subEntries.map(([subKey, subValue]) => {
          const asArray = subcategoriesFormat === "array";
          const name =
            !asArray &&
            subValue &&
            typeof subValue === "object" &&
            !Array.isArray(subValue) &&
            typeof (subValue as { name?: unknown }).name === "string"
              ? ((subValue as { name: string }).name as string)
              : null;

          const subItems = asArray
            ? (Array.isArray(subValue) ? subValue : [])
            : subValue && typeof subValue === "object" && !Array.isArray(subValue)
              ? Array.isArray((subValue as { items?: unknown }).items)
                ? ((subValue as { items: unknown[] }).items as unknown[])
                : []
              : [];

          const itemsCreate = subItems.map((i, idx) => {
            const item = i as { name: string; value: string; note_ref?: string | null };
            return {
              rowIndex: idx + 1,
              name: item.name,
              value: item.value,
              noteRef: item.note_ref ?? null,
            };
          });

          return {
            subKey,
            name,
            ...(itemsCreate.length > 0 ? { items: { create: itemsCreate } } : {}),
          };
        });

        return {
          categoryKey,
          categoryName: cat.category_name,
          subcategoriesFormat,
          ...(cat.note_references.length > 0
            ? {
                noteReferences: {
                  create: cat.note_references.map((r, idx) => ({
                    rowIndex: idx + 1,
                    noteReference: r,
                  })),
                },
              }
            : {}),
          ...(cat.items.length > 0
            ? {
                items: {
                  create: cat.items.map((i, idx) => ({
                    rowIndex: idx + 1,
                    name: i.name,
                    value: i.value,
                    noteRef: i.note_ref ?? null,
                  })),
                },
              }
            : {}),
          ...(subcategoriesCreate.length > 0 ? { subcategories: { create: subcategoriesCreate } } : {}),
        };
      }
    );

    // Avoid interactive transactions (pgbouncer/Supabase pooler can trigger P2028).
    await prisma.$transaction([
      // Idempotency: clear any existing rows (should be none due to query filter)
      prisma.ficheCacheMailDevis.deleteMany({ where: { ficheCacheId: row.id } }),
      prisma.ficheCacheMailDevis.create({
        data: {
          ficheCacheId: row.id,

          dateEnvoi: mailDevis.mail_devis.date_envoi,
          typeMail: mailDevis.mail_devis.type_mail,
          utilisateur: mailDevis.mail_devis.utilisateur,
          visualisationUrl: mailDevis.mail_devis.visualisation_url,

          customerEmail: mailDevis.customer_info.email ?? null,
          customerPhone: mailDevis.customer_info.phone ?? null,
          customerName: mailDevis.customer_info.name ?? null,

          garantiesLinkUrl: mailDevis.garanties_link.url,
          garantiesLinkText: mailDevis.garanties_link.text ?? null,

          detailsGamme: mailDevis.garanties_details.gamme,
          detailsProductName: mailDevis.garanties_details.product_name,
          detailsFormule: mailDevis.garanties_details.formule,
          detailsPrice: mailDevis.garanties_details.price ?? null,
          detailsAgeRange: mailDevis.garanties_details.age_range ?? null,
          detailsSubscriptionLink: mailDevis.garanties_details.subscription_link ?? null,

          agenceNom: mailDevis.garanties_details.agence_info.nom ?? null,
          agenceAdresse: mailDevis.garanties_details.agence_info.adresse ?? null,
          agenceTelephone: mailDevis.garanties_details.agence_info.telephone ?? null,
          agenceEmail: mailDevis.garanties_details.agence_info.email ?? null,
          agenceLogoUrl: mailDevis.garanties_details.agence_info.logo_url ?? null,

          ficheInfoFicheId: mailDevis.garanties_details.fiche_info.fiche_id,
          ficheInfoCle: mailDevis.garanties_details.fiche_info.cle ?? null,
          ficheInfoConseiller: mailDevis.garanties_details.fiche_info.conseiller ?? null,

          subscriberCivilite: mailDevis.garanties_details.subscriber_info.civilite ?? null,
          subscriberNom: mailDevis.garanties_details.subscriber_info.nom ?? null,
          subscriberPrenom: mailDevis.garanties_details.subscriber_info.prenom ?? null,

          docConditionsGenerales:
            mailDevis.garanties_details.documents.conditions_generales ?? null,
          docTableauGaranties: mailDevis.garanties_details.documents.tableau_garanties ?? null,
          docDocumentInformation:
            mailDevis.garanties_details.documents.document_information ?? null,
          docExemplesRemboursements:
            mailDevis.garanties_details.documents.exemples_remboursements ?? null,

          menuHome: mailDevis.garanties_details.menu_links.home ?? null,
          menuGaranties: mailDevis.garanties_details.menu_links.garanties ?? null,
          menuDocuments: mailDevis.garanties_details.menu_links.documents ?? null,
          menuSubscription: mailDevis.garanties_details.menu_links.subscription ?? null,

          ...(notesCreate.length > 0 ? { notes: { create: notesCreate } } : {}),
          ...(categoriesCreate.length > 0 ? { categories: { create: categoriesCreate } } : {}),
        },
      }),
      prisma.ficheCache.update({
        where: { id: row.id },
        data: { rawData: toPrismaJsonValue(nextRaw) },
      }),
    ]);

    backfilled += 1;
    trimmed += 1;
  }

  return { processed, backfilled, trimmed, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_MAIL_DEVIS_BATCH_SIZE || "10", 10) || 10
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_MAIL_DEVIS_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalBackfilled = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;
  let afterId = 0n;

  for (let i = 0; i < maxBatches; i++) {
    const r = await backfillOnce({ take: batchSize, afterId });
    if (r.processed === 0) {break;}
    afterId = r.nextAfterId;

    totalProcessed += r.processed;
    totalBackfilled += r.backfilled;
    totalTrimmed += r.trimmed;
    totalSkipped += r.skipped;

    console.log(
      JSON.stringify(
        {
          batch: i + 1,
          batchSize,
          processed: r.processed,
          backfilled: r.backfilled,
          trimmed: r.trimmed,
          skipped: r.skipped,
          totals: {
            processed: totalProcessed,
            backfilled: totalBackfilled,
            trimmed: totalTrimmed,
            skipped: totalSkipped,
          },
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        totals: {
          processed: totalProcessed,
          backfilled: totalBackfilled,
          trimmed: totalTrimmed,
          skipped: totalSkipped,
        },
      },
      null,
      2
    )
  );
}

await main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

