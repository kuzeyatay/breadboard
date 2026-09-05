import "server-only";

// Running a learned workflow again.
//
// The loop is Understudy's grounded-execution shape: look at the screen, find
// the thing the step describes, act, look again, confirm it worked, continue.
// It is not a replay of the demonstration -- no coordinate from the recording is
// ever used, and the values the user typed then are replaced by the ones they
// supply now.
//
// Three properties this file exists to guarantee:
//
//   Approval boundaries pause. A step marked as needing approval stops the run
//   before it acts, and a rejection means the action does not happen at all.
//
//   Stop stops. It aborts the loop, kills the desktop control helper, and only
//   then reports the run as stopped, so nothing is left driving the machine.
//
//   A failure is diagnosed, not repeated. A step that did not ground is looked
//   at once more and either recovered for a stated reason or paused on. It is
//   never retried identically in a loop.

import fs from "node:fs";
import path from "node:path";

import { createWorkflowComputerBackend } from "./backends.ts";
import { expectationVisible, groundTarget, resolvePlaceholders } from "./grounding.ts";
import { callModel, extractJsonObject } from "./model.ts";
import { teachLog, teachWarn } from "./redaction.ts";
import * as store from "./store.ts";
import { ensureDirectory, workflowRunDirectory } from "./artifacts.ts";
import type {
  ComputerObservation,
  DemonstratedProcedure,
  DemonstrationRunEvent,
  ObservedElement,
  WorkflowComputerBackend,
  WorkflowStep,
} from "./types.ts";
import { ComputerUseSignal } from "../computer-use-signal.ts";

const APPROVAL_TIMEOUT_MS = 30 * 60_000;
const SETTLE_MS = 550;
const MAX_RUN_MS = 30 * 60_000;

interface ActiveRun {
  runId: string;
  userId: number;
  workflowId: string;
  controller: AbortController;
  backend: WorkflowComputerBackend;
  events: DemonstrationRunEvent[];
  approval: { stepId: string; resolve: (approved: boolean) => void } | null;
  stopped: boolean;
  /**
   * The window this run last selected as its background target.
   *
   * Kept so a step that suddenly cannot find anything can ask whether the
   * desktop simply moved on -- a notification, a background application
   * finishing something -- before concluding the screen is wrong.
   */
  focusedWindow: { titleContains?: string; app?: string } | null;
}

const runRegistry = (): Map<string, ActiveRun> => {
  const holder = globalThis as typeof globalThis & { __breadboardTeachRuns?: Map<string, ActiveRun> };
  if (!holder.__breadboardTeachRuns) holder.__breadboardTeachRuns = new Map();
  return holder.__breadboardTeachRuns;
};

const replayComputerUseSignal = (): ComputerUseSignal => {
  const holder = globalThis as typeof globalThis & {
    __breadboardTeachComputerUseSignal?: ComputerUseSignal;
  };
  if (!holder.__breadboardTeachComputerUseSignal) {
    holder.__breadboardTeachComputerUseSignal = new ComputerUseSignal({
      producer: "teach",
      onCancel: () => {
        for (const active of runRegistry().values()) {
          if (active.stopped) continue;
          active.controller.abort();
          void active.backend.stop().catch(() => undefined);
        }
      },
    });
  }
  return holder.__breadboardTeachComputerUseSignal;
};

class RunStopped extends Error {
  constructor() {
    super("The run was stopped.");
    this.name = "RunStopped";
  }
}

class ApprovalRejected extends Error {
  // Written out rather than declared as a parameter property: the repo's tests
  // load these modules with Node's strip-only TypeScript, which does not
  // implement the shorthand.
  readonly stepId: string;
  constructor(stepId: string) {
    super("The action was rejected.");
    this.name = "ApprovalRejected";
    this.stepId = stepId;
  }
}

/* ------------------------------------------------------------------ *
 * Starting
 * ------------------------------------------------------------------ */

export interface StartRunInput {
  userId: number;
  workflowId: string;
  inputs: Record<string, string>;
}

export function startDemonstrationRun(input: StartRunInput): { runId: string } {
  const workflow = store.getDemonstratedWorkflow(input.userId, input.workflowId);
  if (!workflow) throw new Error("That workflow was not learned from a demonstration.");

  const missing = workflow.procedure.inputs
    .filter((entry) => entry.required)
    .map((entry) => entry.name)
    .filter((name) => !(input.inputs[name] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`This workflow needs a value for ${missing.join(", ")}.`);
  }

  // One run at a time per workflow: two grounded runs sharing a desktop would be
  // two agents fighting over the same keyboard.
  for (const active of runRegistry().values()) {
    if (active.workflowId === input.workflowId && !active.stopped) {
      throw new Error("This workflow is already running.");
    }
  }

  const runId = store.createRun({
    userId: input.userId,
    workflowId: input.workflowId,
    version: workflow.row.procedure_version,
    inputs: input.inputs,
  });

  const controller = new AbortController();
  const active: ActiveRun = {
    runId,
    userId: input.userId,
    workflowId: input.workflowId,
    controller,
    backend: createWorkflowComputerBackend(),
    events: [],
    approval: null,
    stopped: false,
    focusedWindow: null,
  };
  runRegistry().set(runId, active);

  void executeRun(active, workflow.procedure, input.inputs).catch((error: unknown) => {
    teachWarn("replay", "run ended with an unhandled failure", {
      runId,
      message: (error as Error).message,
    });
  });

  return { runId };
}

/* ------------------------------------------------------------------ *
 * Event bookkeeping
 * ------------------------------------------------------------------ */

function emit(
  active: ActiveRun,
  type: DemonstrationRunEvent["type"],
  message: string,
  extra: { stepId?: string; detail?: Record<string, unknown> } = {},
): void {
  const event: DemonstrationRunEvent = {
    sequence: active.events.length + 1,
    at: new Date().toISOString(),
    type,
    message,
    ...(extra.stepId ? { stepId: extra.stepId } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
  active.events.push(event);
  store.updateRun(active.runId, { events: active.events });
}

function ensureRunning(active: ActiveRun): void {
  if (active.controller.signal.aborted) throw new RunStopped();
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

async function executeRun(
  active: ActiveRun,
  procedure: DemonstratedProcedure,
  inputs: Record<string, string>,
): Promise<void> {
  const deadline = setTimeout(() => active.controller.abort(), MAX_RUN_MS);
  const screenshotDirectory = ensureDirectory(workflowRunDirectory(active.workflowId, active.runId));

  store.updateRun(active.runId, { state: "running", helperPid: null });
  emit(active, "run.started", `Running "${procedure.name}".`, {
    detail: { steps: procedure.steps.length, inputs: Object.keys(inputs).length },
  });

  let failure: string | null = null;
  let stopped = false;
  let computerUseActive = false;

  try {
    const availability = active.backend.available();
    if (!availability.available) throw new Error(availability.reason ?? "No computer backend is available.");
    replayComputerUseSignal().setRunActive(active.runId, true);
    computerUseActive = true;

    for (const step of procedure.steps) {
      ensureRunning(active);
      await runStep(active, procedure, step, inputs, screenshotDirectory);
    }

    ensureRunning(active);
    const verified = await verifySuccess(active, procedure, inputs, screenshotDirectory);
    if (!verified.satisfied) {
      failure = verified.reason ?? "The workflow finished but its success condition was not met.";
    }
  } catch (error) {
    if (error instanceof RunStopped || active.controller.signal.aborted) {
      stopped = true;
    } else if (error instanceof ApprovalRejected) {
      failure = "The run was stopped because an action was rejected.";
    } else {
      failure = (error as Error).message ?? "The run failed.";
    }
  } finally {
    clearTimeout(deadline);
    // Control of the machine is released before the run is reported finished, so
    // a completed run can never be a run whose helper is still typing.
    await active.backend.stop().catch(() => undefined);
    if (computerUseActive) {
      try {
        replayComputerUseSignal().setRunActive(active.runId, false);
      } catch (error) {
        teachWarn("replay", "computer-use indicator cleanup failed", {
          runId: active.runId,
          message: (error as Error).message,
        });
      }
    }
    active.stopped = true;
    runRegistry().delete(active.runId);
  }

  const finishedAt = new Date().toISOString();
  if (stopped) {
    emit(active, "run.stopped", "The run was stopped and the desktop was released.");
    store.updateRun(active.runId, {
      state: "stopped",
      finishedAt,
      pendingApproval: null,
      helperPid: null,
    });
    return;
  }
  if (failure) {
    emit(active, "run.failed", failure);
    store.updateRun(active.runId, {
      state: "failed",
      error: failure,
      finishedAt,
      pendingApproval: null,
      helperPid: null,
    });
    return;
  }
  emit(active, "run.completed", "The workflow finished and its success condition was met.");
  store.updateRun(active.runId, {
    state: "completed",
    finishedAt,
    pendingApproval: null,
    helperPid: null,
  });
}

async function observe(
  active: ActiveRun,
  screenshotDirectory: string,
  label: string,
): Promise<ComputerObservation> {
  ensureRunning(active);
  const screenshotPath = path.join(screenshotDirectory, `${label}.jpg`);
  return active.backend.observe({ screenshotPath, maxElements: 260 });
}

async function runStep(
  active: ActiveRun,
  procedure: DemonstratedProcedure,
  step: WorkflowStep,
  inputs: Record<string, string>,
  screenshotDirectory: string,
): Promise<void> {
  const instruction = resolvePlaceholders(step.instruction, inputs);
  emit(active, "step.started", instruction, { stepId: step.id });

  // Move to the right application first. A step grounded against the wrong
  // window is the most expensive kind of wrong: it acts, and it acts somewhere
  // the user did not ask for.
  const windowHint = windowHintFor(step, inputs);
  if (step.action === "focus_window" || step.app || windowHint) {
    if (!windowHint && !step.app) {
      // Focusing with nothing to match on would take whichever window came
      // first. A step that cannot say which window it means does not get to
      // pick one.
      if (step.action === "focus_window") {
        emit(active, "step.skipped", "No window was named, so the current one was kept.", {
          stepId: step.id,
        });
        return;
      }
    } else {
      const target = {
        ...(windowHint ? { titleContains: windowHint } : {}),
        ...(step.app ? { app: step.app } : {}),
      };
      const focus = await active.backend.execute({ kind: "focus_window", ...target });
      if (focus.ok) active.focusedWindow = target;
      if (!focus.ok && step.action === "focus_window") {
        throw new Error(
          `Could not switch to ${step.app ?? windowHint}: ${focus.error ?? "no matching window"}`,
        );
      }
      if (step.action === "focus_window") {
        emit(active, "step.acted", `Switched to ${step.app ?? windowHint}.`, { stepId: step.id });
        await delay(SETTLE_MS);
        return;
      }
    }
  }

  const observation = await observe(active, screenshotDirectory, `${step.id}-before`);
  emit(active, "step.observed", `Read ${observation.elements.length} controls on screen.`, {
    stepId: step.id,
    detail: {
      app: observation.foreground.app,
      elementCount: observation.elements.length,
    },
  });

  if (step.precondition) {
    const resolvedPrecondition = resolvePlaceholders(step.precondition, inputs);
    const check = expectationVisible(step.precondition, observation.elements, inputs);
    if (!check.satisfied) {
      const confirmed = await askModelToVerify(active, step.precondition, observation, inputs);
      if (!confirmed.satisfied) {
        if (step.optional) {
          emit(active, "step.skipped", `Skipped: ${resolvedPrecondition} is not true.`, { stepId: step.id });
          return;
        }
        // How much weight an unmet precondition carries depends on what it is
        // guarding. Before a consequential step it is the whole point -- "check
        // the total before submitting" means do not submit -- so it stops the
        // run. Before an ordinary step it is usually loose prose the induction
        // wrote about intent rather than about the screen, and treating that as
        // fatal fails runs that would have worked. The step's own grounding is
        // the real gate there: if the screen is genuinely wrong, the target will
        // not be found and the run fails on that, which is the honest reason.
        if (blocksOnPrecondition(step)) {
          throw new Error(`The step's precondition was not met: ${resolvedPrecondition}`);
        }
        emit(
          active,
          "step.observed",
          `Could not confirm before acting: ${resolvedPrecondition}. Continuing, and the step's own target must still be found.`,
          { stepId: step.id, detail: { reason: confirmed.reason } },
        );
      }
    }
  }

  if (step.action === "wait") {
    await delay(Math.min(10_000, Number(step.actionArgs?.ms ?? 1500)));
    emit(active, "step.acted", "Waited.", { stepId: step.id });
    return;
  }

  if (step.action === "verify") {
    const expectation = step.expectation ?? instruction;
    const local = expectationVisible(expectation, observation.elements, inputs);
    const verdict = local.satisfied
      ? { satisfied: true, reason: local.evidence }
      : await askModelToVerify(active, expectation, observation, inputs);
    if (!verdict.satisfied) throw new Error(`Check failed: ${expectation}`);
    emit(active, "step.verified", `Confirmed: ${expectation}`, { stepId: step.id });
    return;
  }

  let target: ObservedElement | null = null;
  if (step.action === "click" || step.action === "type" || step.action === "scroll") {
    target = await groundStep(active, step, observation, inputs, screenshotDirectory);
  }

  if (step.approvalRequired) {
    const approved = await requestApproval(active, step, instruction, target);
    if (!approved) {
      emit(active, "approval.rejected", `Rejected: ${instruction}. The action was not performed.`, {
        stepId: step.id,
      });
      throw new ApprovalRejected(step.id);
    }
    emit(active, "approval.granted", `Approved: ${instruction}`, { stepId: step.id });
    // The screen may have moved while the user was deciding, so the element is
    // grounded again rather than acted on from a stale reference.
    if (target) {
      const fresh = await observe(active, screenshotDirectory, `${step.id}-approved`);
      target = await groundStep(active, step, fresh, inputs, screenshotDirectory);
    }
  }

  await act(active, step, target, inputs);
  await delay(SETTLE_MS);

  if (step.expectation) {
    const after = await observe(active, screenshotDirectory, `${step.id}-after`);
    const local = expectationVisible(step.expectation, after.elements, inputs);
    if (local.satisfied) {
      emit(active, "step.verified", `Confirmed: ${step.expectation}`, { stepId: step.id });
      return;
    }
    const verdict = await askModelToVerify(active, step.expectation, after, inputs);
    if (verdict.satisfied) {
      emit(active, "step.verified", `Confirmed: ${step.expectation}`, { stepId: step.id });
      return;
    }
    if (step.optional) {
      emit(active, "step.skipped", `Continued without confirming: ${step.expectation}`, { stepId: step.id });
      return;
    }
    throw new Error(`After "${instruction}", the expected result was not there: ${step.expectation}`);
  }
}

/**
 * Ground a step's target, escalating to the model only when the deterministic
 * match is not clear.
 *
 * The escalation is a choice among the candidates actually on screen, not a free
 * invention: the model can pick a different control, and it cannot pick one that
 * is not there.
 */
async function groundStep(
  active: ActiveRun,
  step: WorkflowStep,
  observation: ComputerObservation,
  inputs: Record<string, string>,
  screenshotDirectory: string,
  recovered = false,
): Promise<ObservedElement | null> {
  const target = step.target;
  if (!target) return null;

  const result = groundTarget(target, observation.elements, { action: step.action, inputs });
  if (result.confident && result.element) {
    emit(active, "step.grounded", result.reason, {
      stepId: step.id,
      detail: { score: result.score, role: result.element.role },
    });
    return result.element;
  }

  if (result.candidates.length === 0) {
    // Nothing matched at all. Before concluding the screen is wrong, ask whether
    // it is simply no longer in front: a notification or a background
    // application can take the foreground mid-run, and every control the step
    // needs is still there behind it. Re-focusing the window this run was
    // already working in is a justified recovery, and it is tried once -- a
    // second failure is a real one, and repeating a failed action is not a plan.
    if (!recovered && active.focusedWindow) {
      const refocus = await active.backend.execute({
        kind: "focus_window",
        ...active.focusedWindow,
      });
      if (refocus.ok) {
        emit(
          active,
          "step.observed",
          `The desktop had moved on to ${observation.foreground.app ?? "another application"}; returning to the workflow's window.`,
          { stepId: step.id },
        );
        await delay(SETTLE_MS);
        const fresh = await observe(active, screenshotDirectory, `${step.id}-refocused`);
        return groundStep(active, step, fresh, inputs, screenshotDirectory, true);
      }
    }

    // Diagnose from what is actually there rather than trying the same lookup again.
    throw new Error(
      `Could not find ${resolvePlaceholders(target, inputs)} on screen. ` +
        `The foreground window is ${observation.foreground.windowTitle ?? "untitled"} with ${observation.elements.length} readable controls.`,
    );
  }

  const chosen = await askModelToChoose(active, step, result.candidates, observation, inputs);
  if (!chosen) {
    throw new Error(
      `Could not tell which control is ${resolvePlaceholders(target, inputs)}; ${result.candidates.length} looked similar.`,
    );
  }
  emit(active, "step.grounded", `Chose ${chosen.describe} from ${result.candidates.length} candidates.`, {
    stepId: step.id,
  });
  return chosen;
}

async function act(
  active: ActiveRun,
  step: WorkflowStep,
  target: ObservedElement | null,
  inputs: Record<string, string>,
): Promise<void> {
  ensureRunning(active);
  let result: { ok: boolean; error?: string };

  switch (step.action) {
    case "click":
      result = await active.backend.execute({
        kind: "click",
        ...(target ? { ref: target.ref } : {}),
        ...(step.actionArgs?.button ? { button: step.actionArgs.button as "left" | "right" | "middle" } : {}),
        ...(step.actionArgs?.clicks ? { clicks: Number(step.actionArgs.clicks) || 1 } : {}),
      });
      break;
    case "type": {
      const raw = step.actionArgs?.text ?? "";
      const text = resolvePlaceholders(raw, inputs);
      if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/u.test(text)) {
        throw new Error(`This step needs a value that was not supplied: ${raw}`);
      }
      result = await active.backend.execute({
        kind: "type",
        text,
        ...(target ? { ref: target.ref } : {}),
        clear: step.actionArgs?.clear !== "false",
      });
      break;
    }
    case "key":
      result = await active.backend.execute({
        kind: "key",
        key: step.actionArgs?.key ?? "Enter",
        ...(step.actionArgs?.modifiers
          ? { modifiers: step.actionArgs.modifiers.split(/[+,\s]+/u).filter(Boolean) }
          : {}),
      });
      break;
    case "scroll":
      result = await active.backend.execute({
        kind: "scroll",
        ...(target ? { ref: target.ref } : {}),
        notches: Number(step.actionArgs?.notches ?? -3) || -3,
      });
      break;
    case "run":
      // A shell route exists in the model, but running arbitrary commands from a
      // demonstrated workflow is a larger grant than this feature asks for, so it
      // is refused rather than quietly approximated.
      throw new Error(
        "This workflow contains a shell step, which demonstrated workflows do not execute yet.",
      );
    default:
      throw new Error(`Unsupported step action ${step.action}.`);
  }

  if (!result.ok) throw new Error(result.error ?? "The action could not be performed.");
  emit(active, "step.acted", resolvePlaceholders(step.instruction, inputs), { stepId: step.id });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an unmet precondition should stop the run rather than warn.
 *
 * The narrated case this exists for is "check the amount before you send it":
 * the check is the reason the step is allowed to happen, so a check that cannot
 * be confirmed means the step must not happen. A `verify` step is the same thing
 * by definition -- confirming is all it does.
 */
export function blocksOnPrecondition(
  step: Pick<WorkflowStep, "approvalRequired" | "action">,
): boolean {
  return step.approvalRequired === true || step.action === "verify" || step.action === "run";
}

/**
 * The window-title fragment a step should switch to.
 *
 * A model writing a focus step usually names the window in the target rather
 * than filling in `windowHint` -- "the browser window showing \"Customer
 * Lookup\"". The quoted part of that is a perfectly good title fragment, and
 * reading it here is the difference between a run that switches to the right
 * window and one that refuses to switch at all.
 */
export function windowHintFor(
  step: Pick<WorkflowStep, "windowHint" | "target" | "actionArgs">,
  inputs: Record<string, string>,
): string | undefined {
  const explicit = step.windowHint ?? step.actionArgs?.titleContains;
  if (explicit && explicit.trim()) return resolvePlaceholders(explicit.trim(), inputs);
  const quoted = step.target?.match(/["“”]([^"“”]{2,80})["“”]/u)?.[1];
  return quoted ? resolvePlaceholders(quoted.trim(), inputs) : undefined;
}

/* ------------------------------------------------------------------ *
 * Approvals
 * ------------------------------------------------------------------ */

async function requestApproval(
  active: ActiveRun,
  step: WorkflowStep,
  instruction: string,
  target: ObservedElement | null,
): Promise<boolean> {
  const pending = {
    stepId: step.id,
    instruction,
    reason: step.approvalReason ?? "This action is consequential.",
    ...(target ? { target: target.describe } : {}),
  };
  store.updateRun(active.runId, { state: "awaiting_approval", pendingApproval: pending });
  emit(active, "approval.requested", `Waiting for approval: ${instruction}`, {
    stepId: step.id,
    detail: { reason: pending.reason },
  });

  const approved = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      active.approval = null;
      clearTimeout(timer);
      active.controller.signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    const onAbort = (): void => finish(false);
    active.controller.signal.addEventListener("abort", onAbort, { once: true });
    active.approval = { stepId: step.id, resolve: finish };
  });

  store.updateRun(active.runId, {
    state: approved ? "running" : "awaiting_approval",
    pendingApproval: null,
  });
  if (approved) store.updateRun(active.runId, { state: "running" });
  ensureRunning(active);
  return approved;
}

export function decideApproval(userId: number, runId: string, approved: boolean): boolean {
  const active = runRegistry().get(runId);
  if (!active || active.userId !== userId) return false;
  const pending = active.approval;
  if (!pending) return false;
  pending.resolve(approved);
  return true;
}

/* ------------------------------------------------------------------ *
 * Stopping
 * ------------------------------------------------------------------ */

/**
 * Stop a run and give the machine back.
 *
 * Aborting the loop is not enough on its own: the helper process holds the
 * ability to move the pointer and press keys, so it is killed as part of
 * stopping rather than left to exit on its own.
 */
export async function stopDemonstrationRun(userId: number, runId: string): Promise<boolean> {
  const active = runRegistry().get(runId);
  if (!active || active.userId !== userId) {
    // Nothing live: close the record so a run left over from a restart does not
    // sit in the UI claiming to be running.
    const row = store.getRun(userId, runId);
    if (row && (row.state === "running" || row.state === "queued" || row.state === "awaiting_approval")) {
      store.updateRun(runId, {
        state: "stopped",
        finishedAt: new Date().toISOString(),
        pendingApproval: null,
        helperPid: null,
      });
      return true;
    }
    return false;
  }

  active.approval?.resolve(false);
  active.controller.abort();
  await active.backend.stop().catch(() => undefined);
  teachLog("replay", "run stopped by the user", { runId });
  return true;
}

/** True while this process is actually driving the desktop for this run. */
export function isRunActive(runId: string): boolean {
  const active = runRegistry().get(runId);
  return Boolean(active && !active.stopped);
}

export function activeRunIds(): string[] {
  return [...runRegistry().keys()];
}

/**
 * Close runs a restart orphaned.
 *
 * A run row still marked live after this process started belongs to a process
 * that no longer exists. Safety beats continuity here: the run is marked stopped
 * rather than resumed, because resuming would mean picking up control of a
 * machine whose state nobody has looked at since.
 */
export function recoverOrphanedRuns(): { closed: number } {
  let closed = 0;
  for (const row of store.listLiveRuns()) {
    if (isRunActive(row.id)) continue;
    store.updateRun(row.id, {
      state: "stopped",
      error: "Breadboard restarted while this run was in progress, so it was stopped.",
      finishedAt: new Date().toISOString(),
      pendingApproval: null,
      helperPid: null,
    });
    closed += 1;
  }
  if (closed > 0) teachLog("replay", "closed orphaned runs", { closed });
  return { closed };
}

/* ------------------------------------------------------------------ *
 * Model assistance
 * ------------------------------------------------------------------ */

function describeScreen(observation: ComputerObservation, elements: readonly ObservedElement[]): string {
  return [
    `Foreground: ${observation.foreground.app ?? "unknown"} — ${observation.foreground.windowTitle ?? "untitled"}`,
    "Controls currently on screen:",
    ...elements
      .slice(0, 60)
      .map((element) =>
        [
          `- ref=${element.ref}`,
          `role=${element.role ?? "?"}`,
          element.name ? `name=${JSON.stringify(element.name)}` : "",
          element.value ? `value=${JSON.stringify(element.value.slice(0, 80))}` : "",
          element.enabled === false ? "disabled" : "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
  ].join("\n");
}

async function askModelToChoose(
  active: ActiveRun,
  step: WorkflowStep,
  candidates: readonly ObservedElement[],
  observation: ComputerObservation,
  inputs: Record<string, string>,
): Promise<ObservedElement | null> {
  const target = resolvePlaceholders(step.target ?? "", inputs);
  try {
    const reply = await callModel({
      signal: active.controller.signal,
      maxOutputTokens: 400,
      messages: [
        {
          role: "system",
          content: [
            "You are grounding one step of a workflow against the screen as it is right now.",
            "Choose which of the listed controls the step means. Choose only from the given refs.",
            "If none of them is the control the step describes, choose none — a wrong click is worse than a stopped run.",
            'Answer with JSON only: {"ref":"e12","confidence":"high|medium|low"} or {"ref":null,"reason":"..."}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Step: ${resolvePlaceholders(step.instruction, inputs)}`,
            `Action: ${step.action}`,
            `Target described as: ${target}`,
            ...(Object.keys(inputs).length > 0
              ? [`Values supplied for this run: ${JSON.stringify(inputs)}`]
              : []),
            "",
            describeScreen(observation, candidates),
          ].join("\n"),
        },
      ],
    });
    const payload = extractJsonObject(reply.text);
    const ref = typeof payload.ref === "string" ? payload.ref : null;
    if (!ref) return null;
    return candidates.find((candidate) => candidate.ref === ref) ?? null;
  } catch (error) {
    teachWarn("replay", "grounding assistance was unavailable", {
      runId: active.runId,
      message: (error as Error).message,
    });
    return null;
  }
}

async function askModelToVerify(
  active: ActiveRun,
  expectation: string,
  observation: ComputerObservation,
  inputs: Record<string, string>,
): Promise<{ satisfied: boolean; reason?: string }> {
  const resolved = resolvePlaceholders(expectation, inputs);
  try {
    const reply = await callModel({
      signal: active.controller.signal,
      maxOutputTokens: 300,
      messages: [
        {
          role: "system",
          content: [
            "You are checking whether a workflow's expected result is true of the screen as described.",
            "Judge only from the controls listed. If the evidence does not show it, say it is not satisfied.",
            'Answer with JSON only: {"satisfied":true|false,"reason":"one sentence"}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [`Expected: ${resolved}`, "", describeScreen(observation, observation.elements)].join("\n"),
        },
      ],
    });
    const payload = extractJsonObject(reply.text);
    return {
      satisfied: payload.satisfied === true,
      ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    };
  } catch (error) {
    if (active.controller.signal.aborted) throw new RunStopped();
    teachWarn("replay", "verification assistance was unavailable", {
      runId: active.runId,
      message: (error as Error).message,
    });
    // An unverifiable expectation is not a met expectation.
    return { satisfied: false, reason: "The result could not be checked." };
  }
}

async function verifySuccess(
  active: ActiveRun,
  procedure: DemonstratedProcedure,
  inputs: Record<string, string>,
  screenshotDirectory: string,
): Promise<{ satisfied: boolean; reason?: string }> {
  if (procedure.successCriteria.length === 0) return { satisfied: true };
  const observation = await observe(active, screenshotDirectory, "success");

  for (const criterion of procedure.successCriteria) {
    const local = expectationVisible(criterion.text, observation.elements, inputs);
    if (local.satisfied) {
      emit(active, "step.verified", `Success condition met: ${criterion.text}`, {
        detail: { evidence: local.evidence },
      });
      continue;
    }
    const verdict = await askModelToVerify(active, criterion.text, observation, inputs);
    if (!verdict.satisfied) {
      return {
        satisfied: false,
        reason: `Success condition not met: ${criterion.text}${verdict.reason ? ` (${verdict.reason})` : ""}`,
      };
    }
    emit(active, "step.verified", `Success condition met: ${criterion.text}`);
  }
  return { satisfied: true };
}

/** Screenshots a run captured, for the run panel. Never leaves the run's directory. */
export function runScreenshotPath(workflowId: string, runId: string, name: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,80}$/u.test(name)) return null;
  const directory = workflowRunDirectory(workflowId, runId);
  const candidate = path.join(directory, name);
  if (!candidate.startsWith(path.resolve(directory))) return null;
  return fs.existsSync(candidate) ? candidate : null;
}
