import assert from "node:assert/strict";
import test from "node:test";
import { terminalResultFromEvents } from "../src/lib/max-research/runtime-run-manager.ts";
import { agentLaunchContinuationMessage } from "../src/lib/hermes/agent-launch.ts";

const at = "2026-09-08T11:48:18.613Z";
const event = (sequenceNumber, type, payload) => ({ sequenceNumber, type, payload, at });
const settled = (sequenceNumber, participant, output, status = "completed") =>
  event(sequenceNumber, "participant.settled", { participant, output, status });
const failed = (sequenceNumber, extra = {}) => event(sequenceNumber, "run.failed", {
  error: "EPERM: operation not permitted, rename checkpoint.json.pending -> checkpoint.json",
  ...extra,
});

test("checkpoint failure hands back previously collected findings, citations and coverage without a completed wave", () => {
  const result = terminalResultFromEvents([
    settled(1, "deep_research", "A supported finding [S1].\nSources: https://example.test/primary"),
    settled(2, "get_doc", "A saved paper https://example.test/paper"),
    settled(3, "agent_reach", "This failed output is not evidence", "failed"),
    event(4, "participant.started", { participant: "openscience" }),
    event(5, "participant.unavailable", { participant: "praxist", reason: "Service unavailable" }),
    failed(6),
    settled(7, "aris", "Impossible post-failure output"),
  ]);
  assert.equal(result.outcome, "failed");
  assert.equal(result.terminalAtMs, Date.parse(at));
  assert.match(result.content, /MAX_RESEARCH_RETAINED_FINDINGS_V1/);
  assert.match(result.content, /A supported finding \[S1\]/);
  assert.match(result.content, /https:\/\/example.test\/primary/);
  assert.match(result.content, /https:\/\/example.test\/paper/);
  assert.match(result.content, /agent_reach: failed/);
  assert.match(result.content, /openscience: running/);
  assert.match(result.content, /praxist: unavailable \(Service unavailable\)/);
  assert.doesNotMatch(result.content, /This failed output|Impossible post-failure|final reconciliation call failed/);
  const message = agentLaunchContinuationMessage({ agentName: "Max Research", ...result });
  assert.match(message, /Synthesize the retained findings/);
  assert.match(message, /do not claim that source fetching produced nothing/);
  assert.match(message, /Do not restart research or relaunch the worker during this hand-back/);
  assert.match(message, /later explicit user request.*new authorized request/);
});

test("terminal evidence packets and checkpoint findings merge once per participant", () => {
  const result = terminalResultFromEvents([
    settled(1, "deep_research", "Older checkpoint finding"),
    settled(2, "get_doc", "Checkpoint paper"),
    failed(3, {
      findings: [{ participant: "deep_research", status: "completed" }],
      retainedFindings: [
        { participant: "deep_research", output: "Terminal finding https://example.test/source" },
        { participant: "unknown", output: "Unknown evidence" },
      ],
    }),
  ]);
  assert.match(result.content, /Terminal finding/);
  assert.match(result.content, /Checkpoint paper/);
  assert.doesNotMatch(result.content, /Older checkpoint finding|Unknown evidence/);
  assert.equal(result.content.match(/<retained-finding participant="deep_research">/g)?.length, 1);
});

test("all seven long findings retain their source lists within the continuation transport budget", () => {
  const participants = ["deep_research", "agent_reach", "get_doc", "feynman", "openscience", "praxist", "aris"];
  const events = participants.map((id, index) => settled(index + 1, id,
    `${id} finding. ${"Detail. ".repeat(6000)}\nSources: https://example.test/${id}`));
  const result = terminalResultFromEvents([...events, failed(8)]);
  const message = agentLaunchContinuationMessage({ agentName: "Max Research", ...result });
  assert.ok(message.length < 100_000);
  for (const id of participants) {
    assert.ok(message.includes(`${id} finding.`));
    assert.ok(message.includes(`https://example.test/${id}`));
  }
});

test("empty failures never claim findings, request a fresh synthesis or suppress a later explicit retry", () => {
  const result = terminalResultFromEvents([settled(1, "get_doc", "  "), failed(2)]);
  assert.doesNotMatch(result.content, /MAX_RESEARCH_RETAINED_FINDINGS/);
  const message = agentLaunchContinuationMessage({ agentName: "Max Research", ...result });
  assert.doesNotMatch(message, /Give the final synthesis now/);
  assert.match(message, /Do not invent findings or silently substitute a new research run/);
  assert.match(message, /later explicit user request.*new authorized request/);
});

test("cancellation remains stopped even with checkpointed evidence", () => {
  const result = terminalResultFromEvents([
    settled(1, "deep_research", "Completed findings"),
    event(2, "run.aborted", {}),
  ]);
  assert.equal(result.outcome, "aborted");
  assert.equal(result.content, "Stopped.");
});
