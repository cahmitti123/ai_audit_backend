import request from "supertest";
import { describe, expect, it } from "vitest";

import { makeApp } from "./test-app.js";

describe("HTTP validation (no DB required)", () => {
  it("GET /api/fiches/status/by-date-range missing startDate -> 400", async () => {
    const app = makeApp();

    const res = await request(app).get(
      "/api/fiches/status/by-date-range?endDate=2025-12-01"
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: expect.stringContaining("startDate"),
      })
    );
  });

  it("GET /api/fiches/status/by-date-range invalid date format -> 400", async () => {
    const app = makeApp();

    const res = await request(app).get(
      "/api/fiches/status/by-date-range?startDate=2025-1-1&endDate=2025-12-01"
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid date format. Use YYYY-MM-DD",
      })
    );
  });

  it("GET /api/fiches/status/by-date-range startDate after endDate -> 400", async () => {
    const app = makeApp();

    const res = await request(app).get(
      "/api/fiches/status/by-date-range?startDate=2025-12-10&endDate=2025-12-01"
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "startDate must be before or equal to endDate",
      })
    );
  });

  it("GET /api/fiches/status/by-date-range blocks private IP webhookUrl -> 400", async () => {
    const app = makeApp();

    const res = await request(app).get(
      "/api/fiches/status/by-date-range?startDate=2025-12-01&endDate=2025-12-01&webhookUrl=http%3A%2F%2F10.0.0.1%2Fhook"
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "webhookUrl IP not allowed",
      })
    );
  });

  it("POST /api/fiches/status/batch missing ficheIds -> 400", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/fiches/status/batch").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "ficheIds must be an array",
      })
    );
  });

  it("POST /api/transcriptions/batch missing fiche_ids -> 400", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/transcriptions/batch").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "Invalid request - fiche_ids array required",
      })
    );
  });

  it("POST /api/audits/run missing fields -> 400", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/audits/run").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "Missing required parameters",
        message: "Both audit_config_id (or audit_id) and fiche_id are required",
      })
    );
  });

  it("POST /api/automation/trigger missing scheduleId -> 400 (schema validator)", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/automation/trigger").send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid trigger automation data",
      })
    );
  });

  it("POST /api/fiches/:fiche_id/chat with empty message -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/api/fiches/1762209/chat")
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Message required",
      })
    );
  });

  it("POST /api/audits/:audit_id/chat with invalid audit_id -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .post("/api/audits/not-a-bigint/chat")
      .send({ message: "hello" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid audit_id",
      })
    );
  });

  it("PATCH /api/audits/:audit_id/steps/:step_position/review invalid audit_id -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .patch("/api/audits/not-a-bigint/steps/1/review")
      .send({ conforme: "CONFORME" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid audit_id",
      })
    );
  });

  it("PATCH /api/audits/:audit_id/steps/:step_position/review invalid step_position -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .patch("/api/audits/1/steps/not-an-int/review")
      .send({ conforme: "CONFORME" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid step_position",
      })
    );
  });

  it("PATCH /api/audits/:audit_id/steps/:step_position/review missing conforme -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .patch("/api/audits/1/steps/1/review")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid review audit step result input",
      })
    );
  });

  it("GET /api/audits/control-points/statuses returns allowed checkpoint statuses", async () => {
    const app = makeApp();

    const res = await request(app).get("/api/audits/control-points/statuses");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: {
          statuses: ["PRESENT", "ABSENT", "PARTIEL", "NON_APPLICABLE"],
        },
      })
    );
  });

  it("GET /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index invalid control_point_index -> 400", async () => {
    const app = makeApp();

    const res = await request(app).get(
      "/api/audits/1/steps/1/control-points/not-an-int"
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid control_point_index",
      })
    );
  });

  it("PATCH /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/review invalid audit_id -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .patch("/api/audits/not-a-bigint/steps/1/control-points/1/review")
      .send({ statut: "PRESENT" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid audit_id",
      })
    );
  });

  it("PATCH /api/audits/:audit_id/steps/:step_position/control-points/:control_point_index/review missing statut/commentaire -> 400", async () => {
    const app = makeApp();

    const res = await request(app)
      .patch("/api/audits/1/steps/1/control-points/1/review")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
        error: "Invalid review audit control point input",
      })
    );
  });
});


