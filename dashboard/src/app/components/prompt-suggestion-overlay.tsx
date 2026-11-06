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
export default function PromptSuggestionOverlay({ text, placeholder, compact }: {
  text: string;
  placeholder: string;
  compact: boolean;
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
      className={`pointer-events-none absolute inset-0 flex min-w-0 select-none items-center gap-2 px-1 text-[var(--ink-muted)] ${compact ? 'text-sm leading-5' : 'text-[15px] leading-6'}`}
    >
      <span className={`min-w-0 flex-1 truncate ${visiblePhase === 'erase' ? '' : 'opacity-70'}`}>
        <span
          className="bb-composer-suggestion-text"
          data-text-replacement={visiblePhase === 'ready' ? undefined : visiblePhase}
          style={{
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
      <kbd className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 font-sans text-[10px] leading-none">Tab</kbd>
    </div>
  );
}
