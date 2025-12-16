import request from "supertest";
import { describe, expect, it } from "vitest";
import { makeApp } from "./test-app.js";
import { withTestServer } from "./test-server.js";

describe("More HTTP endpoints (DB-free)", () => {
  it("GET /api/automation/diagnostic returns diagnostics payload", async () => {
    const app = makeApp();

    const res = await request(app).get("/api/automation/diagnostic");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        inngest: expect.objectContaining({
          mode: expect.any(String),
          status: expect.any(String),
          configuration: expect.objectContaining({
            isDev: expect.any(Boolean),
            nodeEnv: "test",
          }),
        }),
        endpoints: expect.objectContaining({
          trigger: "POST /api/automation/trigger",
        }),
      })
    );
  });

  it("Legacy /api/webhooks routes are removed -> 404", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/webhooks/test").send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "NOT_FOUND",
      })
    );
  });

  it("Legacy SSE /api/realtime/* streaming routes are removed -> 404", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/realtime/jobs/test-job-1`);
      expect(res.status).toBe(404);
      await res.body?.cancel();
    });
  });
});


