/**
 * Chat Service
 * ============
 * AI chat logic with streaming and citations
 */

import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { prisma } from "../../shared/prisma.js";
import { getCachedFiche } from "../fiches/fiches.repository.js";
import { getAuditById } from "../audits/audits.repository.js";
import { getRecordingsByFiche } from "../recordings/recordings.repository.js";
import { readFileSync, existsSync } from "fs";
import { generateTimeline } from "../audits/audits.timeline.js";
import { buildTimelineText } from "../audits/audits.prompts.js";
import type { TimelineRecording, Transcription, ChatCitation } from "../../schemas.js";

const TRANSCRIPTION_CACHE_FILE = "./data/transcription_cache.json";

/**
 * Load transcription from file cache
 */
function loadTranscriptionCache(): Record<string, Transcription> {
  if (!existsSync(TRANSCRIPTION_CACHE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(TRANSCRIPTION_CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Parse recording metadata from filename
 */
function parseRecordingMetadata(filename: string): {
  date?: string;
  time?: string;
  from_number?: string;
  to_number?: string;
} | null {
  // Format: YYYYMMDD-HHMMSS-from-to.mp3
  const regex = /(\d{8})-(\d{6})-([^-]+)-([^.]+)\./;
  const match = filename.match(regex);
  
  if (match) {
    const [, dateStr, timeStr, from, to] = match;
    // Parse: YYYYMMDD -> DD/MM/YYYY
    const date = `${dateStr.slice(6, 8)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 4)}`;
    // Parse: HHMMSS -> HH:MM
    const time = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
    
    return {
      date,
      time,
      from_number: from,
      to_number: to,
    };
  }
  
  return null;
}

interface AuditContextResult {
  systemPrompt: string;
  timeline: TimelineRecording[];
}

interface FicheContextResult {
  systemPrompt: string;
  timeline: TimelineRecording[];
}

/**
 * Build context for audit-specific chat
 */
export async function buildAuditContext(auditId: bigint, ficheId: string): Promise<AuditContextResult> {
  const [audit, fiche, recordings] = await Promise.all([
    getAuditById(auditId),
    getCachedFiche(ficheId),
    getRecordingsByFiche(ficheId),
  ]);

  if (!audit) throw new Error("Audit not found");
  if (!fiche) throw new Error("Fiche not found");

  const ficheData = fiche.rawData as {
    prospect?: { prenom?: string; nom?: string };
    information?: { groupe?: string };
  };
  const auditData = audit.resultData as {
    audit?: {
      config?: { name?: string };
      results?: {
        steps?: Array<{
          step_metadata?: { name?: string; weight?: number };
          conforme?: string;
          score?: number;
        }>;
      };
    };
  };

  // Load transcriptions from file cache
  const transcriptionCache = loadTranscriptionCache();
  const transcriptions: Transcription[] = [];

  for (const rec of recordings) {
    if (rec.hasTranscription && rec.recordingUrl) {
      const cachedTranscription = transcriptionCache[rec.recordingUrl];
      if (cachedTranscription) {
        // Parse recording metadata from filename
        const urlParts = rec.recordingUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        const parsed = parseRecordingMetadata(filename);

        transcriptions.push({
          recording_url: rec.recordingUrl,
          transcription_id: rec.transcriptionId || undefined,
          call_id: rec.callId,
          recording: {
            ...rec,
            recording_url: rec.recordingUrl,
            call_id: rec.callId,
            parsed,
          },
          transcription: cachedTranscription.transcription,
        });
      }
    }
  }

  // Generate timeline
  const timeline = generateTimeline(transcriptions);
  const timelineText = buildTimelineText(timeline);

  return {
    systemPrompt: `You are an expert audit analyst helping review a specific audit.

**Fiche Information:**
- ID: ${ficheId}
- Prospect: ${ficheData.prospect?.prenom || ''} ${ficheData.prospect?.nom || ''}
- Groupe: ${ficheData.information?.groupe || 'N/A'}
- Recordings: ${recordings.length} total (${transcriptions.length} transcribed)

**Audit Results:**
- Config: ${auditData.audit?.config?.name || 'N/A'}
- Score: ${audit.scorePercentage}% - ${audit.niveau}
- Compliant: ${audit.isCompliant ? "YES" : "NO"}
- Critical Points: ${audit.criticalPassed}/${audit.criticalTotal}
- Steps: ${audit.successfulSteps || 0} successful, ${audit.failedSteps || 0} failed
- Tokens Used: ${audit.totalTokens?.toLocaleString() || 0}

**Step Results:**
${auditData.audit?.results?.steps?.map((s, i) => 
  `${i + 1}. ${s.step_metadata?.name || 'Unknown'}: ${s.conforme || 'N/A'} (${s.score || 0}/${s.step_metadata?.weight || 0})`
).join('\n') || 'No step results'}

${timelineText}

**IMPORTANT: When referencing specific moments in the recordings, you MUST include structured citations using this EXACT JSON format:**

[CITATION:{
  "texte": "exact quoted text from the conversation",
  "minutage": "MM:SS",
  "minutage_secondes": 123.45,
  "speaker": "speaker_0",
  "recording_index": 0,
  "chunk_index": 0,
  "recording_date": "DD/MM/YYYY",
  "recording_time": "HH:MM",
  "recording_url": "url"
}]

Extract all metadata EXACTLY from the timeline above:
- recording_index: from "Enregistrement #X" (index = X-1)
- chunk_index: from "Chunk Y" (index = Y-1)
- minutage_secondes: from "Temps: XX.XXs"
- speaker: from "speaker_X:"
- recording_date: from "Date:" header
- recording_time: from "Heure:" header
- recording_url: will be enriched automatically

Answer questions about this audit's findings, scores, compliance issues, and what was discussed in the calls.
Use the transcription text to provide specific details about conversations.
ALWAYS include citations when referencing specific moments.`,
    timeline,
  };
}

/**
 * Build context for fiche-level chat
 */
export async function buildFicheContext(ficheId: string): Promise<FicheContextResult> {
  const [fiche, recordings, audits] = await Promise.all([
    getCachedFiche(ficheId),
    getRecordingsByFiche(ficheId),
    prisma.audit.findMany({
      where: { ficheCache: { ficheId } },
      orderBy: { createdAt: "desc" },
      include: { stepResults: true },
    }),
  ]);

  if (!fiche) throw new Error("Fiche not found");

  const ficheData = fiche.rawData as {
    prospect?: { prenom?: string; nom?: string; mail?: string; telephone?: string };
    information?: { groupe?: string };
  };

  // Load transcriptions from file cache
  const transcriptionCache = loadTranscriptionCache();
  const transcriptions: Transcription[] = [];

  for (const rec of recordings) {
    if (rec.hasTranscription && rec.recordingUrl) {
      const cachedTranscription = transcriptionCache[rec.recordingUrl];
      if (cachedTranscription) {
        // Parse recording metadata from filename
        const urlParts = rec.recordingUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        const parsed = parseRecordingMetadata(filename);

        transcriptions.push({
          recording_url: rec.recordingUrl,
          transcription_id: rec.transcriptionId || undefined,
          call_id: rec.callId,
          recording: {
            ...rec,
            recording_url: rec.recordingUrl,
            call_id: rec.callId,
            parsed,
          },
          transcription: cachedTranscription.transcription,
        });
      }
    }
  }

  // Generate timeline
  const timeline = generateTimeline(transcriptions);
  const timelineText = buildTimelineText(timeline);

  const totalDuration = recordings.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
  
  return {
    systemPrompt: `You are an expert audit analyst helping review a client fiche and its audits.

**Fiche Information:**
- ID: ${ficheId}
- Prospect: ${ficheData.prospect?.prenom || ''} ${ficheData.prospect?.nom || ''}
- Email: ${ficheData.prospect?.mail || 'N/A'}
- Phone: ${ficheData.prospect?.telephone || 'N/A'}
- Groupe: ${ficheData.information?.groupe || 'N/A'}

**Recordings:**
- Total: ${recordings.length}
- Transcribed: ${transcriptions.length}
- Total Duration: ${Math.round(totalDuration / 60)} minutes

${timelineText}

**Audits History:**
${audits.length > 0 
  ? audits.map((a, i) => {
      const auditData = a.resultData as { audit?: { config?: { name?: string } } };
      return `${i + 1}. ${auditData.audit?.config?.name || 'Unknown'} - ${a.scorePercentage}% (${a.niveau})
   - Date: ${a.createdAt.toISOString().split('T')[0]}
   - Compliant: ${a.isCompliant ? "YES" : "NO"}
   - Critical: ${a.criticalPassed}/${a.criticalTotal}`;
    }).join('\n')
  : 'No audits performed yet'}

**IMPORTANT: When referencing specific moments in the recordings, you MUST include structured citations using this EXACT JSON format:**

[CITATION:{
  "texte": "exact quoted text from the conversation",
  "minutage": "MM:SS",
  "minutage_secondes": 123.45,
  "speaker": "speaker_0",
  "recording_index": 0,
  "chunk_index": 0,
  "recording_date": "DD/MM/YYYY",
  "recording_time": "HH:MM",
  "recording_url": "url"
}]

Extract all metadata EXACTLY from the timeline above:
- recording_index: from "Enregistrement #X" (index = X-1)
- chunk_index: from "Chunk Y" (index = Y-1)
- minutage_secondes: from "Temps: XX.XXs"
- speaker: from "speaker_X:"
- recording_date: from "Date:" header
- recording_time: from "Heure:" header
- recording_url: will be enriched automatically

Answer questions about this fiche, its audits, transcriptions, and what was discussed in the calls.
Compare audits if multiple exist. Use transcription text to provide specific details about conversations.
ALWAYS include citations when referencing specific moments.`,
    timeline,
  };
}

/**
 * Extract citations from AI response text
 */
export function extractCitations(text: string, timeline: TimelineRecording[]): ChatCitation[] {
  const citations: ChatCitation[] = [];
  const citationRegex = /\[CITATION:(\{[^}]+\})\]/g;
  let match;

  // Create lookup map for recordings
  const timelineMap = new Map(
    timeline.map((rec) => [rec.recording_index, rec])
  );

  while ((match = citationRegex.exec(text)) !== null) {
    try {
      const citationData = JSON.parse(match[1]);
      
      // Enrich with recording URL from timeline
      const recordingMeta = timelineMap.get(citationData.recording_index);
      if (recordingMeta) {
        citationData.recording_url = recordingMeta.recording_url || "N/A";
        citationData.recording_date = recordingMeta.recording_date || "N/A";
        citationData.recording_time = recordingMeta.recording_time || "N/A";
      } else {
        citationData.recording_url = "N/A";
        citationData.recording_date = "N/A";
        citationData.recording_time = "N/A";
      }

      citations.push(citationData as ChatCitation);
    } catch (error) {
      console.error("Failed to parse citation:", match[1], error);
    }
  }

  return citations;
}

/**
 * Remove citation markers from text
 */
export function removeCitationMarkers(text: string): string {
  return text.replace(/\[CITATION:\{[^}]+\}\]/g, '');
}

interface ChatStreamResult {
  textStream: AsyncIterable<string>;
  fullText: Promise<string>;
  citations: Promise<ChatCitation[]>;
}

/**
 * Create streaming chat response with citation extraction
 */
export async function createChatStream(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
  timeline: TimelineRecording[]
): Promise<ChatStreamResult> {
  const result = await streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages: [
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: userMessage },
    ],
    temperature: 0.7,
    maxTokens: 3000,
  });

  // Collect full response and extract citations
  let fullResponse = "";
  const fullTextPromise = (async () => {
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
    }
    return fullResponse;
  })();

  const citationsPromise = fullTextPromise.then((text) => extractCitations(text, timeline));

  return {
    textStream: result.textStream,
    fullText: fullTextPromise,
    citations: citationsPromise,
  };
}
