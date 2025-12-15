import { defineConfig } from "vitest/config";

const isIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
const timeout = isIntegration ? 180_000 : 15_000;

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.spec.ts"],
    testTimeout: timeout,
    hookTimeout: timeout,
  },
});


