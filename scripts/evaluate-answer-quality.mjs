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
//   node --experimental-strip-types scripts/evaluate-answer-quality.mjs --model gpt-6-sol --reasoning-effort max
//   node --experimental-strip-types scripts/evaluate-answer-quality.mjs --model gpt-6-sol --reason too_long
//   ANSWER_QUALITY_MODEL=... ANSWER_QUALITY_GRADER=... node ... --json report.json
//
// Use the answering model and effort implicated in the report. A grader is
// diagnostic evidence, not a release decision; see qa/answer-quality/README.md.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

const ANSWER_MODEL = argValue("--model") || process.env.ANSWER_QUALITY_MODEL?.trim();
const ANSWER_EFFORT = argValue("--reasoning-effort") || process.env.ANSWER_QUALITY_REASONING_EFFORT?.trim();
const GRADER_MODEL = process.env.ANSWER_QUALITY_GRADER?.trim() || ANSWER_MODEL;
const GRADER_EFFORT = process.env.ANSWER_QUALITY_GRADER_REASONING_EFFORT?.trim();
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

async function complete(model, messages, reasoningEffort) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      council: false,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `${model} returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = await response.json();
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const completion = {
    answer: typeof content === "string" ? content.trim() : "",
    requestedModel: model,
    reasoningEffort: reasoningEffort ?? null,
    reportedModel: payload?.model ?? null,
    finishReason: choice?.finish_reason ?? null,
    elapsedSeconds: (performance.now() - started) / 1000,
    usage: payload?.usage ?? null,
  };
  if (completion.finishReason !== "stop" || !completion.answer) {
    const error = new Error(`${model} did not return a complete answer (finish_reason=${completion.finishReason})`);
    error.completion = completion;
    throw error;
  }
  return completion;
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

async function grade(scenario, answer, onCompletion) {
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
  const completion = await complete(
    GRADER_MODEL,
    [
      { role: "system", content: GRADER_INSTRUCTION },
      { role: "user", content: prompt },
    ],
    GRADER_EFFORT,
  );
  onCompletion(completion);
  const raw = completion.answer;
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`grader returned unparseable output: ${raw.slice(0, 200)}`);
  }
  const byId = new Map((parsed.results ?? []).map((entry) => [String(entry.id), entry]));
  const results = properties.map((property) => {
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
  return { results, completion };
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
  if (!ANSWER_MODEL || ANSWER_MODEL === "default") {
    throw new Error("Select the implicated answering model with --model or ANSWER_QUALITY_MODEL; an implicit default cannot establish model fidelity.");
  }
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
  const jsonOut = argValue("--json");
  const saveReport = () => {
    if (jsonOut) fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2));
  };
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
    const input = {
      system,
      systemSha256: createHash("sha256").update(system).digest("hex"),
      user: userMessage(scenario),
      requestedModel: ANSWER_MODEL,
      reasoningEffort: ANSWER_EFFORT ?? null,
      council: false,
      boundary: "Single writing response with inline source text and a web-only capability decision; no tools or full normal-chat capability inventory are exercised.",
    };
    const entry = {
      id: scenario.id,
      reason: scenario.reason,
      origin: scenario.origin ?? "nominated",
      rubric: scenario.rubric,
      input,
      status: "running",
      passed: false,
    };
    report.push(entry);
    saveReport();
    try {
      const completion = await complete(ANSWER_MODEL, [
        { role: "system", content: system },
        { role: "user", content: input.user },
      ], ANSWER_EFFORT);
      entry.completion = completion;
      const answer = completion.answer;
      entry.answer = answer;
      const words = answer.split(/\s+/).filter(Boolean).length;
      entry.status = "grading";
      saveReport();
      const { results, completion: graderCompletion } = await grade(scenario, answer, (response) => {
        entry.graderCompletion = response;
        saveReport();
      });
      const failures = results.filter((result) => !result.holds);
      Object.assign(entry, {
        status: "complete",
        words,
        passed: failures.length === 0,
        results,
        graderCompletion,
      });

      console.log(
        `\n${failures.length === 0 ? "PASS" : "FAIL"}  ${scenario.id}  [${scenario.reason}]  ${words} words`,
      );
      for (const result of failures) {
        console.log(`   x ${result.kind}: ${result.text}`);
        console.log(`     ${result.why}`);
      }
    } catch (error) {
      entry.failedStage = entry.status === "grading" ? "grading" : "answering";
      entry.status = "error";
      entry.error = error instanceof Error ? error.message : String(error);
      if (error?.completion) entry.failedCompletion = error.completion;
      console.log(`\nERROR ${scenario.id}: ${entry.error}`);
    } finally {
      saveReport();
    }
  }

  if (jsonOut) {
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
