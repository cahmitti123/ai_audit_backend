/**
 * Audits Workflows
 * ================
 * Inngest workflow functions for audit operations
 */

import { inngest } from "../../inngest/client.js";
import { NonRetriableError } from "inngest";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { getFicheTranscriptionStatus } from "../transcriptions/transcriptions.service.js";
import { isFullyTranscribed } from "../transcriptions/transcriptions.types.js";
import { runAudit } from "./audits.runner.js";
import { fetchFicheFunction } from "../fiches/fiches.workflows.js";
import { transcribeFicheFunction } from "../transcriptions/transcriptions.workflows.js";
import type { AuditFunctionResult, BatchAuditResult } from "./audits.types.js";
import {
  CONCURRENCY,
  TIMEOUTS,
  DEFAULT_AUDIT_CONFIG_ID,
} from "../../shared/constants.js";
import { auditWebhooks, batchWebhooks } from "../../shared/webhook.js";

/**
 * Run Audit Function
 * ==================
 * Orchestrates fiche fetch -> transcription -> audit execution
 * - Concurrency: max 3, keyed by audit_config_id
 * - Retries: 2 times (expensive operations)
 * - Timeout: 30 minutes
 * - Uses step.invoke() for proper function composition
 */
export const runAuditFunction = inngest.createFunction(
  {
    id: "run-audit",
    name: "Run AI Audit",
    concurrency: CONCURRENCY.AUDIT_RUN,
    retries: 2,
    timeouts: {
      finish: TIMEOUTS.AUDIT_RUN,
    },
    // Remove idempotency to allow same fiche+config to run multiple times
    // The event ID in the route already provides deduplication
    onFailure: async ({ error, step, event }) => {
      const fiche_id = (event as any)?.data?.fiche_id || "unknown";
      const audit_config_id = (event as any)?.data?.audit_config_id || 0;

      // Send webhook notification (don't use step.run in onFailure - causes serialization errors)
      try {
        await auditWebhooks.failed("audit-failed", fiche_id, error.message);
      } catch (webhookError) {
        console.error("Failed to send failure webhook:", webhookError);
      }

      // Send internal event
      await step.sendEvent("emit-failure", {
        name: "audit/failed",
        data: {
          fiche_id,
          audit_config_id,
          error: error.message,
          retry_count: 0,
        },
      });
    },
  },
  { event: "audit/run" },
  async ({ event, step, logger }): Promise<AuditFunctionResult> => {
    const { fiche_id, audit_config_id, user_id } = event.data;
    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime, auditId } = await step.run(
      "capture-start-time",
      async (): Promise<{ startTime: number; auditId: string }> => {
        const now = Date.now();
        return {
          startTime: now,
          auditId: `audit-${fiche_id}-${audit_config_id}-${now}`,
        };
      }
    );

    logger.info("Starting audit", {
      audit_id: auditId,
      fiche_id,
      audit_config_id,
      user_id,
    });

    // Step 1: Ensure fiche is fetched
    const ficheData = await step.run("ensure-fiche", async () => {
      const cached = await getCachedFiche(fiche_id);

      if (!cached || cached.expiresAt < new Date()) {
        logger.info("Fiche not cached, triggering fetch", { fiche_id });
        return null;
      }

      logger.info("Fiche already cached", { fiche_id });
      return cached;
    });

    // If not cached, invoke fetch function
    if (!ficheData) {
      logger.info("Invoking fiche fetch function", { fiche_id });

      await step.invoke("fetch-fiche", {
        function: fetchFicheFunction,
        data: {
          fiche_id,
        },
      });

      logger.info("Fiche fetch completed", { fiche_id });
    }

    // Step 2: Ensure transcriptions
    const transcriptionStatus = await step.run(
      "check-transcription-status",
      async () => {
        return await getFicheTranscriptionStatus(fiche_id);
      }
    );

    // Check if transcription is complete
    const isComplete =
      transcriptionStatus.total !== null &&
      transcriptionStatus.total > 0 &&
      transcriptionStatus.transcribed === transcriptionStatus.total;

    if (!isComplete) {
      logger.info("Transcriptions incomplete, triggering transcription", {
        fiche_id,
        total: transcriptionStatus.total,
        transcribed: transcriptionStatus.transcribed,
      });

      await step.invoke("transcribe-fiche", {
        function: transcribeFicheFunction,
        data: {
          fiche_id,
          priority: "high",
        },
      });

      logger.info("Transcription completed", { fiche_id });
    } else {
      logger.info("All recordings already transcribed", {
        fiche_id,
        count: transcriptionStatus.total,
      });
    }

    // Step 3: Load audit configuration
    const auditConfig = await step.run("load-audit-config", async () => {
      logger.info("Loading audit configuration", { audit_config_id });
      const { getAuditConfigById } = await import(
        "../audit-configs/audit-configs.repository.js"
      );
      const config = await getAuditConfigById(BigInt(audit_config_id));

      if (!config) {
        throw new NonRetriableError(
          `Audit config ${audit_config_id} not found`
        );
      }

      return {
        id: config.id.toString(),
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        auditSteps: config.steps,
      };
    });

    logger.info("Audit config loaded", {
      config_name: auditConfig.name,
      total_steps: auditConfig.auditSteps.length,
    });

    // Send audit started webhook
    await step.run("send-started-webhook", async () => {
      await auditWebhooks.started(
        auditId,
        fiche_id,
        String(audit_config_id),
        auditConfig.name,
        auditConfig.auditSteps.length
      );
      return { notified: true };
    });

    // Step 4: Generate timeline from database transcriptions
    const { timeline, timelineText } = await step.run(
      "generate-timeline",
      async () => {
        logger.info("Building timeline from database", { fiche_id });
        const { getCachedFiche } = await import(
          "../fiches/fiches.repository.js"
        );
        const { getRecordingsByFiche } = await import(
          "../recordings/recordings.repository.js"
        );
        const { generateTimeline } = await import("./audits.timeline.js");
        const { buildTimelineText } = await import("./audits.prompts.js");
        const { enrichRecording } = await import(
          "../../utils/recording-parser.js"
        );
        const { readFileSync, existsSync } = await import("fs");

        // Load fiche data
        const cached = await getCachedFiche(fiche_id);
        if (!cached) {
          throw new Error("Fiche not cached");
        }

        // Load recordings from database with transcription data
        const dbRecordings = await getRecordingsByFiche(fiche_id);
        logger.info("Loaded recordings from database", {
          count: dbRecordings.length,
          transcribed: dbRecordings.filter((r) => r.hasTranscription).length,
        });

        // Get fiche data for enrichment
        const ficheData = cached.rawData as any;
        const rawRecordings = ficheData.recordings || [];

        console.log(`\n📍 [Workflow] Raw fiche data:`, {
          fiche_id,
          total_raw_recordings: rawRecordings.length,
          sample_recording: rawRecordings[0]
            ? {
                call_id: rawRecordings[0].call_id || rawRecordings[0].callId,
                has_recording_url: Boolean(rawRecordings[0].recording_url),
                has_recordingUrl: Boolean(rawRecordings[0].recordingUrl),
                url_preview: (
                  rawRecordings[0].recording_url ||
                  rawRecordings[0].recordingUrl ||
                  ""
                ).substring(0, 50),
              }
            : "No recordings",
        });

        // Load transcription cache
        const CACHE_FILE = "./data/transcription_cache.json";
        let transcriptionCache: any = {};
        if (existsSync(CACHE_FILE)) {
          try {
            transcriptionCache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
          } catch (e) {
            logger.warn("Could not load transcription cache", { error: e });
          }
        }

        // Build transcriptions from database + cache
        const transcriptions = [];
        for (const dbRec of dbRecordings) {
          if (!dbRec.hasTranscription || !dbRec.transcriptionId) {
            logger.warn("Recording missing transcription", {
              call_id: dbRec.callId,
            });
            continue;
          }

          // Find matching raw recording for enrichment
          const rawRec = rawRecordings.find(
            (r: any) => (r.call_id || r.callId) === dbRec.callId
          );
          if (!rawRec) {
            logger.warn("Could not find raw recording", {
              call_id: dbRec.callId,
            });
            continue;
          }

          console.log(`📍 [Workflow] Processing recording for transcription:`, {
            call_id: dbRec.callId,
            raw_has_recording_url: Boolean(rawRec.recording_url),
            raw_has_recordingUrl: Boolean(rawRec.recordingUrl),
          });

          const enrichedRec = enrichRecording(rawRec);
          const url = enrichedRec.recording_url || enrichedRec.recordingUrl;

          console.log(`📍 [Workflow] After enrichment:`, {
            call_id: dbRec.callId,
            enriched_has_recording_url: Boolean(enrichedRec.recording_url),
            enriched_has_recordingUrl: Boolean(enrichedRec.recordingUrl),
            final_url: url ? `${url.substring(0, 50)}...` : "MISSING",
          });

          // Verify URL is present
          if (!url) {
            logger.error("Recording URL is missing!", {
              call_id: dbRec.callId,
              raw_recording: rawRec,
              enriched_recording: enrichedRec,
            });
            continue;
          }

          // Load from cache
          const cachedTranscription = transcriptionCache[url];
          if (!cachedTranscription) {
            logger.warn("Transcription not in cache", {
              call_id: dbRec.callId,
              url,
            });
            continue;
          }

          console.log(`✓ [Workflow] Adding to transcriptions array:`, {
            call_id: dbRec.callId,
            recording_url: url ? `${url.substring(0, 50)}...` : "MISSING",
            has_transcription: Boolean(cachedTranscription),
          });

          transcriptions.push({
            recording_url: url,
            transcription_id: dbRec.transcriptionId,
            call_id: dbRec.callId,
            recording: enrichedRec,
            transcription: cachedTranscription.transcription,
          });
        }

        logger.info("Timeline data prepared", {
          count: transcriptions.length,
        });

        console.log(
          `📍 [Workflow] Transcriptions array sample (first recording):`,
          {
            recording_url: transcriptions[0]?.recording_url
              ? `${transcriptions[0].recording_url.substring(0, 50)}...`
              : "MISSING",
            call_id: transcriptions[0]?.call_id,
            has_recording_object: Boolean(transcriptions[0]?.recording),
            recording_object_has_url: Boolean(
              transcriptions[0]?.recording?.recording_url
            ),
          }
        );

        const timeline = generateTimeline(transcriptions);

        console.log(
          `📍 [Workflow] Timeline generated, sample (first recording):`,
          {
            recording_index: timeline[0]?.recording_index,
            call_id: timeline[0]?.call_id,
            recording_url: timeline[0]?.recording_url
              ? `${timeline[0].recording_url.substring(0, 50)}...`
              : "MISSING",
            recording_date: timeline[0]?.recording_date,
            recording_time: timeline[0]?.recording_time,
          }
        );

        const timelineText = buildTimelineText(timeline);

        return { timeline, timelineText };
      }
    );

    logger.info("Timeline generated", {
      recordings: timeline.length,
      chunks: timeline.reduce((sum: number, r: any) => sum + r.total_chunks, 0),
    });

    // Send progress: Timeline ready
    await step.run("send-progress-timeline", async () => {
      await auditWebhooks.progress(
        auditId,
        fiche_id,
        0, // No steps completed yet
        auditConfig.auditSteps.length,
        0, // No failures yet
        "timeline"
      );
      return { notified: true };
    });

    // Step 5: Analyze ALL audit steps in parallel (each as a separate Inngest step)
    logger.info("Starting parallel audit step analysis", {
      total_steps: auditConfig.auditSteps.length,
    });

    const stepAnalysisPromises = auditConfig.auditSteps.map((auditStep: any) =>
      step.run(`analyze-step-${auditStep.position}`, async () => {
        logger.info(`Analyzing step ${auditStep.position}`, {
          step_name: auditStep.name,
          weight: auditStep.weight,
        });

        const { analyzeStep } = await import("./audits.analyzer.js");
        const result = await analyzeStep(
          auditStep,
          auditConfig,
          timelineText,
          auditId,
          fiche_id
        );

        logger.info(`Step ${auditStep.position} completed`, {
          step_name: auditStep.name,
          score: result.score,
          conforme: result.conforme,
          tokens: result.usage.total_tokens,
        });

        return result;
      })
    );

    // Execute all step analyses in parallel
    const stepResults = await Promise.all(stepAnalysisPromises);

    logger.info("All audit steps completed", {
      successful: stepResults.length,
      total_tokens: stepResults.reduce(
        (sum, r) => sum + (r.usage?.total_tokens || 0),
        0
      ),
    });

    // Send progress: Analysis complete
    await step.run("send-progress-analysis", async () => {
      await auditWebhooks.progress(
        auditId,
        fiche_id,
        auditConfig.auditSteps.length,
        auditConfig.auditSteps.length,
        0, // Failed steps count (will be calculated if any)
        "analysis"
      );
      return { notified: true };
    });

    // Enrich citations with recording metadata (date/time/url)
    // IMPORTANT: Must RETURN enriched stepResults because Inngest serializes between steps
    const enrichedStepResults = await step.run("enrich-citations", async () => {
      logger.info("Enriching citations with recording metadata");

      // Create a lookup map for quick access
      const timelineMap = new Map(
        timeline.map((rec: any) => {
          const metadata = {
            recording_date: rec.recording_date || "N/A",
            recording_time: rec.recording_time || "N/A",
            recording_url: rec.recording_url || "N/A",
          };

          console.log(
            `📍 [Citation Enrichment] Timeline Map Entry ${rec.recording_index}:`,
            {
              recording_index: rec.recording_index,
              call_id: rec.call_id,
              url:
                metadata.recording_url !== "N/A"
                  ? `${metadata.recording_url.substring(0, 50)}...`
                  : "N/A",
              date: metadata.recording_date,
              time: metadata.recording_time,
            }
          );

          return [rec.recording_index, metadata];
        })
      );

      console.log(
        `📍 [Citation Enrichment] Timeline map created with ${timelineMap.size} entries`
      );

      let enrichedCount = 0;
      let missingUrlCount = 0;

      // Iterate through all steps and their control points
      for (const stepResult of stepResults) {
        if (!stepResult.points_controle) continue;

        for (const controlPoint of stepResult.points_controle) {
          if (!controlPoint.citations) continue;

          for (const citation of controlPoint.citations) {
            // Look up recording metadata using recording_index
            const metadata = timelineMap.get(citation.recording_index);

            if (enrichedCount < 3) {
              // Log first 3 citations for debugging
              console.log(
                `📍 [Citation Enrichment] Citation ${enrichedCount}:`,
                {
                  recording_index: citation.recording_index,
                  found_in_map: Boolean(metadata),
                  url_from_map: metadata?.recording_url
                    ? `${metadata.recording_url.substring(0, 50)}...`
                    : "N/A",
                }
              );
            }

            if (metadata) {
              citation.recording_date = metadata.recording_date;
              citation.recording_time = metadata.recording_time;
              citation.recording_url = metadata.recording_url;
              enrichedCount++;

              if (!metadata.recording_url || metadata.recording_url === "N/A") {
                console.warn(
                  `⚠️  [Citation Enrichment] Citation ${enrichedCount} has N/A URL:`,
                  {
                    recording_index: citation.recording_index,
                    citation_text: citation.texte?.substring(0, 50),
                  }
                );
                missingUrlCount++;
              }
            } else {
              console.warn(
                `⚠️  [Citation Enrichment] No timeline metadata for recording_index: ${citation.recording_index}`
              );
              // If no metadata found, set to N/A to make it explicit
              citation.recording_date = "N/A";
              citation.recording_time = "N/A";
              citation.recording_url = "N/A";
            }
          }
        }
      }

      console.log(`\n📊 [Citation Enrichment] Summary:`, {
        total_citations: enrichedCount,
        missing_urls: missingUrlCount,
        success_rate:
          enrichedCount > 0
            ? `${(
                ((enrichedCount - missingUrlCount) / enrichedCount) *
                100
              ).toFixed(1)}%`
            : "N/A",
      });

      // Verify mutation persisted - check first citation after enrichment
      const firstCitation =
        stepResults[0]?.points_controle?.[0]?.citations?.[0];
      console.log(
        `\n📍 [Citation Enrichment] Mutation check (first citation after enrichment):`,
        {
          has_citation: Boolean(firstCitation),
          recording_url:
            firstCitation?.recording_url?.substring(0, 50) || "MISSING",
          recording_date: firstCitation?.recording_date,
          recording_time: firstCitation?.recording_time,
          is_NA: firstCitation?.recording_url === "N/A",
        }
      );

      logger.info("Citations enriched", {
        total_steps: stepResults.length,
        total_citations: enrichedCount,
        missing_urls: missingUrlCount,
      });

      // CRITICAL: Return the enriched stepResults so mutations persist across Inngest steps
      return stepResults;
    });

    // Step 6: Calculate compliance (use enrichedStepResults with recording URLs)
    const compliance = await step.run("calculate-compliance", async () => {
      const { COMPLIANCE_THRESHOLDS } = await import(
        "../../shared/constants.js"
      );

      const totalWeight = auditConfig.auditSteps.reduce(
        (sum: number, s: any) => sum + s.weight,
        0
      );

      const earnedWeight = enrichedStepResults
        .filter((s: any) => s.score !== undefined)
        .reduce((sum: number, s: any) => {
          const maxWeight = s.step_metadata?.weight || s.score;
          const cappedScore = Math.min(s.score, maxWeight);
          return sum + cappedScore;
        }, 0);

      const score = (earnedWeight / totalWeight) * 100;

      const criticalTotal = auditConfig.auditSteps.filter(
        (s: any) => s.isCritical
      ).length;
      const criticalPassed = enrichedStepResults.filter(
        (s: any) => s.step_metadata?.is_critical && s.conforme === "CONFORME"
      ).length;

      let niveau = "INSUFFISANT";
      if (criticalPassed < criticalTotal) {
        niveau = "REJET";
      } else if (score >= COMPLIANCE_THRESHOLDS.EXCELLENT) {
        niveau = "EXCELLENT";
      } else if (score >= COMPLIANCE_THRESHOLDS.BON) {
        niveau = "BON";
      } else if (score >= COMPLIANCE_THRESHOLDS.ACCEPTABLE) {
        niveau = "ACCEPTABLE";
      }

      return {
        score: Number(score.toFixed(2)),
        niveau,
        points_critiques: `${criticalPassed}/${criticalTotal}`,
        poids_obtenu: earnedWeight,
        poids_total: totalWeight,
      };
    });

    logger.info("Compliance calculated", compliance);

    // Send compliance calculated webhook
    await step.run("send-compliance-calculated", async () => {
      const score = compliance.score ?? 0;
      await auditWebhooks.complianceCalculated(
        auditId,
        fiche_id,
        `${compliance.poids_obtenu}/${compliance.poids_total}`,
        `${score.toFixed(2)}%`,
        compliance.niveau,
        compliance.niveau !== "REJET",
        compliance.points_critiques
      );
      return { notified: true };
    });

    // Step 7: Save audit results
    const savedAudit = await step.run("save-audit-results", async () => {
      logger.info("Saving audit results to database", { fiche_id });

      // Verify citations are enriched before saving
      console.log(`\n📍 [Save] Checking enrichedStepResults before save:`, {
        total_steps: enrichedStepResults.length,
        sample_citation: enrichedStepResults[0]?.points_controle?.[0]
          ?.citations?.[0]
          ? {
              recording_index:
                enrichedStepResults[0].points_controle[0].citations[0]
                  .recording_index,
              recording_url:
                enrichedStepResults[0].points_controle[0].citations[0].recording_url?.substring(
                  0,
                  50
                ) || "MISSING",
              recording_date:
                enrichedStepResults[0].points_controle[0].citations[0]
                  .recording_date,
              recording_time:
                enrichedStepResults[0].points_controle[0].citations[0]
                  .recording_time,
            }
          : "No citations",
      });

      const { saveAuditResult } = await import("./audits.repository.js");
      const { getCachedFiche } = await import("../fiches/fiches.repository.js");

      const cached = await getCachedFiche(fiche_id);
      if (!cached) {
        throw new Error("Fiche not cached - cannot save audit");
      }

      const auditData = {
        audit: {
          config: {
            id: auditConfig.id,
            name: auditConfig.name,
            description: auditConfig.description,
          },
          fiche: {
            fiche_id,
            prospect_name: (() => {
              const data = cached.rawData as {
                prospect?: { prenom?: string; nom?: string };
              };
              return `${data.prospect?.prenom || ""} ${
                data.prospect?.nom || ""
              }`.trim();
            })(),
            groupe: (() => {
              const data = cached.rawData as {
                information?: { groupe?: string };
              };
              return data.information?.groupe || "";
            })(),
          },
          results: {
            steps: enrichedStepResults, // ✅ Use enriched version
            compliance,
          },
          compliance,
        },
        statistics: {
          recordings_count: timeline.length,
          transcriptions_count: timeline.length,
          timeline_chunks: timeline.reduce(
            (sum: number, r: any) => sum + r.total_chunks,
            0
          ),
          successful_steps: enrichedStepResults.length, // ✅ Use enriched version
          failed_steps: 0,
          total_time_seconds: 0,
          total_tokens: enrichedStepResults.reduce(
            // ✅ Use enriched version
            (sum, r) => sum + (r.usage?.total_tokens || 0),
            0
          ),
        },
        metadata: {
          started_at: new Date(startTime!).toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime!,
        },
      };

      const saved = await saveAuditResult(auditData, cached.id);

      logger.info("Audit saved to database", {
        audit_id: String(saved.id),
        fiche_id,
      });

      return saved;
    });

    const duration = Date.now() - startTime!;
    const durationSeconds = Math.round(duration / 1000);
    const savedAuditId = savedAudit?.id ? String(savedAudit.id) : "unknown";

    // Step 8: Send completion webhook and event
    await step.run("send-completion-webhook", async () => {
      const score = compliance.score ?? 0;
      const totalTokens = enrichedStepResults.reduce(
        (sum, r) => sum + (r.usage?.total_tokens || 0),
        0
      );

      await auditWebhooks.completed(
        auditId, // Use tracking audit ID, not database ID
        fiche_id,
        `${compliance.poids_obtenu}/${compliance.poids_total}`,
        `${score.toFixed(2)}%`,
        compliance.niveau,
        compliance.niveau !== "REJET",
        enrichedStepResults.length, // Successful steps
        0, // Failed steps
        totalTokens,
        durationSeconds
      );
      return { notified: true };
    });

    await step.sendEvent("emit-completion", {
      name: "audit/completed",
      data: {
        fiche_id,
        audit_id: savedAuditId, // Use database ID for events
        audit_config_id,
        score: compliance.score || 0,
        niveau: compliance.niveau,
        duration_ms: duration,
      },
    });

    logger.info("Audit completed successfully", {
      fiche_id,
      audit_id: savedAuditId, // Database ID
      tracking_id: auditId, // Tracking ID for webhooks
      audit_config_id,
      score: compliance.score,
      niveau: compliance.niveau,
      duration_ms: duration,
      total_steps: enrichedStepResults.length,
    });

    return {
      success: true,
      fiche_id,
      audit_id: savedAuditId, // Return database ID
      audit_config_id,
      score: compliance.score ?? 0,
      niveau: compliance.niveau,
      duration_ms: duration,
    };
  }
);

/**
 * Batch Audit Function
 * ====================
 * Fan-out pattern: dispatches individual audits and waits for completion
 */
export const batchAuditFunction = inngest.createFunction(
  {
    id: "batch-audit",
    name: "Batch Process Audits",
    retries: 1,
    timeouts: {
      finish: TIMEOUTS.BATCH_AUDIT,
    },
  },
  { event: "audit/batch" },
  async ({ event, step, logger }): Promise<BatchAuditResult> => {
    const { fiche_ids, audit_config_id, user_id } = event.data;
    const defaultAuditConfigId = audit_config_id || DEFAULT_AUDIT_CONFIG_ID;

    // Capture start time in a step to persist it across Inngest checkpoints
    const { startTime, batchId } = await step.run(
      "capture-batch-start-time",
      async (): Promise<{ startTime: number; batchId: string }> => {
        const now = Date.now();
        return {
          startTime: now,
          batchId: `batch-${now}`,
        };
      }
    );

    logger.info("Starting batch audit", {
      total: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      user_id,
    });

    // Send batch started webhook
    await step.run("send-batch-started", async () => {
      await batchWebhooks.progress(batchId, "audit", fiche_ids.length, 0, 0);
      return { notified: true };
    });

    // Fan-out: Send events in parallel
    await step.sendEvent(
      "fan-out-audits",
      fiche_ids.map((fiche_id) => ({
        name: "audit/run",
        data: {
          fiche_id,
          audit_config_id: defaultAuditConfigId,
          user_id,
        },
        id: `audit-${fiche_id}-${defaultAuditConfigId}-${Date.now()}`,
      }))
    );

    logger.info("Dispatched all audit events", {
      count: fiche_ids.length,
    });

    // Wait for all audits to complete
    const completionEvents = await step.waitForEvent("wait-for-completions", {
      event: "audit/completed",
      timeout: "45m",
      match: "data.audit_config_id",
    });

    // Calculate batch duration
    const batchDuration = Date.now() - startTime!;

    // Count results
    const results = (await step.run("count-results", async () => {
      return {
        total: fiche_ids.length,
        succeeded: completionEvents ? 1 : 0,
        failed: 0,
      };
    })) as unknown as { total: number; succeeded: number; failed: number };

    const duration = batchDuration; // Use pre-calculated duration

    // Send batch completion webhook
    await step.run("send-batch-completion-webhook", async () => {
      await batchWebhooks.completed(
        batchId,
        "audit",
        results.total,
        results.succeeded,
        results.failed,
        duration
      );
      return { notified: true };
    });

    // Send batch completion event
    await step.sendEvent("emit-batch-completion", {
      name: "audit/batch.completed",
      data: {
        total: fiche_ids.length,
        succeeded: results.succeeded,
        failed: results.failed,
        audit_config_id: defaultAuditConfigId,
      },
    });

    logger.info("Batch audit completed", results);

    return {
      success: true,
      total_fiches: fiche_ids.length,
      audit_config_id: defaultAuditConfigId,
      ...results,
    };
  }
);

/**
 * Cleanup Cron Job
 * =================
 * Scheduled daily cache cleanup
 */
export const cleanupOldCachesFunction = inngest.createFunction(
  {
    id: "cleanup-old-caches",
    name: "Cleanup Expired Cache Entries",
    retries: 1,
  },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    logger.info("Starting cache cleanup");

    const deleted = await step.run("delete-expired-caches", async () => {
      const { deleteExpiredCaches } = await import(
        "../fiches/fiches.repository.js"
      );
      return await deleteExpiredCaches();
    });

    logger.info("Cache cleanup completed", { deleted });

    return {
      success: true,
      deleted,
    };
  }
);

export const functions = [
  runAuditFunction,
  batchAuditFunction,
  cleanupOldCachesFunction,
];
