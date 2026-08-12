// Persistence for gadgets and their approval queue.
//
// The queue is the load-bearing part. `submitAction` writes a row and returns;
// it never performs the write it describes. Applying happens later, from a user
// decision, in `applyGadgetAction`. Nothing in this file calls a binding's
// `apply` on the submit path — that separation is the whole guarantee, so it is
// worth checking any change against it.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  GADGET_MAX_PENDING_ACTIONS,
  type GadgetAction,
  type GadgetActionDescription,
  type GadgetActionSimulation,
  type GadgetActionStatus,
  type GadgetAutoApprovalRule,
  type GadgetBinding,
  type GadgetManifest,
  type GadgetObservation,
  type GadgetObservationDescription,
} from "./gadget-types.ts";

export class GadgetStoreError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GadgetStoreError";
    this.status = status;
    this.code = code;
  }
}

export type GadgetLifecycleStatus = "generating" | "validating" | "ready" | "failed";

export interface GadgetRow {
  artifact_id: string;
  schema_version: number;
  lifecycle_status: GadgetLifecycleStatus;
  manifest_json: string;
  bindings_json: string;
  active_version: number;
  next_action_sequence: number;
  next_observation_sequence: number;
  repair_attempt: number;
  last_error_json: string | null;
  created_at: string;
  updated_at: string;
}

interface GadgetActionRow {
  id: string;
  gadget_artifact_id: string;
  sequence: number;
  status: GadgetActionStatus;
  binding: string;
  operation: string;
  action_kind_tag: string;
  action_kind_label: string;
  description_json: string;
  payload_json: string;
  simulation_json: string;
  applied_result_json: string | null;
  error_json: string | null;
  auto_applied: number;
  submitted_at: string;
  decided_at: string | null;
  applied_at: string | null;
  reverted_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function presentAction(row: GadgetActionRow): GadgetAction {
  return {
    id: row.id,
    gadgetArtifactId: row.gadget_artifact_id,
    sequence: row.sequence,
    status: row.status,
    description: JSON.parse(row.description_json) as GadgetActionDescription,
    simulation: JSON.parse(row.simulation_json) as GadgetActionSimulation,
    appliedResult: row.applied_result_json ? JSON.parse(row.applied_result_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    autoApplied: row.auto_applied === 1,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
  };
}

// ---------------------------------------------------------------------------
// Gadget records
// ---------------------------------------------------------------------------

export function createGadgetRecord(input: {
  artifactId: string;
  manifest: GadgetManifest;
  lifecycleStatus?: GadgetLifecycleStatus;
  database?: Database.Database;
}): GadgetRow {
  const database = input.database ?? db;
  const timestamp = nowIso();
  database
    .prepare(
      `INSERT INTO hermes_gadgets (
         artifact_id, schema_version, lifecycle_status, manifest_json,
         bindings_json, active_version, created_at, updated_at
       ) VALUES (?, 1, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(artifact_id) DO UPDATE SET
         lifecycle_status = excluded.lifecycle_status,
         manifest_json = excluded.manifest_json,
         bindings_json = excluded.bindings_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.artifactId,
      input.lifecycleStatus ?? "generating",
      JSON.stringify(input.manifest),
      JSON.stringify(input.manifest.bindings),
      timestamp,
      timestamp,
    );
  return getGadgetRecord(input.artifactId, database)!;
}

export function getGadgetRecord(
  artifactId: string,
  database: Database.Database = db,
): GadgetRow | null {
  return (
    (database
      .prepare("SELECT * FROM hermes_gadgets WHERE artifact_id = ?")
      .get(artifactId) as GadgetRow | undefined) ?? null
  );
}

export function requireGadgetRecord(
  artifactId: string,
  database: Database.Database = db,
): GadgetRow {
  const row = getGadgetRecord(artifactId, database);
  if (!row) {
    throw new GadgetStoreError(404, "gadget_not_found", "That gadget does not exist.");
  }
  return row;
}

export function updateGadgetLifecycle(input: {
  artifactId: string;
  status: GadgetLifecycleStatus;
  manifest?: GadgetManifest;
  activeVersion?: number;
  error?: { code: string; message: string } | null;
  database?: Database.Database;
}): void {
  const database = input.database ?? db;
  const current = requireGadgetRecord(input.artifactId, database);
  database
    .prepare(
      `UPDATE hermes_gadgets
         SET lifecycle_status = ?, manifest_json = ?, bindings_json = ?,
             active_version = ?, last_error_json = ?, updated_at = ?
       WHERE artifact_id = ?`,
    )
    .run(
      input.status,
      input.manifest ? JSON.stringify(input.manifest) : current.manifest_json,
      input.manifest
        ? JSON.stringify(input.manifest.bindings)
        : current.bindings_json,
      input.activeVersion ?? current.active_version,
      input.error === undefined
        ? current.last_error_json
        : input.error
          ? JSON.stringify(input.error)
          : null,
      nowIso(),
      input.artifactId,
    );
}

export function gadgetBindings(row: GadgetRow): GadgetBinding[] {
  try {
    const parsed = JSON.parse(row.bindings_json);
    return Array.isArray(parsed) ? (parsed as GadgetBinding[]) : [];
  } catch {
    return [];
  }
}

export function gadgetManifest(row: GadgetRow): GadgetManifest {
  return JSON.parse(row.manifest_json) as GadgetManifest;
}

// ---------------------------------------------------------------------------
// Observations — reads, recorded after authorization
// ---------------------------------------------------------------------------

export function recordGadgetObservation(input: {
  artifactId: string;
  description: GadgetObservationDescription;
  database?: Database.Database;
}): GadgetObservation {
  const database = input.database ?? db;
  const id = `gobs_${randomUUID()}`;
  const observedAt = nowIso();
  const sequence = database.transaction(() => {
    const row = database
      .prepare("SELECT next_observation_sequence FROM hermes_gadgets WHERE artifact_id = ?")
      .get(input.artifactId) as { next_observation_sequence: number } | undefined;
    if (!row) {
      throw new GadgetStoreError(404, "gadget_not_found", "That gadget does not exist.");
    }
    database
      .prepare(
        "UPDATE hermes_gadgets SET next_observation_sequence = ?, updated_at = ? WHERE artifact_id = ?",
      )
      .run(row.next_observation_sequence + 1, observedAt, input.artifactId);
    database
      .prepare(
        `INSERT INTO hermes_gadget_observations (
           id, gadget_artifact_id, sequence, binding, operation, description_json, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.artifactId,
        row.next_observation_sequence,
        input.description.binding,
        input.description.operation,
        JSON.stringify(input.description),
        observedAt,
      );
    return row.next_observation_sequence;
  }).immediate();
  return {
    id,
    gadgetArtifactId: input.artifactId,
    sequence,
    description: input.description,
    observedAt,
  };
}

export function listGadgetObservations(input: {
  artifactId: string;
  limit?: number;
  database?: Database.Database;
}): GadgetObservation[] {
  const database = input.database ?? db;
  const rows = database
    .prepare(
      `SELECT * FROM hermes_gadget_observations
       WHERE gadget_artifact_id = ?
       ORDER BY sequence DESC LIMIT ?`,
    )
    .all(input.artifactId, Math.min(input.limit ?? 100, 500)) as Array<{
    id: string;
    gadget_artifact_id: string;
    sequence: number;
    description_json: string;
    observed_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    gadgetArtifactId: row.gadget_artifact_id,
    sequence: row.sequence,
    description: JSON.parse(row.description_json) as GadgetObservationDescription,
    observedAt: row.observed_at,
  }));
}

// ---------------------------------------------------------------------------
// Actions — the approval queue
// ---------------------------------------------------------------------------

/**
 * Queue one action. Returns as soon as the row is written: this is the
 * asynchronous half of the contract, and the caller gets the simulation to hand
 * back to the gadget so it can carry on.
 *
 * The action is NOT performed here under any circumstance, including when it is
 * auto-approved — an auto-approved action is still queued, and still applied
 * through `applyGadgetAction`, so the audit trail is identical either way.
 */
export function submitGadgetAction(input: {
  artifactId: string;
  description: GadgetActionDescription;
  payload: unknown;
  simulation: GadgetActionSimulation;
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  const id = `gact_${randomUUID()}`;
  const submittedAt = nowIso();

  const autoApprovable =
    input.description.autoApprovable === true &&
    hasAutoApprovalRule({
      artifactId: input.artifactId,
      actionKindTag: input.description.actionKind.tag,
      database,
    });

  const sequence = database.transaction(() => {
    const gadget = database
      .prepare("SELECT next_action_sequence FROM hermes_gadgets WHERE artifact_id = ?")
      .get(input.artifactId) as { next_action_sequence: number } | undefined;
    if (!gadget) {
      throw new GadgetStoreError(404, "gadget_not_found", "That gadget does not exist.");
    }
    const pending = database
      .prepare(
        "SELECT COUNT(*) AS count FROM hermes_gadget_actions WHERE gadget_artifact_id = ? AND status = 'pending'",
      )
      .get(input.artifactId) as { count: number };
    // An unbounded queue is an unreviewable one. Refusing here keeps a runaway
    // gadget from burying a real decision under a thousand generated ones.
    if (pending.count >= GADGET_MAX_PENDING_ACTIONS) {
      throw new GadgetStoreError(
        429,
        "gadget_queue_full",
        `This gadget already has ${pending.count} actions waiting for a decision.`,
      );
    }
    database
      .prepare(
        "UPDATE hermes_gadgets SET next_action_sequence = ?, updated_at = ? WHERE artifact_id = ?",
      )
      .run(gadget.next_action_sequence + 1, submittedAt, input.artifactId);
    database
      .prepare(
        `INSERT INTO hermes_gadget_actions (
           id, gadget_artifact_id, sequence, status, binding, operation,
           action_kind_tag, action_kind_label, description_json, payload_json,
           simulation_json, auto_applied, submitted_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.artifactId,
        gadget.next_action_sequence,
        autoApprovable ? "approved" : "pending",
        input.description.binding,
        input.description.operation,
        input.description.actionKind.tag,
        input.description.actionKind.label,
        JSON.stringify(input.description),
        JSON.stringify(input.payload ?? null),
        JSON.stringify(input.simulation),
        autoApprovable ? 1 : 0,
        submittedAt,
        autoApprovable ? submittedAt : null,
      );
    return gadget.next_action_sequence;
  }).immediate();

  return presentAction(
    database
      .prepare("SELECT * FROM hermes_gadget_actions WHERE id = ?")
      .get(id) as GadgetActionRow,
  );
}

export function getGadgetAction(
  actionId: string,
  database: Database.Database = db,
): GadgetAction | null {
  const row = database
    .prepare("SELECT * FROM hermes_gadget_actions WHERE id = ?")
    .get(actionId) as GadgetActionRow | undefined;
  return row ? presentAction(row) : null;
}

/** The verbatim arguments, needed only when an action is applied or reverted. */
export function gadgetActionPayload(
  actionId: string,
  database: Database.Database = db,
): unknown {
  const row = database
    .prepare("SELECT payload_json FROM hermes_gadget_actions WHERE id = ?")
    .get(actionId) as { payload_json: string } | undefined;
  return row ? JSON.parse(row.payload_json) : null;
}

export function listGadgetActions(input: {
  artifactId: string;
  status?: GadgetActionStatus;
  limit?: number;
  database?: Database.Database;
}): GadgetAction[] {
  const database = input.database ?? db;
  const limit = Math.min(input.limit ?? 100, 500);
  const rows = (
    input.status
      ? database
          .prepare(
            `SELECT * FROM hermes_gadget_actions
             WHERE gadget_artifact_id = ? AND status = ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(input.artifactId, input.status, limit)
      : database
          .prepare(
            `SELECT * FROM hermes_gadget_actions
             WHERE gadget_artifact_id = ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(input.artifactId, limit)
  ) as GadgetActionRow[];
  return rows.map(presentAction);
}

/** Everything waiting on this user across every gadget they own. */
export function listPendingGadgetActionsForUser(input: {
  userId: number;
  limit?: number;
  database?: Database.Database;
}): Array<GadgetAction & { gadgetTitle: string }> {
  const database = input.database ?? db;
  const rows = database
    .prepare(
      `SELECT a.*, ar.title AS gadget_title
         FROM hermes_gadget_actions a
         JOIN hermes_artifacts ar ON ar.id = a.gadget_artifact_id
        WHERE ar.user_id = ? AND a.status IN ('pending','approved')
        ORDER BY a.submitted_at ASC
        LIMIT ?`,
    )
    .all(input.userId, Math.min(input.limit ?? 100, 500)) as Array<
    GadgetActionRow & { gadget_title: string }
  >;
  return rows.map((row) => ({ ...presentAction(row), gadgetTitle: row.gadget_title }));
}

/**
 * Record the user's decision. Approving does not apply — `applyGadgetAction`
 * does, and it is a separate call so that a failure to apply cannot be confused
 * with a failure to decide.
 */
export function decideGadgetAction(input: {
  actionId: string;
  decision: "approved" | "rejected";
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  const decidedAt = nowIso();
  const changed = database
    .prepare(
      `UPDATE hermes_gadget_actions
          SET status = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(input.decision, decidedAt, input.actionId);
  if (changed.changes === 0) {
    const existing = getGadgetAction(input.actionId, database);
    if (!existing) {
      throw new GadgetStoreError(404, "action_not_found", "That action does not exist.");
    }
    throw new GadgetStoreError(
      409,
      "action_already_decided",
      `That action is already ${existing.status}.`,
    );
  }
  return getGadgetAction(input.actionId, database)!;
}

export function markGadgetActionApplied(input: {
  actionId: string;
  result: unknown;
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  database
    .prepare(
      `UPDATE hermes_gadget_actions
          SET status = 'applied', applied_result_json = ?, applied_at = ?, error_json = NULL
        WHERE id = ?`,
    )
    .run(JSON.stringify(input.result ?? null), nowIso(), input.actionId);
  return getGadgetAction(input.actionId, database)!;
}

/**
 * Applying failed. Upstream's contract is that the user is told and offered a
 * retry, so the row stays terminal-but-retryable rather than being discarded:
 * the payload is still there and the action can be approved again.
 */
export function markGadgetActionFailed(input: {
  actionId: string;
  error: { code: string; message: string };
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  database
    .prepare("UPDATE hermes_gadget_actions SET status = 'failed', error_json = ? WHERE id = ?")
    .run(JSON.stringify(input.error), input.actionId);
  return getGadgetAction(input.actionId, database)!;
}

export function markGadgetActionReverted(input: {
  actionId: string;
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  database
    .prepare("UPDATE hermes_gadget_actions SET status = 'reverted', reverted_at = ? WHERE id = ?")
    .run(nowIso(), input.actionId);
  return getGadgetAction(input.actionId, database)!;
}

/** Re-queue a failed action so the user can try it again. */
export function retryGadgetAction(input: {
  actionId: string;
  database?: Database.Database;
}): GadgetAction {
  const database = input.database ?? db;
  const changed = database
    .prepare(
      `UPDATE hermes_gadget_actions
          SET status = 'pending', decided_at = NULL, error_json = NULL
        WHERE id = ? AND status = 'failed'`,
    )
    .run(input.actionId);
  if (changed.changes === 0) {
    throw new GadgetStoreError(
      409,
      "action_not_retryable",
      "Only an action that failed to apply can be retried.",
    );
  }
  return getGadgetAction(input.actionId, database)!;
}

// ---------------------------------------------------------------------------
// Auto-approval rules
// ---------------------------------------------------------------------------

export function hasAutoApprovalRule(input: {
  artifactId: string;
  actionKindTag: string;
  database?: Database.Database;
}): boolean {
  const database = input.database ?? db;
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM hermes_gadget_auto_approvals WHERE gadget_artifact_id = ? AND action_kind_tag = ?",
      )
      .get(input.artifactId, input.actionKindTag),
  );
}

export function setAutoApprovalRule(input: {
  artifactId: string;
  actionKindTag: string;
  actionKindLabel: string;
  enabled: boolean;
  database?: Database.Database;
}): void {
  const database = input.database ?? db;
  if (!input.enabled) {
    database
      .prepare(
        "DELETE FROM hermes_gadget_auto_approvals WHERE gadget_artifact_id = ? AND action_kind_tag = ?",
      )
      .run(input.artifactId, input.actionKindTag);
    return;
  }
  database
    .prepare(
      `INSERT INTO hermes_gadget_auto_approvals (
         gadget_artifact_id, action_kind_tag, action_kind_label, created_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(gadget_artifact_id, action_kind_tag) DO NOTHING`,
    )
    .run(input.artifactId, input.actionKindTag, input.actionKindLabel, nowIso());
}

export function listAutoApprovalRules(input: {
  artifactId: string;
  database?: Database.Database;
}): GadgetAutoApprovalRule[] {
  const database = input.database ?? db;
  const rows = database
    .prepare(
      "SELECT * FROM hermes_gadget_auto_approvals WHERE gadget_artifact_id = ? ORDER BY created_at",
    )
    .all(input.artifactId) as Array<{
    gadget_artifact_id: string;
    action_kind_tag: string;
    action_kind_label: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    gadgetArtifactId: row.gadget_artifact_id,
    actionKindTag: row.action_kind_tag,
    actionKindLabel: row.action_kind_label,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Private per-gadget storage
// ---------------------------------------------------------------------------

export function readGadgetStorage(input: {
  artifactId: string;
  key: string;
  database?: Database.Database;
}): unknown {
  const database = input.database ?? db;
  const row = database
    .prepare(
      "SELECT value_json FROM hermes_gadget_storage WHERE gadget_artifact_id = ? AND key = ?",
    )
    .get(input.artifactId, input.key) as { value_json: string } | undefined;
  return row ? JSON.parse(row.value_json) : null;
}

export function listGadgetStorageKeys(input: {
  artifactId: string;
  database?: Database.Database;
}): string[] {
  const database = input.database ?? db;
  return (
    database
      .prepare(
        "SELECT key FROM hermes_gadget_storage WHERE gadget_artifact_id = ? ORDER BY key",
      )
      .all(input.artifactId) as Array<{ key: string }>
  ).map((row) => row.key);
}

export function writeGadgetStorage(input: {
  artifactId: string;
  key: string;
  value: unknown;
  database?: Database.Database;
}): void {
  const database = input.database ?? db;
  database
    .prepare(
      `INSERT INTO hermes_gadget_storage (gadget_artifact_id, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(gadget_artifact_id, key) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(input.artifactId, input.key, JSON.stringify(input.value ?? null), nowIso());
}

export function deleteGadgetStorage(input: {
  artifactId: string;
  key: string;
  database?: Database.Database;
}): void {
  const database = input.database ?? db;
  database
    .prepare("DELETE FROM hermes_gadget_storage WHERE gadget_artifact_id = ? AND key = ?")
    .run(input.artifactId, input.key);
}
