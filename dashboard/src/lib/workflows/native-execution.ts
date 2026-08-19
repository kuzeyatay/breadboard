// Runs a saved workflow on the vendored sim engine and reports the result in
// the shape every existing caller already speaks (WorkflowRunResponse), so the
// chat palette, the `workflow_run` tool and the Evidence panel did not have to
// change when n8n was replaced.

import { Executor } from "@/lib/sim/executor";
import type { BlockLog, ExecutionResult } from "@/lib/sim/executor/types";
import { Serializer } from "@/lib/sim/serializer";
import type { BlockState } from "@/lib/sim/core/stores/workflows/workflow/types";
import { getWorkflowById, recordRun, summarize, type WorkflowRow } from "@/lib/workflows/store";
import type { LocalWorkflowSummary, WorkflowRunResponse } from "@/lib/workflows/types";

export type TriggerKind = "manual" | "chat" | "webhook" | "schedule";

/**
 * A superset of the shared response: the canvas also renders the raw output and
 * the per-block trace, which the chat surfaces do not use.
 */
export type WorkflowRunOutcome = WorkflowRunResponse & {
  runId: string;
  success: boolean;
  output: unknown;
  logs: ReturnType<typeof toRunLogs>;
  error?: string;
};

/** Mirrors the executor's own cap; a run past this is reported as a timeout. */
const RUN_TIMEOUT_MS = 90_000;

const MAX_RENDERED_OUTPUT = 4_000;

type EditorState = {
  blocks?: Record<string, BlockState>;
  edges?: Array<{ id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  loops?: Record<string, unknown>;
  parallels?: Record<string, unknown>;
};

function renderOutput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * The chat-facing summary of a run. Block failures are named individually
 * because a workflow that half-ran is the common case worth reporting.
 */
function assistantContentFor(
  name: string,
  result: { success: boolean; output?: unknown; error?: string; logs?: BlockLog[] },
): string {
  const lines: string[] = [];
  const failures = (result.logs ?? []).filter((log) => log.success === false && !log.errorHandled);

  if (result.success) {
    lines.push(`**${name}** ran successfully.`);
  } else {
    lines.push(`**${name}** failed.`);
    if (result.error) lines.push("", `Error: ${result.error}`);
    for (const failure of failures.slice(0, 5)) {
      lines.push(`- \`${failure.blockName ?? failure.blockId}\` — ${failure.error ?? "failed"}`);
    }
  }

  const rendered = renderOutput(result.output);
  if (rendered) {
    const clipped =
      rendered.length > MAX_RENDERED_OUTPUT
        ? `${rendered.slice(0, MAX_RENDERED_OUTPUT)}\n… (output truncated)`
        : rendered;
    lines.push("", "```json", clipped, "```");
  }
  return lines.join("\n");
}

function toRunLogs(logs: BlockLog[] | undefined) {
  return (logs ?? []).map((log) => ({
    blockId: log.blockId,
    blockName: log.blockName,
    blockType: log.blockType,
    success: log.success,
    output: log.output,
    error: log.error,
    durationMs: log.durationMs,
    startedAt: log.startedAt,
    endedAt: log.endedAt,
  }));
}

/**
 * Serializes the stored editor state and executes it.
 *
 * The editor stores blocks keyed by id with their display name on the block;
 * the engine resolves `<name.field>` references by that display name, so the
 * name must survive serialization intact.
 */
export async function runWorkflowById(options: {
  workflowId: string;
  input?: unknown;
  triggerKind: TriggerKind;
  userId?: number | null;
}): Promise<WorkflowRunOutcome> {
  const record = getWorkflowById(options.workflowId);
  if (!record) {
    throw new Error("This workflow does not exist.");
  }
  if (typeof options.userId === "number" && record.userId !== options.userId) {
    throw new Error("This workflow does not exist.");
  }

  const summary: LocalWorkflowSummary = summarize({
    id: record.id,
    user_id: record.userId,
    name: record.name,
    description: record.description,
    state: JSON.stringify(record.state),
    created_at: "",
    updated_at: record.updatedAt,
  } as WorkflowRow);

  const state = (record.state ?? {}) as EditorState;
  const blocks = state.blocks ?? {};

  if (!Object.keys(blocks).length) {
    const runId = recordRun({
      workflowId: record.id,
      status: "error",
      triggerKind: options.triggerKind,
      input: options.input,
      error: "The workflow is empty.",
    });
    return {
      workflow: summary,
      executionId: runId,
      status: "error",
      assistantContent: `**${record.name}** has no blocks yet, so there was nothing to run.`,
      runId,
      success: false,
      output: null,
      logs: [],
      error: "The workflow is empty.",
    };
  }

  const edges = (state.edges ?? []).map((edge, index) => ({
    id: edge.id ?? `edge-${index}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  }));

  let result: ExecutionResult;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const serialized = new Serializer().serializeWorkflow(
      blocks,
      edges as never,
      (state.loops ?? {}) as never,
      (state.parallels ?? {}) as never,
      true,
    );
    const executor = new Executor({
      workflow: serialized,
      workflowInput: options.input ?? {},
      contextExtensions: {
        userId: options.userId ?? undefined,
        abortSignal: controller.signal,
        metadata: { workflowId: record.id },
      },
    } as never);
    result = (await executor.execute(record.id)) as ExecutionResult;
  } catch (cause) {
    const aborted = controller.signal.aborted;
    const message = cause instanceof Error ? cause.message : "The workflow could not be run.";
    const status = aborted ? "timeout" : "error";
    const runId = recordRun({
      workflowId: record.id,
      status,
      triggerKind: options.triggerKind,
      input: options.input,
      error: message,
    });
    return {
      workflow: summary,
      executionId: runId,
      status,
      assistantContent: aborted
        ? `**${record.name}** was still running after ${Math.round(RUN_TIMEOUT_MS / 1000)} seconds and was stopped.`
        : `**${record.name}** failed to start.\n\nError: ${message}`,
      runId,
      success: false,
      output: null,
      logs: [],
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }

  // A paused run is reported as "waiting": the same state the n8n-era contract
  // used for a workflow parked on an external event.
  const status: WorkflowRunResponse["status"] =
    result.status === "paused" ? "waiting" : result.success ? "success" : "error";

  const runId = recordRun({
    workflowId: record.id,
    status,
    triggerKind: options.triggerKind,
    input: options.input,
    output: result.output,
    logs: toRunLogs(result.logs),
    error: result.error ?? null,
  });

  return {
    workflow: summary,
    executionId: runId,
    status,
    assistantContent:
      status === "waiting"
        ? `**${record.name}** is paused, waiting on an external step.`
        : assistantContentFor(record.name, result),
    runId,
    success: result.success,
    output: result.output,
    logs: toRunLogs(result.logs),
    error: result.error,
  };
}
