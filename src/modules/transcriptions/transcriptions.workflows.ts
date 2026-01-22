/**
 * Transcriptions Workflows
 * =========================
 * Inngest workflow functions for transcription operations
 */

import crypto from "crypto";
import { NonRetriableError } from "inngest";

import { inngest } from "../../inngest/client.js";
import {
  CONCURRENCY,
  RATE_LIMITS,
  TIMEOUTS,
} from "../../shared/constants.js";
import {
  getInngestGlobalConcurrency,
  getInngestParallelismPerServer,
} from "../../shared/inngest-concurrency.js";
import { prisma } from "../../shared/prisma.js";
import { getRedisClient } from "../../shared/redis.js";
import { releaseRedisLock,tryAcquireRedisLock } from "../../shared/redis-lock.js";
import { transcriptionWebhooks } from "../../shared/webhook.js";
import {
  normalizeElevenLabsApiKey,
  TranscriptionService,
} from "./transcriptions.elevenlabs.js";
import { updateRecordingTranscription } from "./transcriptions.repository.js";
import {
  getFicheTranscriptionStatus,
} from "./transcriptions.service.js";
import type {
  BatchTranscriptionResult,
  ExtendedTranscriptionResult,
  TranscriptionResult,
} from "./transcriptions.types.js";

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type TranscriptionPlan = {
  ficheCacheId: string; // BigInt -> string (JSON-safe)
  totalRecordings: number;
  alreadyTranscribed: number;
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
        throw new NonRetriableError(
          "ElevenLabs API key not configured (set ELEVENLABS_API_KEY)"
        );
      }

      logger.info("Starting transcription", { fiche_id, priority });

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
          toTranscribe,
        };
        }
      );

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
      let redis = null as Awaited<ReturnType<typeof getRedisClient>>;
      try {
        redis = await getRedisClient();
      } catch {
        redis = null;
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

      const runId = crypto.randomUUID();
      const toTranscribeCount = toTranscribe.length;
      const targetCallIds = toTranscribe.map((r) => r.callId);

      // Send workflow started webhook now that we own the lock
      await step.run(`send-transcription-started-${fiche_id}`, async () => {
        await transcriptionWebhooks.started(fiche_id, totalRecordings, priority);
        return { notified: true };
      });

      // If Redis is available, persist a run state so a finalizer can aggregate without polling.
      if (redis) {
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
      }

      // Fan-out: dispatch one event per recording so work is distributed across replicas.
      await step.sendEvent(
        `fan-out-recordings-${fiche_id}`,
        toTranscribe.map((rec, idx) => ({
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
        }))
      );

      // If we're in "enqueue" mode, return immediately; finalizer will emit progress/completion.
      if (!waitForCompletion) {
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
    retries: 0, // Avoid spamming provider + webhooks; re-run via a new transcription request if needed.
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
        fiche_id,
        call_id,
        lockKey,
      });
      await emitRecordingDone({ ok: true, cached: true });
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
          fiche_id,
          call_id,
        });
        await emitRecordingDone({
          ok: true,
          cached: true,
          transcription_id: rec.transcriptionId || undefined,
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

      const transcription = await step.run(`elevenlabs-transcribe-${call_id}`, async () => {
        const svc = new TranscriptionService(apiKey);
        return await svc.transcribe(url);
      });

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
        fiche_id,
        call_id,
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

    const redis = await getRedisClient();
    if (!redis) {
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
        return { notified: true };
      });
    }

    if (remainingCount > 0) {
      if (!ok) {
        logger.warn("Recording transcribed event marked failed", {
          run_id,
          fiche_id,
          call_id,
          error,
        });
      }
      return { ok, run_id, fiche_id, call_id, remaining: remainingCount };
    }

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
