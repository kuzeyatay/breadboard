"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw, Save } from "lucide-react";
import type { GestureControlState, GestureSettings, HandGestureAction } from "@/lib/gesture-control";
import styles from "./gestures.module.css";

const actionOptions: [HandGestureAction, string][] = [
  ["voice", "Hold Ctrl + Shift (voice)"], ["scroll_down", "Scroll down continuously"],
  ["scroll_up", "Scroll up continuously"], ["disabled", "No action"],
];
const signature = (settings: GestureSettings) => JSON.stringify(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)));

function Slider({ label, value, min, max, step, display, hint, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number; display: string;
  hint?: string; disabled?: boolean; onChange: (value: number) => void;
}) {
  return <label className={styles.setting}>
    <span className={styles.settingLabel}><span>{label}</span><output>{display}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))} />
    {hint && <small>{hint}</small>}
  </label>;
}

export default function GestureSettingsPanel({ settings, defaults, busy, onSave }: {
  settings: GestureSettings; defaults: Readonly<GestureSettings>; busy: boolean;
  onSave: (settings: GestureSettings) => Promise<GestureControlState | undefined>;
}) {
  const [draft, setDraft] = useState(settings);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const previous = useRef(signature(settings));
  const savedSignature = signature(settings);
  const dirty = signature(draft) !== savedSignature;
  useEffect(() => {
    const old = previous.current;
    previous.current = savedSignature;
    setDraft(current => signature(current) === old ? settings : current);
  }, [savedSignature, settings]);

  const change = <K extends keyof GestureSettings>(key: K, value: GestureSettings[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setNotice("");
    setFailed(false);
  };
  const seconds = (value: number) => `${Number((value / 1000).toFixed(2))} s`;
  const check = (key: "scroll_enabled" | "cad_rotate" | "cad_zoom" | "invert_zoom", label: string) =>
    <label className={styles.toggle}><span>{label}</span><input type="checkbox" checked={draft[key]} onChange={event => change(key, event.target.checked)} /></label>;

  async function save() {
    setNotice("");
    const result = await onSave(draft);
    const error = result?.error || (!result?.settings ? "Could not save settings. Please try again." : "");
    setFailed(Boolean(error));
    if (!error && result?.settings) setDraft(result.settings);
    setNotice(error || (result?.phase === "running" ? "Saved and applied. Hold a fist to enable the pointer." : "Saved for the next camera session."));
  }

  return <form className={styles.settingsForm} onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={busy}>
      <details className={styles.settingsGroup} open>
        <summary>Cursor &amp; pinch <ChevronDown size={15} /></summary>
        <Slider label="Cursor sensitivity" value={draft.pointer_gain} min={0.4} max={2.5} step={0.05} display={`${draft.pointer_gain.toFixed(2)}×`}
          hint="Higher moves farther with the same hand motion. Lower gives finer control." onChange={value => change("pointer_gain", value)} />
        <Slider label="Smoothing" value={draft.smoothing} min={0} max={100} step={5} display={`${draft.smoothing}%`}
          hint="Higher filters more small shakes; lower reacts faster." onChange={value => change("smoothing", value)} />
        <label className={styles.setting}><span className={styles.settingLabel}>Tracking hand</span>
          <select aria-label="Tracking hand" value={draft.preferred_hand} onChange={event => change("preferred_hand", event.target.value as GestureSettings["preferred_hand"])}>
            <option value="Auto">Either hand</option><option value="Left">Left hand</option><option value="Right">Right hand</option>
          </select>
        </label>
        <Slider label="Pinch detection" value={draft.pinch_threshold} min={0.18} max={0.4} step={0.01} display={`${Math.round(draft.pinch_threshold * 100)}`}
          hint="Higher recognizes a pinch with a wider fingertip gap." onChange={value => change("pinch_threshold", value)} />
        <label className={styles.setting}><span className={styles.settingLabel}>Thumb + index pinch</span>
          <select aria-label="Thumb + index pinch" value={draft.pinch_action} onChange={event => change("pinch_action", event.target.value as GestureSettings["pinch_action"])}>
            <option value="left_click">Left click · hold to drag</option><option value="right_click">Right click</option><option value="disabled">No click</option>
          </select>
        </label>
        <Slider label="Hold before dragging" value={draft.drag_hold_ms} min={200} max={1500} step={50} display={seconds(draft.drag_hold_ms)}
          disabled={draft.pinch_action !== "left_click"} onChange={value => change("drag_hold_ms", value)} />
      </details>

      <details className={styles.settingsGroup}>
        <summary>Gesture actions &amp; timing <ChevronDown size={15} /></summary>
        <p className={styles.settingsHint}>Assign actions to the recognized hand shapes. Use while paused enables just that gesture while the camera is on. Pointing, clicking and CAD still need fist activation.</p>
        {([["v_action", "v_while_paused", "V sign"], ["bent_action", "bent_while_paused", "Bent L hand"], ["straight_action", "straight_while_paused", "Straight hand"]] as const).map(([key, pausedKey, label]) =>
          <div key={key} className={styles.gestureSetting}>
          <label className={styles.setting}><span className={styles.settingLabel}>{label}</span>
            <select aria-label={label} value={draft[key]} onChange={event => change(key, event.target.value as HandGestureAction)}>
              {actionOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className={styles.shortcutSwitch}><span>Use while paused</span>
            <input type="checkbox" role="switch" aria-label={`Use ${label} while paused`} checked={draft[pausedKey]}
              disabled={draft[key] === "disabled" || (draft[key].startsWith("scroll_") && !draft.scroll_enabled)}
              onChange={event => change(pausedKey, event.target.checked)} />
          </label>
          </div>)}
        <Slider label="Gesture hold to confirm" value={draft.gesture_confirm_ms} min={100} max={600} step={25} display={seconds(draft.gesture_confirm_ms)}
          hint="Applies to voice and scrolling. Longer holds reduce accidental triggers." onChange={value => change("gesture_confirm_ms", value)} />
        <Slider label="Fist hold to start" value={draft.fist_start_hold_ms} min={1000} max={5000} step={250} display={seconds(draft.fist_start_hold_ms)} onChange={value => change("fist_start_hold_ms", value)} />
        <Slider label="Fist hold to pause" value={draft.fist_pause_hold_ms} min={400} max={2000} step={50} display={seconds(draft.fist_pause_hold_ms)} onChange={value => change("fist_pause_hold_ms", value)} />
        {check("scroll_enabled", "Enable scroll gestures")}
        <Slider label="Scroll speed" value={draft.scroll_rate} min={60} max={2400} step={60} display={`${Number((draft.scroll_rate / 120).toFixed(1))} steps/s`}
          disabled={!draft.scroll_enabled} onChange={value => change("scroll_rate", value)} />
      </details>

      <details className={styles.settingsGroup}>
        <summary>CAD rotation &amp; zoom <ChevronDown size={15} /></summary>
        <p className={styles.settingsHint}>Automatic over supported CAD views. Voice and the fist remain available; CAD navigation takes priority over clicking and scrolling.</p>
        {check("cad_rotate", "Rotate by turning your hand")}
        <Slider label="Rotation sensitivity" value={draft.orbit_gain} min={20} max={1000} step={20} display={`${(draft.orbit_gain / 240).toFixed(1)}×`}
          disabled={!draft.cad_rotate} onChange={value => change("orbit_gain", value)} />
        {check("cad_zoom", "Zoom by opening / closing a pinch")}
        <Slider label="Zoom sensitivity" value={draft.zoom_gain} min={1} max={30} step={1} display={`${(draft.zoom_gain / 8).toFixed(1)}×`}
          disabled={!draft.cad_zoom} onChange={value => change("zoom_gain", value)} />
        {check("invert_zoom", "Reverse zoom direction")}
      </details>
    </fieldset>
    <div className={styles.settingsActions}>
      <p>{dirty ? "Unsaved changes" : "Your settings are saved on this computer."}</p>
      <div className={styles.buttons}>
        <button type="button" disabled={busy} onClick={() => { setDraft({ ...defaults }); setNotice(""); setFailed(false); }}><RotateCcw size={14} /> Reset defaults</button>
        <button type="submit" className={styles.primary} disabled={busy || !dirty}><Save size={14} /> Apply changes</button>
      </div>
      <small>Applying changes pauses the pointer. Gestures with Use while paused stay available while the camera is on.</small>
      {notice && <p className={failed ? styles.settingsError : styles.settingsSaved} role={failed ? "alert" : "status"}>{notice}</p>}
    </div>
  </form>;
}
