export type GestureControlAction = "state" | "start" | "pause" | "stop" | "save-settings";
export type HandGestureAction = "voice" | "scroll_up" | "scroll_down" | "disabled";

export interface GestureSettings {
  pointer_gain: number;
  smoothing: number;
  preferred_hand: "Auto" | "Left" | "Right";
  pinch_threshold: number;
  pinch_action: "left_click" | "right_click" | "disabled";
  drag_hold_ms: number;
  gesture_confirm_ms: number;
  fist_start_hold_ms: number;
  fist_pause_hold_ms: number;
  v_action: HandGestureAction;
  bent_action: HandGestureAction;
  straight_action: HandGestureAction;
  v_while_paused: boolean;
  bent_while_paused: boolean;
  straight_while_paused: boolean;
  scroll_enabled: boolean;
  scroll_rate: number;
  cad_rotate: boolean;
  cad_zoom: boolean;
  orbit_gain: number;
  zoom_gain: number;
  invert_zoom: boolean;
}

export const DEFAULT_GESTURE_SETTINGS: Readonly<GestureSettings> = Object.freeze({
  pointer_gain: 1, smoothing: 50, preferred_hand: "Auto", pinch_threshold: 0.32,
  pinch_action: "left_click", drag_hold_ms: 650, gesture_confirm_ms: 200,
  fist_start_hold_ms: 3000, fist_pause_hold_ms: 800, v_action: "voice",
  bent_action: "scroll_down", straight_action: "scroll_up", scroll_enabled: true,
  v_while_paused: false, bent_while_paused: false, straight_while_paused: false,
  scroll_rate: 480, cad_rotate: true, cad_zoom: true, orbit_gain: 240, zoom_gain: 8, invert_zoom: false,
});

export function isGestureSettings(value: unknown): value is GestureSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).length !== Object.keys(DEFAULT_GESTURE_SETTINGS).length ||
      Object.keys(settings).some(key => !(key in DEFAULT_GESTURE_SETTINGS))) return false;
  const ranges = { pointer_gain: [0.4, 2.5], smoothing: [0, 100], pinch_threshold: [0.18, 0.4],
    drag_hold_ms: [200, 1500], gesture_confirm_ms: [100, 600], fist_start_hold_ms: [1000, 5000],
    fist_pause_hold_ms: [400, 2000], scroll_rate: [60, 2400], orbit_gain: [20, 1000], zoom_gain: [1, 30] };
  for (const [key, [low, high]] of Object.entries(ranges)) {
    if (typeof settings[key] !== "number" || !Number.isFinite(settings[key]) ||
        settings[key] < low! || settings[key] > high!) return false;
  }
  return typeof settings.preferred_hand === "string" && ["Auto", "Left", "Right"].includes(settings.preferred_hand) &&
    typeof settings.pinch_action === "string" && ["left_click", "right_click", "disabled"].includes(settings.pinch_action) &&
    ["v_action", "bent_action", "straight_action"].every(key =>
      typeof settings[key] === "string" && ["voice", "scroll_up", "scroll_down", "disabled"].includes(settings[key])) &&
    ["scroll_enabled", "cad_rotate", "cad_zoom", "invert_zoom", "v_while_paused", "bent_while_paused", "straight_while_paused"]
      .every(key => typeof settings[key] === "boolean");
}

export function gestureSettingsFromConfig(config: Record<string, unknown>): GestureSettings {
  const result = { ...DEFAULT_GESTURE_SETTINGS } as Record<string, unknown>;
  for (const key of Object.keys(result)) if (config[key] !== undefined && config[key] !== null) result[key] = config[key];
  if (config.smoothing == null && typeof config.min_cutoff === "number") {
    result.smoothing = Math.round(Math.max(0, Math.min(100, (2.25 - config.min_cutoff) / 0.02)));
  }
  if (!isGestureSettings(result)) throw new Error("Saved gesture settings are invalid.");
  return result;
}

export interface GestureControlState {
  available: boolean;
  phase: "stopped" | "initializing" | "running" | "error";
  paused: boolean;
  status: string;
  detail: string;
  display: string;
  /** JPEG base64; never persisted or sent outside this computer. */
  image: string | null;
  error?: string;
  settings?: GestureSettings;
  settingsDefaults?: Readonly<GestureSettings>;
  settingsRevision?: string;
  settingsError?: string;
}

export function isGestureControlAction(value: unknown): value is GestureControlAction {
  return value === "state" || value === "start" || value === "pause" || value === "stop" || value === "save-settings";
}

export function isGestureControlPage(url: string, dashboardUrl: string | null): boolean {
  if (!dashboardUrl) return false;
  try {
    const page = new URL(url);
    return page.origin === new URL(dashboardUrl).origin && page.pathname.replace(/\/$/, "") === "/gestures";
  } catch { return false; }
}
