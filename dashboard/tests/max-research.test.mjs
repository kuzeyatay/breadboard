// Max Research: five research agents against one question, one answer out.
//
// The orchestration is what is tested here, with stub runtimes — which agents
// are chosen, what happens when one is down, what happens when the one the run
// depends on fails, and whether a disagreement between two of them survives
// into the synthesis. None of that needs a service, and a test that needed five
// would never run.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  maxResearchInvocation,
  taskFromMaxResearchCommand,
  taskFromMaxResearchIntent,
} from "../src/lib/max-research/identity.ts";
import {
  planMaxResearch,
  participantWaves,
  RETRIEVAL_PARTICIPANTS,
} from "../src/lib/max-research/plan.ts";
import {
  maxResearchLiteratureQuery,
  summarizeEvents,
  terminalStatusFromEvents,
} from "../src/lib/max-research/participants.ts";
import {
  coverageSummary,
  maxResearchSynthesisPrompt,
} from "../src/lib/max-research/synthesis.ts";
import {
  maxResearchReviewPrompt,
  REVIEW_CHECKS,
} from "../src/lib/max-research/review.ts";
import {
  abortRun,
  getEventsSince,
  getRun,
  isTerminal,
  resetMaxResearchRuns,
  startRun,
} from "../src/lib/max-research/run-manager.ts";

beforeEach(() => resetMaxResearchRuns());

/* ---------------------------------------------------------------- */
/* Reaching it                                                       */
/* ---------------------------------------------------------------- */

test("the command and the phrase both reach it", () => {
  assert.equal(
    taskFromMaxResearchCommand("/agents:max-research what happened to Concorde"),
    "what happened to Concorde",
  );
  assert.equal(taskFromMaxResearchCommand("/agents:max-research"), "");
  assert.equal(taskFromMaxResearchCommand("tell me about max research"), null);

  assert.equal(
    taskFromMaxResearchIntent("max research: what happened to Concorde"),
    "what happened to Concorde",
  );
  assert.equal(
    taskFromMaxResearchIntent("what happened to Concorde, max research"),
    "what happened to Concorde",
  );
  assert.equal(
    taskFromMaxResearchIntent("please run a max research on Concorde"),
    "Concorde",
  );
});

test("asking about the feature does not spend an hour of compute on it", () => {
  for (const question of [
    "what is max research?",
    "how does max research work?",
    "is max research better than deep research?",
  ]) {
    assert.equal(taskFromMaxResearchIntent(question), null, question);
  }
});

test("only the slash command selects the persistent agent", () => {
  assert.deepEqual(maxResearchInvocation("/agents:max-research Concorde"), {
    question: "Concorde",
    selectAgent: true,
  });
  assert.deepEqual(maxResearchInvocation("Concorde, max research"), {
    question: "Concorde",
    selectAgent: false,
  });
  assert.equal(maxResearchInvocation("what is the capital of France"), null);
});

/* ---------------------------------------------------------------- */
/* Dividing the work                                                 */
/* ---------------------------------------------------------------- */

test("every question gets the indexed web and the spoken one", () => {
  // The gap between what is published and what practitioners say is often the
  // finding, so neither is ever optional.
  const plan = planMaxResearch({ question: "how do I center a div" });
  const chosen = plan.assignments.map((a) => a.participant);
  assert.ok(chosen.includes("deep_research"));
  assert.ok(chosen.includes("agent_reach"));
});

test("a question about a measured quantity earns the literature", () => {
  // Where a rate or a percentage is asked for, the primary source is the only
  // place the method is visible — and where a figure with no origin survives.
  const plan = planMaxResearch({
    question: "what percentage of relationships survive, and at what age",
  });
  assert.ok(plan.academic);
  assert.ok(plan.assignments.some((a) => a.participant === "get_doc"));
});

test("a question that can be run earns the workspace", () => {
  const plan = planMaxResearch({
    question: "benchmark whether polars is faster than pandas on a 10GB csv",
  });
  assert.ok(plan.empirical);
  assert.ok(plan.assignments.some((a) => a.participant === "openscience"));
});

test("every question commissions all six", () => {
  // The roster used to be filtered: Get Doc only for questions that read as
  // academic, OpenScience only for ones that read as empirical. That saved a
  // little time and cost the answer whatever those two would have found, and it
  // failed worst on exactly the questions this agent exists for — "which
  // robotics niche has the highest ROI" reads as neither, so both dropped out
  // before the run began. Someone reaching for Max Research has already decided
  // the question is worth an hour.
  for (const question of [
    "what happened to Concorde",
    "which robotics niche would be the highest roi",
    "what percentage of startups survive five years",
  ]) {
    const chosen = planMaxResearch({ question }).assignments.map((a) => a.participant);
    assert.deepEqual(
      [...chosen].sort(),
      ["agent_reach", "aris", "deep_research", "get_doc", "openscience", "praxist"],
      question,
    );
  }
});

test("what a question is about still shapes the plan, it just no longer trims it", () => {
  // The classifications survive as guidance for each participant rather than as
  // gates on the roster, so nothing that used to inform the briefs was lost.
  const empirical = planMaxResearch({ question: "reproduce the benchmark on this dataset" });
  assert.equal(empirical.empirical, true);
  const plain = planMaxResearch({ question: "what happened to Concorde" });
  assert.equal(plain.empirical, false);
  assert.equal(plain.assignments.length, empirical.assignments.length);
});

test("retrieval runs together, and what reads it waits", () => {
  const plan = planMaxResearch({
    question: "what percentage of startups survive five years",
  });
  const waves = participantWaves(plan).map((wave) =>
    wave.map((a) => a.participant),
  );
  assert.ok(waves[0].includes("deep_research"));
  assert.ok(waves[0].includes("get_doc"));
  assert.ok(waves.at(-1).includes("aris"));
  assert.ok(waves.length >= 2);
});

test("availability cannot shrink the six-agent plan", () => {
  const plan = planMaxResearch({
    question: "what percentage of startups survive five years",
  });
  const chosen = plan.assignments.map((a) => a.participant);
  assert.deepEqual(
    [...chosen].sort(),
    ["agent_reach", "aris", "deep_research", "get_doc", "openscience", "praxist"],
  );
});

/* ---------------------------------------------------------------- */
/* Running it                                                        */
/* ---------------------------------------------------------------- */

/** A stub runtime set, so the orchestration can be driven in milliseconds. */
function stubRuntimes(overrides = {}) {
  return (participant) => ({
    available: async () =>
      overrides[participant]?.available ?? { available: true },
    run: async () =>
      overrides[participant]?.result ?? {
        participant,
        status: "completed",
        output: `${participant} found something.`,
        runId: `${participant}_run`,
      },
  });
}

async function runToCompletion(input) {
  const { runId } = startRun({
    userId: 1,
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://localhost:0",
    ...input,
  });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (isTerminal(1, runId)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { runId, summary: getRun(1, runId), events: getEventsSince(1, runId, 0) };
}

test("a run commissions its participants and reconciles one answer", async () => {
  let seen = "";
  const { summary, events } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: stubRuntimes(),
    synthesize: async (prompt) => {
      seen = prompt;
      return "One reconciled answer.";
    },
  });

  assert.equal(summary.status, "completed");
  assert.equal(summary.answer, "One reconciled answer.");
  // Every participant's finding reached the synthesis.
  assert.match(seen, /deep_research found something/);
  assert.match(seen, /agent_reach found something/);
  assert.match(seen, /get_doc found something/);
  // The run narrates itself, because forty silent minutes look like death.
  const types = events.map((event) => event.type);
  assert.ok(types.includes("plan.completed"));
  assert.ok(types.includes("participant.started"));
  assert.ok(types.includes("participant.settled"));
  assert.ok(types.includes("synthesis.started"));
  assert.ok(types.includes("run.completed"));
});

test("an optional participant failing costs its part, not the answer", async () => {
  const { summary } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: stubRuntimes({
      get_doc: {
        result: {
          participant: "get_doc",
          status: "failed",
          output: "",
          reason: "no source configured",
        },
      },
    }),
    synthesize: async () => "Answered without the literature.",
  });
  assert.equal(summary.status, "completed");
  assert.ok(
    summary.results.some(
      (r) => r.participant === "get_doc" && r.status === "failed",
    ),
  );
});

test("one research service being down does not throw away the others' work", () => {
  // This used to name Deep Research as required, so a run where Get Doc found
  // ten papers and Agent Reach found a practitioner thread still failed
  // outright because one service was misconfigured. A live run did exactly
  // that. What a run needs is that something gathered evidence.
  const plan = planMaxResearch({ question: "what percentage of startups fail" });
  assert.ok(!plan.assignments.some((a) => a.required));
  assert.ok(RETRIEVAL_PARTICIPANTS.includes("deep_research"));
  assert.ok(RETRIEVAL_PARTICIPANTS.includes("get_doc"));
  // Method is not evidence, so it cannot be what carries a run.
  assert.ok(!RETRIEVAL_PARTICIPANTS.includes("aris"));
});

test("a run still answers when the biggest participant fails", async () => {
  const { summary } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: stubRuntimes({
      deep_research: {
        result: {
          participant: "deep_research",
          status: "failed",
          output: "",
          reason: "service unavailable",
        },
      },
    }),
    synthesize: async () => "Answered from the literature and the open web.",
  });
  assert.equal(summary.status, "completed");
  assert.equal(summary.answer, "Answered from the literature and the open web.");
});

test("a run with no evidence at all refuses to write prose", async () => {
  // Reconciling zero findings would produce an answer with nothing under it,
  // which is worse than reporting the failure.
  const { summary, events } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: (participant) => ({
      available: async () => ({ available: true }),
      run: async () =>
        participant === "aris"
          ? { participant, status: "completed", output: "<aris_turn_guidance/>" }
          : { participant, status: "failed", output: "", reason: "down" },
    }),
    synthesize: async () => "should never be written",
  });
  assert.equal(summary.status, "failed");
  assert.equal(summary.answer, "");
  assert.match(
    String(events.find((e) => e.type === "run.failed").payload.error),
    /no evidence to reconcile/,
  );
});

test("a run with nothing available fails before commissioning anything", async () => {
  const { summary } = await runToCompletion({
    question: "what happened to Concorde",
    runtimeFor: () => ({
      available: async () => ({ available: false, reason: "down" }),
      run: async () => {
        throw new Error("must not be called");
      },
    }),
    synthesize: async () => "should never be written",
  });
  assert.equal(summary.status, "failed");
});

test("a run can be stopped while it works", async () => {
  const { runId } = startRun({
    userId: 1,
    question: "what happened to Concorde",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://localhost:0",
    runtimeFor: () => ({
      available: async () => ({ available: true }),
      run: async () => new Promise(() => {}),
    }),
    synthesize: async () => "never",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(abortRun(1, runId), true);
  assert.equal(isTerminal(1, runId), true);
  assert.equal(getRun(1, runId).status, "aborted");
});

test("another user cannot read or stop someone else's run", async () => {
  const { runId } = startRun({
    userId: 1,
    question: "what happened to Concorde",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://localhost:0",
    runtimeFor: stubRuntimes(),
    synthesize: async () => "done",
  });
  assert.equal(getRun(2, runId), null);
  assert.deepEqual(getEventsSince(2, runId, 0), []);
  assert.equal(abortRun(2, runId), false);
});

/* ---------------------------------------------------------------- */
/* Reconciling                                                       */
/* ---------------------------------------------------------------- */

test("the synthesis is told what each kind of evidence is worth", () => {
  const plan = planMaxResearch({ question: "what percentage survive" });
  const prompt = maxResearchSynthesisPrompt({
    plan,
    results: [
      { participant: "deep_research", status: "completed", output: "60% [S1]" },
      { participant: "agent_reach", status: "completed", output: "threads say 40%" },
    ],
  });
  assert.match(prompt, /a loud thread is not a measurement/);
  assert.match(prompt, /that disagreement is a finding/);
  assert.match(prompt, /Do not average conflicting figures/);
  // And it inherits the shared standard rather than restating it.
  assert.match(prompt, /# research_answer_contract/);
  assert.match(prompt, /Repetition is not provenance/);
});

test("a participant that produced nothing is named, not quietly dropped", () => {
  // Otherwise the answer implies a part of the record was covered when it was
  // not, which is the same failure as claiming something is unpublished.
  const plan = planMaxResearch({ question: "what percentage survive" });
  const prompt = maxResearchSynthesisPrompt({
    plan,
    results: [
      { participant: "deep_research", status: "completed", output: "60% [S1]" },
      {
        participant: "get_doc",
        status: "unavailable",
        output: "",
        reason: "no source configured",
      },
    ],
  });
  assert.match(prompt, /Say so in the answer, in one line/);
  assert.match(prompt, /an answer that simply omits the gap reads as though everything was searched/);
  assert.match(prompt, /get_doc \(unavailable: no source configured\)/);
});

test("ARIS supplies method and is barred from being cited as evidence", () => {
  const plan = planMaxResearch({ question: "what percentage survive" });
  const prompt = maxResearchSynthesisPrompt({
    plan,
    results: [
      { participant: "deep_research", status: "completed", output: "60% [S1]" },
      { participant: "aris", status: "completed", output: "<aris_turn_guidance>method</aris_turn_guidance>" },
    ],
  });
  assert.match(prompt, /contributes no facts/);
  assert.match(prompt, /nothing in it may be cited as evidence/);
  // It is method, so it is not handed over as a finding to be summarized.
  assert.doesNotMatch(prompt, /<finding participant="aris"/);
});

test("coverage counts what failed as well as what worked", () => {
  const coverage = coverageSummary([
    { participant: "deep_research", status: "completed", output: "x" },
    { participant: "get_doc", status: "failed", output: "", reason: "down" },
  ]);
  assert.deepEqual(coverage.completed, ["deep_research"]);
  assert.deepEqual(coverage.absent, [
    { participant: "get_doc", status: "failed", reason: "down" },
  ]);
});

test("a participant's log is reduced to what it concluded", () => {
  assert.equal(
    summarizeEvents([
      { payload: { message: "searching" } },
      { payload: { report: "The finished report." } },
    ]),
    "The finished report.",
  );
  // A run that finished without a tidy summary still found things.
  assert.match(
    summarizeEvents([
      { payload: { message: "found a paper" } },
      { payload: { message: "saved it" } },
    ]),
    /found a paper\nsaved it/,
  );
});

/* ---------------------------------------------------------------- */
/* Reaching it from a chat                                           */
/* ---------------------------------------------------------------- */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = (relative) =>
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", relative),
    "utf8",
  );

test("both chat surfaces route it, by command and by phrase", () => {
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    const body = source(file);
    assert.match(body, /const routeMaxResearchCommand = useCallback/, file);
    // It has to be in the send chain, or typing the phrase does nothing.
    assert.match(body, /routeMaxResearchCommand\(text\)/, file);
    // And in the retry chain, or regenerating the turn silently drops it.
    assert.match(
      body,
      /routeMaxResearchCommand\(previousUser\.content, \{ branchGroupId \}\)/,
      file,
    );
    // Plain language is honoured, not just the slash command.
    assert.match(body, /maxResearchInvocation/, file);
  }
});

test("both surfaces share one launcher rather than a copy each", () => {
  // Two copies of the start/preview/persist/failure dance is two places for
  // them to drift, and the turn is identical on both surfaces.
  for (const file of [
    "src/app/components/hermes/dashboard-agent-terminal.tsx",
    "src/app/components/hermes/garden-agent-chat.tsx",
  ]) {
    assert.match(source(file), /launchMaxResearchTurn/, file);
  }
  const launcher = source("src/app/components/hermes/launch-max-research.ts");
  // A run that started but whose turn failed to save is still running: calling
  // that a failure would stop the person watching a card about to answer.
  assert.match(launcher, /if \(runStarted\)/);
  assert.match(launcher, /kind: "max_research"/);
});

test("the palette offers it and the card renders it on both surfaces", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  assert.match(hub, /MAX_RESEARCH_COMMAND/);
  assert.match(hub, /showMaxResearch/);

  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /onSelectMaxResearch/);

  assert.match(
    source("src/app/components/hermes/agent-runtime-panel.tsx"),
    /message\.maxResearchRun/,
  );
  assert.match(
    source("src/app/gardens/[clusterSlug]/workspace-client.tsx"),
    /msg\.maxResearchRun/,
  );
});

test("the card subscribes and closes a dead stream", () => {
  // A run the manager has evicted answers 404. Without the guard the browser
  // reconnects to it for as long as the transcript is on screen.
  const card = source("src/app/components/hermes/inline-max-research-run.tsx");
  assert.match(card, /new EventSource\(/);
  assert.match(card, /onerror/);
  assert.match(card, /persistedOutcome && persistedOutcome !== "running"/);
});

/* ---------------------------------------------------------------- */
/* What a live run found                                             */
/* ---------------------------------------------------------------- */

test("availability means what starting actually requires", () => {
  // Found by running it for real. Deep Research reported available — the mode
  // was enabled and the service answered its health check — and then failed at
  // the first call with `service_misconfigured`, because the shared secret was
  // unset. The plan had already committed to it as the required participant, so
  // the whole run ended on a condition that was knowable before it started.
  const body = source("src/lib/max-research/participants.ts");
  assert.match(body, /resolveDeepResearchConfig\(\)\.secret\.trim\(\)/);
  assert.match(body, /shared secret is not configured/);
  // And it asks the service for its state rather than inferring it from a flag.
  assert.match(body, /state\.runtimeState === "available"/);
});

test("a run manager's health is asked, not assumed from its import", () => {
  // The same class of bug one layer over: importing a run manager proves
  // nothing, and both of these throw from startRun when their clone is missing.
  const body = source("src/lib/max-research/participants.ts");
  assert.match(body, /health: \(\) => Promise<\{ available: boolean/);
  assert.match(body, /runtimeAvailability\(\)/);
  // Both run-manager participants consult it. Counted by call rather than by
  // punctuation: OpenScience has its own adapter now (it needs an apiKey and an
  // options.harness the generic one never passed), so it calls this in a
  // slightly different shape while doing the same thing.
  assert.equal(body.match(/runtimeAvailability\(\)/g)?.length, 2);
  assert.match(body, /openscience\/runtime\.ts/);
  assert.match(body, /agent-reach\/runtime\.ts/);
});

test("a participant that cannot start remains visible and is not invoked", async () => {
  const { summary, events } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: (participant) => ({
      available: async () =>
        participant === "get_doc"
          ? { available: false, reason: "no source configured" }
          : { available: true },
      run: async () => {
        if (participant === "get_doc") throw new Error("must not be commissioned");
        return {
          participant,
          status: "completed",
          output: `${participant} found something.`,
        };
      },
    }),
    synthesize: async () => "Reconciled without the literature.",
  });
  assert.equal(summary.status, "completed");
  assert.ok(summary.participants.includes("get_doc"));
  assert.equal(summary.participants.length, 6);
  assert.ok(
    summary.results.some(
      (result) =>
        result.participant === "get_doc" && result.status === "unavailable",
    ),
  );
  const planEvent = events.find((event) => event.type === "plan.completed");
  assert.equal(planEvent.payload.participants.length, 6);
  assert.ok(
    events.some(
      (event) =>
        event.type === "participant.unavailable" &&
        event.payload.participant === "get_doc",
    ),
  );
});

test("a run that stopped is not a run that succeeded", () => {
  // `isTerminal` says a run has stopped and nothing about whether it worked.
  // Assuming success from it handed the synthesis a failure notice as a
  // finding: a live run reported Agent Reach "completed" carrying the thirty-one
  // characters of its own "finished without an answer" message, which would
  // then have been reconciled as evidence about the world.
  assert.equal(
    terminalStatusFromEvents([{ type: "run.started" }, { type: "run.completed" }]),
    "completed",
  );
  assert.equal(
    terminalStatusFromEvents([{ type: "run.started" }, { type: "run.failed" }]),
    "failed",
  );
  assert.equal(
    terminalStatusFromEvents([{ type: "run.started" }, { type: "run.aborted" }]),
    "aborted",
  );
  // A log with no terminal event cannot claim the run worked.
  assert.equal(terminalStatusFromEvents([{ type: "run.started" }]), "failed");
  assert.equal(terminalStatusFromEvents([]), "failed");
});

test("a failed participant's message becomes its reason, never its finding", () => {
  const body = source("src/lib/max-research/participants.ts");
  // The output is cleared and moved to `reason` unless the run really completed.
  assert.match(body, /output: status === "completed" \? output : ""/);
  assert.match(body, /reason: output \|\| "The run ended without an answer\."/);
  // And the status is read from the log rather than asserted.
  assert.doesNotMatch(body, /collect: \(runId\) => \(\{[\s\S]{0,120}status: "completed"/);
});

test("a failed reconciliation keeps the research it was given", async () => {
  // A live run lost every agent's finished work to one transient 502 at the
  // last step. The expensive half had succeeded; only the cheap half failed.
  const { runId, summary, events } = await runToCompletion({
    question: "what percentage of relationships survive",
    runtimeFor: stubRuntimes(),
    synthesize: async () => {
      throw new Error("The reconciliation model returned 502.");
    },
  });
  assert.equal(summary.status, "failed");
  // The findings are still on the run, and the failure says so.
  assert.ok(summary.results.length >= 2);
  const failure = events.find((event) => event.type === "run.failed");
  assert.equal(failure.payload.findingsRetained, true);
  assert.equal(failure.payload.resynthesizable, true);
  assert.ok(
    failure.payload.retainedFindings.some(
      (finding) =>
        finding.participant === "deep_research" &&
        /deep_research found something/.test(finding.output),
    ),
  );

  // A Runtime V2 worker exits after this terminal event, so recovery cannot
  // depend on the manager's in-memory map. The durable hand-back carries the
  // actual findings and explicitly tells the continuation they are evidence.
  const {
    MAX_RESEARCH_RETAINED_FINDINGS_MARKER,
    terminalResultFromEvents,
  } = await import("../src/lib/max-research/runtime-run-manager.ts");
  const handedBack = terminalResultFromEvents(events);
  assert.equal(handedBack.outcome, "failed");
  assert.ok(handedBack.content.includes(MAX_RESEARCH_RETAINED_FINDINGS_MARKER));
  assert.match(handedBack.content, /deep_research found something/);
  assert.match(handedBack.content, /Source collection was partial but not empty/);

  // And reconciling again costs nothing but the one call that failed.
  const { resynthesizeRun } = await import(
    "../src/lib/max-research/run-manager.ts"
  );
  const retried = await resynthesizeRun({
    userId: 1,
    runId,
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://localhost:0",
    synthesize: async (prompt) => {
      // The same findings, not a fresh round of research.
      assert.match(prompt, /deep_research found something/);
      return "Reconciled on the second attempt.";
    },
  });
  assert.equal(retried.status, "completed");
  assert.equal(retried.answer, "Reconciled on the second attempt.");
  assert.equal(getRun(1, runId).answer, "Reconciled on the second attempt.");
});

test("a transient upstream failure is retried before it is believed", () => {
  const body = source("src/lib/max-research/completion.ts");
  assert.match(body, /const RETRYABLE = new Set\(\[408, 429, 500, 502, 503, 504\]\)/);
  assert.match(body, /const ATTEMPTS = 3/);
  // A max-effort writer can legitimately run beyond the former ten-minute
  // deadline. Timing it out must not launch duplicate long generations.
  assert.match(body, /SYNTHESIS_TIMEOUT_MS = 30 \* 60_000/);
  assert.match(body, /import \{ createLongHeaderTimeoutFetch \} from "\.\.\/chatmock-client\.ts"/);
  assert.match(
    body,
    /const synthesisFetch = createLongHeaderTimeoutFetch\(\{\s*timeoutMs: SYNTHESIS_TIMEOUT_MS,/,
  );
  assert.match(body, /await \(input\.fetchImpl \?\? synthesisFetch\)\(/);
  assert.doesNotMatch(body, /const response = await fetch\(/);
  assert.match(
    body,
    /if \(controller\.signal\.aborted\)[\s\S]{0,220}30-minute deadline/,
  );
  assert.match(body, /describeTransportFailure/);
  // An empty completion is a failure too — a run that "succeeded" with no text
  // is the same lost work with a friendlier status.
  assert.match(body, /returned no text/);
});

test("resynthesis refuses a run with nothing to reconcile", async () => {
  const { resynthesizeRun } = await import(
    "../src/lib/max-research/run-manager.ts"
  );
  await assert.rejects(
    () =>
      resynthesizeRun({
        userId: 1,
        runId: "mxrun_nonexistent",
        model: "m",
        reasoningEffort: "medium",
        baseUrl: "http://localhost:0",
      }),
    /run_not_found/,
  );
});

test("what a run concluded comes from the event that ended it", () => {
  // These runtimes reuse one field for two jobs. Agent Reach files a progress
  // note and its final answer both under `summary`, so scanning the log
  // returned "Choosing a platform and backend" — a step-zero status line — as
  // the finding. A live run did exactly that.
  const events = [
    { type: "run.started", payload: {} },
    { type: "run.progress", payload: { summary: "Choosing a platform and backend" } },
    { type: "run.progress", payload: { summary: "Reviewing what came back" } },
    { type: "run.completed", payload: { summary: "The median is 2.9 years [S1]." } },
  ];
  assert.equal(summarizeEvents(events), "The median is 2.9 years [S1].");

  // The log is still the fallback when the terminal event carries no text.
  assert.equal(
    summarizeEvents([
      { type: "run.progress", payload: { summary: "partial finding" } },
      { type: "run.completed", payload: { elapsedSec: 12 } },
    ]),
    "partial finding",
  );
});

test("a search query is the question, never the question plus instructions", () => {
  // Found by a live run. Get Doc's `query` is documented as the user's own
  // words; it received the question with three hundred characters of guidance
  // appended, turned that into catalog queries, and drew HTTP 400 from arXiv
  // and Crossref. The answer then reported that the literature had nothing.
  const plan = planMaxResearch({
    question: "what percentage of relationships survive",
  });
  const getDoc = plan.assignments.find((a) => a.participant === "get_doc");
  assert.equal(getDoc.question, "what percentage of relationships survive");
  assert.ok(getDoc.guidance.length > 40, "it still gets guidance");
  assert.ok(!getDoc.question.includes(getDoc.guidance));
  // And the runtime sends a catalog-safe form of the bare question as the
  // query, while guidance remains context. Short user questions are unchanged.
  assert.equal(maxResearchLiteratureQuery(getDoc.question), getDoc.question);
  const body = source("src/lib/max-research/participants.ts");
  assert.match(body, /query: maxResearchLiteratureQuery\(brief\.question\),/);
  assert.match(body, /conversationContext: \[context\.conversationContext, brief\.guidance\]/);
});

test("participants that take a task still get the whole brief", () => {
  const plan = planMaxResearch({ question: "what do practitioners say about X" });
  const reach = plan.assignments.find((a) => a.participant === "agent_reach");
  assert.ok(reach.brief.startsWith(reach.question));
  assert.ok(reach.brief.includes(reach.guidance));
  const body = source("src/lib/max-research/participants.ts");
  assert.match(body, /task: brief\.brief/);
});

test("the open-internet brief asks for findings, not for a plan", () => {
  // A live run returned the agent's approach — "Reddit via OpenCLI gets one
  // login-backed attempt; GitHub via gh will check whether…" — as its finding,
  // because the brief described the job instead of demanding results.
  const plan = planMaxResearch({ question: "what do practitioners say about X" });
  const reach = plan.assignments.find((a) => a.participant === "agent_reach");
  assert.match(reach.guidance, /Report only what you actually found/);
  assert.match(reach.guidance, /Do not describe your plan, your approach/);
  assert.match(reach.guidance, /none of that is a finding/);
  // And it has to be able to say it found nothing, rather than filling space.
  assert.match(reach.guidance, /say plainly that you reached nothing/);
});

test("Get Doc is sent a complete request, not a partial one behind a cast", () => {
  // The bug a live run exposed and a cast had hidden. `{ query } as never`
  // omitted every other field, so `limit` was undefined, OpenAlex's `per-page`
  // became `limit * 2` = NaN, and all six catalogs answered HTTP 400. The run
  // reported "no documents matched" for a question with a real literature, and
  // the answer repeated that the literature had nothing to say. With the
  // request complete, the same question returns ten papers with free PDFs.
  const body = source("src/lib/max-research/participants.ts");
  // Only the comment recording why it went may mention it.
  assert.doesNotMatch(body, /\} as never\)/);
  assert.match(body, /limit: DEFAULT_RESULT_LIMIT/);
  for (const field of ["openAccessOnly", "yearFrom", "yearTo", "sources"]) {
    assert.match(body, new RegExp(`${field}:`), field);
  }
});

test("a failed participant reports the failure, not the last thing it was doing", () => {
  // Agent Reach files `run.failed` under `error`, and the reducer only asked
  // for content keys — so it fell through to the log and reported "Reviewing
  // what came back", a step-two progress line, as the reason a run failed. The
  // actual error was invisible to everything downstream, including me.
  assert.equal(
    summarizeEvents([
      { type: "agent.thinking", payload: { summary: "Reviewing what came back" } },
      { type: "run.failed", payload: { error: "ChatMock returned 502" } },
    ]),
    "ChatMock returned 502",
  );
  // A completed run still reports its content, not an incidental error field.
  assert.equal(
    summarizeEvents([
      { type: "run.completed", payload: { summary: "The finding.", error: "" } },
    ]),
    "The finding.",
  );
});

test("one slow model call does not end a sixteen-step agent", () => {
  // Found by running it: with two other research agents on the same ChatMock,
  // an Agent Reach call ran past the three-minute abort and the whole run
  // failed at 192 seconds having found nothing.
  const body = source("src/lib/agent-reach/run-manager.ts");
  assert.match(body, /const MODEL_ATTEMPTS = 3;/);
  assert.match(body, /function isRetryableModelFailure/);
  // A timeout and a transient upstream code are worth retrying; a 400 is not.
  assert.match(body, /error\.name === "AbortError"/);
  assert.ok(body.includes("ChatMock returned (408|429|5"), "transient codes retried");
});

test("a participant cut off at the budget keeps what it had reached", () => {
  // Agent Reach runs up to sixteen steps and holds its answer-so-far. Cutting
  // it off at forty-five minutes and discarding that means the orchestration
  // paid for the time and carried none of it into the answer. It is reported
  // with the reason, so nothing reads it as a finished pass.
  const body = source("src/lib/max-research/participants.ts");
  assert.match(body, /status: partial \? "completed" : "failed"/);
  assert.match(body, /Cut off at the time this orchestration allows/);
  assert.match(body, /rather than a finished pass/);
});

test("a participant's evidence may not vanish from the answer without a word", () => {
  // A live run leaned on the two web passes and never mentioned the
  // peer-reviewed meta-analysis the literature pass had found — the strongest
  // single source in the run, invisible to the reader.
  const plan = planMaxResearch({ question: "what percentage of startups fail" });
  const prompt = maxResearchSynthesisPrompt({
    plan,
    results: [
      { participant: "deep_research", status: "completed", output: "half [S1]" },
      { participant: "get_doc", status: "completed", output: "21.9% survived [S2]" },
    ],
  });
  assert.match(prompt, /Use what each participant found/);
  assert.match(prompt, /has been wasted/);
  assert.match(prompt, /say so in a clause rather than dropping it silently/);
});

/* ---------------------------------------------------------------- */
/* The audit                                                         */
/* ---------------------------------------------------------------- */

test("the answer is read back against its evidence before it ships", async () => {
  // Two live runs wrote genuinely good answers that never used their
  // literature participant's best find and left their most striking claim
  // uncited. Neither is a reasoning failure; both are what happens when
  // nothing checks the draft against the evidence it came from.
  const prompts = [];
  const { summary, events } = await runToCompletion({
    question: "what percentage of startups fail",
    runtimeFor: stubRuntimes(),
    synthesize: async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? "A draft that forgets the literature entirely, at some length."
        : "A repaired answer that uses every finding and cites each figure.";
    },
  });

  assert.equal(prompts.length, 2, "one call writes, a second audits");
  assert.match(prompts[1], /You are auditing a research answer/);
  assert.match(prompts[1], /<draft>/);
  assert.equal(summary.answer, "A repaired answer that uses every finding and cites each figure.");
  assert.ok(events.some((e) => e.type === "review.completed"));
});

test("a mangled audit leaves the draft standing", async () => {
  // The draft was already written under the whole contract. Trading it for a
  // truncated review would be a downgrade dressed as a check.
  const { summary, events } = await runToCompletion({
    question: "what percentage of startups fail",
    runtimeFor: stubRuntimes(),
    synthesize: async (prompt) =>
      /You are auditing/.test(prompt) ? "oops" : "The full, careful draft answer.",
  });
  assert.equal(summary.answer, "The full, careful draft answer.");
  assert.ok(events.some((e) => e.type === "review.skipped"));
});

test("an audit that throws does not cost the run its answer", async () => {
  const { summary } = await runToCompletion({
    question: "what percentage of startups fail",
    runtimeFor: stubRuntimes(),
    synthesize: async (prompt) => {
      if (/You are auditing/.test(prompt)) throw new Error("502");
      return "The full, careful draft answer.";
    },
  });
  assert.equal(summary.status, "completed");
  assert.equal(summary.answer, "The full, careful draft answer.");
});

test("the audit checks the two things live runs actually got wrong", () => {
  // Imported at the top with the other modules under test.
  const joined = REVIEW_CHECKS.join(" ");
  assert.match(joined, /appears nowhere in the answer/);
  assert.match(joined, /carries no citation, or names no publisher/);
  // And it may not research or soften — only account.
  const body = source("src/lib/max-research/review.ts");
  assert.match(body, /do not invent a source for it/);
  assert.match(body, /It does not mean adding claims, hedging a conclusion/);
});

test("a closed source is named at the end so the reader is told", () => {
  // Agent Reach reads the open web but not a platform behind a login. Without
  // this the answer silently omits whatever it could not open, and a subject
  // nobody discusses looks identical to a forum the agent could not reach.
  const plan = planMaxResearch({ question: "what do practitioners say" });
  const prompt = maxResearchSynthesisPrompt({
    plan,
    results: [
      { participant: "deep_research", status: "completed", output: "x [S1]" },
      {
        participant: "agent_reach",
        status: "completed",
        output: "what the open web said",
        limitations: [
          { name: "reddit", detail: "warn" },
          { name: "twitter", detail: "warn" },
        ],
      },
    ],
  });
  // Named as parts of the record rather than as participants: the reader has
  // no idea what `agent_reach` is, and the sentence is about what went unread.
  assert.match(prompt, /closed while this ran and nothing from them reached these findings: reddit, twitter/);
  assert.ok(
    !/agent_reach could not reach/.test(prompt),
    "the closed-source line must not attribute to an internal participant name",
  );
  assert.match(prompt, /End the answer with a short line naming these/);
  assert.match(prompt, /a subject nobody discusses from a source that was simply shut/);
});

test("the untraceable-claim repair applies to evidence, not to the run's own report", () => {
  // A live audit wrapped the coverage-gap and closed-source lines in "the run
  // could not trace the claim that...", turning the two most useful sentences
  // in the answer into nonsense. Those are facts handed to the audit, not
  // claims needing a source.
  const plan = planMaxResearch({ question: "what percentage of startups fail" });
  const prompt = maxResearchReviewPrompt({
    plan,
    draft: "A draft.",
    results: [{ participant: "get_doc", status: "completed", output: "a paper" }],
  });
  assert.match(prompt, /a claim \*about the world\*/);
  assert.match(prompt, /Statements about the run itself/);
  assert.match(prompt, /Leave them as plain statements/);
});
