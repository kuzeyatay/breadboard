"use client";

// The navbar's Work timer seat.
//
// Rather than sending the whole tab to the Paint Pomodoro page, the button
// opens a small timer panel underneath the navbar, and closing that panel does
// not end the session: the countdown moves onto the button itself and survives
// a reload, because the session is wall-clock and written to localStorage. The
// full-screen Paint Pomodoro is still one click away, from the panel's footer.
//
// All of the arithmetic lives in `@/lib/work-timer`, so what is left here is
// only the parts that need a browser: storage, the tick, focus, and sound.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  IDLE_WORK_TIMER,
  WORK_TIMER_PRESET_MINUTES,
  WORK_TIMER_STORAGE_KEY,
  formatWorkTimer,
  parseWorkTimerSession,
  pauseWorkTimer,
  resetWorkTimer,
  setWorkTimerMinutes,
  settleWorkTimer,
  startWorkTimer,
  workTimerPhase,
  workTimerProgress,
  workTimerRemainingMs,
  type WorkTimerSession,
} from "@/lib/work-timer.ts";

const PHASE_NOTE: Record<ReturnType<typeof workTimerPhase>, string> = {
  idle: "Ready when you are.",
  running: "Counting down — closing this panel keeps it running.",
  paused: "Paused.",
  finished: "Session finished.",
};

export default function WorkTimerShortcut() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<WorkTimerSession>(IDLE_WORK_TIMER);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  // Nothing has been read from storage yet, so the first effect must not write
  // the idle default over a session this page has not seen.
  const loadedRef = useRef(false);

  // Pick up a session left by an earlier page. One that ran out while nobody
  // was looking lands on "time's up" rather than silently disappearing.
  useEffect(() => {
    let stored: WorkTimerSession | null = null;
    try {
      stored = parseWorkTimerSession(window.localStorage.getItem(WORK_TIMER_STORAGE_KEY));
    } catch {
      // Storage can be unavailable; an idle timer is the right fallback.
    }
    if (stored) setSession(settleWorkTimer(stored, Date.now()));
    setNow(Date.now());
    loadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      window.localStorage.setItem(WORK_TIMER_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // The timer still works for this page's lifetime without storage.
    }
  }, [session]);

  useEffect(() => {
    if (session.endAt === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(tick);
  }, [session.endAt]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      audioRef.current = null;
      void audio?.close().catch(() => undefined);
    },
    [],
  );

  const chime = useCallback(() => {
    // The context was created by the Start click, so playback is allowed here.
    // No context, or a refusal, just means the session ends quietly.
    const audio = audioRef.current;
    if (!audio) return;
    try {
      for (const [offset, frequency] of [
        [0, 660],
        [0.28, 880],
      ] as const) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain).connect(audio.destination);
        const at = audio.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        oscillator.addEventListener(
          "ended",
          () => {
            oscillator.disconnect();
            gain.disconnect();
          },
          { once: true },
        );
        oscillator.start(at);
        oscillator.stop(at + 0.55);
      }
    } catch {
      // A silent finish is fine.
    }
  }, []);

  useEffect(() => {
    if (session.endAt === null || session.endAt > now) return;
    setSession((current) => settleWorkTimer(current, Date.now()));
    chime();
  }, [session.endAt, now, chime]);

  // Escape and a click anywhere else close the panel, as they do for the rest
  // of the app's popovers.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      const root = containerRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const phase = workTimerPhase(session);
  const clock = formatWorkTimer(workTimerRemainingMs(session, now));
  const progress = workTimerProgress(session, now);

  function start() {
    try {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    } catch {
      // No audio, no problem.
    }
    setNow(Date.now());
    setSession((current) => startWorkTimer(current, Date.now()));
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={open ? "Close the work timer" : "Open the work timer"}
        className={`flex items-center gap-1.5 text-xs transition-colors ${
          open || phase !== "idle" ? "text-white" : "text-gray-400 hover:text-white"
        }`}
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <circle cx="12" cy="13" r="7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9.5V13l2.2 2.2M9.5 2.5h5M12 2.5v3"
          />
        </svg>
        {phase === "running" || phase === "paused" ? (
          <span className="font-medium tabular-nums">{clock}</span>
        ) : phase === "finished" ? (
          <span className="font-medium">Time&apos;s up</span>
        ) : (
          "Work timer"
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Work timer"
          className="neu-popover absolute right-0 top-full z-50 mt-3 w-72 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-[var(--ink)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Work timer
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the work timer"
              className="rounded-md p-1 text-gray-500 transition-colors hover:text-[var(--ink)]"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="mt-2 text-center text-4xl font-semibold tabular-nums">{clock}</div>
          <p className="mt-1 text-center text-[11px] text-gray-500">{PHASE_NOTE[phase]}</p>

          <div className="neu-progress-track mt-3 h-1 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-[var(--botanical)] transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {WORK_TIMER_PRESET_MINUTES.map((minutes) => {
              const selected = session.durationMs === minutes * 60_000;
              return (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setSession(setWorkTimerMinutes(minutes))}
                  aria-pressed={selected}
                  title={`Set a ${minutes}-minute session`}
                  className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    selected
                      ? "border-[var(--botanical)] text-[var(--ink)]"
                      : "border-transparent text-gray-500 hover:text-[var(--ink)]"
                  }`}
                >
                  {minutes}m
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                phase === "running"
                  ? setSession((current) => pauseWorkTimer(current, Date.now()))
                  : start()
              }
              className="neu-button-primary flex-1 rounded-lg px-3 py-1.5 text-xs font-medium"
            >
              {phase === "running" ? "Pause" : phase === "paused" ? "Resume" : "Start"}
            </button>
            <button
              type="button"
              onClick={() => setSession(resetWorkTimer)}
              disabled={phase === "idle"}
              className="neu-button-icon rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Reset
            </button>
          </div>

          <a
            href="/pomodoro"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-center text-[11px] text-gray-500 transition-colors hover:text-[var(--ink)]"
          >
            Open Paint Pomodoro — the full-screen version ↗
          </a>
        </div>
      )}
    </div>
  );
}
