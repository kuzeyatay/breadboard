// Answer-quality evaluation for the evidence-calibration contract.
//
// The deterministic half of the fix is covered by
// dashboard/tests/evidence-calibration.test.mjs, which can prove that the
// prompt tells the model the right thing and that a value inside its own
// stated bound is reported as inside it. What that suite cannot prove is the
// part that matters most: that the answer the model actually writes keeps
// observation separate from inference, refuses to promote a possibility into
// a finding, and still commits to a plain answer where the evidence carries
// one.
//
// This script does that, against a live model, on the same seven-scenario set.
// It is opt-in because it costs provider calls and because a grader model is
// not a deterministic oracle: it belongs in a reviewed run, not in the
// per-commit suite.
//
//   node --experimental-strip-types scripts/evaluate-evidence-calibration.mjs
//   node --experimental-strip-types scripts/evaluate-evidence-calibration.mjs --scenario derived-metric-vs-in-range-component
//   EVIDENCE_EVAL_MODEL=... EVIDENCE_EVAL_GRADER=... node ... --json report.json
//
// Every property is judged semantically. Nothing here looks for a particular
// sentence, because an answer that satisfies the contract in its own words is
// a passing answer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeHermesSystemPrompt } from "../dashboard/src/lib/hermes/system-prompts.ts";
import { suppliedEvidenceText } from "../dashboard/src/lib/hermes/evidence-calibration.ts";
import { localChatmockBaseUrl } from "../dashboard/src/lib/chatmock-server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const scenarioFile = path.join(repoRoot, "qa", "evidence-calibration", "scenarios.json");

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const ANSWER_MODEL = process.env.EVIDENCE_EVAL_MODEL?.trim() || "default";
const GRADER_MODEL = process.env.EVIDENCE_EVAL_GRADER?.trim() || ANSWER_MODEL;
const BASE_URL = process.env.EVIDENCE_EVAL_BASE_URL?.trim() || localChatmockBaseUrl();
/** Answers longer than this are reported as verbose rather than failed outright. */
const CONCISE_WORD_BUDGET = Number(process.env.EVIDENCE_EVAL_WORD_BUDGET ?? 450);

const decision = {
  mode: "knowledge",
  requestedOutcome: "interpret supplied material",
  implementationRequired: false,
  decisionReason: "evaluation harness",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  // Web research is on the turn, as it is on a real knowledge turn, so the
  // evaluation also sees whether the model browses when it should not.
  allowedTools: ["websearch", "webfetch"],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: new Date().toISOString(),
  expiresAt: null,
};

/**
 * One completion, retried past a transient provider failure.
 *
 * A local council or proxy answers 502 often enough that a seven scenario run
 * would otherwise die halfway through on something that has nothing to do with
 * the answers being graded.
 */
async function complete(model, messages, maxTokens, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await completeOnce(model, messages, maxTokens);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

async function completeOnce(model, messages, maxTokens) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_completion_tokens: maxTokens,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `${model} returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${model} returned no content`);
  }
  return content.trim();
}

/** The user message as Breadboard builds it: the question plus the attachment. */
function userMessage(scenario) {
  return [
    scenario.question,
    "",
    `<breadboard_attachment name=${JSON.stringify(scenario.attachmentName)}>`,
    scenario.evidence,
    "</breadboard_attachment>",
  ].join("\n");
}

const GRADER_INSTRUCTION = [
  "You are grading one assistant answer against properties it was required to have.",
  "You are given the source material the answer was written about, the question,",
  "the answer, and a list of properties. Judge each property on meaning, never on",
  "wording: an answer that satisfies a property in its own words satisfies it.",
  "",
  "A `must` property holds when the answer genuinely does that thing.",
  "A `mustNot` property holds when the answer avoids doing that thing.",
  "Read the source material yourself before judging any claim about it.",
  "",
  "Reply with JSON only, no prose and no code fence:",
  '{"results":[{"id":"<property id>","holds":true|false,"why":"<one short sentence>"}]}',
].join("\n");

async function grade(scenario, answer) {
  const properties = [
    ...scenario.rubric.must.map((text, index) => ({
      id: `must-${index + 1}`,
      kind: "must",
      text,
    })),
    ...scenario.rubric.mustNot.map((text, index) => ({
      id: `mustNot-${index + 1}`,
      kind: "mustNot",
      text,
    })),
  ];
  const prompt = [
    "--- SOURCE MATERIAL ---",
    scenario.evidence,
    "--- QUESTION ---",
    scenario.question,
    "--- ANSWER ---",
    answer,
    "--- PROPERTIES ---",
    ...properties.map(
      (property) =>
        `${property.id} (${property.kind}): the answer ${property.text}`,
    ),
  ].join("\n");
  const raw = await complete(
    GRADER_MODEL,
    [
      { role: "system", content: GRADER_INSTRUCTION },
      { role: "user", content: prompt },
    ],
    1600,
  );
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`grader returned unparseable output: ${raw.slice(0, 200)}`);
  }
  const byId = new Map(
    (parsed.results ?? []).map((entry) => [String(entry.id), entry]),
  );
  return properties.map((property) => {
    const verdict = byId.get(property.id);
    return {
      ...property,
      // A property the grader did not answer is a failure to establish, not a
      // pass: silence has never been evidence for anything here either.
      holds: verdict?.holds === true,
      why: verdict?.why ?? "the grader did not judge this property",
      judged: Boolean(verdict),
    };
  });
}

async function run() {
  const set = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  const only = argValue("--scenario");
  const scenarios = only
    ? set.scenarios.filter((scenario) => scenario.id === only)
    : set.scenarios;
  if (!scenarios.length) throw new Error(`no scenario matched ${only}`);

  const report = [];
  for (const scenario of scenarios) {
    const system = composeHermesSystemPrompt({
      surface: "dashboard_terminal",
      decision,
      userText: scenario.question,
      suppliedEvidence: suppliedEvidenceText([
        {
          type: "text",
          name: scenario.attachmentName,
          text: scenario.evidence,
        },
      ]),
    });
    const answer = await complete(
      ANSWER_MODEL,
      [
        { role: "system", content: system },
        { role: "user", content: userMessage(scenario) },
      ],
      2400,
    );
    const words = answer.split(/\s+/).filter(Boolean).length;
    const results = await grade(scenario, answer);
    const failures = results.filter((result) => !result.holds);
    report.push({
      id: scenario.id,
      domain: scenario.domain,
      words,
      verbose: words > CONCISE_WORD_BUDGET,
      passed: failures.length === 0,
      results,
      answer,
    });

    const mark = failures.length === 0 ? "PASS" : "FAIL";
    console.log(
      `\n${mark}  ${scenario.id}  [${scenario.domain}]  ${words} words${
        words > CONCISE_WORD_BUDGET ? "  (over the concision budget)" : ""
      }`,
    );
    for (const result of failures) {
      console.log(`   x ${result.kind}: ${result.text}`);
      console.log(`     ${result.why}`);
    }
  }

  const jsonOut = argValue("--json");
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }

  const failed = report.filter((entry) => !entry.passed);
  const verbose = report.filter((entry) => entry.verbose);
  console.log(
    `\n${report.length - failed.length}/${report.length} scenarios satisfied every property; ` +
      `${verbose.length} exceeded the ${CONCISE_WORD_BUDGET} word concision budget.`,
  );
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
