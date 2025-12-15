# Automation Type Definitions

TypeScript type definitions for the AI Audit Automation API.

## Files

### `automation.d.ts`

Type declarations file containing:

- Core types (schedules, runs, logs)
- API request/response types
- Enums and constants
- Function signatures

**Usage**: Import types in your frontend:

```typescript
import type {
  AutomationScheduleResponse,
  AutomationRunResponse,
  FicheSelection,
} from "./types/automation";
```

### `automation.utils.ts`

Utility functions and implementations:

- Validation constants
- Type guards
- Formatting functions
- Default value generators

**Usage**: Import functions in your frontend:

```typescript
import {
  formatDuration,
  getStatusColor,
  createDefaultSchedule,
  hasValidAuditConfig,
} from "./types/automation.utils";
```

## Quick Start

1. **Copy both files** to your frontend project's `types/` directory

2. **Install dependencies** (if not already installed):

```bash
npm install typescript
```

3. **Import types in your components**:

```typescript
import type { AutomationScheduleResponse } from "./types/automation";
import { formatDuration, getStatusColor } from "./types/automation.utils";

function ScheduleCard({ schedule }: { schedule: AutomationScheduleResponse }) {
  const color = getStatusColor(schedule.lastRunStatus || "running");
  return <div className={`status-${color}`}>{schedule.name}</div>;
}
```

## Key Types

### Creating a Schedule

```typescript
import type { AutomationScheduleCreate } from "./types/automation";
import { createDefaultSchedule } from "./types/automation.utils";

const newSchedule: AutomationScheduleCreate = {
  ...createDefaultSchedule(),
  name: "Daily Audit",
  scheduleType: "DAILY",
  timeOfDay: "09:00",
  specificAuditConfigs: ["4", "5", "6"], // Important: Add audit config IDs
};
```

### Handling API Responses

```typescript
import type {
  ApiResponse,
  AutomationScheduleResponse,
} from "./types/automation";

async function fetchSchedule(id: string): Promise<AutomationScheduleResponse> {
  const response: ApiResponse<AutomationScheduleResponse> = await fetch(
    `/api/automation/schedules/${id}`
  ).then((r) => r.json());

  if (!response.success) {
    throw new Error(response.error);
  }

  return response.data;
}
```

### Using Diagnostic Data

```typescript
import type { GetScheduleResponse } from "./types/automation";

function DiagnosticInfo({ data }: { data: GetScheduleResponse["data"] }) {
  if (!data._diagnostic) return null;

  return (
    <div>
      <h3>Diagnostic Info</h3>
      <p>Audit Configs: {data._diagnostic.specificAuditConfigsCount}</p>
      <p>Use Automatic: {data._diagnostic.useAutomaticAudits ? "Yes" : "No"}</p>
      <p>
        Raw Config: {JSON.stringify(data._diagnostic.specificAuditConfigsRaw)}
      </p>
    </div>
  );
}
```

## Important Notes

### Audit Configuration

⚠️ **Critical**: When creating/updating a schedule, ensure audit configs are properly set:

```typescript
// Option 1: Use specific audit configs
const schedule = {
  runAudits: true,
  useAutomaticAudits: false,
  specificAuditConfigs: ["4", "5", "6"], // Must be non-empty
};

// Option 2: Use automatic audits (from database)
const schedule = {
  runAudits: true,
  useAutomaticAudits: true,
  specificAuditConfigs: [], // Can be empty
};

// Option 3: Use both (will run all)
const schedule = {
  runAudits: true,
  useAutomaticAudits: true,
  specificAuditConfigs: ["4"], // Will run 4 + all automatic
};
```

Validate before submitting:

```typescript
import {
  hasValidAuditConfig,
  getAuditConfigWarning,
} from "./types/automation.utils";

const warning = getAuditConfigWarning(schedule);
if (warning) {
  alert(warning); // Show error to user
}
```

### BigInt Serialization

The API returns BigInt values as strings. The types handle this correctly:

```typescript
// In API response, IDs are strings
schedule.id; // Type: string (serialized from BigInt)
schedule.specificAuditConfigs; // Type: string[] (serialized from BigInt[])

// When sending to API, use strings or numbers
const update: AutomationScheduleUpdate = {
  specificAuditConfigs: ["4", "5", "6"], // strings work
  // OR
  specificAuditConfigs: [4, 5, 6], // numbers work too
};
```

## Utility Functions Reference

### Formatting

```typescript
formatDuration(65000); // "1m 5s"
formatDuration(3665000); // "1h 1m"
formatNextRun(new Date()); // "Today at 2:30 PM"
```

### Status Helpers

```typescript
getStatusColor("completed"); // "success"
getStatusColor("failed"); // "error"
getScheduleTypeLabel("DAILY"); // "Daily"
```

### Validation

```typescript
isValidTimeOfDay("14:30"); // true
isValidTimeOfDay("9:30"); // false (must be 09:30)
hasValidAuditConfig(schedule); // true/false
```

### Calculations

```typescript
calculateSuccessRate(run); // 80 (if 8 of 10 succeeded)
```

## TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["./types/automation.d.ts"]
  }
}
```

## API Endpoints

These types correspond to the following API endpoints:

- `GET /api/automation/schedules` - List all schedules
- `GET /api/automation/schedules/:id` - Get schedule with diagnostic info
- `POST /api/automation/schedules` - Create schedule
- `PATCH /api/automation/schedules/:id` - Update schedule
- `DELETE /api/automation/schedules/:id` - Delete schedule
- `POST /api/automation/trigger` - Manually trigger automation
- `GET /api/automation/runs` - List runs
- `GET /api/automation/runs/:id` - Get run details with logs

## Troubleshooting

### "No audit configs found" in logs

**Problem**: The automation runs but shows empty `specificAuditConfigs: []`

**Solution**:

1. Check the schedule in the database
2. Update via API with proper audit config IDs
3. Or mark audit configs as automatic in the database

See `docs/operations.md` for scheduler/webhook operational notes.

### Type errors with BigInt

**Problem**: TypeScript complains about BigInt values

**Solution**: The types already handle this - IDs are typed as `string` in responses.

### Function implementations missing

**Problem**: Editor shows function implementations as "not found"

**Solution**: Import from `automation.utils.ts`, not `automation.d.ts`:

```typescript
// ❌ Wrong - only declarations
import { formatDuration } from "./types/automation";

// ✅ Correct - implementations
import { formatDuration } from "./types/automation.utils";
```

## Support

For issues or questions:

1. Check `docs/operations.md`
2. Review the API documentation
3. Check browser console for validation errors
4. Use the `_diagnostic` object in API responses
