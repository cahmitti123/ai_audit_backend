/**
 * Insurance Products - Detailed Type Definitions
 * ===============================================
 * Complete type definitions with field-level documentation
 */

// ============================================
// BASE RESPONSE WRAPPER
// ============================================

/**
 * Standard API Success Response
 * All successful endpoints return this structure
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/**
 * Standard API Error Response
 * All failed requests return this structure
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ============================================
// PAGINATION
// ============================================

export interface PaginationMeta {
  page: number; // Current page number (1-based)
  limit: number; // Items per page (max 100)
  total: number; // Total items in current response
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ============================================
// CORE ENTITIES
// ============================================

/**
 * GROUPE (Insurance Group/Company)
 * ---------------------------------
 * Top-level insurance company (e.g., ALPTIS, APIVIA, NEOLIANE)
 *
 * Database: groupes table
 * Total Records: 17
 */
export interface Groupe {
  id: string; // BigInt ID as string (e.g., "1")
  code: string; // Company code, 2 chars (e.g., "11" for ALPTIS)
  libelle: string; // Company name, max 17 chars (e.g., "ALPTIS")
  createdAt: string; // ISO 8601 timestamp (e.g., "2025-11-24T15:30:58.081Z")
  updatedAt: string; // ISO 8601 timestamp
  _counts?: {
    gammes?: number; // Count of gammes in this groupe (only in list responses)
  };
}

/**
 * GAMME (Product Line)
 * --------------------
 * Product line within an insurance group (e.g., "Santé Protect", "VITAMIN3")
 *
 * Database: gammes table
 * Total Records: 101
 * Relationship: Many gammes belong to one groupe
 */
export interface Gamme {
  id: string; // BigInt ID as string (e.g., "5")
  groupeId: string; // Foreign key to parent Groupe
  code: string; // Gamme code, 3 chars (e.g., "373")
  libelle: string; // Gamme name, max 29 chars (e.g., "Santé Protect")
  documents: {
    // JSONB field with document URLs
    cg?: string; // Conditions Générales PDF URL
    garanties?: string; // Garanties PDF URL
    garanties_html?: string; // Garanties HTML page URL
    dipa?: string; // DIPA document URL
    logo?: string; // Logo image URL
  };
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

/**
 * FORMULE (Specific Insurance Plan)
 * ----------------------------------
 * Individual insurance plan/formula with detailed coverage information
 *
 * Database: formules table
 * Total Records: 1,445
 * Relationship: Many formules belong to one gamme
 */
export interface Formule {
  id: string; // BigInt ID as string
  gammeId: string; // Foreign key to parent Gamme
  code: string; // Formule code, 4 chars (e.g., "4689")
  libelle: string; // Formule name, max 14 chars (e.g., "N1", "V2-H")
  libelleAlternatif: string | null; // Alternative label, max 13 chars

  // COVERAGE DETAILS (all nullable, max lengths specified)
  // These are coverage values/percentages as strings

  hospitalisation: string | null; // Hospitalization coverage (max 46 chars) - e.g., "100%", "Frais Réels"
  hospiNonOptam: string | null; // Non-OPTAM hospitalization (max 4 chars) - e.g., "100%"
  dentaire: string | null; // Dental coverage (max 50 chars) - e.g., "100%", "150€"
  optique: string | null; // Optical coverage (max 50 chars) - e.g., "150€", "200€"
  optiqueVc: string | null; // Optical VC coverage (max 43 chars)
  medecines: string | null; // Medicine coverage (max 50 chars) - e.g., "100%"
  soinsNonOptam: string | null; // Non-OPTAM care (max 12 chars) - e.g., "100%"
  chambreParticuliere: string | null; // Private room (max 47 chars) - e.g., "60€/jour"
  medecineDouce: string | null; // Alternative medicine (max 40 chars) - e.g., "50€"
  appareilsAuditifs: string | null; // Hearing aids (max 46 chars) - e.g., "100%"
  maternite: string | null; // Maternity (max 48 chars) - e.g., "100%"
  cureThermale: string | null; // Thermal spa treatment (max 42 chars)
  fraisDossier: string | null; // File fees (max 13 chars) - e.g., "11 €", "0 €"
  delaiAttente: string | null; // Waiting period (max 50 chars) - e.g., "3 mois"

  garantiesHtml: string; // URL to garanties HTML page (max 87 chars)
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

/**
 * DOCUMENT
 * --------
 * Document URL associated with a gamme or formule
 *
 * Database: documents table
 * Total Records: 436
 * Relationship: Many documents can belong to one gamme OR one formule (mutually exclusive)
 */
export interface Document {
  id: string; // BigInt ID as string
  gammeId: string | null; // Foreign key to Gamme (NULL if belongs to formule)
  formuleId: string | null; // Foreign key to Formule (NULL if belongs to gamme)
  documentType: string; // Type: "cg" | "garanties" | "garanties_html" | "dipa" | "logo"
  url: string; // Full document URL
  createdAt: string; // ISO 8601 timestamp
}

/**
 * GARANTIE_PARSED
 * ---------------
 * Parsed HTML guarantee data from garanties_html pages
 *
 * Database: garanties_parsed table
 * Total Records: 1,405
 * Relationship: Belongs to one gamme OR one formule (mutually exclusive)
 */
export interface GarantieParsed {
  id: string; // BigInt ID as string
  gammeId: string | null; // Foreign key to Gamme (NULL if belongs to formule)
  formuleId: string | null; // Foreign key to Formule (NULL if belongs to gamme)
  title: string | null; // Guarantee title (max 255 chars) - e.g., "SANTE N"
  introText: string[]; // Array of introductory text paragraphs
  formuleIndicator: string | null; // Formule indicator (max 50 chars) - e.g., "N1", "V2"
  notesAndLegal: string | null; // Notes and legal text (unlimited)
  createdAt: string; // ISO 8601 timestamp
}

/**
 * GARANTIE_CATEGORY
 * -----------------
 * Category/section within parsed guarantees (e.g., "HOSPITALISATION", "SOINS COURANTS")
 *
 * Database: garantie_categories table
 * Total Records: 10,103
 * Relationship: Many categories belong to one garantie_parsed
 */
export interface GarantieCategory {
  id: string; // BigInt ID as string
  garantieParsedId: string; // Foreign key to parent GarantieParsed
  sectionIndex: number; // Which table/section (0-6) in the HTML
  categoryName: string; // Category name (e.g., "HOSPITALISATION médicale, chirurgicale...")
  displayOrder: number; // Display order within the garantie (0-based)
  createdAt: string; // ISO 8601 timestamp
}

/**
 * GARANTIE_ITEM
 * -------------
 * Individual guarantee detail line item
 *
 * Database: garantie_items table
 * Total Records: 68,844
 * Relationship: Many items belong to one category
 */
export interface GarantieItem {
  id: string; // BigInt ID as string
  categoryId: string; // Foreign key to parent GarantieCategory
  guaranteeName: string; // Guarantee name (e.g., "Frais de séjour en secteur conventionné")
  guaranteeValue: string; // Coverage value (e.g., "Frais Réels", "100% BRSS", "150€")
  displayOrder: number; // Display order within category (0-based)
  createdAt: string; // ISO 8601 timestamp
}

// ============================================
// NESTED RESPONSE TYPES
// (What you get from API endpoints)
// ============================================

/**
 * GarantieCategory WITH Items
 * When fetching garanties, categories include their items
 */
export interface GarantieCategoryWithItems extends GarantieCategory {
  items: GarantieItem[];
}

/**
 * GarantieParsed WITH Categories and Items
 * Full guarantee structure with complete nesting
 */
export interface GarantieParsedWithDetails extends GarantieParsed {
  categories: GarantieCategoryWithItems[];
}

/**
 * Gamme WITH Groupe
 * Product line with parent company info
 */
export interface GammeWithGroupe extends Gamme {
  groupe: Groupe;
}

/**
 * Formule WITH Gamme and Groupe
 * Plan with full parent hierarchy
 */
export interface FormuleWithRelations extends Formule {
  gamme: GammeWithGroupe;
  _counts?: {
    garanties?: number;
    documents?: number;
  };
}

/**
 * Formule WITH Complete Details
 * Full formule with ALL related data
 * THIS IS THE MOST COMPLETE FORMULE RESPONSE
 */
export interface FormuleWithDetails extends Formule {
  gamme: GammeWithGroupe; // Includes groupe
  garantiesParsed: GarantieParsedWithDetails[]; // All guarantees with categories and items
  documents: Document[]; // All associated documents
  _counts: {
    garanties: number; // Total garanties parsed
    categories: number; // Total categories across all garanties
    items: number; // Total items across all categories
    documents: number; // Total documents
  };
}

/**
 * Gamme WITH Formules
 * Product line with all its plans (without guarantee details)
 */
export interface GammeWithFormules extends Gamme {
  groupe: Groupe;
  formules: Formule[]; // Basic formule info only
  documentsTable: Document[]; // Documents for this gamme
  _counts: {
    formules: number; // Count of formules in this gamme
    documents: number; // Count of documents for this gamme
  };
}

/**
 * Gamme WITH Complete Details
 * Product line with ALL formules including their full guarantee structures
 * THIS IS THE MOST COMPLETE GAMME RESPONSE
 */
export interface GammeWithDetails extends Gamme {
  groupe: Groupe;
  formules: FormuleWithDetails[]; // Complete formules with guarantees
  documentsTable: Document[]; // Documents for this gamme
  _counts: {
    formules: number; // Total formules in this gamme
    documents: number; // Total documents for this gamme
    garanties: number; // Total garanties across all formules
    categories: number; // Total categories across all garanties
    items: number; // Total items across all categories
  };
}

/**
 * Groupe WITH Gammes
 * Insurance group with all product lines and formules
 * THIS IS THE MOST COMPLETE GROUPE RESPONSE
 */
export interface GroupeWithGammes extends Groupe {
  gammes: GammeWithFormules[];
  _counts: {
    gammes: number; // Total gammes in this groupe
    formules: number; // Total formules across all gammes
  };
}

// ============================================
// STATISTICS
// ============================================

/**
 * Product Statistics
 * GET /api/products/stats
 */
export interface ProductStats {
  groupes: number; // Total insurance groups (17)
  gammes: number; // Total product lines (101)
  formules: number; // Total formulas/plans (1,445)
  garanties: number; // Total parsed guarantees (1,405)
}

// ============================================
// SEARCH RESULTS
// ============================================

/**
 * Search Results
 * GET /api/products/search?q={query}
 * Returns matching records across all product types
 */
export interface SearchResults {
  groupes: Groupe[]; // Matching insurance groups
  gammes: GammeWithGroupe[]; // Matching product lines (with parent groupe)
  formules: FormuleWithRelations[]; // Matching formules (with gamme and groupe)
}

// ============================================
// ENDPOINT-SPECIFIC RESPONSE TYPES
// ============================================

/**
 * GET /api/products/stats
 * Returns: Statistics about all products
 */
export type StatsResponse = ApiResponse<ProductStats>;

/**
 * GET /api/products/search?q={query}
 * Returns: Search results across all product types
 */
export type SearchResponse = ApiResponse<SearchResults>;

/**
 * GET /api/products/groupes
 * Returns: Array of all insurance groups (17 total)
 */
export type GroupesListResponse = ApiResponse<Groupe[]>;

/**
 * GET /api/products/groupes/:id
 * Returns: Single groupe with all gammes and formules
 */
export type GroupeDetailResponse = ApiResponse<GroupeWithGammes>;

/**
 * GET /api/products/gammes?page=1&limit=20&groupeId={id}&search={term}
 * Returns: Paginated list of gammes with parent groupe info
 */
export type GammesListResponse = ApiResponse<
  PaginatedResponse<GammeWithGroupe>
>;

/**
 * GET /api/products/gammes/:id
 * Returns: Single gamme with all formules (including complete guarantee details)
 */
export type GammeDetailResponse = ApiResponse<GammeWithDetails>;

/**
 * GET /api/products/formules?page=1&limit=20&gammeId={id}&search={term}
 * Returns: Paginated list of formules with gamme and groupe hierarchy
 */
export type FormulesListResponse = ApiResponse<
  PaginatedResponse<FormuleWithRelations>
>;

/**
 * GET /api/products/formules/:id
 * Returns: Single formule with COMPLETE details (guarantees, categories, items, documents)
 */
export type FormuleDetailResponse = ApiResponse<FormuleWithDetails>;

/**
 * POST /api/products/groupes
 * POST /api/products/gammes
 * POST /api/products/formules
 * Returns: Created entity (same structure as detail responses)
 */
export type CreateGroupeResponse = ApiResponse<Groupe>;
export type CreateGammeResponse = ApiResponse<GammeWithGroupe>;
export type CreateFormuleResponse = ApiResponse<FormuleWithRelations>;

/**
 * PUT /api/products/groupes/:id
 * PUT /api/products/gammes/:id
 * PUT /api/products/formules/:id
 * Returns: Updated entity (same structure as detail responses)
 */
export type UpdateGroupeResponse = ApiResponse<Groupe>;
export type UpdateGammeResponse = ApiResponse<GammeWithGroupe>;
export type UpdateFormuleResponse = ApiResponse<FormuleWithRelations>;

/**
 * DELETE /api/products/groupes/:id
 * DELETE /api/products/gammes/:id
 * DELETE /api/products/formules/:id
 * Returns: Success message
 */
export type DeleteResponse = ApiResponse<{ message: string }>;

// ============================================
// REAL EXAMPLE RESPONSES
// ============================================

/**
 * EXAMPLE 1: GET /api/products/stats
 * -----------------------------------
 */
export const EXAMPLE_STATS_RESPONSE: StatsResponse = {
  success: true,
  data: {
    groupes: 17,
    gammes: 101,
    formules: 1445,
    garanties: 1405,
  },
};

/**
 * EXAMPLE 2: GET /api/products/groupes
 * -------------------------------------
 * Returns all 17 insurance groups
 */
export const EXAMPLE_GROUPES_RESPONSE: GroupesListResponse = {
  success: true,
  data: [
    {
      id: "1",
      code: "11",
      libelle: "ALPTIS",
      createdAt: "2025-11-24T15:30:58.081Z",
      updatedAt: "2025-11-24T15:30:58.081Z",
    },
    {
      id: "2",
      code: "1",
      libelle: "APIVIA",
      createdAt: "2025-11-24T15:30:58.081Z",
      updatedAt: "2025-11-24T15:30:58.081Z",
    },
    // ... 15 more groups
  ],
};

/**
 * EXAMPLE 3: GET /api/products/formules?limit=1
 * ----------------------------------------------
 * Paginated formules with parent hierarchy
 */
export const EXAMPLE_FORMULES_LIST_RESPONSE: FormulesListResponse = {
  success: true,
  data: {
    data: [
      {
        id: "1",
        gammeId: "5",
        code: "4689",
        libelle: "N1",
        libelleAlternatif: "N1",
        hospitalisation: "100%",
        hospiNonOptam: "100%",
        dentaire: "100%",
        optique: "",
        optiqueVc: "",
        medecines: "100%",
        soinsNonOptam: "100%",
        chambreParticuliere: "",
        medecineDouce: "",
        appareilsAuditifs: "100%",
        maternite: "",
        cureThermale: "",
        fraisDossier: "11 €",
        delaiAttente: "",
        garantiesHtml:
          "https://www.gestfiches.com/documents/alptis/sante-protect/n1.php",
        createdAt: "2025-11-24T15:30:58.081Z",
        updatedAt: "2025-11-24T15:30:58.081Z",
        gamme: {
          id: "5",
          groupeId: "1",
          code: "373",
          libelle: "Santé Protect",
          documents: {
            cg: "https://www.gestfiches.com/documents/alptis/sante-protect/cg.pdf",
            garanties:
              "https://www.gestfiches.com/documents/alptis/sante-protect/garanties.pdf",
            garanties_html:
              "https://www.gestfiches.com/documents/alptis/sante-protect/sante-protect.php",
            dipa: "https://www.gestfiches.com/documents/alptis/sante-protect/dipa.pdf",
            logo: "https://www.gestfiches.com/documents/alptis/sante-protect/sante-protect.gif",
          },
          createdAt: "2025-11-24T15:30:58.081Z",
          updatedAt: "2025-11-24T15:30:58.081Z",
          groupe: {
            id: "1",
            code: "11",
            libelle: "ALPTIS",
            createdAt: "2025-11-24T15:30:58.081Z",
            updatedAt: "2025-11-24T15:30:58.081Z",
          },
        },
      },
    ],
    pagination: {
      page: 1,
      limit: 1,
      total: 1,
    },
  },
};

/**
 * EXAMPLE 4: GET /api/products/formules/:id
 * ------------------------------------------
 * Complete formule with ALL guarantee details
 */
export const EXAMPLE_FORMULE_DETAIL_RESPONSE: FormuleDetailResponse = {
  success: true,
  data: {
    id: "1",
    gammeId: "5",
    code: "4689",
    libelle: "N1",
    libelleAlternatif: "N1",
    hospitalisation: "100%",
    hospiNonOptam: "100%",
    dentaire: "100%",
    optique: "",
    optiqueVc: "",
    medecines: "100%",
    soinsNonOptam: "100%",
    chambreParticuliere: "",
    medecineDouce: "",
    appareilsAuditifs: "100%",
    maternite: "",
    cureThermale: "",
    fraisDossier: "11 €",
    delaiAttente: "",
    garantiesHtml:
      "https://www.gestfiches.com/documents/alptis/sante-protect/n1.php",
    createdAt: "2025-11-24T15:30:58.081Z",
    updatedAt: "2025-11-24T15:30:58.081Z",
    gamme: {
      id: "5",
      groupeId: "1",
      code: "373",
      libelle: "Santé Protect",
      documents: {
        cg: "https://www.gestfiches.com/documents/alptis/sante-protect/cg.pdf",
      },
      createdAt: "2025-11-24T15:30:58.081Z",
      updatedAt: "2025-11-24T15:30:58.081Z",
      groupe: {
        id: "1",
        code: "11",
        libelle: "ALPTIS",
        createdAt: "2025-11-24T15:30:58.081Z",
        updatedAt: "2025-11-24T15:30:58.081Z",
      },
    },
    garantiesParsed: [
      {
        id: "1",
        gammeId: null,
        formuleId: "1",
        title: "SANTE N",
        introText: [],
        formuleIndicator: "N1",
        notesAndLegal: null,
        createdAt: "2025-11-24T15:30:58.081Z",
        categories: [
          {
            id: "1",
            garantieParsedId: "1",
            sectionIndex: 0,
            categoryName:
              "HOSPITALISATION médicale, chirurgicale, à domicile, maternité",
            displayOrder: 0,
            createdAt: "2025-11-24T15:30:58.081Z",
            items: [
              {
                id: "1",
                categoryId: "1",
                guaranteeName: "Frais de séjour en secteur conventionné",
                guaranteeValue: "Frais Réels",
                displayOrder: 0,
                createdAt: "2025-11-24T15:30:58.081Z",
              },
              {
                id: "2",
                categoryId: "1",
                guaranteeName: "Forfait journalier hospitalier",
                guaranteeValue: "Frais Réels",
                displayOrder: 1,
                createdAt: "2025-11-24T15:30:58.081Z",
              },
              {
                id: "3",
                categoryId: "1",
                guaranteeName: "Chambre particulière",
                guaranteeValue: "-",
                displayOrder: 2,
                createdAt: "2025-11-24T15:30:58.081Z",
              },
              // ... more items
            ],
          },
          // ... more categories
        ],
      },
    ],
    documents: [
      {
        id: "1",
        gammeId: null,
        formuleId: "1",
        documentType: "garanties",
        url: "https://www.gestfiches.com/documents/alptis/sante-protect/garanties.pdf",
        createdAt: "2025-11-24T15:30:58.081Z",
      },
    ],
  },
};

/**
 * EXAMPLE 5: GET /api/products/search?q=alptis
 * ---------------------------------------------
 */
export const EXAMPLE_SEARCH_RESPONSE: SearchResponse = {
  success: true,
  data: {
    groupes: [
      {
        id: "1",
        code: "11",
        libelle: "ALPTIS",
        createdAt: "2025-11-24T15:30:58.081Z",
        updatedAt: "2025-11-24T15:30:58.081Z",
      },
    ],
    gammes: [
      {
        id: "5",
        groupeId: "1",
        code: "373",
        libelle: "Santé Protect",
        documents: {},
        createdAt: "2025-11-24T15:30:58.081Z",
        updatedAt: "2025-11-24T15:30:58.081Z",
        groupe: {
          id: "1",
          code: "11",
          libelle: "ALPTIS",
          createdAt: "2025-11-24T15:30:58.081Z",
          updatedAt: "2025-11-24T15:30:58.081Z",
        },
      },
    ],
    formules: [
      // ... formules from ALPTIS
    ],
  },
};

/**
 * EXAMPLE 6: Error Response
 * --------------------------
 * All failed requests return this structure
 */
export const EXAMPLE_ERROR_RESPONSE: ApiErrorResponse = {
  success: false,
  error: "Formule with ID 99999 not found",
};

// ============================================
// DATA HIERARCHY SUMMARY
// ============================================

/**
 * COMPLETE DATA STRUCTURE
 * ========================
 *
 * Groupe (Insurance Company)
 *   ├─ id: "1"
 *   ├─ code: "11"
 *   ├─ libelle: "ALPTIS"
 *   └─ gammes[] (Product Lines)
 *        ├─ id: "5"
 *        ├─ code: "373"
 *        ├─ libelle: "Santé Protect"
 *        ├─ documents: { cg: "...", garanties: "...", dipa: "..." }
 *        ├─ documentsTable[] (Document records)
 *        │    ├─ documentType: "cg"
 *        │    └─ url: "https://..."
 *        └─ formules[] (Insurance Plans)
 *             ├─ id: "1"
 *             ├─ code: "4689"
 *             ├─ libelle: "N1"
 *             ├─ hospitalisation: "100%"
 *             ├─ dentaire: "100%"
 *             ├─ garantiesParsed[] (Parsed Guarantees)
 *             │    ├─ title: "SANTE N"
 *             │    ├─ introText: []
 *             │    └─ categories[] (Guarantee Categories)
 *             │         ├─ categoryName: "HOSPITALISATION"
 *             │         ├─ sectionIndex: 0
 *             │         └─ items[] (Individual Guarantees)
 *             │              ├─ guaranteeName: "Frais de séjour"
 *             │              └─ guaranteeValue: "Frais Réels"
 *             └─ documents[] (Document records)
 *                  ├─ documentType: "garanties"
 *                  └─ url: "https://..."
 */

// ============================================
// FIELD VALUE EXAMPLES
// ============================================

/**
 * COMMON VALUES IN DATABASE
 * --------------------------
 *
 * Groupe Codes (2 chars):
 *   "11" = ALPTIS
 *   "1"  = APIVIA
 *   "6"  = APRIL
 *   "4"  = NEOLIANE
 *   etc.
 *
 * Gamme Codes (3 chars):
 *   "373" = Santé Protect (ALPTIS)
 *   "350" = VITAMIN3 (APIVIA)
 *   "351" = VITAMIN3 Hospi (APIVIA)
 *   etc.
 *
 * Formule Codes (4 chars):
 *   "4689" = N1 (ALPTIS Santé Protect)
 *   "4690" = N2 (ALPTIS Santé Protect)
 *   "4022" = V1 (APIVIA VITAMIN3)
 *   etc.
 *
 * Coverage Value Examples:
 *   "100%"           - Full coverage
 *   "Frais Réels"    - Actual costs covered
 *   "100% BRSS"      - 100% of Base de Remboursement Sécurité Sociale
 *   "150€"           - Fixed euro amount
 *   "60€/jour"       - Per day amount
 *   "-"              - Not covered
 *   ""               - Empty/not applicable
 *
 * Document Types:
 *   "cg"             - Conditions Générales (General Conditions PDF)
 *   "garanties"      - Garanties document (PDF)
 *   "garanties_html" - Garanties HTML page
 *   "dipa"           - Document d'Information Produit Assurance
 *   "logo"           - Company/product logo (GIF/PNG)
 */

// ============================================
// FICHE-PRODUCT LINKING
// ============================================

/**
 * Fiche to Product Link Result
 * GET /api/products/link-fiche/:ficheId
 * Links a sale (fiche) to its corresponding product formule
 */
export interface FicheProductLink {
  ficheId: string;
  searchCriteria: {
    groupe_nom: string; // From fiche: "KIASSURE"
    gamme_nom: string; // From fiche: "Silver Santé"
    formule_nom: string; // From fiche: "S1"
  };
  matched: boolean; // true if formule found, false otherwise
  formule: FormuleWithDetails | null; // Matched formule with complete details
  message?: string; // Error/info message if not matched
}

/**
 * GET /api/products/link-fiche/:ficheId
 * Returns: Fiche linked to product formule
 */
export type FicheProductLinkResponse = ApiResponse<FicheProductLink>;

// ============================================
// TYPE GUARDS
// ============================================

export function isSuccessResponse<T>(
  response: ApiResponse<T>
): response is ApiSuccessResponse<T> {
  return response.success === true;
}

export function isErrorResponse<T>(
  response: ApiResponse<T>
): response is ApiErrorResponse {
  return response.success === false;
}
