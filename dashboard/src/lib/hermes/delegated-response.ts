interface DelegatedResponseMessage {
  role: string;
  content: string;
  internalAgentContinuation?: boolean;
  delegatedAgentRun?: boolean;
  externalAgentOutcome?: string;
  externalAgentResult?: string;
  godsEyeRun?: unknown;
  failed?: boolean;
  interrupted?: boolean;
  pending?: boolean;
  runtimeError?: string;
}

/** Pre-dispatch placeholders use aborted storage state until a runtime claims them. */
export function persistedResponseState(status: string | null, metadata: string | null) {
  let reserved = false;
  try { reserved = JSON.parse(metadata || "{}")?.preDispatchReserved === true; } catch { /* legacy metadata */ }
  return { failed: status === "failed", interrupted: status === "aborted" && !reserved,
    pending: status === "pending" || (status === "aborted" && reserved) };
}

/** A failed hand-back must not hide the only durable copy of the research. */
export function delegatedResponsePresentation(
  messages: readonly DelegatedResponseMessage[],
  index: number,
  live: { streaming?: boolean; failed?: boolean; interrupted?: boolean } = {},
): { stateLabel?: string; failed: boolean; fallbackContent: string } {
  const message = messages[index];
  if (message?.role !== "assistant" || message.delegatedAgentRun ||
      messages[index - 1]?.role !== "user" ||
      !messages[index - 1]?.internalAgentContinuation) {
    return { failed: false, fallbackContent: "" };
  }
  // Persisted terminal state wins over a stale transport flag after reconnect.
  const interrupted = Boolean(message.interrupted || live.interrupted);
  const failed = Boolean(message.failed || message.runtimeError || live.failed);
  const streaming = Boolean((live.streaming || message.pending) && !failed && !interrupted);
  const incomplete = !streaming && !message.content.trim();
  const reports: string[] = [];
  if (failed || interrupted || incomplete) {
    for (let cursor = index - 2; cursor >= 0; cursor -= 1) {
      const prior = messages[cursor]!;
      if (prior.role === "user" && !prior.internalAgentContinuation) break;
      if (prior.role === "assistant" && prior.delegatedAgentRun &&
          !prior.godsEyeRun && prior.externalAgentOutcome === "completed") {
        const report = prior.externalAgentResult?.trim();
        if (report && !reports.includes(report)) reports.unshift(report);
      }
    }
  }
  const fallbackContent = reports.length
    ? `The final response was interrupted. The completed work is saved below.\n\n${reports.join("\n\n---\n\n")}`
    : "";
  return {
    stateLabel: interrupted ? "Interrupted" : failed || incomplete
      ? "Response interrupted" : streaming ? "Preparing response" : "Result delivered",
    failed: failed || interrupted || incomplete,
    fallbackContent,
  };
}
