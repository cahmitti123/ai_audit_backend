/**
 * Service de Transcription
 * =========================
 * Transcrit les audios avec ElevenLabs et cache les résultats
 */

import axios from "axios";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { RecordingInfo, Transcription } from "../types.js";

const CACHE_FILE = "./data/transcription_cache.json";

export class TranscriptionService {
  private elevenLabsApiKey: string;
  private cache: Map<string, Transcription>;

  constructor(apiKey: string) {
    this.elevenLabsApiKey = apiKey;
    this.cache = this.loadCache();
  }

  private loadCache(): Map<string, Transcription> {
    if (existsSync(CACHE_FILE)) {
      try {
        const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
        console.log(
          `✓ Cache transcriptions: ${Object.keys(data).length} entrées`
        );
        return new Map(Object.entries(data));
      } catch (e) {
        console.warn("⚠️  Erreur chargement cache:", e);
      }
    }
    return new Map();
  }

  private saveCache() {
    const obj = Object.fromEntries(this.cache);
    writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
    console.log(`✓ Cache sauvegardé: ${this.cache.size} entrées`);
  }

  async transcribe(url: string): Promise<Transcription> {
    // Vérifier cache
    if (this.cache.has(url)) {
      console.log(
        `  ✓ Depuis cache (ID: ${this.cache.get(url)?.transcription_id})`
      );
      return this.cache.get(url)!;
    }

    console.log(`  📥 Téléchargement audio...`);
    const audioResponse = await axios.get(url, { responseType: "arraybuffer" });

    console.log(`  🎤 Transcription ElevenLabs...`);

    const formData = new FormData();
    const blob = new Blob([audioResponse.data], { type: "audio/mpeg" });
    formData.append("file", blob, "audio.mp3");
    formData.append("model_id", "scribe_v1");
    formData.append("language_code", "fra");
    formData.append("timestamps_granularity", "word");
    formData.append("diarize", "true");

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/speech-to-text",
      formData,
      {
        headers: {
          "xi-api-key": this.elevenLabsApiKey,
        },
      }
    );

    const transcription: Transcription = {
      recording_url: url,
      transcription_id: response.data.transcription_id,
      transcription: {
        text: response.data.text,
        language_code: response.data.language_code,
        language_probability: response.data.language_probability,
        words: response.data.words || [],
      },
    };

    // Cache
    this.cache.set(url, transcription);
    this.saveCache();

    console.log(`  ✓ ${response.data.words?.length || 0} mots transcrits`);

    return transcription;
  }

  async transcribeAll(recordings: RecordingInfo[]): Promise<Transcription[]> {
    console.log(
      `\n🎤 Transcription de ${recordings.length} enregistrements...\n`
    );

    const transcriptions: Transcription[] = [];

    for (let i = 0; i < recordings.length; i++) {
      console.log(
        `[${i + 1}/${recordings.length}] ${recordings[i].recording_url
          .split("/")
          .pop()}`
      );

      try {
        const transcription = await this.transcribe(
          recordings[i].recording_url
        );
        // Attach full recording object for metadata
        transcription.recording = recordings[i];
        transcription.call_id = recordings[i].call_id;
        transcriptions.push(transcription);
      } catch (error) {
        console.error(`  ❌ Erreur:`, error);
      }
    }

    return transcriptions;
  }
}
