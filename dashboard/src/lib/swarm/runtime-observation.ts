import { normalizeChatTokenUsage } from "../chat-token-usage.ts";
import type { OuterAgentRunView } from "../runtime-v2/outer-agent-run.ts";
import type { SwarmObservation } from "./scheduler.ts";

/** Read actual worker receipts. A terminal process is a candidate result, not
 * proof that its acceptance criteria passed. The coordinator verifies those. */
export function runtimeSwarmObservation(view: OuterAgentRunView, runId: string): SwarmObservation {
  const final = view.events.findLast(event => /(?:result|completed|failed|aborted)$/u.test(event.type));
  const result = view.events.findLast(event => ["run.result", "result"].includes(event.type)) ??
    view.events.findLast(event => event.type === "run.completed");
  const payload = result?.payload ?? {};
  const text = [payload.result, payload.answer, payload.response, payload.content, payload.markdown, payload.summary]
    .find(value => typeof value === "string" && value.trim());
  const summary = typeof text === "string" ? text.slice(0, 24_000) :
    view.terminal ? `Worker ${view.status ?? "stopped"}. Inspect the saved runtime receipts and artifacts.` : "";
  // run.usage is the cumulative worker ledger. Do not sum snapshots or add
  // nested tool receipts to it a second time. Unknown coverage stays partial.
  const usageEvent = view.events.findLast(event => event.type === "run.usage");
  const usage = usageEvent ? normalizeChatTokenUsage(usageEvent.payload.usage ?? usageEvent.payload) : null;
  const evidence: NonNullable<SwarmObservation["evidence"]> = view.terminal ? [{
    kind: "observation", title: "Runtime result", summary: summary.slice(0, 8_000), reference: `runtime:${runId}:${result?.sequenceNumber ?? final?.sequenceNumber ?? 0}`,
  }] : [];
  for (const event of view.events.filter(item => /(?:artifact|evidence|validation|documents\.ready)/u.test(item.type)).slice(-40)) {
    evidence.push({ kind: event.type.includes("artifact") ? "artifact" : event.type.includes("validation") ? "validation" : "observation",
      title: event.type, summary: JSON.stringify(event.payload).slice(0, 8_000), reference: `runtime:${runId}:${event.sequenceNumber}` });
  }
  return { status: !view.terminal ? "running" : view.status === "completed" ? "completed" : view.status === "aborted" ? "cancelled" : "failed",
    summary, ...(view.status === "failed" ? { error: String(final?.payload.message ?? final?.payload.error ?? "The runtime worker failed.") } : {}), evidence,
    ...(usage ? { totalTokens: usage.totalTokens, usageComplete: view.terminal && usage.partial !== true && usage.estimated !== true } : {}) };
}
