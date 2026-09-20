// Answer-quality evaluation: the regression suite grown from real ratings.
//
// Sibling of evaluate-evidence-calibration.mjs, and deliberately the same shape
// — same grading contract, same "properties are judged on meaning, never on
// wording" rule, same opt-in posture. What differs is where the scenarios come
// from. That set was written to specify a contract; this one accumulates from
// answers somebody actually rated down, which is why most scenarios here carry
// a `reason` naming the complaint that produced them.
//
// A scenario may or may not supply material. An evidence-calibration scenario
// always has an attachment to reason about; a complaint about length or about
// answering the wrong question usually has nothing attached at all, so
// `evidence` is optional throughout.
//
//   node --experimental-strip-types scripts/evaluate-answer-quality.mjs
//   node --experimental-strip-types scripts/evaluate-answer-quality.mjs --reason too_long
//   ANSWER_QUALITY_MODEL=... ANSWER_QUALITY_GRADER=... node ... --json report.json
//
// Use a weak answering model and a grader from a different family; see
// qa/answer-quality/README.md for why.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeHermesSystemPrompt } from "../dashboard/src/lib/hermes/system-prompts.ts";
import { suppliedEvidenceText } from "../dashboard/src/lib/hermes/evidence-calibration.ts";
import { localChatmockBaseUrl } from "../dashboard/src/lib/chatmock-server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const scenarioFile = path.join(repoRoot, "qa", "answer-quality", "scenarios.json");

const argv = process.argv.slice(2);
const argValue = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const ANSWER_MODEL = process.env.ANSWER_QUALITY_MODEL?.trim() || "default";
const GRADER_MODEL = process.env.ANSWER_QUALITY_GRADER?.trim() || ANSWER_MODEL;
const BASE_URL = process.env.ANSWER_QUALITY_BASE_URL?.trim() || localChatmockBaseUrl();

const decision = {
  mode: "knowledge",
  requestedOutcome: "answer a question",
  implementationRequired: false,
  decisionReason: "evaluation harness",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: ["websearch", "webfetch"],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: new Date().toISOString(),
  expiresAt: null,
};

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

/** Retried past a transient proxy failure, which would otherwise end a run early. */
async function complete(model, messages, maxTokens, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await completeOnce(model, messages, maxTokens);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  throw lastError;
}

/** The user message as Breadboard builds it, with the attachment only if there is one. */
function userMessage(scenario) {
  if (!scenario.evidence) return scenario.question;
  return [
    scenario.question,
    "",
    `<breadboard_attachment name=${JSON.stringify(scenario.attachmentName ?? "attachment.txt")}>`,
    scenario.evidence,
    "</breadboard_attachment>",
  ].join("\n");
}

const GRADER_INSTRUCTION = [
  "You are grading one assistant answer against properties it was required to have.",
  "You are given the question, any source material supplied with it, the answer,",
  "and a list of properties. Judge each property on meaning, never on wording: an",
  "answer that satisfies a property in its own words satisfies it.",
  "",
  "A `must` property holds when the answer genuinely does that thing.",
  "A `mustNot` property holds when the answer avoids doing that thing.",
  "Where source material is supplied, read it yourself before judging any claim about it.",
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
    ...(scenario.evidence ? ["--- SOURCE MATERIAL ---", scenario.evidence] : []),
    "--- QUESTION ---",
    scenario.question,
    "--- ANSWER ---",
    answer,
    "--- PROPERTIES ---",
    ...properties.map(
      (property) => `${property.id} (${property.kind}): the answer ${property.text}`,
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
  const byId = new Map((parsed.results ?? []).map((entry) => [String(entry.id), entry]));
  return properties.map((property) => {
    const verdict = byId.get(property.id);
    return {
      ...property,
      // A property the grader did not answer is a failure to establish, not a
      // pass: silence is not evidence here either.
      holds: verdict?.holds === true,
      why: verdict?.why ?? "the grader did not judge this property",
      judged: Boolean(verdict),
    };
  });
}

/**
 * A scenario whose properties still carry a reviewer placeholder cannot be
 * graded: it would assert whatever the placeholder says. Skipped loudly, so a
 * promoted-but-unfinished `style` case is visible rather than quietly passing.
 */
function needsReview(scenario) {
  return [...scenario.rubric.must, ...scenario.rubric.mustNot].some((text) =>
    text.trim().startsWith("REVIEW:"),
  );
}

async function run() {
  const set = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  const only = argValue("--scenario");
  const reason = argValue("--reason");
  let scenarios = set.scenarios;
  if (only) scenarios = scenarios.filter((scenario) => scenario.id === only);
  if (reason) scenarios = scenarios.filter((scenario) => scenario.reason === reason);
  if (!scenarios.length) {
    throw new Error(`no scenario matched ${only ?? reason ?? "the empty filter"}`);
  }

  const report = [];
  const skipped = [];
  for (const scenario of scenarios) {
    if (needsReview(scenario)) {
      skipped.push(scenario.id);
      console.log(`\nSKIP  ${scenario.id}  [${scenario.reason}]  properties still need a reviewer`);
      continue;
    }
    const system = composeHermesSystemPrompt({
      surface: "dashboard_terminal",
      decision,
      userText: scenario.question,
      suppliedEvidence: scenario.evidence
        ? suppliedEvidenceText([
            {
              type: "text",
              name: scenario.attachmentName ?? "attachment.txt",
              text: scenario.evidence,
            },
          ])
        : undefined,
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
      reason: scenario.reason,
      origin: scenario.origin ?? "nominated",
      words,
      passed: failures.length === 0,
      results,
      answer,
    });

    console.log(
      `\n${failures.length === 0 ? "PASS" : "FAIL"}  ${scenario.id}  [${scenario.reason}]  ${words} words`,
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
  console.log(
    `\n${report.length - failed.length}/${report.length} scenarios satisfied every property` +
      (skipped.length ? `; ${skipped.length} skipped pending review` : "") +
      ".",
  );
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
