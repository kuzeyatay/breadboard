'use client';

import { useId, useState } from 'react';
import { MAX_PRONUNCIATION_CHARACTERS, parsePronunciations } from '@/lib/speech/pronunciation';

type Props = {
  value: string;
  busy: boolean;
  onSave: (value: string) => Promise<boolean>;
};

export default function SettingsSpeechPronunciations(props: Props) {
  return <details className="rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-4">
    <summary className="cursor-pointer text-sm font-medium text-[var(--ink-heading)]">Pronunciation corrections</summary>
    <PronunciationEditor key={props.value} {...props} />
  </details>;
}

function PronunciationEditor({ value, busy, onSave }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  async function save() {
    try { parsePronunciations(draft); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check the pronunciation corrections.'); return; }
    setError('');
    if (!await onSave(draft)) setError('Corrections could not be saved. Try again.');
  }
  return <div className="mt-3 space-y-3">
      <label htmlFor={id} className="block text-xs text-[var(--ink-muted)]">Words and their pronunciations</label>
      <textarea id={id} value={draft} onChange={event => { setDraft(event.target.value); setError(''); }}
        rows={4} maxLength={MAX_PRONUNCIATION_CHARACTERS} disabled={busy} spellCheck={false}
        placeholder={'SQL = sequel\nAPI = A P I'} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)}
        className="neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15" />
      <p id={`${id}-help`} className="text-xs leading-5 text-[var(--ink-muted)]">One correction per line: word = pronunciation. Match capitalization exactly. Changes apply to speech only; your written text stays the same. Restart an active voice conversation to use newly saved corrections.</p>
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
      <button type="button" disabled={busy || draft.trim() === value.trim()} onClick={() => void save()}
        className="neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] disabled:opacity-45">
        {busy ? 'Saving…' : 'Save pronunciations'}
      </button>
  </div>;
}
