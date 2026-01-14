# Provenances API Documentation

## Overview

The Provenances API provides an endpoint to list all available **provenances** (lead sources) configured in the GestFiches CRM system.

Provenances define:
- Lead source names and IDs
- Webservice configurations and API keys
- Cost per fiche
- Active/inactive status
- Agency assignments

This information is essential for:
- Understanding which lead sources are available
- Getting webservice keys (`cle_ws`) for API integrations
- Mapping provenance IDs to human-readable names
- Checking which webservices (MER, IFRAME, TARIFS) are enabled for each source

---

## Authentication

The endpoint requires a valid **PHPSESSID** session cookie. You can provide it in two ways:

### Option 1: Automatic Session Management (Recommended)
The API automatically uses cached sessions from:
- Running browser managers (`headless_search_manager` / `stealth_search_manager`)
- `SessionManager` (Redis-backed or file-based)
- Legacy `phpsessid.txt` file

### Option 2: Explicit Session (Query Parameter)
Pass `?phpsessid=YOUR_SESSION_ID` as a query parameter.

---

## Endpoint

### List All Provenances

**GET** `/api/provenances`

Fetches and parses all provenance (lead source) definitions from GestFiches.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phpsessid` | string | No | Optional PHPSESSID for authentication |

#### Response Schema

```json
{
  "success": true,
  "message": "Successfully retrieved provenances",
  "data": {
    "provenances": [
      {
        "id": "111",
        "nom": "NCA",
        "cout": "0€",
        "active": true,
        "type_lead": null,
        "ws_mer_enabled": true,
        "ws_mer_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=mer&id_prov=111&cle_ws=7719b3295c9edb7d9a682fdb6498b717",
        "ws_mer_cle": "7719b3295c9edb7d9a682fdb6498b717",
        "ws_mer_agence": "3-NCAR1",
        "ws_iframe_enabled": false,
        "ws_iframe_url": null,
        "ws_iframe_cf": null,
        "ws_iframe_agence": null,
        "ws_tarifs_enabled": false,
        "ws_tarifs_url": null,
        "ws_tarifs_cle": null,
        "ws_tarifs_agence": null,
        "provstats_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=provstats&id_prov=111&cle_ws=...",
        "provstatsdet_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=provstatsdet&id_prov=111&cle_ws=...",
        "provstatssante_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=provstatssante&id_prov=111&cle_ws=...",
        "doublon_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=doublon&id_prov=111&cle_ws=..."
      }
    ],
    "total_count": 115
  },
  "timestamp": "2026-01-07T10:30:00.123456"
}
```

#### Example Request

```bash
curl -X GET "http://localhost:8000/api/provenances"
```

#### Example Response (Partial)

```json
{
  "success": true,
  "message": "Successfully retrieved provenances",
  "data": {
    "provenances": [
      {
        "id": "111",
        "nom": "NCA",
        "cout": "0€",
        "active": true,
        "type_lead": null,
        "ws_mer_enabled": true,
        "ws_mer_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=mer&id_prov=111&cle_ws=7719b3295c9edb7d9a682fdb6498b717",
        "ws_mer_cle": "7719b3295c9edb7d9a682fdb6498b717",
        "ws_mer_agence": "3-NCAR1",
        "ws_iframe_enabled": false,
        "ws_tarifs_enabled": false,
        "provstats_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=provstats&id_prov=111&cle_ws=d26aceeedd5094638ef0882ca2a6de63",
        "doublon_url": "https://www.gestfiches.com/fld-assurances/ws/index.php?ws=doublon&id_prov=111&cle_ws=731b3e2df6e13e6c06cda894a356c667"
      },
      {
        "id": "131",
        "nom": "NCA-C",
        "cout": "0€",
        "active": true,
        "type_lead": null,
        "ws_mer_enabled": true,
        "ws_mer_cle": "43ea055045423bdff9a065e30bee117d",
        "ws_mer_agence": "3-NCAR1"
      },
      {
        "id": "135",
        "nom": "NCA-Comparateur",
        "cout": "0€",
        "active": true,
        "ws_mer_enabled": true,
        "ws_mer_cle": "34ead3b24698e89a7270f8d0b3818067"
      }
    ],
    "total_count": 115
  },
  "timestamp": "2026-01-07T10:30:00.123456"
}
```

---

## Common Use Cases

### 1. Get All Active Provenances with MER Webservice

```python
import requests

response = requests.get("http://localhost:8000/api/provenances")
data = response.json()

# Filter for active provenances with MER webservice enabled
active_mer = [
    p for p in data["data"]["provenances"]
    if p["active"] and p["ws_mer_enabled"]
]

for prov in active_mer:
    print(f"{prov['id']}: {prov['nom']} - Key: {prov['ws_mer_cle']}")
```

### 2. Get Webservice Key for a Specific Provenance

```python
import requests

response = requests.get("http://localhost:8000/api/provenances")
data = response.json()

# Find provenance by ID
target_id = "111"
provenance = next(
    (p for p in data["data"]["provenances"] if p["id"] == target_id),
    None
)

if provenance:
    print(f"Provenance: {provenance['nom']}")
    print(f"WS MER Key: {provenance['ws_mer_cle']}")
    print(f"Active: {provenance['active']}")
```

### 3. Build a Provenance Mapping Dictionary

```python
import requests

response = requests.get("http://localhost:8000/api/provenances")
data = response.json()

# Create ID -> Name mapping
provenance_map = {
    p["id"]: p["nom"]
    for p in data["data"]["provenances"]
}

# Create ID -> WS Key mapping
ws_key_map = {
    p["id"]: p["ws_mer_cle"]
    for p in data["data"]["provenances"]
    if p["ws_mer_enabled"]
}

print("Provenance 111:", provenance_map.get("111"))
print("WS Key for 111:", ws_key_map.get("111"))
```

### 4. Find All Provenances for a Specific Agency

```python
import requests

response = requests.get("http://localhost:8000/api/provenances")
data = response.json()

target_agency = "3-NCAR1"
agency_provenances = [
    p for p in data["data"]["provenances"]
    if p.get("ws_mer_agence") == target_agency
]

print(f"Found {len(agency_provenances)} provenances for agency {target_agency}")
```

---

## Response Fields Explained

### Core Fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Provenance ID (e.g., "111", "131") |
| `nom` | string | Human-readable name (e.g., "NCA", "Facebook") |
| `cout` | string | Cost per fiche (e.g., "0€", "1€") |
| `active` | boolean | Whether the provenance is active |
| `type_lead` | string | Optional lead type classification |

### WS MER (Webservice MER)
Used for fiche submission via API.

| Field | Type | Description |
|-------|------|-------------|
| `ws_mer_enabled` | boolean | Whether MER webservice is enabled |
| `ws_mer_url` | string | Full webservice URL |
| `ws_mer_cle` | string | **Webservice API key** (required for submissions) |
| `ws_mer_agence` | string | Assigned agency (e.g., "3-NCAR1") |

### WS IFRAME
Used for embedded form integrations.

| Field | Type | Description |
|-------|------|-------------|
| `ws_iframe_enabled` | boolean | Whether IFRAME integration is enabled |
| `ws_iframe_url` | string | IFRAME integration URL |
| `ws_iframe_cf` | string | Configuration token for IFRAME |
| `ws_iframe_agence` | string | Assigned agency |

### WS TARIFS
Used for pricing/tariff calculations.

| Field | Type | Description |
|-------|------|-------------|
| `ws_tarifs_enabled` | boolean | Whether TARIFS webservice is enabled |
| `ws_tarifs_url` | string | Tariffs webservice URL |
| `ws_tarifs_cle` | string | Webservice API key for tariffs |
| `ws_tarifs_agence` | string | Assigned agency |

### Statistics & Utilities
| Field | Type | Description |
|-------|------|-------------|
| `provstats_url` | string | URL for insertion statistics |
| `provstatsdet_url` | string | URL for detailed statistics |
| `provstatssante_url` | string | URL for health insurance statistics |
| `doublon_url` | string | URL for deduplication/doublon checking |

---

## Integration with Fiche Submission

The `ws_mer_cle` from this endpoint is the **webservice key** used in fiche submissions.

### Example: Submit a Fiche Using Provenance Key

```python
import requests

# Step 1: Get provenance info
prov_response = requests.get("http://localhost:8000/api/provenances")
provenances = prov_response.json()["data"]["provenances"]

# Find NCA provenance
nca = next(p for p in provenances if p["nom"] == "NCA")
print(f"NCA Provenance ID: {nca['id']}")
print(f"WS MER Key: {nca['ws_mer_cle']}")

# Step 2: Submit a fiche
fiche_data = {
    "nom": "DUPONT",
    "prenom": "Jean",
    "date_naissance": "01/01/1980",
    "code_postal": "75001",
    "tel": "0612345678",
    "email": "jean.dupont@example.com",
    "sexe": "1",
    "regime": "1",
    "provenance": nca["id"],  # Use the provenance ID
    "commentaire": "Test lead from API"
}

submit_response = requests.post(
    "http://localhost:8000/api/fiches/",
    json=fiche_data
)

print(f"Submission: {submit_response.json()}")
```

---

## Understanding Webservice Keys

The provenances list reveals the **internal webservice keys** used by GestFiches for each lead source. These keys are configured in `app/services/fiches_service.py`:

```python
self.webservice_keys = {
    '111': '7719b3295c9edb7d9a682fdb6498b717',  # NCA
    '131': '43ea055045423bdff9a065e30bee117d',  # NCA-C (SMS)
    '135': '34ead3b24698e89a7270f8d0b3818067',  # NCA-Comparateur
    '139': 'e2e02dd7474a41842fb358296d899155',  # NCA-local
}
```

The API automatically selects the correct key based on the `provenance` field in your fiche submission.

---

## Error Handling

### Common Errors

| Status | Error | Cause | Solution |
|--------|-------|-------|----------|
| `500` | `"Failed to obtain a valid session"` | No cached PHPSESSID available | 1. Pass `?phpsessid=...` query param<br>2. Ensure search manager is running<br>3. Check session validity |
| `500` | `"Session expired, redirected to login page"` | PHPSESSID is stale/expired | Get a fresh session or wait for auto-refresh |
| `500` | `"Error parsing provenances HTML"` | HTML structure changed or malformed | Check `data/debug/provenances_response_*.html` for raw HTML |

### Debugging Tips

1. **Check debug output**: HTML responses are saved to `data/debug/provenances_response_*.html`
2. **Verify session**: Try `GET /api/etiquettes` – if it fails with same error, session is invalid system-wide
3. **Test with explicit session**: Use `?phpsessid=...` to bypass automatic session management

---

## Response Data Structure

### Active vs Inactive Provenances

- **Active** provenances appear normally in the response
- **Inactive** provenances have `"active": false` and may be styled differently in the UI
- Inactive provenances can still be read but shouldn't be used for new submissions

### Webservice Availability

Not all provenances have all webservices enabled:

```
Provenance "NCA" (111):
  ✓ WS MER enabled     (for fiche submission)
  ✗ WS IFRAME disabled
  ✗ WS TARIFS disabled

Provenance "Affiliation" (37):
  ✓ WS MER enabled
  ✓ WS IFRAME enabled
  ✓ WS TARIFS enabled
```

Check the `ws_*_enabled` fields to determine available integrations.

---

## Use Cases by Role

### For Developers
- **Get webservice keys** for API integrations
- **Validate provenance IDs** before fiche submission
- **Map provenance IDs to names** for user-friendly displays

### For Administrators
- **Audit active lead sources** and their configurations
- **Check agency assignments** for each provenance
- **Verify webservice configurations** (MER, IFRAME, TARIFS)

### For Data Analysts
- **Access statistics URLs** for insertion metrics
- **Check deduplication URLs** for duplicate analysis
- **Analyze lead source costs** and activity

---

## Related Endpoints

- `POST /api/fiches/` - Submit a fiche (requires provenance ID)
- `GET /api/etiquettes` - List available étiquettes
- `GET /api/fiches/search` - Search for fiches with provenance filters

---

## Implementation Notes

### HTML Parsing
- The service parses the `table_provenances` table from the admin page
- Webservice URLs and keys are extracted from `onclick` JavaScript attributes
- Agency assignments are parsed from inline text

### Session Management
- Uses the same session management as other scraping endpoints
- Prefers active browser manager sessions over cached sessions
- Falls back to SessionManager → phpsessid.txt → error

### Performance
- Typical response time: 1-3 seconds (depending on network)
- Results are not cached (data changes infrequently but must be accurate)
- Consider caching responses in your application if needed

---

## OpenAPI / Swagger

Interactive API documentation is available at:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

---

## Changelog

### 2026-01-07
- Initial release of Provenances API
- Added endpoint: `GET /api/provenances`
- Extracts full webservice configuration including MER, IFRAME, and TARIFS keys
- Integrated with existing session management system

