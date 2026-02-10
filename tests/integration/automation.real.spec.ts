import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnectDb,prisma } from "../../src/shared/prisma.js";
import { makeApp } from "../test-app.js";
import { getTestAccessToken } from "../test-auth.js";
import { isIntegrationEnabled } from "./_integration.env.js";

const describeIntegration = isIntegrationEnabled() ? describe : describe.skip;

describeIntegration("Integration: automation schedules (real DB)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  it("Create -> Get -> Patch -> List -> Delete schedule", async () => {
    const app = makeApp();
    const token = await getTestAccessToken();

    const uniqueName = `integration-test-${Date.now()}`;

    // Create
    const createRes = await request(app)
      .post("/api/automation/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: uniqueName,
        description: "integration test schedule",
        scheduleType: "MANUAL",
        timezone: "UTC",
        ficheSelection: {
          mode: "manual",
          ficheIds: ["1762209"],
          onlyWithRecordings: false,
          onlyUnaudited: false,
        },
        runTranscription: false,
        runAudits: false,
        notifyOnComplete: false,
        notifyOnError: false,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: expect.any(String),
          name: uniqueName,
        }),
      })
    );

    const scheduleId: string = createRes.body.data.id;

    // Create a run row so /api/automation/runs can be exercised
    const run = await prisma.automationRun.create({
      data: {
        scheduleId: BigInt(scheduleId),
        status: "completed",
        configSnapshot: { source: "integration-test" },
      },
      select: { id: true },
    });

    // List runs (all schedules)
    const listRunsRes = await request(app)
      .get("/api/automation/runs?limit=50&offset=0")
      .set("Authorization", `Bearer ${token}`);
    expect(listRunsRes.status).toBe(200);
    expect(listRunsRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
        count: expect.any(Number),
        limit: 50,
        offset: 0,
      })
    );
    const foundRun = (listRunsRes.body.data as Array<{ id: string }>).some(
      (r) => r.id === run.id.toString()
    );
    expect(foundRun).toBe(true);

    // Get
    const getRes = await request(app)
      .get(`/api/automation/schedules/${scheduleId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: scheduleId,
          name: uniqueName,
        }),
      })
    );

    // Patch
    const patchedName = `${uniqueName}-patched`;
    const patchRes = await request(app)
      .patch(`/api/automation/schedules/${scheduleId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: patchedName });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: scheduleId,
          name: patchedName,
        }),
      })
    );

    // List (ensure it appears)
    const listRes = await request(app)
      .get("/api/automation/schedules")
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
        count: expect.any(Number),
      })
    );

    const found = (listRes.body.data as Array<{ id: string; name: string }>).some(
      (s) => s.id === scheduleId
    );
    expect(found).toBe(true);

    // Delete
    const delRes = await request(app).delete(
      `/api/automation/schedules/${scheduleId}`
    ).set("Authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual(
      expect.objectContaining({
        success: true,
        message: "Schedule deleted successfully",
      })
    );
  }, 60_000);
});





