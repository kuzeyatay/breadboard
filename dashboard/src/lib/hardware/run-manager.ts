// In-memory run manager for the Hardware Blueprint agent.
//
// The run is a fixed pipeline, not an agent loop:
//
//   interpret -> research missing parts -> resolve -> compile -> validate -> firmware -> artifact
//
// Interpretation, bounded component research, and firmware logic may call the
// model. Compilation itself is deterministic TypeScript, so a run either produces a blueprint whose
// wiring, instructions and firmware agree, or it reports exactly where it
// stopped. Runs are ephemeral: events live here and the SSE route replays them.

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
  closeHardwareArtifactContext,
  latestHardwareArtifact,
  openHardwareArtifactContext,
  publishHardwareDesign,
  readStoredDesign,
  summariseDesignForModel,
  type HardwareArtifactContext,
} from "./artifact.ts";
import { applyModification, buildDesign } from "./design.ts";
import { firmwareLogicBrief } from "./firmware.ts";
import { generateFirmwareLogic, HardwareModelError, interpretTurn } from "./model-client.ts";
import { assessSafety } from "./safety.ts";
import {
  enclosureBriefFromDesign,
  enclosureIntent,
  physicalDesignCoverageIssues,
  physicalDesignKind,
} from "../cad/board-enclosures.ts";
import { designCadPart } from "../cad/design-service.ts";
import {
  closeCadArtifactContext,
  openCadArtifactContext,
  publishCadDesign,
} from "../cad/artifact.ts";
import { ensureCadServiceReady } from "../cad/service.ts";
import { SupervisorResourceExhaustedError } from "../supervisor-control.ts";
import { cadDefaults } from "../cad/defaults.ts";
import { resolveCadEngine } from "../cad/engines.ts";
import { latestUnbuiltCadProjectForConversation } from "../cad/project-store.ts";
import { preferPcbForPortableRequest } from "./form-factor.ts";
import { withRequestDefaults, type HardwareTurn } from "./schemas.ts";
import { countBySeverity } from "./validation.ts";
import {
  hardwareBlueprintRunCardState,
  presentHardwareBlueprintFindings,
} from "./run-card-state.ts";
import {
  componentDefinitionForDesign,
  scopedDefinitionsForDesign,
} from "./components/index.ts";
import { resolveComponentPhrase } from "./resolver.ts";
import { groundHardwareRequest } from "./request-grounding.ts";
import { discoverRequestComponents } from "./component-discovery.ts";
import type {
  HardwareDesign,
  HardwareProjectRequest,
} from "./types.ts";
import type { HardwareBlueprintRequest } from "./identity.ts";
import {
  hardwarePreferenceNote,
  parametricCadDefaults,
  type HardwarePreferences,
} from "../agent-settings/defaults.ts";
import { agentSettingsFor } from "../agent-settings/store.ts";

export interface HardwareRunEvent {
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
  events: HardwareRunEvent[];
  aborted: boolean;
  createdAt: number;
  controller: AbortController;
  usage?: ChatTokenUsage;
  terminalResult?: HardwareTerminalResult;
  terminalHandler?: (result: HardwareTerminalResult) => void;
}

export interface HardwareTerminalResult {
  outcome: "completed" | "failed" | "aborted";
  content: string;
  usage?: ChatTokenUsage;
  state?: Record<string, unknown>;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardHardwareBlueprintRuns?: Map<string, RunState>;
  __breadboardHardwareBlueprintLaunches?: Map<string, string>;
};
const runs = globalRuns.__breadboardHardwareBlueprintRuns ?? new Map<string, RunState>();
globalRuns.__breadboardHardwareBlueprintRuns = runs;
const launches =
  globalRuns.__breadboardHardwareBlueprintLaunches ?? new Map<string, string>();
globalRuns.__breadboardHardwareBlueprintLaunches = launches;

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

function publishTerminal(run: RunState, result: HardwareTerminalResult): void {
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

export interface StartHardwareRunInput {
  userId: number;
  /** Native Runtime job identity. Present only inside the disposable worker. */
  runtimeJobId?: string;
  conversationPublicId: string;
  /** Stable id of the chat turn. Replayed POSTs with this id reuse one run. */
  clientMessageId?: string;
  brief: string;
  parsed: HardwareBlueprintRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  /**
   * The user's standing preferences from their settings page. Unlike the flags
   * in `parsed`, these do not override the design: the board, build style and
   * toolchain travel to the interpretation step as a tie-breaker the brief can
   * outvote, because a preference must never beat a brief that says "on an
   * ESP32". Only the enclosure preference is applied here, where "what the
   * brief asked for" is already known.
   */
  preferences?: HardwarePreferences;
  /** The chat this was launched from, so a brief can refer back to it. */
  conversationContext?: string;
}

/** Fixed Runtime worker entrypoint. Next.js routes must call `startRun`. */
export function startRuntimeWorkerRun(
  input: StartHardwareRunInput,
): { runId: string; status: RunStatus } {
  if (!input.parsed.brief.trim()) throw new Error("empty_brief");
  const requestSignature = JSON.stringify({
    brief: input.brief,
    parsed: input.parsed,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    preferences: input.preferences ?? null,
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
  const runId = input.runtimeJobId ?? `hwrun_${randomUUID().replaceAll("-", "")}`;
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
    const content = runFailureMessage(error);
    emit(run, "run.failed", { error: content });
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
 * The model client already explains its own failures — it knows which endpoint
 * it was calling. This is the catch for every other client in the run: undici
 * raises the same contentless "fetch failed" from any of them, and printing it
 * as the whole reply tells the reader nothing except that something broke. No
 * endpoint is named here because at this distance we do not know which one it
 * was, and naming the wrong one is worse than naming none.
 */
function runFailureMessage(error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return "The hardware blueprint run failed.";
  }
  if (error instanceof HardwareModelError) return error.message;
  if (isTransportFailure(error)) {
    const code = transportFailureCode(error);
    return `The run could not finish: ${transportFailureReason(code)}.${code ? ` (${code})` : ""}`;
  }
  return error.message;
}

/** Flags on the command override whatever the model read from the sentence. */
function applyCommandFlags(
  request: HardwareProjectRequest,
  parsed: HardwareBlueprintRequest,
): HardwareProjectRequest {
  return {
    ...request,
    ...(parsed.board ? { controller: parsed.board } : {}),
    ...(parsed.prototypeType ? { prototypeType: parsed.prototypeType } : {}),
    ...(parsed.firmwarePlatform
      ? { firmware: { ...request.firmware, platform: parsed.firmwarePlatform } }
      : {}),
  };
}

async function drive(run: RunState, input: StartHardwareRunInput): Promise<void> {
  run.status = "running";
  emit(run, "run.started", { brief: run.brief, model: input.model });

  // Interpretation, source-backed discovery, CAD and firmware may spend tokens;
  // the compiler and validators in between are free.
  // Each completion's usage is reported as it lands so the card can count up
  // while the run is still going.
  const spent: ChatTokenUsage[] = [];
  const onUsage = (usage: unknown) => {
    const normalized = normalizeChatTokenUsage(usage);
    if (!normalized) return;
    spent.push(normalized);
    run.usage = sumChatTokenUsage(spent);
    emit(run, "run.usage", { ...run.usage });
  };

  const safety = assessSafety(run.brief);
  if (safety.level === "refused") {
    run.status = "failed";
    const content = `${safety.category} is outside what this agent designs. ${safety.reason}`;
    emit(run, "run.failed", {
      error: content,
    });
    publishTerminal(run, { outcome: "failed", content });
    schedule(run);
    return;
  }
  if (safety.level === "concept-only") {
    emit(run, "safety.limited", { category: safety.category, reason: safety.reason });
  }

  const previousArtifact = latestHardwareArtifact({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  });
  const previousDesign = previousArtifact ? readStoredDesign(previousArtifact) : null;

  // The board, build style and toolchain the user prefers are given to the
  // model as a tie-breaker rather than forced onto the request, so a brief that
  // names its own still wins.
  const preferenceNote = input.preferences ? hardwarePreferenceNote(input.preferences) : null;

  emit(run, "interpret.started", { revising: Boolean(previousDesign) });
  const turn: HardwareTurn = await interpretTurn({
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    signal: run.controller.signal,
    onUsage,
    brief: run.brief,
    ...(input.conversationContext
      ? { conversationContext: input.conversationContext }
      : {}),
    ...(previousDesign ? { existingDesignSummary: summariseDesignForModel(previousDesign) } : {}),
    ...(preferenceNote ? { preferenceNote } : {}),
  });
  if (run.aborted) return;

  let request: HardwareProjectRequest;
  let modificationNotes: string[] = [];
  let rejectedNotes: string[] = [];

  if (turn.mode === "modify" && previousDesign && turn.modification) {
    const outcome = applyModification(previousDesign, turn.modification);
    request = outcome.request;
    modificationNotes = outcome.applied;
    rejectedNotes = outcome.rejected;
    if (turn.modification.behaviourNotes?.trim()) {
      request = { ...request, purpose: turn.modification.behaviourNotes.trim() };
    }
    emit(run, "interpret.completed", {
      mode: "modify",
      note: turn.note,
      applied: modificationNotes,
      rejected: rejectedNotes,
    });
  } else {
    if (!turn.request) {
      throw new HardwareModelError(
        "invalid_structure",
        "The model returned no structured request for a new project.",
      );
    }
    request = withRequestDefaults(turn.request);
    emit(run, "interpret.completed", { mode: "new", note: turn.note });
  }

  request = applyCommandFlags(request, input.parsed);
  if (turn.mode === "new") {
    request = groundHardwareRequest(request, run.brief);
    request = preferPcbForPortableRequest(request, {
      userBrief: run.brief,
      explicitPrototypeType: input.parsed.prototypeType,
    });
  }

  const designId = previousDesign?.id ?? `hwd_${randomUUID().replaceAll("-", "")}`;

  emit(run, "component-discovery.started", {});
  const discovery = await discoverRequestComponents({
    request,
    previous: previousDesign?.componentResearch,
    baseUrl: input.baseUrl,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    signal: run.controller.signal,
    onUsage,
  });
  if (run.aborted) return;
  emit(run, "component-discovery.completed", {
    attempted: discovery.attempted,
    used: discovery.records.filter((record) => record.status === "used").map((record) => record.requestedAs),
    unresolved: discovery.records
      .filter((record) => record.status !== "used")
      .map((record) => ({ requestedAs: record.requestedAs, status: record.status, note: record.note })),
  });

  emit(run, "compile.started", {});
  const firstPass = buildDesign({
    request,
    designId,
    safety,
    sourceBrief: run.brief,
    componentResearch: discovery.records,
  });
  if (run.aborted) return;
  emit(run, "compile.completed", {
    controller: firstPass.circuit.controllerDefinition.name,
    componentCount: firstPass.design.components.length,
    netCount: firstPass.design.nets.length,
    pins: firstPass.circuit.assignments
      .filter((assignment) => assignment.purpose !== "power" && assignment.purpose !== "ground")
      .map((assignment) => ({
        pin: assignment.controllerPinLabel,
        purpose: assignment.purpose,
      })),
  });

  const initialCounts = countBySeverity(firstPass.design.validationResults);
  emit(run, "validation.completed", {
    ...initialCounts,
    status: firstPass.design.status,
    findings: presentHardwareBlueprintFindings(firstPass.design.validationResults),
  });

  emit(run, "firmware.started", {});
  const behaviour = [
    request.purpose,
    ...modificationNotes,
    turn.modification?.behaviourNotes ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  // Application code cannot repair a missing electrical definition or driver.
  // Asking the model to write it anyway wastes a long completion and used to
  // produce confident-looking logic around parts the circuit never connected.
  const firmwareBlockedNotice = initialCounts.errors
    ? "Application logic was not generated because the electrical design has blocking validation errors. The deterministic firmware reports each unresolved part and keeps hardwareReady false."
    : "";
  const logic = initialCounts.errors
    ? null
    : await generateFirmwareLogic({
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        signal: run.controller.signal,
        onUsage,
        brief: firmwareLogicBrief(firstPass.circuit),
        behaviour,
      });
  if (run.aborted) return;

  const final = buildDesign({
    request,
    designId,
    safety,
    firmwareLogic: logic,
    sourceBrief: run.brief,
    componentResearch: discovery.records,
  });
  const firmwareNotice = final.firmwareNotice ?? firmwareBlockedNotice;
  emit(run, "firmware.completed", {
    files: final.design.firmware?.files.map((file) => file.path) ?? [],
    generated: Boolean(logic) && !firmwareNotice,
    ...(firmwareNotice ? { notice: firmwareNotice } : {}),
  });

  // A brief that asks for a case — or a clip, a mount, a strap, anything that
  // holds the circuit onto something — is asking for two deliverables. The
  // circuit is this agent's; the physical part is the Parametric CAD agent's,
  // and it is called here rather than reimplemented — the part is designed from
  // the compiled board's real footprint and the person's own words.
  // The flag decides when it is present; otherwise the brief's own wording
  // does, and the user's setting decides only when the brief is silent —
  // "always" adds one, "never" holds it back until `--enclosure` is typed.
  const detected = enclosureIntent(run.brief);
  const preferredEnclosure = input.preferences?.enclosure ?? "auto";
  const enclosure = {
    wanted:
      input.parsed.enclosure ??
      (preferredEnclosure === "never"
        ? false
        : detected.wanted || preferredEnclosure === "always"),
    remaining: detected.remaining,
  };
  // Whether there is a part and which engine builds it are two separate
  // questions, decided in that order. The `--cad` flag wins over the saved
  // preference, which wins over the default; nothing here reads the brief's
  // prose for a backend name, because a mention is not a choice.
  const cadEngine = resolveCadEngine({
    flag: input.parsed.cadBackend ?? null,
    setting: input.preferences?.cadBackend ?? "auto",
  });
  let enclosureArtifactId: string | null = null;
  let enclosureTitle = "";
  let enclosureNotice = "";
  const cadPreferences = parametricCadDefaults(
    agentSettingsFor(input.userId, "parametric-cad"),
  );
  if (enclosure.wanted) {
    let cadReady = false;
    try {
      await ensureCadServiceReady();
      cadReady = true;
    } catch (error) {
      enclosureNotice = enclosureFailureNotice(error instanceof Error ? error.message : "");
      emit(run, "enclosure.skipped", {
        reason: enclosureNotice,
        ...(error instanceof SupervisorResourceExhaustedError ? error.result : {}),
      });
    }
    if (cadReady) {
      emit(run, "enclosure.started", { engine: cadEngine.engine, backend: cadEngine.source });
      try {
        const conversation = getConversationForUser(input.conversationPublicId, input.userId);
        const controller = final.design.components.find(
          (instance) => instance.reference === "U1",
        );
        const process = cadPreferences.process ?? "fdm";
        const processDefaults = cadDefaults(process);
        const printerBed = cadPreferences.printerBed ?? processDefaults.printerBed;
        const electricalPeripherals = final.design.components
          .filter((instance) => instance.reference !== "U1")
          .map((instance) => ({
            name: instance.name,
            definitionId: instance.definitionId,
            category: componentDefinitionForDesign(final.design, instance.definitionId)?.category,
            mechanical: componentDefinitionForDesign(final.design, instance.definitionId)?.mechanical,
          }));
        const physicalPeripherals = (request.physicalParts ?? []).flatMap((part) => {
          const outcome = resolveComponentPhrase(
            part.type,
            scopedDefinitionsForDesign(final.design),
          );
          if (outcome.status !== "resolved") return [];
          return [{
            name: outcome.definition.name,
            definitionId: outcome.definition.id,
            category: outcome.definition.category,
            mechanical: outcome.definition.mechanical,
          }];
        });
        const enclosureInput = {
          userBrief: enclosure.remaining || run.brief,
          designTitle: final.design.title,
          controllerDefinitionId: controller?.definitionId ?? "",
          controllerName: final.circuit.controllerDefinition.name,
          peripherals: [...electricalPeripherals, ...physicalPeripherals].filter(
            (part, index, all) =>
              all.findIndex((candidate) => candidate.definitionId === part.definitionId) === index,
          ),
          prototypeType: request.prototypeType,
        };
        const physicalKind = physicalDesignKind(enclosureInput.userBrief);
        const resumableDraft = latestUnbuiltCadProjectForConversation({
          userId: input.userId,
          conversationId: conversation.id,
          name: final.design.title,
        });
        const cad = await designCadPart({
          userId: input.userId,
          conversationId: conversation.id,
          clusterId:
            conversation.surface === "garden_chat" ? conversation.default_garden_id : null,
          brief: enclosureBriefFromDesign(enclosureInput),
          baseUrl: input.baseUrl,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          // The case is a printed part, so it is printed the way this person's
          // Parametric CAD settings say — same process, same build volume.
          process,
          printerBed,
          engine: cadEngine.engine,
          engineExplicit: cadEngine.explicit,
          // Planning and source generation are separate bounded requests. CAD
          // must be authored for this brief and pass both kernel and product
          // acceptance. There is deliberately no canned geometry fallback: an
          // honest missing result is better than a plausible-looking wrong part.
          modelRequestTimeoutMs:
            physicalKind === "simple-enclosure" ? 180_000 : 360_000,
          modelBuildRequestTimeoutMs:
            physicalKind === "simple-enclosure" ? 180_000 : 300_000,
          maxModelBuildSteps: 2,
          // The same requirements this run publishes against, given to the
          // design service so the model is told what is missing while it still
          // has an attempt left rather than after the run has ended.
          acceptance: (manifest) => physicalDesignCoverageIssues(enclosureInput, manifest),
          ...(resumableDraft ? { existingProject: resumableDraft } : {}),
          signal: run.controller.signal,
          onUsage,
          emit: (type, payload) => emit(run, type, payload),
        });
        if (run.aborted) return;
        if (cad.ok) {
          const kernelIssues = cad.manifest.validation.issues.filter(
            (issue) => issue.severity === "error",
          );
          // Already measured against the published manifest inside the design
          // service, which is where the model repair decisions were made.
          const acceptanceIssues = [...kernelIssues, ...cad.acceptanceIssues];
          if (!cad.manifest.validation.passed || acceptanceIssues.length) {
            const missing = acceptanceIssues
              .slice(0, 4)
              .map((issue) => issue.feature ?? issue.message)
              .join(", ");
            enclosureNotice =
              "The CAD geometry built, but it did not pass geometric and physical-design acceptance, so it was not published as a completed design. " +
              `Issues: ${missing}${acceptanceIssues.length > 4 ? ` (+${acceptanceIssues.length - 4} more)` : ""}.`;
            emit(run, "enclosure.failed", {
              reason: enclosureNotice,
              kind: physicalKind,
              issues: acceptanceIssues,
            });
          } else {
            enclosureTitle = cad.manifest.title;
            const cadContext = openCadArtifactContext({
              userId: input.userId,
              conversationPublicId: input.conversationPublicId,
              brief: run.brief,
              agentRunId: run.runId,
            });
            try {
              if (cadContext) {
                const cadArtifact = await publishCadDesign({
                  context: cadContext,
                  manifest: cad.manifest,
                });
                enclosureArtifactId = cadArtifact?.id ?? null;
              }
            } finally {
              closeCadArtifactContext(cadContext, "completed");
            }
            emit(run, "enclosure.completed", {
              title: cad.manifest.title,
              status: cad.manifest.status,
              boundingBox: cad.manifest.measurements.boundingBox,
              artifactId: enclosureArtifactId,
            });
          }
        } else {
          enclosureNotice = enclosureFailureNotice(cad.reason);
          emit(run, "enclosure.failed", { reason: enclosureNotice });
        }
      } catch (error) {
        // A stopped run says so once, in its own event. Reporting a failed
        // enclosure on the way out would name the abort as a fault.
        if (run.aborted) return;
        // A circuit that compiled is still a deliverable. An enclosure that
        // could not be designed is reported, never fatal.
        enclosureNotice = enclosureFailureNotice(
          error instanceof Error ? error.message : "",
        );
        emit(run, "enclosure.failed", { reason: enclosureNotice });
      }
    }
  }

  if (enclosure.wanted && !enclosureArtifactId) {
    markPhysicalDesignIncomplete(final.design, enclosureNotice);
  }

  let context: HardwareArtifactContext | null = null;
  let artifactId: string | null = null;
  try {
    context = openHardwareArtifactContext({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      brief: run.brief,
      agentRunId: run.runId,
    });
    if (context) {
      const artifact = await publishHardwareDesign({
        context,
        design: final.design,
        previousArtifactId: previousDesign ? previousArtifact?.id ?? null : null,
      });
      artifactId = artifact?.id ?? null;
      if (artifact) {
        emit(run, "artifact.ready", {
          artifactId: artifact.id,
          title: artifact.title,
          version: artifact.current_version,
        });
      }
    }
  } finally {
    closeHardwareArtifactContext(context, "completed");
  }

  if (!artifactId) {
    emit(run, "artifact.unavailable", {
      reason:
        "The blueprint was compiled but could not be stored as an artifact in this conversation.",
    });
  }

  const elapsedMs = Date.now() - run.createdAt;
  const summary = chatSummary({
    design: final.design,
    artifactId,
    modificationNotes,
    rejectedNotes,
    note: turn.note,
    enclosureTitle,
    enclosureNotice,
  });
  const counts = countBySeverity(final.design.validationResults);
  const findings = presentHardwareBlueprintFindings(final.design.validationResults);
  const firmwareFiles = final.design.firmware?.files.map((file) => file.path) ?? [];
  const usage = { ...sumChatTokenUsage(spent), responseDurationMs: elapsedMs };
  run.usage = usage;
  run.status = "completed";
  emit(run, "run.completed", {
    summary,
    status: final.design.status,
    ...counts,
    // The card shows the findings themselves, not just how many there were, so
    // a finished run still explains what it wants you to look at.
    findings,
    designTitle: final.design.title,
    designSummary: final.design.summary,
    partCount: final.design.components.length,
    netCount: final.design.nets.length,
    controller: final.circuit.controllerDefinition.name,
    typicalCurrentMa: Math.round(final.circuit.currentEstimate.totalTypicalMa),
    firmwareFiles,
    artifactId,
    enclosureArtifactId,
    enclosureTitle,
    elapsedSec: elapsedMs / 1_000,
    usage,
  });
  const state = hardwareBlueprintRunCardState(final.design, {
    note: [turn.note, ...modificationNotes].filter(Boolean).join(" ").slice(0, 400),
    safetyNotice:
      safety.level === "concept-only"
        ? `${safety.category} — ${safety.reason}`
        : "",
    pins: final.circuit.assignments
      .filter((assignment) => assignment.purpose !== "power" && assignment.purpose !== "ground")
      .map((assignment) => ({
        pin: assignment.controllerPinLabel,
        purpose: assignment.purpose,
      })),
    controllerName: final.circuit.controllerDefinition.name,
    typicalCurrentMa: final.circuit.currentEstimate.totalTypicalMa,
    firmwareNotice,
    enclosureTitle,
    enclosureNotice,
    startedAt: run.events.find((event) => event.type === "run.started")?.at,
    completedAt: run.events.at(-1)?.at,
  });
  // The disposable worker is the only process that can derive this state.
  // Carry it in the sealed projection so transcript persistence never has to
  // rerun compiler logic in Next.js.
  const terminalEvent = run.events.at(-1);
  if (terminalEvent?.type === "run.completed") terminalEvent.payload.state = state;
  publishTerminal(run, {
    outcome: "completed",
    content: summary,
    usage,
    state,
  });
  schedule(run);
}

/**
 * The physical-design pass failed; the circuit did not.
 *
 * One string is printed in two places — the run card's Physical design line and the
 * chat reply — so it has to stand on its own in both, which a bare detail like
 * "fetch failed" never did: it named nothing, and next to a finished circuit it
 * read as though the whole run had broken. The lead says what was lost and what
 * survived; whatever the failure knew about itself follows it.
 */
function enclosureFailureNotice(detail: string): string {
  const lead = "The physical design could not be completed, so only the circuit was produced.";
  const trimmed = detail.trim();
  return trimmed ? `${lead} ${trimmed}` : lead;
}

function markPhysicalDesignIncomplete(design: HardwareDesign, detail: string): void {
  if (
    !design.validationResults.some(
      (result) => result.rule === "PHYSICAL_DESIGN_INCOMPLETE",
    )
  ) {
    design.validationResults.push({
      id: "physical_design_incomplete",
      rule: "PHYSICAL_DESIGN_INCOMPLETE",
      severity: "error",
      title: "The requested physical design is incomplete",
      message:
        detail.trim() ||
        "The circuit compiled, but its requested physical part did not pass CAD acceptance.",
      componentIds: [],
      netIds: [],
      remediation:
        "Complete and validate the physical CAD requirements before treating this product as build-ready.",
    });
  }
  if (design.status === "ready" || design.status === "ready-with-warnings") {
    design.status = "needs-changes";
  }
  const counts = countBySeverity(design.validationResults);
  const validationLine = `${counts.errors} error${
    counts.errors === 1 ? "" : "s"
  } must be resolved before building.`;
  const priorValidationLine =
    /(?:Validation found nothing to fix\.|\d+ warnings? to read before building\.|\d+ errors? must be resolved before building\.)$/;
  design.summary = priorValidationLine.test(design.summary)
    ? design.summary.replace(priorValidationLine, validationLine)
    : `${design.summary} ${validationLine}`;
}

/**
 * The chat reply. Deliberately short: the artifact is the deliverable, and the
 * transcript should point at it rather than restate it.
 */
function chatSummary(input: {
  design: HardwareDesign;
  artifactId: string | null;
  modificationNotes: string[];
  rejectedNotes: string[];
  note: string;
  enclosureTitle?: string;
  enclosureNotice?: string;
}): string {
  const counts = countBySeverity(input.design.validationResults);
  const statusLine =
    input.design.status === "ready"
      ? "Validation found nothing to fix."
      : input.design.status === "ready-with-warnings"
        ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"} to read before building.`
        : input.design.status === "concept-only"
          ? "Parts of this request fall outside what the agent will design as a build-ready circuit, so it is a concept only."
          : `${counts.errors} error${counts.errors === 1 ? "" : "s"} to resolve before building.`;

  return [
    `**${input.design.title}** — ${statusLine}`,
    input.modificationNotes.length ? `Changes applied: ${input.modificationNotes.join(" ")}` : "",
    input.rejectedNotes.length ? `Not applied: ${input.rejectedNotes.join(" ")}` : "",
    // When the blueprint attached, its own card sits directly under this reply
    // with an open button on it — telling the reader to open it would just be
    // caption for a button they can already see. Only its absence is news.
    input.enclosureTitle
      ? `The Parametric CAD agent designed **${input.enclosureTitle}** to go with it; its own card sits below.`
      : "",
    input.enclosureNotice ?? "",
    input.artifactId
      ? ""
      : "The blueprint could not be attached to this conversation as an artifact.",
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

export function getRuntimeWorkerEventsSince(
  userId: number,
  runId: string,
  since = 0,
): HardwareRunEvent[] {
  return requireRun(userId, runId).events.filter((event) => event.sequenceNumber > since);
}

export function isRuntimeWorkerTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(requireRun(userId, runId).status);
}

/**
 * Persist a background result even when its card was unmounted by a chat
 * switch. A very fast run is replayed immediately after the handler attaches.
 */
export function setRuntimeWorkerTerminalHandler(
  userId: number,
  runId: string,
  handler: (result: HardwareTerminalResult) => void,
): void {
  const run = requireRun(userId, runId);
  run.terminalHandler = handler;
  if (run.terminalResult) handler(run.terminalResult);
}

export function abortRuntimeWorkerRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort();
  const content = "The hardware blueprint run was stopped.";
  emit(run, "run.aborted", { summary: content });
  publishTerminal(run, {
    outcome: "aborted",
    content,
    ...(run.usage ? { usage: run.usage } : {}),
  });
  schedule(run);
  return true;
}
