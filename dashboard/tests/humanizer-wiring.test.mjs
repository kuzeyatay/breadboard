// The properties of the humanizer feature that are structural rather than
// behavioural — the ones a future edit could quietly undo.
//
// Chief among them: there is no path from "Rewrite naturally" to a hosted
// model. That is not something a unit test can observe by running the happy
// path, because the happy path never tries; it is something the code either
// contains or does not. So this file reads the code.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const fromRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const rewriteRoute = source("src/app/api/humanizer/rewrite/route.ts");
const statusRoute = source("src/app/api/humanizer/status/route.ts");
const versionsRoute = source("src/app/api/humanizer/versions/route.ts");
const serviceClient = source("src/lib/humanizer/service.ts");
const config = source("src/lib/humanizer/config.ts");
const schemas = source("src/lib/humanizer/schemas.ts");
const review = source("src/lib/humanizer/review.ts");
const recovery = source("src/lib/humanizer/recovery.ts");
const autoHumanize = source("src/app/components/humanizer/auto-humanize.ts");
const actions = source("src/app/components/assistant-message-actions.tsx");
const composer = source("src/app/components/assistant-composer.tsx");
const panel = source("src/app/components/hermes/agent-runtime-panel.tsx");

const HUMANIZER_CLIENT_FILES = [
  ["automatic rewriting", autoHumanize],
  ["the action row", actions],
];

test("every humanizer route authenticates before it does anything", () => {
  for (const [name, route] of [
    ["rewrite", rewriteRoute],
    ["status", statusRoute],
    ["versions", versionsRoute],
  ]) {
    assert.match(route, /requireUserId\(\)/, `${name} must require a signed-in user`);
    assert.match(route, /RouteError/, `${name} must translate an auth failure`);
  }
});

test("browser input is validated with Zod and bounded", () => {
  assert.match(rewriteRoute, /parseRequest\(humanizeRequestSchema/);
  assert.match(versionsRoute, /parseRequest\(applyRewriteSchema/);
  assert.match(versionsRoute, /parseRequest\(selectVersionSchema/);
  assert.match(schemas, /from "zod"/);
  assert.match(rewriteRoute, /content-length/);
  assert.match(rewriteRoute, /request_too_large/);
  assert.match(schemas, /HUMANIZER_MAX_TEXT_CHARS/);
});

test("no humanizer response is cacheable", () => {
  for (const [name, route] of [
    ["rewrite", rewriteRoute],
    ["status", statusRoute],
    ["versions", versionsRoute],
  ]) {
    assert.match(route, /"Cache-Control": "no-store"/, `${name} must send no-store`);
  }
});

test("the rewrite path can reach no provider but the loopback sidecar", () => {
  // Any of these appearing here would mean a rewrite could leave the machine.
  const providers = [
    /openai/i,
    /chatmock/i,
    /cliproxy/i,
    /anthropic/i,
    /\bgemini\b/i,
    /api\.[a-z]+\.com/i,
    /callModel|runCouncil|assistantModel/,
  ];
  for (const [name, file] of [
    ["the rewrite route", rewriteRoute],
    ["the service client", serviceClient],
    ["the config", config],
    ["the review module", review],
  ]) {
    for (const provider of providers) {
      assert.doesNotMatch(file, provider, `${name} must not reference ${provider}`);
    }
  }
  // The only address the client builds is loopback.
  assert.match(config, /http:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(config, /0\.0\.0\.0|https:\/\//);
});

test("there is no silent fallback: an unavailable service is a reported state", () => {
  assert.match(serviceClient, /reason: "unavailable"/);
  assert.match(serviceClient, /reason: "not_installed"/);
  assert.match(serviceClient, /reason: "preservation_failed"/);
  // `local` or `disabled`, and nothing in between.
  assert.match(config, /export type HumanizerMode = "local" \| "disabled"/);
});

test("the sidecar's address, secret and cache never reach browser code", () => {
  for (const [name, file] of HUMANIZER_CLIENT_FILES) {
    for (const leak of [
      /HUMANIZER_SERVICE_SECRET/,
      /BREADBOARD_HUMANIZER_SECRET/,
      /HUMANIZER_SERVICE_URL/,
      /127\.0\.0\.1/,
      /7735/,
      /humanizer-service/,
      /humanizerServiceSecret|humanizerBaseUrl|humanizerModelCache/,
    ]) {
      assert.doesNotMatch(file, leak, `${name} must not contain ${leak}`);
    }
  }
  // Client code talks to Breadboard's own routes and nothing else.
  assert.match(autoHumanize, /"\/api\/humanizer\/rewrite"/);
  assert.match(autoHumanize, /"\/api\/humanizer\/versions"/);
});

test("Rewrite naturally regenerates through the existing branch path without a modal", () => {
  assert.match(actions, /Rewrite naturally/);
  assert.match(actions, /onRewrite\?\.\(\)/);
  assert.doesNotMatch(actions, /HumanizerReviewDialog|rewriteOpen|setRewriteOpen/);
  assert.doesNotMatch(actions, /\/api\/humanizer\/rewrite|\/api\/humanizer\/versions/);
  for (const mutation of [/better-sqlite3/, /db\.prepare/, /UPDATE |INSERT /, /conversations\/store/]) {
    assert.doesNotMatch(actions, mutation);
  }
  assert.match(
    panel,
    /onRewrite=\{[\s\S]{0,320}\(\) => retryAssistantAsBranch\(index\)/,
  );
  assert.doesNotMatch(actions, /Style score|humanizerReview|original kept/);
});

test("standing rewrites are adopted only when they improve and remain intact", () => {
  assert.match(recovery, /reviewRewriteIntegrity/);
  assert.match(rewriteRoute, /RECOVERY_CHUNK_TOKENS = 48/);
  assert.match(rewriteRoute, /chooseHumanizerCandidate/);
  assert.match(rewriteRoute, /maxChunkTokens: RECOVERY_CHUNK_TOKENS/);
  assert.match(autoHumanize, /review\.integrity\?\.passed === false/);
  assert.match(autoHumanize, /scores\.worsened/);
  assert.match(autoHumanize, /scores\.tied/);
  assert.match(autoHumanize, /kept_integrity/);
  assert.match(autoHumanize, /kept_worse/);
  assert.match(autoHumanize, /kept_tied/);
});

test("the switch sits directly above Personalize and does no rewriting itself", () => {
  const humanizerAt = composer.indexOf("aria-checked={humanizerEnabled}");
  const personalizeAt = composer.indexOf("aria-checked={personalize}");
  assert.ok(humanizerAt > 0 && personalizeAt > 0);
  assert.ok(humanizerAt < personalizeAt, "Rewrite naturally must sit above Personalize");
  assert.match(composer, /Rewrite naturally/);
  // It is a switch over an action, not a post-processing step: nothing in the
  // composer rewrites anything.
  assert.doesNotMatch(composer, /humanizerRewrite|\/api\/humanizer\/rewrite/);
});

test("automatic rewriting happens only behind the switch, and never in the pipeline", () => {
  // The switch turns this into a standing instruction, so "nothing is ever
  // automatic" is no longer the contract. What replaces it is narrower and
  // still worth enforcing: every automatic path is gated on the switch, keeps
  // the original as a version, and lives outside the answer pipeline. A rewrite
  // welded into the turn service or the dispatcher could not be switched off
  // and would have no original to fall back to.
  const callers = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("/api/humanizer/rewrite") || text.includes("humanizerRewrite(")) {
          callers.push(path.relative(dashboardRoot, full).replace(/\\/g, "/"));
        }
      }
    }
  };
  walk(path.join(dashboardRoot, "src"));
  assert.deepEqual(callers.sort(), [
    // The authenticated browser rewrite route.
    "src/app/api/humanizer/rewrite/route.ts",
    // The agent tool, reached only through the skill.
    "src/app/api/hermes/tools/humanizer/route.ts",
    // The automatic chat path, gated on the switch.
    "src/app/components/humanizer/auto-humanize.ts",
    // The automatic server path for artifacts and garden notes, gated on the
    // account preference.
    "src/lib/humanizer/auto-server.ts",
    // The loopback client they all share.
    "src/lib/humanizer/service.ts",
  ].sort());

  // The answer pipeline itself still contains no rewriting step: the automatic
  // path is a transcript-owner effect after the turn, not a stage inside it.
  for (const file of [
    "src/lib/conversations/turn-service.ts",
    "src/lib/hermes/dispatch-core.ts",
    "src/app/components/assistant-composer.tsx",
  ]) {
    const text = source(file);
    assert.doesNotMatch(text, /humanizerRewrite\(|\/api\/humanizer\/rewrite/, file);
  }
});

test("the automatic chat path is gated, guarded and keeps the original", () => {
  const auto = source("src/app/components/humanizer/auto-humanize.ts");
  // It goes through the same two routes and therefore the same gates.
  assert.match(auto, /"\/api\/humanizer\/rewrite"/);
  assert.match(auto, /"\/api\/humanizer\/versions"/);
  // Optimistic concurrency, so an answer that moved on is never overwritten.
  assert.match(auto, /expectedContent: input\.content/);
  // An identical rewrite is not adopted: two indistinguishable versions behind
  // arrows is worse than none.
  assert.match(auto, /review\.unchanged/);
  // Failure is silence, never a thrown error into somebody's reading.
  assert.match(auto, /return null/);

  assert.match(panel, /autoHumanizeMessage\(/);
  assert.match(panel, /if \(!humanizerEnabled \|\| runInFlight/, "gated on the switch");
  assert.match(panel, /sawRunRef/, "only after a run this panel watched");
  assert.match(panel, /attemptedRef/, "once per message");
  assert.match(panel, /isExternalAgentRunMessage\(message\)/, "never an agent run card");
  // A newly streamed row still has its browser UUID. Waiting for a reload to
  // obtain msg_N was why successful automatic rewrites used to disappear.
  assert.match(panel, /message\.clientMessageId \?\? message\.id/);
  assert.match(versionsRoute, /getConversationMessageByClientId\(/);
});

test("server-written text is rewritten only for a user who asked for it", () => {
  const auto = source("src/lib/humanizer/auto-server.ts");
  assert.match(auto, /getHermesUserSettings\(userId\)\.humanizerAuto/);
  // Bounded both ways: nothing tiny, nothing that would hold the single
  // inference lock for minutes.
  assert.match(auto, /MIN_AUTO_CHARS/);
  assert.match(auto, /MAX_AUTO_CHARS/);
  // A failed rewrite must never fail the write.
  assert.match(auto, /return unchanged/);
  assert.doesNotMatch(auto, /throw new/);

  // Artifacts: Markdown only, because the segmenter reads Markdown.
  const artifacts = source("src/app/api/hermes/tools/artifacts/route.ts");
  assert.match(artifacts, /humanizeStoredText\(/);
  assert.match(artifacts, /kind === "markdown"/);

  // Garden notes, at the moment the text becomes a file.
  const garden = source("src/lib/hermes/garden-tools.ts");
  assert.match(garden, /humanizeStoredText\(/);
  assert.match(garden, /"garden_note"/);
});

test("the preference is a server-side account setting, not just a browser switch", () => {
  const settings = source("src/lib/hermes/runtime-store.ts");
  assert.match(settings, /humanizerAuto: boolean;/);
  assert.match(settings, /humanizer_auto/);
  // Default off: this rewrites what Breadboard says.
  assert.match(source("../dashboard/src/lib/db.ts").length ? source("src/lib/db.ts") : "", /humanizer_auto INTEGER NOT NULL DEFAULT 0/);
  // The switch mirrors itself onto the account so the server surfaces see it.
  assert.match(
    source("src/app/components/use-humanizer-mode.ts"),
    /"\/api\/assistant-preferences"/,
  );
});

test("the review reuses Breadboard's existing scorer and adds no second detector", () => {
  assert.match(review, /from "\.\.\/prose-score\/index\.ts"/);
  assert.match(review, /scoreProse\(/);
  // No new model, no new heuristic, no second opinion: the only scoring
  // import in this module is Breadboard's own.
  const imports = review.match(/^import .*$/gm) ?? [];
  assert.deepEqual(
    imports.filter(
      (line) => !line.includes("./service.ts") && !line.startsWith("import type "),
    ),
    ['import { scoreProse, type ProseScore } from "../prose-score/index.ts";'],
  );
  assert.doesNotMatch(review, /classifier|perplexity|embedding|transformers/i);
});

test("the model weights are not in the repository and not in the installer", () => {
  const forbidden = [".safetensors", "pytorch_model.bin", "model.onnx"];
  const walk = (directory, found) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") continue;
        walk(path.join(directory, entry.name), found);
      } else if (forbidden.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(entry.name);
      }
    }
  };
  const found = [];
  walk(path.join(repoRoot, "humanizer-service"), found);
  assert.deepEqual(found, [], "model weights must never be committed");

  const notices = fromRepo("humanizer-service/THIRD_PARTY_NOTICES.md");
  assert.match(notices, /cive202\/humanize-ai-text-bart-large/);
  assert.match(notices, /facebook\/bart-large/);
  assert.match(notices, /Downloaded separately by the user/);
  assert.match(notices, /placeholder/);
  assert.doesNotMatch(notices, /unconditionally MIT/i);
});

test("every way of starting Breadboard starts the humanizer when it is provisioned", () => {
  // Three launchers, and the service has to be in all of them. It was in the
  // desktop supervisor alone at first, which meant a developer on `npm run dev`
  // got "the local rewriter is not running" no matter how the setup had gone.
  const devAll = fromRepo("scripts/dev-all.mjs");
  assert.match(devAll, /humanizer-venv/, "dev-all: detects the environment");
  assert.match(devAll, /startService\("humanizer"/, "dev-all: starts it");
  assert.match(devAll, /HUMANIZER_MODE: humanizerEnabled \? "local" : "disabled"/);
  assert.match(devAll, /HUMANIZER_SERVICE_URL: humanizerServiceUrl/);
  // Absent environment is a printed note, never a failed stack.
  assert.match(devAll, /Humanizer not provisioned/);

  const startBat = fromRepo("start.bat");
  assert.ok(startBat.includes("humanizer-venv\\Scripts\\python.exe"));
  assert.match(startBat, /start-humanizer\.mjs/);

  const definitions = fromRepo("desktop/src/main/service-definitions.ts");
  assert.match(definitions, /id: "humanizer"/);
  assert.match(definitions, /resolveHumanizerPython\(paths\)/);
  assert.match(fromRepo("desktop/src/main/app-lifecycle.ts"), /humanizer: await allocatePort\(7735/);
});

test("setup downloads the model only when explicitly asked", () => {
  const setup = fromRepo("scripts/setup-humanizer.mjs");
  assert.match(setup, /--download-model/);
  assert.match(setup, /wantsModel \|\| modelOnly/);
  // The environment step never fetches weights on its own.
  const beforeModelStep = setup.slice(0, setup.indexOf("function downloadModel"));
  assert.doesNotMatch(beforeModelStep, /from_pretrained/);
});
