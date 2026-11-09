"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, CameraOff, Hand, HandGrab, Mic, Monitor, Move, Pause, Rotate3D, Settings2, ZoomIn, type LucideIcon } from "lucide-react";
import { usePageLoading } from "@/app/components/use-page-loading";
import { gestureControlBridge, type GestureControlAction, type GestureControlState, type GestureSettings, type HandGestureAction } from "@/lib/gesture-control";
import GestureSettingsPanel from "./gesture-settings";
import styles from "./gestures.module.css";

const initial: GestureControlState = {
  available: true, phase: "stopped", paused: true, status: "Camera off", detail: "",
  display: "External monitor", image: null,
};
type PausedGestureKey = "v_while_paused" | "bent_while_paused" | "straight_while_paused";
type GuideItem = { icon: LucideIcon; name: string; action: string; detail: string;
  pausedKey?: PausedGestureKey; unavailable?: boolean };
function gestureGuide(settings?: GestureSettings): GuideItem[] {
  const mapped = (action: HandGestureAction) => {
    if (action === "voice") return { action: "Hold to talk", detail: "Holds Ctrl + Shift for Breadboard voice. Relax the gesture to release." };
    if (action === "disabled" || settings?.scroll_enabled === false) return { action: "No action", detail: "You can assign this gesture in Settings.", unavailable: true };
    return { action: action === "scroll_up" ? "Scroll up" : "Scroll down", detail: "Scrolling continues while you hold it. Relax your hand to stop." };
  };
  return [
    { icon: HandGrab, name: "Fist", action: `Hold for ${(settings?.fist_start_hold_ms ?? 3000) / 1000} seconds to start`, detail: `Open your hand after the countdown. Hold a fist for ${(settings?.fist_pause_hold_ms ?? 800) / 1000} seconds to pause again.` },
    { icon: Move, name: "Relaxed hand", action: "Move the pointer", detail: settings?.pinch_action === "disabled" ? "Pinch clicking is switched off." : settings?.pinch_action === "right_click" ? "Pinch thumb and index, then release to right click." : "Pinch thumb and index to click. Hold the pinch to drag." },
    { icon: ArrowDown, name: "Bent L", pausedKey: "bent_while_paused", ...mapped(settings?.bent_action ?? "scroll_down") },
    { icon: ArrowUp, name: "Straight hand", pausedKey: "straight_while_paused", ...mapped(settings?.straight_action ?? "scroll_up") },
    { icon: Mic, name: "V sign", pausedKey: "v_while_paused", ...mapped(settings?.v_action ?? "voice") },
    { icon: Rotate3D, name: "Turn your hand", action: settings?.cad_rotate === false ? "Rotation off" : "Rotate in CAD", detail: "Automatic over supported CAD views, including Breadboard’s CAD artifacts." },
    { icon: ZoomIn, name: "Open / close pinch", action: settings?.cad_zoom === false ? "Zoom off" : "Zoom in / out in CAD", detail: settings?.invert_zoom ? "Open the gap to zoom out; close it to zoom in." : "Open the gap to zoom in; close it to zoom out. No mode gesture needed." },
  ];
}

export default function GestureScreen() {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState<"guide" | "settings">("guide");
  const action = useRef<((command: GestureControlAction, settings?: GestureSettings) => Promise<GestureControlState | undefined>) | null>(null);
  usePageLoading(busy);

  useEffect(() => {
    const bridge = gestureControlBridge();
    if (!bridge) {
      setState({ ...initial, available: false, error: "Open this screen in the updated Breadboard desktop to use gesture control." });
      setBusy(false);
      return;
    }
    let disposed = false;
    let mutating = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    const perform = async (command: GestureControlAction, settings?: GestureSettings) => {
      if (mutating) return;
      mutating = true;
      revision++;
      setBusy(true);
      try {
        const next = await bridge(command, settings);
        if (!disposed) setState(next);
        return next;
      } catch {
        if (!disposed) setState(previous => ({ ...previous, image: null,
          error: "Could not reach gesture control. Try again, or use Ctrl+Alt+Esc to stop it." }));
      } finally {
        mutating = false;
        if (!disposed) setBusy(false);
      }
    };
    action.current = perform;
    async function poll() {
      if (disposed) return;
      if (!mutating && document.visibilityState === "visible") {
        const version = revision;
        try {
          const next = await bridge!("state");
          if (!disposed && !mutating && version === revision) setState(next);
        } catch {
          if (!disposed && version === revision) setState(previous => ({ ...previous, image: null,
            error: "Gesture control disconnected. Reopen the camera to reconnect." }));
        }
      }
      if (!disposed) timer = setTimeout(poll, document.visibilityState === "visible" ? 150 : 1000);
    }
    void perform("start");
    timer = setTimeout(poll, 150);
    return () => {
      disposed = true;
      action.current = null;
      clearTimeout(timer);
      // Navigation leaves gesture control available in other tabs and CAD apps.
    };
  }, []);

  const running = state.phase === "running";
  const active = running && !state.paused;
  const guide = gestureGuide(state.settings);
  const pausedShortcuts = guide.filter(item => item.pausedKey && state.settings?.[item.pausedKey] && !item.unavailable);
  const fistSeconds = (state.settings?.fist_start_hold_ms ?? 3000) / 1000;
  const send = (command: GestureControlAction) => { void action.current?.(command); };

  return <main className={styles.page}>
    <div className={styles.content}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.mark}><Hand size={26} strokeWidth={1.5} /></span>
          <div><h1>Gesture control</h1><p>Control the pointer, scrolling and CAD with hand gestures.</p></div>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.cameraPanel} aria-label="Gesture camera">
          <div className={styles.cameraHeader}>
            <span className={styles.state} data-active={active} role="status"><i /> {active ? "Control on" : running ? pausedShortcuts.length ? "Pointer paused" : "Paused" : "Camera off"}</span>
            <div className={styles.buttons}>
              {running ? <>
                <button type="button" onClick={() => send("pause")} disabled={busy || state.paused}><Pause size={15} /> Pause</button>
                <button type="button" onClick={() => send("stop")} disabled={busy}><CameraOff size={15} /> Stop camera</button>
              </> : <button type="button" className={styles.primary} onClick={() => send("start")} disabled={busy || !state.available}><Camera size={15} /> {state.error ? "Retry camera" : "Open camera"}</button>}
            </div>
          </div>
          <div className={styles.preview}>
            {state.image ?
              // eslint-disable-next-line @next/next/no-img-element -- changing in-memory camera frame
              <img src={`data:image/jpeg;base64,${state.image}`} width={640} height={480} alt="Live gesture camera with hand tracking" /> :
              <div className={styles.cameraEmpty}><CameraOff size={34} strokeWidth={1.25} /><p>{running ? "Live camera preview" : "Your camera preview appears here"}</p></div>}
          </div>
          <div className={styles.cameraFooter}>
            <div className={styles.readout}>
              <strong>{running ? state.status : "Camera off"}</strong>
              <span>{state.detail || (active ? "Relax your hand to move the pointer." : running && pausedShortcuts.length ?
                `${pausedShortcuts.map(item => item.name).join(", ")} works while paused. Hold a fist for ${fistSeconds} seconds to enable the pointer.` :
                `Hold a fist for ${fistSeconds} seconds, then open your hand.`)}</span>
            </div>
          </div>
          {state.error && <p role="alert" className={styles.error}>{state.error} {running && <button type="button" disabled={busy} onClick={() => send("start")}>Reconnect</button>}</p>}
          <div className={styles.cameraMeta}><Monitor size={14} /><span>{state.display.replace(/^\\\\\.\\/, "")} · Camera stays on when you leave this screen.</span></div>
        </section>

        <aside className={styles.guide} aria-label={tab === "settings" ? "Gesture settings" : "Your gestures"}>
          <div className={styles.panelTabs} role="tablist" aria-label="Gesture panel" onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : tab === "guide" ? 1 : 0;
            setTab(index === 0 ? "guide" : "settings");
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
          }}>
            <button type="button" role="tab" id="gesture-guide-tab" tabIndex={tab === "guide" ? 0 : -1} aria-selected={tab === "guide"} aria-controls="gesture-guide-panel" onClick={() => setTab("guide")}><Hand size={15} /> Your gestures</button>
            <button type="button" role="tab" id="gesture-settings-tab" tabIndex={tab === "settings" ? 0 : -1} aria-selected={tab === "settings"} aria-controls="gesture-settings-panel" onClick={() => setTab("settings")}><Settings2 size={15} /> Settings</button>
          </div>
          <div role="tabpanel" id="gesture-settings-panel" aria-labelledby="gesture-settings-tab" hidden={tab !== "settings"}>
          {state.settings && state.settingsDefaults ?
            <GestureSettingsPanel settings={state.settings} defaults={state.settingsDefaults} busy={busy}
              onSave={settings => action.current?.("save-settings", settings) ?? Promise.resolve(undefined)} /> :
            <p className={styles.settingsHint}>Open the camera to load your saved settings.</p>}
          </div>
          <div role="tabpanel" id="gesture-guide-panel" aria-labelledby="gesture-guide-tab" hidden={tab !== "guide"}>
          <p className={styles.shortcutHint}>Use while paused lets a gesture work whenever the camera is on. Pointing, clicking and CAD still need fist activation. Switches save immediately.</p>
          <ul>{guide.map(({ icon: Icon, name, action: description, detail, pausedKey, unavailable }) => <li key={name}>
            <span className={styles.gestureIcon}><Icon size={19} strokeWidth={1.6} /></span>
            <div className={styles.gestureBody}><span className={styles.gestureName}>{name}</span><h3>{description}</h3><p>{detail}</p>
              {pausedKey && <label className={styles.shortcutSwitch}>
                <span>Use while paused</span>
                <input type="checkbox" role="switch" aria-label={`Use ${name} while paused`} checked={state.settings?.[pausedKey] ?? false}
                  disabled={busy || !state.settings || unavailable} onChange={event => {
                    if (state.settings) void action.current?.("save-settings", { ...state.settings, [pausedKey]: event.target.checked });
                  }} />
              </label>}
            </div>
          </li>)}</ul>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        <p>Keep your hand beside your face, in the green frame. Camera processing stays on this computer.</p>
        <p><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> pause / resume <span>·</span> <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Esc</kbd> quit</p>
      </footer>
    </div>
  </main>;
}
