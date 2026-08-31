import "server-only";

// Turning a demonstration into a procedure.
//
// This is Breadboard's adaptation of Understudy's teach analyzer. The upstream
// version reads a screen recording and an event log; this one reads the same
// event log joined to the user's narration, which is the addition that matters.
// A demonstration shows *what* someone did. Only the voice track says which
// values were incidental, which checks were deliberate, and which click should
// never happen without being asked first.
//
// The rules encoded in the prompt are the ones that keep the output a procedure
// rather than a macro:
//
//   - never emit a coordinate; describe the target in words
//   - a value the user narrated as changing becomes an input, not a constant
//   - a stated rule becomes a constraint; a stated pause becomes an approval
//   - an ambiguity becomes a question for the review screen, not a guess
//
// Parsing is separate from calling, so the normalisation can be tested without a
// model.

import fs from "node:fs";
import path from "node:path";

import { ensureApprovalBoundaries } from "./approvals.ts";
import { callModel, extractJsonObject, type ModelContentPart, type ModelMessage } from "./model.ts";
import { renderTimelineForPrompt } from "./timeline.ts";
import { teachLog } from "./redaction.ts";
import type {
  DemonstratedProcedure,
  DemonstrationTimeline,
  ExecutionRoute,
  StepAction,
  WorkflowAmbiguity,
  WorkflowConstraint,
  WorkflowInput,
  WorkflowInputType,
  WorkflowStep,
} from "./types.ts";

const MAX_KEYFRAMES_IN_PROMPT = 10;
const MAX_KEYFRAME_BYTES = 1_400_000;

const ROUTES: ReadonlySet<string> = new Set(["connector", "browser", "shell", "gui"]);
const ACTIONS: ReadonlySet<string> = new Set([
  "focus_window",
  "click",
  "type",
  "key",
  "scroll",
  "wait",
  "verify",
  "run",
]);
const INPUT_TYPES: ReadonlySet<string> = new Set(["string", "number", "date", "file", "folder"]);

const SYSTEM_PROMPT = [
  "You turn a recorded demonstration into a reusable workflow for Breadboard.",
  "",
  "You are given one demonstration: the actions the user performed, the application and window each happened in, how the operating system's accessibility layer named the control they acted on, and — joined on the same clock — what the user was saying aloud at that moment.",
  "",
  "Your output is a PROCEDURE, not a recording. The difference is the entire task:",
  "- A recording says 'click at 441,281'. A procedure says 'click the button labeled \"Search\"'.",
  "- A recording says 'type Alice'. A procedure says 'type the customer name supplied at run time'.",
  "- A recording replays. A procedure is carried out again, against a screen that has changed.",
  "",
  "NEVER emit pixel coordinates, screen sizes, or window positions in any field. They were evidence about which control was meant; they are not instructions.",
  "NEVER write a rule that only makes sense for the specific application, website, file name, or person in this demonstration unless that thing genuinely is the task. Do not special-case a window title or a button position.",
  "",
  "The narration is the user explaining their own intent, and you should weight it heavily for:",
  "- why an action is being taken",
  "- which values change between runs (these become inputs)",
  "- invariants and checks that must hold",
  "- exceptions and decision rules",
  "- things the workflow must never do",
  "- what 'finished' means",
  "- where the workflow must stop and ask before continuing",
  "",
  "If the narration says a value 'changes every time', 'is different each time', 'depends on', or similar, that value is an input — not a constant. Give the input a clear snake_case name, and reference it in later steps as {{input_name}} rather than repeating the demonstrated literal.",
  "If the narration says to always check, verify, or confirm something before an action, express that as a precondition on the step and, when it gates a consequential action, as an approval.",
  "If the narration says to ask, confirm, or wait for the user before an action, set approvalRequired on that step.",
  "",
  "If the narration contradicts what the actions plainly show, do NOT silently follow either one. Follow the actions, and record the conflict in openQuestions so a person can settle it.",
  "",
  "Prefer the safest, most deterministic route that preserves what the demonstration actually did. Use route 'gui' when the work genuinely needs the on-screen application, 'browser' for web pages, 'shell' for file and system operations, 'connector' when a first-party Breadboard operation would do the same thing. But do not replace a demonstrated visual check with a blind call: if the user looked at a value before committing, the procedure still looks at it.",
  "",
  "Where the demonstration is genuinely ambiguous, ask instead of guessing. Selecting the first row once does not establish 'always take the first row'; it might mean 'take the row matching the customer'. Put that in openQuestions with concrete options.",
  "Do not manufacture questions for things the demonstration settled. A question the evidence already answers is noise.",
  "",
  "Return strict JSON and nothing else.",
].join("\n");

const OUTPUT_SCHEMA = [
  "Schema:",
  "{",
  '  "name": "short imperative workflow name",',
  '  "goal": "one sentence: what this workflow accomplishes",',
  '  "description": "two or three sentences a person reads to decide whether to run it",',
  '  "confidence": "low|medium|high",',
  '  "inputs": [{"name":"snake_case","label":"Human label","type":"string|number|date|file|folder","required":true,"demonstratedValue":"what was used in the demo","notes":"why it varies"}],',
  '  "steps": [{',
  '    "instruction": "generalized, referencing {{input_name}} where a value varies",',
  '    "action": "focus_window|click|type|key|scroll|wait|verify|run",',
  '    "route": "connector|browser|shell|gui",',
  '    "fallbackRoutes": ["gui"],',
  '    "app": "application the step happens in",',
  '    "windowHint": "distinguishing part of the window title, if one is needed",',
  '    "target": "the control in words, quoting its visible text: button labeled \\"Search\\"",',
  '    "actionArgs": {"text":"{{input_name}}","key":"Enter","notches":"-3","command":"..."},',
  '    "precondition": "what must be true before this step runs",',
  '    "expectation": "what should be visibly true once it has worked",',
  '    "optional": false,',
  '    "approvalRequired": false,',
  '    "approvalReason": "why this needs a person",',
  '    "uncertain": false',
  "  }],",
  '  "constraints": [{"text":"...","kind":"always|never|note","source":"narration|inference"}],',
  '  "successCriteria": ["what must be true for the run to have succeeded"],',
  '  "failureCriteria": ["what means it went wrong"],',
  '  "recovery": ["what to try when a step does not ground, when it is safe to try it"],',
  '  "openQuestions": [{"question":"...","options":[{"label":"...","recommended":true},{"label":"..."}],"affectsSteps":[2]}]',
  "}",
  "",
  "Rules for steps:",
  "- Quote visible text in target: 'button labeled \"Search\"', 'the row containing \"invoice.pdf\"', 'text field labeled \"Customer name\"'. Generic descriptions like 'the search button' ground badly.",
  "- Include the control's role (button, link, checkbox, tab, menu item, text field, list item).",
  "- Use action 'type' with actionArgs.text for entering a value; reference inputs as {{input_name}}.",
  "- Use action 'key' with actionArgs.key for Enter, Tab, Escape and the like.",
  "- Use action 'verify' with an expectation for a step whose whole purpose is to check something.",
  "- Use action 'focus_window' with app/windowHint when the workflow must move to another application.",
  "- Drop recording-control noise: starting and finishing the demonstration inside Breadboard is not part of the task.",
  "- Collapse a burst of keystrokes into one 'type' step. Collapse repeated scrolling into one step.",
  "- A step whose captured text was withheld because it was a secret field must become an input of type string with a note that it is a credential, never a literal.",
].join("\n");

export interface InductionRequest {
  timeline: DemonstrationTimeline;
  sessionId: string;
  /** Where the frames referenced by the timeline live. */
  frameRoot?: string;
  nameHint?: string;
  objectiveHint?: string;
  /** Windows currently open, so the model can name applications the way the OS does. */
  includeKeyframes?: boolean;
  signal?: AbortSignal;
}

/** Attach a handful of keyframes so the model can see what the actions produced. */
function keyframeParts(request: InductionRequest): ModelContentPart[] {
  if (!request.includeKeyframes || !request.frameRoot) return [];
  const anchors = request.timeline.visualAnchors;
  if (anchors.length === 0) return [];

  // Spread the budget across the recording rather than spending it all at the
  // start: what a workflow finished doing is usually the most informative frame.
  const stride = Math.max(1, Math.floor(anchors.length / MAX_KEYFRAMES_IN_PROMPT));
  const chosen = anchors.filter((_, index) => index % stride === 0).slice(0, MAX_KEYFRAMES_IN_PROMPT);

  const parts: ModelContentPart[] = [];
  let budget = MAX_KEYFRAME_BYTES;
  for (const anchor of chosen) {
    const absolute = path.resolve(request.frameRoot, anchor.path);
    const relative = path.relative(path.resolve(request.frameRoot), absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(absolute);
    } catch {
      continue;
    }
    if (bytes.byteLength > budget) continue;
    budget -= bytes.byteLength;
    parts.push({
      type: "text",
      text: `Keyframe at ${Math.round(anchor.offsetMs / 1000)}s (${anchor.kind})`,
    });
    parts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` },
    });
  }
  return parts;
}

export function buildInductionPrompt(request: InductionRequest): string {
  const timeline = request.timeline;
  const applications = [
    ...new Set(
      timeline.events
        .map((event) => event.activeApplication)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const secretFields = timeline.events.filter((event) => event.redacted).length;

  return [
    "Demonstration record",
    `Duration: ${Math.round(timeline.durationMs / 1000)}s`,
    `Actions captured: ${timeline.events.length}`,
    `Narration segments: ${timeline.transcript.length}`,
    `Applications involved: ${applications.length > 0 ? applications.join(", ") : "unknown"}`,
    ...(secretFields > 0
      ? [
          `${secretFields} entry into a password or secret field was captured with its contents withheld. Treat each as a credential input, never as a literal.`,
        ]
      : []),
    ...(request.nameHint ? [`The user named this workflow: ${request.nameHint}`] : []),
    ...(request.objectiveHint ? [`The user described the goal as: ${request.objectiveHint}`] : []),
    "",
    timeline.transcript.length === 0
      ? "No narration was transcribed for this demonstration, so intent has to be inferred from the actions alone. Be correspondingly more willing to record open questions."
      : "ACTION and VOICE lines below share one clock. A VOICE line under an ACTION is what the user was saying around the moment they did it.",
    "",
    ...renderTimelineForPrompt(timeline),
    "",
    OUTPUT_SCHEMA,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function stringList(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, limit);
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function normalizeInputs(value: unknown): WorkflowInput[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const inputs: WorkflowInput[] = [];
  for (const raw of value.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const name = slug(text(record.name), `input_${inputs.length + 1}`);
    if (seen.has(name)) continue;
    seen.add(name);
    const type = text(record.type, "string");
    inputs.push({
      name,
      label: text(record.label) || name.replace(/_/gu, " ").replace(/^\w/u, (c) => c.toUpperCase()),
      type: (INPUT_TYPES.has(type) ? type : "string") as WorkflowInputType,
      required: record.required !== false,
      ...(text(record.demonstratedValue) ? { demonstratedValue: text(record.demonstratedValue) } : {}),
      ...(text(record.notes) ? { notes: text(record.notes) } : {}),
    });
  }
  return inputs;
}

function normalizeRoute(value: unknown, fallback: ExecutionRoute): ExecutionRoute {
  const candidate = text(value).toLowerCase();
  return (ROUTES.has(candidate) ? candidate : fallback) as ExecutionRoute;
}

/**
 * Strip anything that looks like a replayed coordinate.
 *
 * The prompt forbids them, and a model that mostly obeys will still occasionally
 * write "click Search (441, 281)". Left in, that text becomes the grounding
 * description and quietly makes the target harder to find, so it is removed here
 * rather than trusted not to appear.
 */
export function stripCoordinates(value: string): string {
  return value
    .replace(/\(\s*-?\d{2,5}\s*,\s*-?\d{2,5}\s*\)/gu, "")
    .replace(/\b(?:at|x|y)\s*[:=]\s*-?\d{2,5}\b/giu, "")
    .replace(/\b-?\d{2,5}\s*[,x]\s*-?\d{2,5}\s*(?:px)?\b/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function normalizeSteps(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) return [];
  const steps: WorkflowStep[] = [];
  for (const raw of value.slice(0, 60)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const instruction = stripCoordinates(text(record.instruction));
    if (!instruction) continue;

    const action = text(record.action, "click").toLowerCase();
    const route = normalizeRoute(record.route, "gui");
    const fallbackRoutes = (Array.isArray(record.fallbackRoutes) ? record.fallbackRoutes : [])
      .map((entry) => text(entry).toLowerCase())
      .filter((entry): entry is ExecutionRoute => ROUTES.has(entry) && entry !== route)
      .slice(0, 3);

    const actionArgs: Record<string, string> = {};
    if (record.actionArgs && typeof record.actionArgs === "object" && !Array.isArray(record.actionArgs)) {
      for (const [key, entry] of Object.entries(record.actionArgs as Record<string, unknown>)) {
        if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
          actionArgs[key] = String(entry);
        }
      }
    }

    const id = `step-${steps.length + 1}`;
    steps.push({
      id,
      instruction,
      action: (ACTIONS.has(action) ? action : "click") as StepAction,
      route,
      fallbackRoutes,
      ...(text(record.app) ? { app: text(record.app) } : {}),
      ...(text(record.windowHint) ? { windowHint: text(record.windowHint) } : {}),
      ...(text(record.target) ? { target: stripCoordinates(text(record.target)) } : {}),
      ...(Object.keys(actionArgs).length > 0 ? { actionArgs } : {}),
      ...(text(record.precondition) ? { precondition: stripCoordinates(text(record.precondition)) } : {}),
      ...(text(record.expectation) ? { expectation: stripCoordinates(text(record.expectation)) } : {}),
      ...(record.optional === true ? { optional: true } : {}),
      ...(record.approvalRequired === true ? { approvalRequired: true } : {}),
      ...(text(record.approvalReason) ? { approvalReason: text(record.approvalReason) } : {}),
      ...(record.uncertain === true ? { uncertain: true } : {}),
    });
  }
  return steps;
}

function normalizeConstraints(value: unknown): WorkflowConstraint[] {
  if (!Array.isArray(value)) return [];
  const constraints: WorkflowConstraint[] = [];
  for (const raw of value.slice(0, 24)) {
    if (typeof raw === "string") {
      const body = raw.trim();
      if (body) constraints.push({ text: body, kind: "note", source: "inference" });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const body = text(record.text);
    if (!body) continue;
    const kind = text(record.kind, "note");
    const source = text(record.source, "inference");
    constraints.push({
      text: body,
      kind: kind === "always" || kind === "never" ? kind : "note",
      source: source === "narration" ? "narration" : "inference",
    });
  }
  return constraints;
}

function normalizeAmbiguities(value: unknown, steps: WorkflowStep[]): WorkflowAmbiguity[] {
  if (!Array.isArray(value)) return [];
  const ambiguities: WorkflowAmbiguity[] = [];
  for (const raw of value.slice(0, 10)) {
    let question = "";
    let options: Array<{ label: string; recommended?: boolean }> = [];
    let affects: number[] = [];

    if (typeof raw === "string") {
      question = raw.trim();
    } else if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      question = text(record.question);
      if (Array.isArray(record.options)) {
        options = record.options
          .map((entry) => {
            if (typeof entry === "string") return { label: entry.trim() };
            if (entry && typeof entry === "object") {
              const option = entry as Record<string, unknown>;
              return { label: text(option.label), recommended: option.recommended === true };
            }
            return { label: "" };
          })
          .filter((option) => option.label.length > 0)
          .slice(0, 5);
      }
      if (Array.isArray(record.affectsSteps)) {
        affects = record.affectsSteps
          .map((entry) => (typeof entry === "number" ? entry : Number.NaN))
          .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= steps.length);
      }
    }
    if (!question) continue;

    const id = `question-${ambiguities.length + 1}`;
    ambiguities.push({
      id,
      question,
      options: options.map((option, index) => ({
        id: `${id}-option-${index + 1}`,
        label: option.label,
        ...(option.recommended ? { recommended: true } : {}),
      })),
      ...(affects.length > 0 ? { affectsStepIds: affects.map((index) => steps[index - 1].id) } : {}),
    });
  }
  return ambiguities;
}

export interface ParseInductionContext {
  sessionId: string;
  recordedAt: string;
  durationMs: number;
  eventCount: number;
  transcriptAvailable: boolean;
  framesAvailable: boolean;
  videoAvailable: boolean;
  fallbackName: string;
}

/**
 * Validate and normalise what the model returned.
 *
 * Policy approvals are applied at the end, after the model's own, so a
 * consequential action is gated whether or not anyone thought to narrate it.
 */
export function parseInductionResponse(
  payload: Record<string, unknown>,
  context: ParseInductionContext,
): DemonstratedProcedure {
  const steps = normalizeSteps(payload.steps);
  const confidence = text(payload.confidence, "medium");

  const procedure: DemonstratedProcedure = {
    name: text(payload.name, context.fallbackName).slice(0, 120),
    goal: text(payload.goal, "Repeat the demonstrated task."),
    description: text(payload.description, ""),
    inputs: normalizeInputs(payload.inputs),
    steps,
    constraints: normalizeConstraints(payload.constraints),
    approvals: [],
    successCriteria: stringList(payload.successCriteria).map((entry) => ({ text: entry })),
    failureCriteria: stringList(payload.failureCriteria).map((entry) => ({ text: entry })),
    recovery: stringList(payload.recovery, 12),
    ambiguities: normalizeAmbiguities(payload.openQuestions ?? payload.ambiguities, steps),
    confidence: confidence === "low" || confidence === "high" ? confidence : "medium",
    sourceDemonstration: {
      sessionId: context.sessionId,
      recordedAt: context.recordedAt,
      durationMs: context.durationMs,
      transcriptAvailable: context.transcriptAvailable,
      framesAvailable: context.framesAvailable,
      videoAvailable: context.videoAvailable,
      eventCount: context.eventCount,
    },
  };

  return ensureApprovalBoundaries(procedure);
}

export async function induceProcedure(
  request: InductionRequest,
  context: ParseInductionContext,
): Promise<DemonstratedProcedure> {
  const prompt = buildInductionPrompt(request);
  const frames = keyframeParts(request);

  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: frames.length > 0 ? [{ type: "text", text: prompt }, ...frames] : prompt,
    },
  ];

  teachLog("induction", "analysing the demonstration", {
    sessionId: context.sessionId,
    events: request.timeline.events.length,
    narrationSegments: request.timeline.transcript.length,
    keyframes: frames.filter((part) => part.type === "image_url").length,
  });

  const reply = await callModel({ messages, signal: request.signal, maxOutputTokens: 8_000 });
  const procedure = parseInductionResponse(extractJsonObject(reply.text), context);

  if (procedure.steps.length === 0) {
    throw new Error(
      "The demonstration did not contain enough recognisable actions to build a workflow from.",
    );
  }
  return procedure;
}

/* ------------------------------------------------------------------ *
 * Re-teaching
 * ------------------------------------------------------------------ */

export interface ReteachRequest extends InductionRequest {
  existing: DemonstratedProcedure;
}

export interface ProcedureDiff {
  summary: string;
  addedSteps: string[];
  removedSteps: string[];
  changedSteps: string[];
  addedInputs: string[];
  removedInputs: string[];
  addedConstraints: string[];
}

/** What changed between two versions, for the review screen's diff. */
export function diffProcedures(
  previous: DemonstratedProcedure,
  next: DemonstratedProcedure,
): ProcedureDiff {
  const previousSteps = new Map(previous.steps.map((step) => [step.instruction.toLowerCase(), step]));
  const nextSteps = new Map(next.steps.map((step) => [step.instruction.toLowerCase(), step]));

  const addedSteps = next.steps
    .filter((step) => !previousSteps.has(step.instruction.toLowerCase()))
    .map((step) => step.instruction);
  const removedSteps = previous.steps
    .filter((step) => !nextSteps.has(step.instruction.toLowerCase()))
    .map((step) => step.instruction);

  const changedSteps: string[] = [];
  for (const [key, step] of nextSteps) {
    const before = previousSteps.get(key);
    if (!before) continue;
    if (
      before.target !== step.target ||
      before.action !== step.action ||
      before.approvalRequired !== step.approvalRequired ||
      before.expectation !== step.expectation
    ) {
      changedSteps.push(step.instruction);
    }
  }

  const previousInputs = new Set(previous.inputs.map((input) => input.name));
  const nextInputs = new Set(next.inputs.map((input) => input.name));
  const previousConstraints = new Set(previous.constraints.map((constraint) => constraint.text));

  const addedInputs = [...nextInputs].filter((name) => !previousInputs.has(name));
  const removedInputs = [...previousInputs].filter((name) => !nextInputs.has(name));
  const addedConstraints = next.constraints
    .filter((constraint) => !previousConstraints.has(constraint.text))
    .map((constraint) => constraint.text);

  const counts = [
    addedSteps.length > 0 ? `${addedSteps.length} step(s) added` : "",
    removedSteps.length > 0 ? `${removedSteps.length} step(s) removed` : "",
    changedSteps.length > 0 ? `${changedSteps.length} step(s) changed` : "",
    addedInputs.length > 0 ? `${addedInputs.length} new input(s)` : "",
    addedConstraints.length > 0 ? `${addedConstraints.length} new rule(s)` : "",
  ].filter(Boolean);

  return {
    summary: counts.length > 0 ? counts.join(", ") : "No differences were found.",
    addedSteps,
    removedSteps,
    changedSteps,
    addedInputs,
    removedInputs,
    addedConstraints,
  };
}

/**
 * Learn a revision of an existing workflow from a second demonstration.
 *
 * The previous version is handed to the model as the thing being corrected, so
 * "this time I checked the amount first" produces a changed step rather than an
 * unrelated workflow. The old version is never overwritten -- the caller stores
 * the result as a new version.
 */
export async function induceRevision(
  request: ReteachRequest,
  context: ParseInductionContext,
): Promise<{ procedure: DemonstratedProcedure; diff: ProcedureDiff }> {
  const prompt = [
    "This is a RE-TEACH. An existing workflow is being corrected by a second demonstration.",
    "",
    "The workflow as it stands today:",
    JSON.stringify(
      {
        name: request.existing.name,
        goal: request.existing.goal,
        inputs: request.existing.inputs,
        steps: request.existing.steps.map((step) => ({
          instruction: step.instruction,
          action: step.action,
          route: step.route,
          target: step.target,
          expectation: step.expectation,
          approvalRequired: step.approvalRequired === true,
        })),
        constraints: request.existing.constraints,
        successCriteria: request.existing.successCriteria,
      },
      null,
      2,
    ),
    "",
    "Produce the CORRECTED workflow in full, in the same schema. Keep everything the new demonstration did not change: a re-teach that silently drops working steps is a regression, not a correction. Where the narration explains what is different this time, let that explanation drive the change.",
    "",
    buildInductionPrompt(request),
  ].join("\n");

  const frames = keyframeParts(request);
  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: frames.length > 0 ? [{ type: "text", text: prompt }, ...frames] : prompt },
  ];

  const reply = await callModel({ messages, signal: request.signal, maxOutputTokens: 8_000 });
  const procedure = parseInductionResponse(extractJsonObject(reply.text), context);
  if (procedure.steps.length === 0) {
    throw new Error("The new demonstration did not contain enough recognisable actions to revise the workflow.");
  }
  return { procedure, diff: diffProcedures(request.existing, procedure) };
}
