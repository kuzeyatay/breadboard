// A delegated worker draws nothing, so the row that launched it is the only
// thing on screen that can say how it ended. These pin the reading of the
// hidden rows and the two surfaces that show it.
//
// The bug this guards: a Max Research run delegated by the Super Agent was
// cancelled four minutes in. Its hidden turn went `aborted`, no hand-back
// followed (stopped runs never do), and the launching row kept its
// "Delegated to Max Research agent" label with the composer free — a chat that
// looked finished while the synthesis it promised was never coming.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  DELEGATED_WORKER_STOPPED_BY_USER,
  delegatedAgentOutcomeLabel,
  delegatedAgentOutcomeLabelForMessage,
  delegatedWorkersForMessage,
  delegatedWorkersOutcome,
  delegatedWorkersOutcomeNote,
} from "../src/lib/hermes/super-agent-activity.ts";
import { MAX_RESEARCH_STOPPED_BY_USER } from "../src/lib/max-research/conversation-persistence.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const user = (content, extra = {}) => ({ role: "user", content, ...extra });
const assistant = (content, extra = {}) => ({ role: "assistant", content, ...extra });
const worker = (outcome, extra = {}) =>
  assistant("", {
    delegatedAgentRun: true,
    externalAgentName: "Max Research",
    externalAgentOutcome: outcome,
    clientMessageId: `agent-launch-${outcome}`,
    ...extra,
  });

const handOff = assistant("I have handed this to Max Research.", {
  clientMessageId: "parent",
  verification: { externalAgents: [{ agentName: "Max Research" }] },
});

test("the launching row reads the hidden worker rows that follow it", () => {
  const messages = [
    user("do max research on hypertrophy"),
    handOff,
    user("Conduct MAX RESEARCH…", { internalAgentContinuation: true }),
    worker("aborted"),
  ];
  assert.deepEqual(delegatedWorkersForMessage(messages, 1), [messages[3]]);
  // A real user message closes the chain; a later answer is not this row's.
  assert.deepEqual(
    delegatedWorkersForMessage(
      [...messages, user("anything else?"), worker("running")],
      1,
    ),
    [messages[3]],
  );
  // A visible assistant — the hand-back — closes it too.
  assert.deepEqual(
    delegatedWorkersForMessage(
      [
        ...messages,
        user("<!-- agent-launch-result:x --> …", { internalAgentContinuation: true }),
        assistant("Here is the synthesis."),
        worker("running"),
      ],
      1,
    ),
    [messages[3]],
  );
  assert.deepEqual(delegatedWorkersForMessage(messages, 0), []);
});

test("a batch is running while any worker runs, and otherwise reports its worst end", () => {
  assert.equal(delegatedWorkersOutcome([]), undefined);
  assert.equal(delegatedWorkersOutcome([worker("completed"), worker("running")]), "running");
  assert.equal(delegatedWorkersOutcome([worker(undefined)]), "running");
  assert.equal(delegatedWorkersOutcome([worker("completed"), worker("aborted")]), "aborted");
  assert.equal(delegatedWorkersOutcome([worker("completed"), worker("failed")]), "failed");
  assert.equal(delegatedWorkersOutcome([worker("completed")]), "completed");
});

test("the past-tense label tells the truth about a stopped or failed worker", () => {
  assert.equal(delegatedAgentOutcomeLabel("Max Research", "completed"), "Delegated to Max Research agent");
  assert.equal(delegatedAgentOutcomeLabel("Max Research", undefined), "Delegated to Max Research agent");
  assert.equal(delegatedAgentOutcomeLabel("Max Research", "aborted"), "Max Research agent stopped");
  assert.equal(delegatedAgentOutcomeLabel("Max Research", "failed"), "Max Research agent failed");
  assert.equal(delegatedAgentOutcomeLabel("Browser agent", "aborted"), "Browser agent stopped");
  assert.equal(delegatedAgentOutcomeLabelForMessage(handOff, "aborted"), "Max Research agent stopped");
  assert.equal(delegatedAgentOutcomeLabelForMessage({}, "aborted"), undefined);
});

test("a stopped delegation says so, and says who stopped it when that is known", () => {
  assert.equal(delegatedWorkersOutcomeNote([]), undefined);
  assert.equal(delegatedWorkersOutcomeNote([worker("running")]), undefined);
  assert.equal(delegatedWorkersOutcomeNote([worker("completed")]), undefined);
  assert.equal(
    delegatedWorkersOutcomeNote([worker("aborted", { externalAgentResult: "Stopped." })]),
    "Max Research was stopped before it returned anything, so there is nothing to synthesize. Retry to run it again.",
  );
  assert.equal(
    delegatedWorkersOutcomeNote([
      worker("aborted", { externalAgentResult: DELEGATED_WORKER_STOPPED_BY_USER }),
    ]),
    "You stopped Max Research before it returned anything, so there is nothing to synthesize. Retry to run it again.",
  );
  assert.equal(
    delegatedWorkersOutcomeNote([
      worker("failed", { externalAgentResult: "Deep Research is not configured.\nmore detail" }),
    ]),
    "Max Research failed: Deep Research is not configured.",
  );
  assert.equal(
    delegatedWorkersOutcomeNote([worker("failed", { externalAgentName: undefined })]),
    "The delegated agent failed before it returned anything.",
  );
});

test("the abort route and the transcript agree on the words for a person's stop", () => {
  // The route writes the durable reason; the note recognises it. Two modules,
  // one server-only, so the string lives in both and this keeps them equal.
  assert.equal(MAX_RESEARCH_STOPPED_BY_USER, DELEGATED_WORKER_STOPPED_BY_USER);
  const abortRoute = read("../src/app/api/max-research/runs/[runId]/abort/route.ts");
  const sessionAbort = read("../src/app/api/hermes/sessions/[sessionId]/abort/route.ts");
  assert.ok(
    abortRoute.indexOf("markMaxResearchRunStoppedByUser(userId, runId)") <
      abortRoute.indexOf("await abortRun(userId, runId)"),
    "the reason must be sealed before the runtime's own 'Stopped.' can land",
  );
  assert.match(sessionAbort, /content: "Stopped by the user\."/);
});

test("both transcript surfaces label the row by its workers' outcome and show the note", () => {
  const panel = read("../src/app/components/hermes/agent-runtime-panel.tsx");
  const garden = read("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, source] of [["Terminal", panel], ["Garden", garden]]) {
    assert.match(source, /delegatedWorkersForMessage\(\s*messages,\s*(index|i),?\s*\)/, name);
    assert.match(source, /delegatedAgentOutcomeLabelForMessage\(/, name);
    assert.match(source, /\|\|\s*delegatedWorkerOutcome === "running";/, name);
    assert.match(source, /data-testid="delegated-worker-outcome"/, name);
    assert.match(source, /!delegatedAgentActive[\s\S]{0,160}\?\s*delegatedWorkersOutcomeNote\(delegatedWorkers\)/, name);
  }
  // A superseded row has been spoken for by its hand-back; the note is for the
  // row that nothing followed. The Terminal renders every message and guards;
  // Garden's buildTranscriptRows drops superseded rows before they are drawn.
  assert.match(
    panel,
    /!supersededDelegationAssistants\.has\(index\)\s*\?\s*delegatedWorkersOutcomeNote\(delegatedWorkers\)/,
  );
  assert.match(garden, /supersededDelegationAssistants\.has\(index\) \|\|/);
  // The Terminal's Stop-after-launch path never hands an aborted worker back as
  // a continuation, which is why the note has to exist at all.
  const terminal = read("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  assert.match(
    terminal,
    /if \(result\.outcome === "aborted"\) \{\s*continuedDelegatedTurnsRef\.current\.add\(clientMessageId\);/,
  );
});

test("a hidden Max Research card reports its stage to the row that launched it", () => {
  const card = read("../src/app/components/hermes/inline-max-research-run.tsx");
  const panel = read("../src/app/components/hermes/agent-runtime-panel.tsx");
  assert.match(card, /onStage\?: \(stage: string\) => void;/);
  assert.match(card, /describeStage\(stage, participants\)/);
  assert.match(panel, /onStage=\{\s*message\.delegatedAgentRun === true/);
  assert.match(panel, /\$\{delegatedAgentActivity\} · \$\{delegatedWorkerStage\}/);
});
