/**
 * Fiches Repository
 * =================
 * RESPONSIBILITY: Database operations only (CRUD)
 * - Read/write/delete fiches cache entries
 * - Read/write recordings
 * - Query helpers for database lookups
 * - No business logic or enrichment
 *
 * LAYER: Data Access (Database)
 */

import { logger } from "../../shared/logger.js";
import { prisma } from "../../shared/prisma.js";
import { createConcurrencyLimiter } from "../../utils/concurrency.js";
import type { MailDevis } from "./fiches.schemas.js";

// IMPORTANT: This limiter is **module-scoped** on purpose.
// It bounds total concurrent recording upserts across all simultaneous workflows in this process,
// preventing Prisma connection-pool exhaustion (P2024) under load.
const configuredRecordingsUpsertConcurrency = Number(
  process.env.FICHE_RECORDINGS_UPSERT_CONCURRENCY ?? 3
);
const RECORDINGS_UPSERT_CONCURRENCY =
  Number.isFinite(configuredRecordingsUpsertConcurrency) &&
  configuredRecordingsUpsertConcurrency >= 1
    ? Math.floor(configuredRecordingsUpsertConcurrency)
    : 3;
const limitRecordingUpsert = createConcurrencyLimiter(
  RECORDINGS_UPSERT_CONCURRENCY
);

// ═══════════════════════════════════════════════════════════════════════════
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get cached fiche by ID
 */
export async function getCachedFiche(
  ficheId: string,
  options?: { includeMailDevis?: boolean }
) {
  logger.debug("Looking up fiche in cache", { fiche_id: ficheId });

  const cached = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        orderBy: { startTime: "desc" },
      },
      information: true,
      prospectDetails: true,
      etiquettes: {
        orderBy: { etiquetteIndex: "asc" },
      },
      documents: {
        orderBy: { rowIndex: "asc" },
      },
      commentaires: {
        orderBy: { rowIndex: "asc" },
      },
      mails: {
        orderBy: { rowIndex: "asc" },
      },
      rendezVous: {
        orderBy: { rowIndex: "asc" },
      },
      alertes: {
        orderBy: { rowIndex: "asc" },
      },
      enfants: {
        orderBy: { rowIndex: "asc" },
      },
      conjoint: true,
      reclamations: {
        orderBy: { rowIndex: "asc" },
      },
      autresContrats: {
        orderBy: { rowIndex: "asc" },
      },
      rawSections: {
        orderBy: { sectionKey: "asc" },
      },
      elementsSouscription: true,
      tarifications: {
        orderBy: { rowIndex: "asc" },
        include: {
          gammes: {
            orderBy: { rowIndex: "asc" },
            include: {
              formules: {
                orderBy: { rowIndex: "asc" },
                include: {
                  details: {
                    orderBy: { detailKey: "asc" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cached) {
    logger.debug("Fiche not found in cache", { fiche_id: ficheId });
    return null;
  }

  // Only load mail_devis when explicitly requested (it's large).
  const mailDevis =
    options?.includeMailDevis === true
      ? await prisma.ficheCacheMailDevis.findUnique({
          where: { ficheCacheId: cached.id },
          include: {
            categories: {
              orderBy: { categoryKey: "asc" },
              include: {
                noteReferences: { orderBy: { rowIndex: "asc" } },
                items: { orderBy: { rowIndex: "asc" } },
                subcategories: {
                  orderBy: { subKey: "asc" },
                  include: { items: { orderBy: { rowIndex: "asc" } } },
                },
              },
            },
            notes: { orderBy: { rowIndex: "asc" } },
          },
        })
      : null;

  // Attach recordings (+ normalized fields) to rawData for compatibility.
  // Transform database format (camelCase) to API format (snake_case).
  const rawData = cached.rawData as Record<string, unknown>;

  // Reduce raw JSON storage: keep stable scalars on the row and re-attach at read-time.
  if (typeof cached.cle === "string" && cached.cle) {
    (rawData as { cle?: unknown }).cle = cached.cle;
  }
  if (cached.information) {
    if (typeof cached.detailsSuccess === "boolean") {
      (rawData as { success?: unknown }).success = cached.detailsSuccess;
    } else if (typeof (rawData as { success?: unknown }).success !== "boolean") {
      (rawData as { success?: unknown }).success = true;
    }

    if (typeof cached.detailsMessage === "string") {
      (rawData as { message?: unknown }).message = cached.detailsMessage;
    } else if (typeof (rawData as { message?: unknown }).message !== "string") {
      (rawData as { message?: unknown }).message = "OK";
    }
  }

  (rawData as { recordings?: unknown[] }).recordings = cached.recordings.map(
    (rec) => ({
      call_id: rec.callId,
      recording_url: rec.recordingUrl,
      direction: rec.direction,
      answered: rec.answered,
      start_time: rec.startTime?.toISOString(),
      duration_seconds: rec.durationSeconds,
      from_number: rec.fromNumber,
      to_number: rec.toNumber,
      transcription: rec.hasTranscription
        ? { conversation: rec.transcriptionText || "" }
        : null,
    })
  );

  // Prefer normalized information/prospect tables (fallback to legacy rawData fields if present).
  if (cached.information) {
    const info = cached.information;
    (rawData as { information?: unknown }).information = {
      fiche_id: cached.ficheId,
      cle: info.cle,
      date_insertion: info.dateInsertion,
      createur: info.createur,
      fiches_associees: info.fichesAssociees,
      nombre_acces: info.nombreAcces,
      dernier_acces: info.dernierAcces,
      groupe: info.groupe,
      groupe_responsable: info.groupeResponsable,
      groupe_gestion: info.groupeGestion,
      groupe_reclamation: info.groupeReclamation,
      agence_id: info.agenceId,
      agence_nom: info.agenceNom,
      attribution_user_id: info.attributionUserId,
      attribution_user_nom: info.attributionUserNom,
      provenance_id: info.provenanceId,
      provenance_nom: info.provenanceNom,
      provenance_numero: info.provenanceNumero,
      provenance_periode_rappel: info.provenancePeriodeRappel,
      origine_id: info.origineId,
      origine_nom: info.origineNom,
      attribution_bis_user_id: info.attributionBisUserId,
      attribution_bis_user_nom: info.attributionBisUserNom,
      refus_demarchage: info.refusDemarchage,
      exception_demarchage: info.exceptionDemarchage,
      exception_demarchage_commentaire: info.exceptionDemarchageCommentaire,
      niveau_interet: info.niveauInteret,
      nombre_ouverture_mails: info.nombreOuvertureMails,
      derniere_ouverture_mail: info.derniereOuvertureMail,
      nombre_visualisation_pages: info.nombreVisualisationPages,
      derniere_visualisation_page: info.derniereVisualisationPage,
      espace_prospect_url: info.espaceProspectUrl,
      ferme_espace_prospect: info.fermeEspaceProspect,
      desinscription_mail: info.desinscriptionMail,
      corbeille: info.corbeille,
      archive: info.archive,
      modules: info.modules,
      etiquettes: cached.etiquettes.map((e) => ({
        nom: e.nom,
        date: e.date,
        style: e.style,
      })),
    };
  }

  if (cached.prospectDetails) {
    const p = cached.prospectDetails;
    (rawData as { prospect?: unknown }).prospect = {
      prospect_id: p.prospectId,
      civilite: p.civilite,
      civilite_text: p.civiliteText,
      nom: p.nom,
      prenom: p.prenom,
      date_naissance: p.dateNaissance,
      regime: p.regime,
      regime_text: p.regimeText,
      telephone: p.telephone,
      mobile: p.mobile,
      telephone_2: p.telephone2,
      mail: p.mail,
      mail_2: p.mail2,
      adresse: p.adresse,
      code_postal: p.codePostal,
      ville: p.ville,
      num_secu: p.numSecu,
      num_affiliation: p.numAffiliation,
      situation_familiale: p.situationFamiliale,
      situation_familiale_text: p.situationFamilialeText,
      madelin: p.madelin,
      profession: p.profession,
      csp: p.csp,
      csp_text: p.cspText,
      fax: p.fax,
    };
  }

  // Documents/commentaires: prefer normalized tables; otherwise keep legacy rawData fields.
  if (Array.isArray(cached.documents) && cached.documents.length > 0) {
    (rawData as { documents?: unknown[] }).documents = cached.documents.map((d) => ({
      document_id: d.documentId,
      type: d.type,
      nom: d.nom,
      taille: d.taille,
      date_creation: d.dateCreation,
      selection_mail: d.selectionMail,
      partage_prospect: d.partageProspect,
      signer: d.signer,
      download_url: d.downloadUrl ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "documents")) {
    (rawData as { documents?: unknown[] }).documents = [];
  }

  if (Array.isArray(cached.commentaires) && cached.commentaires.length > 0) {
    (rawData as { commentaires?: unknown[] }).commentaires = cached.commentaires.map((c) => ({
      commentaire_id: c.commentaireId,
      date: c.date,
      utilisateur: c.utilisateur,
      texte: c.texte,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "commentaires")) {
    (rawData as { commentaires?: unknown[] }).commentaires = [];
  }

  if (Array.isArray(cached.mails) && cached.mails.length > 0) {
    (rawData as { mails?: unknown[] }).mails = cached.mails.map((m) => ({
      date_envoi: m.dateEnvoi,
      type_mail: m.typeMail,
      utilisateur: m.utilisateur,
      visualisation_url: m.visualisationUrl ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "mails")) {
    (rawData as { mails?: unknown[] }).mails = [];
  }

  if (Array.isArray(cached.rendezVous) && cached.rendezVous.length > 0) {
    (rawData as { rendez_vous?: unknown[] }).rendez_vous = cached.rendezVous.map((r) => ({
      rdv_id: r.rdvId,
      etiquette: r.etiquette ?? null,
      etiquette_color: r.etiquetteColor ?? null,
      utilisateur: r.utilisateur,
      date_debut: r.dateDebut,
      date_fin: r.dateFin ?? null,
      commentaire: r.commentaire ?? null,
      statut: r.statut ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "rendez_vous")) {
    (rawData as { rendez_vous?: unknown[] }).rendez_vous = [];
  }

  if (Array.isArray(cached.alertes) && cached.alertes.length > 0) {
    (rawData as { alertes?: unknown[] }).alertes = cached.alertes.map((a) => ({
      alerte_id: a.alerteId,
      etat: a.etat,
      date: a.date,
      etiquette: a.etiquette ?? null,
      libelle: a.libelle,
      deposee_le: a.deposeeLe,
      deposee_par: a.deposeePar,
      commentaire: a.commentaire ?? null,
      attribuee_a: a.attribueeA ?? null,
      traitee_le: a.traiteeLe ?? null,
      traitee_par: a.traiteePar ?? null,
      commentaire_traitement: a.commentaireTraitement ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "alertes")) {
    (rawData as { alertes?: unknown[] }).alertes = [];
  }

  if (Array.isArray(cached.enfants) && cached.enfants.length > 0) {
    (rawData as { enfants?: unknown[] }).enfants = cached.enfants.map((e) => ({
      enfant_id: e.enfantId,
      civilite: e.civilite,
      civilite_text: e.civiliteText,
      nom: e.nom,
      prenom: e.prenom,
      date_naissance: e.dateNaissance,
      regime: e.regime ?? null,
      regime_text: e.regimeText ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "enfants")) {
    (rawData as { enfants?: unknown[] }).enfants = [];
  }

  if (cached.conjoint) {
    const c = cached.conjoint;
    (rawData as { conjoint?: unknown }).conjoint = {
      conjoint_id: c.conjointId,
      civilite: c.civilite,
      civilite_text: c.civiliteText,
      nom: c.nom,
      prenom: c.prenom,
      date_naissance: c.dateNaissance,
      regime: c.regime ?? null,
      regime_text: c.regimeText ?? null,
      telephone: c.telephone ?? null,
      mobile: c.mobile ?? null,
      mail: c.mail ?? null,
      profession: c.profession ?? null,
      csp: c.csp ?? null,
      csp_text: c.cspText ?? null,
    };
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "conjoint")) {
    (rawData as { conjoint?: unknown }).conjoint = null;
  }

  if (Array.isArray(cached.reclamations) && cached.reclamations.length > 0) {
    (rawData as { reclamations?: unknown[] }).reclamations = cached.reclamations.map((r) => ({
      reclamation_id: r.reclamationId,
      date_creation: r.dateCreation,
      assureur: r.assureur ?? null,
      type_reclamation: r.typeReclamation ?? null,
      description: r.description ?? null,
      statut: r.statut ?? null,
      date_traitement: r.dateTraitement ?? null,
      utilisateur_creation: r.utilisateurCreation ?? null,
      utilisateur_traitement: r.utilisateurTraitement ?? null,
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "reclamations")) {
    (rawData as { reclamations?: unknown[] }).reclamations = [];
  }

  if (Array.isArray(cached.autresContrats) && cached.autresContrats.length > 0) {
    (rawData as { autres_contrats?: unknown[] }).autres_contrats = cached.autresContrats.map(
      (c) => ({
        contrat_id: c.contratId,
        type_contrat: c.typeContrat,
        assureur: c.assureur ?? null,
        numero_contrat: c.numeroContrat ?? null,
        date_souscription: c.dateSouscription ?? null,
        montant: c.montant ?? null,
        commentaire: c.commentaire ?? null,
      })
    );
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "autres_contrats")) {
    (rawData as { autres_contrats?: unknown[] }).autres_contrats = [];
  }

  if (Array.isArray(cached.rawSections) && cached.rawSections.length > 0) {
    const sections: Record<string, string> = {};
    for (const s of cached.rawSections) {
      if (typeof s.sectionKey === "string" && typeof s.sectionValue === "string") {
        sections[s.sectionKey] = s.sectionValue;
      }
    }
    (rawData as { raw_sections?: Record<string, string> }).raw_sections = sections;
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "raw_sections")) {
    (rawData as { raw_sections?: Record<string, string> }).raw_sections = {};
  }

  if (cached.elementsSouscription) {
    const es = cached.elementsSouscription;

    const hasAncien = es.ancienDejaAssure !== null;
    const hasProduit =
      es.produitDateEffet !== null ||
      es.produitDateEffetModifiable !== null ||
      es.produitFormule !== null ||
      es.produitGroupeNom !== null ||
      es.produitGammeNom !== null ||
      es.produitFormuleNom !== null ||
      es.produitCotisation !== null ||
      es.produitTypeContrat !== null ||
      es.produitTypeClient !== null ||
      es.produitLogoUrl !== null ||
      es.produitGarantiesUrl !== null ||
      es.produitDipaUrl !== null ||
      es.produitConditionsGeneralesUrl !== null ||
      es.produitBulletinAdhesionUrl !== null ||
      es.produitDevoirConseilUrl !== null;
    const hasPaiement = es.paiementPasCoordBancaires !== null;

    const hasComptePrelevement =
      es.prelevementAccountId !== null ||
      es.prelevementTitulaireNom !== null ||
      es.prelevementTitulairePrenom !== null ||
      es.prelevementTitulaireAdresse !== null ||
      es.prelevementTitulaireCp !== null ||
      es.prelevementTitulaireVille !== null;
    const hasCompteVirement =
      es.virementAccountId !== null ||
      es.virementTitulaireNom !== null ||
      es.virementTitulairePrenom !== null ||
      es.virementTitulaireAdresse !== null ||
      es.virementTitulaireCp !== null ||
      es.virementTitulaireVille !== null;

    (rawData as { elements_souscription?: unknown }).elements_souscription = {
      souscription_id: es.souscriptionId ?? null,
      date_souscription: es.dateSouscription ?? null,
      date_signature: es.dateSignature ?? null,
      date_validation: es.dateValidation ?? null,
      num_contrat: es.numContrat ?? null,
      annulation_contrat: Boolean(es.annulationContrat),
      type_vente: es.typeVente ?? null,
      vente_a_froid: es.venteAFroid ?? null,
      vf_accept: es.vfAccept ?? null,
      ancien_contrat: hasAncien
        ? {
            deja_assure: Boolean(es.ancienDejaAssure),
            plus_12_mois: Boolean(es.ancienPlus12Mois),
            ria_requested: Boolean(es.ancienRiaRequested),
            assureur: es.ancienAssureur ?? null,
            code_assureur: es.ancienCodeAssureur ?? null,
            adresse: es.ancienAdresse ?? null,
            code_postal: es.ancienCodePostal ?? null,
            ville: es.ancienVille ?? null,
            date_souscription: es.ancienDateSouscription ?? null,
            date_echeance: es.ancienDateEcheance ?? null,
            num_contrat: es.ancienNumContrat ?? null,
            formule: es.ancienFormule ?? null,
            cotisation: es.ancienCotisation ?? null,
          }
        : null,
      produit: hasProduit
        ? {
            date_effet: es.produitDateEffet ?? null,
            date_effet_modifiable: es.produitDateEffetModifiable ?? null,
            formule: es.produitFormule ?? null,
            groupe_nom: es.produitGroupeNom ?? null,
            gamme_nom: es.produitGammeNom ?? null,
            formule_nom: es.produitFormuleNom ?? null,
            cotisation: es.produitCotisation ?? null,
            type_contrat: es.produitTypeContrat ?? null,
            type_client: es.produitTypeClient ?? null,
            logo_url: es.produitLogoUrl ?? null,
            garanties_url: es.produitGarantiesUrl ?? null,
            dipa_url: es.produitDipaUrl ?? null,
            conditions_generales_url: es.produitConditionsGeneralesUrl ?? null,
            bulletin_adhesion_url: es.produitBulletinAdhesionUrl ?? null,
            devoir_conseil_url: es.produitDevoirConseilUrl ?? null,
          }
        : null,
      paiement: hasPaiement
        ? {
            mode_paiement: es.paiementModePaiement ?? null,
            prelevement_le: es.paiementPrelevementLe ?? null,
            periodicite: es.paiementPeriodicite ?? null,
            pas_coord_bancaires: Boolean(es.paiementPasCoordBancaires),
            compte_prelevement: hasComptePrelevement
              ? {
                  account_id: es.prelevementAccountId ?? null,
                  titulaire_nom: es.prelevementTitulaireNom ?? null,
                  titulaire_prenom: es.prelevementTitulairePrenom ?? null,
                  titulaire_adresse: es.prelevementTitulaireAdresse ?? null,
                  titulaire_cp: es.prelevementTitulaireCp ?? null,
                  titulaire_ville: es.prelevementTitulaireVille ?? null,
                }
              : null,
            compte_virement: hasCompteVirement
              ? {
                  account_id: es.virementAccountId ?? null,
                  titulaire_nom: es.virementTitulaireNom ?? null,
                  titulaire_prenom: es.virementTitulairePrenom ?? null,
                  titulaire_adresse: es.virementTitulaireAdresse ?? null,
                  titulaire_cp: es.virementTitulaireCp ?? null,
                  titulaire_ville: es.virementTitulaireVille ?? null,
                }
              : null,
          }
        : null,
      questions_complementaires: (es.questionsComplementaires as unknown) ?? {},
      questions_conseil: (es.questionsConseil as unknown) ?? {},
      raw_data: (es.rawData as unknown) ?? {},
    };
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "elements_souscription")) {
    (rawData as { elements_souscription?: unknown }).elements_souscription = null;
  }

  if (Array.isArray(cached.tarifications) && cached.tarifications.length > 0) {
    (rawData as { tarification?: unknown[] }).tarification = cached.tarifications.map((t) => ({
      nom: t.nom,
      gammes: t.gammes.map((g) => ({
        nom: g.nom,
        logo_url: g.logoUrl ?? null,
        garanties_url: g.garantiesUrl ?? null,
        conditions_generales_url: g.conditionsGeneralesUrl ?? null,
        bulletin_adhesion_url: g.bulletinAdhesionUrl ?? null,
        formules: g.formules.map((f) => ({
          formule_id: f.formuleId,
          nom: f.nom,
          prix: f.prix,
          details: Object.fromEntries(f.details.map((d) => [d.detailKey, d.detailValue])),
        })),
      })),
    }));
  } else if (!Object.prototype.hasOwnProperty.call(rawData, "tarification")) {
    (rawData as { tarification?: unknown[] }).tarification = [];
  }

  // Optional: Mail devis (only present when include_mail_devis=true)
  if (mailDevis) {
    const md = mailDevis;

    const garanties: Record<string, unknown> = {};
    for (const c of md.categories) {
      const categoryItems = c.items.map((i) => ({
        name: i.name,
        value: i.value,
        note_ref: i.noteRef ?? null,
      }));

      const subcategories: Record<string, unknown> = {};
      const asArray = c.subcategoriesFormat === "array";
      for (const s of c.subcategories) {
        const subItems = s.items.map((i) => ({
          name: i.name,
          value: i.value,
          note_ref: i.noteRef ?? null,
        }));

        subcategories[s.subKey] = asArray
          ? subItems
          : {
              name: s.name ?? s.subKey,
              items: subItems,
            };
      }

      garanties[c.categoryKey] = {
        category_name: c.categoryName,
        note_references: c.noteReferences.map((r) => r.noteReference),
        subcategories,
        items: categoryItems,
      };
    }

    (rawData as { mail_devis?: unknown }).mail_devis = {
      mail_devis: {
        date_envoi: md.dateEnvoi,
        type_mail: md.typeMail,
        utilisateur: md.utilisateur,
        visualisation_url: md.visualisationUrl ?? null,
      },
      customer_info: {
        email: md.customerEmail ?? null,
        phone: md.customerPhone ?? null,
        name: md.customerName ?? null,
      },
      garanties_link: {
        url: md.garantiesLinkUrl,
        text: md.garantiesLinkText ?? null,
      },
      garanties_details: {
        gamme: md.detailsGamme,
        product_name: md.detailsProductName,
        formule: md.detailsFormule,
        price: md.detailsPrice ?? null,
        age_range: md.detailsAgeRange ?? null,
        subscription_link: md.detailsSubscriptionLink ?? null,
        agence_info: {
          nom: md.agenceNom ?? null,
          adresse: md.agenceAdresse ?? null,
          telephone: md.agenceTelephone ?? null,
          email: md.agenceEmail ?? null,
          logo_url: md.agenceLogoUrl ?? null,
        },
        fiche_info: {
          fiche_id: md.ficheInfoFicheId,
          cle: md.ficheInfoCle ?? null,
          conseiller: md.ficheInfoConseiller ?? null,
        },
        subscriber_info: {
          civilite: md.subscriberCivilite ?? null,
          nom: md.subscriberNom ?? null,
          prenom: md.subscriberPrenom ?? null,
        },
        documents: {
          conditions_generales: md.docConditionsGenerales ?? null,
          tableau_garanties: md.docTableauGaranties ?? null,
          document_information: md.docDocumentInformation ?? null,
          exemples_remboursements: md.docExemplesRemboursements ?? null,
        },
        menu_links: {
          home: md.menuHome ?? null,
          garanties: md.menuGaranties ?? null,
          documents: md.menuDocuments ?? null,
          subscription: md.menuSubscription ?? null,
        },
        garanties,
        notes: md.notes.map((n) => ({ number: n.number, text: n.text })),
      },
    };
  }

  logger.debug("Fiche retrieved from cache", {
    fiche_id: ficheId,
    cache_id: String(cached.id),
    recordings_count: cached.recordings.length,
  });

  return {
    ...cached,
    rawData,
  };
}

/**
 * Get fiche with status information (transcription + audit)
 */
export async function getFicheWithStatus(ficheId: string) {
  const ficheCache = await prisma.ficheCache.findUnique({
    where: { ficheId },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return ficheCache;
}

/**
 * Get multiple fiches with status information
 */
export async function getFichesWithStatus(ficheIds: string[]) {
  const fichesCache = await prisma.ficheCache.findMany({
    where: { ficheId: { in: ficheIds } },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
        },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return fichesCache;
}

/**
 * Get fiches by sales date range
 * Uses salesDate field to filter by which CRM sales date the fiches belong to
 */
export async function getFichesByDateRange(startDate: Date, endDate: Date) {
  // Convert Date objects to YYYY-MM-DD strings for salesDate comparison
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const fichesCache = await prisma.ficheCache.findMany({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
    },
    include: {
      recordings: {
        select: {
          id: true,
          hasTranscription: true,
          transcribedAt: true,
          callId: true,
          startTime: true,
          durationSeconds: true,
        },
        orderBy: { startTime: "desc" },
      },
      audits: {
        where: { isLatest: true },
        select: {
          id: true,
          overallScore: true,
          scorePercentage: true,
          niveau: true,
          isCompliant: true,
          status: true,
          completedAt: true,
          createdAt: true,
          auditConfig: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return fichesCache;
}

// ═══════════════════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert fiche cache entry
 */
export async function upsertFicheCache(data: {
  ficheId: string;
  groupe?: string | null;
  agenceNom?: string | null;
  prospectNom?: string;
  prospectPrenom?: string;
  prospectEmail?: string;
  prospectTel?: string;
  salesDate?: string; // YYYY-MM-DD - CRM sales date this fiche belongs to
  cle?: string | null;
  detailsSuccess?: boolean | null;
  detailsMessage?: string | null;
  rawData: unknown;
  hasRecordings: boolean;
  recordingsCount: number;
  expiresAt: Date;
  lastRevalidatedAt?: Date;
}) {
  const ficheCache = await prisma.ficheCache.upsert({
    where: { ficheId: data.ficheId },
    create: {
      ficheId: data.ficheId,
      ...(data.groupe !== undefined ? { groupe: data.groupe } : {}),
      ...(data.agenceNom !== undefined ? { agenceNom: data.agenceNom } : {}),
      prospectNom: data.prospectNom,
      prospectPrenom: data.prospectPrenom,
      prospectEmail: data.prospectEmail,
      prospectTel: data.prospectTel,
      salesDate: data.salesDate,
      ...(data.cle !== undefined ? { cle: data.cle } : {}),
      ...(data.detailsSuccess !== undefined ? { detailsSuccess: data.detailsSuccess } : {}),
      ...(data.detailsMessage !== undefined ? { detailsMessage: data.detailsMessage } : {}),
      rawData: data.rawData as import("@prisma/client").Prisma.InputJsonValue,
      hasRecordings: data.hasRecordings,
      recordingsCount: data.recordingsCount,
      expiresAt: data.expiresAt,
      lastRevalidatedAt: data.lastRevalidatedAt,
    },
    update: {
      ...(data.groupe !== undefined ? { groupe: data.groupe } : {}),
      ...(data.agenceNom !== undefined ? { agenceNom: data.agenceNom } : {}),
      prospectNom: data.prospectNom,
      prospectPrenom: data.prospectPrenom,
      prospectEmail: data.prospectEmail,
      prospectTel: data.prospectTel,
      salesDate: data.salesDate,
      ...(data.cle !== undefined ? { cle: data.cle } : {}),
      ...(data.detailsSuccess !== undefined ? { detailsSuccess: data.detailsSuccess } : {}),
      ...(data.detailsMessage !== undefined ? { detailsMessage: data.detailsMessage } : {}),
      rawData: data.rawData as import("@prisma/client").Prisma.InputJsonValue,
      hasRecordings: data.hasRecordings,
      recordingsCount: data.recordingsCount,
      fetchedAt: new Date(),
      expiresAt: data.expiresAt,
      ...(data.lastRevalidatedAt && {
        lastRevalidatedAt: data.lastRevalidatedAt,
      }),
    },
  });

  logger.debug("Fiche cache upserted", {
    fiche_id: data.ficheId,
    cache_id: String(ficheCache.id),
    recordings_count: data.recordingsCount,
    last_revalidated_at: data.lastRevalidatedAt?.toISOString(),
  });

  return ficheCache;
}

export async function upsertFicheCacheInformation(
  ficheCacheId: bigint,
  information: {
    cle: string;
    date_insertion: string;
    createur: string | null;
    fiches_associees: string | null;
    nombre_acces: number;
    dernier_acces: string;
    groupe: string;
    groupe_responsable: string | null;
    groupe_gestion: string | null;
    groupe_reclamation: string | null;
    agence_id: string;
    agence_nom: string;
    attribution_user_id: string;
    attribution_user_nom: string;
    provenance_id: string;
    provenance_nom: string;
    provenance_numero: string | null;
    provenance_periode_rappel: string | null;
    origine_id: string | null;
    origine_nom: string | null;
    attribution_bis_user_id: string | null;
    attribution_bis_user_nom: string | null;
    refus_demarchage: boolean;
    exception_demarchage: boolean;
    exception_demarchage_commentaire: string | null;
    niveau_interet: number | null;
    nombre_ouverture_mails: number;
    derniere_ouverture_mail: string | null;
    nombre_visualisation_pages: number;
    derniere_visualisation_page: string | null;
    espace_prospect_url: string | null;
    ferme_espace_prospect: boolean;
    desinscription_mail: boolean;
    corbeille: boolean;
    archive: boolean;
    modules: string[];
    etiquettes: Array<{ nom: string; date: string; style: string }>;
  }
) {
  const etiquettes = Array.isArray(information.etiquettes) ? information.etiquettes : [];
  const etiquetteRows = etiquettes.map((e, idx) => ({
    ficheCacheId,
    etiquetteIndex: idx + 1,
    nom: e.nom,
    date: e.date,
    style: e.style,
  }));

  // Avoid interactive transactions (pgbouncer/Supabase pooler can trigger P2028).
  await prisma.$transaction([
    prisma.ficheCacheInformation.upsert({
      where: { ficheCacheId },
      create: {
        ficheCacheId,
        cle: information.cle,
        dateInsertion: information.date_insertion,
        createur: information.createur,
        fichesAssociees: information.fiches_associees,
        nombreAcces: Math.trunc(information.nombre_acces),
        dernierAcces: information.dernier_acces,
        groupe: information.groupe,
        groupeResponsable: information.groupe_responsable,
        groupeGestion: information.groupe_gestion,
        groupeReclamation: information.groupe_reclamation,
        agenceId: information.agence_id,
        agenceNom: information.agence_nom,
        attributionUserId: information.attribution_user_id,
        attributionUserNom: information.attribution_user_nom,
        provenanceId: information.provenance_id,
        provenanceNom: information.provenance_nom,
        provenanceNumero: information.provenance_numero,
        provenancePeriodeRappel: information.provenance_periode_rappel,
        origineId: information.origine_id,
        origineNom: information.origine_nom,
        attributionBisUserId: information.attribution_bis_user_id,
        attributionBisUserNom: information.attribution_bis_user_nom,
        refusDemarchage: Boolean(information.refus_demarchage),
        exceptionDemarchage: Boolean(information.exception_demarchage),
        exceptionDemarchageCommentaire: information.exception_demarchage_commentaire,
        niveauInteret:
          typeof information.niveau_interet === "number"
            ? Math.trunc(information.niveau_interet)
            : null,
        nombreOuvertureMails: Math.trunc(information.nombre_ouverture_mails),
        derniereOuvertureMail: information.derniere_ouverture_mail,
        nombreVisualisationPages: Math.trunc(information.nombre_visualisation_pages),
        derniereVisualisationPage: information.derniere_visualisation_page,
        espaceProspectUrl: information.espace_prospect_url,
        fermeEspaceProspect: Boolean(information.ferme_espace_prospect),
        desinscriptionMail: Boolean(information.desinscription_mail),
        corbeille: Boolean(information.corbeille),
        archive: Boolean(information.archive),
        modules: Array.isArray(information.modules) ? information.modules : [],
      },
      update: {
        cle: information.cle,
        dateInsertion: information.date_insertion,
        createur: information.createur,
        fichesAssociees: information.fiches_associees,
        nombreAcces: Math.trunc(information.nombre_acces),
        dernierAcces: information.dernier_acces,
        groupe: information.groupe,
        groupeResponsable: information.groupe_responsable,
        groupeGestion: information.groupe_gestion,
        groupeReclamation: information.groupe_reclamation,
        agenceId: information.agence_id,
        agenceNom: information.agence_nom,
        attributionUserId: information.attribution_user_id,
        attributionUserNom: information.attribution_user_nom,
        provenanceId: information.provenance_id,
        provenanceNom: information.provenance_nom,
        provenanceNumero: information.provenance_numero,
        provenancePeriodeRappel: information.provenance_periode_rappel,
        origineId: information.origine_id,
        origineNom: information.origine_nom,
        attributionBisUserId: information.attribution_bis_user_id,
        attributionBisUserNom: information.attribution_bis_user_nom,
        refusDemarchage: Boolean(information.refus_demarchage),
        exceptionDemarchage: Boolean(information.exception_demarchage),
        exceptionDemarchageCommentaire: information.exception_demarchage_commentaire,
        niveauInteret:
          typeof information.niveau_interet === "number"
            ? Math.trunc(information.niveau_interet)
            : null,
        nombreOuvertureMails: Math.trunc(information.nombre_ouverture_mails),
        derniereOuvertureMail: information.derniere_ouverture_mail,
        nombreVisualisationPages: Math.trunc(information.nombre_visualisation_pages),
        derniereVisualisationPage: information.derniere_visualisation_page,
        espaceProspectUrl: information.espace_prospect_url,
        fermeEspaceProspect: Boolean(information.ferme_espace_prospect),
        desinscriptionMail: Boolean(information.desinscription_mail),
        corbeille: Boolean(information.corbeille),
        archive: Boolean(information.archive),
        modules: Array.isArray(information.modules) ? information.modules : [],
      },
    }),
    prisma.ficheCacheEtiquette.deleteMany({ where: { ficheCacheId } }),
    ...(etiquetteRows.length > 0
      ? [prisma.ficheCacheEtiquette.createMany({ data: etiquetteRows })]
      : []),
  ]);
}

export async function upsertFicheCacheProspect(
  ficheCacheId: bigint,
  prospect:
    | null
    | {
        prospect_id: string;
        civilite: number;
        civilite_text: string;
        nom: string;
        prenom: string;
        date_naissance: string;
        regime: string;
        regime_text: string;
        telephone: string | null;
        mobile: string | null;
        telephone_2: string | null;
        mail: string | null;
        mail_2: string | null;
        adresse: string | null;
        code_postal: string | null;
        ville: string | null;
        num_secu: string | null;
        num_affiliation: string | null;
        situation_familiale: number | null;
        situation_familiale_text: string | null;
        madelin: boolean;
        profession: string | null;
        csp: number | null;
        csp_text: string | null;
        fax: string | null;
      }
) {
  if (!prospect) {
    // Keep it simple: if missing, remove any existing prospect row.
    await prisma.ficheCacheProspect.deleteMany({ where: { ficheCacheId } });
    return;
  }

  await prisma.ficheCacheProspect.upsert({
    where: { ficheCacheId },
    create: {
      ficheCacheId,
      prospectId: prospect.prospect_id,
      civilite: Math.trunc(prospect.civilite),
      civiliteText: prospect.civilite_text,
      nom: prospect.nom,
      prenom: prospect.prenom,
      dateNaissance: prospect.date_naissance,
      regime: prospect.regime,
      regimeText: prospect.regime_text,
      telephone: prospect.telephone,
      mobile: prospect.mobile,
      telephone2: prospect.telephone_2,
      mail: prospect.mail,
      mail2: prospect.mail_2,
      adresse: prospect.adresse,
      codePostal: prospect.code_postal,
      ville: prospect.ville,
      numSecu: prospect.num_secu,
      numAffiliation: prospect.num_affiliation,
      situationFamiliale:
        typeof prospect.situation_familiale === "number"
          ? Math.trunc(prospect.situation_familiale)
          : null,
      situationFamilialeText: prospect.situation_familiale_text,
      madelin: Boolean(prospect.madelin),
      profession: prospect.profession,
      csp: typeof prospect.csp === "number" ? Math.trunc(prospect.csp) : null,
      cspText: prospect.csp_text,
      fax: prospect.fax,
    },
    update: {
      prospectId: prospect.prospect_id,
      civilite: Math.trunc(prospect.civilite),
      civiliteText: prospect.civilite_text,
      nom: prospect.nom,
      prenom: prospect.prenom,
      dateNaissance: prospect.date_naissance,
      regime: prospect.regime,
      regimeText: prospect.regime_text,
      telephone: prospect.telephone,
      mobile: prospect.mobile,
      telephone2: prospect.telephone_2,
      mail: prospect.mail,
      mail2: prospect.mail_2,
      adresse: prospect.adresse,
      codePostal: prospect.code_postal,
      ville: prospect.ville,
      numSecu: prospect.num_secu,
      numAffiliation: prospect.num_affiliation,
      situationFamiliale:
        typeof prospect.situation_familiale === "number"
          ? Math.trunc(prospect.situation_familiale)
          : null,
      situationFamilialeText: prospect.situation_familiale_text,
      madelin: Boolean(prospect.madelin),
      profession: prospect.profession,
      csp: typeof prospect.csp === "number" ? Math.trunc(prospect.csp) : null,
      cspText: prospect.csp_text,
      fax: prospect.fax,
    },
  });
}

export async function replaceFicheCacheDocuments(
  ficheCacheId: bigint,
  documents: Array<{
    document_id: string;
    type: string;
    nom: string;
    taille: string;
    date_creation: string;
    selection_mail: boolean;
    partage_prospect: boolean;
    signer: boolean;
    download_url: string | null;
  }>
) {
  const docs = Array.isArray(documents) ? documents : [];

  await prisma.$transaction([
    prisma.ficheCacheDocument.deleteMany({ where: { ficheCacheId } }),
    ...(docs.length > 0
      ? [
          prisma.ficheCacheDocument.createMany({
            data: docs.map((d, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              documentId: d.document_id,
              type: d.type,
              nom: d.nom,
              taille: d.taille,
              dateCreation: d.date_creation,
              selectionMail: Boolean(d.selection_mail),
              partageProspect: Boolean(d.partage_prospect),
              signer: Boolean(d.signer),
              downloadUrl: d.download_url,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheCommentaires(
  ficheCacheId: bigint,
  commentaires: Array<{
    commentaire_id: string;
    date: string;
    utilisateur: string;
    texte: string;
  }>
) {
  const rows = Array.isArray(commentaires) ? commentaires : [];

  await prisma.$transaction([
    prisma.ficheCacheCommentaire.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheCommentaire.createMany({
            data: rows.map((c, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              commentaireId: c.commentaire_id,
              date: c.date,
              utilisateur: c.utilisateur,
              texte: c.texte,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheMails(
  ficheCacheId: bigint,
  mails: Array<{
    date_envoi: string;
    type_mail: string;
    utilisateur: string;
    visualisation_url: string | null;
  }>
) {
  const rows = Array.isArray(mails) ? mails : [];

  await prisma.$transaction([
    prisma.ficheCacheMail.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheMail.createMany({
            data: rows.map((m, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              dateEnvoi: m.date_envoi,
              typeMail: m.type_mail,
              utilisateur: m.utilisateur,
              visualisationUrl: m.visualisation_url,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheRendezVous(
  ficheCacheId: bigint,
  rendezVous: Array<{
    rdv_id: string;
    etiquette: string | null;
    etiquette_color: string | null;
    utilisateur: string;
    date_debut: string;
    date_fin: string | null;
    commentaire: string | null;
    statut: string | null;
  }>
) {
  const rows = Array.isArray(rendezVous) ? rendezVous : [];

  await prisma.$transaction([
    prisma.ficheCacheRendezVous.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheRendezVous.createMany({
            data: rows.map((r, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              rdvId: r.rdv_id,
              etiquette: r.etiquette,
              etiquetteColor: r.etiquette_color,
              utilisateur: r.utilisateur,
              dateDebut: r.date_debut,
              dateFin: r.date_fin,
              commentaire: r.commentaire,
              statut: r.statut,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheAlertes(
  ficheCacheId: bigint,
  alertes: Array<{
    alerte_id: string;
    etat: string;
    date: string;
    etiquette: string | null;
    libelle: string;
    deposee_le: string;
    deposee_par: string;
    commentaire: string | null;
    attribuee_a: string | null;
    traitee_le: string | null;
    traitee_par: string | null;
    commentaire_traitement: string | null;
  }>
) {
  const rows = Array.isArray(alertes) ? alertes : [];

  await prisma.$transaction([
    prisma.ficheCacheAlerte.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheAlerte.createMany({
            data: rows.map((a, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              alerteId: a.alerte_id,
              etat: a.etat,
              date: a.date,
              etiquette: a.etiquette,
              libelle: a.libelle,
              deposeeLe: a.deposee_le,
              deposeePar: a.deposee_par,
              commentaire: a.commentaire,
              attribueeA: a.attribuee_a,
              traiteeLe: a.traitee_le,
              traiteePar: a.traitee_par,
              commentaireTraitement: a.commentaire_traitement,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheEnfants(
  ficheCacheId: bigint,
  enfants: Array<{
    enfant_id: string;
    civilite: number;
    civilite_text: string;
    nom: string;
    prenom: string;
    date_naissance: string;
    regime: string | null;
    regime_text: string | null;
  }>
) {
  const rows = Array.isArray(enfants) ? enfants : [];

  await prisma.$transaction([
    prisma.ficheCacheEnfant.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheEnfant.createMany({
            data: rows.map((e, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              enfantId: e.enfant_id,
              civilite: Math.trunc(e.civilite),
              civiliteText: e.civilite_text,
              nom: e.nom,
              prenom: e.prenom,
              dateNaissance: e.date_naissance,
              regime: e.regime,
              regimeText: e.regime_text,
            })),
          }),
        ]
      : []),
  ]);
}

export async function upsertFicheCacheConjoint(
  ficheCacheId: bigint,
  conjoint:
    | null
    | {
        conjoint_id: string;
        civilite: number;
        civilite_text: string;
        nom: string;
        prenom: string;
        date_naissance: string;
        regime: string | null;
        regime_text: string | null;
        telephone: string | null;
        mobile: string | null;
        mail: string | null;
        profession: string | null;
        csp: number | null;
        csp_text: string | null;
      }
) {
  await prisma.$transaction([
    prisma.ficheCacheConjoint.deleteMany({ where: { ficheCacheId } }),
    ...(conjoint
      ? [
          prisma.ficheCacheConjoint.create({
            data: {
              ficheCacheId,
              conjointId: conjoint.conjoint_id,
              civilite: Math.trunc(conjoint.civilite),
              civiliteText: conjoint.civilite_text,
              nom: conjoint.nom,
              prenom: conjoint.prenom,
              dateNaissance: conjoint.date_naissance,
              regime: conjoint.regime,
              regimeText: conjoint.regime_text,
              telephone: conjoint.telephone,
              mobile: conjoint.mobile,
              mail: conjoint.mail,
              profession: conjoint.profession,
              csp:
                typeof conjoint.csp === "number" && Number.isFinite(conjoint.csp)
                  ? Math.trunc(conjoint.csp)
                  : null,
              cspText: conjoint.csp_text,
            },
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheReclamations(
  ficheCacheId: bigint,
  reclamations: Array<{
    reclamation_id: string;
    date_creation: string;
    assureur: string | null;
    type_reclamation: string | null;
    description: string | null;
    statut: string | null;
    date_traitement: string | null;
    utilisateur_creation: string | null;
    utilisateur_traitement: string | null;
  }>
) {
  const rows = Array.isArray(reclamations) ? reclamations : [];

  await prisma.$transaction([
    prisma.ficheCacheReclamation.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheReclamation.createMany({
            data: rows.map((r, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              reclamationId: r.reclamation_id,
              dateCreation: r.date_creation,
              assureur: r.assureur,
              typeReclamation: r.type_reclamation,
              description: r.description,
              statut: r.statut,
              dateTraitement: r.date_traitement,
              utilisateurCreation: r.utilisateur_creation,
              utilisateurTraitement: r.utilisateur_traitement,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheAutresContrats(
  ficheCacheId: bigint,
  contrats: Array<{
    contrat_id: string;
    type_contrat: string;
    assureur: string | null;
    numero_contrat: string | null;
    date_souscription: string | null;
    montant: string | null;
    commentaire: string | null;
  }>
) {
  const rows = Array.isArray(contrats) ? contrats : [];

  await prisma.$transaction([
    prisma.ficheCacheAutreContrat.deleteMany({ where: { ficheCacheId } }),
    ...(rows.length > 0
      ? [
          prisma.ficheCacheAutreContrat.createMany({
            data: rows.map((c, idx) => ({
              ficheCacheId,
              rowIndex: idx + 1,
              contratId: c.contrat_id,
              typeContrat: c.type_contrat,
              assureur: c.assureur,
              numeroContrat: c.numero_contrat,
              dateSouscription: c.date_souscription,
              montant: c.montant,
              commentaire: c.commentaire,
            })),
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheRawSections(
  ficheCacheId: bigint,
  rawSections: Record<string, string>
) {
  const entries = Object.entries(rawSections).filter(
    (e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string"
  );

  await prisma.$transaction([
    prisma.ficheCacheRawSection.deleteMany({ where: { ficheCacheId } }),
    ...(entries.length > 0
      ? [
          prisma.ficheCacheRawSection.createMany({
            data: entries.map(([k, v]) => ({
              ficheCacheId,
              sectionKey: k,
              sectionValue: v,
            })),
          }),
        ]
      : []),
  ]);
}

export async function upsertFicheCacheElementsSouscription(
  ficheCacheId: bigint,
  elements:
    | null
    | {
        souscription_id: string | null;
        date_souscription: string | null;
        date_signature: string | null;
        date_validation: string | null;
        num_contrat: string | null;
        annulation_contrat: boolean;
        type_vente: string | null;
        vente_a_froid: string | null;
        vf_accept: string | null;
        ancien_contrat:
          | null
          | {
              deja_assure: boolean;
              plus_12_mois: boolean;
              ria_requested: boolean;
              assureur: string | null;
              code_assureur: string | null;
              adresse: string | null;
              code_postal: string | null;
              ville: string | null;
              date_souscription: string | null;
              date_echeance: string | null;
              num_contrat: string | null;
              formule: string | null;
              cotisation: string | null;
            };
        produit:
          | null
          | {
              date_effet: string | null;
              date_effet_modifiable: string | null;
              formule: string | null;
              groupe_nom: string | null;
              gamme_nom: string | null;
              formule_nom: string | null;
              cotisation: string | null;
              type_contrat: string | null;
              type_client: string | null;
              logo_url: string | null;
              garanties_url: string | null;
              dipa_url: string | null;
              conditions_generales_url: string | null;
              bulletin_adhesion_url: string | null;
              devoir_conseil_url: string | null;
            };
        paiement:
          | null
          | {
              mode_paiement: string | null;
              prelevement_le: string | null;
              periodicite: string | null;
              pas_coord_bancaires: boolean;
              compte_prelevement:
                | null
                | {
                    account_id: string | null;
                    titulaire_nom: string | null;
                    titulaire_prenom: string | null;
                    titulaire_adresse: string | null;
                    titulaire_cp: string | null;
                    titulaire_ville: string | null;
                  };
              compte_virement:
                | null
                | {
                    account_id: string | null;
                    titulaire_nom: string | null;
                    titulaire_prenom: string | null;
                    titulaire_adresse: string | null;
                    titulaire_cp: string | null;
                    titulaire_ville: string | null;
                  };
            };
        questions_complementaires: Record<string, unknown>;
        questions_conseil: Record<string, unknown>;
        raw_data: Record<string, unknown>;
      }
) {
  await prisma.$transaction([
    prisma.ficheCacheElementsSouscription.deleteMany({ where: { ficheCacheId } }),
    ...(elements
      ? [
          prisma.ficheCacheElementsSouscription.create({
            data: {
              ficheCacheId,
              souscriptionId: elements.souscription_id,
              dateSouscription: elements.date_souscription,
              dateSignature: elements.date_signature,
              dateValidation: elements.date_validation,
              numContrat: elements.num_contrat,
              annulationContrat: Boolean(elements.annulation_contrat),
              typeVente: elements.type_vente,
              venteAFroid: elements.vente_a_froid,
              vfAccept: elements.vf_accept,

              ancienDejaAssure: elements.ancien_contrat?.deja_assure ?? null,
              ancienPlus12Mois: elements.ancien_contrat?.plus_12_mois ?? null,
              ancienRiaRequested: elements.ancien_contrat?.ria_requested ?? null,
              ancienAssureur: elements.ancien_contrat?.assureur ?? null,
              ancienCodeAssureur: elements.ancien_contrat?.code_assureur ?? null,
              ancienAdresse: elements.ancien_contrat?.adresse ?? null,
              ancienCodePostal: elements.ancien_contrat?.code_postal ?? null,
              ancienVille: elements.ancien_contrat?.ville ?? null,
              ancienDateSouscription: elements.ancien_contrat?.date_souscription ?? null,
              ancienDateEcheance: elements.ancien_contrat?.date_echeance ?? null,
              ancienNumContrat: elements.ancien_contrat?.num_contrat ?? null,
              ancienFormule: elements.ancien_contrat?.formule ?? null,
              ancienCotisation: elements.ancien_contrat?.cotisation ?? null,

              produitDateEffet: elements.produit?.date_effet ?? null,
              produitDateEffetModifiable: elements.produit?.date_effet_modifiable ?? null,
              produitFormule: elements.produit?.formule ?? null,
              produitGroupeNom: elements.produit?.groupe_nom ?? null,
              produitGammeNom: elements.produit?.gamme_nom ?? null,
              produitFormuleNom: elements.produit?.formule_nom ?? null,
              produitCotisation: elements.produit?.cotisation ?? null,
              produitTypeContrat: elements.produit?.type_contrat ?? null,
              produitTypeClient: elements.produit?.type_client ?? null,
              produitLogoUrl: elements.produit?.logo_url ?? null,
              produitGarantiesUrl: elements.produit?.garanties_url ?? null,
              produitDipaUrl: elements.produit?.dipa_url ?? null,
              produitConditionsGeneralesUrl: elements.produit?.conditions_generales_url ?? null,
              produitBulletinAdhesionUrl: elements.produit?.bulletin_adhesion_url ?? null,
              produitDevoirConseilUrl: elements.produit?.devoir_conseil_url ?? null,
              paiementModePaiement: elements.paiement?.mode_paiement ?? null,
              paiementPrelevementLe: elements.paiement?.prelevement_le ?? null,
              paiementPeriodicite: elements.paiement?.periodicite ?? null,
              paiementPasCoordBancaires: elements.paiement?.pas_coord_bancaires ?? null,

              prelevementAccountId: elements.paiement?.compte_prelevement?.account_id ?? null,
              prelevementTitulaireNom: elements.paiement?.compte_prelevement?.titulaire_nom ?? null,
              prelevementTitulairePrenom:
                elements.paiement?.compte_prelevement?.titulaire_prenom ?? null,
              prelevementTitulaireAdresse:
                elements.paiement?.compte_prelevement?.titulaire_adresse ?? null,
              prelevementTitulaireCp: elements.paiement?.compte_prelevement?.titulaire_cp ?? null,
              prelevementTitulaireVille:
                elements.paiement?.compte_prelevement?.titulaire_ville ?? null,

              virementAccountId: elements.paiement?.compte_virement?.account_id ?? null,
              virementTitulaireNom: elements.paiement?.compte_virement?.titulaire_nom ?? null,
              virementTitulairePrenom:
                elements.paiement?.compte_virement?.titulaire_prenom ?? null,
              virementTitulaireAdresse:
                elements.paiement?.compte_virement?.titulaire_adresse ?? null,
              virementTitulaireCp: elements.paiement?.compte_virement?.titulaire_cp ?? null,
              virementTitulaireVille: elements.paiement?.compte_virement?.titulaire_ville ?? null,

              questionsComplementaires:
                elements.questions_complementaires as import("@prisma/client").Prisma.InputJsonValue,
              questionsConseil:
                elements.questions_conseil as import("@prisma/client").Prisma.InputJsonValue,
              rawData: elements.raw_data as import("@prisma/client").Prisma.InputJsonValue,
            },
          }),
        ]
      : []),
  ]);
}

export async function replaceFicheCacheTarification(
  ficheCacheId: bigint,
  tarification: Array<{
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
  }>
) {
  const rows = Array.isArray(tarification) ? tarification : [];

  const ops: Array<import("@prisma/client").Prisma.PrismaPromise<unknown>> = [
    prisma.ficheCacheTarification.deleteMany({ where: { ficheCacheId } }),
    ...rows.map((t, tarifIndex) =>
      prisma.ficheCacheTarification.create({
        data: {
          ficheCacheId,
          rowIndex: tarifIndex + 1,
          nom: t.nom,
          gammes: {
            create: (Array.isArray(t.gammes) ? t.gammes : []).map((g, gammeIndex) => ({
              rowIndex: gammeIndex + 1,
              nom: g.nom,
              logoUrl: g.logo_url,
              garantiesUrl: g.garanties_url,
              conditionsGeneralesUrl: g.conditions_generales_url,
              bulletinAdhesionUrl: g.bulletin_adhesion_url,
              formules: {
                create: (Array.isArray(g.formules) ? g.formules : []).map(
                  (f, formuleIndex) => ({
                    rowIndex: formuleIndex + 1,
                    formuleId: f.formule_id,
                    nom: f.nom,
                    prix: f.prix,
                    details: {
                      create: Object.entries(f.details ?? {}).map(([k, v]) => ({
                        detailKey: k,
                        detailValue: v,
                      })),
                    },
                  })
                ),
              },
            })),
          },
        },
      })
    ),
  ];

  // Avoid interactive transactions (pgbouncer/Supabase pooler can trigger P2028).
  await prisma.$transaction(ops);
}

export async function upsertFicheCacheMailDevis(
  ficheCacheId: bigint,
  mailDevis: MailDevis | null
) {
  // Avoid interactive transactions (pgbouncer/Supabase pooler can trigger P2028).
  if (!mailDevis) {
    await prisma.ficheCacheMailDevis.deleteMany({ where: { ficheCacheId } });
    return;
  }

  const notes = Array.isArray(mailDevis.garanties_details.notes)
    ? mailDevis.garanties_details.notes
    : [];
  const notesCreate = notes.map((n, idx) => ({
    rowIndex: idx + 1,
    number: n.number,
    text: n.text,
  }));

  const garanties = mailDevis.garanties_details.garanties ?? {};
  const categoriesCreate = Object.entries(garanties).map(([categoryKey, cat]) => {
    const subcategories = cat.subcategories ?? {};
    const subEntries = Object.entries(subcategories);
    const subcategoriesFormat =
      subEntries.length > 0 && subEntries.every(([, v]) => Array.isArray(v)) ? "array" : "named";

    const noteReferences = Array.isArray(cat.note_references) ? cat.note_references : [];
    const categoryItems = Array.isArray(cat.items) ? cat.items : [];

    const subcategoriesCreate = subEntries.map(([subKey, subValue]) => {
      const asArray = subcategoriesFormat === "array";
      const name =
        !asArray && subValue && typeof subValue === "object" && !Array.isArray(subValue)
          ? typeof (subValue as { name?: unknown }).name === "string"
            ? ((subValue as { name: string }).name as string)
            : null
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
      ...(noteReferences.length > 0
        ? {
            noteReferences: {
              create: noteReferences.map((r, idx) => ({
                rowIndex: idx + 1,
                noteReference: r,
              })),
            },
          }
        : {}),
      ...(categoryItems.length > 0
        ? {
            items: {
              create: categoryItems.map((i, idx) => ({
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
  });

  await prisma.$transaction([
    prisma.ficheCacheMailDevis.deleteMany({ where: { ficheCacheId } }),
    prisma.ficheCacheMailDevis.create({
      data: {
        ficheCacheId,

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
  ]);
}

/**
 * Upsert recordings for a fiche
 * Also updates rawData.recordings to keep in sync
 */
export async function upsertRecordings(
  ficheCacheId: bigint,
  recordings: unknown[]
) {
  logger.debug("Storing recordings", {
    fiche_cache_id: String(ficheCacheId),
    count: recordings.length,
  });

  const tasks = recordings.map((rec) =>
    limitRecordingUpsert(async () => {
      const recording = rec as {
        call_id: string;
        recording_url?: string;
        direction?: string;
        answered?: boolean;
        start_time?: string;
        duration_seconds?: number;
        parsed?: {
          date?: string;
          time?: string;
          from_number?: string;
          to_number?: string;
          uuid?: string;
        };
      };

      const parsed = recording.parsed;
      const recordingUrlRaw =
        typeof recording.recording_url === "string" ? recording.recording_url.trim() : "";

      await prisma.recording.upsert({
        where: {
          ficheCacheId_callId: {
            ficheCacheId,
            callId: recording.call_id,
          },
        },
        create: {
          ficheCacheId,
          callId: recording.call_id,
          // `recordingUrl` is non-nullable in DB, but upstream may omit it in sales-list endpoints.
          // Store an empty string on create, but avoid overwriting a non-empty URL on updates.
          recordingUrl: recordingUrlRaw,
          recordingDate: parsed?.date || null,
          recordingTime: parsed?.time || null,
          fromNumber: parsed?.from_number || null,
          toNumber: parsed?.to_number || null,
          uuid: parsed?.uuid || null,
          direction: recording.direction || null,
          answered: recording.answered ?? null,
          startTime: recording.start_time
            ? new Date(recording.start_time)
            : null,
          durationSeconds: recording.duration_seconds ?? null,
          hasTranscription: false,
        },
        update: {
          // IMPORTANT:
          // - Never overwrite a non-empty URL with an empty string (can break transcriptions/audits).
          // - Only update optional fields when the upstream provides a value.
          ...(recordingUrlRaw ? { recordingUrl: recordingUrlRaw } : {}),
          ...(parsed?.date ? { recordingDate: parsed.date } : {}),
          ...(parsed?.time ? { recordingTime: parsed.time } : {}),
          ...(parsed?.from_number ? { fromNumber: parsed.from_number } : {}),
          ...(parsed?.to_number ? { toNumber: parsed.to_number } : {}),
          ...(parsed?.uuid ? { uuid: parsed.uuid } : {}),
          ...(typeof recording.direction === "string" && recording.direction.trim()
            ? { direction: recording.direction }
            : {}),
          ...(typeof recording.answered === "boolean" ? { answered: recording.answered } : {}),
          ...(typeof recording.start_time === "string" && recording.start_time.trim()
            ? { startTime: new Date(recording.start_time) }
            : {}),
          ...(typeof recording.duration_seconds === "number"
            ? { durationSeconds: recording.duration_seconds }
            : {}),
        },
      });
    })
  );

  await Promise.all(tasks);

  logger.debug("Recordings stored", {
    fiche_cache_id: String(ficheCacheId),
    count: recordings.length,
    concurrency: RECORDINGS_UPSERT_CONCURRENCY,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTE: DELETE OPERATIONS REMOVED
// All sales data is permanently stored in the database
// No automatic deletion of cache entries
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the oldest revalidation timestamp in a date range
 * Returns null if no fiches found or none have been revalidated
 */
export async function getOldestRevalidationInRange(
  startDate: Date,
  endDate: Date
): Promise<Date | null> {
  // Convert Date objects to YYYY-MM-DD strings for salesDate comparison
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const result = await prisma.ficheCache.findFirst({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
    },
    orderBy: {
      lastRevalidatedAt: "asc",
    },
    select: {
      lastRevalidatedAt: true,
    },
  });

  return result?.lastRevalidatedAt || null;
}

/**
 * Get the most recent revalidation timestamp in a date range
 * Returns null if no fiches found or none have been revalidated
 */
export async function getLatestRevalidationInRange(
  startDate: Date,
  endDate: Date
): Promise<Date | null> {
  // Convert Date objects to YYYY-MM-DD strings for salesDate comparison
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const result = await prisma.ficheCache.findFirst({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
      lastRevalidatedAt: { not: null },
    },
    orderBy: {
      lastRevalidatedAt: "desc",
    },
    select: {
      lastRevalidatedAt: true,
    },
  });

  return result?.lastRevalidatedAt || null;
}

/**
 * Check which dates in a range have cached data
 * Returns object with dates that have data vs dates missing
 *
 * IMPORTANT: Uses salesDate field to determine which CRM sales date the fiche belongs to
 * IMPORTANT: Takes Date parameters but works with YYYY-MM-DD strings to avoid timezone issues
 */
export async function getDateRangeCoverage(
  startDate: Date | string,
  endDate: Date | string
): Promise<{
  datesWithData: string[];
  datesMissing: string[];
}> {
  // Convert to YYYY-MM-DD strings (handle both Date objects and strings)
  const startDateStr =
    typeof startDate === "string"
      ? startDate
      : startDate.toISOString().split("T")[0];
  const endDateStr =
    typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];

  // Generate all dates in the requested range using string manipulation.
  // Clamp end to today (UTC) so future dates are never queried.
  const allRequestedDates: string[] = [];
  const current = new Date(startDateStr + "T00:00:00.000Z");
  const todayUTC = new Date();
  todayUTC.setUTCHours(23, 59, 59, 999);
  const rawEnd = new Date(endDateStr + "T00:00:00.000Z");
  const end = rawEnd > todayUTC ? todayUTC : rawEnd;

  while (current <= end) {
    allRequestedDates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Get all fiches that have a salesDate in the requested range

  const fiches = await prisma.ficheCache.findMany({
    where: {
      salesDate: {
        gte: startDateStr,
        lte: endDateStr,
      },
    },
    select: {
      salesDate: true,
    },
  });

  // Extract unique sales dates that have data
  const datesWithDataSet = new Set<string>();
  fiches.forEach((fiche) => {
    if (fiche.salesDate) {
      datesWithDataSet.add(fiche.salesDate);
    }
  });

  // Separate into with data vs missing (using allRequestedDates generated above)
  const datesWithData = allRequestedDates.filter((date) =>
    datesWithDataSet.has(date)
  );
  const datesMissing = allRequestedDates.filter(
    (date) => !datesWithDataSet.has(date)
  );

  return {
    datesWithData,
    datesMissing,
  };
}

/**
 * Check if we have cached data for a specific sales date
 * Uses salesDate field to determine which CRM date the fiches belong to
 */
export async function hasDataForDate(date: string): Promise<boolean> {
  const count = await prisma.ficheCache.count({
    where: {
      salesDate: date, // YYYY-MM-DD format
    },
  });

  return count > 0;
}
