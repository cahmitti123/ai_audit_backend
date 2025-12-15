import type {
  Document,
  Formule,
  Gamme,
  GarantieCategory,
  GarantieItem,
  GarantieParsed,
  Groupe,
} from "@prisma/client";

export type AuditSeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AuditStepDefinition = {
  position: number;
  name: string;
  prompt: string;
  controlPoints: string[];
  keywords: string[];
  severityLevel: AuditSeverityLevel;
  isCritical: boolean;
  chronologicalImportant?: boolean;
  weight: number;
  verifyProductInfo?: boolean;
  customInstructions?: string;
} & Record<string, unknown>;

export type AuditConfigForAnalysis = {
  auditSteps: AuditStepDefinition[];
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
} & Record<string, unknown>;

export type ProductFormuleFull = Formule & {
  gamme: Gamme & { groupe: Groupe };
  garantiesParsed: Array<
    GarantieParsed & {
      categories: Array<GarantieCategory & { items: GarantieItem[] }>;
    }
  >;
  documents: Document[];
  _counts?: {
    garanties?: number;
    categories?: number;
    items?: number;
    documents?: number;
  };
  _match?: { strategy: string };
};

export type ProductLinkResult = {
  ficheId?: string;
  searchCriteria?: {
    groupe_nom: string;
    gamme_nom: string;
    formule_nom: string;
  };
  matched: boolean;
  formule: ProductFormuleFull | null;
  ficheProductData?: Record<string, unknown>;
  clientNeeds?: unknown;
  message?: string;
};


