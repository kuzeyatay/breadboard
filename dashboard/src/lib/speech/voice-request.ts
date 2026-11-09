import type { AssistantReasoningEffort } from '../assistant-reasoning.ts';
import { GLOBAL_MODEL_SENTINEL, normalizeAssistantModelId } from '../ai-models.ts';
import { parseVoiceAssistantPreferences, voiceReasoningEffort } from './assistant-preferences.ts';
import { currentVoiceScreenContext, parseVoiceScreenContext, type VoiceScreenContext } from './voice-screen-context.ts';

/** A per-turn choice: voice must never overwrite the model saved for typed chats. */
export interface VoiceRequestOptions extends VoiceScreenContext { model: string; reasoningEffort?: AssistantReasoningEffort; voice: true }

export async function voiceRequestOptions(signal?: AbortSignal, screen?: VoiceScreenContext): Promise<VoiceRequestOptions> {
  // Screen capability and model preference are independent reads. Start both
  // together so the selected model does not wait for a second IPC round trip.
  const screenContext = screen && 'browserAccess' in screen ? Promise.resolve(screen)
    : currentVoiceScreenContext().catch(() => ({ browserAccess: null })).then(current => ({ ...current, ...screen }));
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
  const context = await screenContext;
  signal?.throwIfAborted();
  return { model, reasoningEffort: voiceReasoningEffort(preferences),
    voice: true, ...parseVoiceScreenContext(context) };
}
