import { agentLaunchContinuationIds, carriedExternalAgentsForContinuation,
  type DelegatedProvenanceMessage } from "./delegated-agent-provenance.ts";
import { parseExternalAgentRun } from "./external-agent-runs.ts";

type ResearchMessage = DelegatedProvenanceMessage & { status?: string };
function metadata(message: ResearchMessage): Record<string, unknown> {
  try {
    const value = JSON.parse(message.metadata || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** Only a single, completed worker receipt can supply a direct final answer.
 * Read the durable report, never the client-supplied hand-back body. Multi-worker
 * batches and unfinished research still need the normal orchestration path. */
export function completedResearchDelivery(input: {
  agentKind?: "max_research" | "hyperframes";
  internalAgentContinuation?: boolean;
  continuationText: string;
  clientMessageId: string;
  messages: readonly ResearchMessage[];
}) {
  if (!input.internalAgentContinuation) return null;
  const ids = agentLaunchContinuationIds(input.continuationText);
  if (ids.length !== 1) return null;
  const previous = input.messages.filter(m => m.client_message_id !== input.clientMessageId);
  const start = previous.findLastIndex(m => m.role === "user" && metadata(m).internalAgentContinuation !== true);
  if (start < 0) return null;
  const chain = previous.slice(start);
  const workers = chain.filter(m => m.role === "assistant" && metadata(m).delegatedAgentRun === true);
  if (workers.length !== 1) return null;
  const worker = workers[0]!;
  const meta = metadata(worker);
  const run = parseExternalAgentRun(meta.externalAgentRun);
  if (meta.externalAgent !== true || run?.kind !== (input.agentKind ?? "max_research") || meta.externalAgentOutcome !== "completed" ||
      worker.status !== "complete" || ![worker.client_message_id, run.runId].includes(ids[0]!)) return null;
  const report = typeof meta.externalAgentResult === "string" ? meta.externalAgentResult.trim() : "";
  if (!report) return null;
  // A sibling may be queued without a worker row yet. Its launch receipt is
  // authoritative too, so do not drop it by delivering just this report.
  const launches = chain.flatMap(m => {
    const verification = metadata(m).verification as { externalAgents?: { carried?: boolean }[] } | undefined;
    return m.role === "assistant" && Array.isArray(verification?.externalAgents)
      ? verification.externalAgents.filter(a => a && !a.carried) : [];
  });
  if (launches.length > 1) return null;
  return {
    content: report,
    workerClientMessageId: worker.client_message_id,
    runId: run.runId,
    verification: {
      state: "not_applicable" as const,
      evidence: [], unsupportedClaims: [], assumptions: [],
      externalAgents: carriedExternalAgentsForContinuation({ continuationText: input.continuationText, messages: chain }),
    },
  };
}
