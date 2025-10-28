/**
 * Get Audit with Complete Recording Information
 * ==============================================
 * Demonstrates how to get full recording metadata from citations
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3002/api";

interface Citation {
  recording_index: number;
  recording_date: string;
  recording_time: string;
  minutage: string;
  speaker: string;
  texte: string;
}

async function getAuditWithRecordings(auditId: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`GETTING AUDIT ${auditId} WITH RECORDING DETAILS`);
  console.log("=".repeat(80));

  // 1. Get audit details
  console.log("\n📊 Step 1: Fetching audit details...");
  const auditResponse = await fetch(`${API_BASE_URL}/audits/${auditId}`);
  const auditData = await auditResponse.json();

  if (!auditData.success) {
    console.error("❌ Failed to fetch audit:", auditData.error);
    return;
  }

  const audit = auditData.data;
  const ficheId = audit.ficheCache.ficheId;

  console.log(`✓ Audit ID: ${audit.id}`);
  console.log(`✓ Fiche ID: ${ficheId}`);
  console.log(`✓ Score: ${audit.scorePercentage}%`);
  console.log(`✓ Status: ${audit.niveau}`);

  // 2. Get fiche with recordings
  console.log("\n📁 Step 2: Fetching fiche with recordings...");
  const ficheResponse = await fetch(`${API_BASE_URL}/fiches/${ficheId}`);
  const ficheData = await ficheResponse.json();

  if (!ficheData.success) {
    console.error("❌ Failed to fetch fiche:", ficheData.error);
    return;
  }

  const recordings = ficheData.data.recordings || [];
  console.log(`✓ Total recordings: ${recordings.length}`);

  // Create recording lookup map
  const recordingsMap = new Map(
    recordings.map((rec: any, index: number) => [index, rec])
  );

  // 3. Process citations with full recording data
  console.log("\n📝 Step 3: Processing citations with recording metadata...");

  let totalCitations = 0;
  const citationsWithRecordings: any[] = [];

  for (const stepResult of audit.stepResults || []) {
    for (const controlPoint of stepResult.controlPoints || []) {
      for (const citation of controlPoint.citations || []) {
        totalCitations++;

        // Get full recording data
        const recording = recordingsMap.get(citation.recordingIndex);

        if (recording) {
          citationsWithRecordings.push({
            // Citation data
            citation_text: citation.texte,
            speaker: citation.speaker,
            timestamp_in_recording: citation.minutage,
            timestamp_seconds: citation.minutageSecondes,

            // Recording metadata from citation
            citation_recording_date: citation.recordingDate,
            citation_recording_time: citation.recordingTime,
            recording_index: citation.recordingIndex,

            // Full recording data from API
            recording: {
              id: recording.id,
              call_id: recording.callId || recording.call_id,
              recording_url: recording.recordingUrl || recording.recording_url,
              recording_date:
                recording.recordingDate || recording.recording_date,
              recording_time:
                recording.recordingTime || recording.recording_time,
              from_number: recording.fromNumber || recording.from_number,
              to_number: recording.toNumber || recording.to_number,
              duration_seconds:
                recording.durationSeconds || recording.duration_seconds,
              has_transcription:
                recording.hasTranscription || recording.has_transcription,
            },

            // Control point context
            control_point: controlPoint.point,
            step_name: stepResult.stepName,
          });
        }
      }
    }
  }

  console.log(`✓ Total citations processed: ${totalCitations}`);
  console.log(
    `✓ Citations with full recording data: ${citationsWithRecordings.length}`
  );

  // 4. Display sample citations with full data
  console.log("\n" + "─".repeat(80));
  console.log("SAMPLE CITATIONS WITH COMPLETE RECORDING DATA");
  console.log("─".repeat(80));

  citationsWithRecordings.slice(0, 3).forEach((item, index) => {
    console.log(
      `\n[Citation ${index + 1}/${Math.min(3, citationsWithRecordings.length)}]`
    );
    console.log(`  Step: ${item.step_name}`);
    console.log(`  Control Point: ${item.control_point}`);
    console.log(`\n  📝 Citation:`);
    console.log(`     Text: "${item.citation_text.substring(0, 80)}..."`);
    console.log(`     Speaker: ${item.speaker}`);
    console.log(`     Timestamp: ${item.timestamp_in_recording}`);
    console.log(`\n  📞 Recording (Index ${item.recording_index}):`);
    console.log(`     Call ID: ${item.recording.call_id}`);
    console.log(`     Date: ${item.recording.recording_date}`);
    console.log(`     Time: ${item.recording.recording_time}`);
    console.log(`     From: ${item.recording.from_number}`);
    console.log(`     To: ${item.recording.to_number}`);
    console.log(`     Duration: ${item.recording.duration_seconds}s`);
    console.log(
      `     URL: ${item.recording.recording_url?.substring(0, 60)}...`
    );
  });

  // 5. Export to JSON
  const outputFile = `audit_${auditId}_with_recordings.json`;
  const fs = await import("fs");
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        audit_summary: {
          audit_id: audit.id,
          fiche_id: ficheId,
          score: audit.scorePercentage,
          niveau: audit.niveau,
          total_citations: totalCitations,
        },
        recordings: recordings.map((rec: any, index: number) => ({
          index,
          call_id: rec.callId || rec.call_id,
          recording_date: rec.recordingDate || rec.recording_date,
          recording_time: rec.recordingTime || rec.recording_time,
          duration_seconds: rec.durationSeconds || rec.duration_seconds,
        })),
        citations_with_recordings: citationsWithRecordings,
      },
      null,
      2
    )
  );

  console.log(`\n✅ Complete data exported to: ${outputFile}`);
  console.log("\n" + "=".repeat(80) + "\n");
}

// Get audit ID from command line or use default
const auditId = process.argv[2];

if (!auditId) {
  console.error("\n❌ Error: Audit ID required");
  console.log("\nUsage: npm run get-audit-recordings <audit_id>");
  console.log("Example: npm run get-audit-recordings 5\n");
  process.exit(1);
}

getAuditWithRecordings(auditId).catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});


