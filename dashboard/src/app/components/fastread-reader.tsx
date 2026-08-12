'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ChatMarkdown from './chat-markdown';
import { QUARTZ_BASE_URL } from '@/lib/quartz-url';
import {
  FASTREAD_DEFAULT_WPM,
  FASTREAD_MAX_WPM,
  FASTREAD_MIN_WPM,
  FASTREAD_WPM_STEP,
  formatTimeRemaining,
  getWordDelay,
  parseFastReadDocument,
  resolveAssetUrl,
  splitWordForDisplay,
  stepBackward,
  stepForward,
  wordOffsets,
  type FastReadCursor,
  type FastReadStopSegment,
} from '@/lib/fastread';

interface Props {
  title: string;
  content: string;
  onClose: () => void;
}

const WPM_STORAGE_KEY = 'breadboard:fastread:wpm';
const THEME_STORAGE_KEY = 'breadboard:fastread:theme';

type FastReadTheme = 'light' | 'dark';

function readStoredWpm(): number {
  if (typeof window === 'undefined') return FASTREAD_DEFAULT_WPM;
  const stored = Number(window.localStorage.getItem(WPM_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return FASTREAD_DEFAULT_WPM;
  return Math.min(FASTREAD_MAX_WPM, Math.max(FASTREAD_MIN_WPM, Math.round(stored)));
}

/** Remembered choice first, then the OS preference, then the app's light theme. */
function readStoredTheme(): FastReadTheme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const STOP_ICON_PATHS: Record<FastReadStopSegment['kind'], string> = {
  image: 'M3 5.5h18v13H3zM3 15l5-4 4 3 3-2.5 6 4.5',
  visualizer: 'M4 19V5m0 14h16M8 16V9m4 7v-4m4 4V6',
  code: 'm8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12',
  math: 'M5 6h9L8 12l6 6H5m11-9h4m-4 5h4',
  table: 'M3 5.5h18v13H3zM3 10h18M9 10v8.5M15 10v8.5',
  embed: 'M4 5.5h16v13H4zm6 4 5 2.5-5 2.5z',
};

function StopIcon({ kind }: { kind: FastReadStopSegment['kind'] }) {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STOP_ICON_PATHS[kind]} />
    </svg>
  );
}

/**
 * Renders whatever interrupted the word stream. Images resolve against the
 * garden origin; code, math, and tables go through the shared markdown renderer
 * so they look the way they do on the page. Raw HTML embeds are shown as source
 * rather than injected.
 */
function StopBlock({ stop }: { stop: FastReadStopSegment }) {
  if (stop.kind === 'image') {
    const src = resolveAssetUrl(stop.src ?? '', QUARTZ_BASE_URL);

    // PDF-extracted figures sometimes keep the caption and lose the file.
    if (!src) {
      return (
        <div className="fastread-stop-card">
          <p className="fastread-stop-note">
            {stop.alt || 'A figure sits here, but the page has no image file for it.'}
          </p>
        </div>
      );
    }

    return (
      <figure className="fastread-stop-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={stop.alt || 'Figure from this page'} />
        {stop.alt && <figcaption>{stop.alt}</figcaption>}
      </figure>
    );
  }

  if (stop.kind === 'visualizer') {
    return (
      <div className="fastread-stop-card">
        <p className="fastread-stop-note">
          An interactive visual sits here. It runs on the page behind the reader — look at it there,
          then continue.
        </p>
        {stop.visualId && <p className="fastread-stop-id">{stop.visualId}</p>}
      </div>
    );
  }

  if (stop.kind === 'embed') {
    return (
      <div className="fastread-stop-card">
        <p className="fastread-stop-note">Embedded media sits here. Its source:</p>
        <pre className="fastread-stop-source">{stop.raw}</pre>
      </div>
    );
  }

  return (
    <div className="fastread-stop-markdown">
      <ChatMarkdown content={stop.raw} />
    </div>
  );
}

export default function FastReadReader({ title, content, onClose }: Props) {
  const parsed = useMemo(() => parseFastReadDocument(content), [content]);
  const { segments, totalWords } = parsed;
  const offsets = useMemo(() => wordOffsets(segments), [segments]);

  const [cursor, setCursor] = useState<FastReadCursor>({ segmentIndex: 0, wordIndex: 0 });
  // Open paused, on the first word, so the reader starts when they are ready.
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  // The reader only ever mounts client-side, on click, so these read their
  // opening value from storage directly.
  const [wpm, setWpm] = useState(readStoredWpm);
  const [theme, setTheme] = useState<FastReadTheme>(readStoredTheme);

  // `advance` runs from timers and click handlers, so the cursor is mirrored in
  // a ref and written through synchronously — never read stale between frames.
  const cursorRef = useRef(cursor);
  const moveTo = useCallback((next: FastReadCursor) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(WPM_STORAGE_KEY, String(wpm));
  }, [wpm]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const segment = segments[cursor.segmentIndex];
  const stop = segment && segment.kind !== 'text' ? (segment as FastReadStopSegment) : null;
  const words = segment?.kind === 'text' ? segment.words : [];
  const currentWord = words[cursor.wordIndex];

  const wordsRead = finished
    ? totalWords
    : (offsets[cursor.segmentIndex] ?? totalWords) + (segment?.kind === 'text' ? cursor.wordIndex : 0);
  const progress = totalWords ? Math.min(100, (wordsRead / totalWords) * 100) : 0;

  /** Step forward one word, crossing into the next segment when a run ends. */
  const advance = useCallback(() => {
    const step = stepForward(segments, cursorRef.current);

    if (step.type === 'end') {
      setPlaying(false);
      setFinished(true);
      return;
    }

    // Hitting a stop is the point of the whole thing: hold until Continue.
    if (step.type === 'stop') setPlaying(false);
    moveTo(step.cursor);
  }, [moveTo, segments]);

  const stepBack = useCallback(() => {
    setFinished(false);
    setPlaying(false);

    const previous = stepBackward(segments, cursorRef.current);
    if (previous) moveTo(previous);
  }, [moveTo, segments]);

  /**
   * Leave the stop currently on screen and pick the word stream back up. From a
   * stop there is no word left in the run, so this always crosses a boundary.
   */
  const continuePastStop = useCallback(() => {
    const step = stepForward(segments, cursorRef.current);

    if (step.type === 'end') {
      setPlaying(false);
      setFinished(true);
      return;
    }

    setPlaying(step.type === 'text');
    moveTo(step.cursor);
  }, [moveTo, segments]);

  const restart = useCallback(() => {
    setFinished(false);
    setPlaying(segments[0]?.kind === 'text');
    moveTo({ segmentIndex: 0, wordIndex: 0 });
  }, [moveTo, segments]);

  const togglePlay = useCallback(() => {
    if (stop) {
      continuePastStop();
      return;
    }
    if (finished) {
      restart();
      return;
    }
    setPlaying((current) => !current);
  }, [continuePastStop, finished, restart, stop]);

  // The playback clock: one timeout per word, re-armed whenever the word changes.
  useEffect(() => {
    if (!playing || stop || !currentWord) return;

    const timer = window.setTimeout(advance, getWordDelay(currentWord.text, wpm));
    return () => window.clearTimeout(timer);
  }, [advance, currentWord, playing, stop, wpm]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          return;
        case ' ':
        case 'Enter':
          event.preventDefault();
          togglePlay();
          return;
        case 'ArrowUp':
          event.preventDefault();
          setWpm((current) => Math.min(FASTREAD_MAX_WPM, current + FASTREAD_WPM_STEP));
          return;
        case 'ArrowDown':
          event.preventDefault();
          setWpm((current) => Math.max(FASTREAD_MIN_WPM, current - FASTREAD_WPM_STEP));
          return;
        case 'ArrowLeft':
          event.preventDefault();
          stepBack();
          return;
        case 'ArrowRight':
          event.preventDefault();
          setPlaying(false);
          advance();
          return;
        default:
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advance, onClose, stepBack, togglePlay]);

  const parts = currentWord && !currentWord.atomic ? splitWordForDisplay(currentWord.text) : null;
  const empty = !totalWords && !parsed.stopCount;

  const overlay = (
    <div
      className="fastread-overlay"
      data-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-label="Fast-read reader"
    >
      <header className="fastread-header">
        <div className="fastread-header-titles">
          <span className="fastread-eyebrow">Fast-read</span>
          <h2 className="fastread-title">{title}</h2>
          {segment?.sectionTitle && <p className="fastread-section">{segment.sectionTitle}</p>}
        </div>
        <div className="fastread-header-actions">
          <div className="fastread-speed" role="group" aria-label="Reading speed">
            <button
              type="button"
              onClick={() =>
                setWpm((current) => Math.max(FASTREAD_MIN_WPM, current - FASTREAD_WPM_STEP))
              }
              disabled={wpm <= FASTREAD_MIN_WPM}
              aria-label="Read slower"
            >
              −
            </button>
            <span>{wpm} wpm</span>
            <button
              type="button"
              onClick={() =>
                setWpm((current) => Math.min(FASTREAD_MAX_WPM, current + FASTREAD_WPM_STEP))
              }
              disabled={wpm >= FASTREAD_MAX_WPM}
              aria-label="Read faster"
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="fastread-close"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Switch to light reading' : 'Switch to dark reading'}
            title={theme === 'dark' ? 'Light' : 'Dark'}
          >
            {theme === 'dark' ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="fastread-close"
            onClick={onClose}
            aria-label="Close Fast-read"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div className="fastread-stage">
        {empty ? (
          <p className="fastread-empty">This page has no reading text yet.</p>
        ) : stop ? (
          <div className="fastread-stop">
            <p className="fastread-stop-label">
              <StopIcon kind={stop.kind} />
              {stop.label} — paused
            </p>
            <div className="fastread-stop-body">
              <StopBlock stop={stop} />
            </div>
            <button type="button" className="fastread-continue" onClick={continuePastStop}>
              Continue reading
              <span className="fastread-continue-hint">Space</span>
            </button>
          </div>
        ) : finished ? (
          <div className="fastread-done">
            <p>End of page.</p>
            <button type="button" className="fastread-continue" onClick={restart}>
              Read again
            </button>
          </div>
        ) : (
          <div className="fastread-word-stage">
            <span className="fastread-marker fastread-marker-top" aria-hidden="true" />
            <div className={currentWord?.atomic ? 'fastread-word atomic' : 'fastread-word'}>
              {currentWord?.atomic ? (
                <span className="fastread-atomic">{currentWord.text}</span>
              ) : parts ? (
                <>
                  <span className="fastread-orp">{parts.orp}</span>
                  <span className="fastread-before">{parts.before}</span>
                  <span className="fastread-after">{parts.after}</span>
                </>
              ) : (
                <span className="fastread-atomic">Ready</span>
              )}
            </div>
            <span className="fastread-marker fastread-marker-bottom" aria-hidden="true" />
          </div>
        )}
      </div>

      <footer className="fastread-footer">
        <div className="fastread-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="fastread-controls">
          <p className="fastread-meta">
            {wordsRead.toLocaleString()} / {totalWords.toLocaleString()} words ·{' '}
            {formatTimeRemaining(Math.max(0, totalWords - wordsRead), wpm)} left
            {parsed.stopCount > 0 && ` · ${parsed.stopCount} stop${parsed.stopCount === 1 ? '' : 's'}`}
          </p>
          <div className="fastread-buttons">
            <button type="button" onClick={restart}>
              Restart
            </button>
            <button type="button" onClick={stepBack} aria-label="Previous word">
              ←
            </button>
            <button type="button" className="fastread-play" onClick={togglePlay} disabled={empty}>
              {stop ? 'Continue' : finished ? 'Read again' : playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                advance();
              }}
              aria-label="Next word"
              disabled={Boolean(stop)}
            >
              →
            </button>
          </div>
        </div>
      </footer>
    </div>
  );

  // The navbar wraps its buttons in a `relative z-10` div, which is a stacking
  // context — an overlay rendered inside it can never rise above the garden's
  // floating Quartz AI launcher, whatever z-index it claims. Portal to the body
  // so the overlay competes in the root stacking context instead.
  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
