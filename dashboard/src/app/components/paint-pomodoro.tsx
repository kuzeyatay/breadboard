"use client";

// PaintPomodoro — a focus timer that slowly reveals a public-domain masterpiece
// as you work, matching AirFan003/PaintPomodoro's fullscreen watercolor overlay:
// the painting fills the screen and is animated in with noise-warped pigment
// splotches, while a collapsible Met-styled HUD holds the timer, controls, and
// progressively unlocked clues. Each completed break paints in more; after
// MAX_BREAKS the piece is fully revealed and a fresh one loads.

import { useCallback, useEffect, useRef, useState } from "react";
import { PUBLIC_DOMAIN_ARTWORKS, type Artwork } from "@/lib/paint-pomodoro";
import { PaintReveal } from "@/lib/paint-reveal";

type Mode = "focus" | "short" | "long";

const DEFAULT_DURATIONS: Record<Mode, number> = { focus: 25, short: 5, long: 15 };
const MODE_LABEL: Record<Mode, string> = { focus: "Focus", short: "Short break", long: "Long break" };
const MODE_ORDER: Mode[] = ["focus", "short", "long"];
const REVEAL_SESSIONS = 6; // focus sessions to fully reveal a piece
const BASE_REVEAL = 0.08; // glimpses show from the start so it reads as a painting

const SETTINGS_KEY = "bb_paint_pomodoro_settings_v1";
const PROGRESS_KEY = "bb_paint_pomodoro_progress_v1";

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function playChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.72);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 1600);
  } catch {
    // Audio is a nicety; ignore environments that block it.
  }
}

export default function PaintPomodoro() {
  const [durations, setDurations] = useState<Record<Mode, number>>(DEFAULT_DURATIONS);
  const [mode, setMode] = useState<Mode>("focus");
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_DURATIONS.focus * 60);
  const [running, setRunning] = useState(false);
  const [focusCount, setFocusCount] = useState(0);
  const [revealSessions, setRevealSessions] = useState(0);
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const revealRef = useRef<PaintReveal | null>(null);
  const fractionRef = useRef(BASE_REVEAL);

  const totalSeconds = durations[mode] * 60;
  const inBreak = mode !== "focus";
  // The painting fills in while you focus. Progress within the current focus
  // session counts too (frozen on pause, so the reveal only ever grows).
  const focusProgress =
    !inBreak && totalSeconds > 0
      ? Math.min(1, Math.max(0, 1 - secondsLeft / totalSeconds))
      : 0;
  const rawReveal = (revealSessions + focusProgress) / REVEAL_SESSIONS;
  const revealFraction = Math.min(1, BASE_REVEAL + (1 - BASE_REVEAL) * rawReveal);
  const revealPercent = Math.round(revealFraction * 100);
  const fullyRevealed = revealSessions >= REVEAL_SESSIONS;
  const titleRevealed = revealFraction >= 0.85;

  const loadArtwork = useCallback(async (opts?: { keepReveal?: boolean; excludeId?: string }) => {
    try {
      const params = opts?.excludeId ? `?exclude=${encodeURIComponent(opts.excludeId)}` : "";
      const response = await fetch(`/api/paint-pomodoro/artwork${params}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { artwork?: Artwork };
      setArtwork(data.artwork?.imageUrl ? data.artwork : PUBLIC_DOMAIN_ARTWORKS[0]);
    } catch {
      setArtwork(PUBLIC_DOMAIN_ARTWORKS[Math.floor(Math.random() * PUBLIC_DOMAIN_ARTWORKS.length)]);
    }
    if (!opts?.keepReveal) setRevealSessions(0);
  }, []);

  // Hydrate persisted state once, after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration of persisted state */
    let restoredArtwork = false;
    try {
      const rawSettings = window.localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as Partial<Record<Mode, number>>;
        const next: Record<Mode, number> = { ...DEFAULT_DURATIONS };
        for (const key of MODE_ORDER) {
          const value = parsed[key];
          if (typeof value === "number" && value >= 1 && value <= 180) next[key] = value;
        }
        setDurations(next);
        setSecondsLeft(next.focus * 60);
      }
      const rawProgress = window.localStorage.getItem(PROGRESS_KEY);
      if (rawProgress) {
        const parsed = JSON.parse(rawProgress) as { artwork?: Artwork; revealSessions?: number; focusCount?: number };
        if (typeof parsed.revealSessions === "number") setRevealSessions(Math.max(0, parsed.revealSessions));
        if (typeof parsed.focusCount === "number") setFocusCount(Math.max(0, parsed.focusCount));
        if (parsed.artwork?.imageUrl) {
          setArtwork(parsed.artwork);
          restoredArtwork = true;
        }
      }
    } catch {
      // First run or storage disabled; defaults are fine.
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!restoredArtwork) void loadArtwork();
  }, [loadArtwork]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(durations));
    } catch {
      /* best-effort */
    }
  }, [durations, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ artwork, revealSessions, focusCount }));
    } catch {
      /* best-effort */
    }
  }, [artwork, revealSessions, focusCount, hydrated]);

  const finishSession = useCallback(() => {
    setRunning(true);
    playChime();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(mode === "focus" ? "Focus session done" : `${MODE_LABEL[mode]} over`, {
        body: mode === "focus" ? "Take a break — the painting is waiting." : "Back to focus.",
        silent: true,
      });
    }
    let nextMode: Mode;
    if (mode === "focus") {
      const nextFocus = focusCount + 1;
      setFocusCount(nextFocus);
      // A completed focus session paints in another band. Once the piece is
      // fully revealed, the next completed session swaps in a fresh one.
      const nextReveal = revealSessions + 1;
      if (nextReveal > REVEAL_SESSIONS) {
        void loadArtwork({ excludeId: artwork?.id }); // resets revealSessions to 0
      } else {
        setRevealSessions(nextReveal);
      }
      nextMode = nextFocus % 4 === 0 ? "long" : "short";
    } else {
      nextMode = "focus";
    }
    setMode(nextMode);
    setSecondsLeft(durations[nextMode] * 60);
  }, [mode, focusCount, revealSessions, durations, loadArtwork, artwork]);

  const finishRef = useRef(finishSession);
  useEffect(() => {
    finishRef.current = finishSession;
  }, [finishSession]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (secondsLeft <= 1) {
        finishRef.current();
        return;
      }
      setSecondsLeft(secondsLeft - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [running, secondsLeft]);

  const toggleRun = useCallback(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
    setRunning((current) => !current);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    setSecondsLeft(durations[mode] * 60);
  }, [durations, mode]);

  const adjustTimer = useCallback((deltaSeconds: number) => {
    setSecondsLeft((current) => Math.max(0, current + deltaSeconds));
  }, []);

  const skip = useCallback(() => finishRef.current(), []);

  const newPiece = useCallback(() => {
    void loadArtwork({ excludeId: artwork?.id });
  }, [loadArtwork, artwork]);

  const adjustDuration = useCallback(
    (target: Mode, delta: number) => {
      const nextValue = Math.min(180, Math.max(1, durations[target] + delta));
      setDurations((current) => ({ ...current, [target]: nextValue }));
      if (target === mode && !running) setSecondsLeft(nextValue * 60);
    },
    [durations, mode, running],
  );

  // Title reflects the countdown when the tab/window is inactive.
  useEffect(() => {
    const previous = document.title;
    document.title = running ? `${formatClock(secondsLeft)} · Paint Pomodoro` : "Paint Pomodoro";
    return () => {
      document.title = previous;
    };
  }, [running, secondsLeft]);

  // Bind the reveal engine to the fullscreen canvas and keep it viewport-sized.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reveal = new PaintReveal(canvas);
    revealRef.current = reveal;
    const apply = () => reveal.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
    apply();
    let debounce = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(apply, 150);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      window.clearTimeout(debounce);
      reveal.destroy();
      revealRef.current = null;
    };
  }, []);

  // Sample + reset the canvas whenever the artwork changes.
  useEffect(() => {
    const reveal = revealRef.current;
    if (!artwork || !reveal) return;
    let active = true;
    void reveal
      .load(`/api/paint-pomodoro/image?src=${encodeURIComponent(artwork.imageUrl)}`)
      .then(() => {
        if (active) reveal.setTarget(fractionRef.current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artwork]);

  // Animate more splotches in as the reveal fraction grows.
  useEffect(() => {
    fractionRef.current = revealFraction;
    revealRef.current?.setTarget(revealFraction);
  }, [revealFraction]);

  const phaseLabel = running ? (inBreak ? "On a break" : "Focusing · Painting") : secondsLeft === totalSeconds ? "Ready" : "Paused";
  const progressLabel = fullyRevealed
    ? "Painting revealed"
    : `Session ${Math.min(revealSessions + 1, REVEAL_SESSIONS)} / ${REVEAL_SESSIONS}`;

  const timerHint = running
    ? inBreak
      ? "On a break — enjoy the painting so far."
      : "Focusing — the painting fills in as you work."
    : inBreak
      ? "Resume when you're ready."
      : "Start a focus session to paint the picture in.";

  const primaryLabel = running
    ? "Pause"
    : secondsLeft === totalSeconds
      ? inBreak
        ? "Start break"
        : "Start focus"
      : "Resume";

  const headline = titleRevealed && artwork ? artwork.title : "A mystery, for now";
  const subline =
    titleRevealed && artwork
      ? [artwork.artist, artwork.date, `Courtesy of ${artwork.credit}`].filter(Boolean).join(" · ")
      : timerHint;

  const clues = artwork
    ? [
        { at: 0, label: "Collection", value: artwork.department },
        { at: 0.2, label: "Medium", value: artwork.medium },
        { at: 0.4, label: "Origins", value: artwork.culture || artwork.date },
        { at: 0.6, label: "Artist", value: artwork.artist },
        { at: 0.85, label: "Title", value: artwork.title },
      ].filter((clue) => clue.value)
    : [];

  return (
    <div className="pp-overlay">
      <style>{THEME_CSS}</style>
      <canvas
        ref={canvasRef}
        className="pp-paint"
        role="img"
        aria-label={
          titleRevealed && artwork
            ? `${artwork.title} by ${artwork.artist}, painted in watercolor`
            : "A watercolor painting being revealed as you focus"
        }
      />
      {!artwork ? <div className="pp-boot">Preparing today&apos;s painting…</div> : null}

      <aside className={`pp-hud${collapsed ? " is-collapsed" : ""}`}>
        <div className="pp-hud-header">
          <button
            type="button"
            className="pp-hud-toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            <span className="pp-hud-progress">{progressLabel}</span>
            <span className="pp-hud-timer">{formatClock(secondsLeft)}</span>
            <span className="pp-chevron" aria-hidden="true" />
          </button>
        </div>

        <div className="pp-hud-body">
          <p className="pp-hud-phase">{phaseLabel}</p>
          <p className="pp-hud-headline">{headline}</p>
          <p className="pp-hud-sub">{subline}</p>

          <div className="pp-controls">
            <button type="button" className="pp-btn pp-btn-primary" onClick={toggleRun}>
              {primaryLabel}
            </button>
            <button type="button" className="pp-btn pp-btn-secondary" onClick={reset}>
              Reset
            </button>
            <button type="button" className="pp-btn pp-btn-secondary" onClick={skip}>
              Skip
            </button>
          </div>

          <div className="pp-time-controls" aria-label="Adjust timer">
            <button
              type="button"
              className="pp-time-adjust"
              onClick={() => adjustTimer(-30)}
              aria-label="Rewind timer by 30 seconds"
              title="Rewind 30 seconds"
            >
              −30 sec
            </button>
            <button
              type="button"
              className="pp-time-adjust"
              onClick={() => adjustTimer(30)}
              aria-label="Add 30 seconds to timer"
              title="Add 30 seconds"
            >
              +30 sec
            </button>
          </div>

          <div className="pp-bar">
            <div className="pp-bar-fill" style={{ width: `${revealPercent}%` }} />
          </div>

          <div className="pp-clues">
            {clues.length === 0 ? (
              <p className="pp-clue-empty">Revealing the first clue…</p>
            ) : (
              clues.map((clue) => {
                const unlocked = revealFraction >= clue.at;
                return (
                  <div key={clue.label} className={`pp-clue${unlocked ? " is-open" : ""}`}>
                    <p className="pp-clue-label">{clue.label}</p>
                    <p className={`pp-clue-value${unlocked ? "" : " pp-locked"}`}>
                      {unlocked ? clue.value : "Unlocks as you focus"}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <div className="pp-settings">
            {MODE_ORDER.map((item) => (
              <div key={item} className="pp-setting">
                <span className="pp-setting-label">{MODE_LABEL[item]}</span>
                <div className="pp-stepper">
                  <button type="button" onClick={() => adjustDuration(item, -1)} aria-label={`Decrease ${MODE_LABEL[item]}`}>
                    −
                  </button>
                  <span className="pp-setting-value">{durations[item]}</span>
                  <button type="button" onClick={() => adjustDuration(item, 1)} aria-label={`Increase ${MODE_LABEL[item]}`}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="pp-hud-footer">
            <button type="button" className="pp-newpiece" onClick={newPiece}>
              New piece
            </button>
            <span className="pp-attr">Public domain · {artwork ? artwork.credit : "The Met & partners"}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

const THEME_CSS = `
.pp-overlay {
  --canvas: #faf7f2; --surface: #ffffff; --surface-muted: #f5f0e8;
  --ink: #1a1a1a; --ink-sec: #3d3d3d; --ink-muted: #6b6b6b; --ink-subtle: #9a9a9a;
  --accent: #9a4f42; --accent-strong: #c45c4a; --accent-hover: #8a4539; --accent-fill: #efe8df; --warm: #8b7355;
  --border: #e5ddd2; --border-subtle: #ece4da;
  --serif: var(--font-newsreader), Georgia, 'Times New Roman', serif;
  --sans: var(--font-source-sans), system-ui, -apple-system, 'Segoe UI', sans-serif;
  position: absolute; inset: 0; overflow: hidden;
  background: var(--canvas); color: var(--ink); font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}
.pp-overlay *, .pp-overlay *::before, .pp-overlay *::after { box-sizing: border-box; }
.pp-paint { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.pp-boot {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-style: italic; font-size: 1.1rem; color: var(--ink-subtle);
}

/* ── Collapsible HUD ── */
.pp-hud {
  position: absolute; left: 24px; bottom: 24px;
  width: min(400px, calc(100% - 48px)); max-height: min(78vh, 640px);
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: 4px; border: 1px solid var(--border);
  background: rgba(255, 252, 247, 0.97);
  box-shadow: 0 10px 34px rgba(40, 26, 18, 0.16);
  backdrop-filter: blur(3px);
}
.pp-hud.is-collapsed { max-height: none; }
.pp-hud.is-collapsed .pp-hud-body { display: none; }

.pp-hud-header { flex-shrink: 0; border-bottom: 1px solid var(--border-subtle); }
.pp-hud.is-collapsed .pp-hud-header { border-bottom: none; }
.pp-hud-toggle {
  display: flex; align-items: center; gap: 12px; width: 100%; margin: 0;
  padding: 14px 16px; border: none; background: transparent; cursor: pointer;
  text-align: left; font: inherit; color: inherit;
}
.pp-hud-toggle:hover { background: rgba(154, 79, 66, 0.05); }
.pp-hud-progress {
  flex: 1; margin: 0; font-size: 0.625rem; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent);
}
.pp-hud-timer {
  flex-shrink: 0; font-family: var(--serif); font-size: 1.25rem; font-weight: 400;
  font-variant-numeric: tabular-nums; letter-spacing: 0.02em; color: var(--ink);
}
.pp-chevron {
  width: 8px; height: 8px; flex-shrink: 0; margin-top: -3px;
  border-right: 1.5px solid var(--accent); border-bottom: 1.5px solid var(--accent);
  transform: rotate(45deg); transition: transform 0.2s ease;
}
.pp-hud.is-collapsed .pp-chevron { transform: rotate(-135deg); margin-top: 2px; }

.pp-hud-body { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 16px; }
.pp-hud-phase {
  margin: 0 0 4px; font-size: 0.625rem; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent);
}
.pp-hud-headline { margin: 0 0 4px; font-family: var(--serif); font-size: 1.35rem; font-weight: 500; line-height: 1.2; color: var(--ink); }
.pp-hud-sub { margin: 0 0 14px; font-size: 0.8125rem; line-height: 1.45; color: var(--ink-muted); }

.pp-controls { display: flex; gap: 8px; margin-bottom: 14px; }
.pp-btn {
  flex: 1; border: 1px solid transparent; border-radius: 2px; padding: 10px 12px;
  font-family: var(--sans); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease;
}
.pp-btn:active { transform: translateY(1px); }
.pp-btn-primary { flex: 1.5; background: var(--accent-strong); color: #fff; border-color: var(--accent-strong); }
.pp-btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.pp-btn-secondary { background: var(--surface); color: var(--ink-sec); border-color: var(--border); }
.pp-btn-secondary:hover { background: var(--surface-muted); }

.pp-time-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: -6px 0 14px; }
.pp-time-adjust {
  min-height: 32px; border: 1px solid var(--border); border-radius: 2px;
  background: var(--surface); color: var(--warm); font-family: var(--sans);
  font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease;
}
.pp-time-adjust:hover { border-color: var(--warm); background: var(--surface-muted); }
.pp-time-adjust:active { transform: translateY(1px); }

.pp-bar { height: 4px; background: var(--surface-muted); border-radius: 2px; overflow: hidden; margin-bottom: 14px; }
.pp-bar-fill { height: 100%; background: var(--accent-strong); transition: width 500ms ease; }

.pp-clues { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.pp-clue-empty { margin: 0; font-size: 0.8125rem; color: var(--ink-muted); }
.pp-clue { padding: 9px 11px; border-radius: 2px; background: rgba(255, 255, 255, 0.7); border: 1px solid var(--border-subtle); }
.pp-clue.is-open { border-color: rgba(154, 79, 66, 0.24); background: rgba(255, 248, 242, 0.95); animation: pp-clue-in 0.45s ease-out; }
@keyframes pp-clue-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.pp-clue-label { margin: 0 0 2px; font-size: 0.625rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.pp-clue-value { margin: 0; font-family: var(--serif); font-size: 0.9375rem; font-weight: 500; line-height: 1.35; color: var(--ink); }
.pp-clue-value.pp-locked { font-style: italic; font-weight: 400; color: var(--ink-subtle); }

.pp-settings { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.pp-setting { display: flex; align-items: center; justify-content: space-between; }
.pp-setting-label { font-size: 0.8125rem; color: var(--ink-sec); }
.pp-stepper { display: flex; align-items: center; gap: 8px; }
.pp-stepper button { width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 2px; background: var(--surface); color: var(--ink); font-size: 1rem; line-height: 1; cursor: pointer; }
.pp-stepper button:hover { background: var(--surface-muted); }
.pp-setting-value { width: 26px; text-align: center; font-variant-numeric: tabular-nums; font-size: 0.875rem; color: var(--ink); }

.pp-hud-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border-subtle); }
.pp-newpiece {
  border: 1px solid var(--border); border-radius: 2px; background: var(--surface);
  padding: 7px 12px; font-family: var(--sans); font-size: 0.6875rem; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--warm); cursor: pointer;
}
.pp-newpiece:hover { border-color: var(--warm); background: var(--surface-muted); }
.pp-attr { margin: 0; font-size: 0.625rem; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-subtle); text-align: right; }

html[data-theme="dark"] .pp-overlay {
  --canvas: #0b0c0a; --surface: #212420; --surface-muted: #171916;
  --ink: #e2e7de; --ink-sec: #ccd2c9; --ink-muted: #8d968b; --ink-subtle: #778075;
  --accent: #91b7a1; --accent-strong: #a6c8b4; --accent-hover: #c4d8c8; --accent-fill: #253832; --warm: #c5a963;
  --border: #454f48; --border-subtle: #2e3530;
}
html[data-theme="dark"] .pp-hud { background: rgb(23 25 22 / 97%); box-shadow: 0 10px 34px rgb(0 0 0 / 62%); }
html[data-theme="dark"] .pp-hud-toggle:hover { background: rgb(255 255 255 / 5%); }
html[data-theme="dark"] .pp-btn-primary { color: #0b0c0a; }
html[data-theme="dark"] .pp-clue { background: rgb(33 36 32 / 88%); }
html[data-theme="dark"] .pp-clue.is-open { border-color: #9fb5c4; background: rgb(45 49 43 / 96%); }
`;
