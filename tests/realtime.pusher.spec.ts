import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetPusherClientForTests } from "../src/shared/pusher.js";
import { makeApp } from "./test-app.js";
import { getTestAccessToken } from "./test-auth.js";

describe("Realtime (Pusher)", () => {
  const originalEnv: Partial<Record<string, string | undefined>> = {};

  beforeEach(() => {
    // Snapshot env we mutate
    for (const k of [
      "PUSHER_APP_ID",
      "PUSHER_KEY",
      "PUSHER_SECRET",
      "PUSHER_CLUSTER",
      "PUSHER_DRY_RUN",
      "PUSHER_USE_PRIVATE_CHANNELS",
    ] as const) {
      originalEnv[k] = process.env[k];
    }

    process.env.PUSHER_APP_ID = "1";
    process.env.PUSHER_KEY = "k";
    process.env.PUSHER_SECRET = "s";
    process.env.PUSHER_CLUSTER = "eu";
    process.env.PUSHER_USE_PRIVATE_CHANNELS = "1";
    process.env.PUSHER_DRY_RUN = "1"; // avoid outbound network calls in unit tests

    __resetPusherClientForTests();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
    __resetPusherClientForTests();
  });

  it("POST /api/realtime/pusher/auth returns Pusher auth for allowed private channels", async () => {
    const app = makeApp();

    const token = await getTestAccessToken();
    const res = await request(app)
      .post("/api/realtime/pusher/auth")
      .set("Authorization", `Bearer ${token}`)
      .send({ socket_id: "123.456", channel_name: "private-audit-audit-123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        auth: expect.stringMatching(/^k:/),
      })
    );
  });

  it("POST /api/realtime/pusher/auth rejects invalid channel names", async () => {
    const app = makeApp();

    const token = await getTestAccessToken();
    const res = await request(app)
      .post("/api/realtime/pusher/auth")
      .set("Authorization", `Bearer ${token}`)
      .send({ socket_id: "123.456", channel_name: "private-audit-bad:chars" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        code: "VALIDATION_ERROR",
      })
    );
  });

  it("POST /api/realtime/pusher/auth rejects disallowed channels", async () => {
    const app = makeApp();

    const token = await getTestAccessToken();
    const res = await request(app)
      .post("/api/realtime/pusher/auth")
      .set("Authorization", `Bearer ${token}`)
      .send({ socket_id: "123.456", channel_name: "private-admin-123" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        error: "Channel not allowed",
      })
    );
  });

  it("POST /api/realtime/pusher/test succeeds (dry-run)", async () => {
    const app = makeApp();

    const token = await getTestAccessToken();
    const res = await request(app)
      .post("/api/realtime/pusher/test")
      .set("Authorization", `Bearer ${token}`)
      .send({ channel: "realtime-test", event: "realtime.test", payload: { ok: true } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        channel: "realtime-test",
        event: "realtime.test",
      })
    );
  });
});



