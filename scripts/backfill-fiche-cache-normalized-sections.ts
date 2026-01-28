import "dotenv/config";

import type { Prisma } from "@prisma/client";

import { prisma } from "../src/shared/prisma.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  const json: unknown = JSON.parse(JSON.stringify(value));
  return json as Prisma.InputJsonValue;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type CandidateRow = { id: bigint; raw_data: unknown; info_exists: boolean };

async function backfillOnce(params: { take: number; afterId: bigint }) {
  const rows = await prisma.$queryRaw<Array<CandidateRow>>`
    SELECT
      fc.id,
      fc.raw_data,
      (info.id IS NOT NULL) AS info_exists
    FROM fiche_cache fc
    LEFT JOIN fiche_cache_information info ON info.fiche_cache_id = fc.id
    WHERE fc.id > ${params.afterId}
      AND fc.raw_data IS NOT NULL
      AND COALESCE((fc.raw_data::jsonb->>'_salesListOnly')::boolean, false) = false
      -- We only touch rows that either still contain legacy 'information' JSON,
      -- or already have a normalized 'fiche_cache_information' row.
      AND ((fc.raw_data::jsonb ? 'information') OR info.id IS NOT NULL)
      -- Only process rows that still contain one of the normalized sections in raw_data.
      AND (
        (fc.raw_data::jsonb ? 'information')
        OR (fc.raw_data::jsonb ? 'prospect')
        OR (fc.raw_data::jsonb ? 'documents')
        OR (fc.raw_data::jsonb ? 'commentaires')
        OR (fc.raw_data::jsonb ? 'mails')
        OR (fc.raw_data::jsonb ? 'rendez_vous')
        OR (fc.raw_data::jsonb ? 'alertes')
        OR (fc.raw_data::jsonb ? 'enfants')
        OR (fc.raw_data::jsonb ? 'conjoint')
        OR (fc.raw_data::jsonb ? 'reclamations')
        OR (fc.raw_data::jsonb ? 'autres_contrats')
        OR (fc.raw_data::jsonb ? 'raw_sections')
        OR (fc.raw_data::jsonb ? 'elements_souscription')
        OR (fc.raw_data::jsonb ? 'tarification')
      )
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

    const infoFromTable = row.info_exists === true;
    const info = isRecord(raw.information) ? (raw.information as Record<string, unknown>) : null;
    if (!info && !infoFromTable) {
      skipped += 1;
      continue;
    }

    // Extract normalized objects/arrays (best-effort)
    const prospect = isRecord(raw.prospect) ? (raw.prospect as Record<string, unknown>) : null;
    const conjoint = isRecord(raw.conjoint) ? (raw.conjoint as Record<string, unknown>) : null;

    const etiquettes = info && Array.isArray(info.etiquettes) ? info.etiquettes : [];

    // For arrays: distinguish "missing key" from "present empty array" to avoid wiping
    // already-normalized tables when raw_data is already trimmed.
    const documents = Object.prototype.hasOwnProperty.call(raw, "documents")
      ? Array.isArray(raw.documents)
        ? raw.documents
        : null
      : null;
    const commentaires = Object.prototype.hasOwnProperty.call(raw, "commentaires")
      ? Array.isArray(raw.commentaires)
        ? raw.commentaires
        : null
      : null;
    const mails = Object.prototype.hasOwnProperty.call(raw, "mails")
      ? Array.isArray(raw.mails)
        ? raw.mails
        : null
      : null;
    const rendezVous = Object.prototype.hasOwnProperty.call(raw, "rendez_vous")
      ? Array.isArray(raw.rendez_vous)
        ? raw.rendez_vous
        : null
      : null;
    const alertes = Object.prototype.hasOwnProperty.call(raw, "alertes")
      ? Array.isArray(raw.alertes)
        ? raw.alertes
        : null
      : null;
    const enfants = Object.prototype.hasOwnProperty.call(raw, "enfants")
      ? Array.isArray(raw.enfants)
        ? raw.enfants
        : null
      : null;
    const reclamations = Object.prototype.hasOwnProperty.call(raw, "reclamations")
      ? Array.isArray(raw.reclamations)
        ? raw.reclamations
        : null
      : null;
    const autresContrats = Object.prototype.hasOwnProperty.call(raw, "autres_contrats")
      ? Array.isArray(raw.autres_contrats)
        ? raw.autres_contrats
        : null
      : null;
    const rawSections =
      Object.prototype.hasOwnProperty.call(raw, "raw_sections") && isRecord(raw.raw_sections)
        ? (raw.raw_sections as Record<string, unknown>)
        : null;
    const tarification = Object.prototype.hasOwnProperty.call(raw, "tarification")
      ? Array.isArray(raw.tarification)
        ? raw.tarification
        : null
      : null;
    const elementsSouscriptionRaw =
      raw.elements_souscription === null || isRecord(raw.elements_souscription)
        ? (raw.elements_souscription as Record<string, unknown> | null)
        : null;

    // Prepare table writes
    const infoCle = info ? toStringOrNull(info.cle) : null;
    const infoDateInsertion = info ? toStringOrNull(info.date_insertion) : null;
    const infoDernierAcces = info ? toStringOrNull(info.dernier_acces) : null;
    const infoGroupe = info ? toStringOrNull(info.groupe) : null;
    const infoAgenceId = info ? toStringOrNull(info.agence_id) : null;
    const infoAgenceNom = info ? toStringOrNull(info.agence_nom) : null;
    const infoAttributionUserId = info ? toStringOrNull(info.attribution_user_id) : null;
    const infoAttributionUserNom = info ? toStringOrNull(info.attribution_user_nom) : null;
    const infoProvenanceId = info ? toStringOrNull(info.provenance_id) : null;
    const infoProvenanceNom = info ? toStringOrNull(info.provenance_nom) : null;
    const infoNombreAcces = info ? toIntOrNull(info.nombre_acces) : null;
    const infoNombreOuvertureMails = info ? toIntOrNull(info.nombre_ouverture_mails) : null;
    const infoNombreVisualisationPages = info ? toIntOrNull(info.nombre_visualisation_pages) : null;
    const infoRefusDemarchage = info ? toBoolOrNull(info.refus_demarchage) : null;
    const infoExceptionDemarchage = info ? toBoolOrNull(info.exception_demarchage) : null;
    const infoFermeEspaceProspect = info ? toBoolOrNull(info.ferme_espace_prospect) : null;
    const infoDesinscriptionMail = info ? toBoolOrNull(info.desinscription_mail) : null;
    const infoCorbeille = info ? toBoolOrNull(info.corbeille) : null;
    const infoArchive = info ? toBoolOrNull(info.archive) : null;
    const infoModules = info ? toStringArray(info.modules) : [];

    const canWriteInfoFromRaw =
      info !== null &&
      typeof infoCle === "string" &&
      typeof infoDateInsertion === "string" &&
      typeof infoDernierAcces === "string" &&
      typeof infoGroupe === "string" &&
      typeof infoAgenceId === "string" &&
      typeof infoAgenceNom === "string" &&
      typeof infoAttributionUserId === "string" &&
      typeof infoAttributionUserNom === "string" &&
      typeof infoProvenanceId === "string" &&
      typeof infoProvenanceNom === "string" &&
      typeof infoNombreAcces === "number" &&
      typeof infoNombreOuvertureMails === "number" &&
      typeof infoNombreVisualisationPages === "number" &&
      typeof infoRefusDemarchage === "boolean" &&
      typeof infoExceptionDemarchage === "boolean" &&
      typeof infoFermeEspaceProspect === "boolean" &&
      typeof infoDesinscriptionMail === "boolean" &&
      typeof infoCorbeille === "boolean" &&
      typeof infoArchive === "boolean";

    // Without any reliable "information" source, we should not trim rawData, otherwise we'd lose data.
    if (!infoFromTable && !canWriteInfoFromRaw) {
      skipped += 1;
      continue;
    }

    const prospectData = (() => {
      if (!prospect) {return null;}
      const prospectId = toStringOrNull(prospect.prospect_id);
      const civilite = toIntOrNull(prospect.civilite);
      const civiliteText = toStringOrNull(prospect.civilite_text);
      const nom = toStringOrNull(prospect.nom);
      const prenom = toStringOrNull(prospect.prenom);
      const dateNaissance = toStringOrNull(prospect.date_naissance);
      const regime = toStringOrNull(prospect.regime);
      const regimeText = toStringOrNull(prospect.regime_text);
      const madelin = toBoolOrNull(prospect.madelin);
      if (
        prospectId === null ||
        civilite === null ||
        civiliteText === null ||
        nom === null ||
        prenom === null ||
        dateNaissance === null ||
        regime === null ||
        regimeText === null ||
        madelin === null
      ) {
        return null;
      }
      return {
        prospectId,
        civilite,
        civiliteText,
        nom,
        prenom,
        dateNaissance,
        regime,
        regimeText,
        telephone: toStringOrNull(prospect.telephone),
        mobile: toStringOrNull(prospect.mobile),
        telephone2: toStringOrNull(prospect.telephone_2),
        mail: toStringOrNull(prospect.mail),
        mail2: toStringOrNull(prospect.mail_2),
        adresse: toStringOrNull(prospect.adresse),
        codePostal: toStringOrNull(prospect.code_postal),
        ville: toStringOrNull(prospect.ville),
        numSecu: toStringOrNull(prospect.num_secu),
        numAffiliation: toStringOrNull(prospect.num_affiliation),
        situationFamiliale: toIntOrNull(prospect.situation_familiale),
        situationFamilialeText: toStringOrNull(prospect.situation_familiale_text),
        madelin,
        profession: toStringOrNull(prospect.profession),
        csp: toIntOrNull(prospect.csp),
        cspText: toStringOrNull(prospect.csp_text),
        fax: toStringOrNull(prospect.fax),
      };
    })();

    const conjointData = (() => {
      if (!conjoint) {return null;}
      const conjointId = toStringOrNull(conjoint.conjoint_id);
      const civilite = toIntOrNull(conjoint.civilite);
      const civiliteText = toStringOrNull(conjoint.civilite_text);
      const nom = toStringOrNull(conjoint.nom);
      const prenom = toStringOrNull(conjoint.prenom);
      const dateNaissance = toStringOrNull(conjoint.date_naissance);
      if (
        conjointId === null ||
        civilite === null ||
        civiliteText === null ||
        nom === null ||
        prenom === null ||
        dateNaissance === null
      ) {
        return null;
      }
      return {
        conjointId,
        civilite,
        civiliteText,
        nom,
        prenom,
        dateNaissance,
        regime: toStringOrNull(conjoint.regime),
        regimeText: toStringOrNull(conjoint.regime_text),
        telephone: toStringOrNull(conjoint.telephone),
        mobile: toStringOrNull(conjoint.mobile),
        mail: toStringOrNull(conjoint.mail),
        profession: toStringOrNull(conjoint.profession),
        csp: toIntOrNull(conjoint.csp),
        cspText: toStringOrNull(conjoint.csp_text),
      };
    })();

    const docsRows: Prisma.FicheCacheDocumentCreateManyInput[] = (documents ?? [])
      .map((d, idx) => {
        if (!isRecord(d)) {return null;}
        const documentId = toStringOrNull(d.document_id);
        const type = toStringOrNull(d.type);
        const nom = toStringOrNull(d.nom);
        const taille = toStringOrNull(d.taille);
        const dateCreation = toStringOrNull(d.date_creation);
        const selectionMail = toBoolOrNull(d.selection_mail);
        const partageProspect = toBoolOrNull(d.partage_prospect);
        const signer = toBoolOrNull(d.signer);
        if (
          documentId === null ||
          type === null ||
          nom === null ||
          taille === null ||
          dateCreation === null ||
          selectionMail === null ||
          partageProspect === null ||
          signer === null
        ) {
          return null;
        }
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          documentId,
          type,
          nom,
          taille,
          dateCreation,
          selectionMail,
          partageProspect,
          signer,
          downloadUrl: toStringOrNull(d.download_url),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteDocuments = documents !== null && docsRows.length === documents.length;

    const commentairesRows: Prisma.FicheCacheCommentaireCreateManyInput[] = (commentaires ?? [])
      .map((c, idx) => {
        if (!isRecord(c)) {return null;}
        const commentaireId = toStringOrNull(c.commentaire_id);
        const date = toStringOrNull(c.date);
        const utilisateur = toStringOrNull(c.utilisateur);
        const texte = toStringOrNull(c.texte);
        if (commentaireId === null || date === null || utilisateur === null || texte === null) {
          return null;
        }
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          commentaireId,
          date,
          utilisateur,
          texte,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteCommentaires =
      commentaires !== null && commentairesRows.length === commentaires.length;

    const mailsRows: Prisma.FicheCacheMailCreateManyInput[] = (mails ?? [])
      .map((m, idx) => {
        if (!isRecord(m)) {return null;}
        const dateEnvoi = toStringOrNull(m.date_envoi);
        const typeMail = toStringOrNull(m.type_mail);
        const utilisateur = toStringOrNull(m.utilisateur);
        if (dateEnvoi === null || typeMail === null || utilisateur === null) {return null;}
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          dateEnvoi,
          typeMail,
          utilisateur,
          visualisationUrl: toStringOrNull(m.visualisation_url),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteMails = mails !== null && mailsRows.length === mails.length;

    const rendezVousRows: Prisma.FicheCacheRendezVousCreateManyInput[] = (rendezVous ?? [])
      .map((r, idx) => {
        if (!isRecord(r)) {return null;}
        const rdvId = toStringOrNull(r.rdv_id);
        const utilisateur = toStringOrNull(r.utilisateur);
        const dateDebut = toStringOrNull(r.date_debut);
        if (rdvId === null || utilisateur === null || dateDebut === null) {return null;}
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          rdvId,
          etiquette: toStringOrNull(r.etiquette),
          etiquetteColor: toStringOrNull(r.etiquette_color),
          utilisateur,
          dateDebut,
          dateFin: toStringOrNull(r.date_fin),
          commentaire: toStringOrNull(r.commentaire),
          statut: toStringOrNull(r.statut),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteRendezVous =
      rendezVous !== null && rendezVousRows.length === rendezVous.length;

    const alertesRows: Prisma.FicheCacheAlerteCreateManyInput[] = (alertes ?? [])
      .map((a, idx) => {
        if (!isRecord(a)) {return null;}
        const alerteId = toStringOrNull(a.alerte_id);
        const etat = toStringOrNull(a.etat);
        const date = toStringOrNull(a.date);
        const libelle = toStringOrNull(a.libelle);
        const deposeeLe = toStringOrNull(a.deposee_le);
        const deposeePar = toStringOrNull(a.deposee_par);
        if (
          alerteId === null ||
          etat === null ||
          date === null ||
          libelle === null ||
          deposeeLe === null ||
          deposeePar === null
        ) {
          return null;
        }
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          alerteId,
          etat,
          date,
          etiquette: toStringOrNull(a.etiquette),
          libelle,
          deposeeLe,
          deposeePar,
          commentaire: toStringOrNull(a.commentaire),
          attribueeA: toStringOrNull(a.attribuee_a),
          traiteeLe: toStringOrNull(a.traitee_le),
          traiteePar: toStringOrNull(a.traitee_par),
          commentaireTraitement: toStringOrNull(a.commentaire_traitement),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteAlertes = alertes !== null && alertesRows.length === alertes.length;

    const enfantsRows: Prisma.FicheCacheEnfantCreateManyInput[] = (enfants ?? [])
      .map((e, idx) => {
        if (!isRecord(e)) {return null;}
        const enfantId = toStringOrNull(e.enfant_id);
        const civilite = toIntOrNull(e.civilite);
        const civiliteText = toStringOrNull(e.civilite_text);
        const nom = toStringOrNull(e.nom);
        const prenom = toStringOrNull(e.prenom);
        const dateNaissance = toStringOrNull(e.date_naissance);
        if (
          enfantId === null ||
          civilite === null ||
          civiliteText === null ||
          nom === null ||
          prenom === null ||
          dateNaissance === null
        ) {
          return null;
        }
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          enfantId,
          civilite,
          civiliteText,
          nom,
          prenom,
          dateNaissance,
          regime: toStringOrNull(e.regime),
          regimeText: toStringOrNull(e.regime_text),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteEnfants = enfants !== null && enfantsRows.length === enfants.length;

    const canWriteProspect = Boolean(prospectData) || raw.prospect === null;
    const canWriteConjoint = Boolean(conjointData) || raw.conjoint === null;
    const canWriteElementsSouscription = raw.elements_souscription === null || elementsSouscriptionRaw !== null;

    // Build trimmed rawData (only remove sections we successfully wrote/cleared)
    const nextRaw: Record<string, unknown> = { ...raw };
    if (canWriteInfoFromRaw) {delete nextRaw.information;}
    if (canWriteProspect) {delete nextRaw.prospect;}
    if (canWriteConjoint) {delete nextRaw.conjoint;}
    if (canWriteEnfants) {delete nextRaw.enfants;}
    if (canWriteMails) {delete nextRaw.mails;}
    if (canWriteRendezVous) {delete nextRaw.rendez_vous;}
    if (canWriteAlertes) {delete nextRaw.alertes;}
    if (canWriteDocuments) {delete nextRaw.documents;}
    if (canWriteCommentaires) {delete nextRaw.commentaires;}
    if (canWriteElementsSouscription) {delete nextRaw.elements_souscription;}

    const reclamationsRows: Prisma.FicheCacheReclamationCreateManyInput[] = (reclamations ?? [])
      .map((r, idx) => {
        if (!isRecord(r)) {return null;}
        const reclamationId = toStringOrNull(r.reclamation_id);
        const dateCreation = toStringOrNull(r.date_creation);
        if (reclamationId === null || dateCreation === null) {return null;}
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          reclamationId,
          dateCreation,
          assureur: toStringOrNull(r.assureur),
          typeReclamation: toStringOrNull(r.type_reclamation),
          description: toStringOrNull(r.description),
          statut: toStringOrNull(r.statut),
          dateTraitement: toStringOrNull(r.date_traitement),
          utilisateurCreation: toStringOrNull(r.utilisateur_creation),
          utilisateurTraitement: toStringOrNull(r.utilisateur_traitement),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteReclamations =
      reclamations !== null && reclamationsRows.length === reclamations.length;
    if (canWriteReclamations) {delete nextRaw.reclamations;}

    const autresContratsRows: Prisma.FicheCacheAutreContratCreateManyInput[] = (autresContrats ?? [])
      .map((c, idx) => {
        if (!isRecord(c)) {return null;}
        const contratId = toStringOrNull(c.contrat_id);
        const typeContrat = toStringOrNull(c.type_contrat);
        if (contratId === null || typeContrat === null) {return null;}
        return {
          ficheCacheId: row.id,
          rowIndex: idx + 1,
          contratId,
          typeContrat,
          assureur: toStringOrNull(c.assureur),
          numeroContrat: toStringOrNull(c.numero_contrat),
          dateSouscription: toStringOrNull(c.date_souscription),
          montant: toStringOrNull(c.montant),
          commentaire: toStringOrNull(c.commentaire),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const canWriteAutresContrats =
      autresContrats !== null && autresContratsRows.length === autresContrats.length;
    if (canWriteAutresContrats) {delete nextRaw.autres_contrats;}

    const rawSectionEntries = rawSections
      ? Object.entries(rawSections).filter((e): e is [string, string] => typeof e[1] === "string")
      : [];
    const canWriteRawSections =
      rawSections !== null && rawSectionEntries.length === Object.keys(rawSections).length;
    if (canWriteRawSections) {delete nextRaw.raw_sections;}

    const tarificationParsed: Array<{
      nom: string;
      gammes: Array<{
        nom: string;
        logo_url: string | null;
        garanties_url: string | null;
        conditions_generales_url: string | null;
        bulletin_adhesion_url: string | null;
        formules: Array<{
          formule_id: string;
          nom: string;
          prix: string;
          details: Record<string, string>;
        }>;
      }>;
    }> | null = (() => {
      if (tarification === null) {return null;}
      if (tarification.length === 0) {return [];}
      const out: Array<{
        nom: string;
        gammes: Array<{
          nom: string;
          logo_url: string | null;
          garanties_url: string | null;
          conditions_generales_url: string | null;
          bulletin_adhesion_url: string | null;
          formules: Array<{
            formule_id: string;
            nom: string;
            prix: string;
            details: Record<string, string>;
          }>;
        }>;
      }> = [];

      for (const t of tarification) {
        if (!isRecord(t)) {return null;}
        const nom = toStringOrNull(t.nom);
        if (nom === null) {return null;}
        const gammesRaw = Array.isArray(t.gammes) ? t.gammes : null;
        if (!gammesRaw) {return null;}

        const gammesOut: Array<{
          nom: string;
          logo_url: string | null;
          garanties_url: string | null;
          conditions_generales_url: string | null;
          bulletin_adhesion_url: string | null;
          formules: Array<{
            formule_id: string;
            nom: string;
            prix: string;
            details: Record<string, string>;
          }>;
        }> = [];

        for (const g of gammesRaw) {
          if (!isRecord(g)) {return null;}
          const gammeNom = toStringOrNull(g.nom);
          if (gammeNom === null) {return null;}
          const formulesRaw = Array.isArray(g.formules) ? g.formules : null;
          if (!formulesRaw) {return null;}

          const formulesOut: Array<{
            formule_id: string;
            nom: string;
            prix: string;
            details: Record<string, string>;
          }> = [];

          for (const f of formulesRaw) {
            if (!isRecord(f)) {return null;}
            const formuleId = toStringOrNull(f.formule_id);
            const formuleNom = toStringOrNull(f.nom);
            const prix = toStringOrNull(f.prix);
            if (formuleId === null || formuleNom === null || prix === null) {return null;}

            const detailsRaw = isRecord(f.details) ? (f.details as Record<string, unknown>) : null;
            if (!detailsRaw) {return null;}
            const entries = Object.entries(detailsRaw).filter(
              (e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string"
            );
            if (entries.length !== Object.keys(detailsRaw).length) {return null;}

            formulesOut.push({
              formule_id: formuleId,
              nom: formuleNom,
              prix,
              details: Object.fromEntries(entries),
            });
          }

          gammesOut.push({
            nom: gammeNom,
            logo_url: toStringOrNull(g.logo_url),
            garanties_url: toStringOrNull(g.garanties_url),
            conditions_generales_url: toStringOrNull(g.conditions_generales_url),
            bulletin_adhesion_url: toStringOrNull(g.bulletin_adhesion_url),
            formules: formulesOut,
          });
        }

        out.push({ nom, gammes: gammesOut });
      }

      return out;
    })();

    const canWriteTarification = tarificationParsed !== null;
    if (canWriteTarification) {delete nextRaw.tarification;}

    const elementsSouscriptionData: Prisma.FicheCacheElementsSouscriptionUncheckedCreateInput | null =
      elementsSouscriptionRaw
        ? (() => {
            const es = elementsSouscriptionRaw;
            const ancien = isRecord(es.ancien_contrat) ? (es.ancien_contrat as Record<string, unknown>) : null;
            const produit = isRecord(es.produit) ? (es.produit as Record<string, unknown>) : null;
            const paiement = isRecord(es.paiement) ? (es.paiement as Record<string, unknown>) : null;
            const comptePrelevement = paiement && isRecord(paiement.compte_prelevement)
              ? (paiement.compte_prelevement as Record<string, unknown>)
              : null;
            const compteVirement = paiement && isRecord(paiement.compte_virement)
              ? (paiement.compte_virement as Record<string, unknown>)
              : null;

            return {
              ficheCacheId: row.id,

              souscriptionId: toStringOrNull(es.souscription_id),
              dateSouscription: toStringOrNull(es.date_souscription),
              dateSignature: toStringOrNull(es.date_signature),
              dateValidation: toStringOrNull(es.date_validation),
              numContrat: toStringOrNull(es.num_contrat),
              annulationContrat: typeof es.annulation_contrat === "boolean" ? es.annulation_contrat : false,
              typeVente: toStringOrNull(es.type_vente),
              venteAFroid: toStringOrNull(es.vente_a_froid),
              vfAccept: toStringOrNull(es.vf_accept),

              ancienDejaAssure: ancien ? toBoolOrNull(ancien.deja_assure) : null,
              ancienPlus12Mois: ancien ? toBoolOrNull(ancien.plus_12_mois) : null,
              ancienRiaRequested: ancien ? toBoolOrNull(ancien.ria_requested) : null,
              ancienAssureur: ancien ? toStringOrNull(ancien.assureur) : null,
              ancienCodeAssureur: ancien ? toStringOrNull(ancien.code_assureur) : null,
              ancienAdresse: ancien ? toStringOrNull(ancien.adresse) : null,
              ancienCodePostal: ancien ? toStringOrNull(ancien.code_postal) : null,
              ancienVille: ancien ? toStringOrNull(ancien.ville) : null,
              ancienDateSouscription: ancien ? toStringOrNull(ancien.date_souscription) : null,
              ancienDateEcheance: ancien ? toStringOrNull(ancien.date_echeance) : null,
              ancienNumContrat: ancien ? toStringOrNull(ancien.num_contrat) : null,
              ancienFormule: ancien ? toStringOrNull(ancien.formule) : null,
              ancienCotisation: ancien ? toStringOrNull(ancien.cotisation) : null,

              produitDateEffet: produit ? toStringOrNull(produit.date_effet) : null,
              produitDateEffetModifiable: produit ? toStringOrNull(produit.date_effet_modifiable) : null,
              produitFormule: produit ? toStringOrNull(produit.formule) : null,
              produitGroupeNom: produit ? toStringOrNull(produit.groupe_nom) : null,
              produitGammeNom: produit ? toStringOrNull(produit.gamme_nom) : null,
              produitFormuleNom: produit ? toStringOrNull(produit.formule_nom) : null,
              produitCotisation: produit ? toStringOrNull(produit.cotisation) : null,
              produitTypeContrat: produit ? toStringOrNull(produit.type_contrat) : null,
              produitTypeClient: produit ? toStringOrNull(produit.type_client) : null,
              produitLogoUrl: produit ? toStringOrNull(produit.logo_url) : null,
              produitGarantiesUrl: produit ? toStringOrNull(produit.garanties_url) : null,
              produitDipaUrl: produit ? toStringOrNull(produit.dipa_url) : null,
              produitConditionsGeneralesUrl: produit ? toStringOrNull(produit.conditions_generales_url) : null,
              produitBulletinAdhesionUrl: produit ? toStringOrNull(produit.bulletin_adhesion_url) : null,
              produitDevoirConseilUrl: produit ? toStringOrNull(produit.devoir_conseil_url) : null,

              paiementModePaiement: paiement ? toStringOrNull(paiement.mode_paiement) : null,
              paiementPrelevementLe: paiement ? toStringOrNull(paiement.prelevement_le) : null,
              paiementPeriodicite: paiement ? toStringOrNull(paiement.periodicite) : null,
              paiementPasCoordBancaires: paiement ? toBoolOrNull(paiement.pas_coord_bancaires) : null,

              prelevementAccountId: comptePrelevement ? toStringOrNull(comptePrelevement.account_id) : null,
              prelevementTitulaireNom: comptePrelevement ? toStringOrNull(comptePrelevement.titulaire_nom) : null,
              prelevementTitulairePrenom: comptePrelevement
                ? toStringOrNull(comptePrelevement.titulaire_prenom)
                : null,
              prelevementTitulaireAdresse: comptePrelevement
                ? toStringOrNull(comptePrelevement.titulaire_adresse)
                : null,
              prelevementTitulaireCp: comptePrelevement ? toStringOrNull(comptePrelevement.titulaire_cp) : null,
              prelevementTitulaireVille: comptePrelevement ? toStringOrNull(comptePrelevement.titulaire_ville) : null,

              virementAccountId: compteVirement ? toStringOrNull(compteVirement.account_id) : null,
              virementTitulaireNom: compteVirement ? toStringOrNull(compteVirement.titulaire_nom) : null,
              virementTitulairePrenom: compteVirement
                ? toStringOrNull(compteVirement.titulaire_prenom)
                : null,
              virementTitulaireAdresse: compteVirement
                ? toStringOrNull(compteVirement.titulaire_adresse)
                : null,
              virementTitulaireCp: compteVirement ? toStringOrNull(compteVirement.titulaire_cp) : null,
              virementTitulaireVille: compteVirement ? toStringOrNull(compteVirement.titulaire_ville) : null,

              questionsComplementaires: isRecord(es.questions_complementaires)
                ? toPrismaJsonValue(es.questions_complementaires)
                : toPrismaJsonValue({}),
              questionsConseil: isRecord(es.questions_conseil)
                ? toPrismaJsonValue(es.questions_conseil)
                : toPrismaJsonValue({}),
              rawData: isRecord(es.raw_data) ? toPrismaJsonValue(es.raw_data) : toPrismaJsonValue({}),
            };
          })()
        : null;

    const etiquetteRows = etiquettes
      .map((e, idx) => {
        if (!isRecord(e)) {return null;}
        const nom = toStringOrNull(e.nom);
        const date = toStringOrNull(e.date);
        const style = toStringOrNull(e.style);
        if (nom === null || date === null || style === null) {return null;}
        return { ficheCacheId: row.id, etiquetteIndex: idx + 1, nom, date, style };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const ops: Array<import("@prisma/client").Prisma.PrismaPromise<unknown>> = [];

    // Avoid interactive transactions (pgbouncer/Supabase pooler can trigger P2028).
    if (canWriteInfoFromRaw && info) {
      ops.push(
        prisma.ficheCacheInformation.upsert({
          where: { ficheCacheId: row.id },
          create: {
            ficheCacheId: row.id,
            cle: infoCle!,
            dateInsertion: infoDateInsertion!,
            createur: toStringOrNull(info.createur),
            fichesAssociees: toStringOrNull(info.fiches_associees),
            nombreAcces: infoNombreAcces!,
            dernierAcces: infoDernierAcces!,
            groupe: infoGroupe!,
            groupeResponsable: toStringOrNull(info.groupe_responsable),
            groupeGestion: toStringOrNull(info.groupe_gestion),
            groupeReclamation: toStringOrNull(info.groupe_reclamation),
            agenceId: infoAgenceId!,
            agenceNom: infoAgenceNom!,
            attributionUserId: infoAttributionUserId!,
            attributionUserNom: infoAttributionUserNom!,
            provenanceId: infoProvenanceId!,
            provenanceNom: infoProvenanceNom!,
            provenanceNumero: toStringOrNull(info.provenance_numero),
            provenancePeriodeRappel: toStringOrNull(info.provenance_periode_rappel),
            origineId: toStringOrNull(info.origine_id),
            origineNom: toStringOrNull(info.origine_nom),
            attributionBisUserId: toStringOrNull(info.attribution_bis_user_id),
            attributionBisUserNom: toStringOrNull(info.attribution_bis_user_nom),
            refusDemarchage: infoRefusDemarchage!,
            exceptionDemarchage: infoExceptionDemarchage!,
            exceptionDemarchageCommentaire: toStringOrNull(info.exception_demarchage_commentaire),
            niveauInteret: toIntOrNull(info.niveau_interet),
            nombreOuvertureMails: infoNombreOuvertureMails!,
            derniereOuvertureMail: toStringOrNull(info.derniere_ouverture_mail),
            nombreVisualisationPages: infoNombreVisualisationPages!,
            derniereVisualisationPage: toStringOrNull(info.derniere_visualisation_page),
            espaceProspectUrl: toStringOrNull(info.espace_prospect_url),
            fermeEspaceProspect: infoFermeEspaceProspect!,
            desinscriptionMail: infoDesinscriptionMail!,
            corbeille: infoCorbeille!,
            archive: infoArchive!,
            modules: infoModules,
          },
          update: {
            cle: infoCle!,
            dateInsertion: infoDateInsertion!,
            createur: toStringOrNull(info.createur),
            fichesAssociees: toStringOrNull(info.fiches_associees),
            nombreAcces: infoNombreAcces!,
            dernierAcces: infoDernierAcces!,
            groupe: infoGroupe!,
            groupeResponsable: toStringOrNull(info.groupe_responsable),
            groupeGestion: toStringOrNull(info.groupe_gestion),
            groupeReclamation: toStringOrNull(info.groupe_reclamation),
            agenceId: infoAgenceId!,
            agenceNom: infoAgenceNom!,
            attributionUserId: infoAttributionUserId!,
            attributionUserNom: infoAttributionUserNom!,
            provenanceId: infoProvenanceId!,
            provenanceNom: infoProvenanceNom!,
            provenanceNumero: toStringOrNull(info.provenance_numero),
            provenancePeriodeRappel: toStringOrNull(info.provenance_periode_rappel),
            origineId: toStringOrNull(info.origine_id),
            origineNom: toStringOrNull(info.origine_nom),
            attributionBisUserId: toStringOrNull(info.attribution_bis_user_id),
            attributionBisUserNom: toStringOrNull(info.attribution_bis_user_nom),
            refusDemarchage: infoRefusDemarchage!,
            exceptionDemarchage: infoExceptionDemarchage!,
            exceptionDemarchageCommentaire: toStringOrNull(info.exception_demarchage_commentaire),
            niveauInteret: toIntOrNull(info.niveau_interet),
            nombreOuvertureMails: infoNombreOuvertureMails!,
            derniereOuvertureMail: toStringOrNull(info.derniere_ouverture_mail),
            nombreVisualisationPages: infoNombreVisualisationPages!,
            derniereVisualisationPage: toStringOrNull(info.derniere_visualisation_page),
            espaceProspectUrl: toStringOrNull(info.espace_prospect_url),
            fermeEspaceProspect: infoFermeEspaceProspect!,
            desinscriptionMail: infoDesinscriptionMail!,
            corbeille: infoCorbeille!,
            archive: infoArchive!,
            modules: infoModules,
          },
        })
      );

      ops.push(prisma.ficheCacheEtiquette.deleteMany({ where: { ficheCacheId: row.id } }));
      if (etiquetteRows.length > 0) {
        ops.push(prisma.ficheCacheEtiquette.createMany({ data: etiquetteRows }));
      }
    }

    if (prospectData && canWriteProspect) {
      ops.push(
        prisma.ficheCacheProspect.upsert({
          where: { ficheCacheId: row.id },
          create: { ficheCacheId: row.id, ...prospectData },
          update: { ...prospectData },
        })
      );
    } else if (raw.prospect === null && canWriteProspect) {
      ops.push(prisma.ficheCacheProspect.deleteMany({ where: { ficheCacheId: row.id } }));
    }

    if (canWriteDocuments) {
      ops.push(prisma.ficheCacheDocument.deleteMany({ where: { ficheCacheId: row.id } }));
      if (docsRows.length > 0) {
        ops.push(prisma.ficheCacheDocument.createMany({ data: docsRows }));
      }
    }

    if (canWriteCommentaires) {
      ops.push(prisma.ficheCacheCommentaire.deleteMany({ where: { ficheCacheId: row.id } }));
      if (commentairesRows.length > 0) {
        ops.push(prisma.ficheCacheCommentaire.createMany({ data: commentairesRows }));
      }
    }

    if (canWriteMails) {
      ops.push(prisma.ficheCacheMail.deleteMany({ where: { ficheCacheId: row.id } }));
      if (mailsRows.length > 0) {
        ops.push(prisma.ficheCacheMail.createMany({ data: mailsRows }));
      }
    }

    if (canWriteRendezVous) {
      ops.push(prisma.ficheCacheRendezVous.deleteMany({ where: { ficheCacheId: row.id } }));
      if (rendezVousRows.length > 0) {
        ops.push(prisma.ficheCacheRendezVous.createMany({ data: rendezVousRows }));
      }
    }

    if (canWriteAlertes) {
      ops.push(prisma.ficheCacheAlerte.deleteMany({ where: { ficheCacheId: row.id } }));
      if (alertesRows.length > 0) {
        ops.push(prisma.ficheCacheAlerte.createMany({ data: alertesRows }));
      }
    }

    if (canWriteEnfants) {
      ops.push(prisma.ficheCacheEnfant.deleteMany({ where: { ficheCacheId: row.id } }));
      if (enfantsRows.length > 0) {
        ops.push(prisma.ficheCacheEnfant.createMany({ data: enfantsRows }));
      }
    }

    if (canWriteConjoint) {
      ops.push(prisma.ficheCacheConjoint.deleteMany({ where: { ficheCacheId: row.id } }));
      if (conjointData) {
        ops.push(prisma.ficheCacheConjoint.create({ data: { ficheCacheId: row.id, ...conjointData } }));
      }
    }

    if (canWriteReclamations) {
      ops.push(prisma.ficheCacheReclamation.deleteMany({ where: { ficheCacheId: row.id } }));
      if (reclamationsRows.length > 0) {
        ops.push(prisma.ficheCacheReclamation.createMany({ data: reclamationsRows }));
      }
    }

    if (canWriteAutresContrats) {
      ops.push(prisma.ficheCacheAutreContrat.deleteMany({ where: { ficheCacheId: row.id } }));
      if (autresContratsRows.length > 0) {
        ops.push(prisma.ficheCacheAutreContrat.createMany({ data: autresContratsRows }));
      }
    }

    if (canWriteRawSections) {
      ops.push(prisma.ficheCacheRawSection.deleteMany({ where: { ficheCacheId: row.id } }));
      if (rawSectionEntries.length > 0) {
        ops.push(
          prisma.ficheCacheRawSection.createMany({
            data: rawSectionEntries.map(([k, v]) => ({
              ficheCacheId: row.id,
              sectionKey: k,
              sectionValue: v,
            })),
          })
        );
      }
    }

    if (canWriteElementsSouscription) {
      ops.push(prisma.ficheCacheElementsSouscription.deleteMany({ where: { ficheCacheId: row.id } }));
      if (elementsSouscriptionData) {
        ops.push(prisma.ficheCacheElementsSouscription.create({ data: elementsSouscriptionData }));
      }
    }

    if (canWriteTarification) {
      ops.push(prisma.ficheCacheTarification.deleteMany({ where: { ficheCacheId: row.id } }));
      if (tarificationParsed && tarificationParsed.length > 0) {
        for (const [tarifIndex, t] of tarificationParsed.entries()) {
          ops.push(
            prisma.ficheCacheTarification.create({
              data: {
                ficheCacheId: row.id,
                rowIndex: tarifIndex + 1,
                nom: t.nom,
                gammes: {
                  create: t.gammes.map((g, gammeIndex) => ({
                    rowIndex: gammeIndex + 1,
                    nom: g.nom,
                    logoUrl: g.logo_url,
                    garantiesUrl: g.garanties_url,
                    conditionsGeneralesUrl: g.conditions_generales_url,
                    bulletinAdhesionUrl: g.bulletin_adhesion_url,
                    formules: {
                      create: g.formules.map((f, formuleIndex) => ({
                        rowIndex: formuleIndex + 1,
                        formuleId: f.formule_id,
                        nom: f.nom,
                        prix: f.prix,
                        details: {
                          create: Object.entries(f.details).map(([k, v]) => ({
                            detailKey: k,
                            detailValue: v,
                          })),
                        },
                      })),
                    },
                  })),
                },
              },
            })
          );
        }
      }
    }

    ops.push(
      prisma.ficheCache.update({
        where: { id: row.id },
        data: { rawData: toPrismaJsonValue(nextRaw) },
      })
    );

    await prisma.$transaction(ops);

    backfilled += 1;
    trimmed += 1;
  }

  return { processed, backfilled, trimmed, skipped, nextAfterId };
}

async function main() {
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_SECTIONS_BATCH_SIZE || "25", 10) ||
      25
  );
  const maxBatches = Math.max(
    1,
    Number.parseInt(process.env.BACKFILL_FICHE_CACHE_SECTIONS_MAX_BATCHES || "1000000", 10) ||
      1000000
  );

  let totalProcessed = 0;
  let totalBackfilled = 0;
  let totalTrimmed = 0;
  let totalSkipped = 0;

  const afterIdRaw = (process.env.BACKFILL_FICHE_CACHE_SECTIONS_AFTER_ID || "").trim();
  let afterId = 0n;
  if (afterIdRaw) {
    try {
      afterId = BigInt(afterIdRaw);
    } catch {
      afterId = 0n;
    }
  }

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

