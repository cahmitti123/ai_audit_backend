export function isIntegrationEnabled(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === "1";
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `Missing required env var for integration tests: ${name}. ` +
        `Set RUN_INTEGRATION_TESTS=1 and provide required env vars.`
    );
  }
  return v.trim();
}

export function readIsoDate(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {return null;}
  const vv = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vv)) {
    throw new Error(`Invalid ${name}=${JSON.stringify(vv)}. Expected YYYY-MM-DD.`);
  }
  return vv;
}


