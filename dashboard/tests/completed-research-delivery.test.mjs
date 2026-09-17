import assert from "node:assert/strict";
import test from "node:test";
import { completedResearchDelivery } from "../src/lib/conversations/completed-research.ts";
import { delegatedResponsePresentation, persistedResponseState } from "../src/lib/hermes/delegated-response.ts";
import { agentLaunchContinuationMessage } from "../src/lib/hermes/agent-launch.ts";
import { delegatedTurnTotalUsage } from "../src/lib/hermes/super-agent-activity.ts";

const report = "# Research\n\nA qualified finding.[1]\n\n## References\n\n[1] https://example.test/study";
const row = (role, id, content, meta = {}) => ({ role, client_message_id: id,
  content, status: "complete", metadata: JSON.stringify(meta), created_at: "2026-09-08T06:05:13Z" });
const launch = { agentId: "max-research", agentName: "Max Research", command: "/agents:max-research",
  requestedAt: "2026-09-08T04:41:41Z", requiresApproval: false };
const workerMeta = { internalAgentContinuation: true, externalAgent: true, delegatedAgentRun: true,
  externalAgentRun: { kind: "max_research", runId: "job_research", query: "Research" },
  externalAgentOutcome: "completed", externalAgentResult: report };
const messages = [row("user", "question", "Research this"),
  row("assistant", "question", "Investigating", { verification: { externalAgents: [launch] } }),
  row("user", "worker", "Internal brief", { internalAgentContinuation: true }),
  row("assistant", "worker", "", workerMeta)];
const input = { internalAgentContinuation: true, clientMessageId: "answer",
  continuationText: "<!-- agent-launch-result:worker -->\nClient text must not replace the saved report", messages };

test("a completed single-worker report is delivered verbatim from durable storage", () => {
  const delivery = completedResearchDelivery(input);
  assert.equal(delivery.content, report);
  assert.equal(delivery.runId, "job_research");
  assert.equal(delivery.verification.externalAgents[0].carried, true);
  assert.equal(delivery.verification.state, "not_applicable", "do not invent independent verification");
  assert.equal(completedResearchDelivery({ ...input, continuationText: "<!-- agent-launch-result:job_research -->" }).content, report);
});

test("ordinary requests, wrong receipts, incomplete output, and another user turn cannot trigger direct delivery", () => {
  for (const patch of [{ internalAgentContinuation: false }, { continuationText: "Max Research finished" },
    { continuationText: "<!-- agent-launch-result:unrelated -->" },
    { messages: [...messages, row("user", "new-question", "Do something else")] }]) {
    assert.equal(completedResearchDelivery({ ...input, ...patch }), null);
  }
  for (const meta of [{ externalAgentOutcome: "failed" }, { externalAgentOutcome: "running" },
    { externalAgentResult: "" }, { externalAgentRun: { kind: "openwork", runId: "job_other", task: "Work" } }]) {
    assert.equal(completedResearchDelivery({ ...input, messages: [...messages.slice(0, -1),
      row("assistant", "worker", "", { ...workerMeta, ...meta })] }), null);
  }
});

test("parallel work must still be combined, including siblings that are only queued", () => {
  assert.equal(completedResearchDelivery({ ...input, messages: [...messages,
    row("assistant", "sibling", "", { ...workerMeta, externalAgentOutcome: "running" })] }), null);
  const queued = messages.map((m, i) => i === 1 ? row("assistant", "question", "Investigating",
    { verification: { externalAgents: [launch, { ...launch, agentId: "deep-research" }] } }) : m);
  assert.equal(completedResearchDelivery({ ...input, messages: queued }), null);
});

function transcript(answer = {}) {
  return [...messages.map(m => ({ role: m.role, content: m.content, ...JSON.parse(m.metadata) })),
    { role: "user", content: "Internal hand-back", internalAgentContinuation: true },
    { role: "assistant", content: "", ...answer }];
}
test("failed, stopped, and empty restored hand-backs show the complete report without a false success label", () => {
  for (const state of [{ failed: true }, { interrupted: true }, { runtimeError: "failed" }, {}]) {
    const view = delegatedResponsePresentation(transcript(state), 5);
    assert.equal(view.failed, true);
    assert.match(view.stateLabel, /[Ii]nterrupted/);
    assert.ok(view.fallbackContent.endsWith(report));
  }
  const savedFailure = delegatedResponsePresentation(transcript({ failed: true }), 5, { streaming: true });
  assert.equal(savedFailure.failed, true, "stale streaming cannot erase a saved failure");
});

test("streaming and successful synthesis retain their own text; fallback never crosses a user boundary", () => {
  assert.deepEqual(delegatedResponsePresentation(transcript(), 5, { streaming: true }),
    { stateLabel: "Preparing response", failed: false, fallbackContent: "" });
  assert.deepEqual(delegatedResponsePresentation(transcript({ content: "Final answer" }), 5),
    { stateLabel: "Result delivered", failed: false, fallbackContent: "" });
  const another = [...transcript(), { role: "user", content: "New question" },
    { role: "user", content: "Internal", internalAgentContinuation: true }, { role: "assistant", content: "", failed: true }];
  assert.equal(delegatedResponsePresentation(another, 8).fallbackContent, "");
});

test("saved failure flags survive projection without calling pre-dispatch reservations stopped", () => {
  assert.deepEqual(persistedResponseState("failed", "{}"), { failed: true, interrupted: false, pending: false });
  assert.deepEqual(persistedResponseState("aborted", '{"preDispatchReserved":true}'), { failed: false, interrupted: false, pending: true });
  assert.deepEqual(persistedResponseState("aborted", "malformed"), { failed: false, interrupted: true, pending: false });
  const pending = delegatedResponsePresentation(transcript({ pending: true }), 5);
  assert.equal(pending.stateLabel, "Preparing response");
  assert.equal(pending.fallbackContent, "");
});

test("numeric citations get preservation guidance and Max Research cannot request another audit", () => {
  const handback = agentLaunchContinuationMessage({ agentName: "Max Research", outcome: "completed", content: report });
  assert.match(handback, /This result is cited/);
  assert.ok(handback.includes(report));
  assert.match(handback, /Do not start another research or citation-audit pass/);
});

test("missing worker usage is explicitly partial instead of presented as the whole research cost", () => {
  const usage = { inputTokens: 167581, outputTokens: 749, totalTokens: 168330, cachedInputTokens: 0, reasoningTokens: 0, scope: "turn" };
  const chat = transcript(); chat[1].usage = usage;
  assert.equal(delegatedTurnTotalUsage(chat, 5, undefined).partial, true);
  chat[3].usage = { ...usage, totalTokens: 100 };
  const all = delegatedTurnTotalUsage(chat, 5, usage);
  assert.equal(all.partial, undefined);
  assert.equal(all.totalTokens, 336760);
});
