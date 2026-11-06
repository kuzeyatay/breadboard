import type { AssistantReasoningEffort } from '../assistant-reasoning.ts';
import { GLOBAL_MODEL_SENTINEL, normalizeAssistantModelId } from '../ai-models.ts';
import { parseVoiceAssistantPreferences } from './assistant-preferences.ts';
import { currentVoiceScreenContext, parseVoiceScreenContext, type VoiceScreenContext } from './voice-screen-context.ts';

/** A per-turn choice: voice must never overwrite the model saved for typed chats. */
export interface VoiceRequestOptions extends VoiceScreenContext { model: string; reasoningEffort?: AssistantReasoningEffort; voice: true }

export async function voiceRequestOptions(signal?: AbortSignal, screen?: VoiceScreenContext): Promise<VoiceRequestOptions> {
  const response = await fetch('/api/profile/voice-assistant', { cache: 'no-store', signal });
  const body = await response.json();
  const preferences = parseVoiceAssistantPreferences(body.preferences);
  if (!response.ok || !preferences) throw new Error(body.error || 'The default voice model could not be loaded.');
  let model = normalizeAssistantModelId(body.effectiveVoiceModel) ?? preferences.voiceModel;
  if (model === 'none' || model === 'chat') throw new Error('Choose a default voice model in Settings.');
  if (model === GLOBAL_MODEL_SENTINEL) {
    // Resolve the fallback now: startup and chat-specific picks stay separate.
    const response = await fetch('/api/assistant-preferences', { cache: 'no-store', signal });
    const body = await response.json();
    const selected = normalizeAssistantModelId(body.fallbackModel);
    if (!response.ok || !selected || selected === 'none') throw new Error('Choose a default voice model in Settings.');
    model = selected;
  }
  const context = screen ?? await currentVoiceScreenContext().catch(() => ({ browserAccess: null }));
  return { model, voice: true, ...parseVoiceScreenContext(context) };
}
