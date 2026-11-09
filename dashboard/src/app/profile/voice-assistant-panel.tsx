'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_VOICE_ASSISTANT, VOICE_ASSISTANT_CHANNEL, parseVoiceAssistantPreferences, type VoiceAssistantPreferences } from '@/lib/speech/assistant-preferences';
import { useAssistantModels } from '@/app/components/use-assistant-models';
import { GLOBAL_MODEL_SENTINEL, CHAT_MODEL_SENTINEL, NO_MODEL_SENTINEL, groupAssistantModels, formatAssistantModelName } from '@/lib/ai-models';

export default function VoiceAssistantPanel() {
  const { models } = useAssistantModels({ eager: true });
  const [preferences, setPreferences] = useState(DEFAULT_VOICE_ASSISTANT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
    const refresh = () => { void fetch('/api/profile/voice-assistant', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Voice settings could not load.');
      const preferences = parseVoiceAssistantPreferences(body.preferences);
      if (!preferences) throw new Error('Voice settings could not load.');
      setPreferences(preferences); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setIssue(error.message); }); };
    channel.onmessage = event => {
      if (event.data.type === 'preferences') refresh();
      if (event.data.type === 'status') setStatus(event.data.message);
    };
    refresh(); channel.postMessage({ type: 'status-request' });
    return () => { controller.abort(); channel.close(); };
  }, []);
  async function save(key: keyof VoiceAssistantPreferences, value: boolean | string) {
    setSaving(true); setIssue('');
    try {
      const response = await fetch('/api/profile/voice-assistant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...preferences, [key]: value }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Voice settings could not save.');
      setPreferences(body.preferences);
      const channel = new BroadcastChannel(VOICE_ASSISTANT_CHANNEL);
      channel.postMessage({ type: 'preferences' }); channel.close();
    } catch (error) { setIssue(error instanceof Error ? error.message : 'Voice settings could not save.'); }
    finally { setSaving(false); }
  }
  return <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
    <h2 className="text-sm font-semibold text-white">Voice assistant</h2>
    <div className="mt-4 space-y-5">
      <label className="block text-sm text-white">
        Default voice model
        <select aria-label="Default voice model" value={preferences.voiceModel} disabled={!loaded || saving}
          onChange={event => void save('voiceModel', event.target.value)}
          className="neu-button mt-2 w-full rounded-xl border border-gray-800 bg-transparent px-3 py-2 text-sm text-gray-200 disabled:opacity-40">
          <option value={GLOBAL_MODEL_SENTINEL}>Use fallback model</option>
          {groupAssistantModels([...new Set([preferences.voiceModel, ...models])].filter(id => ![GLOBAL_MODEL_SENTINEL, CHAT_MODEL_SENTINEL, NO_MODEL_SENTINEL].includes(id))).map(group =>
            <optgroup key={group.vendorId} label={group.vendorLabel}>{group.models.map(id => <option key={id} value={id}>{formatAssistantModelName(id)}</option>)}</optgroup>)}
        </select>
        <span className="mt-1 block text-xs leading-relaxed text-gray-500">Choose the model for voice conversations. Your chat model and speaking voice stay the same.</span>
      </label>
      <label className="block text-sm text-white">
        Voice thinking
        <select aria-label="Voice thinking" value={preferences.voiceThinking} disabled={!loaded || saving}
          onChange={event => void save('voiceThinking', event.target.value)}
          className="neu-button mt-2 w-full rounded-xl border border-gray-800 bg-transparent px-3 py-2 text-sm text-gray-200 disabled:opacity-40">
          <option value="fast">Fast conversation</option>
          <option value="high">High thinking</option>
        </select>
        <span className="mt-1 block text-xs leading-relaxed text-gray-500">Fast uses brief reasoning before replying. High gives complex questions more thinking time. Both use your voice model and tools.</span>
      </label>
      {([
        ['startVoiceOnStartup', "Prepare voice on startup", "Keep voice ready when Breadboard opens. The microphone stays off."],
        ['readAloudNotifications', "Read notifications aloud", "Read new notifications using your selected voice."],
        ['alwaysOnVoiceAssistant', "Listen for “Hey Bread”", 'Keep the microphone listening while Breadboard is running. Say “Hey Bread” to open voice.'],
      ] as const).map(([key, label, description]) => <div key={key} className="flex items-start justify-between gap-4">
        <div><p id={`${key}-label`} className="text-sm text-white">{label}</p><p id={`${key}-hint`} className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p></div>
        <button type="button" role="switch" aria-checked={preferences[key]} aria-labelledby={`${key}-label`} aria-describedby={`${key}-hint`}
          disabled={!loaded || saving} onClick={() => void save(key, !preferences[key])}
          className={`neu-inset relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${preferences[key] ? 'bg-[var(--botanical)]' : 'bg-[var(--line-strong)]'}`}>
          <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${preferences[key] ? 'translate-x-5' : ''}`} />
        </button>
      </div>)}
    </div>
    {(preferences.startVoiceOnStartup || preferences.alwaysOnVoiceAssistant || preferences.readAloudNotifications) && status && <p className="mt-4 text-xs text-gray-400" role="status">{status}</p>}
    {issue && <p className="mt-4 text-xs text-red-400" role="alert">{issue}</p>}
  </section>;
}
