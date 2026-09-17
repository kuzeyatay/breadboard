/**
 * Shared, non-secret provider choices for settings and server validation.
 * `openaiweb` is ChatGPT's own website voice, reached through the signed-in
 * chatgpt.com page that powers the "OpenAI (web)" chat provider.
 */
export const SPEECH_PROVIDERS = ["local", "chatgpt", "openaiweb", "elevenlabs"] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];
export const ELEVENLABS_SPEECH_MODELS = [
  ["eleven_flash_v2_5", "Flash v2.5 · fast"],
  ["eleven_multilingual_v2", "Multilingual v2 · natural"],
  ["eleven_v3", "Eleven v3 · expressive"],
] as const;
export type ElevenLabsSpeechModel = (typeof ELEVENLABS_SPEECH_MODELS)[number][0];
export type ElevenLabsVoice = { id: string; name: string };

export function validElevenLabsVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
export const OPENAI_SPEECH_VOICES = [
  "cove", "juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol",
] as const;
export type OpenAISpeechVoice = (typeof OPENAI_SPEECH_VOICES)[number];

export interface SpeechCredentialStatus {
  configured: boolean;
  source: "stored" | "environment" | "subscription" | "web" | null;
  canStore?: boolean;
  hasStoredKey?: boolean;
  signedIn?: boolean;
  reason?: "ready" | "sign_in_required" | "runtime_missing" | "service_unavailable";
  error?: string;
}
