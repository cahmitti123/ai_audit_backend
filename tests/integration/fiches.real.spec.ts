import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cacheFicheSalesSummary } from "../../src/modules/fiches/fiches.cache.js";
// Real ops helpers (DB + external CRM API)
import { disconnectDb,prisma } from "../../src/shared/prisma.js";
import type { RecordingLike } from "../../src/utils/recording-parser.js";
import { makeApp } from "../test-app.js";
import { getTestAccessToken } from "../test-auth.js";
import { isIntegrationEnabled, readIsoDate } from "./_integration.env.js";

const describeIntegration = isIntegrationEnabled() ? describe : describe.skip;

function addDaysUtc(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

async function findMissingSalesDateAfter(
  startIsoDate: string,
  maxLookaheadDays: number
): Promise<string> {
  for (let i = 1; i <= maxLookaheadDays; i++) {
    const candidate = addDaysUtc(startIsoDate, i);
    const count = await prisma.ficheCache.count({ where: { salesDate: candidate } });
    if (count === 0) {return candidate;}
  }
  throw new Error(
    `Could not find any missing salesDate after ${startIsoDate} within ${maxLookaheadDays} days. ` +
      `Use a different INTEGRATION_SALES_DATE or run tests against a fresh/staging DB.`
  );
}

async function findRecentSalesDateWithFiches(app: ReturnType<typeof makeApp>, token: string) {
  const maxLookback = Number.parseInt(
    process.env.INTEGRATION_SALES_LOOKBACK_DAYS || "30",
    10
  );
  const today = new Date();

  for (let i = 0; i <= maxLookback; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().split("T")[0];

    const res = await request(app)
      .get(`/api/fiches/search?date=${encodeURIComponent(iso)}&includeStatus=false`)
      .set("Authorization", `Bearer ${token}`);

    // If CRM errors (rate limit / downtime), surface it immediately
    if (res.status >= 400) {
      throw new Error(
        `CRM-backed search failed for ${iso}: HTTP ${res.status} ${JSON.stringify(res.body)}`
      );
    }

    const fiches = res.body?.fiches;
    if (!Array.isArray(fiches) || fiches.length === 0) {continue;}

    const firstWithCle = (fiches as Array<Record<string, unknown>>).find((f) => {
      const cle = f.cle;
      return typeof cle === "string" && cle.trim().length > 0;
    });
    if (firstWithCle) {return iso;}
  }

  throw new Error(
    `Could not find a recent sales date with fiches (and usable 'cle') within ${maxLookback} days. ` +
      `Set INTEGRATION_SALES_DATE=YYYY-MM-DD to a date you know has data.`
  );
}

describeIntegration("Integration: fiches endpoints (real CRM + real DB)", () => {
  let app: ReturnType<typeof makeApp>;
  let token: string;
  let date: string;
  let ficheId: string;
  let ficheCle: string;
  let missingDate: string;
  let createdJobId: string | null = null;

  beforeAll(async () => {
    // Ensure DB is reachable
    await prisma.$connect();
    app = makeApp();

    token = await getTestAccessToken();
    date =
      readIsoDate("INTEGRATION_SALES_DATE") || (await findRecentSalesDateWithFiches(app, token));

    // 1) Use real endpoint to fetch the CRM sales list so we can discover real fiche IDs + cle
    const salesRes = await request(app)
      .get(`/api/fiches/search?date=${encodeURIComponent(date)}&includeStatus=false`)
      .set("Authorization", `Bearer ${token}`);
    expect(salesRes.status).toBe(200);
    expect(salesRes.body).toEqual(
      expect.objectContaining({
        fiches: expect.any(Array),
        total: expect.any(Number),
      })
    );

    const fiches = salesRes.body.fiches as Array<Record<string, unknown>>;
    const firstWithCle = fiches.find((f) => {
      const cle = f.cle;
      return typeof cle === "string" && cle.trim().length > 0;
    });

    if (!firstWithCle) {
      throw new Error(
        `GET /api/fiches/search returned ${fiches.length} fiches but none had a usable 'cle'. ` +
          `Pick a different INTEGRATION_SALES_DATE that has full CRM data.`
      );
    }

    const id = firstWithCle.id;
    const cle = firstWithCle.cle;
    if (typeof id !== "string" || typeof cle !== "string") {
      throw new Error("CRM fiche shape unexpected: missing string id/cle");
    }

    ficheId = id;
    ficheCle = cle;

    // 2) Cache the fiche as "sales-list-only" (real DB write) so we can test the cache->details upgrade path.
    await cacheFicheSalesSummary(
      {
        id: ficheId,
        cle: ficheCle,
        nom: typeof firstWithCle.nom === "string" ? firstWithCle.nom : "",
        prenom: typeof firstWithCle.prenom === "string" ? firstWithCle.prenom : "",
        email: typeof firstWithCle.email === "string" ? firstWithCle.email : "",
        telephone:
          typeof firstWithCle.telephone === "string" ? firstWithCle.telephone : "",
        telephone_2:
          typeof firstWithCle.telephone_2 === "string"
            ? firstWithCle.telephone_2
            : null,
        statut:
          typeof firstWithCle.statut === "string" ? firstWithCle.statut : null,
        date_insertion:
          typeof firstWithCle.date_insertion === "string"
            ? firstWithCle.date_insertion
            : null,
        date_modification:
          typeof firstWithCle.date_modification === "string"
            ? firstWithCle.date_modification
            : null,
        recordings: Array.isArray(firstWithCle.recordings)
          ? (firstWithCle.recordings as RecordingLike[])
          : undefined,
      },
      { salesDate: date }
    );

    // Assert DB cache exists and is flagged as sales-list-only
    const cachedBefore = await prisma.ficheCache.findUnique({
      where: { ficheId },
      select: { rawData: true },
    });
    expect(cachedBefore).not.toBeNull();
    const rawBefore = (cachedBefore!.rawData || {}) as Record<string, unknown>;
    expect(rawBefore._salesListOnly).toBe(true);

    // Find a date after `date` that is missing from DB so progressive fetch MUST create a job.
    missingDate = await findMissingSalesDateAfter(date, 365);

    // Ensure we don't reuse a job from a previous run for this exact range (5min dedupe window)
    await prisma.progressiveFetchJob.deleteMany({
      where: {
        startDate: date,
        endDate: missingDate,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
  });

  afterAll(async () => {
    if (createdJobId) {
      // Keep job history by default; but avoid leaving "processing" test jobs around when rerunning locally.
      await prisma.progressiveFetchJob.updateMany({
        where: { id: createdJobId, status: "processing" },
        data: { status: "failed", error: "integration test cleanup" },
      });
    }
    await disconnectDb();
  });

  it("GET /api/fiches/search (includeStatus=true) returns status and reflects hasData=true for cached fiche", async () => {
    const res = await request(app)
      .get(`/api/fiches/search?date=${encodeURIComponent(date)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        fiches: expect.any(Array),
        total: expect.any(Number),
      })
    );

    const fiches = res.body.fiches as Array<Record<string, unknown>>;
    const match = fiches.find((f) => f.id === ficheId);
    expect(match).toBeTruthy();
    expect(match?.status).toEqual(
      expect.objectContaining({
        hasData: true,
      })
    );
  }, 120_000);

  it("POST /api/fiches/status/batch returns status map for cached fiche", async () => {
    const res = await request(app)
      .post("/api/fiches/status/batch")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ficheIds: [ficheId, "999999999999"],
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.any(Object),
      })
    );

    expect(res.body.data[ficheId]).toEqual(
      expect.objectContaining({
        hasData: true,
        transcription: expect.any(Object),
        audit: expect.any(Object),
      })
    );
  });

  it("GET /api/fiches/status/by-date returns cached fiche for that sales date", async () => {
    const res = await request(app)
      .get(`/api/fiches/status/by-date?date=${encodeURIComponent(date)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          date,
          total: expect.any(Number),
          fiches: expect.any(Array),
        }),
      })
    );

    const fiches = res.body.data.fiches as Array<Record<string, unknown>>;
    const found = fiches.find((f) => f.ficheId === ficheId);
    expect(found).toBeTruthy();
  });

  it("GET /api/fiches/:id upgrades cache to full details and writes recordings to DB", async () => {
    // 1) This call should fetch from CRM because cache is sales-list-only
    const detailsRes = await request(app)
      .get(`/api/fiches/${ficheId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body).toEqual(
      expect.objectContaining({
        success: true,
        information: expect.objectContaining({
          fiche_id: ficheId,
        }),
      })
    );

    // 2) DB cache should no longer be flagged sales-list-only
    const cachedAfter = await prisma.ficheCache.findUnique({
      where: { ficheId },
      select: { rawData: true, recordingsCount: true, hasRecordings: true },
    });
    expect(cachedAfter).not.toBeNull();
    const rawAfter = (cachedAfter!.rawData || {}) as Record<string, unknown>;
    expect(rawAfter._salesListOnly).toBeUndefined();

    // 3) Recordings endpoint should return a list (possibly empty)
    const recRes = await request(app)
      .get(`/api/recordings/${ficheId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(recRes.status).toBe(200);
    expect(recRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.any(Array),
        count: expect.any(Number),
      })
    );

    // 4) Cache metadata endpoint should now exist
    const cacheRes = await request(app)
      .get(`/api/fiches/${ficheId}/cache`)
      .set("Authorization", `Bearer ${token}`);
    expect(cacheRes.status).toBe(200);
    expect(cacheRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          ficheId,
          recordingsCount: expect.any(Number),
        }),
      })
    );

    // 5) Status should say hasData=true
    const statusRes = await request(app)
      .get(`/api/fiches/${ficheId}/status`)
      .set("Authorization", `Bearer ${token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          ficheId,
          hasData: true,
        }),
      })
    );
  }, 180_000);

  it("GET /api/fiches/status/by-date-range creates a progressive job when at least one day is missing, and polling endpoints work", async () => {
    const res = await request(app)
      .get(
        `/api/fiches/status/by-date-range?startDate=${encodeURIComponent(
          date
        )}&endDate=${encodeURIComponent(missingDate)}`
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        startDate: date,
        endDate: missingDate,
        total: expect.any(Number),
        fiches: expect.any(Array),
        meta: expect.objectContaining({
          partial: true,
          complete: false,
          backgroundJobId: expect.any(String),
          cacheCoverage: expect.objectContaining({
            datesWithData: expect.any(Array),
            datesMissing: expect.any(Array),
          }),
        }),
      })
    );

    const jobId: string = res.body.meta.backgroundJobId;
    createdJobId = jobId;

    // Poll endpoint (frontend alternative to webhook)
    const pollRes = await request(app)
      .get(`/api/fiches/webhooks/fiches?jobId=${encodeURIComponent(jobId)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body).toEqual(
      expect.objectContaining({
        success: true,
        jobId,
        event: expect.any(String),
        data: expect.objectContaining({
          status: expect.any(String),
          progress: expect.any(Number),
          partialData: expect.any(Array),
        }),
      })
    );

    // Job details endpoint
    const jobRes = await request(app)
      .get(`/api/fiches/jobs/${jobId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(jobRes.status).toBe(200);
    expect(jobRes.body).toEqual(
      expect.objectContaining({
        success: true,
        job: expect.objectContaining({
          id: jobId,
          status: expect.any(String),
          startDate: date,
          endDate: missingDate,
        }),
      })
    );

    // Jobs list endpoint (should include the job, but don't over-assert ordering)
    const listRes = await request(app)
      .get("/api/fiches/jobs?limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual(
      expect.objectContaining({
        success: true,
        jobs: expect.any(Array),
        total: expect.any(Number),
      })
    );
  }, 120_000);
});


