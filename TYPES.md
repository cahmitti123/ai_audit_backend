# Complete TypeScript Types Documentation

## 🎯 Purpose

**This documentation is for your FRONTEND application to communicate with the AI Audit BACKEND API.**

- **Backend API:** `http://localhost:3002` (this project)
- **Frontend:** Your React/Vue/Svelte application (port 3000)
- **Communication:** REST API over HTTP with JSON

---

## 📦 Installation

**In your FRONTEND project:**

1. Copy the types to your frontend:

```bash
# Create types file in your frontend
touch src/types/api.types.ts
```

2. Copy all type definitions from this document to `src/types/api.types.ts`

3. Create the API client:

```bash
# Create API client in your frontend
touch src/lib/api-client.ts
```

4. Copy the `AuditApiClient` class to `src/lib/api-client.ts`

---

## ⚡ What This Does

**Your Frontend** ←→ **HTTP/JSON** ←→ **Backend API (port 3002)**

The backend handles:

- ✅ Fetching fiches from external API
- ✅ Transcribing audio with ElevenLabs
- ✅ Running GPT-5 audits
- ✅ Storing results in database

Your frontend:

- ✅ Displays UI
- ✅ Sends requests to backend
- ✅ Shows results to users

---

## 🎯 Complete Type Definitions

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// BASE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuditNiveau =
  | "EXCELLENT"
  | "BON"
  | "ACCEPTABLE"
  | "INSUFFISANT"
  | "REJET";
export type ConformeStatus = "CONFORME" | "NON_CONFORME" | "PARTIEL";
export type ControlPointStatus =
  | "PRESENT"
  | "ABSENT"
  | "PARTIEL"
  | "NON_APPLICABLE";

// ═══════════════════════════════════════════════════════════════════════════
// API RESPONSE WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  count?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT CONFIG TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditStep {
  id: string;
  position: number;
  name: string;
  description?: string;
  prompt: string;
  severityLevel: AuditSeverity;
  isCritical: boolean;
  weight: number;
  chronologicalImportant: boolean;
  controlPoints: string[];
  keywords: string[];
}

export interface AuditConfig {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  isActive: boolean;
  stepsCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  steps?: AuditStep[]; // Included when include_steps=true
}

export interface AuditConfigDetails extends AuditConfig {
  steps: AuditStep[];
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SalesFiche {
  id: string;
  cle: string | null;
  nom: string;
  prenom: string;
  telephone: string;
  telephone_2: string | null;
  email: string;
  statut: string;
  date_insertion: string;
  date_modification: string | null;
}

export interface SalesResponse {
  fiches: SalesFiche[];
  total: number;
}

export interface FicheInformation {
  fiche_id: string;
  cle: string;
  date_insertion: string;
  groupe: string;
  agence_id: string;
  agence_nom: string;
  attribution_user_id: string;
  attribution_user_nom: string;
  dernier_acces: string;
  nombre_acces: number;
  corbeille: boolean;
  archive: boolean;
  modules: string[];
  [key: string]: any; // Additional fields
}

export interface Prospect {
  prospect_id: string;
  civilite: number;
  civilite_text: string;
  nom: string;
  prenom: string;
  date_naissance: string;
  telephone: string | null;
  mobile: string | null;
  mail: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  [key: string]: any; // Additional fields
}

export interface Recording {
  call_id: string;
  start_time: string;
  duration_seconds: number;
  direction: string;
  from_number: string;
  to_number: string;
  answered: boolean;
  recording_url: string | null;
}

export interface FicheDetails {
  success: boolean;
  message: string;
  information: FicheInformation;
  prospect: Prospect | null;
  conjoint: any | null;
  enfants: any[];
  mails: any[];
  rendez_vous: any[];
  commentaires: any[];
  elements_souscription: any | null;
  tarification: any[];
  reclamations: any[];
  autres_contrats: any[];
  documents: any[];
  alertes: any[];
  recordings: Recording[];
  raw_sections: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECORDING & TRANSCRIPTION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface RecordingDetail {
  id: string;
  callId: string;
  recordingUrl: string;
  recordingDate: string | null; // DD/MM/YYYY
  recordingTime: string | null; // HH:MM
  fromNumber: string | null; // Formatted: +33 6 76 79 62 18
  toNumber: string | null;
  uuid: string | null;
  direction: string | null; // "in" | "out"
  answered: boolean | null;
  startTime: string | null; // ISO DateTime
  durationSeconds: number | null;
  hasTranscription: boolean;
  transcriptionId: string | null; // ElevenLabs ID
  transcribedAt: string | null; // ISO DateTime
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionStatus {
  ficheId: string;
  total: number;
  transcribed: number;
  pending: number;
  percentage: number;
  recordings: Array<{
    callId: string;
    hasTranscription: boolean;
    transcriptionId: string | null;
    transcribedAt: string | null;
    recordingDate: string | null;
    recordingTime: string | null;
    durationSeconds: number | null;
  }>;
}

export interface TranscriptionResult {
  total: number;
  transcribed: number;
  newTranscriptions: number;
  results?: Array<{
    callId: string;
    transcriptionId: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Citation {
  texte: string;
  minutage: string; // MM:SS
  minutageSecondes: number;
  speaker: string; // speaker_0, speaker_1, etc.
  recordingIndex: number;
  chunkIndex: number;
  recordingDate: string | null; // DD/MM/YYYY
  recordingTime: string | null; // HH:MM
}

export interface ControlPointResult {
  point: string;
  statut: ControlPointStatus;
  commentaire: string;
  citations: Citation[];
  minutages: string[];
  erreurTranscriptionNotee: boolean;
  variationPhonetiqueUtilisee: string | null;
}

export interface StepResult {
  traite: boolean;
  conforme: ConformeStatus;
  minutages: string[];
  score: number;
  pointsControle: ControlPointResult[];
  motsClesTrouves: string[];
  commentaireGlobal: string;
  niveauConformite: AuditNiveau;
  erreursTranscriptionTolerees: number;
  stepMetadata: {
    position: number;
    name: string;
    severity: AuditSeverity;
    isCritical: boolean;
    weight: number;
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AuditCompliance {
  score: number; // 0-100
  niveau: AuditNiveau;
  pointsCritiques: string; // "5/5"
  poidsObtenu: number;
  poidsTotal: number;
}

export interface AuditResult {
  audit: {
    config: {
      id: string;
      name: string;
      description?: string;
    };
    fiche: {
      ficheId: string;
      prospectName: string;
      groupe: string;
    };
    results: {
      metadata: {
        date: string;
        mode: string;
        options: any;
      };
      steps: StepResult[];
      statistics: {
        successful: number;
        failed: number;
        totalTimeSeconds: number;
        totalTokens: number;
      };
    };
    compliance: AuditCompliance;
  };
  statistics: {
    recordingsCount: number;
    transcriptionsCount: number;
    timelineChunks: number;
    successfulSteps: number;
    failedSteps: number;
    totalTimeSeconds: number;
    totalTokens: number;
  };
  metadata: {
    startedAt: string; // ISO DateTime
    completedAt: string; // ISO DateTime
    durationMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE AUDIT TYPES (from GET /api/audits/:id)
// ═══════════════════════════════════════════════════════════════════════════

export interface DbCitation {
  id: string;
  texte: string;
  recordingIndex: number;
  chunkIndex: number;
  minutage: string;
  minutageSecondes: number;
  speaker: string;
  recordingDate: string | null;
  recordingTime: string | null;
  createdAt: string;
}

export interface DbControlPoint {
  id: string;
  point: string;
  pointIndex: number;
  statut: ControlPointStatus;
  commentaire: string;
  erreurTranscriptionNotee: boolean;
  variationPhonetiqueUtilisee: string | null;
  minutages: string[];
  citations: DbCitation[];
  createdAt: string;
}

export interface DbStepResult {
  id: string;
  stepPosition: number;
  stepName: string;
  severityLevel: AuditSeverity;
  isCritical: boolean;
  weight: number;
  traite: boolean;
  conforme: ConformeStatus;
  score: number;
  niveauConformite: AuditNiveau;
  commentaireGlobal: string;
  motsClesTrouves: string[];
  minutages: string[];
  erreursTranscriptionTolerees: number;
  totalCitations: number;
  totalTokens: number;
  controlPoints: DbControlPoint[];
  createdAt: string;
}

export interface DbAudit {
  id: string;
  ficheCacheId: string;
  auditConfigId: string;
  overallScore: number;
  scorePercentage: number;
  niveau: AuditNiveau;
  isCompliant: boolean;
  criticalPassed: number;
  criticalTotal: number;
  status: "pending" | "processing" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  totalTokens: number | null;
  successfulSteps: number | null;
  failedSteps: number | null;
  recordingsCount: number | null;
  timelineChunks: number | null;
  version: number;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
  ficheCache?: {
    ficheId: string;
    prospectNom: string | null;
    prospectPrenom: string | null;
    groupe: string | null;
  };
  auditConfig?: {
    id: string;
    name: string;
    description: string | null;
  };
  stepResults?: DbStepResult[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FicheCache {
  ficheId: string;
  groupe: string | null;
  agenceNom: string | null;
  prospectNom: string | null;
  prospectPrenom: string | null;
  prospectEmail: string | null;
  prospectTel: string | null;
  recordingsCount: number | null;
  fetchedAt: string;
  expiresAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST BODY TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface RunAuditRequest {
  audit_id: number;
  fiche_id: string;
  async?: boolean; // Run in background with Inngest
}

export interface RunLatestAuditRequest {
  fiche_id: string;
}

export interface BatchAuditRequest {
  fiche_ids: string[];
  audit_config_id?: number; // Defaults to 10 (Quick Audit)
}

export interface BatchTranscribeRequest {
  fiche_ids: string[];
}

export interface CreateAuditConfigRequest {
  name: string;
  description?: string;
  systemPrompt?: string;
  createdBy?: string;
  steps: Array<{
    name: string;
    description?: string;
    prompt: string;
    controlPoints: string[];
    keywords: string[];
    severityLevel: AuditSeverity;
    isCritical: boolean;
    position: number;
    weight: number;
    chronologicalImportant?: boolean;
  }>;
}

export interface UpdateAuditConfigRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  isActive?: boolean;
}

export interface AddAuditStepRequest {
  name: string;
  description?: string;
  prompt: string;
  controlPoints: string[];
  keywords: string[];
  severityLevel: AuditSeverity;
  isCritical: boolean;
  position: number;
  weight: number;
  chronologicalImportant?: boolean;
}

export interface UpdateAuditStepRequest {
  name?: string;
  description?: string;
  prompt?: string;
  controlPoints?: string[];
  keywords?: string[];
  severityLevel?: AuditSeverity;
  isCritical?: boolean;
  weight?: number;
  chronologicalImportant?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// API CLIENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Pagination (for future use)
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Audit Configs
export type ListAuditConfigsResponse = ApiResponse<AuditConfig[]>;
export type GetAuditConfigResponse = ApiResponse<AuditConfigDetails>;
export type CreateAuditConfigResponse = ApiResponse<{
  id: string;
  name: string;
}>;
export type UpdateAuditConfigResponse = ApiResponse<{
  id: string;
  name: string;
  stepsCount: number;
}>;
export type DeleteAuditConfigResponse = ApiResponse<{ message: string }>;

// Audit Steps
export type AddAuditStepResponse = ApiResponse<{ id: string; name: string }>;
export type UpdateAuditStepResponse = ApiResponse<AuditStep>;
export type DeleteAuditStepResponse = ApiResponse<{ message: string }>;

// Fiches
export type SearchFichesResponse = SalesResponse;
export type GetFicheDetailsResponse = FicheDetails;
export type GetFicheCacheResponse = ApiResponse<FicheCache>;
export type GetRecordingsResponse = ApiResponse<RecordingDetail[]>;

// Transcription
export type TranscribeFicheResponse = ApiResponse<TranscriptionResult>;
export type GetTranscriptionStatusResponse = ApiResponse<TranscriptionStatus>;
export type BatchTranscribeResponse = ApiResponse<{
  message: string;
  fiche_ids: string[];
}>;

// Audits
export type RunAuditResponse = ApiResponse<AuditResult>;
export type RunLatestAuditResponse = ApiResponse<AuditResult>;
export type BatchAuditResponse = ApiResponse<{
  message: string;
  fiche_ids: string[];
  audit_config_id?: number;
}>;
export type GetAuditHistoryResponse = ApiResponse<DbAudit[]>;
export type GetAuditDetailsResponse = ApiResponse<DbAudit>;
```

---

## 🎯 Example API Client

```typescript
// api-client.ts
import type * as API from "./types/api.types";

class AuditApiClient {
  private baseUrl: string;

  constructor(config: API.ApiClientConfig) {
    this.baseUrl = config.baseUrl;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT CONFIGS
  // ═══════════════════════════════════════════════════════════════════════════

  async listAuditConfigs(
    includeSteps = false,
    includeInactive = false
  ): Promise<API.ListAuditConfigsResponse> {
    const params = new URLSearchParams({
      include_steps: includeSteps.toString(),
      include_inactive: includeInactive.toString(),
    });

    const response = await fetch(`${this.baseUrl}/api/audit-configs?${params}`);
    return response.json();
  }

  async getAuditConfig(id: string): Promise<API.GetAuditConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit-configs/${id}`);
    return response.json();
  }

  async createAuditConfig(
    data: API.CreateAuditConfigRequest
  ): Promise<API.CreateAuditConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async updateAuditConfig(
    id: string,
    data: API.UpdateAuditConfigRequest
  ): Promise<API.UpdateAuditConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit-configs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  }

  async deleteAuditConfig(id: string): Promise<API.DeleteAuditConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit-configs/${id}`, {
      method: "DELETE",
    });
    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FICHES
  // ═══════════════════════════════════════════════════════════════════════════

  async searchFiches(date: string): Promise<API.SearchFichesResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/fiches/search?date=${date}`
    );
    return response.json();
  }

  async getFicheDetails(
    ficheId: string,
    cle?: string
  ): Promise<API.GetFicheDetailsResponse> {
    const params = cle ? `?cle=${cle}` : "";
    const response = await fetch(
      `${this.baseUrl}/api/fiches/${ficheId}${params}`
    );
    return response.json();
  }

  async getFicheCache(ficheId: string): Promise<API.GetFicheCacheResponse> {
    const response = await fetch(`${this.baseUrl}/api/fiches/${ficheId}/cache`);
    return response.json();
  }

  async getRecordings(ficheId: string): Promise<API.GetRecordingsResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/fiches/${ficheId}/recordings`
    );
    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  async transcribeFiche(ficheId: string): Promise<API.TranscribeFicheResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/fiches/${ficheId}/transcribe`,
      { method: "POST" }
    );
    return response.json();
  }

  async getTranscriptionStatus(
    ficheId: string
  ): Promise<API.GetTranscriptionStatusResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/fiches/${ficheId}/transcription-status`
    );
    return response.json();
  }

  async batchTranscribe(
    ficheIds: string[]
  ): Promise<API.BatchTranscribeResponse> {
    const response = await fetch(`${this.baseUrl}/api/transcribe/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiche_ids: ficheIds }),
    });
    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDITS
  // ═══════════════════════════════════════════════════════════════════════════

  async runAudit(
    auditId: number,
    ficheId: string,
    async = false
  ): Promise<API.RunAuditResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audit_id: auditId,
        fiche_id: ficheId,
        async,
      }),
    });
    return response.json();
  }

  async runLatestAudit(ficheId: string): Promise<API.RunLatestAuditResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit/run-latest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiche_id: ficheId }),
    });
    return response.json();
  }

  async batchAudit(
    ficheIds: string[],
    auditConfigId?: number
  ): Promise<API.BatchAuditResponse> {
    const response = await fetch(`${this.baseUrl}/api/audit/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fiche_ids: ficheIds,
        audit_config_id: auditConfigId,
      }),
    });
    return response.json();
  }

  async getAuditHistory(
    ficheId: string,
    includeDetails = false
  ): Promise<API.GetAuditHistoryResponse> {
    const params = includeDetails ? "?include_details=true" : "";
    const response = await fetch(
      `${this.baseUrl}/api/fiches/${ficheId}/audits${params}`
    );
    return response.json();
  }

  async getAuditDetails(auditId: string): Promise<API.GetAuditDetailsResponse> {
    const response = await fetch(`${this.baseUrl}/api/audits/${auditId}`);
    return response.json();
  }
}

// Export singleton instance
export const auditApi = new AuditApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002",
});

// Export class for custom instances
export default AuditApiClient;
```

---

## 🎨 React Hooks Examples

```typescript
// hooks/useAuditConfigs.ts
import { useState, useEffect } from "react";
import { auditApi } from "@/lib/api-client";
import type { AuditConfig } from "@/types/api.types";

export function useAuditConfigs() {
  const [configs, setConfigs] = useState<AuditConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await auditApi.listAuditConfigs();
        if (response.success && response.data) {
          setConfigs(response.data);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return { configs, loading, error };
}

// hooks/useRunAudit.ts
import { useState } from "react";
import { auditApi } from "@/lib/api-client";
import type { AuditResult } from "@/types/api.types";

export function useRunAudit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (auditId: number, ficheId: string, async = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await auditApi.runAudit(auditId, ficheId, async);
      if (response.success && response.data) {
        setResult(response.data);
        return response.data;
      } else {
        throw new Error(response.error || "Audit failed");
      }
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { run, loading, result, error };
}

// hooks/useFiches.ts
import { useState } from "react";
import { auditApi } from "@/lib/api-client";
import type { SalesFiche } from "@/types/api.types";

export function useFiches() {
  const [fiches, setFiches] = useState<SalesFiche[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (date: string) => {
    setLoading(true);
    try {
      const response = await auditApi.searchFiches(date);
      setFiches(response.fiches);
      return response;
    } finally {
      setLoading(false);
    }
  };

  return { fiches, search, loading };
}

// hooks/useAuditHistory.ts
import { useState, useEffect } from "react";
import { auditApi } from "@/lib/api-client";
import type { DbAudit } from "@/types/api.types";

export function useAuditHistory(ficheId: string | null, autoRefresh = false) {
  const [audits, setAudits] = useState<DbAudit[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!ficheId) return;
    setLoading(true);
    try {
      const response = await auditApi.getAuditHistory(ficheId);
      if (response.success && response.data) {
        setAudits(response.data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (autoRefresh) {
      const interval = setInterval(load, 10000); // Refresh every 10s
      return () => clearInterval(interval);
    }
  }, [ficheId, autoRefresh]);

  return { audits, loading, refresh: load };
}
```

---

## 🎯 Complete Component Examples

### 1. Fiche Selector Component

```typescript
// components/FicheSelector.tsx
import { useState } from "react";
import { useFiches } from "@/hooks/useFiches";
import type { SalesFiche } from "@/types/api.types";

interface FicheSelectorProps {
  onSelect: (fiche: SalesFiche) => void;
}

export function FicheSelector({ onSelect }: FicheSelectorProps) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const { fiches, search, loading } = useFiches();

  const handleSearch = () => {
    search(date);
  };

  return (
    <div>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? "Loading..." : "Search"}
      </button>

      {fiches.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Téléphone</th>
              <th>Statut</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {fiches.map((fiche) => (
              <tr key={fiche.id}>
                <td>{fiche.nom}</td>
                <td>{fiche.prenom}</td>
                <td>{fiche.telephone}</td>
                <td>{fiche.statut}</td>
                <td>
                  <button onClick={() => onSelect(fiche)}>Audit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

### 2. Audit Runner Component

```typescript
// components/AuditRunner.tsx
import { useState } from "react";
import { useAuditConfigs } from "@/hooks/useAuditConfigs";
import { useRunAudit } from "@/hooks/useRunAudit";
import type { SalesFiche, AuditResult } from "@/types/api.types";

interface AuditRunnerProps {
  fiche: SalesFiche;
  onComplete: (result: AuditResult) => void;
}

export function AuditRunner({ fiche, onComplete }: AuditRunnerProps) {
  const { configs } = useAuditConfigs();
  const { run, loading, error } = useRunAudit();
  const [selectedConfig, setSelectedConfig] = useState<string>("10");

  const handleRun = async () => {
    const result = await run(parseInt(selectedConfig), fiche.id);
    if (result) {
      onComplete(result);
    }
  };

  return (
    <div>
      <h3>
        Audit: {fiche.prenom} {fiche.nom}
      </h3>

      <select
        value={selectedConfig}
        onChange={(e) => setSelectedConfig(e.target.value)}
      >
        {configs.map((config) => (
          <option key={config.id} value={config.id}>
            {config.name} ({config.stepsCount} étapes)
          </option>
        ))}
      </select>

      <button onClick={handleRun} disabled={loading}>
        {loading ? "Audit en cours..." : "Lancer l'audit"}
      </button>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

### 3. Audit Results Display

```typescript
// components/AuditResults.tsx
import type { AuditResult } from "@/types/api.types";

interface AuditResultsProps {
  result: AuditResult;
}

export function AuditResults({ result }: AuditResultsProps) {
  const { compliance } = result.audit;

  const getNiveauColor = (niveau: string) => {
    switch (niveau) {
      case "EXCELLENT":
        return "green";
      case "BON":
        return "blue";
      case "ACCEPTABLE":
        return "orange";
      case "INSUFFISANT":
        return "red";
      case "REJET":
        return "darkred";
      default:
        return "gray";
    }
  };

  return (
    <div className="audit-results">
      <div className="score-card">
        <h2>Score: {compliance.score}%</h2>
        <div
          className="niveau-badge"
          style={{ backgroundColor: getNiveauColor(compliance.niveau) }}
        >
          {compliance.niveau}
        </div>
        <p>Points critiques: {compliance.pointsCritiques}</p>
      </div>

      <div className="stats">
        <p>Enregistrements: {result.statistics.recordingsCount}</p>
        <p>Étapes réussies: {result.statistics.successfulSteps}</p>
        <p>Durée: {(result.metadata.durationMs / 1000).toFixed(1)}s</p>
        <p>Tokens: {result.statistics.totalTokens.toLocaleString()}</p>
      </div>

      <div className="steps">
        <h3>Détails par étape</h3>
        {result.audit.results.steps.map((step, index) => (
          <div key={index} className={`step ${step.conforme.toLowerCase()}`}>
            <h4>
              {step.stepMetadata.position}. {step.stepMetadata.name}
            </h4>
            <p>
              <strong>{step.conforme}</strong> - Score: {step.score}/
              {step.stepMetadata.weight}
            </p>
            <p>{step.commentaireGlobal}</p>

            {step.pointsControle.map((pc, pcIndex) => (
              <div key={pcIndex} className="control-point">
                <strong>{pc.point}:</strong> {pc.statut}
                <p>{pc.commentaire}</p>
                {pc.citations.length > 0 && (
                  <div className="citations">
                    {pc.citations.map((citation, cIndex) => (
                      <blockquote key={cIndex}>
                        "{citation.texte}"
                        <footer>
                          {citation.speaker} - {citation.minutage}
                          {citation.recordingDate && (
                            <>
                              {" "}
                              ({citation.recordingDate} {citation.recordingTime})
                            </>
                          )}
                        </footer>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 4. Batch Audit Processor

```typescript
// components/BatchAuditProcessor.tsx
import { useState } from "react";
import { auditApi } from "@/lib/api-client";
import type { SalesFiche } from "@/types/api.types";

interface BatchAuditProcessorProps {
  fiches: SalesFiche[];
  auditConfigId: number;
}

export function BatchAuditProcessor({
  fiches,
  auditConfigId,
}: BatchAuditProcessorProps) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const processBatch = async () => {
    setProcessing(true);
    setProgress(0);

    // Queue batch
    const ficheIds = fiches.map((f) => f.id);
    await auditApi.batchAudit(ficheIds, auditConfigId);

    // Monitor progress
    const checkProgress = async () => {
      let completed = 0;
      for (const ficheId of ficheIds) {
        const response = await auditApi.getAuditHistory(ficheId);
        if (response.success && response.data && response.data.length > 0) {
          completed++;
        }
      }
      const pct = (completed / ficheIds.length) * 100;
      setProgress(pct);

      if (pct === 100) {
        setProcessing(false);
        clearInterval(interval);
      }
    };

    const interval = setInterval(checkProgress, 5000);
  };

  return (
    <div>
      <button onClick={processBatch} disabled={processing}>
        Audit {fiches.length} fiches
      </button>
      {processing && (
        <div>
          <progress value={progress} max="100" />
          <span>{Math.round(progress)}%</span>
        </div>
      )}
    </div>
  );
}
```

---

## 📋 Environment Variables

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3002
NEXT_PUBLIC_INNGEST_URL=http://localhost:8288
```

---

## 🔗 Complete Integration Example

```typescript
// app/audits/page.tsx
"use client";

import { useState } from "react";
import { FicheSelector } from "@/components/FicheSelector";
import { AuditRunner } from "@/components/AuditRunner";
import { AuditResults } from "@/components/AuditResults";
import type { SalesFiche, AuditResult } from "@/types/api.types";

export default function AuditsPage() {
  const [selectedFiche, setSelectedFiche] = useState<SalesFiche | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);

  return (
    <div className="audits-page">
      <h1>Système d'Audit AI</h1>

      <section>
        <h2>1. Sélectionner une fiche</h2>
        <FicheSelector onSelect={setSelectedFiche} />
      </section>

      {selectedFiche && (
        <section>
          <h2>2. Lancer l'audit</h2>
          <AuditRunner fiche={selectedFiche} onComplete={setAuditResult} />
        </section>
      )}

      {auditResult && (
        <section>
          <h2>3. Résultats</h2>
          <AuditResults result={auditResult} />
        </section>
      )}
    </div>
  );
}
```

---

**Last Updated:** October 21, 2025  
**API Version:** 2.3.0
