import type Database from "better-sqlite3";
import db from "../db.ts";
import {
  summarizeCapabilityUse,
  type CapabilitySummary,
  type TurnCapabilitySelection,
} from "./capability-usage.ts";

/**
 * Three capabilities do not name themselves in a tool name.
 *
 * `skill_open`, `mcp_call` and `workflow_run` all carry their identity in an
 * argument — which skill, which connected account, which of the user's own
 * automations — and the runtime's tool-progress events do not carry arguments.
 * So the tool endpoints are the authority here, exactly as they are for durable
 * memory writes (see memory-evidence.ts): each records what it was asked to do
 * against the run it was asked during, and this module reads that back.
 *
 * Reading the audit log rather than the stream also survives a reconnect. A
 * connection called in the first half of a turn belongs in that turn's
 * provenance whether or not the browser was listening when it happened.
 */

interface AuditRow {
  event_type: string;
  payload: string | null;
}

export interface CapabilityAuditTrail {
  skillOpens: Array<{ slug: string }>;
  connectionCalls: Array<{ slug: string; tool?: string; success: boolean }>;
  workflowRuns: Array<{ workflowId: string; success: boolean }>;
}

const EMPTY_TRAIL: CapabilityAuditTrail = {
  skillOpens: [],
  connectionCalls: [],
  workflowRuns: [],
};

function parsePayload(row: AuditRow): Record<string, unknown> | null {
  if (!row.payload) return null;
  try {
    const parsed = JSON.parse(row.payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** What the tool endpoints recorded doing on behalf of one run. */
export function capabilityAuditTrailForRun(
  runtimeSessionId: number,
  runId: string | undefined,
  database: Database.Database = db,
): CapabilityAuditTrail {
  if (!runId) return EMPTY_TRAIL;
  let rows: AuditRow[];
  try {
    rows = database
      .prepare(
        `SELECT event_type, payload
           FROM hermes_audit_events
          WHERE runtime_session_id = ?
            AND event_type IN (
              'skill.opened',
              'mcp.tool_completed',
              'workflow.run_started',
              'workflow.run_completed'
            )
          ORDER BY id`,
      )
      .all(runtimeSessionId) as AuditRow[];
  } catch {
    // Provenance is never worth failing a turn over. An unreadable audit table
    // costs the panel its capability rows and nothing else.
    return EMPTY_TRAIL;
  }

  const skillOpens: CapabilityAuditTrail["skillOpens"] = [];
  const connectionCalls: CapabilityAuditTrail["connectionCalls"] = [];
  // Started and completed are folded together so a workflow that never reported
  // a completion is reported as a failed run rather than quietly dropped.
  const workflowRuns = new Map<string, boolean>();

  for (const row of rows) {
    const payload = parsePayload(row);
    if (!payload || text(payload.runId) !== runId) continue;
    if (row.event_type === "skill.opened") {
      const slug = text(payload.slug);
      if (slug) skillOpens.push({ slug });
      continue;
    }
    if (row.event_type === "mcp.tool_completed") {
      const slug = text(payload.slug);
      if (!slug) continue;
      const tool = text(payload.tool);
      connectionCalls.push({
        slug,
        ...(tool ? { tool } : {}),
        success: payload.success !== false,
      });
      continue;
    }
    const workflowId = text(payload.workflowId);
    if (!workflowId) continue;
    if (row.event_type === "workflow.run_started") {
      if (!workflowRuns.has(workflowId)) workflowRuns.set(workflowId, false);
      continue;
    }
    // Only an outright success counts. `waiting` and `timeout` mean the
    // automation was left mid-flight, which is not a result to stand on.
    workflowRuns.set(workflowId, text(payload.status) === "success");
  }

  return {
    skillOpens,
    connectionCalls,
    workflowRuns: [...workflowRuns.entries()].map(([workflowId, success]) => ({
      workflowId,
      success,
    })),
  };
}

/**
 * The capability picture for one finished turn: what was selected before
 * dispatch, plus what the tool calls and the audit trail prove was used.
 */
export function capabilitySummaryForRun(input: {
  runtimeSessionId: number;
  runId: string | undefined;
  selection: TurnCapabilitySelection | null | undefined;
  toolCalls: Array<{ toolName?: unknown; success?: unknown }>;
  database?: Database.Database;
}): CapabilitySummary {
  const trail = capabilityAuditTrailForRun(
    input.runtimeSessionId,
    input.runId,
    input.database ?? db,
  );
  return summarizeCapabilityUse({
    selection: input.selection,
    toolCalls: input.toolCalls,
    skillOpens: trail.skillOpens,
    connectionCalls: trail.connectionCalls,
    workflowRuns: trail.workflowRuns,
  });
}
