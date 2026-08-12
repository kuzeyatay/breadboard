// The ApprovalQueue implementation, plus gadget publication.
//
// Read `authorizeObservation` and `submitAction` next to each other — the
// asymmetry between them is the entire design:
//
//   authorizeObservation  runs the read, records it, returns the data. Now.
//   submitAction          describes, simulates, queues, returns. The write has
//                         NOT happened and will not happen until someone
//                         approves it and `applyApprovedAction` runs.
//
// Nothing on the submit path calls `apply`. If a change ever makes it do so,
// the queue has become a slower way of doing the thing immediately.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  createArtifact,
  getArtifactById,
  publishValidatedArtifactVersion,
  readArtifactSource,
  recordArtifactPipelineEvent,
  type ArtifactRow,
} from "./artifact-store.ts";
import { gadgetBindingHandler } from "./gadget-bindings.ts";
import { renderGadgetDocument } from "./gadget-runtime.ts";
import { GENERATE_GADGET_SKILL } from "./gadget-skills.ts";
import {
  createGadgetRecord,
  decideGadgetAction,
  gadgetActionPayload,
  gadgetBindings,
  gadgetManifest,
  GadgetStoreError,
  getGadgetAction,
  markGadgetActionApplied,
  markGadgetActionFailed,
  markGadgetActionReverted,
  recordGadgetObservation,
  requireGadgetRecord,
  submitGadgetAction,
  updateGadgetLifecycle,
} from "./gadget-store.ts";
import { parseStoredGadget, validateGadgetPackage } from "./gadget-validator.ts";
import type {
  GadgetAction,
  GadgetBinding,
  GadgetBindingContext,
  GadgetPackage,
} from "./gadget-types.ts";

export class GadgetServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GadgetServiceError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Assemble the context a binding handler runs in, from the gadget's own
 * artifact row. Everything here is server-resolved: nothing a gadget sends can
 * influence which user, conversation, or session its call is attributed to.
 */
function bindingContext(
  artifact: ArtifactRow,
  binding: GadgetBinding,
): GadgetBindingContext {
  return {
    userId: artifact.user_id,
    gadgetArtifactId: artifact.id,
    conversationId: artifact.conversation_id,
    conversationPublicId: artifact.conversation_public_id ?? "",
    clusterId: artifact.cluster_id,
    surface: artifact.source_surface,
    runtimeSessionId: artifact.runtime_session_id,
    hermesSessionId: artifact.hermes_session_id,
    runId: artifact.originating_run_id,
    binding,
  };
}

function resolveBinding(
  artifactId: string,
  bindingName: string,
  database: Database.Database,
): { artifact: ArtifactRow; binding: GadgetBinding } {
  const artifact = getArtifactById(artifactId, database);
  if (!artifact || artifact.renderer_id !== "gadget") {
    throw new GadgetServiceError(404, "gadget_not_found", "That gadget does not exist.");
  }
  const record = requireGadgetRecord(artifactId, database);
  const binding = gadgetBindings(record).find((entry) => entry.name === bindingName);
  if (!binding) {
    throw new GadgetServiceError(
      403,
      "binding_not_declared",
      `This gadget did not declare a binding named "${bindingName}".`,
    );
  }
  return { artifact, binding };
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/**
 * Authorize, perform, and record one read.
 *
 * Upstream's note applies verbatim: the read is executed first so the recorded
 * description can name what was actually seen, and it is recorded before the
 * data is returned. As long as the operation is genuinely read-only, that
 * ordering is safe and produces a far more useful log.
 */
export async function authorizeGadgetObservation(input: {
  artifactId: string;
  binding: string;
  operation: string;
  payload: unknown;
  database?: Database.Database;
}): Promise<{ result: unknown }> {
  const database = input.database ?? db;
  const { artifact, binding } = resolveBinding(input.artifactId, input.binding, database);
  const handler = gadgetBindingHandler(binding.kind);
  const observation = handler.observations[input.operation];
  if (!observation) {
    throw new GadgetServiceError(
      400,
      "unknown_operation",
      `"${input.operation}" is not a read this binding offers.`,
    );
  }
  const { description, result } = await observation({
    payload: input.payload,
    context: bindingContext(artifact, binding),
  });
  recordGadgetObservation({ artifactId: input.artifactId, description, database });
  return { result };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Describe, simulate, and queue one write. Returns immediately.
 *
 * The simulation runs here, on the submit path, on every action — including the
 * ones nobody ever approves. That is deliberate: the simulation is what the
 * approval card shows, so it has to exist before there is anything to approve.
 */
export async function submitGadgetActionForApproval(input: {
  artifactId: string;
  binding: string;
  operation: string;
  payload: unknown;
  database?: Database.Database;
}): Promise<{
  actionId: string;
  status: GadgetAction["status"];
  simulated: unknown;
  outcome: string;
}> {
  const database = input.database ?? db;
  const { artifact, binding } = resolveBinding(input.artifactId, input.binding, database);
  if (!binding.writable) {
    throw new GadgetServiceError(
      403,
      "binding_read_only",
      `The binding "${binding.name}" is declared read-only, so it cannot perform "${input.operation}".`,
    );
  }
  const handler = gadgetBindingHandler(binding.kind);
  const action = handler.actions[input.operation];
  if (!action) {
    throw new GadgetServiceError(
      400,
      "unknown_operation",
      `"${input.operation}" is not a write this binding offers.`,
    );
  }
  const context = bindingContext(artifact, binding);
  const description = action.describe({ payload: input.payload, context });
  const simulation = await action.simulate({ payload: input.payload, context });

  // A write whose outcome cannot even be predicted is not one a user can give
  // informed consent to, so it never reaches the queue.
  if (!simulation.ok) {
    throw new GadgetServiceError(
      422,
      "action_not_simulatable",
      simulation.error ?? "This action could not be simulated, so it was not queued.",
    );
  }

  // `implementsRevert` is a promise made to the approval UI, which offers an
  // undo button on the strength of it. Catching the mismatch here keeps that
  // button from appearing over a handler that has no revert.
  if (description.implementsRevert && typeof action.revert !== "function") {
    throw new GadgetServiceError(
      500,
      "revert_contract_violation",
      `The "${input.operation}" action claims it can be reverted but implements no revert.`,
    );
  }

  const queued = submitGadgetAction({
    artifactId: input.artifactId,
    description,
    payload: input.payload,
    simulation,
    database,
  });

  recordArtifactPipelineEvent({
    artifact,
    type: "gadget_action_submitted",
    status: artifact.status,
    version: artifact.current_version,
    payload: {
      actionId: queued.id,
      title: description.title,
      actionKind: description.actionKind.tag,
      autoApproved: queued.autoApplied,
    },
    runId: artifact.originating_run_id,
    assistantMessageId: null,
    database,
  });

  return {
    actionId: queued.id,
    status: queued.status,
    simulated: simulation.simulatedResult,
    outcome: simulation.outcome,
  };
}

/**
 * Perform an action the user approved. Separate from the decision on purpose:
 * a write that fails leaves a failed row the user can retry, and never looks
 * like a decision that did not happen.
 */
export async function applyApprovedAction(input: {
  actionId: string;
  database?: Database.Database;
}): Promise<GadgetAction> {
  const database = input.database ?? db;
  const queued = getGadgetAction(input.actionId, database);
  if (!queued) {
    throw new GadgetServiceError(404, "action_not_found", "That action does not exist.");
  }
  if (queued.status !== "approved") {
    throw new GadgetServiceError(
      409,
      "action_not_approved",
      `Only an approved action can be applied; this one is ${queued.status}.`,
    );
  }
  const { artifact, binding } = resolveBinding(
    queued.gadgetArtifactId,
    queued.description.binding,
    database,
  );
  const handler = gadgetBindingHandler(binding.kind);
  const action = handler.actions[queued.description.operation];
  if (!action) {
    throw new GadgetServiceError(
      500,
      "operation_unavailable",
      "The operation this action used no longer exists.",
    );
  }
  const payload = gadgetActionPayload(input.actionId, database);
  try {
    const result = await action.apply({
      payload,
      context: bindingContext(artifact, binding),
    });
    const applied = markGadgetActionApplied({ actionId: input.actionId, result, database });
    recordArtifactPipelineEvent({
      artifact,
      type: "gadget_action_applied",
      status: artifact.status,
      version: artifact.current_version,
      payload: { actionId: input.actionId, title: queued.description.title },
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      database,
    });
    return applied;
  } catch (cause) {
    const failed = markGadgetActionFailed({
      actionId: input.actionId,
      error: {
        code: "apply_failed",
        message: cause instanceof Error ? cause.message : "The action could not be applied.",
      },
      database,
    });
    recordArtifactPipelineEvent({
      artifact,
      type: "gadget_action_apply_failed",
      status: artifact.status,
      version: artifact.current_version,
      payload: {
        actionId: input.actionId,
        message: cause instanceof Error ? cause.message : "unknown",
      },
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      database,
    });
    return failed;
  }
}

/** Record a decision, and apply it in the same call when it was an approval. */
export async function decideAndApply(input: {
  actionId: string;
  decision: "approved" | "rejected";
  database?: Database.Database;
}): Promise<GadgetAction> {
  const database = input.database ?? db;
  const decided = decideGadgetAction({
    actionId: input.actionId,
    decision: input.decision,
    database,
  });
  const artifact = getArtifactById(decided.gadgetArtifactId, database);
  if (artifact) {
    recordArtifactPipelineEvent({
      artifact,
      type:
        input.decision === "approved" ? "gadget_action_approved" : "gadget_action_rejected",
      status: artifact.status,
      version: artifact.current_version,
      payload: { actionId: input.actionId, title: decided.description.title },
      runId: artifact.originating_run_id,
      assistantMessageId: null,
      database,
    });
  }
  if (input.decision === "rejected") return decided;
  return applyApprovedAction({ actionId: input.actionId, database });
}

/** Undo an action that was already applied, where the binding supports it. */
export async function revertAppliedAction(input: {
  actionId: string;
  database?: Database.Database;
}): Promise<{ action: GadgetAction; message?: string; canRetry?: boolean }> {
  const database = input.database ?? db;
  const applied = getGadgetAction(input.actionId, database);
  if (!applied) {
    throw new GadgetServiceError(404, "action_not_found", "That action does not exist.");
  }
  if (applied.status !== "applied") {
    throw new GadgetServiceError(
      409,
      "action_not_applied",
      `Only an applied action can be reverted; this one is ${applied.status}.`,
    );
  }
  const { artifact, binding } = resolveBinding(
    applied.gadgetArtifactId,
    applied.description.binding,
    database,
  );
  const handler = gadgetBindingHandler(binding.kind);
  const action = handler.actions[applied.description.operation];
  if (!action?.revert) {
    // Upstream's behaviour: say so plainly and let the user undo it by hand,
    // using the description they already approved.
    throw new GadgetServiceError(
      422,
      "revert_unsupported",
      "This action cannot be undone automatically. Its description says exactly what it did.",
    );
  }
  const outcome = await action.revert({
    payload: gadgetActionPayload(input.actionId, database),
    appliedResult: applied.appliedResult,
    context: bindingContext(artifact, binding),
  });
  if (outcome.canRetry) {
    return { action: applied, message: outcome.message, canRetry: true };
  }
  const reverted = markGadgetActionReverted({ actionId: input.actionId, database });
  recordArtifactPipelineEvent({
    artifact,
    type: "gadget_action_reverted",
    status: artifact.status,
    version: artifact.current_version,
    payload: { actionId: input.actionId, title: applied.description.title },
    runId: artifact.originating_run_id,
    assistantMessageId: null,
    database,
  });
  return { action: reverted, message: outcome.message };
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

function gadgetFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "gadget"}.json`;
}

/**
 * Validate and publish a new gadget. The package is stored as the artifact
 * source and the rendered document as its output, so opening a gadget is a file
 * read rather than a regeneration.
 */
export function publishGadget(input: {
  userId: number;
  runtimeSessionId: number;
  hermesSessionId: string;
  conversationId: number;
  clusterId: number | null;
  runId: string;
  assistantMessageId: number | null;
  toolCallId?: string | null;
  surface: "dashboard_terminal" | "garden_chat";
  package: unknown;
  database?: Database.Database;
}): { artifact: ArtifactRow; gadget: GadgetPackage } {
  const database = input.database ?? db;
  const { validation, value } = validateGadgetPackage(input.package);
  if (!validation.valid || !value) {
    throw new GadgetServiceError(
      422,
      "gadget_invalid",
      `The gadget was rejected: ${validation.errors.join("; ")}`,
    );
  }
  const source = JSON.stringify(value, null, 2);
  const artifact = createArtifact({
    userId: input.userId,
    runtimeSessionId: input.runtimeSessionId,
    hermesSessionId: input.hermesSessionId,
    conversationId: input.conversationId,
    clusterId: input.clusterId,
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    toolCallId: input.toolCallId ?? null,
    surface: input.surface,
    kind: "gadget",
    rendererId: "gadget",
    title: value.manifest.title,
    filename: gadgetFilename(value.manifest.title),
    content: source,
    metadata: {
      purpose: value.manifest.purpose,
      bindings: value.manifest.bindings,
      assumptions: value.assumptions,
      limitations: value.limitations,
      warnings: validation.warnings,
    },
    sourceSkill: GENERATE_GADGET_SKILL,
    database,
  });
  createGadgetRecord({
    artifactId: artifact.id,
    manifest: value.manifest,
    lifecycleStatus: "ready",
    database,
  });
  updateGadgetLifecycle({
    artifactId: artifact.id,
    status: "ready",
    activeVersion: artifact.current_version,
    database,
  });
  recordArtifactPipelineEvent({
    artifact,
    type: "gadget_ready",
    status: "ready",
    version: artifact.current_version,
    payload: { title: value.manifest.title, bindings: value.manifest.bindings.length },
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    database,
  });
  return { artifact: getArtifactById(artifact.id, database)!, gadget: value };
}

/** Replace a gadget's code with a new validated version, keeping its history. */
export function reviseGadget(input: {
  artifactId: string;
  userId: number;
  package: unknown;
  runId: string;
  assistantMessageId: number | null;
  database?: Database.Database;
}): { artifact: ArtifactRow; gadget: GadgetPackage } {
  const database = input.database ?? db;
  const artifact = getArtifactById(input.artifactId, database);
  if (!artifact || artifact.user_id !== input.userId || artifact.renderer_id !== "gadget") {
    throw new GadgetServiceError(404, "gadget_not_found", "That gadget does not exist.");
  }
  const { validation, value } = validateGadgetPackage(input.package);
  if (!validation.valid || !value) {
    throw new GadgetServiceError(
      422,
      "gadget_invalid",
      `The revision was rejected, so the previous version is still active: ${validation.errors.join("; ")}`,
    );
  }
  const nextVersion = artifact.current_version + 1;
  const published = publishValidatedArtifactVersion({
    artifact,
    version: nextVersion,
    expectedCurrentVersion: artifact.current_version,
    sourceContent: JSON.stringify(value, null, 2),
    outputContent: JSON.stringify(value, null, 2),
    metadata: {
      purpose: value.manifest.purpose,
      bindings: value.manifest.bindings,
      assumptions: value.assumptions,
      limitations: value.limitations,
      warnings: validation.warnings,
    },
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    database,
  });
  updateGadgetLifecycle({
    artifactId: input.artifactId,
    status: "ready",
    manifest: value.manifest,
    activeVersion: nextVersion,
    error: null,
    database,
  });
  recordArtifactPipelineEvent({
    artifact: published,
    type: "gadget_revised",
    status: "ready",
    version: nextVersion,
    payload: { title: value.manifest.title },
    runId: input.runId,
    assistantMessageId: input.assistantMessageId,
    database,
  });
  return { artifact: published, gadget: value };
}

/** Read a stored gadget back, for the viewer and the host bridge. */
export function loadGadget(
  artifactId: string,
  database: Database.Database = db,
): { artifact: ArtifactRow; gadget: GadgetPackage } {
  const artifact = getArtifactById(artifactId, database);
  if (!artifact || artifact.renderer_id !== "gadget") {
    throw new GadgetServiceError(404, "gadget_not_found", "That gadget does not exist.");
  }
  const parsed = parseStoredGadget(JSON.parse(readArtifactSource(artifact)));
  if (!parsed.ok || !parsed.value) {
    throw new GadgetServiceError(
      500,
      "gadget_corrupt",
      `This gadget's stored package is not valid: ${parsed.issues.join("; ")}`,
    );
  }
  return { artifact, gadget: parsed.value };
}

/** The complete sandbox document for one stored gadget. */
export function renderStoredGadget(
  artifactId: string,
  database: Database.Database = db,
): string {
  return renderGadgetDocument(loadGadget(artifactId, database).gadget);
}

export { GadgetStoreError, randomUUID, gadgetManifest };
