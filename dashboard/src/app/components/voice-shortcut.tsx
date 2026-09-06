'use client';

import { useState } from 'react';
import { AudioLines } from 'lucide-react';
import { openVoiceWindow } from '@/lib/speech/voice-window';

export default function VoiceShortcut({
  className = 'flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-white disabled:opacity-60',
  errorClassName = 'text-xs text-red-400',
}: { className?: string; errorClassName?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    if (busy) return;
    setBusy(true); setError('');
    try { await openVoiceWindow(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Voice could not open. Try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className={className} onClick={() => void open()} disabled={busy} aria-busy={busy} title="Open Voice">
      <AudioLines size={15} aria-hidden="true" />
      Voice
    </button>
    {error && <p role="alert" className={errorClassName}>{error}</p>}
  </>;
}
