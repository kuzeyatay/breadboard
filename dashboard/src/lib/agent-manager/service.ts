import "server-only";
import { randomUUID } from "node:crypto";
import { agentManagerAction, agentManagerEntry } from "./catalog.ts";
import { claimManagerSetup, managerSetup, saveManagerJob, type AgentManagerSetupRecord } from "./store.ts";
import { TERMINAL_SETUP_STATES, type AgentManagerOperation } from "./status.ts";
import { ManagedSetupExecutionError, readManagedSetupResult } from "../runtime-v2/managed-setup-job.ts";
import {
  RuntimeJobControlError, cancelRuntimeJob, inspectRuntimeJob, lookupRuntimeJobByIdempotencyKey, submitRuntimeJob,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";

export class AgentManagerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = "AgentManagerError"; }
}
const authority = (userId: number) => ({ userId, gardenId: null, conversationId: null });
function assertSetup(job: RuntimeJobSnapshot) {
  if (job.jobType !== "managed-setup" || job.workerKind !== "managed-setup-node" || job.resourceClass !== "document-processing" || job.gardenId !== null || job.conversationId !== null) {
    throw new AgentManagerError(502, "The Runtime returned an unrelated setup job.");
  }
}
async function snapshot(userId: number, saved: AgentManagerSetupRecord): Promise<RuntimeJobSnapshot | null> {
  let job;
  try {
    job = saved.job_id ? await inspectRuntimeJob(authority(userId), saved.job_id) : await lookupRuntimeJobByIdempotencyKey(authority(userId), saved.request_id);
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") return null;
    throw error;
  }
  if (job) assertSetup(job);
  return job;
}
async function operation(userId: number, saved: AgentManagerSetupRecord, job: RuntimeJobSnapshot): Promise<AgentManagerOperation> {
  assertSetup(job);
  let state: string = job.state;
  let message = job.failureMessage ?? (TERMINAL_SETUP_STATES.has(state) ? `Setup ${state.replaceAll("_", " ")}.` : "Runtime is preparing the requested dependencies.");
  if (job.cancellationRequested && !TERMINAL_SETUP_STATES.has(state)) message = "Cancellation requested. Waiting for Runtime to stop setup; dependencies may be partly installed.";
  if (job.state === "cancelled") message = "Setup cancelled. Dependencies may be partly installed; use the installation controls to repair them.";
  if (job.state === "succeeded") {
    try {
      const result = await readManagedSetupResult(userId, job);
      state = result.ok ? "succeeded" : "failed";
      message = result.message;
    } catch (error) {
      if (!(error instanceof ManagedSetupExecutionError)) throw error;
      state = "failed";
      message = error.message;
    }
  }
  return { agentId: saved.agent_id, actionId: saved.action_id, jobId: job.jobId, state, message: message.slice(0, 2000), finished: TERMINAL_SETUP_STATES.has(state) };
}
export async function cancelAgentManagerOperation(userId: number, agentId: string): Promise<AgentManagerOperation | null> {
  if (!agentManagerEntry(agentId)) throw new AgentManagerError(404, "Unknown agent.");
  const saved = managerSetup(userId, agentId);
  if (!saved) return null;
  const job = await snapshot(userId, saved);
  if (!job) throw new AgentManagerError(409, "Runtime has not confirmed this setup. Check its status before requesting cancellation.");
  if (TERMINAL_SETUP_STATES.has(job.state)) return operation(userId, saved, job);
  const cancelled = await cancelRuntimeJob(authority(userId), job.jobId);
  const result = await operation(userId, saved, cancelled);
  if (!result.finished) result.message = "Cancellation requested. Waiting for Runtime to stop setup; dependencies may be partly installed.";
  return result;
}
export async function readAgentManagerOperation(userId: number, agentId: string): Promise<AgentManagerOperation | null> {
  if (!agentManagerEntry(agentId)) throw new AgentManagerError(404, "Unknown agent.");
  const saved = managerSetup(userId, agentId);
  if (!saved) return null;
  const job = await snapshot(userId, saved);
  if (!job) return { agentId, actionId: saved.action_id, jobId: saved.job_id, state: "unconfirmed", message: "Setup status could not be confirmed. Retry to reconnect to the same setup.", finished: true };
  return operation(userId, saved, job);
}
export async function startAgentManagerOperation(userId: number, input: unknown): Promise<AgentManagerOperation> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AgentManagerError(400, "Invalid setup request.");
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["agentId", "actionId", "confirmRemoval"].includes(key)) || typeof body.agentId !== "string" || typeof body.actionId !== "string") {
    throw new AgentManagerError(400, "Choose an agent and a supported setup action.");
  }
  const action = agentManagerAction(body.agentId, body.actionId);
  if (!action) throw new AgentManagerError(400, "This agent does not support that managed setup action. Open its settings for available options.");
  if (action.destructive && body.confirmRemoval !== true) throw new AgentManagerError(400, "Confirm dependency removal before continuing.");
  const previous = managerSetup(userId, body.agentId);
  if (previous) {
    const job = await snapshot(userId, previous);
    if (job && !TERMINAL_SETUP_STATES.has(job.state)) {
      if (previous.action_id !== body.actionId) throw new AgentManagerError(409, "Another setup action is still running for this agent. Wait for it to finish first.");
      return operation(userId, previous, job);
    }
  }
  const saved = claimManagerSetup(userId, body.agentId, body.actionId, previous?.request_id ?? null, `agent-manager:${body.agentId}:${randomUUID()}`);
  if (saved.action_id !== body.actionId) throw new AgentManagerError(409, "Another setup action is being submitted for this agent. Refresh its status first.");
  // The Runtime validates the recipe and owns its process tree, filesystem
  // targets and exclusion against active agent work. The HTTP route deletes no files.
  let job: RuntimeJobSnapshot;
  try {
    job = await submitRuntimeJob(authority(userId), {
      jobType: "managed-setup", idempotencyKey: saved.request_id,
      requestPayload: { protocolVersion: 1, operation: action.serviceId, action: action.action },
      inputUploads: [],
    });
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_CONFLICT") {
      throw new AgentManagerError(409, "Agent work or another setup action is still active. Wait for it to finish, then retry.");
    }
    throw error;
  }
  assertSetup(job);
  saveManagerJob(userId, body.agentId, saved.request_id, job.jobId);
  return operation(userId, saved, job);
}
