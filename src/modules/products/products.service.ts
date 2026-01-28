/**
 * Products Service
 * ================
 * Business logic for insurance products
 */

import { NotFoundError, ValidationError } from "../../shared/errors.js";
import * as productsRepository from "./products.repository.js";
import type {
  CreateFormule,
  CreateGamme,
  CreateGroupe,
  UpdateFormule,
  UpdateGamme,
  UpdateGroupe,
} from "./products.schemas.js";

// ============================================
// Groupes Service
// ============================================

export async function listGroupes() {
  return productsRepository.getAllGroupes();
}

export async function getGroupeDetails(id: bigint) {
  const groupe = await productsRepository.getGroupeById(id);
  if (!groupe) {
    throw new NotFoundError("Groupe", id.toString());
  }
  return groupe;
}

export async function createGroupe(data: CreateGroupe) {
  return productsRepository.createGroupe({
    code: data.code,
    libelle: data.libelle,
  });
}

export async function updateGroupe(id: bigint, data: UpdateGroupe) {
  // Check if groupe exists
  await getGroupeDetails(id);

  return productsRepository.updateGroupe(id, data);
}

export async function deleteGroupe(id: bigint) {
  // Check if groupe exists
  await getGroupeDetails(id);

  return productsRepository.deleteGroupe(id);
}

// ============================================
// Gammes Service
// ============================================

export async function listGammes(options?: {
  groupeId?: bigint;
  page?: number;
  limit?: number;
  search?: string;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const skip = (page - 1) * limit;

  const gammes = await productsRepository.getAllGammes({
    groupeId: options?.groupeId,
    skip,
    take: limit,
    search: options?.search,
  });

  return {
    data: gammes,
    pagination: {
      page,
      limit,
      total: gammes.length,
    },
  };
}

export async function getGammeDetails(id: bigint) {
  const gamme = await productsRepository.getGammeById(id);
  if (!gamme) {
    throw new NotFoundError("Gamme", id.toString());
  }

  const docsFromTable = Array.isArray(gamme.documentsTable)
    ? gamme.documentsTable.reduce<Record<string, string>>((acc, d) => {
        if (d && typeof d.documentType === "string" && typeof d.url === "string") {
          acc[d.documentType] = d.url;
        }
        return acc;
      }, {})
    : {};

  const legacyDocs =
    gamme.documents &&
    typeof gamme.documents === "object" &&
    !Array.isArray(gamme.documents)
      ? (gamme.documents as Record<string, unknown>)
      : null;

  const docs =
    Object.keys(docsFromTable).length > 0
      ? docsFromTable
      : legacyDocs
        ? Object.fromEntries(
            Object.entries(legacyDocs).filter(
              (e): e is [string, string] =>
                typeof e[0] === "string" &&
                typeof e[1] === "string" &&
                e[1].trim().length > 0
            )
          )
        : {};

  return { ...gamme, documents: docs };
}

export async function createGamme(data: CreateGamme) {
  // Verify groupe exists
  const groupe = await productsRepository.getGroupeById(data.groupeId);
  if (!groupe) {
    throw new NotFoundError("Groupe", data.groupeId.toString());
  }

  const docs = data.documents || {};
  const gamme = await productsRepository.createGamme({
    groupe: {
      connect: { id: data.groupeId },
    },
    code: data.code,
    libelle: data.libelle,
    // Reduce JSON storage: keep legacy JSON minimal; canonical docs live in `documents` table.
    documents: {},
  });

  await productsRepository.replaceGammeDocuments(gamme.id, docs);

  return { ...gamme, documents: docs };
}

export async function updateGamme(id: bigint, data: UpdateGamme) {
  // Check if gamme exists
  await getGammeDetails(id);

  const { documents, ...rest } = data;

  const gamme = await productsRepository.updateGamme(id, {
    ...rest,
    ...(documents !== undefined ? { documents: {} } : {}),
  });

  if (documents !== undefined) {
    await productsRepository.replaceGammeDocuments(id, documents);
    return { ...gamme, documents };
  }

  return gamme;
}

export async function deleteGamme(id: bigint) {
  // Check if gamme exists
  await getGammeDetails(id);

  return productsRepository.deleteGamme(id);
}

// ============================================
// Formules Service
// ============================================

export async function listFormules(options?: {
  gammeId?: bigint;
  page?: number;
  limit?: number;
  search?: string;
}) {
  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const skip = (page - 1) * limit;

  const formules = await productsRepository.getAllFormules({
    gammeId: options?.gammeId,
    skip,
    take: limit,
    search: options?.search,
  });

  return {
    data: formules,
    pagination: {
      page,
      limit,
      total: formules.length,
    },
  };
}

export async function getFormuleDetails(id: bigint) {
  const formule = await productsRepository.getFormuleById(id);
  if (!formule) {
    throw new NotFoundError("Formule", id.toString());
  }
  return formule;
}

export async function createFormule(data: CreateFormule) {
  // Verify gamme exists
  const gamme = await productsRepository.getGammeById(data.gammeId);
  if (!gamme) {
    throw new NotFoundError("Gamme", data.gammeId.toString());
  }

  return productsRepository.createFormule({
    gamme: {
      connect: { id: data.gammeId },
    },
    code: data.code,
    libelle: data.libelle,
    libelleAlternatif: data.libelleAlternatif || null,
    hospitalisation: data.hospitalisation || null,
    hospiNonOptam: data.hospiNonOptam || null,
    dentaire: data.dentaire || null,
    optique: data.optique || null,
    optiqueVc: data.optiqueVc || null,
    medecines: data.medecines || null,
    soinsNonOptam: data.soinsNonOptam || null,
    chambreParticuliere: data.chambreParticuliere || null,
    medecineDouce: data.medecineDouce || null,
    appareilsAuditifs: data.appareilsAuditifs || null,
    maternite: data.maternite || null,
    cureThermale: data.cureThermale || null,
    fraisDossier: data.fraisDossier || null,
    delaiAttente: data.delaiAttente || null,
    garantiesHtml: data.garantiesHtml,
  });
}

export async function updateFormule(id: bigint, data: UpdateFormule) {
  // Check if formule exists
  await getFormuleDetails(id);

  return productsRepository.updateFormule(id, data);
}

export async function deleteFormule(id: bigint) {
  // Check if formule exists
  await getFormuleDetails(id);

  return productsRepository.deleteFormule(id);
}

// ============================================
// Search & Stats Service
// ============================================

export async function searchProducts(query: string) {
  if (!query || query.trim().length < 2) {
    throw new ValidationError("Search query must be at least 2 characters");
  }

  return productsRepository.searchProducts(query.trim());
}

export async function getStats() {
  return productsRepository.getProductStats();
}

// ============================================
// Product Matching Service
// ============================================

export async function linkFicheToProduct(ficheId: string) {
  // Import dynamically to avoid circular dependency
  const { getFicheWithCache } = await import("../fiches/fiches.cache.js");

  // Fetch fiche data
  const ficheData = await getFicheWithCache(ficheId);

  // Extract product information from elements_souscription
  const productInfo = ficheData.elements_souscription?.produit;

  if (!productInfo) {
    throw new NotFoundError("Product information for fiche", ficheId);
  }

  const { groupe_nom, gamme_nom, formule_nom } = productInfo;

  if (!groupe_nom || !gamme_nom || !formule_nom) {
    throw new ValidationError(
      `Incomplete product information in fiche ${ficheId}: ` +
        `groupe_nom=${groupe_nom}, gamme_nom=${gamme_nom}, formule_nom=${formule_nom}`
    );
  }

  // Extract client needs/requirements from questions_conseil
  const clientNeeds = ficheData.elements_souscription?.questions_conseil ?? null;

  // Extract fiche product data (what was sold)
  const ficheProductData = {
    formule: productInfo.formule,
    cotisation: productInfo.cotisation,
    date_effet: productInfo.date_effet,
    type_client: productInfo.type_client,
    type_contrat: productInfo.type_contrat,
    garanties_url: productInfo.garanties_url,
    cg_url: productInfo.conditions_generales_url,
    dipa_url: productInfo.dipa_url,
  };

  // Search for matching formule
  const matchedFormule = await productsRepository.findFormuleByNames({
    groupeName: groupe_nom,
    gammeName: gamme_nom,
    formuleName: formule_nom,
  });

  if (!matchedFormule) {
    // Return search info even if no match found
    return {
      ficheId,
      searchCriteria: {
        groupe_nom,
        gamme_nom,
        formule_nom,
      },
      matched: false,
      formule: null,
      ficheProductData,
      clientNeeds,
      message: `No matching formule found for: ${groupe_nom} > ${gamme_nom} > ${formule_nom}`,
    };
  }

  // Return matched formule with ALL context
  return {
    ficheId,
    searchCriteria: {
      groupe_nom,
      gamme_nom,
      formule_nom,
    },
    matched: true,
    formule: matchedFormule,
    ficheProductData, // What was sold to the client
    clientNeeds, // Client's expressed needs and requirements
  };
}
