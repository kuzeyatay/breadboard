// The vocabulary of teaching a workflow by demonstration.
//
// Two representations live here and the distinction between them is the whole
// idea. A *demonstration* is evidence: what the user's hands and voice actually
// did, with timestamps and pixel coordinates. A *procedure* is what Breadboard
// learned from it: a generalized, re-groundable description of the task. Replay
// executes the procedure. The demonstration only ever explains it.
//
// Nothing in this file imports server code, so the review screen and the
// workflow detail page can share these shapes with the service.

/* ------------------------------------------------------------------ *
 * Demonstration evidence
 * ------------------------------------------------------------------ */

export type DemonstrationEventType =
  | "recording_started"
  | "recording_stopped"
  | "recording_paused"
  | "recording_resumed"
  | "window_focused"
  | "app_switch"
  | "mouse_click"
  | "mouse_double_click"
  | "mouse_right_click"
  | "mouse_middle_click"
  | "scroll"
  | "text_input"
  | "key_press"
  | "shortcut"
  | "visual_state";

/** A control as the operating system's accessibility layer describes it. */
export interface DemonstrationElement {
  name?: string;
  role?: string;
  automationId?: string;
  className?: string;
  value?: string;
  isPassword?: boolean;
  enabled?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/**
 * One thing the user did.
 *
 * `x`/`y` are recorded because they are evidence about which control was meant,
 * not because a replay will ever move the pointer there: a coordinate from a
 * demonstration describes one screen at one moment, and the whole point of the
 * feature is that the next run happens on a different one.
 */
export interface DemonstrationEvent {
  id: string;
  type: DemonstrationEventType;
  timestampMs: number;
  /** Milliseconds since the recording started. The shared clock everything joins on. */
  offsetMs: number;
  source?: string;
  activeApplication?: string;
  activeWindowTitle?: string;
  /** How the accessibility layer named the thing acted on, in words. */
  target?: string;
  detail?: string;
  importance: "low" | "medium" | "high";
  coordinates?: { x: number; y: number };
  screenDimensions?: { width: number; height: number };
  keyCode?: number;
  modifiers?: string[];
  /** Relative path of a keyframe inside the session directory. */
  visualContextRef?: string;
  /** True when the captured text was withheld because the field held a secret. */
  redacted?: boolean;
  element?: DemonstrationElement;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface TranscriptWord {
  startMs: number;
  endMs: number;
  text: string;
}

export interface DemonstrationTranscript {
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
  language?: string;
  model?: string;
  /** Where the audio clock sits on the recording clock. Usually a few hundred ms. */
  audioStartOffsetMs: number;
  durationMs?: number;
}

export interface VisualObservation {
  /** Relative path inside the session directory. */
  path: string;
  offsetMs: number;
  kind: "action" | "settled" | "context";
  activeApplication?: string;
  activeWindowTitle?: string;
}

/**
 * Actions and narration on one clock.
 *
 * `narration` on an event is the sentence the user was speaking while doing it,
 * which is the whole reason voice is here: "this changes every week" said over a
 * typed value is the difference between a constant and a parameter.
 */
export interface TimelineEntry {
  offsetMs: number;
  event: DemonstrationEvent;
  narration: TranscriptSegment[];
}

export interface DemonstrationTimeline {
  startedAt: string;
  durationMs: number;
  events: DemonstrationEvent[];
  transcript: TranscriptSegment[];
  visualAnchors: VisualObservation[];
  /** Events joined to the narration that overlaps them. */
  entries: TimelineEntry[];
  /** Narration that did not land on any action -- often the goal or a rule. */
  unattachedNarration: TranscriptSegment[];
  screenDimensions?: { width: number; height: number };
}

/* ------------------------------------------------------------------ *
 * The learned procedure
 * ------------------------------------------------------------------ */

export type WorkflowInputType = "string" | "number" | "date" | "file" | "folder";

export interface WorkflowInput {
  name: string;
  label: string;
  type: WorkflowInputType;
  required: boolean;
  /** What the user used while demonstrating. Shown as a hint, never as a default. */
  demonstratedValue?: string;
  notes?: string;
}

/**
 * How a step should be carried out, safest and most deterministic first.
 *
 * A route is a preference, not a promise: the point of naming a shell or
 * connector route is to avoid simulating a mouse when Breadboard already has a
 * first-party operation, but the demonstrated *semantics* still win. A step the
 * user narrated as "check the total before submitting" keeps its check whichever
 * route carries it.
 */
export type ExecutionRoute = "connector" | "browser" | "shell" | "gui";

export type StepAction =
  | "focus_window"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "wait"
  | "verify"
  | "run";

export interface WorkflowStep {
  id: string;
  /** Generalized, in the user's terms. May reference inputs as {{input_name}}. */
  instruction: string;
  action: StepAction;
  route: ExecutionRoute;
  fallbackRoutes: ExecutionRoute[];
  /** The application this step happens in, when the demonstration made that clear. */
  app?: string;
  windowHint?: string;
  /** What to act on, described so it can be found again: 'button labeled "Search"'. */
  target?: string;
  /** Action arguments; values may reference {{input_name}}. */
  actionArgs?: Record<string, string>;
  precondition?: string;
  /** What should be true once the step has worked. */
  expectation?: string;
  optional?: boolean;
  approvalRequired?: boolean;
  approvalReason?: string;
  uncertain?: boolean;
  evidence?: {
    eventIds?: string[];
    narration?: string[];
    frames?: string[];
  };
}

export interface WorkflowConstraint {
  text: string;
  kind: "always" | "never" | "note";
  source: "narration" | "inference";
}

export interface WorkflowApprovalBoundary {
  stepId: string;
  reason: string;
  source: "narration" | "policy";
}

export interface WorkflowAssertion {
  text: string;
}

export interface WorkflowAmbiguityOption {
  id: string;
  label: string;
  recommended?: boolean;
}

/**
 * Something the demonstration did not settle.
 *
 * Surfaced rather than guessed: picking the first search result once is not the
 * same as saying the workflow should always pick the first one, and quietly
 * turning one into the other is how a learned workflow becomes wrong in a way
 * nobody can see.
 */
export interface WorkflowAmbiguity {
  id: string;
  question: string;
  options: WorkflowAmbiguityOption[];
  /** Set once the user answers on the review screen. */
  resolution?: string;
  affectsStepIds?: string[];
}

export interface DemonstratedProcedure {
  name: string;
  goal: string;
  description: string;
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
  constraints: WorkflowConstraint[];
  approvals: WorkflowApprovalBoundary[];
  successCriteria: WorkflowAssertion[];
  failureCriteria: WorkflowAssertion[];
  recovery: string[];
  ambiguities: WorkflowAmbiguity[];
  confidence: "low" | "medium" | "high";
  sourceDemonstration: {
    sessionId: string;
    recordedAt: string;
    durationMs: number;
    transcriptAvailable: boolean;
    framesAvailable: boolean;
    videoAvailable: boolean;
    eventCount: number;
  };
  /**
   * Where the executable form was written. An implementation detail of this
   * workflow -- never an entry in the user's skill catalog.
   */
  compiled?: {
    type: "understudy-skill";
    directory: string;
    files: string[];
  };
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export type TeachSessionState =
  | "idle"
  | "preparing"
  | "recording"
  | "paused"
  | "processing"
  | "review"
  | "saved"
  | "cancelled"
  | "failed";

export type DemonstrationRunState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "stopped";

export interface TeachSessionSummary {
  id: string;
  workflowId: string | null;
  name: string;
  state: TeachSessionState;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  eventCount: number;
  transcriptAvailable: boolean;
  framesAvailable: boolean;
  error: string | null;
  /** Set while a re-teach is improving an existing workflow. */
  reteachOfWorkflowId: string | null;
}

export interface DemonstrationRunEvent {
  sequence: number;
  at: string;
  type:
    | "run.started"
    | "step.started"
    | "step.observed"
    | "step.grounded"
    | "step.acted"
    | "step.verified"
    | "step.skipped"
    | "step.failed"
    | "approval.requested"
    | "approval.granted"
    | "approval.rejected"
    | "run.completed"
    | "run.failed"
    | "run.stopped";
  stepId?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface DemonstrationRunView {
  runId: string;
  workflowId: string;
  state: DemonstrationRunState;
  startedAt: string;
  finishedAt: string | null;
  inputs: Record<string, string>;
  events: DemonstrationRunEvent[];
  pendingApproval: {
    stepId: string;
    instruction: string;
    reason: string;
    target?: string;
  } | null;
  error: string | null;
}

/* ------------------------------------------------------------------ *
 * Platform abstractions
 * ------------------------------------------------------------------ */

export interface CaptureOptions {
  sessionId: string;
  /** Absolute directory the backend owns for this session's raw artifacts. */
  outputDirectory: string;
  captureFrames: boolean;
  maxFrames: number;
  frameMaxWidth: number;
}

export interface CaptureSession {
  id: string;
  startedAtEpochMs: number;
  eventLogPath: string;
  framesDirectory: string | null;
  screenDimensions: { width: number; height: number } | null;
}

export interface CaptureArtifact {
  sessionId: string;
  eventLogPath: string;
  framesDirectory: string | null;
  startedAtEpochMs: number;
  stoppedAtEpochMs: number;
  durationMs: number;
  eventCount: number;
}

/**
 * What a platform must provide to support teaching.
 *
 * Understudy's own recorder is a macOS Swift script; Breadboard keeps that shape
 * (a child process writing an event log) but never lets the platform detail
 * reach the workflow domain. A platform with no implementation says so.
 */
export interface DemonstrationCaptureBackend {
  readonly platform: string;
  available(): { available: boolean; reason?: string };
  start(options: CaptureOptions): Promise<CaptureSession>;
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<CaptureArtifact>;
  cancel(sessionId: string): Promise<void>;
}

export interface ObservedElement {
  ref: string;
  name?: string;
  role?: string;
  automationId?: string;
  className?: string;
  value?: string;
  enabled?: boolean;
  isPassword?: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  describe: string;
}

export interface ComputerObservation {
  foreground: {
    app?: string;
    windowTitle?: string;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  };
  screen: { width: number; height: number };
  elements: ObservedElement[];
  windows?: Array<{ app?: string; windowTitle: string }>;
  screenshotPath?: string;
}

export type ComputerAction =
  | { kind: "click"; ref?: string; x?: number; y?: number; button?: "left" | "right" | "middle"; clicks?: number }
  | { kind: "type"; text: string; ref?: string; clear?: boolean }
  | { kind: "key"; key: string; modifiers?: string[] }
  | { kind: "scroll"; ref?: string; notches?: number }
  | { kind: "focus_window"; titleContains?: string; app?: string }
  | { kind: "screenshot"; path: string; maxWidth?: number };

export interface ActionResult {
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowComputerBackend {
  readonly platform: string;
  available(): { available: boolean; reason?: string };
  observe(options?: { screenshotPath?: string; maxElements?: number; includeAllWindows?: boolean }): Promise<ComputerObservation>;
  execute(action: ComputerAction): Promise<ActionResult>;
  stop(): Promise<void>;
}
