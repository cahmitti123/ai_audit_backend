# Fiches Module - Type System Documentation

## Single Source of Truth: `fiches.schemas.ts`

All types for the Fiches module are defined in `fiches.schemas.ts` using Zod schemas. This provides:
- ✅ Runtime validation
- ✅ Compile-time type safety
- ✅ Single source of truth
- ✅ Automatic type inference

## Type Hierarchy

### 1. Sales List Types (GET /api/fiches/search/by-date)

#### `SalesFiche`
Represents a single fiche in the sales list response.

**Schema**: `salesFicheSchema`

```typescript
{
  id: string;                      // Fiche ID
  cle: string | null;             // Authentication key
  nom: string;                    // Last name
  prenom: string;                 // First name
  telephone: string;              // Phone number
  telephone_2: string | null;     // Secondary phone
  email: string;                  // Email address
  statut: string;                 // Status (e.g., "Santé : CLIENTS")
  date_insertion: string;         // Creation date
  date_modification: string | null; // Last modified date
}
```

#### `SalesResponse`
API response for sales list endpoint.

**Schema**: `salesResponseSchema`

```typescript
{
  fiches: SalesFiche[];           // Array of fiches
  total: number;                  // Total count
}
```

#### `SalesResponseWithStatus`
Enriched response with status information from database.

**Type**: Interface (not Zod schema)

```typescript
{
  fiches: SalesFicheWithStatus[]; // Fiches with status
  total: number;                  // Total count
}
```

#### `SalesFicheWithStatus`
Fiche with enriched status information.

**Type**: Interface extending `SalesFiche`

```typescript
interface SalesFicheWithStatus extends SalesFiche {
  status: FicheStatus;
}
```

### 2. Fiche Details Types (GET /api/fiches/by-id/{id})

#### `FicheDetailsResponse` (alias: `SaleDetailsResponse`)
Complete fiche details including all sections.

**Schema**: `saleDetailsResponseSchema`

```typescript
{
  success: boolean;
  message: string;
  information: Information | null;
  prospect: Prospect | null;
  conjoint: Conjoint | null;
  enfants: Enfant[];
  mails: Mail[];
  rendez_vous: RendezVous[];
  commentaires: Commentaire[];
  elements_souscription: ElementsSouscription | null;
  tarification: Tarification[];
  reclamations: Reclamation[];
  autres_contrats: AutreContrat[];
  documents: Document[];
  alertes: Alerte[];
  recordings: Recording[];
  raw_sections: Record<string, string>;
}
```

### 3. Status Types

#### `FicheStatus`
Status information from database (transcription & audit).

```typescript
{
  hasData: boolean;
  transcription: TranscriptionStatus;
  audit: AuditStatus;
}
```

#### `TranscriptionStatus`
Transcription progress information.

```typescript
{
  total: number;                  // Total recordings
  transcribed: number;            // Transcribed count
  pending: number;                // Pending count
  percentage: number;             // Completion %
  isComplete: boolean;            // All complete?
  lastTranscribedAt?: Date | null; // Last transcribed
}
```

#### `AuditStatus`
Audit progress and compliance information.

```typescript
{
  total: number;                  // Total audits
  completed: number;              // Completed count
  pending: number;                // Pending count
  running: number;                // Running count
  compliant: number;              // Compliant count
  nonCompliant: number;           // Non-compliant count
  averageScore: number | null;    // Average score
  latestAudit?: any;              // Latest audit details
}
```

### 4. Nested Types

All nested types (Information, Prospect, Recording, etc.) are fully typed using Zod schemas in `fiches.schemas.ts`. See the file for complete definitions.

## Validation Functions

### `validateSalesResponse(data: unknown): SalesResponse`
Validates and parses sales list API response.

**Usage**:
```typescript
const validatedData = validateSalesResponse(response.data);
```

**Throws**: Error if validation fails

### `validateFicheDetailsResponse(data: unknown): FicheDetailsResponse`
Validates and parses fiche details API response.

**Usage**:
```typescript
const validatedData = validateFicheDetailsResponse(response.data);
```

**Throws**: Error if validation fails

## Service Layer Usage

### `fetchApiSales(date: string): Promise<SalesResponse>`
Fetches sales list for a given date with input validation and runtime response validation.

**Input Validation**:
- Date format: `YYYY-MM-DD` (e.g., `2025-11-12`)
- Year range: 2000-2100
- Valid month (1-12) and day (1-31)
- Actual calendar date validation (e.g., rejects `2025-02-30`)

**Usage**:
```typescript
const sales = await fetchApiSales("2025-11-12");
// sales is typed as SalesResponse
// sales.fiches is SalesFiche[]
// sales.total is number
```

**Error Handling**:
```typescript
try {
  const sales = await fetchApiSales("20225-11-12"); // Invalid format
} catch (error) {
  // Error: Invalid date format: "20225-11-12". Expected format: YYYY-MM-DD (e.g., 2025-11-12)
}
```

### `fetchApiFicheDetails(ficheId: string, cle?: string): Promise<FicheDetailsResponse>`
Fetches full fiche details with runtime validation.

```typescript
const fiche = await fetchApiFicheDetails("1778226");
// fiche is typed as FicheDetailsResponse
// fiche.information is Information | null
// fiche.prospect is Prospect | null
// fiche.recordings is Recording[]
```

## Routes Layer Usage

Routes can enrich responses with status information:

```typescript
// Get sales list
const sales = await fetchApiSales(date);
// Type: SalesResponse

// Enrich with status
const enrichedResponse: SalesResponseWithStatus = {
  fiches: sales.fiches.map((fiche: SalesFiche) => ({
    ...fiche,
    status: statusMap[fiche.id] || defaultStatus,
  })),
  total: sales.total,
};
// Type: SalesResponseWithStatus
```

## Type Safety Guarantees

### ✅ Compile-time
- TypeScript checks all type assignments
- Autocomplete for all fields
- Catch errors before runtime

### ✅ Runtime
- Zod validates actual API responses
- Catches API contract changes
- Provides detailed error messages

### ✅ Refactoring
- Rename fields safely
- Add/remove fields with confidence
- Find all usages easily

## Migration Notes

### Before (❌ Not Type Safe)
```typescript
interface SalesResponse {
  success: boolean;
  fiches: any[];  // ❌ No type safety
  total: number;
}

const sales = await fetchApiSales(date);
// No validation, any field access allowed
```

### After (✅ Type Safe)
```typescript
import { type SalesResponse, validateSalesResponse } from './fiches.schemas.js';

const response = await axios.get<SalesResponse>(...);
const sales = validateSalesResponse(response.data);
// ✅ Runtime validated
// ✅ Compile-time typed
// ✅ sales.fiches is SalesFiche[]
```

## Best Practices

1. **Always import types from `fiches.schemas.ts`**
   ```typescript
   import type { SalesResponse, SalesFiche } from './fiches.schemas.js';
   ```

2. **Use validation functions for API responses**
   ```typescript
   const validatedData = validateSalesResponse(response.data);
   ```

3. **Never use `any` for fiche-related data**
   ```typescript
   // ❌ Bad
   const fiche: any = await fetchApiFicheDetails(id);
   
   // ✅ Good
   const fiche: FicheDetailsResponse = await fetchApiFicheDetails(id);
   ```

4. **Add null checks for nullable fields**
   ```typescript
   if (fiche.information) {
     const ficheId = fiche.information.fiche_id;
     // Safe to use ficheId
   }
   ```

5. **Use enriched types when adding status**
   ```typescript
   const enriched: SalesResponseWithStatus = {
     fiches: sales.fiches.map(f => ({ ...f, status })),
     total: sales.total,
   };
   ```

## Type Export Summary

All types are exported from `fiches.schemas.ts`:

### Core API Types
- `SalesFiche` - Single fiche in sales list
- `SalesResponse` - Sales list API response
- `FicheDetailsResponse` - Full fiche details

### Enriched Types
- `SalesFicheWithStatus` - Fiche with status
- `SalesResponseWithStatus` - Sales list with status
- `FicheStatus` - Status information
- `TranscriptionStatus` - Transcription info
- `AuditStatus` - Audit info

### Nested Detail Types
- `Information`, `Prospect`, `Conjoint`, `Enfant`
- `Recording`, `Transcription`, `ConversationEntry`
- `Mail`, `RendezVous`, `Commentaire`
- `ElementsSouscription`, `Tarification`, `Formule`, `Gamme`
- `Reclamation`, `AutreContrat`, `Document`, `Alerte`
- And more... (see `fiches.schemas.ts`)

### Validators
- `validateSalesResponse()` - Validate sales list
- `validateFicheDetailsResponse()` - Validate fiche details

---

**Last Updated**: 2025-11-13
**Maintainer**: Keep this document in sync with `fiches.schemas.ts`

