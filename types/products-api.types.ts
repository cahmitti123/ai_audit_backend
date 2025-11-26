/**
 * Insurance Products API - TypeScript Types for Frontend
 * =======================================================
 * Complete type definitions for all API responses
 */

// ============================================
// Base Response Types
// ============================================

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ============================================
// Pagination Types
// ============================================

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ============================================
// Core Entity Types
// ============================================

/**
 * Groupe (Insurance Group/Company)
 * Basic insurance company information
 */
export interface Groupe {
  id: string; // BigInt serialized as string
  code: string; // 2 characters (e.g., "11")
  libelle: string; // Name (e.g., "ALPTIS")
  createdAt: string; // ISO 8601 datetime
  updatedAt: string; // ISO 8601 datetime
}

/**
 * Gamme (Product Line)
 * Product line within an insurance group
 */
export interface Gamme {
  id: string; // BigInt serialized as string
  groupeId: string; // Foreign key to Groupe
  code: string; // 3 characters (e.g., "373")
  libelle: string; // Name (e.g., "Santé Protect")
  documents: Record<string, string>; // Document URLs { cg: "...", garanties: "...", etc }
  createdAt: string; // ISO 8601 datetime
  updatedAt: string; // ISO 8601 datetime
}

/**
 * Formule (Specific Insurance Plan)
 * Individual insurance plan/formula with coverage details
 */
export interface Formule {
  id: string; // BigInt serialized as string
  gammeId: string; // Foreign key to Gamme
  code: string; // 4 characters (e.g., "4689")
  libelle: string; // Name (e.g., "N1")
  libelleAlternatif: string | null; // Alternative label

  // Coverage details (all optional)
  hospitalisation: string | null; // e.g., "100%"
  hospiNonOptam: string | null; // e.g., "100%"
  dentaire: string | null; // e.g., "100%"
  optique: string | null; // e.g., "150€"
  optiqueVc: string | null; // Optical VC
  medecines: string | null; // e.g., "100%"
  soinsNonOptam: string | null; // Non-OPTAM care
  chambreParticuliere: string | null; // Private room
  medecineDouce: string | null; // Alternative medicine
  appareilsAuditifs: string | null; // Hearing aids
  maternite: string | null; // Maternity
  cureThermale: string | null; // Thermal spa
  fraisDossier: string | null; // File fees
  delaiAttente: string | null; // Waiting period

  garantiesHtml: string; // URL to garanties HTML
  createdAt: string; // ISO 8601 datetime
  updatedAt: string; // ISO 8601 datetime
}

/**
 * Document
 * Document URL (PDF, HTML, logo, etc.)
 */
export interface Document {
  id: string; // BigInt serialized as string
  gammeId: string | null; // Foreign key to Gamme (mutually exclusive with formuleId)
  formuleId: string | null; // Foreign key to Formule (mutually exclusive with gammeId)
  documentType: string; // "cg" | "garanties" | "garanties_html" | "dipa" | "logo"
  url: string; // Document URL
  createdAt: string; // ISO 8601 datetime
}

/**
 * GarantieItem
 * Individual guarantee item (single coverage detail)
 */
export interface GarantieItem {
  id: string; // BigInt serialized as string
  categoryId: string; // Foreign key to GarantieCategory
  guaranteeName: string; // e.g., "Frais de séjour en secteur conventionné"
  guaranteeValue: string; // e.g., "Frais Réels" or "100% BRSS"
  displayOrder: number; // Order within category
  createdAt: string; // ISO 8601 datetime
}

/**
 * GarantieCategory
 * Category/section of guarantees (e.g., "HOSPITALISATION")
 */
export interface GarantieCategory {
  id: string; // BigInt serialized as string
  garantieParsedId: string; // Foreign key to GarantieParsed
  sectionIndex: number; // Which table/section (0-6)
  categoryName: string; // e.g., "HOSPITALISATION médicale, chirurgicale..."
  displayOrder: number; // Order within garantie
  createdAt: string; // ISO 8601 datetime
}

/**
 * GarantieParsed
 * Parsed HTML guarantee data
 */
export interface GarantieParsed {
  id: string; // BigInt serialized as string
  gammeId: string | null; // Foreign key to Gamme (mutually exclusive with formuleId)
  formuleId: string | null; // Foreign key to Formule (mutually exclusive with gammeId)
  title: string | null; // e.g., "SANTE N"
  introText: string[]; // Array of intro paragraphs
  formuleIndicator: string | null; // e.g., "N1"
  notesAndLegal: string | null; // Notes and legal text
  createdAt: string; // ISO 8601 datetime
}

// ============================================
// Nested/Related Entity Types
// ============================================

/**
 * GarantieCategory with Items
 * Category with all its guarantee items nested
 */
export interface GarantieCategoryWithItems extends GarantieCategory {
  items: GarantieItem[];
}

/**
 * GarantieParsed with Categories and Items
 * Complete guarantee structure with full nesting
 */
export interface GarantieParsedWithDetails extends GarantieParsed {
  categories: GarantieCategoryWithItems[];
}

/**
 * Gamme with Groupe relation
 * Product line with parent group info
 */
export interface GammeWithGroupe extends Gamme {
  groupe: Groupe;
}

/**
 * Formule with Gamme and Groupe
 * Plan with full parent hierarchy
 */
export interface FormuleWithRelations extends Formule {
  gamme: GammeWithGroupe;
}

/**
 * Formule with Complete Details
 * Full formule data with all guarantees and documents
 */
export interface FormuleWithDetails extends Formule {
  gamme: GammeWithGroupe;
  garantiesParsed: GarantieParsedWithDetails[];
  documents: Document[];
}

/**
 * Gamme with Formules
 * Product line with all its plans
 */
export interface GammeWithFormules extends Gamme {
  groupe: Groupe;
  formules: Formule[];
  documentsTable: Document[];
}

/**
 * Gamme with Complete Details
 * Product line with all formules including their guarantees
 */
export interface GammeWithDetails extends Gamme {
  groupe: Groupe;
  formules: FormuleWithDetails[];
  documentsTable: Document[];
}

/**
 * Groupe with Gammes
 * Insurance group with all its product lines
 */
export interface GroupeWithGammes extends Groupe {
  gammes: GammeWithFormules[];
}

// ============================================
// Statistics Types
// ============================================

/**
 * Product Statistics
 * Overall counts of entities in the system
 */
export interface ProductStats {
  groupes: number; // Total insurance groups
  gammes: number; // Total product lines
  formules: number; // Total formulas/plans
  garanties: number; // Total parsed guarantees
}

// ============================================
// Search Types
// ============================================

/**
 * Search Results
 * Results across all product types
 */
export interface SearchResults {
  groupes: Groupe[];
  gammes: GammeWithGroupe[];
  formules: FormuleWithRelations[];
}

// ============================================
// Request/Query Types
// ============================================

/**
 * List Query Parameters
 * Common query params for list endpoints
 */
export interface ListQueryParams {
  page?: number; // Page number (default: 1)
  limit?: number; // Items per page (default: 20, max: 100)
  search?: string; // Search term for libelle/code
}

/**
 * Gammes Query Parameters
 * Query params for /api/products/gammes
 */
export interface GammesQueryParams extends ListQueryParams {
  groupeId?: string; // Filter by parent groupe
}

/**
 * Formules Query Parameters
 * Query params for /api/products/formules
 */
export interface FormulesQueryParams extends ListQueryParams {
  gammeId?: string; // Filter by parent gamme
}

/**
 * Search Query Parameters
 * Query params for /api/products/search
 */
export interface SearchQueryParams {
  q: string; // Search query (minimum 2 characters)
}

// ============================================
// API Endpoint Response Types
// ============================================

// Stats Endpoint
export type StatsResponse = ApiResponse<ProductStats>;

// Search Endpoint
export type SearchResponse = ApiResponse<SearchResults>;

// Groupes Endpoints
export type GroupesListResponse = ApiResponse<Groupe[]>;
export type GroupeDetailResponse = ApiResponse<GroupeWithGammes>;

// Gammes Endpoints
export type GammesListResponse = ApiResponse<
  PaginatedResponse<GammeWithGroupe>
>;
export type GammeDetailResponse = ApiResponse<GammeWithDetails>;

// Formules Endpoints
export type FormulesListResponse = ApiResponse<
  PaginatedResponse<FormuleWithRelations>
>;
export type FormuleDetailResponse = ApiResponse<FormuleWithDetails>;

// ============================================
// Create/Update Request Types
// ============================================

/**
 * Create Groupe Request
 */
export interface CreateGroupeRequest {
  code: string; // Max 2 characters
  libelle: string; // Max 17 characters
}

/**
 * Update Groupe Request
 */
export interface UpdateGroupeRequest {
  code?: string; // Max 2 characters
  libelle?: string; // Max 17 characters
}

/**
 * Create Gamme Request
 */
export interface CreateGammeRequest {
  groupeId: string; // Parent groupe ID
  code: string; // Max 3 characters
  libelle: string; // Max 29 characters
  documents?: Record<string, string>; // Optional document URLs
}

/**
 * Update Gamme Request
 */
export interface UpdateGammeRequest {
  code?: string; // Max 3 characters
  libelle?: string; // Max 29 characters
  documents?: Record<string, string>; // Optional document URLs
}

/**
 * Create Formule Request
 */
export interface CreateFormuleRequest {
  gammeId: string; // Parent gamme ID
  code: string; // Max 4 characters
  libelle: string; // Max 14 characters
  libelleAlternatif?: string; // Max 13 characters
  hospitalisation?: string; // Max 46 characters
  hospiNonOptam?: string; // Max 4 characters
  dentaire?: string; // Max 50 characters
  optique?: string; // Max 50 characters
  optiqueVc?: string; // Max 43 characters
  medecines?: string; // Max 50 characters
  soinsNonOptam?: string; // Max 12 characters
  chambreParticuliere?: string; // Max 47 characters
  medecineDouce?: string; // Max 40 characters
  appareilsAuditifs?: string; // Max 46 characters
  maternite?: string; // Max 48 characters
  cureThermale?: string; // Max 42 characters
  fraisDossier?: string; // Max 13 characters
  delaiAttente?: string; // Max 50 characters
  garantiesHtml: string; // Max 87 characters
}

/**
 * Update Formule Request
 */
export interface UpdateFormuleRequest {
  code?: string;
  libelle?: string;
  libelleAlternatif?: string;
  hospitalisation?: string;
  hospiNonOptam?: string;
  dentaire?: string;
  optique?: string;
  optiqueVc?: string;
  medecines?: string;
  soinsNonOptam?: string;
  chambreParticuliere?: string;
  medecineDouce?: string;
  appareilsAuditifs?: string;
  maternite?: string;
  cureThermale?: string;
  fraisDossier?: string;
  delaiAttente?: string;
  garantiesHtml?: string;
}

// ============================================
// API Client Types (for axios/fetch usage)
// ============================================

/**
 * API Endpoints
 * Type-safe endpoint paths
 */
export const API_ENDPOINTS = {
  // Stats & Search
  STATS: "/api/products/stats",
  SEARCH: "/api/products/search",

  // Groupes
  GROUPES: "/api/products/groupes",
  GROUPE_BY_ID: (id: string) => `/api/products/groupes/${id}`,

  // Gammes
  GAMMES: "/api/products/gammes",
  GAMME_BY_ID: (id: string) => `/api/products/gammes/${id}`,

  // Formules
  FORMULES: "/api/products/formules",
  FORMULE_BY_ID: (id: string) => `/api/products/formules/${id}`,
} as const;

// ============================================
// Type Guards
// ============================================

/**
 * Type guard for successful API response
 */
export function isSuccessResponse<T>(
  response: ApiResponse<T>
): response is ApiSuccessResponse<T> {
  return response.success === true;
}

/**
 * Type guard for error API response
 */
export function isErrorResponse<T>(
  response: ApiResponse<T>
): response is ApiErrorResponse {
  return response.success === false;
}

// ============================================
// Usage Example Types
// ============================================

/**
 * Example: Fetch all groupes
 *
 * ```typescript
 * const response = await fetch('http://localhost:3002/api/products/groupes');
 * const data: GroupesListResponse = await response.json();
 *
 * if (isSuccessResponse(data)) {
 *   const groupes: Groupe[] = data.data;
 *   groupes.forEach(groupe => {
 *     console.log(groupe.libelle); // Type-safe access
 *   });
 * }
 * ```
 */

/**
 * Example: Fetch formule with complete details
 *
 * ```typescript
 * const response = await fetch('http://localhost:3002/api/products/formules/1');
 * const data: FormuleDetailResponse = await response.json();
 *
 * if (isSuccessResponse(data)) {
 *   const formule: FormuleWithDetails = data.data;
 *   console.log(formule.gamme.groupe.libelle); // "ALPTIS"
 *   console.log(formule.garantiesParsed[0].categories[0].items[0].guaranteeName);
 * }
 * ```
 */

/**
 * Example: Search products
 *
 * ```typescript
 * const response = await fetch('http://localhost:3002/api/products/search?q=alptis');
 * const data: SearchResponse = await response.json();
 *
 * if (isSuccessResponse(data)) {
 *   const results: SearchResults = data.data;
 *   console.log(`Found ${results.groupes.length} groups`);
 *   console.log(`Found ${results.gammes.length} gammes`);
 *   console.log(`Found ${results.formules.length} formules`);
 * }
 * ```
 */

/**
 * Example: Paginated formules list
 *
 * ```typescript
 * const params = new URLSearchParams({
 *   page: '1',
 *   limit: '20',
 *   gammeId: '5'
 * });
 * const response = await fetch(`http://localhost:3002/api/products/formules?${params}`);
 * const data: FormulesListResponse = await response.json();
 *
 * if (isSuccessResponse(data)) {
 *   const { data: formules, pagination } = data.data;
 *   console.log(`Page ${pagination.page} of formules`);
 *   formules.forEach(formule => {
 *     console.log(`${formule.libelle} - ${formule.gamme.libelle}`);
 *   });
 * }
 * ```
 */

/**
 * Example: Create new groupe
 *
 * ```typescript
 * const request: CreateGroupeRequest = {
 *   code: "99",
 *   libelle: "NEW COMPANY"
 * };
 *
 * const response = await fetch('http://localhost:3002/api/products/groupes', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify(request)
 * });
 *
 * const data: GroupeDetailResponse = await response.json();
 *
 * if (isSuccessResponse(data)) {
 *   console.log('Created:', data.data.libelle);
 * } else {
 *   console.error('Error:', data.error);
 * }
 * ```
 */
