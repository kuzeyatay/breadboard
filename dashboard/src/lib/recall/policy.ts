// The rules Recall enforces, as pure functions.
//
// Kept free of the database, the filesystem and the network so the decisions
// that actually protect the user — what may be recorded, what may be read back,
// how much of it — can be tested directly rather than inferred from a route's
// behaviour.

/** What the agent may do with capture itself, as opposed to reading history. */
export const RECALL_CONTROL_MODES = ["ask", "allow", "never"] as const;
export type RecallControlMode = (typeof RECALL_CONTROL_MODES)[number];

export interface RecallSettings {
  /** Master switch. Off means the engine is never launched for this user. */
  captureEnabled: boolean;
  /**
   * Start capture as soon as Breadboard opens, instead of waiting for Start to
   * be pressed. Deliberately separate from captureEnabled: allowing capture and
   * choosing to record unattended are two different decisions, and this one has
   * to be asked for on its own.
   */
  autoStartCapture: boolean;
  /** Microphone capture. Screen capture is governed by captureEnabled. */
  captureAudio: boolean;
  /** Whether the agent may read the captured history at all. */
  agentAccess: boolean;
  /** Whether the agent may start or stop capture, and whether it must ask. */
  agentControl: RecallControlMode;
  /**
   * Windows the engine must never record. Matched case-insensitively as a
   * substring of the app or window title, `App::Title` to scope to one window.
   */
  excludedWindows: string[];
  /** How far back a search reaches when the caller names no time range. */
  defaultLookbackHours: number;
  /** Ceiling on results handed to the agent in one call. */
  maxResults: number;
}

/** Capture is opt-in: a user who has never opened the tab records nothing. */
export const DEFAULT_RECALL_SETTINGS: RecallSettings = {
  captureEnabled: false,
  autoStartCapture: false,
  captureAudio: true,
  agentAccess: true,
  agentControl: "ask",
  excludedWindows: [],
  defaultLookbackHours: 24,
  maxResults: 10,
};

export const MAX_EXCLUDED_WINDOWS = 100;
export const MAX_EXCLUDED_WINDOW_LENGTH = 200;
export const MAX_LOOKBACK_HOURS = 24 * 90;
export const MAX_RESULTS_CEILING = 50;

/** Control characters and quotes, stripped before an entry becomes an argv item. */
const UNSAFE_EXCLUSION_CHARS = /[\u0000-\u001f\u007f"']/g;

/**
 * Clean an exclusion list: strings only, trimmed, de-duplicated
 * case-insensitively, bounded in both length and count. An entry that survives
 * this is safe to hand to the engine as a command-line argument.
 */
export function normalizeExcludedWindows(value: unknown): string[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const cleaned = entry
      .replace(UNSAFE_EXCLUSION_CHARS, "")
      .trim()
      .slice(0, MAX_EXCLUDED_WINDOW_LENGTH);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_EXCLUDED_WINDOWS) break;
  }
  return result;
}

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

/**
 * Fold a partial patch onto a base. Unknown keys are ignored and every value is
 * clamped, so a hand-written PATCH body can never widen a limit past what the
 * UI offers.
 */
export function applyRecallSettingsPatch(
  base: RecallSettings,
  patch: Record<string, unknown>,
): RecallSettings {
  const controlRaw = patch.agentControl;
  const agentControl = RECALL_CONTROL_MODES.includes(controlRaw as RecallControlMode)
    ? (controlRaw as RecallControlMode)
    : base.agentControl;

  return {
    captureEnabled: boolOrDefault(patch.captureEnabled, base.captureEnabled),
    autoStartCapture: boolOrDefault(patch.autoStartCapture, base.autoStartCapture),
    captureAudio: boolOrDefault(patch.captureAudio, base.captureAudio),
    agentAccess: boolOrDefault(patch.agentAccess, base.agentAccess),
    agentControl,
    excludedWindows:
      patch.excludedWindows === undefined
        ? base.excludedWindows
        : normalizeExcludedWindows(patch.excludedWindows),
    defaultLookbackHours: boundedInt(
      patch.defaultLookbackHours,
      base.defaultLookbackHours,
      1,
      MAX_LOOKBACK_HOURS,
    ),
    maxResults: boundedInt(patch.maxResults, base.maxResults, 1, MAX_RESULTS_CEILING),
  };
}

/**
 * Why an unattended start did or did not happen. Every refusal names its own
 * reason so the one path that can begin recording without a click is never
 * silent about having declined — or about having gone ahead.
 */
export const RECALL_AUTO_START_OUTCOMES = [
  "start",
  "feature_disabled",
  "not_opted_in",
  "capture_disabled",
  "already_running",
  "not_installed",
] as const;
export type RecallAutoStartOutcome = (typeof RECALL_AUTO_START_OUTCOMES)[number];

/**
 * Should opening Breadboard start the recorder?
 *
 * Only "start" launches anything, and reaching it takes two separate opt-ins
 * from the user — capture allowed, and capture allowed to begin on its own.
 * Kept here, away from the process and the database, because this is the rule
 * that decides whether a screen gets recorded without anybody asking for it
 * just then.
 */
export function recallAutoStartDecision(input: {
  featureEnabled: boolean;
  settings: Pick<RecallSettings, "autoStartCapture" | "captureEnabled">;
  engineRunning: boolean;
  installed: boolean;
}): RecallAutoStartOutcome {
  if (!input.featureEnabled) return "feature_disabled";
  if (!input.settings.autoStartCapture) return "not_opted_in";
  if (!input.settings.captureEnabled) return "capture_disabled";
  // Checked before the install, because a running engine is proof of one and
  // a second recorder on the same port is the failure this ordering avoids.
  if (input.engineRunning) return "already_running";
  if (!input.installed) return "not_installed";
  return "start";
}

export interface CapturedRow {
  appName: string | null;
  windowName: string | null;
}

/**
 * Does a captured row fall under an exclusion? Mirrors the engine's matching:
 * case-insensitive substring, `App::Title` to scope one window of one app,
 * `::Title` for any app, `App::` for a whole app.
 */
export function matchesExcludedWindow(row: CapturedRow, pattern: string): boolean {
  const app = (row.appName ?? "").toLowerCase();
  const window = (row.windowName ?? "").toLowerCase();
  const raw = pattern.trim().toLowerCase();
  if (!raw) return false;

  if (raw.includes("::")) {
    const separator = raw.indexOf("::");
    const appPart = raw.slice(0, separator);
    const titlePart = raw.slice(separator + 2);
    if (appPart && !app.includes(appPart)) return false;
    if (!titlePart) return true; // `App::` blocks the whole app.
    return window.includes(titlePart);
  }
  return app.includes(raw) || window.includes(raw);
}

export function isExcluded(row: CapturedRow, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesExcludedWindow(row, pattern));
}

export function truncateCapturedText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export interface ShapedHit {
  kind: "screen" | "audio";
  timestamp: string | null;
  app: string | null;
  window: string | null;
  speaker: string | null;
  text: string;
  frameId: number | null;
}

export interface ShapedSearch {
  summary: string;
  hits: ShapedHit[];
  range: { start: string; end: string };
  truncated: boolean;
}

export interface RawHit extends CapturedRow {
  type: string;
  timestamp: string | null;
  text: string;
  frameId: number | null;
  speaker: string | null;
}

/**
 * Turn a page of engine rows into the answer a caller sees.
 *
 * Exclusions are applied here, to results, and not only when launching the
 * recorder: history captured before a window was excluded is still history the
 * user has since said they do not want read back. The count of what was hidden
 * is reported rather than swallowed, so an answer that looks thin is
 * explainable instead of merely wrong.
 */
export function shapeSearchResults(
  rows: readonly RawHit[],
  input: {
    excludedWindows: readonly string[];
    limit: number;
    maxTextChars: number;
    range: { start: string; end: string };
    /** The engine reported further rows past the page that was fetched. */
    hasMore: boolean;
  },
): ShapedSearch {
  const kept = rows.filter((row) => !isExcluded(row, input.excludedWindows));
  const visible = kept.slice(0, Math.max(input.limit, 0));
  const hidden = rows.length - kept.length;

  return {
    summary:
      visible.length === 0
        ? `No captured screen or audio matched between ${input.range.start} and ${input.range.end}.` +
          (hidden > 0 ? ` ${hidden} result${hidden === 1 ? " was" : "s were"} hidden by your exclusions.` : "")
        : `${visible.length} result${visible.length === 1 ? "" : "s"} between ` +
          `${input.range.start} and ${input.range.end}` +
          (hidden > 0 ? ` (${hidden} hidden by your exclusions)` : "") +
          ".",
    hits: visible.map((row) => ({
      kind: row.type.toLowerCase() === "audio" ? "audio" : "screen",
      timestamp: row.timestamp,
      app: row.appName,
      window: row.windowName,
      speaker: row.speaker,
      text: truncateCapturedText(row.text, input.maxTextChars),
      frameId: row.frameId,
    })),
    range: input.range,
    truncated: input.hasMore || kept.length > visible.length,
  };
}
