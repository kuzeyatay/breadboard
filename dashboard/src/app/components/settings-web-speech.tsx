"use client";
import { OPENAI_SPEECH_VOICES, type SpeechCredentialStatus } from "@/lib/speech/providers";

const fieldClass = "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)]";
const buttonClass = "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-45";

/** OpenAI (web): ChatGPT's own website voice, through the chatgpt.com sign-in. */
export default function SettingsWebSpeech({ web, voice, enabled, language, languages, busy, previewText, onPreviewText, onPreview, onUpdate, onCredentialsChanged }: {
  web?: SpeechCredentialStatus;
  voice: string;
  enabled: boolean;
  language: string | null;
  languages: readonly (readonly [string, string])[];
  busy: boolean;
  previewText: string;
  onPreviewText: (text: string) => void;
  onPreview: () => void;
  onUpdate: (patch: { openaiVoice?: string; enabled?: boolean; transcriptionLanguage?: string | null }) => void;
  onCredentialsChanged: () => Promise<unknown>;
}) {
  const status = web?.error || (web?.configured
    ? "Signed in to chatgpt.com. Preview a voice to test it."
    : "Checking the chatgpt.com sign-in…");
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4" aria-label="OpenAI (web) speech">
      <div>
        <h3 className="text-sm font-medium text-[var(--ink-heading)]">OpenAI (web) speech · Experimental</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
          Uses ChatGPT&apos;s own website voice through the chatgpt.com sign-in from Accounts → OpenAI (web).
          No API key and no Codex app are needed. ChatGPT&apos;s limits for your plan apply.
          Audio and text are sent to OpenAI; voices are AI-generated.
        </p>
      </div>
      <div className="space-y-2">
        <p role="status" className="text-xs leading-5 text-[var(--ink)]">{status}</p>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void onCredentialsChanged()}>Re-check connection</button>
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--ink-muted)]">ChatGPT voice
            <select aria-label="ChatGPT voice" className={fieldClass} value={voice} onChange={(event) => onUpdate({ openaiVoice: event.target.value })}>
              {OPENAI_SPEECH_VOICES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--ink-muted)]">Dictation language
            <select aria-label="Dictation language" className={fieldClass} value={language || ""} onChange={(event) => onUpdate({ transcriptionLanguage: event.target.value || null })}>
              <option value="">Detect automatically</option>
              {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input type="checkbox" checked={enabled} onChange={(event) => onUpdate({ enabled: event.target.checked })} />
          Enable speech and dictation
        </label>
        <label className="block text-xs text-[var(--ink-muted)]">Preview text
          <textarea aria-label="Preview text" rows={2} className={fieldClass} value={previewText} onChange={(event) => onPreviewText(event.target.value)} />
        </label>
        <button type="button" className={buttonClass} disabled={!web?.configured || !enabled || !previewText.trim()} onClick={onPreview}>Preview voice</button>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">
          Read-aloud and spoken notifications use ChatGPT&apos;s Read aloud voice: the text is placed in a temporary
          ChatGPT chat and read back, so the first word takes a few seconds. Dictation and voice conversations use
          ChatGPT&apos;s transcription. The chatgpt.com page answers one request at a time, so a long OpenAI (web) chat
          answer can delay a reading.
        </p>
      </fieldset>
    </section>
  );
}
