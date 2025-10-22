# Frontend API Integration Guide

## 🎯 About This Guide

**THIS IS FOR YOUR FRONTEND APPLICATION TO COMMUNICATE WITH THE BACKEND API**

- **Backend API Server:** Running on `http://localhost:3002` (this AI Audit project)
- **Your Frontend:** React/Vue/Svelte app on `http://localhost:3000`
- **Communication:** REST API calls over HTTP

**What the backend does for you:**

- ✅ Fetches fiche data from external API
- ✅ Caches data in database
- ✅ Transcribes audio recordings
- ✅ Runs AI audits with GPT-5
- ✅ Stores audit results
- ✅ Provides all data via REST API

**What your frontend does:**

- ✅ Displays UI to users
- ✅ Makes HTTP requests to backend
- ✅ Shows fiche lists, audit results, etc.

---

## 🌐 Base URL

```
http://localhost:3002
```

Production: Replace with your deployed backend URL.

**CORS is enabled for:**

- `http://localhost:3000` ✅
- `http://localhost:3001`
- `http://localhost:5173` (Vite)

---

## 📋 API Endpoints Overview

### Audit Configs

- List configs
- Get config details
- Create/Update/Delete configs
- Manage audit steps

### Fiches

- Search fiches by date
- Get fiche details
- View cached data
- Get recordings

### Transcription

- Transcribe recordings
- Check transcription status
- Batch transcribe

### Audits

- Run audit (sync/async)
- Batch audit
- Get audit results
- View audit history

---

## 🔑 Authentication

Currently: **No authentication required**

> ⚠️ Add API key authentication before production

---

## 📖 Endpoint Reference

### 1. Health Check

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-10-21T10:00:00.000Z",
  "service": "ai-audit-system",
  "version": "2.3.0"
}
```

---

### 2. List Audit Configurations

```http
GET /api/audit-configs?include_steps=true&include_inactive=false
```

**Query Parameters:**

- `include_steps` (boolean) - Include steps in response
- `include_inactive` (boolean) - Include inactive configs

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "8",
      "name": "Audit Complet - 18 Points",
      "description": "Audit qualité complet...",
      "isActive": true,
      "stepsCount": 18,
      "createdAt": "2025-10-21T...",
      "steps": [...]  // if include_steps=true
    }
  ],
  "count": 3
}
```

**Frontend Usage:**

```typescript
const response = await fetch(
  "http://localhost:3002/api/audit-configs?include_steps=true"
);
const { data } = await response.json();

// Display in dropdown
<select>
  {data.map((config) => (
    <option value={config.id}>
      {config.name} ({config.stepsCount} steps)
    </option>
  ))}
</select>;
```

---

### 3. Get Single Audit Config

```http
GET /api/audit-configs/:id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "10",
    "name": "Audit Rapide - 5 Points",
    "description": "...",
    "systemPrompt": "...",
    "isActive": true,
    "steps": [
      {
        "id": "45",
        "position": 1,
        "name": "Présentation légale",
        "severityLevel": "CRITICAL",
        "isCritical": true,
        "weight": 10,
        "controlPoints": [...],
        "keywords": [...]
      }
    ]
  }
}
```

---

### 4. Search Fiches by Date

```http
GET /api/fiches/search?date=2025-10-13
```

**Query Parameters:**

- `date` (required) - Format: `YYYY-MM-DD`

**Response:**

```json
{
  "fiches": [
    {
      "id": "1762209",
      "cle": "1c3d83...",
      "nom": "BADIN",
      "prenom": "Christine",
      "telephone": "+33676796218",
      "email": "email@example.com",
      "statut": "Santé : CLIENTS",
      "date_insertion": "25/09/2025 10:27"
    }
  ],
  "total": 12
}
```

**Frontend Usage:**

```typescript
const fetchFiches = async (date: string) => {
  const response = await fetch(
    `http://localhost:3002/api/fiches/search?date=${date}`
  );
  return await response.json();
};

// Usage
const fiches = await fetchFiches("2025-10-13");
```

---

### 5. Get Fiche Details

```http
GET /api/fiches/:fiche_id
```

**Response:**

```json
{
  "success": true,
  "message": "Fiche parsed successfully",
  "information": {
    "fiche_id": "1762209",
    "groupe": "NCA R3",
    "agence_nom": "3-NCAR3",
    "attribution_user_nom": "Mathieu LAMY"
  },
  "prospect": {
    "nom": "BADIN",
    "prenom": "Christine",
    "telephone": "0676796218",
    "mail": "email@example.com"
  },
  "recordings": [
    {
      "call_id": "11769866880550143060",
      "start_time": "2025-10-13T14:41:05.454463+00:00",
      "duration_seconds": 86,
      "recording_url": "https://cdn.ringover.com/records/..."
    }
  ]
}
```

---

### 6. Run Audit (Synchronous)

```http
POST /api/audit/run
Content-Type: application/json

{
  "audit_id": 10,
  "fiche_id": "1762209"
}
```

**Response (takes 30-120s):**

```json
{
  "success": true,
  "data": {
    "audit": {
      "config": {
        "id": "10",
        "name": "Audit Rapide - 5 Points"
      },
      "fiche": {
        "fiche_id": "1762209",
        "prospect_name": "Christine BADIN",
        "groupe": "NCA R3"
      },
      "compliance": {
        "score": 86.96,
        "niveau": "BON",
        "points_critiques": "5/5"
      }
    },
    "statistics": {
      "recordings_count": 14,
      "successful_steps": 5,
      "total_tokens": 129716
    },
    "metadata": {
      "started_at": "2025-10-21T09:00:00.000Z",
      "completed_at": "2025-10-21T09:04:00.000Z",
      "duration_ms": 240000
    }
  }
}
```

**Frontend Usage:**

```typescript
const runAudit = async (auditId: number, ficheId: string) => {
  const response = await fetch("http://localhost:3002/api/audit/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audit_id: auditId,
      fiche_id: ficheId,
    }),
  });
  return await response.json();
};

// Show loading state
setLoading(true);
const result = await runAudit(10, "1762209");
setLoading(false);

// Display results
setScore(result.data.audit.compliance.score);
setNiveau(result.data.audit.compliance.niveau);
```

---

### 7. Run Audit (Asynchronous with Inngest)

```http
POST /api/audit/run
Content-Type: application/json

{
  "audit_id": 10,
  "fiche_id": "1762209",
  "async": true
}
```

**Response (immediate):**

```json
{
  "success": true,
  "message": "Audit queued for processing",
  "fiche_id": "1762209",
  "audit_id": 10
}
```

**Then poll for results:**

```http
GET /api/fiches/1762209/audits
```

**Frontend Usage:**

```typescript
// Queue audit
const queueAudit = async (auditId: number, ficheId: string) => {
  await fetch("http://localhost:3002/api/audit/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audit_id: auditId,
      fiche_id: ficheId,
      async: true,
    }),
  });
};

// Poll for results
const checkAuditStatus = async (ficheId: string) => {
  const response = await fetch(
    `http://localhost:3002/api/fiches/${ficheId}/audits`
  );
  return await response.json();
};

// Usage
await queueAudit(10, "1762209");

// Poll every 5 seconds
const interval = setInterval(async () => {
  const { data } = await checkAuditStatus("1762209");
  if (data.length > 0) {
    clearInterval(interval);
    showResults(data[0]);
  }
}, 5000);
```

---

### 8. Get Audit History

```http
GET /api/fiches/:fiche_id/audits?include_details=true
```

**Query Parameters:**

- `include_details` (boolean) - Include full step results and citations

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "scorePercentage": 86.96,
      "niveau": "BON",
      "isCompliant": true,
      "criticalPassed": 5,
      "criticalTotal": 5,
      "createdAt": "2025-10-21T09:04:00.000Z",
      "auditConfig": {
        "name": "Audit Rapide - 5 Points"
      },
      "stepResults": [...]  // if include_details=true
    }
  ],
  "count": 3
}
```

**Frontend Usage:**

```typescript
// Show audit history
const AuditHistory = ({ ficheId }) => {
  const [audits, setAudits] = useState([]);

  useEffect(() => {
    fetch(`http://localhost:3002/api/fiches/${ficheId}/audits`)
      .then((r) => r.json())
      .then(({ data }) => setAudits(data));
  }, [ficheId]);

  return (
    <div>
      {audits.map((audit) => (
        <div key={audit.id}>
          <h3>{audit.auditConfig.name}</h3>
          <p>Score: {audit.scorePercentage}%</p>
          <p>Niveau: {audit.niveau}</p>
          <p>Date: {new Date(audit.createdAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
};
```

---

### 9. Get Full Audit Details

```http
GET /api/audits/:audit_id
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "123",
    "scorePercentage": 86.96,
    "niveau": "BON",
    "ficheCache": {
      "ficheId": "1762209",
      "prospectNom": "BADIN",
      "prospectPrenom": "Christine"
    },
    "stepResults": [
      {
        "stepName": "Présentation légale",
        "conforme": "CONFORME",
        "score": 10,
        "niveauConformite": "EXCELLENT",
        "commentaireGlobal": "...",
        "controlPoints": [
          {
            "point": "Identité + NCA",
            "statut": "PRESENT",
            "commentaire": "...",
            "citations": [
              {
                "texte": "Bonjour madame, c'est Mathieu...",
                "minutage": "00:05",
                "speaker": "speaker_0",
                "recordingDate": "13/10/2025",
                "recordingTime": "14:41"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

### 10. Transcribe Fiche

```http
POST /api/fiches/:fiche_id/transcribe
```

**Response:**

```json
{
  "success": true,
  "data": {
    "total": 14,
    "transcribed": 14,
    "newTranscriptions": 5
  }
}
```

---

### 11. Transcription Status

```http
GET /api/fiches/:fiche_id/transcription-status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "ficheId": "1762209",
    "total": 14,
    "transcribed": 10,
    "pending": 4,
    "percentage": 71,
    "recordings": [
      {
        "callId": "11769866880550143060",
        "hasTranscription": true,
        "transcriptionId": "7Z3yb9Pd071yTTahMOZW",
        "transcribedAt": "2025-10-21T08:30:00.000Z"
      }
    ]
  }
}
```

**Frontend Usage:**

```typescript
// Transcription progress component
const TranscriptionProgress = ({ ficheId }) => {
  const [status, setStatus] = useState(null);

  const checkStatus = async () => {
    const res = await fetch(
      `http://localhost:3002/api/fiches/${ficheId}/transcription-status`
    );
    const { data } = await res.json();
    setStatus(data);
  };

  const startTranscription = async () => {
    await fetch(`http://localhost:3002/api/fiches/${ficheId}/transcribe`, {
      method: "POST",
    });
    // Poll for status
    const interval = setInterval(checkStatus, 3000);
  };

  return (
    <div>
      <button onClick={startTranscription}>Transcribe</button>
      {status && (
        <progress value={status.percentage} max="100">
          {status.percentage}%
        </progress>
      )}
    </div>
  );
};
```

---

### 12. Batch Audit

```http
POST /api/audit/batch
Content-Type: application/json

{
  "fiche_ids": ["1762209", "1720487", "1756959"],
  "audit_config_id": 10
}
```

**Response:**

```json
{
  "success": true,
  "message": "Batch audit queued for 3 fiches",
  "fiche_ids": ["1762209", "1720487", "1756959"],
  "audit_config_id": 10
}
```

---

## 🎨 Common Frontend Patterns

### Pattern 1: Fiche Selection & Audit

```typescript
// 1. Load fiches for a date
const loadFiches = async (date: string) => {
  const res = await fetch(
    `http://localhost:3002/api/fiches/search?date=${date}`
  );
  const { fiches } = await res.json();
  return fiches;
};

// 2. Load audit configs
const loadAuditConfigs = async () => {
  const res = await fetch("http://localhost:3002/api/audit-configs");
  const { data } = await res.json();
  return data;
};

// 3. Run audit
const runAudit = async (ficheId: string, auditId: number) => {
  const res = await fetch("http://localhost:3002/api/audit/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fiche_id: ficheId,
      audit_id: auditId,
      async: true, // Background processing
    }),
  });
  return await res.json();
};

// Complete flow
const fiches = await loadFiches("2025-10-13");
const configs = await loadAuditConfigs();
await runAudit(fiches[0].id, configs[0].id);
```

---

### Pattern 2: Real-time Audit Dashboard

```typescript
interface AuditDashboardProps {
  ficheId: string;
}

const AuditDashboard = ({ ficheId }: AuditDashboardProps) => {
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load audit history
  useEffect(() => {
    const loadAudits = async () => {
      const res = await fetch(
        `http://localhost:3002/api/fiches/${ficheId}/audits`
      );
      const { data } = await res.json();
      setAudits(data);
    };
    loadAudits();

    // Refresh every 10 seconds
    const interval = setInterval(loadAudits, 10000);
    return () => clearInterval(interval);
  }, [ficheId]);

  return (
    <div>
      <h2>Audit History</h2>
      {audits.map((audit) => (
        <AuditCard key={audit.id} audit={audit} />
      ))}
    </div>
  );
};
```

---

### Pattern 3: Batch Processing with Progress

```typescript
const BatchAuditProcessor = () => {
  const [progress, setProgress] = useState(0);

  const processBatch = async (ficheIds: string[], auditConfigId: number) => {
    // Queue batch
    await fetch("http://localhost:3002/api/audit/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fiche_ids: ficheIds,
        audit_config_id: auditConfigId,
      }),
    });

    // Monitor progress
    const checkProgress = async () => {
      let completed = 0;
      for (const ficheId of ficheIds) {
        const res = await fetch(
          `http://localhost:3002/api/fiches/${ficheId}/audits`
        );
        const { data } = await res.json();
        if (data.length > 0) completed++;
      }
      setProgress((completed / ficheIds.length) * 100);

      if (completed === ficheIds.length) {
        clearInterval(interval);
      }
    };

    const interval = setInterval(checkProgress, 5000);
  };

  return (
    <div>
      <progress value={progress} max="100" />
      <span>{Math.round(progress)}%</span>
    </div>
  );
};
```

---

## 🔄 Typical Workflows

### Workflow 1: Daily Audit Process

```typescript
// 1. Get fiches for today
const today = new Date().toISOString().split("T")[0];
const { fiches } = await fetch(
  `http://localhost:3002/api/fiches/search?date=${today}`
).then((r) => r.json());

// 2. Run quick audit for all
await fetch("http://localhost:3002/api/audit/batch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fiche_ids: fiches.map((f) => f.id),
    audit_config_id: 10, // Quick audit
  }),
});

// 3. Monitor results
// Poll /api/fiches/:id/audits for each fiche
```

---

### Workflow 2: Detailed Audit Review

```typescript
// 1. Load fiche details
const fiche = await fetch(`http://localhost:3002/api/fiches/1762209`).then(
  (r) => r.json()
);

// 2. Check transcription status
const status = await fetch(
  `http://localhost:3002/api/fiches/1762209/transcription-status`
).then((r) => r.json());

// 3. If needed, transcribe
if (status.data.pending > 0) {
  await fetch("http://localhost:3002/api/fiches/1762209/transcribe", {
    method: "POST",
  });
}

// 4. Run comprehensive audit
const audit = await fetch("http://localhost:3002/api/audit/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    audit_id: 8, // Comprehensive 18-step audit
    fiche_id: "1762209",
  }),
}).then((r) => r.json());

// 5. Display detailed results
const detailed = await fetch(
  `http://localhost:3002/api/audits/${audit.data.id}`
).then((r) => r.json());
```

---

## 📊 Response Status Codes

| Code | Meaning      | Action                   |
| ---- | ------------ | ------------------------ |
| 200  | Success      | Process response         |
| 201  | Created      | Resource created         |
| 400  | Bad Request  | Check request format     |
| 404  | Not Found    | Resource doesn't exist   |
| 500  | Server Error | Retry or contact support |

---

## 🎯 Quick Reference

### Get Fiches for Date

```javascript
GET /api/fiches/search?date=2025-10-13
```

### Run Audit (Quick)

```javascript
POST /api/audit/run
{ "audit_id": 10, "fiche_id": "1762209" }
```

### Run Audit (Background)

```javascript
POST /api/audit/run
{ "audit_id": 10, "fiche_id": "1762209", "async": true }
```

### Get Audit Results

```javascript
GET /api/fiches/:fiche_id/audits
```

### Get Full Details

```javascript
GET /api/audits/:audit_id
```

---

## 🛠️ TypeScript Types

```typescript
interface AuditConfig {
  id: string;
  name: string;
  description: string;
  stepsCount: number;
  isActive: boolean;
}

interface Fiche {
  id: string;
  cle: string;
  nom: string;
  prenom: string;
  telephone: string;
  email: string;
  statut: string;
  date_insertion: string;
}

interface AuditResult {
  id: string;
  scorePercentage: number;
  niveau: "EXCELLENT" | "BON" | "ACCEPTABLE" | "INSUFFISANT" | "REJET";
  isCompliant: boolean;
  criticalPassed: number;
  criticalTotal: number;
  createdAt: string;
}

interface AuditCompliance {
  score: number;
  niveau: string;
  points_critiques: string;
}
```

---

## 🔗 Additional Resources

- **Swagger UI:** `http://localhost:3002/api-docs`
- **API Spec JSON:** `http://localhost:3002/api-docs.json`
- **Inngest Dashboard:** `http://localhost:8288` (when running `npm run inngest`)

---

## 💡 Best Practices

1. **Use async for long-running audits** (>30s)
2. **Cache audit configs** in frontend state
3. **Poll for results** when using async execution
4. **Show loading states** during synchronous audits
5. **Handle errors gracefully** with user-friendly messages
6. **Use batch endpoints** for processing multiple fiches

---

## 🚨 Error Handling

```typescript
const runAuditSafe = async (auditId: number, ficheId: string) => {
  try {
    const response = await fetch("http://localhost:3002/api/audit/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audit_id: auditId, fiche_id: ficheId }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || result.error);
    }

    return result.data;
  } catch (error) {
    console.error("Audit failed:", error);
    // Show user-friendly error
    toast.error("Audit failed. Please try again.");
    return null;
  }
};
```

---

**Last Updated:** October 21, 2025  
**API Version:** 2.3.0  
**Support:** Check Swagger UI for latest endpoint details
