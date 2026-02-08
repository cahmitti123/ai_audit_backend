/**
 * Transcriptions Workflows
 * =========================
 * Inngest workflow functions for transcription operations
 */

import crypto from "crypto";
import { NonRetriableError } from "inngest";

import { inngest } from "../../inngest/client.js";
import { CONCURRENCY, RATE_LIMITS, TIMEOUTS } from "../../shared/constants.js";
import {
  getInngestGlobalConcurrency,
  getInngestParallelismPerServer,
} from "../../shared/inngest-concurrency.js";
import { prisma } from "../../shared/prisma.js";
import { getRedisClient } from "../../shared/redis.js";
import { releaseRedisLock, tryAcquireRedisLock } from "../../shared/redis-lock.js";
import { transcriptionWebhooks } from "../../shared/webhook.js";
import { createWorkflowLogger } from "../../shared/workflow-logger.js";
import { createWorkflowTracer } from "../../shared/workflow-tracer.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import {
  ElevenLabsSpeechToTextError,
  normalizeElevenLabsApiKey,
  TranscriptionService,
} from "./transcriptions.elevenlabs.js";
import { updateRecordingTranscription } from "./transcriptions.repository.js";
import { getFicheTranscriptionStatus } from "./transcriptions.service.js";
import type {
  BatchTranscriptionResult,
  ExtendedTranscriptionResult,
  TranscriptionResult,
} from "./transcriptions.types.js";

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type TranscriptionPlan = {
  ficheCacheId: string; // BigInt -> string (JSON-safe)
  totalRecordings: number;
  alreadyTranscribed: number;
  missingRecordingUrlCount: number;
  missingRecordingUrlToTranscribeCount: number;
  toTranscribe: Array<{ callId: string; recordingUrl: string }>;
};

type RecordingMeta = {
  ficheCacheId: string;
  hasTranscription: boolean;
  transcriptionId: string | null;
  recordingUrl: string | null;
};

/**
 * Transcribe Fiche Function
 * ==========================
 * Transcribes all recordings for a fiche using ElevenLabs
 * - Retries: 3 times
 * - Rate limited: 10/min (ElevenLabs quota)
 * - Timeout: 15 minutes
 * - Idempotent: per fiche_id
 * - Batch events: max 5 fiches per batch, 10s timeout
 */
export const transcribeFicheFunction = inngest.createFunction(
  {
    id: "transcribe-fiche",
    name: "Transcribe Fiche Recordings",
    retries: 3,
    concurrency: [
      {
        limit: CONCURRENCY.TRANSCRIPTION.limit,
      },
    ],
    rateLimit: {
      ...RATE_LIMITS.TRANSCRIPTION,
      key: "event.data.fiche_id",
    },
    timeouts: {
      finish: TIMEOUTS.TRANSCRIPTION,
    },
    // REMOVED idempotency to allow parallel execution from automation workflows
    // The transcription logic itself handles duplicate checks
    // IMPORTANT: Don't batch here; batching reduces throughput and prevents max concurrency.
  },
  { event: "fiche/transcribe" },
  async ({ event, step, logger }): Promise<BatchTranscriptionResult> => {
    // Handle batch processing if multiple events
    const events = Array.isArray(event) ? event : [event];
    logger.info("Processing transcription batch", {
      count: events.length,
      fiches: events.map((e) => e.data.fiche_id),
    });

    const results: ExtendedTranscriptionResult[] = [];

    for (const evt of events) {
      const { fiche_id, priority = "normal" } = evt.data;
      const waitForCompletion =
        (evt.data as unknown as { wait_for_completion?: boolean })
          ?.wait_for_completion !== false;

      const tracer = createWorkflowTracer({
        workflow: "transcription",
        entity: { type: "fiche", id: fiche_id },
        inngestEventId: typeof evt.id === "string" ? evt.id : undefined,
      });
      const wlog = createWorkflowLogger("transcription", fiche_id, { tracer });
      wlog.start("transcribe-fiche", { priority, wait_for_completion: waitForCompletion, event_id: evt.id });

      // Capture start time in a step to persist it across Inngest checkpoints
      const startTimeRaw = await step.run(
        `capture-start-time-${fiche_id}`,
        async (): Promise<number> => {
          return Date.now();
        }
      );
      const startTime = typeof startTimeRaw === "number" ? startTimeRaw : Date.now();

      // Validate API key at function level (non-retriable error)
      const apiKey = normalizeElevenLabsApiKey(process.env.ELEVENLABS_API_KEY);
      if (!apiKey) {
        wlog.error("ElevenLabs API key not configured!");
        throw new NonRetriableError(
          "ElevenLabs API key not configured (set ELEVENLABS_API_KEY)"
        );
      }

      wlog.info("API key validated, starting transcription");

      // Always force-refresh fiche details before building the transcription plan so the
      // recordings list + recording URLs are always up-to-date.
      wlog.step("force-refresh-fiche", { fiche_id, force_refresh: true });
      const { startedAt: forceRefreshStartedAt } = await step.run(
        `log-force-refresh-fiche-start-${fiche_id}`,
        async () => {
          const startedAt = Date.now();
          logger.info("Force-refreshing fiche details before transcription plan", {
            fiche_id,
            force_refresh: true,
          });
          return { startedAt };
        }
      );

      const forceRefreshResult = await step.invoke(`force-refresh-fiche-${fiche_id}`, {
        function: fetchFicheFunction,
        data: {
          fiche_id,
          force_refresh: true,
        },
      });

      await step.run(`log-force-refresh-fiche-done-${fiche_id}`, async () => {
        const rr = isRecord(forceRefreshResult) ? (forceRefreshResult as Record<string, unknown>) : {};
        const result = {
          ...(typeof rr.success === "boolean" ? { success: rr.success } : {}),
          ...(typeof rr.cached === "boolean" ? { cached: rr.cached } : {}),
          ...(typeof rr.cache_id === "string" ? { cache_id: rr.cache_id } : {}),
          ...(typeof rr.recordings_count === "number"
            ? { recordings_count: rr.recordings_count }
            : {}),
          ...(typeof rr.cache_check === "string" ? { cache_check: rr.cache_check } : {}),
          ...(typeof rr.not_found === "boolean" ? { not_found: rr.not_found } : {}),
        };
        wlog.stepDone("force-refresh-fiche", result);
        logger.info("Fiche force-refresh completed (transcription)", {
          fiche_id,
          force_refresh: true,
          elapsed_ms:
            typeof forceRefreshStartedAt === "number"
              ? Math.max(0, Date.now() - forceRefreshStartedAt)
              : undefined,
          fetch_result: result,
        });
        return { logged: true };
      });

      // Terminal: fiche is missing upstream (404). Treat as "skip" and never block downstream.
      if (forceRefreshResult?.not_found === true) {
        const durationMs = Math.max(0, Date.now() - startTime);
        const durationSeconds = Math.max(0, Math.round(durationMs / 1000));
        const err = "Fiche not found (404)";

        await step.run(`send-transcription-failed-not-found-${fiche_id}`, async () => {
          await transcriptionWebhooks.failed(fiche_id, err, {
            total: 0,
            transcribed: 0,
            failed: 0,
          });
          return { notified: true };
        });

        await step.sendEvent(`emit-completion-${fiche_id}`, {
          name: "fiche/transcribed",
          data: {
            fiche_id,
            transcribed_count: 0,
            cached_count: 0,
            failed_count: 0,
            duration_ms: durationMs,
          },
        });

        await step.run(`log-transcription-skipped-not-found-${fiche_id}`, async () => {
          logger.warn("Skipping transcription: fiche marked NOT_FOUND", {
            fiche_id,
            duration_seconds: durationSeconds,
          });
          return { logged: true };
        });

        results.push({
          success: false,
          fiche_id,
          cached: true,
          total: 0,
          transcribed: 0,
          newTranscriptions: 0,
          failed: 0,
          error: err,
        });
        continue;
      }

      // Load a JSON-safe plan from DB (we need recordingUrl to fan-out work per recording).
      const plan = await step.run(
        `load-transcription-plan-${fiche_id}`,
        async (): Promise<TranscriptionPlan> => {
        const fiche = await prisma.ficheCache.findUnique({
          where: { ficheId: fiche_id },
          select: {
            id: true,
            recordings: {
              select: {
                callId: true,
                recordingUrl: true,
                hasTranscription: true,
              },
              orderBy: { startTime: "asc" },
            },
          },
        });

        if (!fiche) {
          throw new NonRetriableError(
            "Fiche not found in cache; fetch fiche details first to load recordings"
          );
        }

        const totalRecordings = fiche.recordings.length;
        const alreadyTranscribed = fiche.recordings.filter((r) => r.hasTranscription).length;
        const missingRecordingUrlCount = fiche.recordings.filter((r) => {
          return typeof r.recordingUrl !== "string" || r.recordingUrl.trim().length === 0;
        }).length;
        const missingRecordingUrlToTranscribeCount = fiche.recordings.filter((r) => {
          return (
            !r.hasTranscription &&
            (typeof r.recordingUrl !== "string" || r.recordingUrl.trim().length === 0)
          );
        }).length;
        const toTranscribe = fiche.recordings
          .filter((r) => !r.hasTranscription)
          .map((r) => ({
            callId: r.callId,
            recordingUrl: r.recordingUrl,
          }));

        return {
          ficheCacheId: fiche.id.toString(), // BigInt -> string (JSON-safe)
          totalRecordings,
          alreadyTranscribed,
          missingRecordingUrlCount,
          missingRecordingUrlToTranscribeCount,
          toTranscribe,
        };
        }
      );

      wlog.stepDone("load-plan", {
        total: plan.totalRecordings,
        already_transcribed: plan.alreadyTranscribed,
        to_transcribe: plan.toTranscribe.length,
        missing_url: plan.missingRecordingUrlCount,
        missing_url_to_transcribe: plan.missingRecordingUrlToTranscribeCount,
      });
      logger.info("Transcription plan built", {
        fiche_id,
        total: plan.totalRecordings,
        already_transcribed: plan.alreadyTranscribed,
        to_transcribe: plan.toTranscribe.length,
        missing_url_total: plan.missingRecordingUrlCount,
        missing_url_to_transcribe: plan.missingRecordingUrlToTranscribeCount,
      });

      // Send status check webhook (mirrors service behavior)
      await step.run(`send-transcription-status-check-${fiche_id}`, async () => {
        await transcriptionWebhooks.statusCheck(
          fiche_id,
          plan.totalRecordings,
          plan.alreadyTranscribed,
          plan.toTranscribe.length
        );
        return { notified: true };
      });

      const totalRecordings = plan.totalRecordings;
      const alreadyTranscribed = plan.alreadyTranscribed;
      const toTranscribe = plan.toTranscribe;

      if (totalRecordings === 0 || alreadyTranscribed === totalRecordings) {
        // Send workflow started webhook (even for already complete, to keep behaviour consistent)
        await step.run(`send-transcription-started-${fiche_id}`, async () => {
          await transcriptionWebhooks.started(
            fiche_id,
            totalRecordings,
            priority
          );
          return { notified: true };
        });

        logger.info("All recordings already transcribed", {
          fiche_id,
          count: alreadyTranscribed,
        });

        // Send completion event
        await step.sendEvent(`emit-completion-${fiche_id}`, {
          name: "fiche/transcribed",
          data: {
            fiche_id,
            transcribed_count: 0,
            cached_count: 0,
            failed_count: 0,
          },
        });

        results.push({
          success: true,
          fiche_id,
          cached: true,
          total: totalRecordings,
          transcribed: alreadyTranscribed,
          newTranscriptions: 0,
          failed: 0,
        });
        continue;
      }

      const maxWaitSeconds = Math.max(
        30,
        Number(process.env.TRANSCRIPTION_MAX_WAIT_SECONDS || 15 * 60)
      );

      // Prefer Redis-backed aggregation when available (avoids DB polling + is multi-replica safe).
      wlog.step("check-redis");
      let redis = null as Awaited<ReturnType<typeof getRedisClient>>;
      try {
        redis = await getRedisClient();
      } catch {
        redis = null;
      }
      if (redis) {
        wlog.stepDone("check-redis", { available: true });
      } else {
        wlog.warn("Redis NOT available! Finalizer will be SKIPPED. Completion signals will NOT fire.");
        wlog.stepDone("check-redis", { available: false });
      }

      // Acquire a cross-replica lock to prevent duplicate transcription work for the same fiche.
      // TTL should cover the whole run; finalizer releases the lock when finished (Redis mode).
      const lockKey = `lock:transcription:fiche:${fiche_id}`;
      const lockTtlMs = Math.max(
        30 * 60 * 1000,
        Number(
          process.env.TRANSCRIPTION_LOCK_TTL_MS ||
            maxWaitSeconds * 1000 + 10 * 60 * 1000
        )
      );

      const lock = await step.run(`acquire-lock-${fiche_id}`, async () => {
        return await tryAcquireRedisLock({
          key: lockKey,
          ttlMs: lockTtlMs,
        });
      });

      // If another replica already owns the lock, optionally wait for completion so downstream
      // workflows (eg. audits) never proceed with missing transcriptions.
      if (!lock.acquired) {
        wlog.warn("Lock NOT acquired - another transcription is already running", { lockKey, lock_enabled: lock.enabled });
        logger.warn("Transcription already in progress for fiche", {
          fiche_id,
          lockKey,
        });

        if (waitForCompletion) {
          await step.waitForEvent(`wait-for-fiche-transcribed-${fiche_id}`, {
            event: "fiche/transcribed",
            timeout: `${maxWaitSeconds}s`,
            match: "data.fiche_id",
          });
        }

        const statusAfterWait = await step.run(
          `status-after-wait-${fiche_id}`,
          async () => {
            return await getFicheTranscriptionStatus(fiche_id);
          }
        );

        results.push({
          success: true,
          fiche_id,
          cached: true,
          total: statusAfterWait.total || 0,
          transcribed: statusAfterWait.transcribed || 0,
          newTranscriptions: 0,
          failed: 0,
        });
        continue;
      }

      // IMPORTANT: Generate runId inside step.run() so it is memoised by Inngest
      // and stays identical across step replays (each replay calls crypto.randomUUID()
      // anew; without memoisation the subsequent steps would use a different id).
      const runId = await step.run(`generate-run-id-${fiche_id}`, () => {
        return crypto.randomUUID();
      });
      const toTranscribeCount = toTranscribe.length;
      const targetCallIds = toTranscribe.map((r) => r.callId);

      wlog.info("Lock acquired, starting run", { run_id: runId, lock_enabled: lock.enabled, to_transcribe: toTranscribeCount, call_ids: targetCallIds.slice(0, 5) });

      // Send workflow started webhook now that we own the lock
      await step.run(`send-transcription-started-${fiche_id}`, async () => {
        await transcriptionWebhooks.started(fiche_id, totalRecordings, priority);
        return { notified: true };
      });

      // If Redis is available, persist a run state so a finalizer can aggregate without polling.
      if (redis) {
        wlog.step("store-redis-run-state", { run_id: runId, pending_count: targetCallIds.length });
        const redisClient = redis;
        const ttlSeconds = Math.max(
          60,
          Number(process.env.TRANSCRIPTION_RUN_STATE_TTL_SECONDS || 2 * 60 * 60)
        );
        const baseKey = `transcription:fiche:${fiche_id}:run:${runId}`;
        const metaKey = `${baseKey}:meta`;
        const pendingKey = `${baseKey}:pending`;
        const failedKey = `${baseKey}:failed`;
        const activeKey = `transcription:fiche:${fiche_id}:activeRun`;

        await step.run(`store-run-state-${fiche_id}`, async () => {
          const multi = redisClient.multi();
          multi.hSet(metaKey, {
            run_id: runId,
            fiche_id,
            started_at_ms: String(Date.now()),
            total_recordings: String(totalRecordings),
            already_transcribed: String(alreadyTranscribed),
            target_total: String(toTranscribeCount),
            lock_key: lockKey,
            lock_token: lock.token,
            lock_enabled: lock.enabled ? "1" : "0",
            priority,
            processed: "0",
            cached: "0",
            failed: "0",
          });

          if (targetCallIds.length > 0) {
            multi.sAdd(pendingKey, targetCallIds);
          }

          multi.expire(metaKey, ttlSeconds);
          multi.expire(pendingKey, ttlSeconds);
          multi.expire(failedKey, ttlSeconds);
          multi.setEx(activeKey, ttlSeconds, runId);
          await multi.exec();

          return { stored: true, run_id: runId };
        });
        wlog.stepDone("store-redis-run-state");
      } else {
        wlog.warn("No Redis -- run state NOT stored. Finalizer will skip. No completion event will fire!");
      }

      // Fan-out: dispatch one event per recording so work is distributed across replicas.
      const recordingEvents = toTranscribe.map((rec, idx) => ({
        name: "transcription/recording.transcribe" as const,
        data: {
          run_id: runId,
          fiche_id,
          fiche_cache_id: plan.ficheCacheId,
          call_id: rec.callId,
          recording_url: rec.recordingUrl,
          recording_index: idx + 1,
          total_to_transcribe: toTranscribeCount,
          priority,
        },
        id: `transcription-recording-${runId}-${rec.callId}`,
      }));

      const sendResult = await step.sendEvent(
        `fan-out-recordings-${fiche_id}`,
        recordingEvents
      );

      await step.run(`log-fan-out-recordings-${fiche_id}`, async () => {
        const idsRaw =
          isRecord(sendResult) && Array.isArray(sendResult.ids)
            ? (sendResult.ids as unknown[])
            : [];
        const ids = idsRaw
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .slice(0, 10);
        wlog.fanOut("transcription/recording.transcribe", recordingEvents.length, {
          run_id: runId,
          call_ids: targetCallIds.slice(0, 10),
        });
        logger.info("Dispatched transcription/recording.transcribe fan-out events", {
          fiche_id,
          run_id: runId,
          total_events: recordingEvents.length,
          chunks: 1,
          ids_count: idsRaw.length,
          ids_sample: ids,
        });
        return { logged: true, idsCount: idsRaw.length };
      });

      // If we're in "enqueue" mode, return immediately; finalizer will emit progress/completion.
      if (!waitForCompletion) {
        wlog.info("Enqueue mode (wait_for_completion=false) - returning immediately. Finalizer handles completion.");
        wlog.end("enqueued", { run_id: runId, recordings_dispatched: toTranscribeCount });
        results.push({
          success: true,
          fiche_id,
          cached: false,
          total: totalRecordings,
          transcribed: alreadyTranscribed,
          newTranscriptions: 0,
          failed: 0,
        });
        continue;
      }

      // Redis mode: wait durably for the finalizer to emit `fiche/transcribed`.
      // Non-Redis fallback: poll DB (keeps legacy behaviour).
      if (redis) {
        await step.waitForEvent(`wait-for-fiche-transcribed-${fiche_id}`, {
          event: "fiche/transcribed",
          timeout: `${maxWaitSeconds}s`,
          match: "data.fiche_id",
        });

        const statusAfter = await step.run(`final-status-${fiche_id}`, async () => {
          return await getFicheTranscriptionStatus(fiche_id);
        });

        results.push({
          success: true,
          fiche_id,
          cached: false,
          total: statusAfter.total || 0,
          transcribed: statusAfter.transcribed || 0,
          newTranscriptions: Math.max(
            0,
            (statusAfter.transcribed || 0) - alreadyTranscribed
          ),
          failed: 0,
        });
        continue;
      }

      // Fallback: poll DB until all targeted recordings are transcribed (or timeout).
      const rawFicheCacheId: unknown = plan.ficheCacheId;
      const parseFicheCacheId = (value: unknown): bigint | null => {
        if (typeof value === "bigint") {return value;}
        if (typeof value === "number" && Number.isInteger(value) && value > 0) {
          return BigInt(value);
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (!trimmed) {return null;}
          try {
            return BigInt(trimmed);
          } catch {
            return null;
          }
        }
        return null;
      };

      // `plan.ficheCacheId` should normally be present, but guard against empty/invalid values
      // so the polling loop never crashes with BigInt("") / RangeError.
      let ficheCacheId: bigint | null = parseFicheCacheId(rawFicheCacheId);
      if (!ficheCacheId && targetCallIds.length > 0) {
        const resolved = await step.run(`resolve-fiche-cache-id-${fiche_id}`, async () => {
          const row = await prisma.ficheCache.findUnique({
            where: { ficheId: fiche_id },
            select: { id: true },
          });
          return row?.id ?? null;
        });
        ficheCacheId = typeof resolved === "bigint" ? resolved : null;
      }

      const pollByFicheRelation = !ficheCacheId;
      const pollIntervalSeconds = Math.max(
        2,
        Number(process.env.TRANSCRIPTION_POLL_INTERVAL_SECONDS || 5)
      );

      let transcribedTarget = 0;
      let prevTranscribedTarget = -1;
      let pollAttempt = 0;
      const deadline = startTime + maxWaitSeconds * 1000;

      try {
        while (Date.now() < deadline) {
          const polled = await step.run(
            `poll-transcription-progress-${fiche_id}-${pollAttempt}`,
            async (): Promise<{ transcribedTarget: number }> => {
              // Safety: if there are no targets, we're done.
              if (targetCallIds.length === 0) {
                return { transcribedTarget: 0 };
              }

              // Query only the targeted recordings for this run.
              // IMPORTANT: Never drop the fiche constraint. `callId` is only unique per fiche
              // (`(ficheCacheId, callId)` composite key), so filtering by callId alone could
              // accidentally include recordings from other fiches.
              const where = pollByFicheRelation
                ? { ficheCache: { ficheId: fiche_id }, callId: { in: targetCallIds } }
                : { ficheCacheId: ficheCacheId as bigint, callId: { in: targetCallIds } };

              const rows = await prisma.recording.findMany({
                where: {
                  ...where,
                },
                select: { hasTranscription: true },
              });

              const done = rows.filter((r) => r.hasTranscription).length;
              return { transcribedTarget: done };
            }
          );

          transcribedTarget = toNumber(polled.transcribedTarget, 0);

          if (transcribedTarget !== prevTranscribedTarget) {
            prevTranscribedTarget = transcribedTarget;

            const transcribedOverall = alreadyTranscribed + transcribedTarget;
            const pendingOverall = Math.max(
              0,
              totalRecordings - transcribedOverall
            );

            await step.run(
              `send-transcription-progress-${fiche_id}-${pollAttempt}`,
              async () => {
                await transcriptionWebhooks.progress(
                  fiche_id,
                  totalRecordings,
                  transcribedOverall,
                  pendingOverall,
                  0
                );
                return { notified: true };
              }
            );
          }

          if (targetCallIds.length > 0 && transcribedTarget >= targetCallIds.length) {
            break;
          }

          pollAttempt++;
          await step.sleep(
            `sleep-transcription-progress-${fiche_id}-${pollAttempt}`,
            `${pollIntervalSeconds}s`
          );
        }

        const failedTarget = Math.max(0, targetCallIds.length - transcribedTarget);
        const result: TranscriptionResult = {
          total: totalRecordings,
          transcribed: alreadyTranscribed + transcribedTarget,
          newTranscriptions: transcribedTarget,
          failed: failedTarget,
        };

        const durationMs = Date.now() - startTime;
        const durationSeconds = Math.round(durationMs / 1000);

        await step.run(`send-transcription-completed-${fiche_id}`, async () => {
          await transcriptionWebhooks.completed(
            fiche_id,
            result.total || 0,
            result.transcribed || 0,
            result.failed || 0,
            durationSeconds
          );
          return { notified: true };
        });

        await step.sendEvent(`emit-completion-${fiche_id}`, {
          name: "fiche/transcribed",
          data: {
            fiche_id,
            transcribed_count: result.newTranscriptions || 0,
            cached_count: 0,
            failed_count: result.failed || 0,
            duration_ms: durationMs,
          },
        });

        results.push({
          success: true,
          fiche_id,
          cached: false,
          total: result.total || 0,
          transcribed: result.transcribed || 0,
          newTranscriptions: result.newTranscriptions || 0,
          failed: result.failed || 0,
        });
      } finally {
        if (lock.enabled) {
          await step.run(`release-lock-${fiche_id}`, async () => {
            await releaseRedisLock({ key: lockKey, token: lock.token });
            return { released: true };
          });
        }
      }
    }

    return {
      success: true,
      batch_size: events.length,
      results,
    };
  }
);

const RECORDING_WORKER_CONCURRENCY = Math.max(
  1,
  Number(
    process.env.TRANSCRIPTION_RECORDING_WORKER_CONCURRENCY ||
      getInngestGlobalConcurrency()
  )
);

const RECORDING_PER_FICHE_CONCURRENCY = Math.max(
  1,
  Number(
    process.env.TRANSCRIPTION_RECORDING_PER_FICHE_CONCURRENCY ||
      getInngestParallelismPerServer()
  )
);

const ELEVENLABS_RECORDING_RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number(process.env.TRANSCRIPTION_ELEVENLABS_RATE_LIMIT_PER_MINUTE || 10)
);

const ELEVENLABS_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.TRANSCRIPTION_ELEVENLABS_MAX_ATTEMPTS || 6)
);

const ELEVENLABS_BACKOFF_BASE_SECONDS = Math.max(
  1,
  Number(process.env.TRANSCRIPTION_ELEVENLABS_BACKOFF_BASE_SECONDS || 2)
);

const ELEVENLABS_BACKOFF_MAX_SECONDS = Math.max(
  ELEVENLABS_BACKOFF_BASE_SECONDS,
  Number(process.env.TRANSCRIPTION_ELEVENLABS_BACKOFF_MAX_SECONDS || 60)
);

function getRetryDelaySeconds(params: {
  attempt: number;
  retryAfterSeconds?: number;
}): number {
  const attemptNo = Math.max(1, Math.floor(params.attempt));
  const exp = Math.min(
    ELEVENLABS_BACKOFF_MAX_SECONDS,
    ELEVENLABS_BACKOFF_BASE_SECONDS * 2 ** (attemptNo - 1)
  );
  const delay = typeof params.retryAfterSeconds === "number" && params.retryAfterSeconds > 0
    ? Math.max(exp, params.retryAfterSeconds)
    : exp;
  return Math.max(1, Math.ceil(delay));
}

function getElevenLabsRetryHint(error: unknown): {
  retryable: boolean;
  status?: number;
  retryAfterSeconds?: number;
} {
  if (error instanceof ElevenLabsSpeechToTextError) {
    const status = error.status;
    const retryAfterSeconds = error.retryAfterSeconds;
    const retryable =
      status === 429 ||
      status === 408 ||
      (typeof status === "number" && status >= 500 && status <= 599);
    return { retryable, status, retryAfterSeconds };
  }

  // Fallback: parse safe error message (eg. "status=429") when we lost structured data.
  if (error instanceof Error) {
    const m = /(?:^|\s)status=(\d{3})(?:\s|$)/.exec(error.message);
    const status = m ? Number(m[1]) : undefined;
    const retryable =
      status === 429 ||
      status === 408 ||
      (typeof status === "number" && status >= 500 && status <= 599);
    return { retryable, status };
  }

  return { retryable: false };
}

/**
 * Transcribe Recording Function (Worker)
 * ======================================
 * Transcribes ONE recording (fan-out worker) so work can be distributed across replicas.
 *
 * IMPORTANT:
 * - Do NOT do per-fiche loops here.
 * - Use a per-recording redis lock to prevent duplicate transcriptions across replicas.
 */
export const transcribeRecordingFunction = inngest.createFunction(
  {
    id: "transcribe-recording",
    name: "Transcribe Recording",
    // Allow 2 Inngest-level retries for infrastructure failures (container restart, timeout, OOM).
    // ElevenLabs rate-limiting (429) is handled internally with exponential backoff, so these
    // retries only kick in when the function itself crashes before the catch block can emit the
    // `transcription/recording.transcribed` event — which would otherwise leave the recording
    // stuck as "pending" in Redis forever and block the finalizer from completing.
    retries: 2,
    concurrency: [
      {
        limit: RECORDING_WORKER_CONCURRENCY,
      },
      // Per-fiche cap (prevents a single fiche with many recordings from consuming all capacity)
      {
        key: "event.data.fiche_id",
        limit: RECORDING_PER_FICHE_CONCURRENCY,
      },
    ],
    // Global provider cap (prevents ElevenLabs 429 due to high fan-out across replicas).
    // Override with TRANSCRIPTION_ELEVENLABS_RATE_LIMIT_PER_MINUTE if your plan allows more throughput.
    rateLimit: {
      limit: ELEVENLABS_RECORDING_RATE_LIMIT_PER_MINUTE,
      period: "1m",
    },
    timeouts: {
      finish: TIMEOUTS.TRANSCRIPTION,
    },
  },
  { event: "transcription/recording.transcribe" },
  async ({ event, step, logger }) => {
    const {
      run_id,
      fiche_id,
      fiche_cache_id,
      call_id,
      recording_url,
      recording_index,
      total_to_transcribe,
    } = event.data;

    const eventId = typeof event.id === "string" ? event.id : String(event.id ?? "");
    const workerStartedAt = Date.now();
    let attempt = 0;

    const tracer = createWorkflowTracer({
      workflow: "transcription",
      entity: { type: "recording", id: `${fiche_id}/${call_id}` },
      traceId: run_id,
      inngestEventId: eventId || undefined,
    });
    const wlog = createWorkflowLogger("tx-worker", `${fiche_id}/${call_id}`, { tracer });
    wlog.start("transcribe-recording", { run_id, recording_index, total_to_transcribe, recording_url: recording_url?.slice(0, 80) });

    logger.info("Recording transcription worker started", {
      event_id: eventId,
      run_id,
      fiche_id,
      call_id,
      recording_index,
      total_to_transcribe,
    });

    const emitRecordingDone = async (params: {
      ok: boolean;
      cached: boolean;
      error?: string;
      transcription_id?: string;
    }) => {
      if (!run_id || typeof run_id !== "string") {return;}
      await step.sendEvent(`emit-recording-transcribed-${call_id}`, {
        name: "transcription/recording.transcribed",
        data: {
          run_id,
          fiche_id,
          call_id,
          ok: params.ok,
          cached: params.cached,
          ...(params.error ? { error: params.error } : {}),
          ...(params.transcription_id ? { transcription_id: params.transcription_id } : {}),
          recording_index,
          total_to_transcribe,
        },
        id: `transcription-recording-transcribed-${run_id}-${call_id}`,
      });
    };

    // Validate API key at worker level (non-retriable error)
    const apiKey = normalizeElevenLabsApiKey(process.env.ELEVENLABS_API_KEY);
    if (!apiKey) {
      throw new NonRetriableError(
        "ElevenLabs API key not configured (set ELEVENLABS_API_KEY)"
      );
    }

    const lockKey = `lock:transcription:recording:${fiche_id}:${call_id}`;
    const lock = await step.run(`acquire-recording-lock-${call_id}`, async () => {
      return await tryAcquireRedisLock({
        key: lockKey,
        ttlMs: 30 * 60 * 1000, // 30 minutes
      });
    });

    if (!lock.acquired) {
      logger.warn("Recording transcription already in progress, skipping", {
        event_id: eventId,
        run_id,
        fiche_id,
        call_id,
        lockKey,
      });
      await emitRecordingDone({ ok: true, cached: true });
      logger.info("Recording transcription worker finished (skipped)", {
        event_id: eventId,
        run_id,
        fiche_id,
        call_id,
        cached: true,
        attempts: attempt,
        elapsed_ms: Math.max(0, Date.now() - workerStartedAt),
      });
      return { success: true, fiche_id, call_id, cached: true };
    }

    try {
      const rec = await step.run(
        `load-recording-${call_id}`,
        async (): Promise<RecordingMeta | null> => {
        // Prefer the direct composite key lookup if we have fiche_cache_id.
        if (typeof fiche_cache_id === "string" && fiche_cache_id.length > 0) {
          const ficheCacheId = BigInt(fiche_cache_id);
          const r = await prisma.recording.findUnique({
            where: {
              ficheCacheId_callId: {
                ficheCacheId,
                callId: call_id,
              },
            },
            select: {
              ficheCacheId: true,
              hasTranscription: true,
              transcriptionId: true,
              recordingUrl: true,
            },
          });

          if (!r) {return null;}
          return {
            ficheCacheId: r.ficheCacheId.toString(),
            hasTranscription: r.hasTranscription,
            transcriptionId: r.transcriptionId,
            recordingUrl: r.recordingUrl,
          };
        }

        const r = await prisma.recording.findFirst({
          where: {
            callId: call_id,
            ficheCache: { ficheId: fiche_id },
          },
          select: {
            ficheCacheId: true,
            hasTranscription: true,
            transcriptionId: true,
            recordingUrl: true,
          },
        });

        if (!r) {return null;}
        return {
          ficheCacheId: r.ficheCacheId.toString(),
          hasTranscription: r.hasTranscription,
          transcriptionId: r.transcriptionId,
          recordingUrl: r.recordingUrl,
        };
        }
      );

      if (!rec) {
        const msg = "Recording not found in database";
        await step.run(`send-recording-failed-${call_id}`, async () => {
          await transcriptionWebhooks.recordingFailed(
            fiche_id,
            call_id,
            msg,
            recording_index,
            total_to_transcribe
          );
          return { notified: true };
        });
        await emitRecordingDone({ ok: false, cached: false, error: msg });
        return { success: false, fiche_id, call_id, error: msg };
      }

      if (rec.hasTranscription) {
        logger.info("Recording already transcribed; skipping", {
          event_id: eventId,
          run_id,
          fiche_id,
          call_id,
        });
        await emitRecordingDone({
          ok: true,
          cached: true,
          transcription_id: rec.transcriptionId || undefined,
        });
        logger.info("Recording transcription worker finished (cached)", {
          event_id: eventId,
          run_id,
          fiche_id,
          call_id,
          cached: true,
          attempts: attempt,
          elapsed_ms: Math.max(0, Date.now() - workerStartedAt),
        });
        return {
          success: true,
          fiche_id,
          call_id,
          cached: true,
          transcription_id: rec.transcriptionId || undefined,
        };
      }

      const url =
        typeof recording_url === "string" && recording_url.length > 0
          ? recording_url
          : rec.recordingUrl ?? undefined;

      if (!url) {
        const msg = "No recording URL available";
        await step.run(`send-recording-failed-${call_id}`, async () => {
          await transcriptionWebhooks.recordingFailed(
            fiche_id,
            call_id,
            msg,
            recording_index,
            total_to_transcribe
          );
          return { notified: true };
        });
        await emitRecordingDone({ ok: false, cached: false, error: msg });
        return { success: false, fiche_id, call_id, error: msg };
      }

      await step.run(`send-recording-started-${call_id}`, async () => {
        await transcriptionWebhooks.recordingStarted(
          fiche_id,
          call_id,
          recording_index,
          total_to_transcribe,
          url
        );
        return { notified: true };
      });

      let transcription:
        | Awaited<ReturnType<TranscriptionService["transcribe"]>>
        | null = null;
      while (!transcription) {
        attempt++;
        try {
          transcription = await step.run(
            `elevenlabs-transcribe-${call_id}-attempt-${attempt}`,
            async () => {
              const svc = new TranscriptionService(apiKey);
              return await svc.transcribe(url);
            }
          );
        } catch (err: unknown) {
          const hint = getElevenLabsRetryHint(err);
          const canRetry = hint.retryable && attempt < ELEVENLABS_MAX_ATTEMPTS;
          if (!canRetry) {
            throw err;
          }

          const delaySeconds = getRetryDelaySeconds({
            attempt,
            retryAfterSeconds: hint.retryAfterSeconds,
          });

          logger.warn("ElevenLabs transcription throttled; backing off", {
            fiche_id,
            call_id,
            attempt: `${attempt}/${ELEVENLABS_MAX_ATTEMPTS}`,
            status: hint.status,
            retry_after_seconds: hint.retryAfterSeconds,
            delay_seconds: delaySeconds,
          });

          await step.sleep(
            `elevenlabs-backoff-${call_id}-attempt-${attempt}`,
            `${delaySeconds}s`
          );
        }
      }

      const transcriptionId = transcription.transcription_id;
      if (!transcriptionId) {
        throw new Error("Missing transcription_id from provider");
      }

      await step.run(`update-recording-${call_id}`, async () => {
        await updateRecordingTranscription(
          BigInt(rec.ficheCacheId),
          call_id,
          transcriptionId,
          transcription.transcription.text,
          transcription.transcription
        );
        return { updated: true };
      });

      await step.run(`send-recording-completed-${call_id}`, async () => {
        await transcriptionWebhooks.recordingCompleted(
          fiche_id,
          call_id,
          transcriptionId,
          recording_index,
          total_to_transcribe
        );
        return { notified: true };
      });

      await emitRecordingDone({
        ok: true,
        cached: false,
        transcription_id: transcriptionId,
      });
      logger.info("Recording transcription worker finished", {
        event_id: eventId,
        run_id,
        fiche_id,
        call_id,
        cached: false,
        transcription_id: transcriptionId,
        attempts: attempt,
        elapsed_ms: Math.max(0, Date.now() - workerStartedAt),
      });
      return {
        success: true,
        fiche_id,
        call_id,
        cached: false,
        transcription_id: transcriptionId,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Recording transcription failed", {
        event_id: eventId,
        run_id,
        fiche_id,
        call_id,
        attempts: attempt,
        elapsed_ms: Math.max(0, Date.now() - workerStartedAt),
        error: msg,
      });

      await step.run(`send-recording-failed-${call_id}`, async () => {
        await transcriptionWebhooks.recordingFailed(
          fiche_id,
          call_id,
          msg,
          recording_index,
          total_to_transcribe
        );
        return { notified: true };
      });

      await emitRecordingDone({ ok: false, cached: false, error: msg });
      return { success: false, fiche_id, call_id, error: msg };
    } finally {
      if (lock.enabled) {
        await step.run(`release-recording-lock-${call_id}`, async () => {
          await releaseRedisLock({ key: lockKey, token: lock.token });
          return { released: true };
        });
      }
    }
  }
);

const TRANSCRIPTION_FINALIZER_CONCURRENCY = Math.max(
  1,
  Number(process.env.TRANSCRIPTION_FINALIZER_CONCURRENCY || getInngestGlobalConcurrency())
);

/**
 * Transcription Finalizer (Distributed)
 * ====================================
 * Aggregates per-recording results and emits:
 * - `transcription.progress` webhooks (throttled)
 * - `transcription.completed` webhook
 * - `fiche/transcribed` internal event
 *
 * IMPORTANT: Requires Redis (`REDIS_URL`) to coordinate state and release the per-fiche lock.
 */
export const finalizeFicheTranscriptionFunction = inngest.createFunction(
  {
    id: "finalize-fiche-transcription",
    name: "Finalize Fiche Transcription (Distributed)",
    retries: 3,
    timeouts: {
      finish: "30m",
    },
    concurrency: [
      {
        limit: TRANSCRIPTION_FINALIZER_CONCURRENCY,
      },
      {
        key: "event.data.run_id",
        limit: 1,
      },
    ],
  },
  { event: "transcription/recording.transcribed" },
  async ({ event, step, logger }) => {
    const { run_id, fiche_id, call_id, ok, cached, error } = event.data;

    const tracer = createWorkflowTracer({
      workflow: "transcription",
      entity: { type: "finalizer", id: `${fiche_id}/${call_id}` },
      traceId: run_id,
      inngestEventId: typeof event.id === "string" ? event.id : undefined,
    });
    const wlog = createWorkflowLogger("tx-finalizer", `${fiche_id}/${call_id}`, { tracer });
    wlog.start("finalize-recording", { run_id, ok, cached, error: error ?? undefined });

    const redis = await getRedisClient();
    if (!redis) {
      wlog.error("Redis NOT available! Finalizer SKIPPED. No completion/progress events will fire.");
      wlog.end("skipped", { reason: "redis_not_configured" });
      return { skipped: true, reason: "redis_not_configured" };
    }

    const ttlSeconds = Math.max(
      60,
      Number(process.env.TRANSCRIPTION_RUN_STATE_TTL_SECONDS || 2 * 60 * 60)
    );

    const baseKey = `transcription:fiche:${fiche_id}:run:${run_id}`;
    const metaKey = `${baseKey}:meta`;
    const pendingKey = `${baseKey}:pending`;
    const failedKey = `${baseKey}:failed`;
    const finalizedKey = `${baseKey}:finalized`;
    const activeKey = `transcription:fiche:${fiche_id}:activeRun`;

    const removed = await step.run(`pending-remove-${run_id}-${call_id}`, async () => {
      return await redis.sRem(pendingKey, call_id);
    });

    // Duplicate/late event (or state expired) — do not double-count.
    if (!removed) {
      return { duplicate: true, run_id, fiche_id, call_id };
    }

    const { remaining, meta } = await step.run(`update-meta-${run_id}-${call_id}`, async () => {
      const multi = redis.multi();
      multi.hIncrBy(metaKey, "processed", 1);
      if (cached) {multi.hIncrBy(metaKey, "cached", 1);}
      if (!ok) {
        multi.hIncrBy(metaKey, "failed", 1);
        multi.sAdd(failedKey, call_id);
      }
      // Keep state alive while work is still flowing
      multi.expire(metaKey, ttlSeconds);
      multi.expire(pendingKey, ttlSeconds);
      multi.expire(failedKey, ttlSeconds);
      multi.expire(activeKey, ttlSeconds);
      await multi.exec();

      const [pendingCount, metaNow] = await Promise.all([
        redis.sCard(pendingKey),
        redis.hGetAll(metaKey),
      ]);

      return {
        remaining: typeof pendingCount === "number" ? pendingCount : Number(pendingCount || 0),
        meta: metaNow as Record<string, string>,
      };
    });

    const remainingCount = Number((remaining as unknown as number | null) || 0);
    const processed = Number(meta.processed || 0);
    const cachedCount = Number(meta.cached || 0);
    const failedCount = Number(meta.failed || 0);
    const targetTotal = Number(meta.target_total || 0);
    const alreadyTranscribed = Number(meta.already_transcribed || 0);
    const totalRecordings = Number(meta.total_recordings || 0);

    const progressFrequency = Math.max(
      1,
      Number(process.env.TRANSCRIPTION_PROGRESS_WEBHOOK_FREQUENCY || 3)
    );

    // Progress webhook (best-effort; do not fail finalizer)
    const shouldSendProgress = processed % progressFrequency === 0 || remainingCount === 0;
    if (shouldSendProgress) {
      const successfulTargets = Math.max(0, processed - failedCount);
      const transcribedOverall = alreadyTranscribed + successfulTargets;
      const pendingOverall = Math.max(0, totalRecordings - transcribedOverall);

      await step.run(`send-progress-${run_id}-${processed}`, async () => {
        try {
          await transcriptionWebhooks.progress(
            fiche_id,
            totalRecordings,
            transcribedOverall,
            pendingOverall,
            failedCount
          );
        } catch {
          // ignore
        }
        logger.info("Transcription run progress", {
          run_id,
          fiche_id,
          processed,
          remaining: remainingCount,
          cached: cachedCount,
          failed: failedCount,
          target_total: targetTotal,
          total_recordings: totalRecordings,
          already_transcribed: alreadyTranscribed,
          transcribed_overall: transcribedOverall,
          pending_overall: pendingOverall,
        });
        return { notified: true };
      });
    }

    if (remainingCount > 0) {
      if (!ok) {
        wlog.warn("Recording marked FAILED", { call_id, error });
      }
      wlog.end("waiting", { remaining: remainingCount, processed, failed: failedCount, target: targetTotal });
      return { ok, run_id, fiche_id, call_id, remaining: remainingCount };
    }

    wlog.info("All recordings processed! Finalizing run...", { processed, failed: failedCount, cached: cachedCount });

    // Finalize once (idempotent)
    const finalized = await step.run(`mark-finalized-${run_id}`, async () => {
      const r = await redis.set(finalizedKey, "1", {
        NX: true,
        EX: ttlSeconds,
      });
      return r === "OK";
    });

    if (!finalized) {
      return { already_finalized: true, run_id, fiche_id };
    }

    const startedAtMs = Number(meta.started_at_ms || Date.now());
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const durationSeconds = Math.round(durationMs / 1000);

    const newTranscribed = Math.max(0, targetTotal - cachedCount - failedCount);
    const transcribedOverallAtEnd = Math.min(
      totalRecordings,
      alreadyTranscribed + Math.max(0, targetTotal - failedCount)
    );

    await step.run(`send-completed-${run_id}`, async () => {
      try {
        await transcriptionWebhooks.completed(
          fiche_id,
          totalRecordings,
          transcribedOverallAtEnd,
          failedCount,
          durationSeconds
        );
      } catch {
        // ignore
      }
      return { notified: true };
    });

    await step.sendEvent(`emit-fiche-transcribed-${run_id}`, {
      name: "fiche/transcribed",
      data: {
        fiche_id,
        transcribed_count: newTranscribed,
        cached_count: cachedCount,
        failed_count: failedCount,
        duration_ms: durationMs,
      },
      id: `fiche-transcribed-${run_id}`,
    });

    // Release the per-fiche lock (best-effort)
    await step.run(`release-fiche-lock-${run_id}`, async () => {
      const lockEnabled = meta.lock_enabled === "1";
      const lockKey = meta.lock_key || `lock:transcription:fiche:${fiche_id}`;
      const lockToken = meta.lock_token || "";
      if (lockEnabled && lockToken) {
        await releaseRedisLock({ key: lockKey, token: lockToken });
      }
      return { released: lockEnabled };
    });

    // Cleanup state (best-effort)
    await step.run(`cleanup-run-state-${run_id}`, async () => {
      // Only clear the activeRun pointer if it still points at this run.
      const currentActive = await redis.get(activeKey);
      await redis.del([metaKey, pendingKey, failedKey, finalizedKey]);
      if (currentActive === run_id) {
        await redis.del(activeKey);
      }
      return { cleaned: true };
    });

    logger.info("Fiche transcription finalized", {
      run_id,
      fiche_id,
      totalRecordings,
      targetTotal,
      newTranscribed,
      cachedCount,
      failedCount,
      durationMs,
    });

    return { finalized: true, run_id, fiche_id };
  }
);

export const functions = [
  transcribeFicheFunction,
  transcribeRecordingFunction,
  finalizeFicheTranscriptionFunction,
];
