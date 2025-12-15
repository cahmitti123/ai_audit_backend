/**
 * Automation Cron Helpers
 * ======================
 * Minimal cron parsing + matching used by the automation scheduler.
 *
 * Supported syntax (5-field cron):
 * - `*`
 * - `*\/n`
 * - `a`
 * - `a,b,c`
 * - `a-b`
 * - `a-b/n`
 *
 * Notes:
 * - Day-of-week supports 0-6 (Sun-Sat) and also accepts 7 as Sunday.
 * - If both day-of-month and day-of-week are restricted (not `*`), we use OR semantics
 *   (matches if either field matches) which is the common cron behavior.
 */

type CronFieldMatcher = {
  isAny: boolean;
  matches: (value: number) => boolean;
};

export type CronSpec = {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
};

export function parseCronExpression(cron: string): CronSpec {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${cron}`);
  }

  const [min, hour, dom, month, dow] = parts;

  return {
    minute: parseCronField(min, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dom, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dow, 0, 7, { allow7ForSunday: true }),
  };
}

export function cronMatches(
  spec: CronSpec,
  parts: {
    minute: number;
    hour: number;
    dayOfMonth: number;
    month: number;
    dayOfWeek: number; // 0-6 (Sun-Sat)
  }
): boolean {
  if (!spec.minute.matches(parts.minute)) return false;
  if (!spec.hour.matches(parts.hour)) return false;
  if (!spec.month.matches(parts.month)) return false;

  const domAny = spec.dayOfMonth.isAny;
  const dowAny = spec.dayOfWeek.isAny;

  const domMatches = spec.dayOfMonth.matches(parts.dayOfMonth);
  const dowMatches = spec.dayOfWeek.matches(parts.dayOfWeek);

  if (domAny && dowAny) return true;
  if (domAny && !dowAny) return dowMatches;
  if (!domAny && dowAny) return domMatches;
  // Both restricted -> OR semantics
  return domMatches || dowMatches;
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  options?: { allow7ForSunday?: boolean }
): CronFieldMatcher {
  const raw = field.trim();
  if (raw === "*") {
    return { isAny: true, matches: () => true };
  }

  const allowed = new Set<number>();

  const addValue = (v: number) => {
    let value = v;
    if (options?.allow7ForSunday && max === 7 && value === 7) value = 0;
    if (value < min || value > max) return;
    // Normalize 7->0 for day-of-week when applicable
    if (options?.allow7ForSunday && max === 7 && value === 7) value = 0;
    allowed.add(value);
  };

  const addRange = (start: number, end: number, step = 1) => {
    const s = Math.max(min, start);
    const e = Math.min(max, end);
    for (let v = s; v <= e; v += step) addValue(v);
  };

  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`Invalid cron step in "${token}"`);
    }

    const rp = rangePart.trim();
    if (rp === "*") {
      addRange(min, max, step);
      continue;
    }

    if (rp.includes("-")) {
      const [aStr, bStr] = rp.split("-");
      const a = parseInt(aStr, 10);
      const b = parseInt(bStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`Invalid cron range in "${token}"`);
      }
      addRange(a, b, step);
      continue;
    }

    const single = parseInt(rp, 10);
    if (!Number.isFinite(single)) {
      throw new Error(`Invalid cron value in "${token}"`);
    }

    // If a step is provided with a single number (e.g. "5/10"), treat as range single..max
    if (stepPart) {
      addRange(single, max, step);
    } else {
      addValue(single);
    }
  }

  return {
    isAny: false,
    matches: (value: number) => allowed.has(value),
  };
}


