// The bug that made every "do deep research" answer look unsourced.
//
// The Deep Research engine writes a fully cited report: [S1] markers after each
// claim and a source registry appended at the end. None of that reached the
// reader, for three compounding reasons, and each one on its own was enough:
//
//   1. The hand-back truncated the result to 6,000 characters. A report is
//      9,000-15,000, and the registry is the last thing in it — so the sources
//      were the first thing deleted.
//   2. The hand-back then told the model to summarize "in your own words",
//      which is an instruction to strip citations.
//   3. The writing standard was gated on the turn holding a web tool. A
//      hand-back turn holds none, so the one kind of answer built entirely out
//      of sources was the one kind that never got the standard.

import assert from "node:assert/strict";
import test from "node:test";

import { agentLaunchContinuationMessage } from "../src/lib/hermes/agent-launch.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

const REGISTRY = [
  "## Sources",
  "",
  "- [S1] https://ifr.org/report",
  "- [S2] https://www.nist.gov/assembly",
  "- [S3] https://semi.org/forecast",
].join("\n");

function citedReport(paragraphs = 420) {
  const prose = Array.from(
    { length: paragraphs },
    (_, index) =>
      `Installations reached 542,076 units in 2024 [S${(index % 3) + 1}], later revised.`,
  ).join(" ");
  return `${prose}\n\n${REGISTRY}`;
}

const decision = {
  mode: "knowledge_work",
  implementationRequired: false,
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedOperations: [],
  allowedCommandPatterns: [],
  allowedTools: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
};

test("a full-length research report is carried whole, untouched", () => {
  // The engine caps its own report at FinalReportMaxTokens (8,000 tokens, about
  // 36,000 characters) plus its source registry, so the longest report it can
  // physically produce must arrive byte-for-byte. Truncating a report at all
  // was the bug; the previous fix only made the truncation less destructive.
  const report = citedReport(560);
  assert.ok(
    report.length > 36_000,
    "the fixture is at least as long as the engine's own ceiling",
  );
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "completed",
    content: report,
  });
  assert.ok(handback.includes(report), "the report appears verbatim");
  assert.doesNotMatch(handback, /exceeded the message size limit/);
});

test("the limit that remains is the transport's, not a taste judgement", () => {
  // The messages route rejects a text field over 100,000 characters with a 400
  // rather than trimming it, so a continuation past that does not arrive
  // shortened — it does not arrive, and a finished run produces no answer. The
  // guard exists for a worker that dumps a log, and it still refuses to destroy
  // a source registry on the way.
  const runaway = `${"x".repeat(150_000)}

${REGISTRY}`;
  const handback = agentLaunchContinuationMessage({
    agentName: "Agent Browser",
    outcome: "completed",
    content: runaway,
  });
  assert.ok(handback.length <= 100_000, "fits inside what the route accepts");
  assert.match(handback, /exceeded the message size limit/);
  assert.match(handback, /## Sources/);
  assert.match(handback, /https:\/\/semi\.org\/forecast/);
});

test("a cited result is not handed back with an order to paraphrase it", () => {
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "completed",
    content: `Installations reached 542,076 in 2024 [S1].\n\n${REGISTRY}`,
  });
  assert.doesNotMatch(handback, /in your own words/);
  assert.match(handback, /do not restate a sourced figure/);
  assert.match(handback, /Keep the source list at the end/);
  // An uncited number must not be lent one on the way through.
  assert.match(handback, /say that it was uncited rather than lending it one/);
});

test("a worker that returned no citations keeps the plain instruction", () => {
  // The rule follows the material, not the agent: paraphrasing a rendered video
  // path in your own words is the right thing to do with it.
  const handback = agentLaunchContinuationMessage({
    agentName: "Vimax",
    outcome: "completed",
    content: "Rendered the clip to /out/clip.mp4",
  });
  assert.match(handback, /in your own words/);
  assert.doesNotMatch(handback, /do not restate a sourced figure/);
});

test("a failed run is still reported as a failure, cited or not", () => {
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "failed",
    content: `Partial finding [S1].\n\n${REGISTRY}`,
  });
  assert.match(handback, /did not finish/);
  assert.match(handback, /Say what failed/);
});

test("the writing standard reaches a turn holding a cited report and no web tool", () => {
  // The gate used to be "does this turn have websearch", which is exactly
  // backwards for a hand-back: it has no tools and is made entirely of sources.
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText:
      "Deep Research finished. Installations reached 542,076 in 2024 [S1]. Which niche has the highest return?",
  });
  assert.match(prompt, /# research_answer_contract/);
  assert.match(prompt, /One source is not a consensus/);
});

test("a turn reporting an uncited worker owes no research standard", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText: "Vimax finished. It rendered the clip. Tell the user.",
  });
  assert.doesNotMatch(prompt, /# research_answer_contract/);
});

test("a web-enabled turn still gets it, as before", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: { ...decision, allowedTools: ["websearch"] },
    userText: "Which robotics niche has the highest return?",
  });
  assert.match(prompt, /# research_answer_contract/);
});

test("a superlative is a judgement, and never a one-fact lookup", () => {
  // The hole that made all of this moot: "which niche has the highest return?"
  // is one interrogative about one subject with no history, which is everything
  // the cheap branch looks for — so the question a person most needs research
  // for was getting three searches and no writing standard at all.
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: { ...decision, allowedTools: ["websearch"] },
    userText: "what niche would be the highest roi?",
  });
  assert.match(prompt, /# research_answer_contract/);
  assert.match(prompt, /Name the basis you are judging on/);
});

test("the hand-back preserves the publisher and the scope, not only the marker", () => {
  // "[S2]" survives compression easily; "the industry federation reports" and
  // "US median" are the parts a rewrite drops, and they are the parts a reader
  // needs in order to weigh the number and know whether it applies to them.
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "completed",
    content: `US mid-level bands run USD 185,000 to 240,000 [S4].

${REGISTRY}`,
  });
  assert.match(handback, /Keep the publisher too/);
  assert.match(handback, /rather than leaving the reader a bare marker/);
  assert.match(handback, /keep any scope the figure only holds inside/);
});

test("the shared standard carries the rules the hand-back leans on", () => {
  // The instruction above tells the model to keep them; the standard says why,
  // and covers the turn that did its own searching too.
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText:
      "Deep Research finished. Bands run USD 185,000 to 240,000 [S4]. Which niche pays best?",
  });
  assert.match(prompt, /Name the publisher, not just the marker/);
  assert.match(prompt, /Carry the scope a figure only holds inside/);
  assert.match(prompt, /A projection is not a measurement/);
});

test("the hand-back's own opening is called out as the unchecked sentence", () => {
  // The summary is the one part of the answer the worker did not write, so
  // nothing has verified it. A real run opened with "roughly 60% of first
  // marriages survive for life" above a correctly cited finding that about half
  // end within twenty years — the body was disciplined and the sentence on top
  // of it was not.
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "completed",
    content: `About half of first marriages end within twenty years [S8].

${REGISTRY}`,
  });
  assert.match(handback, /riskiest sentence you will write/);
  assert.match(handback, /consistent with every figure you carry below it/);
  assert.match(handback, /correct the opening rather than the evidence/);
});

test("the standard binds summaries and refuses laundered provenance", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText:
      "Deep Research finished. About half of first marriages end within twenty years [S8]. What share survive?",
  });
  assert.match(prompt, /The summary may not outrun the body it summarizes/);
  assert.match(prompt, /Repetition is not provenance/);
  // The specific inversion of the publisher rule: a real institution's name on
  // a claim it never made survives scrutiny longer than a bare number.
  assert.match(prompt, /worse than leaving the number bare/);
});

test("the hand-back preserves the publisher and the scope, not only the marker", () => {
  // "[S2]" survives compression easily; "the industry federation reports" and
  // "US median" are the parts a rewrite drops, and they are the parts a reader
  // needs to weigh the number and know whether it applies to them.
  const handback = agentLaunchContinuationMessage({
    agentName: "Deep Research",
    outcome: "completed",
    content: `US mid-level bands run USD 185,000 to 240,000 [S4].

${REGISTRY}`,
  });
  assert.match(handback, /Keep the publisher too/);
  assert.match(handback, /rather than leaving the reader a bare marker/);
  assert.match(handback, /keep any scope the figure only holds inside/);
});

test("the shared standard carries the rules the hand-back leans on", () => {
  // The instruction above tells the model to keep them; the standard is what
  // says why and covers the turn that did its own searching too.
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText: "Deep Research finished. Bands run USD 185,000 to 240,000 [S4]. Which niche pays best?",
  });
  assert.match(prompt, /Name the publisher, not just the marker/);
  assert.match(prompt, /Carry the scope a figure only holds inside/);
  assert.match(prompt, /A projection is not a measurement/);
});
