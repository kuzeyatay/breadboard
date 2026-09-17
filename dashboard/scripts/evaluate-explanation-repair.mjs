// Explicit live replay; never modifies the user's conversation or provider settings.
// Usage: node --experimental-strip-types scripts/evaluate-explanation-repair.mjs <fixture.json> [model] [effort]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildExplanationTurn, explanationTurnPrompt } from "../src/lib/hermes/explanation-turn.ts";
import { reviewExplanation } from "../src/lib/hermes/explanation-review.ts";
import { explanationReviewModel } from "../src/lib/hermes/explanation-review-provider.ts";
import { localChatmockBaseUrl } from "../src/lib/chatmock-server.ts";

if (!process.argv[2]) throw new Error("Pass a replay fixture JSON path.");
const fixturePath = path.resolve(process.argv[2]);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const model = process.argv[3] ?? "gpt-5.6-sol";
const effort = process.argv[4] ?? "max";
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-explanation-replay-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { composeHermesSystemPrompt } = await import("../src/lib/hermes/system-prompts.ts");
const { default: db } = await import("../src/lib/db.ts");
try {
  const turn = buildExplanationTurn(fixture);
  if (!turn) throw new Error("Fixture did not enter the explanation path.");
  const system = composeHermesSystemPrompt({ surface: "garden_chat", userText: fixture.request,
    explanationFocus: turn.repair, additional: explanationTurnPrompt(turn),
    decision: { mode: "knowledge", implementationRequired: false, allowedTools: [],
      authorizedRoots: [], authorizedPathPatterns: [], allowedOperations: ["knowledge_work"], allowedCommandPatterns: [] },
  });
  const started = Date.now();
  console.log(JSON.stringify({ stage: "generation", model, effort, systemChars: system.length, baselineSystemChars: fixture.baselineSystemChars }));
  let generation;
  if (process.argv.includes("--review-only")) {
    generation = JSON.parse(fs.readFileSync(path.join(path.dirname(fixturePath), "replay-generation.json"), "utf8")).generation;
  } else {
  const response = await fetch(`${localChatmockBaseUrl()}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(240_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}` },
    body: JSON.stringify({ model, stream: false, council: false, reasoning_effort: effort, max_completion_tokens: 8_192,
      messages: [{ role: "system", content: system }, { role: "user", content: fixture.request }],
    }),
  });
  if (!response.ok) throw new Error(`Generation HTTP ${response.status}`);
  const payload = await response.json();
  const choice = payload.choices?.[0];
  if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") throw new Error("Generation did not complete");
  generation = { answer: choice.message.content, usage: payload.usage, durationMs: Date.now() - started, systemChars: system.length };
  fs.writeFileSync(path.join(path.dirname(fixturePath), "replay-generation.json"), JSON.stringify({ model, effort, generation }, null, 2));
  }
  console.log(JSON.stringify({ generation: { ...generation, answer: undefined } }));
  const reviews = [];
  const complete = explanationReviewModel(model);
  const review = await reviewExplanation({ userRequest: fixture.request, context: turn.context, sourcePassages: turn.sourcePassages,
    answer: generation.answer, model, complete: async request => {
      const result = await complete(request); reviews.push({ stage: request.stage, ...result }); return result;
    },
  });
  const result = { kind: "single_replay_not_controlled_benchmark", model, effort, at: new Date().toISOString(),
    baselineSystemChars: fixture.baselineSystemChars, baselineUsage: fixture.baselineUsage,
    generation, review, reviews, context: turn,
  };
  fs.writeFileSync(path.join(path.dirname(fixturePath), "replay-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: review.report.status, reviewMs: review.report.durationMs, calls: review.report.calls,
    failureReason: review.report.failureReason, totalMs: Date.now() - started }));
} finally {
  db.close();
  // Delete only the exact temporary directory this process created.
  if (path.dirname(path.resolve(dataRoot)) !== path.resolve(os.tmpdir()) || !path.basename(dataRoot).startsWith("breadboard-explanation-replay-")) throw new Error("Unsafe temporary path");
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
