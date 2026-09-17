"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ELEVENLABS_SPEECH_MODELS, type ElevenLabsSpeechModel, type ElevenLabsVoice, type SpeechCredentialStatus } from "@/lib/speech/providers";

const fieldClass = "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)]";
const buttonClass = "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-45";

type Props = {
  credentials?: SpeechCredentialStatus;
  voiceId: string;
  model: ElevenLabsSpeechModel;
  enabled: boolean;
  language: string | null;
  languages: readonly (readonly [string, string])[];
  busy: boolean;
  previewText: string;
  onPreviewText: (text: string) => void;
  onPreview: () => void;
  onUpdate: (patch: { elevenlabsVoiceId?: string; elevenlabsModel?: ElevenLabsSpeechModel; enabled?: boolean; transcriptionLanguage?: string | null }) => void;
  onCredentialsChanged: () => Promise<unknown>;
};

export default function SettingsElevenLabsSpeech({ credentials, voiceId, model, enabled, language, languages, busy, previewText, onPreviewText, onPreview, onUpdate, onCredentialsChanged }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const configured = credentials?.configured === true;

  const loadVoices = useCallback(async (cursor?: string | null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingVoices(true);
    setError(null);
    try {
      const response = await fetch(`/api/speech/elevenlabs/voices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "ElevenLabs voices could not be loaded.");
      if (controller.signal.aborted) return;
      setVoices((previous) => [...new Map<string, ElevenLabsVoice>([...(cursor ? previous : []), ...body.voices].map((voice: ElevenLabsVoice) => [voice.id, voice])).values()]);
      setNextCursor(body.nextCursor);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "ElevenLabs voices could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    if (configured) void loadVoices();
    else { setVoices([]); setNextCursor(null); }
    return () => requestRef.current?.abort();
  }, [configured, credentials?.source, loadVoices]);

  async function saveCredential(remove = false) {
    setSavingKey(true);
    setError(null);
    try {
      const response = await fetch("/api/speech/elevenlabs/credentials", {
        method: remove ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(remove ? {} : { body: JSON.stringify({ apiKey }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The ElevenLabs key could not be saved.");
      setApiKey("");
      await onCredentialsChanged();
      // Replacements keep the same configured/source flags, so refresh explicitly.
      if (body.configured) await loadVoices();
      else { requestRef.current?.abort(); setLoadingVoices(false); setVoices([]); setNextCursor(null); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The ElevenLabs key could not be saved.");
    } finally { setSavingKey(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4" aria-label="ElevenLabs speech">
      <div>
        <h3 className="text-sm font-medium text-[var(--ink-heading)]">ElevenLabs speech</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Use your ElevenLabs voices for conversations, dictation, Clicky, and response playback. Text and recordings are sent to ElevenLabs. Your ElevenLabs plan and API usage charges apply.</p>
      </div>
      <div className="space-y-2">
        <p role="status" className="text-xs leading-5 text-[var(--ink)]">{credentials?.error || (configured ? credentials?.source === "environment" ? "Using the server’s ElevenLabs API key." : "ElevenLabs API key saved." : "Add an ElevenLabs API key to get started.")}</p>
        <label className="block text-xs text-[var(--ink-muted)]">ElevenLabs API key
          <input aria-label="ElevenLabs API key" type="password" autoComplete="new-password" spellCheck={false} className={`${fieldClass} mt-1`} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={credentials?.hasStoredKey ? "Enter a replacement key" : "Paste your API key"} disabled={busy || savingKey || credentials?.canStore === false} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={busy || savingKey || !apiKey.trim() || credentials?.canStore === false} onClick={() => void saveCredential()}>{savingKey ? "Saving…" : "Save API key"}</button>
          {credentials?.hasStoredKey ? <button type="button" className={buttonClass} disabled={busy || savingKey} onClick={() => void saveCredential(true)}>Remove saved key</button> : null}
          <a className="text-xs text-[var(--ink-muted)] underline underline-offset-2" href="https://elevenlabs.io/app/developers/api-keys" target="_blank" rel="noreferrer">Get an API key</a>
        </div>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">{credentials?.canStore === false ? "To save a key, configure NEXTAUTH_SECRET on the server. You can also set ELEVENLABS_API_KEY on the server." : "Your key is encrypted on the server. Allow Voices read, Text to Speech, and Speech to Text access."}</p>
      </div>
      <fieldset disabled={busy || savingKey} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--ink-muted)]">ElevenLabs voice
            <select aria-label="ElevenLabs voice" className={`${fieldClass} mt-1`} value={voiceId} disabled={!configured || loadingVoices} onChange={(event) => onUpdate({ elevenlabsVoiceId: event.target.value })}>
              <option value="">Choose a voice</option>
              {voiceId && !voices.some((voice) => voice.id === voiceId) ? <option value={voiceId}>Saved voice · {voiceId}</option> : null}
              {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--ink-muted)]">Speech model
            <select aria-label="Speech model" className={`${fieldClass} mt-1`} value={model} onChange={(event) => onUpdate({ elevenlabsModel: event.target.value as ElevenLabsSpeechModel })}>
              {ELEVENLABS_SPEECH_MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={!configured || loadingVoices} onClick={() => void loadVoices()}>{loadingVoices ? "Loading voices…" : "Refresh voices"}</button>
          {nextCursor ? <button type="button" className={buttonClass} disabled={loadingVoices} onClick={() => void loadVoices(nextCursor)}>Load more voices</button> : null}
        </div>
        <label className="block text-xs text-[var(--ink-muted)]">Spoken language
          <select aria-label="Spoken language" className={`${fieldClass} mt-1`} value={language || ""} onChange={(event) => onUpdate({ transcriptionLanguage: event.target.value || null })}>
            <option value="">Detect automatically</option>
            {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" checked={enabled} onChange={(event) => onUpdate({ enabled: event.target.checked })} />Enable speech and dictation</label>
        <label className="block text-xs text-[var(--ink-muted)]">Preview text
          <textarea aria-label="Preview text" rows={2} className={`${fieldClass} mt-1`} value={previewText} onChange={(event) => onPreviewText(event.target.value)} />
        </label>
        <button type="button" className={buttonClass} disabled={!configured || !voiceId || !enabled || !previewText.trim()} onClick={onPreview}>Preview voice</button>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">Dictation uses Scribe v2. Longer responses are split automatically for playback. Your other providers’ voices stay saved when you switch.</p>
      </fieldset>
      {error ? <p role="alert" className="rounded-xl bg-[var(--paper-strong)] px-3 py-2 text-xs leading-5 text-[var(--ink)]">{error}</p> : null}
    </section>
  );
}
