# API Documentation

## Overview

The AI Audit System now runs as a REST API server that accepts audit requests and returns results.

**Base URL:** `http://localhost:3000`

## Endpoints

### 1. Health Check

**GET** `/health`

Check if the server is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-10-21T10:30:00.000Z",
  "service": "ai-audit-system",
  "version": "2.2.0"
}
```

---

### 2. List Audit Configurations

**GET** `/api/audit-configs`

Get all available active audit configurations.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "Audit Complet - 18 Points",
      "description": "Audit détaillé avec 18 étapes de vérification",
      "stepsCount": 18,
      "createdAt": "2025-10-01T00:00:00.000Z"
    },
    {
      "id": "3",
      "name": "Audit Rapide - 5 Points",
      "description": "Audit rapide - points critiques uniquement",
      "stepsCount": 5,
      "createdAt": "2025-10-15T00:00:00.000Z"
    }
  ],
  "count": 2
}
```

---

### 3. Get Audit Configuration Details

**GET** `/api/audit-configs/:id`

Get detailed information about a specific audit configuration.

**Parameters:**

- `id` (path) - Audit configuration ID

**Example:** `GET /api/audit-configs/3`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "3",
    "name": "Audit Rapide - Complémentaire Santé NCA",
    "description": "Audit ultra-rapide de conformité minimale",
    "prompt": "Vérifiez uniquement les points critiques...",
    "steps": [
      {
        "position": 1,
        "name": "Présentation légale (ORIAS + Enregistrement)",
        "description": "Vérification de la présentation légale...",
        "severityLevel": "CRITICAL",
        "isCritical": true,
        "weight": 10,
        "controlPoints": [
          "Annonce de l'enregistrement de l'appel",
          "Déclaration du numéro ORIAS"
        ],
        "keywords": ["orias", "enregistrement", "courtier"]
      }
    ]
  }
}
```

---

### 4. Run Audit (Specific Config)

**POST** `/api/audit/run`

Run an audit with a specific audit configuration ID and fiche ID.

**Request Body:**

```json
{
  "audit_id": 3,
  "fiche_id": "1762209"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "audit": {
      "config": {
        "id": "3",
        "name": "Audit Rapide - Complémentaire Santé NCA",
        "description": "Audit ultra-rapide..."
      },
      "fiche": {
        "fiche_id": "1762209",
        "prospect_name": "Christine BADIN",
        "groupe": "NCA R3"
      },
      "results": {
        "metadata": { ... },
        "steps": [ ... ],
        "statistics": { ... }
      },
      "compliance": {
        "score": 85.5,
        "niveau": "BON",
        "points_critiques": "5/5",
        "poids_obtenu": 42.5,
        "poids_total": 50
      }
    },
    "statistics": {
      "recordings_count": 14,
      "transcriptions_count": 14,
      "timeline_chunks": 156,
      "successful_steps": 5,
      "failed_steps": 0,
      "total_time_seconds": 45.2,
      "total_tokens": 125000
    },
    "metadata": {
      "started_at": "2025-10-21T10:30:00.000Z",
      "completed_at": "2025-10-21T10:31:00.000Z",
      "duration_ms": 60000
    }
  },
  "metadata": {
    "audit_id": 3,
    "fiche_id": "1762209",
    "timestamp": "2025-10-21T10:31:00.000Z"
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": "Audit execution failed",
  "message": "Fiche not found or API error"
}
```

---

### 5. Run Audit (Latest Config)

**POST** `/api/audit/run-latest`

Run an audit with the latest active audit configuration.

**Request Body:**

```json
{
  "fiche_id": "1762209"
}
```

**Response:** Same as `/api/audit/run`

---

## Usage Examples

### cURL

#### List Audit Configs

```bash
curl http://localhost:3000/api/audit-configs
```

#### Get Specific Config

```bash
curl http://localhost:3000/api/audit-configs/3
```

#### Run Audit (Specific Config)

```bash
curl -X POST http://localhost:3000/api/audit/run \
  -H "Content-Type: application/json" \
  -d '{
    "audit_id": 3,
    "fiche_id": "1762209"
  }'
```

#### Run Audit (Latest Config)

```bash
curl -X POST http://localhost:3000/api/audit/run-latest \
  -H "Content-Type: application/json" \
  -d '{
    "fiche_id": "1762209"
  }'
```

### JavaScript/Node.js

```javascript
// Run audit
const response = await fetch("http://localhost:3000/api/audit/run", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    audit_id: 3,
    fiche_id: "1762209",
  }),
});

const result = await response.json();
console.log("Audit Score:", result.data.audit.compliance.score);
```

### Python

```python
import requests

# Run audit
response = requests.post(
    'http://localhost:3000/api/audit/run',
    json={
        'audit_id': 3,
        'fiche_id': '1762209'
    }
)

result = response.json()
print(f"Audit Score: {result['data']['audit']['compliance']['score']}")
```

---

## Response Structure

### Compliance Scores

- **Score:** 0-100 (percentage)
- **Niveau:**
  - `EXCELLENT` - Score ≥ 90%
  - `BON` - Score ≥ 75%
  - `ACCEPTABLE` - Score ≥ 60%
  - `INSUFFISANT` - Score < 60%
  - `REJET` - Critical points not passed

### Audit Steps

Each step includes:

- `step_metadata` - Step configuration
- `conforme` - "CONFORME" / "NON_CONFORME" / "TRAITE"
- `score` - Points earned for this step
- `points_controle` - Detailed checkpoint results
- `citations` - Evidence from conversations

---

## Error Handling

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request (missing parameters, invalid data)
- `404` - Not Found (audit config or fiche not found)
- `500` - Internal Server Error (audit execution failed)

### Error Response Format

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "stack": "Stack trace (development only)"
}
```

---

## Performance

### Typical Audit Duration

- **Fast Audit (5 steps):** ~30-45 seconds
- **Full Audit (18 steps):** ~60-120 seconds

**Factors affecting performance:**

- Number of recordings
- Recording duration
- Transcription cache (cached = instant)
- GPT-5 response time

### Rate Limits

No rate limits currently enforced. Recommended:

- Max 5 concurrent audits
- Allow 2-3 minutes between audits

---

## Server Configuration

### Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=development  # or 'production'

# API Keys
OPENAI_API_KEY="..."
ELEVENLABS_API_KEY="..."

# Database
AUDIT_CONFIG_DATABASE_URL="..."
AUDIT_CONFIG_DIRECT_URL="..."

# Fiche API
FICHE_API_BASE_URL="https://api.devis-mutuelle-pas-cher.com"
```

### Starting the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

---

## Monitoring

### Health Check

Use the `/health` endpoint for:

- Load balancer health checks
- Uptime monitoring
- Service discovery

### Logs

Server logs include:

- Request timestamps
- Audit progress
- Error details
- Performance metrics

---

## Security Notes

⚠️ **Important:**

- No authentication currently implemented
- Recommended: Add API key authentication
- Consider rate limiting for production
- Use HTTPS in production
- Validate all input data

---

## Troubleshooting

### Server Won't Start

**Check:**

1. Port 3000 is not in use
2. Environment variables are set
3. Database connection is working

**Test:**

```bash
npm run test:db
```

### Audit Fails

**Common causes:**

1. Invalid fiche_id
2. Fiche has no recordings
3. API connection issues
4. Database connection lost

**Check logs for details**

---

## Future Enhancements

Planned features:

- ✅ WebSocket support for real-time progress
- ✅ Audit queue system
- ✅ Authentication & authorization
- ✅ Rate limiting
- ✅ Webhook notifications
- ✅ Audit history tracking
- ✅ Batch audit processing

---

**Version:** 2.3.0  
**Last Updated:** October 21, 2025
