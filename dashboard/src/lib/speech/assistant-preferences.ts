export interface VoiceAssistantPreferences {
  readAloudNotifications: boolean;
  alwaysOnVoiceAssistant: boolean;
}
export const DEFAULT_VOICE_ASSISTANT: VoiceAssistantPreferences = {
  readAloudNotifications: false, alwaysOnVoiceAssistant: false,
};
export const VOICE_ASSISTANT_CHANNEL = 'breadboard:voice-assistant';
export function parseVoiceAssistantPreferences(value: unknown): VoiceAssistantPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !(key in DEFAULT_VOICE_ASSISTANT)) ||
    typeof row.readAloudNotifications !== 'boolean' || typeof row.alwaysOnVoiceAssistant !== 'boolean') return null;
  return { readAloudNotifications: row.readAloudNotifications, alwaysOnVoiceAssistant: row.alwaysOnVoiceAssistant };
}
/** Match whole words, including punctuation supplied by a transcriber. */
export function heardHeyBread(text: string): boolean {
  return /\bhey[\s,.!?—-]+bread\b/i.test(text);
}
