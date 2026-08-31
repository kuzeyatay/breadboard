// Putting the demonstration back together on one clock.
//
// The capture backend writes actions as they happen; the microphone is recorded
// in the browser and transcribed afterwards. Neither is useful alone. What the
// induction stage reads is the join: the sentence the user was saying while
// they did each thing.
//
// Everything here is pure. It takes recorded lines and a transcript and returns
// a timeline, which is what makes the association rules testable without a
// screen, a microphone or a model.

import type {
  DemonstrationEvent,
  DemonstrationEventType,
  DemonstrationTimeline,
  TimelineEntry,
  TranscriptSegment,
  VisualObservation,
} from "./types.ts";

/**
 * How far narration may sit from the action it explains.
 *
 * People say what they are about to do more often than what they just did, so
 * the window ahead of a sentence is the wider one. Both are generous: the cost
 * of attaching one sentence too many is a slightly noisier prompt, and the cost
 * of missing one is losing the only statement of why a step exists.
 */
export const NARRATION_LEAD_MS = 5_000;
export const NARRATION_LAG_MS = 3_000;

const EVENT_TYPES = new Set<string>([
  "recording_started",
  "recording_stopped",
  "recording_paused",
  "recording_resumed",
  "window_focused",
  "app_switch",
  "mouse_click",
  "mouse_double_click",
  "mouse_right_click",
  "mouse_middle_click",
  "scroll",
  "text_input",
  "key_press",
  "shortcut",
  "visual_state",
]);

const HIGH_IMPORTANCE = new Set<string>([
  "mouse_click",
  "mouse_double_click",
  "mouse_right_click",
  "text_input",
  "shortcut",
  "app_switch",
]);

const LOW_IMPORTANCE = new Set<string>(["visual_state", "scroll"]);

/**
 * Window titles that mean "the user was operating the recorder, not the task".
 *
 * Starting and finishing a demonstration happens inside Breadboard, so the first
 * and last actions of every recording are about Breadboard's own controls. Left
 * in, they teach the workflow to click Finish.
 */
const TEACH_CONTROL_MARKERS = [
  "teach workflow",
  "teaching session",
  "breadboard — workflows",
  "breadboard - workflows",
];

export function isTeachControlNoise(
  event: Pick<DemonstrationEvent, "activeWindowTitle" | "target" | "detail">,
  hostApplications: readonly string[] = [],
): boolean {
  const haystack = [event.activeWindowTitle, event.target, event.detail]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!haystack) return false;
  if (TEACH_CONTROL_MARKERS.some((marker) => haystack.includes(marker))) return true;
  return hostApplications.some((app) => app.length > 0 && haystack.includes(app.toLowerCase()));
}

interface RawRecordedEvent {
  type?: unknown;
  timestampMs?: unknown;
  source?: unknown;
  app?: unknown;
  windowTitle?: unknown;
  target?: unknown;
  detail?: unknown;
  importance?: unknown;
  x?: unknown;
  y?: unknown;
  screenWidth?: unknown;
  screenHeight?: unknown;
  keyCode?: unknown;
  modifiers?: unknown;
  visualContextRef?: unknown;
  redacted?: unknown;
  element?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function importanceFor(type: string, declared: unknown): DemonstrationEvent["importance"] {
  if (declared === "high" || declared === "medium" || declared === "low") return declared;
  if (HIGH_IMPORTANCE.has(type)) return "high";
  if (LOW_IMPORTANCE.has(type)) return "low";
  return "medium";
}

/**
 * Turn the capture backend's JSONL into events on the recording's own clock.
 *
 * A malformed line costs one event, never the recording: a recorder that was
 * killed mid-write leaves a half-line, and that is a normal way for a file that
 * is appended to under a global input hook to end.
 */
export function parseRecordedEvents(
  contents: string,
  startedAtEpochMs: number,
): DemonstrationEvent[] {
  const events: DemonstrationEvent[] = [];
  let index = 0;
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: RawRecordedEvent;
    try {
      raw = JSON.parse(trimmed) as RawRecordedEvent;
    } catch {
      continue;
    }
    const type = asString(raw.type);
    const timestampMs = asNumber(raw.timestampMs);
    if (!type || !EVENT_TYPES.has(type) || timestampMs === undefined) continue;

    index += 1;
    const x = asNumber(raw.x);
    const y = asNumber(raw.y);
    const screenWidth = asNumber(raw.screenWidth);
    const screenHeight = asNumber(raw.screenHeight);
    const modifiers = Array.isArray(raw.modifiers)
      ? raw.modifiers.filter((value): value is string => typeof value === "string")
      : undefined;
    const element =
      raw.element && typeof raw.element === "object" && !Array.isArray(raw.element)
        ? (raw.element as DemonstrationEvent["element"])
        : undefined;

    events.push({
      id: `event-${index}`,
      type: type as DemonstrationEventType,
      timestampMs,
      offsetMs: Math.max(0, Math.round(timestampMs - startedAtEpochMs)),
      source: asString(raw.source),
      activeApplication: asString(raw.app),
      activeWindowTitle: asString(raw.windowTitle),
      target: asString(raw.target),
      detail: typeof raw.detail === "string" ? raw.detail : undefined,
      importance: importanceFor(type, raw.importance),
      ...(x !== undefined && y !== undefined ? { coordinates: { x, y } } : {}),
      ...(screenWidth !== undefined && screenHeight !== undefined
        ? { screenDimensions: { width: screenWidth, height: screenHeight } }
        : {}),
      ...(asNumber(raw.keyCode) !== undefined ? { keyCode: asNumber(raw.keyCode) } : {}),
      ...(modifiers && modifiers.length > 0 ? { modifiers } : {}),
      ...(asString(raw.visualContextRef) ? { visualContextRef: asString(raw.visualContextRef) } : {}),
      ...(raw.redacted === true ? { redacted: true } : {}),
      ...(element ? { element } : {}),
    });
  }
  // Typing is emitted when a burst ends, so it lands after events that happened
  // later on the wall clock. Sorting is what makes the log a timeline.
  events.sort((left, right) => left.offsetMs - right.offsetMs);
  return events;
}

/**
 * Narration that belongs to one action.
 *
 * Overlap is deliberately many-to-many. "I always check the total before
 * submitting" is about the check and the submit both, and forcing it onto one of
 * them loses the relationship the sentence exists to state.
 */
export function narrationForEvent(
  event: Pick<DemonstrationEvent, "offsetMs">,
  transcript: readonly TranscriptSegment[],
): TranscriptSegment[] {
  const matches: TranscriptSegment[] = [];
  for (const segment of transcript) {
    if (
      event.offsetMs >= segment.startMs - NARRATION_LAG_MS &&
      event.offsetMs <= segment.endMs + NARRATION_LEAD_MS
    ) {
      matches.push(segment);
    }
  }
  return matches;
}

export interface BuildTimelineInput {
  startedAt: string;
  durationMs: number;
  events: readonly DemonstrationEvent[];
  transcript: readonly TranscriptSegment[];
  /** Shifts the transcript onto the recording clock; the audio starts a moment later. */
  audioStartOffsetMs?: number;
  visualAnchors?: readonly VisualObservation[];
  screenDimensions?: { width: number; height: number };
  /** Applications whose windows are the recorder's own UI, not the task. */
  hostApplications?: readonly string[];
}

export function buildDemonstrationTimeline(input: BuildTimelineInput): DemonstrationTimeline {
  const offset = input.audioStartOffsetMs ?? 0;
  const transcript: TranscriptSegment[] = input.transcript
    .map((segment) => ({
      ...segment,
      startMs: Math.max(0, Math.round(segment.startMs + offset)),
      endMs: Math.max(0, Math.round(segment.endMs + offset)),
    }))
    .sort((left, right) => left.startMs - right.startMs);

  const events = input.events
    .filter((event) => !isTeachControlNoise(event, input.hostApplications ?? []))
    .slice()
    .sort((left, right) => left.offsetMs - right.offsetMs);

  const attached = new Set<TranscriptSegment>();
  const entries: TimelineEntry[] = events.map((event) => {
    const narration = narrationForEvent(event, transcript);
    for (const segment of narration) attached.add(segment);
    return { offsetMs: event.offsetMs, event, narration };
  });

  const visualAnchors: VisualObservation[] =
    input.visualAnchors !== undefined
      ? [...input.visualAnchors]
      : events
          .filter((event) => typeof event.visualContextRef === "string")
          .map((event) => ({
            path: event.visualContextRef as string,
            offsetMs: event.offsetMs,
            kind:
              event.type === "visual_state"
                ? ("settled" as const)
                : event.type === "app_switch"
                  ? ("context" as const)
                  : ("action" as const),
            activeApplication: event.activeApplication,
            activeWindowTitle: event.activeWindowTitle,
          }));

  const screenDimensions =
    input.screenDimensions ?? events.find((event) => event.screenDimensions)?.screenDimensions;

  return {
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    events,
    transcript,
    visualAnchors,
    entries,
    unattachedNarration: transcript.filter((segment) => !attached.has(segment)),
    ...(screenDimensions ? { screenDimensions } : {}),
  };
}

function formatOffset(offsetMs: number): string {
  const totalSeconds = Math.max(0, Math.round(offsetMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The timeline as the induction model reads it.
 *
 * Coordinates are deliberately absent. They are kept in the stored evidence
 * because they explain which control was meant, but handing them to the model
 * invites it to write them into the procedure, and a procedure with a coordinate
 * in it is a macro.
 */
export function renderTimelineForPrompt(
  timeline: DemonstrationTimeline,
  options: { maxEntries?: number } = {},
): string[] {
  const maxEntries = options.maxEntries ?? 120;
  const meaningful = timeline.entries.filter(
    (entry) => entry.event.importance !== "low" || entry.narration.length > 0,
  );
  const selected = meaningful.length > maxEntries ? condense(meaningful, maxEntries) : meaningful;

  const lines: string[] = [];
  for (const entry of selected) {
    const event = entry.event;
    const parts: string[] = [`${formatOffset(entry.offsetMs)}  ACTION: ${describeEvent(event)}`];
    if (event.activeApplication || event.activeWindowTitle) {
      parts.push(
        `           WHERE: ${[event.activeApplication, event.activeWindowTitle]
          .filter(Boolean)
          .join(" — ")}`,
      );
    }
    for (const segment of entry.narration) {
      parts.push(`           VOICE: "${segment.text.trim()}"`);
    }
    lines.push(parts.join("\n"));
  }

  if (timeline.unattachedNarration.length > 0) {
    lines.push("");
    lines.push("Narration that did not land on any single action:");
    for (const segment of timeline.unattachedNarration.slice(0, 40)) {
      lines.push(`${formatOffset(segment.startMs)}  VOICE: "${segment.text.trim()}"`);
    }
  }
  return lines;
}

/** Keep every high-importance action and thin the rest, preserving order. */
function condense(entries: TimelineEntry[], budget: number): TimelineEntry[] {
  const high = entries.filter((entry) => entry.event.importance === "high");
  if (high.length >= budget) {
    const stride = high.length / budget;
    const kept: TimelineEntry[] = [];
    for (let index = 0; index < budget; index += 1) kept.push(high[Math.floor(index * stride)]);
    return kept;
  }
  const remaining = budget - high.length;
  const others = entries.filter((entry) => entry.event.importance !== "high");
  const stride = others.length > remaining ? others.length / remaining : 1;
  const thinned: TimelineEntry[] = [];
  for (let index = 0; index < others.length; index += Math.max(1, Math.floor(stride))) {
    thinned.push(others[index]);
    if (thinned.length >= remaining) break;
  }
  return [...high, ...thinned].sort((left, right) => left.offsetMs - right.offsetMs);
}

export function describeEvent(event: DemonstrationEvent): string {
  switch (event.type) {
    case "mouse_click":
      return `click ${event.target ?? "an unidentified control"}`;
    case "mouse_double_click":
      return `double-click ${event.target ?? "an unidentified control"}`;
    case "mouse_right_click":
      return `right-click ${event.target ?? "an unidentified control"}`;
    case "mouse_middle_click":
      return `middle-click ${event.target ?? "an unidentified control"}`;
    case "text_input":
      return event.redacted
        ? `type a secret value into ${event.target ?? "a field"} (contents withheld)`
        : `type ${JSON.stringify(event.detail ?? "")} into ${event.target ?? "the focused field"}`;
    case "key_press":
      return `press ${event.detail ?? "a key"}`;
    case "shortcut":
      return `press ${event.detail ?? "a shortcut"}`;
    case "scroll":
      return `${event.detail ?? "scroll"} in ${event.target ?? "the window"}`;
    case "app_switch":
      return `switch to ${event.activeApplication ?? "another application"}`;
    case "window_focused":
      return `focus the window "${event.activeWindowTitle ?? "untitled"}"`;
    case "visual_state":
      return "observe the resulting screen";
    case "recording_started":
      return "begin the demonstration";
    case "recording_stopped":
      return "end the demonstration";
    case "recording_paused":
      return "pause the demonstration";
    case "recording_resumed":
      return "resume the demonstration";
    default:
      return event.type;
  }
}
