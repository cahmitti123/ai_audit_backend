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

  it("POST /api/webhooks/test missing eventType -> 400", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/webhooks/test").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "eventType is required",
      })
    );
  });

  it("POST /api/webhooks/test with unknown eventType -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/api/webhooks/test")
      .send({ eventType: "unknown.event" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "Unknown event type: unknown.event",
      })
    );
  });

  it("POST /api/webhooks/test/custom validates body -> 400", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/webhooks/test/custom").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "event and data are required",
      })
    );
  });

  it("GET /api/realtime/jobs/:jobId returns SSE headers", async () => {
    await withTestServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/realtime/jobs/test-job-1`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("x-accel-buffering")).toBe("no");
      // Close the SSE stream so the test doesn't hang.
      await res.body?.cancel();
    });
  });
});


