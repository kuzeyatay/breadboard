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
import { createPortal } from "react-dom";

import {
  BREAK_TIMER_DEFAULT_MS,
  IDLE_WORK_TIMER,
  WORK_TIMER_DEFAULT_MS,
  WORK_TIMER_MAX_MINUTES,
  WORK_TIMER_MIN_MINUTES,
  WORK_TIMER_STORAGE_KEY,
  advanceWorkTimer,
  formatWorkTimer,
  parseWorkTimerSession,
  pauseWorkTimer,
  resetWorkTimer,
  setWorkTimerMode,
  setWorkTimerMinutes,
  settleWorkTimer,
  startWorkTimer,
  workTimerPhase,
  workTimerProgress,
  workTimerRemainingMs,
  type WorkTimerMode,
  type WorkTimerSession,
} from "@/lib/work-timer.ts";

function phaseNote(
  mode: WorkTimerMode,
  phase: ReturnType<typeof workTimerPhase>,
): string {
  if (phase === "running") {
    return mode === "work" ? "Work session in progress." : "Break in progress.";
  }
  if (phase === "paused") {
    return mode === "work" ? "Work timer paused." : "Break timer paused.";
  }
  if (phase === "finished") {
    return mode === "work"
      ? "Work finished. Your break is ready."
      : "Break finished. Ready to work.";
  }
  return mode === "work" ? "Ready to focus." : "Ready to take a break.";
}

export default function WorkTimerShortcut() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<WorkTimerSession>(IDLE_WORK_TIMER);
  const [durationDrafts, setDurationDrafts] = useState<Record<WorkTimerMode, string>>({
    work: String(WORK_TIMER_DEFAULT_MS / 60_000),
    break: String(BREAK_TIMER_DEFAULT_MS / 60_000),
  });
  const [panelPosition, setPanelPosition] = useState<{ top: number; right: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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
    if (stored) {
      const restored = settleWorkTimer(stored, Date.now());
      setSession(restored);
      setDurationDrafts({
        work: String(Math.round(restored.workDurationMs / 60_000)),
        break: String(Math.round(restored.breakDurationMs / 60_000)),
      });
    }
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

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    setPanelPosition({
      top: bounds.bottom + 12,
      right: Math.max(12, window.innerWidth - bounds.right),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

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
      const panel = panelRef.current;
      if (!(event.target instanceof Node)) return;
      if (root?.contains(event.target) || panel?.contains(event.target)) return;
      setOpen(false);
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
  const nextMode: WorkTimerMode = session.mode === "work" ? "break" : "work";
  const modeSwitchLocked = phase === "running" || phase === "paused";
  const primaryLabel =
    phase === "running"
      ? "Pause"
      : phase === "paused"
        ? "Resume"
        : phase === "finished"
          ? `Start ${nextMode}`
          : `Start ${session.mode}`;

  function start() {
    try {
      audioRef.current ??= new AudioContext();
      void audioRef.current.resume();
    } catch {
      // No audio, no problem.
    }
    const timestamp = Date.now();
    setNow(timestamp);
    setSession((current) => {
      const ready = workTimerPhase(current) === "finished"
        ? advanceWorkTimer(current)
        : current;
      return startWorkTimer(ready, timestamp);
    });
  }

  function selectMode(mode: WorkTimerMode) {
    if (modeSwitchLocked) return;
    setSession((current) => setWorkTimerMode(current, mode));
  }

  function commitDuration(mode: WorkTimerMode) {
    const fallback =
      (mode === "work" ? session.workDurationMs : session.breakDurationMs) / 60_000;
    const parsed = Number(durationDrafts[mode]);
    const minutes = Number.isFinite(parsed)
      ? Math.min(
          WORK_TIMER_MAX_MINUTES,
          Math.max(WORK_TIMER_MIN_MINUTES, Math.round(parsed)),
        )
      : Math.round(fallback);
    setDurationDrafts((current) => ({ ...current, [mode]: String(minutes) }));
    setSession((current) => setWorkTimerMinutes(current, mode, minutes));
  }

  function togglePanel() {
    if (!open) updatePanelPosition();
    setOpen((value) => !value);
  }

  const panel = open && panelPosition ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Work timer"
      style={panelPosition}
      className="neu-popover fixed z-[75] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4 text-[var(--ink)]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {session.mode === "work" ? "Work timer" : "Break timer"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the work timer"
          className="rounded-md p-1 text-gray-500 transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-[var(--ink)] active:scale-[0.96]"
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

      <div aria-live="polite">
        <div className="mt-2 text-center text-4xl font-semibold tabular-nums">{clock}</div>
        <p className="mt-1 text-center text-[11px] text-gray-500">
          {phaseNote(session.mode, phase)}
        </p>
      </div>

      <div className="neu-progress-track mt-3 h-1 overflow-hidden rounded-full">
        <div
          className="h-full origin-left rounded-full bg-[var(--botanical)] transition-transform duration-500 ease-linear"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <div
        className="neu-segmented mt-3 grid grid-cols-2 rounded-lg"
        role="group"
        aria-label="Timer type"
      >
        {(["work", "break"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => selectMode(mode)}
            aria-pressed={session.mode === mode}
            disabled={modeSwitchLocked}
            className="rounded-md py-1.5 text-[11px] font-medium capitalize text-gray-500 transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-[var(--ink)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mode}
          </button>
        ))}
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">Timer durations</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["work", "break"] as const).map((mode) => (
            <label key={mode} className="block">
              <span className="text-[10px] font-medium capitalize text-gray-500">
                {mode} minutes
              </span>
              <span className="neu-control mt-1 flex items-center rounded-lg border px-2.5">
                <input
                  type="number"
                  min={WORK_TIMER_MIN_MINUTES}
                  max={WORK_TIMER_MAX_MINUTES}
                  step={1}
                  inputMode="numeric"
                  value={durationDrafts[mode]}
                  onChange={(event) =>
                    setDurationDrafts((current) => ({
                      ...current,
                      [mode]: event.target.value,
                    }))
                  }
                  onBlur={() => commitDuration(mode)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label={`${mode === "work" ? "Work" : "Break"} timer minutes`}
                  className="w-full min-w-0 bg-transparent py-1.5 text-sm font-semibold tabular-nums text-[var(--ink)] outline-none"
                />
                <span className="text-[10px] text-gray-500">min</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

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
          {primaryLabel}
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
        className="mt-3 block rounded-md text-center text-[11px] text-gray-500 transition-colors hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
      >
        Open in another tab
      </a>
    </div>
  ) : null;

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={togglePanel}
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
      </div>
      {typeof document === "undefined" || !panel ? null : createPortal(panel, document.body)}
    </>
  );
}
