/**
 * Mail Devis Types - Frontend
 * ============================
 * Copy these types into your frontend project for type-safe Mail Devis integration
 * 
 * Usage:
 * ```typescript
 * import { FicheDetailsResponse, MailDevis } from './types/mail-devis.types';
 * 
 * const response = await fetch(`/api/fiches/${id}?include_mail_devis=true`);
 * const data: FicheDetailsResponse = await response.json();
 * 
 * if (data.mail_devis) {
 *   console.log('Product:', data.mail_devis.garanties_details.product_name);
 * }
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// MAIL DEVIS METADATA
// ═══════════════════════════════════════════════════════════════════════════

export interface MailDevisMetadata {
  date_envoi: string;
  type_mail: string;
  utilisateur: string;
  visualisation_url: string | null;
}

export interface CustomerInfo {
  email: string | null;
  phone: string | null;
  name: string | null;
}

export interface GarantiesLink {
  url: string;
  text: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT & AGENCY INFO
// ═══════════════════════════════════════════════════════════════════════════

export interface AgenceInfo {
  nom: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  logo_url: string | null;
}

export interface FicheInfo {
  fiche_id: string;
  cle: string;
  conseiller: string | null;
}

export interface SubscriberInfo {
  civilite: string | null;
  nom: string | null;
  prenom: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS & NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════

export interface Documents {
  conditions_generales: string | null;
  tableau_garanties: string | null;
  document_information: string | null;
  exemples_remboursements: string | null;
}

export interface MenuLinks {
  home: string | null;
  garanties: string | null;
  documents: string | null;
  subscription: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARANTEES STRUCTURE (Hierarchical)
// ═══════════════════════════════════════════════════════════════════════════

export interface GarantieItem {
  name: string;
  value: string;
  note_ref?: string | null;
}

export interface GarantieSubcategory {
  name: string;
  items: GarantieItem[];
}

export interface GarantieCategory {
  category_name: string;
  note_references: string[];
  subcategories: Record<string, GarantieSubcategory>;
  items: GarantieItem[];
}

export interface GarantieNote {
  number: string;
  text: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE GARANTIES DETAILS
// ═══════════════════════════════════════════════════════════════════════════

export interface GarantiesDetails {
  // Product Information
  gamme: string;
  product_name: string;
  formule: string;
  price: string;
  age_range: string;
  subscription_link: string;
  
  // References
  agence_info: AgenceInfo;
  fiche_info: FicheInfo;
  subscriber_info: SubscriberInfo;
  
  // Resources
  documents: Documents;
  menu_links: MenuLinks;
  
  // Coverage Details
  garanties: Record<string, GarantieCategory>;
  notes: GarantieNote[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MAIL DEVIS TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface MailDevis {
  mail_devis: MailDevisMetadata;
  customer_info: CustomerInfo;
  garanties_link: GarantiesLink;
  garanties_details: GarantiesDetails;
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHE DETAILS RESPONSE (Simplified - only relevant fields shown)
// ═══════════════════════════════════════════════════════════════════════════

export interface FicheDetailsResponse {
  success: boolean;
  message: string;
  
  // Fiche information
  information: any;
  prospect: any;
  conjoint: any;
  enfants: any[];
  mails: any[];
  rendez_vous: any[];
  commentaires: any[];
  elements_souscription: any;
  tarification: any[];
  reclamations: any[];
  autres_contrats: any[];
  documents: any[];
  alertes: any[];
  recordings: any[];
  raw_sections: Record<string, string>;
  
  // ⭐ NEW - Optional Mail Devis field
  // Only present when include_mail_devis=true query parameter is used
  mail_devis?: MailDevis | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Type guard to check if mail devis exists
 */
export function hasMailDevis(
  response: FicheDetailsResponse
): response is FicheDetailsResponse & { mail_devis: MailDevis } {
  return response.mail_devis !== undefined && response.mail_devis !== null;
}

/**
 * API Query Parameters
 */
export interface FicheDetailsParams {
  include_mail_devis?: boolean;
  refresh?: boolean;
}

/**
 * Document type for easy iteration
 */
export interface DocumentItem {
  key: keyof Documents;
  label: string;
  url: string | null;
  icon?: string;
}

/**
 * Helper to get document list
 */
export function getDocumentsList(documents: Documents): DocumentItem[] {
  return [
    {
      key: 'conditions_generales',
      label: 'Conditions Générales',
      url: documents.conditions_generales,
      icon: '📄',
    },
    {
      key: 'tableau_garanties',
      label: 'Tableau des Garanties',
      url: documents.tableau_garanties,
      icon: '📊',
    },
    {
      key: 'document_information',
      label: "Document d'Information",
      url: documents.document_information,
      icon: '📋',
    },
    {
      key: 'exemples_remboursements',
      label: 'Exemples de Remboursements',
      url: documents.exemples_remboursements,
      icon: '💰',
    },
  ].filter((doc) => doc.url !== null) as DocumentItem[];
}

/**
 * Helper to flatten garanties for display
 */
export interface FlatGarantieItem {
  categoryName: string;
  subcategoryName?: string;
  name: string;
  value: string;
  noteRef?: string;
}

export function flattenGaranties(
  garanties: Record<string, GarantieCategory>
): FlatGarantieItem[] {
  const flat: FlatGarantieItem[] = [];

  Object.values(garanties).forEach((category) => {
    // Direct items (no subcategory)
    category.items.forEach((item) => {
      flat.push({
        categoryName: category.category_name,
        name: item.name,
        value: item.value,
        noteRef: item.note_ref || undefined,
      });
    });

    // Subcategory items
    Object.values(category.subcategories).forEach((subcategory) => {
      subcategory.items.forEach((item) => {
        flat.push({
          categoryName: category.category_name,
          subcategoryName: subcategory.name,
          name: item.name,
          value: item.value,
          noteRef: item.note_ref || undefined,
        });
      });
    });
  });

  return flat;
}

// ═══════════════════════════════════════════════════════════════════════════
// USAGE EXAMPLES (as type definitions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: React Component Props
 */
export interface MailDevisDisplayProps {
  mailDevis: MailDevis;
  onSubscribe?: (link: string) => void;
  onDocumentClick?: (documentType: keyof Documents, url: string) => void;
}

/**
 * Example: API Hook Return Type
 */
export interface UseFicheResult {
  data: FicheDetailsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: (params?: FicheDetailsParams) => Promise<void>;
}

/**
 * Example: Mail Devis Summary for Lists
 */
export interface MailDevisSummary {
  ficheId: string;
  productName: string;
  gamme: string;
  formule: string;
  price: string;
  hasDevis: boolean;
  devisSentDate: string | null;
}

/**
 * Helper to extract summary from full data
 */
export function extractMailDevisSummary(
  ficheId: string,
  response: FicheDetailsResponse
): MailDevisSummary {
  if (!hasMailDevis(response)) {
    return {
      ficheId,
      productName: 'N/A',
      gamme: 'N/A',
      formule: 'N/A',
      price: 'N/A',
      hasDevis: false,
      devisSentDate: null,
    };
  }

  const { garanties_details, mail_devis } = response.mail_devis;

  return {
    ficheId,
    productName: garanties_details.product_name,
    gamme: garanties_details.gamme,
    formule: garanties_details.formule,
    price: garanties_details.price,
    hasDevis: true,
    devisSentDate: mail_devis.date_envoi,
  };
}


