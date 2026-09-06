"use client";
import { OPENAI_SPEECH_VOICES, type SpeechCredentialStatus } from "@/lib/speech/providers";

const fieldClass = "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)]";
const buttonClass = "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-45";

export default function SettingsCloudSpeech({ cloud, voice, enabled, language, languages, busy, previewText, onPreviewText, onPreview, onUpdate, onCredentialsChanged }: {
  cloud?: SpeechCredentialStatus;
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
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4" aria-label="ChatGPT subscription speech">
      <div>
        <h3 className="text-sm font-medium text-[var(--ink-heading)]">ChatGPT subscription speech · Experimental</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
          Automatically reuses your connected ChatGPT account from Accounts. No separate voice sign-in is needed.
          No API key or separately billed Audio API is used. Subscription access and limits apply.
          Your selected chat model stays the same. Audio and text are sent to OpenAI; voices are AI-generated.
        </p>
      </div>
      <div className="space-y-2">
        <p role="status" className="text-xs leading-5 text-[var(--ink)]">{cloud?.error || (cloud?.configured ? "ChatGPT account connected. Preview a voice to test realtime access." : "Checking the subscription connection…")}</p>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void onCredentialsChanged()}>Re-check connection</button>
        {!cloud?.configured && cloud?.reason !== "sign_in_required" ? <p className="text-xs text-[var(--ink-muted)]">An unavailable voice service does not mean you are signed out. Your existing account will be reused when it connects.</p> : null}
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--ink-muted)]">Cloud voice
            <select aria-label="Cloud voice" className={fieldClass} value={voice} onChange={(event) => onUpdate({ openaiVoice: event.target.value })}>
              {OPENAI_SPEECH_VOICES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--ink-muted)]">Spoken language
            <select aria-label="Spoken language" className={fieldClass} value={language || ""} onChange={(event) => onUpdate({ transcriptionLanguage: event.target.value || null })}>
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
        <button type="button" className={buttonClass} disabled={!cloud?.configured || !enabled || !previewText.trim()} onClick={onPreview}>Preview voice</button>
        <p className="text-xs leading-5 text-[var(--ink-muted)]">Microphone audio is sent live; speech plays as it arrives. Longer text is split automatically, with no 4,000-character limit. Uploaded recordings are processed in real time. Your subscription’s limits still apply. Local voices stay saved when you switch back.</p>
      </fieldset>
    </section>
  );
}
