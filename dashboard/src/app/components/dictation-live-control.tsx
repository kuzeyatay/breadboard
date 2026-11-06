'use client';
import type { RefObject } from 'react';

/** The shared microphone pill in garden chat and above the desktop caret. */
export default function DictationLiveControl({ active, paused = false, loading = false, loadingLabel = 'Connecting dictation', onPause, onStop, pauseRef, levelBarsRef, cursor = false }: {
  active: boolean; paused?: boolean; onPause?: () => void; onStop?: () => void;
  pauseRef?: RefObject<HTMLButtonElement | null>;
  levelBarsRef: RefObject<(HTMLSpanElement | null)[]>;
  cursor?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return <div className={`dictation-live-control${cursor ? ' dictation-cursor-control' : ''}`} role="group"
    data-dictation-loading={loading} aria-busy={loading}
    aria-label={loading ? loadingLabel : paused ? 'Dictation paused' : 'Live dictation controls'} aria-hidden={!active}>
    {onPause && <button ref={pauseRef} type="button" className="dictation-live-action dictation-live-pause"
      onClick={onPause} disabled={!active} aria-label={paused ? 'Resume dictation' : 'Pause dictation'} title={paused ? 'Resume dictation' : 'Pause dictation'}>
      {paused ? <svg viewBox="0 0 20 20" aria-hidden><path d="m7.2 5.4 6.2 4.1a.6.6 0 0 1 0 1l-6.2 4.1a.6.6 0 0 1-.92-.5V5.9a.6.6 0 0 1 .92-.5Z" fill="currentColor" /></svg>
        : <svg viewBox="0 0 20 20" aria-hidden><path d="M6.5 5.5h2v9h-2zm5 0h2v9h-2z" fill="currentColor" /></svg>}
    </button>}
    <span className="dictation-levels" role="img" aria-label={loading ? loadingLabel : paused ? 'Microphone paused' : 'Live microphone level'}>
      {[0, 1, 2, 3, 4].map(index => <span key={index} ref={node => { levelBarsRef.current[index] = node; }} className="dictation-level-bar" aria-hidden />)}
    </span>
    {onStop && <button type="button" className="dictation-live-action dictation-live-stop" onClick={onStop} disabled={!active} aria-label="Stop dictation" title="Stop dictation">
      <svg viewBox="0 0 20 20" aria-hidden><path d="m6.25 6.25 7.5 7.5m0-7.5-7.5 7.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>
    </button>}
  </div>;
}
