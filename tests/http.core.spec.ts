import request from "supertest";
import { describe, expect, it } from "vitest";

import { makeApp } from "./test-app.js";
import { getTestAccessToken } from "./test-auth.js";

describe("HTTP core", () => {
  it("GET /health returns ok + instance header", async () => {
    const app = makeApp();

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["x-backend-instance"]).toBeTruthy();

    expect(res.body).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "ai-audit-system",
        version: "2.3.0",
        instance: expect.any(String),
        timestamp: expect.any(String),
      })
    );
  });

  it("GET /api-docs.json returns OpenAPI document", async () => {
    const app = makeApp();

    const res = await request(app).get("/api-docs.json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        openapi: "3.0.0",
        info: expect.objectContaining({
          title: "AI Audit System API",
          version: "2.3.0",
        }),
      })
    );
  });

  it("Unknown /api route returns structured 404", async () => {
    const app = makeApp();

    const token = await getTestAccessToken();
    const res = await request(app)
      .get("/api/does-not-exist")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "NOT_FOUND",
        error: expect.stringContaining("Route"),
      })
    );
  });

  it("Invalid JSON body returns 400 INVALID_JSON", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/api/audits/run")
      .set("Content-Type", "application/json")
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "INVALID_JSON",
        error: "Invalid JSON body",
      })
    );
  });
});





