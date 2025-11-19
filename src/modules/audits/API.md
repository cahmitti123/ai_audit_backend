# Audits API - Frontend Reference

## Types

```typescript
// Enums
type AuditStatus = "pending" | "running" | "completed" | "failed";
type AuditNiveau = "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET";
type StepConforme = "CONFORME" | "NON_CONFORME" | "PARTIEL";

// Core Types
type AuditStepResult = {
  id: string;
  auditId: string;
  stepPosition: number;
  stepName: string;
  severityLevel: string;
  isCritical: boolean;
  weight: number;
  traite: boolean;
  conforme: StepConforme;
  score: number;
  niveauConformite:
    | "EXCELLENT"
    | "BON"
    | "ACCEPTABLE"
    | "INSUFFISANT"
    | "REJET";
  commentaireGlobal: string;
  motsClesTrouves: string[];
  minutages: string[];
  erreursTranscriptionTolerees: number;
  totalCitations: number;
  totalTokens: number;
  createdAt: string; // ISO date
};

type Audit = {
  id: string;
  ficheCacheId: string;
  auditConfigId: string;
  overallScore: string;
  scorePercentage: string;
  niveau: AuditNiveau;
  isCompliant: boolean;
  criticalPassed: number;
  criticalTotal: number;
  status: AuditStatus;
  startedAt: string | null; // ISO date
  completedAt: string | null; // ISO date
  durationMs: number | null;
  errorMessage: string | null;
  totalTokens: number | null;
  successfulSteps: number | null;
  failedSteps: number | null;
  recordingsCount: number | null;
  timelineChunks: number | null;
  resultData: any | null;
  version: number;
  isLatest: boolean;
  createdAt: string; // ISO date
  updatedAt: string; // ISO date
};

type AuditWithConfig = Audit & {
  auditConfig: {
    id: string;
    name: string;
    description: string | null;
  };
};

type AuditWithFiche = Audit & {
  ficheCache: {
    ficheId: string;
    groupe: string | null;
    prospectNom: string | null;
    prospectPrenom: string | null;
  };
  auditConfig: {
    id: string;
    name: string;
    description: string | null;
  };
};

type AuditDetail = Audit & {
  auditConfig: {
    id: string;
    name: string;
    description: string | null;
  };
  ficheCache: {
    ficheId: string;
    groupe: string | null;
    agenceNom: string | null;
    prospectNom: string | null;
    prospectPrenom: string | null;
    prospectEmail: string | null;
    prospectTel: string | null;
  };
  stepResults: AuditStepResult[];
};

type FicheWithAudits = {
  fiche: {
    id: string;
    ficheId: string;
    groupe: string | null;
    agenceNom: string | null;
    prospectNom: string | null;
    prospectPrenom: string | null;
    prospectEmail: string | null;
    prospectTel: string | null;
    hasRecordings: boolean;
    recordingsCount: number | null;
    fetchedAt: string; // ISO date
    createdAt: string; // ISO date
    updatedAt: string; // ISO date
  };
  audits: AuditWithConfig[];
  summary: {
    totalAudits: number;
    compliantCount: number;
    averageScore: number;
    latestAuditDate: string | null; // ISO date
  };
};
```

---

## Endpoints

### 1. List All Audits

```
GET /api/audits
```

**Query Parameters:**

```typescript
{
  fiche_ids?: string; // Comma-separated: "123,456"
  status?: string; // Comma-separated: "completed,failed"
  is_compliant?: string; // "true" | "false"
  date_from?: string; // ISO date: "2025-01-01"
  date_to?: string; // ISO date: "2025-01-31"
  audit_config_ids?: string; // Comma-separated: "13,11"
  sort_by?: "created_at" | "completed_at" | "score_percentage" | "duration_ms";
  sort_order?: "asc" | "desc";
  limit?: string; // Max 500
  offset?: string;
}
```

**Response:**

```typescript
{
  success: true;
  data: AuditWithFiche[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    current_page: number;
    total_pages: number;
    has_next_page: boolean;
    has_prev_page: boolean;
  };
}
```

---

### 2. Get Audits Grouped by Fiches

```
GET /api/audits/grouped-by-fiches
```

**Query Parameters:** Same as endpoint #1

**Response:**

```typescript
{
  success: true;
  data: FicheWithAudits[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    current_page: number;
    total_pages: number;
    has_next_page: boolean;
    has_prev_page: boolean;
  };
}
```

---

### 3. Run Audit (Async)

```
POST /api/audits/run
```

**Request Body:**

```typescript
{
  audit_id: number; // Audit config ID
  fiche_id: string;
  user_id?: string;
}
```

**Response:**

```typescript
{
  success: true;
  message: "Audit queued for processing";
  event_id: string;
  fiche_id: string;
  audit_config_id: number;
  metadata: {
    timestamp: string; // ISO date
    status: "queued";
  }
}
```

---

### 4. Run Audit with Latest Config (Async)

```
POST /api/audits/run-latest
```

**Request Body:**

```typescript
{
  fiche_id: string;
  user_id?: string;
}
```

**Response:**

```typescript
{
  success: true;
  message: "Audit queued for processing";
  event_id: string;
  fiche_id: string;
  audit_config_id: string;
  audit_config_name: string;
  metadata: {
    timestamp: string; // ISO date
    status: "queued";
  }
}
```

---

### 5. Batch Run Audits (Async)

```
POST /api/audits/batch
```

**Request Body:**

```typescript
{
  fiche_ids: string[];
  audit_config_id?: number;
  user_id?: string;
}
```

**Response:**

```typescript
{
  success: true;
  message: string; // "Batch audit queued for X fiches"
  fiche_ids: string[];
  audit_config_id: number;
  batch_id: string;
  event_ids: string[];
}
```

---

### 6. Get Audits by Fiche

```
GET /api/audits/by-fiche/:fiche_id
```

**Query Parameters:**

```typescript
{
  include_details?: "true" | "false";
}
```

**Response:**

```typescript
{
  success: true;
  data: AuditWithConfig[];
  count: number;
}
```

---

### 7. Get Audit by ID

```
GET /api/audits/:audit_id
```

**Response:**

```typescript
{
  success: true;
  data: AuditDetail;
}
```

**404 Response:**

```typescript
{
  success: false;
  error: "Audit not found";
}
```

---

## Error Responses

All endpoints return this on error:

```typescript
{
  success: false;
  error: string;
  message: string;
  stack?: string; // Only in development
}
```

**HTTP Status Codes:**

- `200` - Success
- `400` - Bad request / validation error
- `404` - Not found
- `500` - Server error

---

## Quick Reference

| Endpoint                         | Method | Purpose                          | Returns             |
| -------------------------------- | ------ | -------------------------------- | ------------------- |
| `/api/audits`                    | GET    | List all audits with filters     | `AuditWithFiche[]`  |
| `/api/audits/grouped-by-fiches`  | GET    | Audits grouped by fiche          | `FicheWithAudits[]` |
| `/api/audits/run`                | POST   | Queue audit with specific config | Event ID            |
| `/api/audits/run-latest`         | POST   | Queue audit with latest config   | Event ID            |
| `/api/audits/batch`              | POST   | Queue batch audits               | Batch ID            |
| `/api/audits/by-fiche/:fiche_id` | GET    | Get fiche's audit history        | `AuditWithConfig[]` |
| `/api/audits/:audit_id`          | GET    | Get single audit detail          | `AuditDetail`       |

