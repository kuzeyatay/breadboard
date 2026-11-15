'use client';

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { textEraseMs, textTypeMs } from '@/lib/text-replacement-motion';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const reducedMotionSnapshot = () => window.matchMedia(REDUCED_MOTION).matches;
const serverMotionSnapshot = () => true;
function subscribeMotion(changed: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}

/** Mounted only while the empty composer has a valid suggestion. The real
 * draft stays untouched, so typing, Escape and Tab interrupt immediately. */
export default function PromptSuggestionOverlay({ text, placeholder, compact, multiline = false }: {
  text: string;
  placeholder: string;
  compact: boolean;
  multiline?: boolean;
}) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, reducedMotionSnapshot, serverMotionSnapshot);
  const [phase, setPhase] = useState<'erase' | 'type' | 'ready'>(placeholder ? 'erase' : 'type');
  const visiblePhase = reducedMotion && phase === 'erase' ? 'type' : phase;
  const displayed = visiblePhase === 'erase' ? placeholder : text;

  return (
    <div
      aria-hidden
      data-prompt-suggestion
      data-suggestion-phase={visiblePhase}
      className={`pointer-events-none absolute flex min-w-0 select-none gap-2 text-[var(--ink-muted)] ${multiline ? 'inset-x-0 top-0 items-start py-1 text-sm leading-[22px]' : `inset-0 items-center px-1 ${compact ? 'text-sm leading-5' : 'text-[15px] leading-6'}`}`}
    >
      <span className={`min-w-0 flex-1 ${multiline ? 'break-words' : 'truncate'} ${visiblePhase === 'erase' ? '' : 'opacity-70'}`}>
        <span
          className="bb-composer-suggestion-text"
          data-text-replacement={visiblePhase === 'ready' ? undefined : visiblePhase}
          style={{
            ...(multiline ? { whiteSpace: 'normal', overflowWrap: 'anywhere' } : {}),
            '--bb-title-character-count': Math.max(1, Array.from(displayed).length),
            '--bb-title-erase-duration': `${textEraseMs(placeholder)}ms`,
            '--bb-title-type-duration': `${textTypeMs(text)}ms`,
          } as CSSProperties}
          onAnimationEnd={event => {
            if (event.target !== event.currentTarget) return;
            if (event.animationName === 'bb-chat-title-erase') setPhase('type');
            else if (event.animationName === 'bb-chat-title-type' || event.animationName === 'bb-chat-title-fade') setPhase('ready');
          }}
        >{displayed}</span>
      </span>
      <kbd className={`shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 font-sans text-[10px] leading-none ${multiline ? 'mt-1' : ''}`}>Tab</kbd>
    </div>
  );
}
