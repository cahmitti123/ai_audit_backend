/**
 * Test Transcription Webhooks
 * ============================
 * Test script to verify transcription webhook events
 */

import type {
  WebhookPayload,
  WebhookEventType,
} from "../src/shared/webhook.js";

// Mock webhook receiver
const receivedWebhooks: WebhookPayload[] = [];

function logWebhook(webhook: WebhookPayload) {
  receivedWebhooks.push(webhook);
  console.log(`\n[${webhook.timestamp}] ${webhook.event}`);
  console.log("Data:", JSON.stringify(webhook.data, null, 2));
}

// Simulate transcription flow
async function simulateTranscriptionFlow() {
  console.log("=".repeat(80));
  console.log("TRANSCRIPTION WEBHOOK EVENT FLOW SIMULATION");
  console.log("=".repeat(80));

  const ficheId = "1758466";
  const startTime = new Date();

  // 1. Started
  logWebhook({
    event: "transcription.started",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      total_recordings: 5,
      priority: "normal",
      started_at: startTime.toISOString(),
      status: "started",
    },
  });

  await sleep(100);

  // 2. Status Check
  logWebhook({
    event: "transcription.status_check",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      total_recordings: 5,
      already_transcribed: 2,
      needs_transcription: 3,
      is_complete: false,
      status: "checked",
    },
  });

  await sleep(100);

  // 3. Process each recording
  const recordings = [
    { callId: "call_001", shouldFail: false },
    { callId: "call_002", shouldFail: false },
    { callId: "call_003", shouldFail: true },
  ];

  let transcribed = 2; // Already had 2
  let failed = 0;

  for (let i = 0; i < recordings.length; i++) {
    const rec = recordings[i];
    const recordingIndex = i + 1;

    // Recording Started
    logWebhook({
      event: "transcription.recording_started",
      timestamp: new Date().toISOString(),
      source: "transcription-service",
      data: {
        fiche_id: ficheId,
        call_id: rec.callId,
        recording_index: recordingIndex,
        total_to_transcribe: recordings.length,
        recording_url: `https://example.com/${rec.callId}.mp3`,
        status: "processing",
      },
    });

    await sleep(200);

    if (rec.shouldFail) {
      // Recording Failed
      failed++;
      logWebhook({
        event: "transcription.recording_failed",
        timestamp: new Date().toISOString(),
        source: "transcription-service",
        data: {
          fiche_id: ficheId,
          call_id: rec.callId,
          error: "ElevenLabs API error: Rate limit exceeded",
          recording_index: recordingIndex,
          total_to_transcribe: recordings.length,
          status: "failed",
        },
      });
    } else {
      // Recording Completed
      transcribed++;
      logWebhook({
        event: "transcription.recording_completed",
        timestamp: new Date().toISOString(),
        source: "transcription-service",
        data: {
          fiche_id: ficheId,
          call_id: rec.callId,
          transcription_id: `trans_${rec.callId}_${Date.now()}`,
          recording_index: recordingIndex,
          total_to_transcribe: recordings.length,
          status: "completed",
        },
      });
    }

    await sleep(100);

    // Progress Update
    const pending = 5 - transcribed - failed;
    logWebhook({
      event: "transcription.progress",
      timestamp: new Date().toISOString(),
      source: "transcription-service",
      data: {
        fiche_id: ficheId,
        total_recordings: 5,
        transcribed,
        pending,
        failed,
        progress_percentage: Math.round((transcribed / 5) * 100),
        status: "in_progress",
      },
    });

    await sleep(100);
  }

  // 4. Completed
  const endTime = new Date();
  const durationSeconds = Math.round(
    (endTime.getTime() - startTime.getTime()) / 1000
  );

  logWebhook({
    event: "transcription.completed",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      total_recordings: 5,
      transcribed: 4,
      failed: 1,
      duration_seconds: durationSeconds,
      completed_at: endTime.toISOString(),
      status: "completed",
    },
  });

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total webhooks sent: ${receivedWebhooks.length}`);
  console.log("\nEvent breakdown:");

  const eventCounts = receivedWebhooks.reduce((acc, webhook) => {
    acc[webhook.event] = (acc[webhook.event] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(eventCounts).forEach(([event, count]) => {
    console.log(`  ${event}: ${count}`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("EXPECTED FRONTEND UPDATES");
  console.log("=".repeat(80));
  console.log('1. Initial: "Transcription started (5 recordings)"');
  console.log('2. Status: "3 recordings need transcription"');
  console.log('3. Progress: "Processing recording 1/3..."');
  console.log('4. Progress: "Processing recording 2/3..."');
  console.log('5. Progress: "Processing recording 3/3..."');
  console.log('6. Final: "Transcription complete: 4 successful, 1 failed"');
  console.log("=".repeat(80));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulate failure scenario
async function simulateFailureScenario() {
  console.log("\n\n");
  console.log("=".repeat(80));
  console.log("FAILURE SCENARIO");
  console.log("=".repeat(80));

  const ficheId = "1762209";

  // Started
  logWebhook({
    event: "transcription.started",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      total_recordings: 10,
      priority: "high",
      started_at: new Date().toISOString(),
      status: "started",
    },
  });

  await sleep(100);

  // Status Check
  logWebhook({
    event: "transcription.status_check",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      total_recordings: 10,
      already_transcribed: 3,
      needs_transcription: 7,
      is_complete: false,
      status: "checked",
    },
  });

  await sleep(100);

  // Process 2 recordings successfully
  for (let i = 0; i < 2; i++) {
    logWebhook({
      event: "transcription.recording_started",
      timestamp: new Date().toISOString(),
      source: "transcription-service",
      data: {
        fiche_id: ficheId,
        call_id: `call_00${i}`,
        recording_index: i + 1,
        total_to_transcribe: 7,
        status: "processing",
      },
    });

    await sleep(100);

    logWebhook({
      event: "transcription.recording_completed",
      timestamp: new Date().toISOString(),
      source: "transcription-service",
      data: {
        fiche_id: ficheId,
        call_id: `call_00${i}`,
        transcription_id: `trans_00${i}`,
        recording_index: i + 1,
        total_to_transcribe: 7,
        status: "completed",
      },
    });

    await sleep(50);
  }

  await sleep(100);

  // Catastrophic failure
  logWebhook({
    event: "transcription.failed",
    timestamp: new Date().toISOString(),
    source: "transcription-service",
    data: {
      fiche_id: ficheId,
      error: "ElevenLabs API quota exceeded",
      failed_at: new Date().toISOString(),
      status: "failed",
      partial_results: {
        total: 10,
        transcribed: 5, // 3 already + 2 new
        failed: 5,
      },
    },
  });

  console.log("\n" + "=".repeat(80));
  console.log(
    "Failure scenario complete - workflow stopped after API quota exceeded"
  );
  console.log("Partial results preserved: 5/10 transcribed");
  console.log("=".repeat(80));
}

// Run both scenarios
async function runAllTests() {
  await simulateTranscriptionFlow();
  await simulateFailureScenario();

  console.log("\n\n✅ All webhook event simulations completed");
  console.log("See TRANSCRIPTION_WEBHOOKS.md for detailed documentation");
}

runAllTests().catch(console.error);
