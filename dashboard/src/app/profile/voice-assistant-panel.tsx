'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_VOICE_ASSISTANT, VOICE_ASSISTANT_CHANNEL, type VoiceAssistantPreferences } from '@/lib/speech/assistant-preferences';

export default function VoiceAssistantPanel() {
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
      setPreferences(body.preferences); setLoaded(true);
    }).catch(error => { if (!controller.signal.aborted) setIssue(error.message); }); };
    channel.onmessage = event => {
      if (event.data.type === 'preferences') refresh();
      if (event.data.type === 'status') setStatus(event.data.message);
    };
    refresh(); channel.postMessage({ type: 'status-request' });
    return () => { controller.abort(); channel.close(); };
  }, []);
  async function save(key: keyof VoiceAssistantPreferences, enabled: boolean) {
    setSaving(true); setIssue('');
    try {
      const response = await fetch('/api/profile/voice-assistant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...preferences, [key]: enabled }) });
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
      {([
        ['readAloudNotifications', 'Read aloud notifications', 'Read new notifications using your selected Voicebox or OpenAI voice.'],
        ['alwaysOnVoiceAssistant', 'Always on voice assistant', 'Keep the microphone listening while Breadboard is running. Say “Hey Bread” to open voice.'],
      ] as const).map(([key, label, description]) => <div key={key} className="flex items-start justify-between gap-4">
        <div><p id={`${key}-label`} className="text-sm text-white">{label}</p><p id={`${key}-hint`} className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p></div>
        <button type="button" role="switch" aria-checked={preferences[key]} aria-labelledby={`${key}-label`} aria-describedby={`${key}-hint`}
          disabled={!loaded || saving} onClick={() => void save(key, !preferences[key])}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${preferences[key] ? 'bg-emerald-600' : 'bg-gray-700'}`}>
          <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${preferences[key] ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>)}
    </div>
    {(preferences.alwaysOnVoiceAssistant || preferences.readAloudNotifications) && status && <p className="mt-4 text-xs text-gray-400" role="status">{status}</p>}
    {issue && <p className="mt-4 text-xs text-red-400" role="alert">{issue}</p>}
  </section>;
}
