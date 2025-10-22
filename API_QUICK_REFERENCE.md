# API Quick Reference Card

## 📡 Backend API Communication

**FOR YOUR FRONTEND TO CALL THE BACKEND**

- **Backend:** `http://localhost:3002` (AI Audit API Server)
- **Frontend:** `http://localhost:3000` (Your React/Vue/Svelte app)
- **Method:** REST API calls with fetch/axios

---

## Base URL

```
http://localhost:3002
```

---

## 🎯 Most Used Endpoints

### Search Fiches

```http
GET /api/fiches/search?date=2025-10-13
→ { fiches: [...], total: 12 }
```

### Run Audit (Sync)

```http
POST /api/audit/run
{"audit_id": 10, "fiche_id": "1762209"}
→ Full audit results (30-120s wait)
```

### Run Audit (Async)

```http
POST /api/audit/run
{"audit_id": 10, "fiche_id": "1762209", "async": true}
→ {"message": "Audit queued"}
```

### Get Audit Results

```http
GET /api/fiches/1762209/audits
→ { data: [audit1, audit2, ...], count: 3 }
```

### List Audit Configs

```http
GET /api/audit-configs
→ { data: [config1, config2, ...], count: 3 }
```

---

## 🔢 Audit Config IDs

- **ID 8:** Comprehensive Audit (18 steps)
- **ID 9:** Essential Audit (8 steps)
- **ID 10:** Quick Audit (5 steps)

---

## 📊 Response Format

All responses follow:

```json
{
  "success": true,
  "data": { ... },
  "count": 10  // for lists
}
```

Errors:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Details"
}
```

---

## ⚡ Quick Examples

### React Hook - Run Audit

```tsx
const useRunAudit = () => {
  const [loading, setLoading] = useState(false);

  const run = async (ficheId: string, auditId: number) => {
    setLoading(true);
    const res = await fetch("http://localhost:3002/api/audit/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fiche_id: ficheId, audit_id: auditId }),
    });
    setLoading(false);
    return res.json();
  };

  return { run, loading };
};
```

### Vue - Load Fiches

```javascript
export default {
  data() {
    return { fiches: [], loading: false };
  },
  methods: {
    async loadFiches(date) {
      this.loading = true;
      const res = await fetch(
        `http://localhost:3002/api/fiches/search?date=${date}`
      );
      const data = await res.json();
      this.fiches = data.fiches;
      this.loading = false;
    },
  },
};
```

### Svelte - Audit History

```svelte
<script>
  export let ficheId;
  let audits = [];

  $: loadAudits(ficheId);

  async function loadAudits(id) {
    const res = await fetch(`http://localhost:3002/api/fiches/${id}/audits`);
    const { data } = await res.json();
    audits = data;
  }
</script>

{#each audits as audit}
  <div>Score: {audit.scorePercentage}%</div>
{/each}
```

---

## 📱 All Endpoints Summary

| Method | Endpoint                               | Purpose              |
| ------ | -------------------------------------- | -------------------- |
| GET    | `/health`                              | Health check         |
| GET    | `/api/audit-configs`                   | List configs         |
| GET    | `/api/audit-configs/:id`               | Get config           |
| POST   | `/api/audit-configs`                   | Create config        |
| PUT    | `/api/audit-configs/:id`               | Update config        |
| DELETE | `/api/audit-configs/:id`               | Delete config        |
| GET    | `/api/fiches/search?date=`             | Search fiches        |
| GET    | `/api/fiches/:id`                      | Get fiche            |
| GET    | `/api/fiches/:id/cache`                | View cache           |
| GET    | `/api/fiches/:id/recordings`           | Get recordings       |
| GET    | `/api/fiches/:id/transcription-status` | Transcription status |
| POST   | `/api/fiches/:id/transcribe`           | Transcribe           |
| GET    | `/api/fiches/:id/audits`               | Audit history        |
| GET    | `/api/audits/:id`                      | Full audit details   |
| POST   | `/api/audit/run`                       | Run audit            |
| POST   | `/api/audit/batch`                     | Batch audit          |
| POST   | `/api/transcribe/batch`                | Batch transcribe     |

---

## 🎨 UI Components Ideas

### Fiche List Component

- Date picker → Fetch fiches
- Table with fiche details
- "Audit" button per row
- Status badges

### Audit Config Selector

- Dropdown with configs
- Show steps count
- Description tooltip

### Audit Results View

- Score gauge (0-100%)
- Niveau badge (color-coded)
- Step-by-step breakdown
- Citations with timestamps

### Batch Processor

- Multi-select fiches
- Progress bar
- Real-time status updates
- Results summary

---

**Full Documentation:** See `FRONTEND_API_GUIDE.md`  
**Swagger UI:** `http://localhost:3002/api-docs`
