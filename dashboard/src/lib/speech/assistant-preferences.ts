import { GLOBAL_MODEL_SENTINEL, CHAT_MODEL_SENTINEL, NO_MODEL_SENTINEL, normalizeAssistantModelId } from '../ai-models.ts';

export interface VoiceAssistantPreferences {
  readAloudNotifications: boolean;
  alwaysOnVoiceAssistant: boolean;
  startVoiceOnStartup: boolean;
  voiceModel: string;
}
export const DEFAULT_VOICE_ASSISTANT: VoiceAssistantPreferences = {
  readAloudNotifications: false, alwaysOnVoiceAssistant: false,
  startVoiceOnStartup: true, voiceModel: GLOBAL_MODEL_SENTINEL,
};
export const VOICE_ASSISTANT_CHANNEL = 'breadboard:voice-assistant';
export function parseVoiceAssistantPreferences(value: unknown): VoiceAssistantPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !(key in DEFAULT_VOICE_ASSISTANT)) ||
    typeof row.readAloudNotifications !== 'boolean' || typeof row.alwaysOnVoiceAssistant !== 'boolean') return null;
  const voiceModel = row.voiceModel === undefined ? GLOBAL_MODEL_SENTINEL : normalizeAssistantModelId(row.voiceModel);
  if (!voiceModel || voiceModel === CHAT_MODEL_SENTINEL || voiceModel === NO_MODEL_SENTINEL ||
      (row.startVoiceOnStartup !== undefined && typeof row.startVoiceOnStartup !== 'boolean')) return null;
  return { readAloudNotifications: row.readAloudNotifications, alwaysOnVoiceAssistant: row.alwaysOnVoiceAssistant,
    startVoiceOnStartup: row.startVoiceOnStartup !== false, voiceModel };
}
/** Match whole words, including punctuation supplied by a transcriber. */
export function heardHeyBread(text: string): boolean {
  return /\bhey[\s,.!?—-]+bread\b/i.test(text);
}
