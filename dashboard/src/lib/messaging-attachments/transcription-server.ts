import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findAudioBlob } from "../conversations/audio-blob-store.ts";
import { getSpeechSettings } from "../speech/settings.ts";
import { transcribeStoredRecording } from "../speech/recording-transcription.ts";

export async function transcribeMessagingAudioBlob(userId: number, blobId: string, signal = AbortSignal.timeout(12 * 60_000)): Promise<string> {
  const blob = findAudioBlob({ userId, blobId });
  if (!blob) throw new Error("The voice message is no longer available.");
  const settings = getSpeechSettings(userId);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "breadboard-message-voice-"));
  try {
    return await transcribeStoredRecording({
      // Browser subscription audio cannot run on a gateway. Use the local speech
      // model for phone messages, or the user's configured ElevenLabs or
      // OpenAI (web) provider, both of which transcribe server-side.
      speechProvider: settings.speechProvider === "elevenlabs" || settings.speechProvider === "openaiweb"
        ? settings.speechProvider : "local",
      runtimeScope: { userId, gardenId: null, conversationId: null },
      workspace: { directory, filePath: blob.path }, filename: `voice.${blob.format}`,
      model: settings.transcriptionModel, language: settings.transcriptionLanguage,
      signal, onEvent: () => undefined,
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
