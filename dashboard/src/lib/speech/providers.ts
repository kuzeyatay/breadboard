/** Shared, non-secret provider choices for settings and server validation. */
export const SPEECH_PROVIDERS = ["local", "chatgpt"] as const;
export type SpeechProvider = (typeof SPEECH_PROVIDERS)[number];
export const OPENAI_SPEECH_VOICES = [
  "cove", "juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol",
] as const;
export type OpenAISpeechVoice = (typeof OPENAI_SPEECH_VOICES)[number];

export interface SpeechCredentialStatus {
  configured: boolean;
  source: "stored" | "environment" | "subscription" | null;
  canStore?: boolean;
  hasStoredKey?: boolean;
  error?: string;
}
