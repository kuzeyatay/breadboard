// Durable provenance for the Super Agent answer produced after a delegated
// worker hands its result back.
//
// Launch requests are also kept in a small in-memory queue so the live stream
// can announce them. That queue is a delivery aid, not history: a long worker
// run can cross a process restart or a different Next.js worker. The hidden
// worker turn and hand-back marker are the durable join between the two turns,
// and are therefore the authority used here.

import {
  externalAgentDisplayName,
  parseExternalAgentRun,
  type ExternalAgentRun,
} from "./external-agent-runs.ts";
import type {
  ExternalAgentCall,
  VerificationSummary,
} from "../hermes/evidence.ts";

const CONTINUATION_MARKER =
  /<!--\s*agent-launch-result:([A-Za-z0-9_.:-]{1,128})\s*-->/gu;

export interface DelegatedProvenanceMessage {
  client_message_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: string | null;
  created_at: string;
}

interface WorkerReceipt {
  run: ExternalAgentRun;
  startedAt: string;
}

function parseMetadata(message: DelegatedProvenanceMessage): Record<string, unknown> {
  if (!message.metadata) return {};
  try {
    const parsed = JSON.parse(message.metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Stable worker ids named by a hidden model-to-model hand-back. */
export function agentLaunchContinuationIds(content: string): string[] {
  const ids: string[] = [];
  for (const match of content.matchAll(CONTINUATION_MARKER)) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function storedExternalAgentCall(value: unknown): ExternalAgentCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const call = value as Record<string, unknown>;
  const agentId = typeof call.agentId === "string" ? call.agentId.trim() : "";
  const agentName =
    typeof call.agentName === "string" ? call.agentName.trim() : "";
  const command = typeof call.command === "string" ? call.command.trim() : "";
  const requestedAt =
    typeof call.requestedAt === "string" &&
    Number.isFinite(Date.parse(call.requestedAt))
      ? call.requestedAt
      : "";
  if (!agentId || !agentName || !command || !requestedAt) return null;
  return {
    agentId,
    agentName,
    command,
    ...(typeof call.reason === "string" && call.reason.trim()
      ? { reason: call.reason.trim() }
      : {}),
    requiresApproval: call.requiresApproval === true,
    requestedAt,
    ...(Array.isArray(call.websites)
      ? { websites: call.websites as ExternalAgentCall["websites"] }
      : {}),
  };
}

function callsRecordedInHistory(
  messages: readonly DelegatedProvenanceMessage[],
): ExternalAgentCall[] {
  const calls: ExternalAgentCall[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const verification = parseMetadata(message).verification;
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      continue;
    }
    const externalAgents = (verification as Record<string, unknown>).externalAgents;
    if (!Array.isArray(externalAgents)) continue;
    for (const value of externalAgents) {
      const call = storedExternalAgentCall(value);
      // A previously repaired synthesis is not the launch receipt. Ignoring it
      // prevents a later run of the same agent from borrowing an old timestamp.
      if (call && (value as Record<string, unknown>).carried !== true) {
        calls.push(call);
      }
    }
  }
  return calls;
}

function workerReceipt(
  workerId: string,
  messages: readonly DelegatedProvenanceMessage[],
): WorkerReceipt | null {
  // Both halves own the descriptor. Prefer the completed assistant half, then
  // fall back to the reserved user half if a failed worker never finalized it.
  const candidates = messages
    .filter((message) => message.client_message_id === workerId ||
      parseExternalAgentRun(parseMetadata(message).externalAgentRun)?.runId === workerId)
    .sort((left, right) => Number(right.role === "assistant") - Number(left.role === "assistant"));
  for (const message of candidates) {
    const metadata = parseMetadata(message);
    if (metadata.externalAgent !== true || metadata.delegatedAgentRun !== true) {
      continue;
    }
    const run = parseExternalAgentRun(metadata.externalAgentRun);
    if (!run) continue;
    const startedAt =
      typeof metadata.externalAgentStartedAt === "string" &&
      Number.isFinite(Date.parse(metadata.externalAgentStartedAt))
        ? metadata.externalAgentStartedAt
        : message.created_at;
    return { run, startedAt };
  }
  return null;
}

function nearestLaunchCall(
  receipt: WorkerReceipt,
  calls: readonly ExternalAgentCall[],
  used: Set<number>,
): ExternalAgentCall | null {
  const agentName = externalAgentDisplayName(receipt.run.kind);
  const startedAtMs = Date.parse(receipt.startedAt);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < calls.length; index += 1) {
    if (used.has(index) || calls[index]?.agentName !== agentName) continue;
    const requestedAtMs = Date.parse(calls[index]!.requestedAt);
    const distance = Number.isFinite(startedAtMs) && Number.isFinite(requestedAtMs)
      ? Math.abs(startedAtMs - requestedAtMs)
      : index;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return null;
  used.add(bestIndex);
  return calls[bestIndex] ?? null;
}

function fallbackCall(receipt: WorkerReceipt): ExternalAgentCall {
  // The ordinary spelling is exact for Max Research (and almost every other
  // worker). The display name and durable run kind remain authoritative even
  // for the few legacy commands whose palette spelling is irregular.
  const agentId = receipt.run.kind.replaceAll("_", "-");
  return {
    agentId,
    agentName: externalAgentDisplayName(receipt.run.kind),
    command: `/agents:${agentId}`,
    requiresApproval: false,
    requestedAt: receipt.startedAt,
  };
}

/**
 * The workers whose results are named by this exact continuation.
 *
 * `launchCalls` is the live queue's richer copy and remains a compatibility
 * fallback. A matched durable receipt wins, so a restart cannot erase the
 * provenance and one worker in a parallel batch cannot be confused with the
 * others.
 */
export function carriedExternalAgentsForContinuation(input: {
  continuationText: string;
  messages: readonly DelegatedProvenanceMessage[];
  launchCalls?: readonly ExternalAgentCall[];
}): ExternalAgentCall[] {
  const workerIds = agentLaunchContinuationIds(input.continuationText);
  if (workerIds.length === 0) {
    return (input.launchCalls ?? []).map((call) => ({ ...call, carried: true }));
  }
  const recordedCalls = callsRecordedInHistory(input.messages);
  const used = new Set<number>();
  const durable = workerIds.flatMap((workerId) => {
    const receipt = workerReceipt(workerId, input.messages);
    if (!receipt) return [];
    const call = nearestLaunchCall(receipt, recordedCalls, used) ?? fallbackCall(receipt);
    return [{ ...call, carried: true }];
  });
  if (durable.length > 0) return durable;
  return (input.launchCalls ?? []).map((call) => ({ ...call, carried: true }));
}

function sameCall(left: ExternalAgentCall, right: ExternalAgentCall): boolean {
  return left.agentId === right.agentId &&
    left.command === right.command &&
    left.requestedAt === right.requestedAt;
}

/** Add recovered worker receipts without changing the turn's verification verdict. */
export function withCarriedExternalAgents(
  verification: unknown,
  calls: readonly ExternalAgentCall[],
): VerificationSummary | undefined {
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    return undefined;
  }
  const summary = verification as VerificationSummary;
  if (!calls.length) return summary;
  const existing = Array.isArray(summary.externalAgents)
    ? summary.externalAgents
    : [];
  return {
    ...summary,
    externalAgents: [
      ...existing,
      ...calls.filter((call) => !existing.some((current) => sameCall(current, call))),
    ],
  };
}
