// In-memory run manager for the Parametric CAD agent.
//
// The run is a bounded agent loop, not a fixed pipeline: the model decides
// which CAD tools to call and in what order, but Breadboard executes them, and
// the build budget (three model-driven generations per user turn) is enforced
// here rather than trusted to the prompt.
//
//   interpret -> spec -> generate -> execute -> validate -> [repair] -> export
//   -> artifact
//
// Runs are ephemeral: events live here and the SSE route replays them, exactly
// as the Hardware Blueprint agent does.

import { randomUUID } from "node:crypto";
import {
  normalizeChatTokenUsage,
  sumChatTokenUsage,
  type ChatTokenUsage,
} from "../chat-token-usage.ts";
import { getConversationForUser } from "../conversations/store.ts";
import {
  isTransportFailure,
  transportFailureCode,
  transportFailureReason,
} from "../model-transport.ts";
import {
  closeCadArtifactContext,
  latestCadArtifact,
  openCadArtifactContext,
  publishCadDesign,
  readStoredCadDesign,
  type CadArtifactContext,
} from "./artifact.ts";
import { designCadPart, MAX_BUILD_ATTEMPTS } from "./design-service.ts";
import { CadServiceError } from "./errors.ts";
import { CadModelError } from "./model-client.ts";
import { latestCadProjectForConversation } from "./project-store.ts";
import { cadServiceConfigured, cadServiceListening } from "./service.ts";
import type { ParametricCADArtifact } from "./types.ts";
import type { ParametricCadRequest } from "./identity.ts";

export { MAX_BUILD_ATTEMPTS };

export interface CadRunEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

interface RunState {
  runId: string;
  userId: number;
  brief: string;
  /** Stable browser turn key used to collapse a replayed launch request. */
  launchKey: string | null;
  requestSignature: string;
  status: RunStatus;
  sequence: number;
  events: CadRunEvent[];
  aborted: boolean;
  createdAt: number;
  controller: AbortController;
  usage?: ChatTokenUsage;
  terminalResult?: CadTerminalResult;
  terminalHandler?: (result: CadTerminalResult) => void;
}

export interface CadTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
  state?: Record<string, unknown>;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardParametricCadRuns?: Map<string, RunState>;
  __breadboardParametricCadLaunches?: Map<string, string>;
};
const runs = globalRuns.__breadboardParametricCadRuns ?? new Map<string, RunState>();
globalRuns.__breadboardParametricCadRuns = runs;
const launches =
  globalRuns.__breadboardParametricCadLaunches ?? new Map<string, string>();
globalRuns.__breadboardParametricCadLaunches = launches;

const MAX_EVENTS = 2_000;
const RETENTION_MS = 15 * 60 * 1000;

function emit(run: RunState, type: string, payload: Record<string, unknown> = {}): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

function publishTerminal(run: RunState, result: CadTerminalResult): void {
  if (run.terminalResult) return;
  run.terminalResult = result;
  try {
    run.terminalHandler?.(result);
  } catch {
    // The in-memory result remains replayable if transcript persistence fails.
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

export interface StartCadRunInput {
  userId: number;
  conversationPublicId: string;
  /** Stable id of the chat turn. Replayed POSTs with this id reuse one run. */
  clientMessageId?: string;
  brief: string;
  parsed: ParametricCadRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
}

export function startRun(input: StartCadRunInput): { runId: string; status: RunStatus } {
  if (!input.parsed.brief.trim()) throw new Error("empty_brief");
  const requestSignature = JSON.stringify({
    brief: input.brief,
    parsed: input.parsed,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  const clientMessageId = input.clientMessageId?.trim() ?? "";
  const launchKey = clientMessageId
    ? `${input.userId}\u0000${input.conversationPublicId}\u0000${clientMessageId}`
    : null;
  if (launchKey) {
    const existingRunId = launches.get(launchKey);
    const existing = existingRunId ? runs.get(existingRunId) : undefined;
    if (existing) {
      if (existing.requestSignature !== requestSignature) {
        throw new Error("client_message_id_conflict");
      }
      return { runId: existing.runId, status: existing.status };
    }
    if (existingRunId) launches.delete(launchKey);
  }
  const runId = `cadrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    brief: input.parsed.brief,
    launchKey,
    requestSignature,
    status: "queued",
    sequence: 0,
    events: [],
    aborted: false,
    createdAt: Date.now(),
    controller: new AbortController(),
  };
  runs.set(runId, run);
  if (launchKey) launches.set(launchKey, runId);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    if (run.usage) {
      run.usage = {
        ...run.usage,
        responseDurationMs: Date.now() - run.createdAt,
      };
    }
    const content = runFailureMessage(error);
    emit(run, "run.failed", {
      error: content,
      ...(error instanceof CadServiceError ? { code: error.code } : {}),
    });
    publishTerminal(run, {
      outcome: "failed",
      content,
      ...(run.usage ? { usage: run.usage } : {}),
    });
    schedule(run);
  });
  return { runId, status: "queued" };
}

/**
 * Why the run stopped, in words.
 *
 * The typed failures already read as sentences — the service and the model
 * client each explain themselves. This is the catch for everything else: undici
 * raises a contentless "fetch failed" from any client in the run, and printed
 * as the card's whole result it says only that something, somewhere, broke.
 */
function runFailureMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return "The parametric CAD run failed.";
  }
  if (error instanceof CadServiceError || error instanceof CadModelError) return error.message;
  if (isTransportFailure(error)) {
    const code = transportFailureCode(error);
    return `The run could not finish: ${transportFailureReason(code)}.${code ? ` (${code})` : ""}`;
  }
  return error.message;
}

async function drive(run: RunState, input: StartCadRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", { brief: run.brief, model: input.model });

  // Checked before any model time is spent: a design takes minutes, and there
  // is no point writing one when nothing can build it. A TCP probe, not a
  // health request — `/health` imports OpenCascade and would add seconds to
  // every run.
  if (!cadServiceConfigured()) {
    run.status = "failed";
    const content =
      "Breadboard could not create the CAD service's local secret, so it will not contact it. " +
      "Check that its data directory is writable.";
    emit(run, "run.failed", {
      code: "cad_service_unconfigured",
      error: content,
    });
    publishTerminal(run, { outcome: "failed", content });
    schedule(run);
    return;
  }
  const serviceListening = await cadServiceListening();
  if (run.aborted) return;
  if (!serviceListening) {
    run.status = "failed";
    const content =
      "The local CAD service is not running. Start the whole stack with `npm run dev`, run " +
      "`npm run dev:cad` alongside the dashboard, or use the desktop app, which supervises it. " +
      "If this is a first run, provision it once with `npm run setup:cad`.";
    emit(run, "run.failed", {
      code: "cad_service_unavailable",
      error: content,
    });
    publishTerminal(run, { outcome: "failed", content });
    schedule(run);
    return;
  }

  const conversation = getConversationForUser(input.conversationPublicId, input.userId);

  const spent: ChatTokenUsage[] = [];
  const onUsage = (usage: unknown) => {
    const normalized = normalizeChatTokenUsage(usage);
    if (!normalized) return;
    spent.push(normalized);
    run.usage = sumChatTokenUsage(spent);
    emit(run, "run.usage", { ...run.usage });
  };

  // The design already in this chat, unless the user asked for a fresh one.
  const previousArtifact = input.parsed.fresh
    ? null
    : latestCadArtifact({
        userId: input.userId,
        conversationPublicId: input.conversationPublicId,
      });
  const previousDesign = previousArtifact ? readStoredCadDesign(previousArtifact) : null;
  const existingProject =
    !input.parsed.fresh && previousDesign
      ? latestCadProjectForConversation({
          userId: input.userId,
          conversationId: conversation.id,
        })
      : null;

  emit(run, "interpret.started", { revising: Boolean(existingProject) });

  const outcome = await designCadPart({
    userId: input.userId,
    conversationId: conversation.id,
    clusterId: conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
    brief: input.parsed.fresh
      ? `${input.parsed.brief}

Start a new project; do not modify the design already in this conversation.`
      : input.parsed.brief,
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    process: input.parsed.process ?? "fdm",
    signal: run.controller.signal,
    onUsage,
    emit: (type, payload) => emit(run, type, payload),
    ...(input.parsed.printerBed ? { printerBed: input.parsed.printerBed } : {}),
    ...(input.parsed.units ? { units: input.parsed.units } : {}),
    ...(existingProject ? { existingProject } : {}),
    ...(existingProject && previousDesign
      ? {
          existingComponents: previousDesign.designSpec.components.map((component) => ({
            name: component.name,
            quantity: component.quantity,
            bodyRole: component.bodyRole,
          })),
          existingBoundingBox: previousDesign.measurements.boundingBox,
        }
      : {}),
  });
  if (run.aborted) return;

  if (outcome.safety.level === "engineering-review") {
    emit(run, "safety.limited", {
      category: outcome.safety.category,
      reason: outcome.safety.reason,
    });
  }

  emit(run, "interpret.completed", { attemptsUsed: outcome.attemptsUsed });

  if (!outcome.ok) {
    run.status = "failed";
    const usage = {
      ...sumChatTokenUsage(spent),
      responseDurationMs: Date.now() - run.createdAt,
    };
    run.usage = usage;
    emit(run, "run.failed", {
      error: outcome.reason,
      attemptsUsed: outcome.attemptsUsed,
    });
    publishTerminal(run, {
      outcome: "failed",
      content: outcome.reason,
      usage,
    });
    schedule(run);
    return;
  }

  const manifest = outcome.manifest;

  let context: CadArtifactContext | null = null;
  let artifactId: string | null = null;
  let artifactVersion = 0;
  try {
    context = openCadArtifactContext({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      brief: run.brief,
      agentRunId: run.runId,
    });
    if (context) {
      const artifact = await publishCadDesign({
        context,
        manifest,
        previousArtifactId: existingProject ? (previousArtifact?.id ?? null) : null,
      });
      artifactId = artifact?.id ?? null;
      artifactVersion = artifact?.current_version ?? 0;
      if (artifact) {
        emit(run, previousArtifact ? "cad.artifact.updated" : "cad.artifact.created", {
          artifactId: artifact.id,
          title: artifact.title,
          version: artifact.current_version,
          revision: manifest.revision,
        });
      }
    }
  } finally {
    closeCadArtifactContext(context, "completed");
  }

  if (!artifactId) {
    emit(run, "artifact.unavailable", {
      reason:
        "The design was built and validated but could not be stored as an artifact in this " +
        "conversation.",
    });
  }

  const elapsedMs = Date.now() - run.createdAt;
  const summary = chatSummary({ manifest, answer: outcome.answer, artifactId });
  const findings = presentIssues(manifest);
  const exports = manifest.exports.map((file) => file.format);
  const usage = { ...sumChatTokenUsage(spent), responseDurationMs: elapsedMs };
  run.usage = usage;
  run.status = "completed";
  emit(run, "run.completed", {
    summary,
    status: manifest.status,
    projectId: manifest.projectId,
    revision: manifest.revision,
    artifactId,
    artifactVersion,
    validationPassed: manifest.validation.passed,
    errors: manifest.validation.issues.filter((issue) => issue.severity === "error").length,
    warnings: manifest.validation.issues.filter((issue) => issue.severity === "warning").length,
    findings,
    measurements: manifest.measurements,
    assumptions: manifest.assumptions,
    designTitle: manifest.title,
    designSummary: manifest.designSpec.description,
    attemptsUsed: outcome.attemptsUsed,
    exports,
    elapsedSec: elapsedMs / 1_000,
    usage,
  });
  publishTerminal(run, {
    outcome: "completed",
    content: summary,
    usage,
    state: {
      kind: "parametric-cad",
      designTitle: manifest.title,
      designSummary: manifest.designSpec.description,
      safetyNotice:
        outcome.safety.level === "engineering-review"
          ? `${outcome.safety.category} — ${outcome.safety.reason}`
          : "",
      findings,
      assumptions: manifest.assumptions,
      exports,
      attemptsUsed: outcome.attemptsUsed,
      specs: [
        [
          "Size",
          `${manifest.measurements.boundingBox.x.toFixed(1)} × ${manifest.measurements.boundingBox.y.toFixed(1)} × ${manifest.measurements.boundingBox.z.toFixed(1)} mm`,
        ],
        ["Bodies", String(manifest.measurements.solidCount)],
        ...(typeof manifest.measurements.volume === "number"
          ? [["Volume", `${(manifest.measurements.volume / 1000).toFixed(1)} cm³`]]
          : []),
        ["Revision", String(manifest.revision)],
      ],
      startedAt: run.events.find((event) => event.type === "run.started")?.at,
      completedAt: run.events.at(-1)?.at,
    },
  });
  schedule(run);
}

/** Findings as the run card needs them: severity, what it is, what to do. */
function presentIssues(manifest: ParametricCADArtifact): Array<{
  code: string;
  severity: "warning" | "error";
  message: string;
  repairHint?: string;
}> {
  return manifest.validation.issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity as "warning" | "error",
      message: issue.message,
      ...(issue.repairHint ? { repairHint: issue.repairHint } : {}),
    }));
}

/**
 * The chat reply. The artifact is the deliverable and its card sits directly
 * under this message, so the transcript points at it rather than restating it.
 */
function chatSummary(input: {
  manifest: ParametricCADArtifact;
  answer: string;
  artifactId: string | null;
}): string {
  const { manifest } = input;
  const box = manifest.measurements.boundingBox;
  const errors = manifest.validation.issues.filter((issue) => issue.severity === "error").length;
  const warnings = manifest.validation.issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  const statusLine =
    manifest.status === "valid"
      ? "Validation found nothing to fix."
      : manifest.status === "valid-with-warnings"
        ? `${warnings} warning${warnings === 1 ? "" : "s"} to read before printing.`
        : `${errors} error${errors === 1 ? "" : "s"} remain unresolved.`;

  return [
    `**${manifest.title}** — ${statusLine}`,
    `Measured ${box.x.toFixed(1)} × ${box.y.toFixed(1)} × ${box.z.toFixed(1)} mm, ` +
      `${manifest.measurements.solidCount} ${manifest.measurements.solidCount === 1 ? "body" : "bodies"}, ` +
      `revision ${manifest.revision}.`,
    input.answer.trim(),
    input.artifactId
      ? ""
      : "The design could not be attached to this conversation as an artifact.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function schedule(run: RunState): void {
  // Unreferenced so a finished run's retention window never keeps the process
  // alive on its own.
  setTimeout(() => {
    runs.delete(run.runId);
    if (run.launchKey && launches.get(run.launchKey) === run.runId) {
      launches.delete(run.launchKey);
    }
  }, RETENTION_MS).unref?.();
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(userId: number, runId: string, since = 0): CadRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/**
 * Persist a background result even when its card unmounted during a chat
 * switch. A very fast run is replayed immediately after the handler attaches.
 */
export function setRunTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: CadTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort();
  const content = "The parametric CAD run was stopped.";
  emit(run, "run.aborted", { summary: content });
  publishTerminal(run, {
    outcome: "aborted",
    content,
    ...(run.usage ? { usage: run.usage } : {}),
  });
  schedule(run);
  return true;
}
