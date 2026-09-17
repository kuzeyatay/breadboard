import assert from "node:assert/strict";
import test from "node:test";
import { advanceMaxResearchProgress, INITIAL_MAX_RESEARCH_PROGRESS } from "../src/lib/max-research/progress.ts";
import { delegatedResearchProgressForMessage, delegatedThinkingUpdates } from "../src/lib/hermes/super-agent-activity.ts";

test("real milestones cover planning, collection, investigation, synthesis, review, and completion", () => {
  let progress = INITIAL_MAX_RESEARCH_PROGRESS;
  const apply = (type, payload = {}) => progress = advanceMaxResearchProgress(progress, type, payload);
  apply("run.started");
  apply("plan.started");
  assert.equal(progress.notes.length, 1);
  apply("plan.completed", { participants: [{ participant: "get_doc" }, { participant: "aris" }] });
  apply("wave.started", { wave: 0 });
  apply("participant.started", { participant: "get_doc" });
  assert.equal(progress.stage, "Gathering sources");
  apply("participant.settled", { participant: "get_doc", status: "completed", websites: [{ url: "private" }], artifacts: [{}], output: "PRIVATE OUTPUT" });
  assert.match(progress.notes.at(-1), /1 source page and 1 saved artifact/);
  apply("wave.completed", { wave: 0 });
  apply("wave.started", { wave: 1 });
  assert.equal(progress.stage, "Investigating the evidence");
  apply("participant.started", { participant: "aris" });
  apply("synthesis.started");
  assert.equal(progress.stage, "Reconciling the findings");
  apply("review.started");
  assert.equal(progress.stage, "Checking evidence and citations");
  apply("review.completed", { revised: true });
  assert.equal(progress.stage, "Finalizing the research");
  apply("run.completed", { result: "PRIVATE ANSWER" });
  assert.equal(progress.stage, "Done");
  assert.equal(progress.notes.length, 12);
  assert.doesNotMatch(progress.notes.join(" "), /private/i);
});

test("retries and unavailable events deduplicate, failures never claim success or expose diagnostics", () => {
  let progress = INITIAL_MAX_RESEARCH_PROGRESS;
  const apply = (type, payload) => progress = advanceMaxResearchProgress(progress, type, payload);
  for (let i = 0; i < 20; i++) apply("participant.retrying", { participant: "deep_research", reason: "C:\\private\\stack" });
  assert.equal(progress.notes.length, 1);
  apply("participant.unavailable", { participant: "praxist" });
  apply("participant.settled", { participant: "praxist", status: "unavailable" });
  assert.equal(progress.notes.length, 2);
  apply("participant.settled", { participant: "deep_research", status: "failed", reason: "secret" });
  apply("review.skipped", { reason: "secret" });
  apply("run.aborted", { interrupted: true });
  assert.equal(progress.stage, "Stopped");
  assert.doesNotMatch(progress.notes.join(" "), /secret|private|has finished|check is complete/);
  assert.equal(advanceMaxResearchProgress(progress, "unknown.event", { content: "secret" }), progress);
});

test("research updates follow the delegated answer across hand-back without leaking into a new question", () => {
  const parent = { role: "assistant", content: "", delegatedAgentPreamble: "Starting Max Research." };
  const worker = { role: "assistant", content: "", delegatedAgentRun: true, maxResearchRun: { runId: "run-a" }, externalAgentOutcome: "running" };
  const messages = [{ role: "user", content: "Research this" }, parent, worker];
  const progress = { "run-a": { stage: "Checking evidence and citations", notes: ["Collecting sources.", "Checking citations."] } };
  const live = delegatedResearchProgressForMessage(messages, 1, progress);
  assert.equal(live.stage, progress["run-a"].stage);
  assert.deepEqual(delegatedThinkingUpdates(parent, "", live), ["Starting Max Research.", ...progress["run-a"].notes]);
  worker.externalAgentOutcome = "completed";
  messages.push({ role: "user", content: "Internal hand-back", internalAgentContinuation: true },
    { role: "assistant", content: "Answer", progressNotes: ["Preparing the final answer."] });
  const finished = delegatedResearchProgressForMessage(messages, 4, progress);
  assert.equal(finished.stage, "");
  assert.deepEqual(delegatedThinkingUpdates(messages[4], "Starting Max Research.", finished),
    ["Starting Max Research.", ...progress["run-a"].notes, "Preparing the final answer."]);
  messages.push({ role: "user", content: "New question" }, { role: "assistant", content: "New answer" });
  assert.deepEqual(delegatedResearchProgressForMessage(messages, 6, progress), { stage: "", priorNotes: [], currentNotes: [] });
});
