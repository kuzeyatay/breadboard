"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const SEEK_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function BrowserSpotifyProgress({ playback, active, busy, seek }: {
  playback: {
    positionMs: number;
    sampledAtMs?: number;
    isPlaying: boolean;
    track: { durationMs: number };
  } | null;
  active: boolean;
  busy: boolean;
  seek: (positionMs: number) => Promise<boolean>;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const interactingRef = useRef(false);
  const committingRef = useRef(false);
  const duration = Math.max(0, playback?.track.durationMs ?? 0);
  const sampledAt = playback?.sampledAtMs;
  const isPlaying = playback?.isPlaying === true;

  useEffect(() => {
    if (!active || !isPlaying) return;
    const tick = () => setNow(performance.now());
    const frame = window.requestAnimationFrame(tick);
    const timer = window.setInterval(tick, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [active, isPlaying, sampledAt]);

  // Measure elapsed time from the received sample rather than counting timer
  // callbacks: background tabs and a busy renderer can delay those callbacks.
  const elapsed = isPlaying && sampledAt !== undefined && now !== null
    ? Math.max(0, now - sampledAt)
    : 0;
  const position = Math.min(duration, Math.max(0, draft ?? ((playback?.positionMs ?? 0) + elapsed)));
  const progress = duration ? position / duration * 100 : 0;
  const disabled = busy || !playback || duration <= 0;

  const commit = async () => {
    interactingRef.current = false;
    const target = draftRef.current;
    if (target === null || committingRef.current) return;
    draftRef.current = null;
    committingRef.current = true;
    try {
      await seek(target);
    } finally {
      committingRef.current = false;
      setDraft(null);
    }
  };

  return <>
    <span className="browser-spotify-progress" style={{ "--spotify-progress": `${progress}%` } as CSSProperties}>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={1}
        value={Math.round(position)}
        disabled={disabled}
        aria-label="Seek playback"
        aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          interactingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onChange={(event) => {
          const target = Number(event.currentTarget.value);
          draftRef.current = target;
          setDraft(target);
          if (!interactingRef.current) void commit();
        }}
        onPointerUp={() => void commit()}
        onPointerCancel={() => {
          interactingRef.current = false;
          draftRef.current = null;
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (!SEEK_KEYS.has(event.key)) return;
          event.preventDefault();
          interactingRef.current = true;
          const current = Number(event.currentTarget.value);
          const target = event.key === "Home" ? 0 : event.key === "End" ? duration
            : current + (["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 1)
              * (event.key.startsWith("Page") ? 10_000 : 5_000);
          draftRef.current = Math.min(duration, Math.max(0, target));
          setDraft(draftRef.current);
        }}
        onKeyUp={(event) => { if (SEEK_KEYS.has(event.key)) void commit(); }}
        onBlur={() => void commit()}
      />
    </span>
    <span className="browser-spotify-times" aria-hidden="true">
      <span>{formatTime(position)}</span><span>{formatTime(duration)}</span>
    </span>
  </>;
}
