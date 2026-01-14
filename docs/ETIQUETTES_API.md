# Étiquettes API Documentation

## Overview

The Étiquettes API provides endpoints to:
1. **List** all available étiquette (tag/label) definitions from GestFiches
2. **Add** an étiquette to a fiche
3. **Remove** an étiquette from a fiche
4. **Toggle** an étiquette on a fiche (same as add/remove, depending on current state)

Étiquettes are color-coded labels used to categorize and visually identify fiches, alertes, RDV, and commentaires in the GestFiches CRM system.

---

## Authentication

All endpoints require a valid **PHPSESSID** session cookie. You can provide it in two ways:

### Option 1: Automatic Session Management (Recommended)
The API automatically uses cached sessions from:
- `SessionManager` (Redis-backed or file-based)
- Running browser managers (`headless_search_manager` / `stealth_search_manager`)
- Legacy `phpsessid.txt` file

If no valid session exists, the endpoint will return `500` with error message `"Failed to obtain a valid session"`.

### Option 2: Explicit Session (Query Parameter)
Pass `?phpsessid=YOUR_SESSION_ID` as a query parameter:

```bash
GET /api/etiquettes?phpsessid=abc123xyz456...
```

---

## Endpoints

### 1. List All Étiquettes

**GET** `/api/etiquettes`

Fetches and parses all étiquette definitions from GestFiches.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phpsessid` | string | No | Optional PHPSESSID for authentication |

#### Response Schema

```json
{
  "success": true,
  "message": "Successfully retrieved etiquettes",
  "data": {
    "fiches": [
      {
        "id": "2",
        "libelle": "LD Confirmé",
        "background": "#2A8C30",
        "color": "#fff",
        "raw_style": "background:#2A8C30;color:#fff;padding:4px;..."
      },
      {
        "id": "3",
        "libelle": "Qualité confirmée",
        "background": "#4CAF50",
        "color": "#fff",
        "raw_style": "background:#4CAF50;color:#fff;..."
      }
    ],
    "alertes": [...],
    "rdv": [...],
    "commentaires": [...]
  },
  "timestamp": "2026-01-06T16:30:00.123456"
}
```

#### Example Request

```bash
curl -X GET "http://localhost:8000/api/etiquettes"
```

#### Example Response

```json
{
  "success": true,
  "message": "Successfully retrieved etiquettes",
  "data": {
    "fiches": [
      {
        "id": "1",
        "libelle": "ANI",
        "background": "GREEN",
        "color": "BLACK",
        "raw_style": "background:GREEN;color:BLACK;"
      },
      {
        "id": "2",
        "libelle": "LD Confirmé",
        "background": "#2A8C30",
        "color": "#fff",
        "raw_style": "background:#2A8C30;color:#fff;padding:4px;margin:4px;float:left;border-radius:4px;"
      },
      {
        "id": "11",
        "libelle": "Appel entrant",
        "background": "#00bfff",
        "color": "#fff",
        "raw_style": "background:#00bfff;color:#fff;"
      }
    ],
    "alertes": [
      {
        "id": "1",
        "libelle": "Instance",
        "background": "white",
        "color": "black",
        "raw_style": "background:white;color:black;"
      }
    ],
    "rdv": [
      {
        "id": "4",
        "libelle": "RAPPEL",
        "background": "yellow",
        "color": "black",
        "raw_style": "background:yellow;color:black;"
      }
    ],
    "commentaires": [
      {
        "id": "5",
        "libelle": "Demande Client",
        "background": "brown",
        "color": "white",
        "raw_style": "background:brown;color:white;"
      }
    ]
  },
  "timestamp": "2026-01-06T16:30:00.123456"
}
```

---

### 2. Add Étiquette to Fiche

**POST** `/api/etiquettes/fiches/{fiche_id}/add`

Adds an étiquette to a specific fiche.

#### Path Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fiche_id` | string | Yes | The fiche ID (e.g., `"1792256"`) |

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phpsessid` | string | No | Optional PHPSESSID for authentication |

#### Request Body

```json
{
  "etiquette_id": "2",
  "k": "72a6260f957cee1d70d2da8b0264c773"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `etiquette_id` | string | Yes | The ID of the étiquette to add (from the list endpoint) |
| `k` | string | Yes | Security token (see [Understanding the `k` Parameter](#understanding-the-k-parameter)) |

#### Response Schema

```json
{
  "success": true,
  "message": "Etiquette toggled successfully",
  "data": {
    "fiche_id": "1792256",
    "etiquette_id": "2",
    "html": "<div style=\"background:#2A8C30;color:#fff;...\">LD Confirmé (06/01/2026) [<a ...>X</a>]</div>",
    "next_k": "60d567c09c25cb9e3d2718271417a04e"
  },
  "timestamp": "2026-01-06T16:30:00.123456"
}
```

#### Example Request

```bash
curl -X POST "http://localhost:8000/api/etiquettes/fiches/1792256/add" \
  -H "Content-Type: application/json" \
  -d '{
    "etiquette_id": "2",
    "k": "72a6260f957cee1d70d2da8b0264c773"
  }'
```

---

### 3. Remove Étiquette from Fiche

**POST** `/api/etiquettes/fiches/{fiche_id}/remove`

Removes an étiquette from a specific fiche.

#### Path Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fiche_id` | string | Yes | The fiche ID (e.g., `"1792256"`) |

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phpsessid` | string | No | Optional PHPSESSID for authentication |

#### Request Body

```json
{
  "etiquette_id": "2",
  "k": "60d567c09c25cb9e3d2718271417a04e"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `etiquette_id` | string | Yes | The ID of the étiquette to remove |
| `k` | string | Yes | The `next_k` token returned from the add operation |

#### Response Schema

```json
{
  "success": true,
  "message": "Etiquette toggled successfully",
  "data": {
    "fiche_id": "1792256",
    "etiquette_id": "2",
    "html": "",
    "next_k": null
  },
  "timestamp": "2026-01-06T16:30:00.123456"
}
```

#### Example Request

```bash
curl -X POST "http://localhost:8000/api/etiquettes/fiches/1792256/remove" \
  -H "Content-Type: application/json" \
  -d '{
    "etiquette_id": "2",
    "k": "60d567c09c25cb9e3d2718271417a04e"
  }'
```

---

### 4. Toggle Étiquette (Generic)

**POST** `/api/etiquettes/fiches/{fiche_id}/toggle`

Generic endpoint that adds or removes an étiquette depending on the `k` parameter provided.

This endpoint behaves identically to `/add` or `/remove` – the distinction is conceptual only. The CRM backend determines whether to add or remove based on the `k` value.

#### Request & Response

Same as `/add` and `/remove` endpoints above.

---

## Understanding the `k` Parameter

The `k` parameter is a **security token** used by GestFiches to authorize étiquette operations. It works as follows:

### For Adding an Étiquette
- **Initial `k`**: Use the fiche's **`cle`** (security key)
- The `cle` is available from:
  - Search results (`GET /api/fiches/search`)
  - Fiche detail endpoint (`GET /api/fiches/{fiche_id}?cle=...`)

### For Removing an Étiquette
- **Use `next_k`**: After adding an étiquette, the response contains a `next_k` field
- This `next_k` is extracted from the HTML response's `onclick` attribute:
  ```html
  <a href="javascript:void(0);" onclick="ajoutEtiquetteFiche('2','1792256','60d567c09c25cb9e3d2718271417a04e')">X</a>
  ```
- The third parameter (`60d567c09c25cb9e3d2718271417a04e`) is the `next_k`

### Token Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     Étiquette Token Lifecycle                    │
└─────────────────────────────────────────────────────────────────┘

1. Get fiche `cle` from search or detail endpoint
   ↓
2. Add étiquette using `k = cle`
   POST /add { "etiquette_id": "2", "k": "<cle>" }
   ↓
3. Response includes `next_k` in data
   { "next_k": "<new_token>" }
   ↓
4. Remove étiquette using `k = next_k`
   POST /remove { "etiquette_id": "2", "k": "<next_k>" }
```

---

## Complete Workflow Example

### Step 1: Get Available Étiquettes

```bash
curl -X GET "http://localhost:8000/api/etiquettes"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fiches": [
      { "id": "2", "libelle": "LD Confirmé", "background": "#2A8C30", "color": "#fff" },
      { "id": "3", "libelle": "Qualité confirmée", "background": "#4CAF50", "color": "#fff" }
    ]
  }
}
```

### Step 2: Search for a Fiche to Get Its `cle`

```bash
curl -X POST "http://localhost:8000/api/fiches/search" \
  -H "Content-Type: application/json" \
  -d '{
    "critere_1": "F.id",
    "recherche_1": "1792256"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "1792256",
      "cle": "72a6260f957cee1d70d2da8b0264c773",
      "nom": "DUPONT",
      "prenom": "Jean"
    }
  ]
}
```

### Step 3: Add the Étiquette

```bash
curl -X POST "http://localhost:8000/api/etiquettes/fiches/1792256/add" \
  -H "Content-Type: application/json" \
  -d '{
    "etiquette_id": "2",
    "k": "72a6260f957cee1d70d2da8b0264c773"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Etiquette toggled successfully",
  "data": {
    "fiche_id": "1792256",
    "etiquette_id": "2",
    "html": "<div style=\"background:#2A8C30;color:#fff;...\">LD Confirmé (06/01/2026) [<a ...>X</a>]</div>",
    "next_k": "60d567c09c25cb9e3d2718271417a04e"
  }
}
```

### Step 4: Remove the Étiquette (Using `next_k`)

```bash
curl -X POST "http://localhost:8000/api/etiquettes/fiches/1792256/remove" \
  -H "Content-Type: application/json" \
  -d '{
    "etiquette_id": "2",
    "k": "60d567c09c25cb9e3d2718271417a04e"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Etiquette toggled successfully",
  "data": {
    "fiche_id": "1792256",
    "etiquette_id": "2",
    "html": "",
    "next_k": null
  }
}
```

---

## Common Use Cases

### 1. Tag a New Lead as "Qualité confirmée"

```bash
# Get the fiche ID and cle from your lead creation response
FICHE_ID="1792256"
FICHE_CLE="72a6260f957cee1d70d2da8b0264c773"

# Add the "Qualité confirmée" étiquette (ID: 3)
curl -X POST "http://localhost:8000/api/etiquettes/fiches/$FICHE_ID/add" \
  -H "Content-Type: application/json" \
  -d "{\"etiquette_id\":\"3\",\"k\":\"$FICHE_CLE\"}"
```

### 2. Bulk Tag Multiple Fiches

```python
import requests

BASE_URL = "http://localhost:8000/api"

# Get all fiches that need tagging
search_response = requests.post(f"{BASE_URL}/fiches/search", json={
    "critere_1": "F.id_etat",
    "recherche_1": "43"  # New fiches
})

fiches = search_response.json()["data"]

# Tag each one
for fiche in fiches:
    response = requests.post(
        f"{BASE_URL}/etiquettes/fiches/{fiche['id']}/add",
        json={
            "etiquette_id": "2",  # LD Confirmé
            "k": fiche["cle"]
        }
    )
    print(f"Tagged fiche {fiche['id']}: {response.json()['success']}")
```

### 3. Remove Old Tags from a Fiche

```python
import requests

BASE_URL = "http://localhost:8000/api"
FICHE_ID = "1792256"

# Step 1: Get fiche detail to see current étiquettes
detail = requests.get(f"{BASE_URL}/fiches/{FICHE_ID}?cle=...").json()

# Step 2: Add an étiquette to get the `next_k` for removal
add_response = requests.post(
    f"{BASE_URL}/etiquettes/fiches/{FICHE_ID}/add",
    json={"etiquette_id": "2", "k": detail["data"]["information"]["cle"]}
).json()

next_k = add_response["data"]["next_k"]

# Step 3: Immediately remove it
remove_response = requests.post(
    f"{BASE_URL}/etiquettes/fiches/{FICHE_ID}/remove",
    json={"etiquette_id": "2", "k": next_k}
)

print(f"Removed: {remove_response.json()['success']}")
```

---

## Error Handling

### Common Errors

| Status | Error | Cause | Solution |
|--------|-------|-------|----------|
| `500` | `"Failed to obtain a valid session"` | No cached PHPSESSID available | 1. Pass `?phpsessid=...` query param<br>2. Create `phpsessid.txt` with valid session<br>3. Fix `FORM_LOGIN_USER`/`FORM_LOGIN_PASS` in `.env` |
| `500` | `"Session expired, redirected to login page"` | PHPSESSID is stale/expired | Get a fresh session from browser or wait for auto-refresh |
| `400` | `"Field required"` | Missing required field in request body | Check that `etiquette_id` and `k` are provided |
| `500` | `"AJAX request failed: HTTP 404"` | Invalid étiquette ID or fiche ID | Verify IDs are correct using list/search endpoints |

### Debugging Tips

1. **Check session validity**: Call `GET /api/leads/new` – if it fails with session error, the problem is session-wide
2. **Enable debug mode**: Set `DEBUG=true` in `.env` and check `data/debug/` for saved HTML responses
3. **Verify étiquette IDs**: Call `GET /api/etiquettes` to confirm the étiquette ID exists
4. **Check fiche `cle`**: Make sure you're using the correct, current `cle` from a recent search/detail call

---

## Implementation Notes

### Session Management
- Étiquette endpoints use the same session management as other scraping endpoints
- Sessions are shared via `SessionManager` (Redis-backed when `REDIS_ENABLED=true`)
- The running browser manager (`headless_search_manager` / `stealth_search_manager`) automatically refreshes sessions every 20 minutes

### HTML Response
- The `html` field in responses contains the raw HTML returned by GestFiches
- This HTML includes the styled `<div>` with the étiquette label and removal link
- The API extracts `next_k` from the `onclick` attribute automatically

### Rate Limiting
- No built-in rate limiting in the API
- GestFiches may rate-limit if too many requests are made rapidly
- Recommended: Add 200-500ms delay between bulk operations

---

## Related Endpoints

- `GET /api/fiches/search` - Search for fiches to get their `id` and `cle`
- `GET /api/fiches/{fiche_id}` - Get fiche detail including current étiquettes
- `GET /api/health` - Check API health and session status

---

## OpenAPI / Swagger

Interactive API documentation is available at:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

---

## Changelog

### 2026-01-06
- Initial release of Étiquettes API
- Added endpoints: `/etiquettes`, `/fiches/{id}/add`, `/fiches/{id}/remove`, `/fiches/{id}/toggle`
- Integrated with existing session management system
- Added automatic `next_k` extraction from AJAX responses

