// The Humanize skill: the local rewriter reached as a tool, and the sentences
// that select it without anybody typing a slash command.
//
// Four things are locked here. The skill is a ready knowledge-work skill on
// both chat surfaces. Its two tools are registered everywhere a tool has to be
// registered, on the Python side and the three TypeScript sides, because a tool
// missing from one of them fails at a different layer each time. The intent
// module fires on the sentences people actually write and keeps out of the ones
// that only mention humanizers. And nothing in the skill or its route claims
// the thing this feature must never claim.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listApprovedSkills, listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  humanizeCommandText,
  shouldAutoSelectHumanize,
  HUMANIZE_SKILL,
} from "../src/lib/hermes/humanize-intent.ts";
import { HUMANIZER_TOOLS } from "../src/lib/hermes/tool-scopes.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const fromRepo = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const skillMarkdown = fromRepo("hermes-skills/prebuilt/humanize/SKILL.md");
const toolRoute = source("src/app/api/hermes/tools/humanizer/route.ts");
const intent = source("src/lib/hermes/humanize-intent.ts");
const plugin = fromRepo("hermes-agent/plugins/breadboard/__init__.py");

function selects(text, priorMessages) {
  return shouldAutoSelectHumanize({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the skill declares itself with the tools it actually needs", () => {
  assert.match(skillMarkdown, /^---\r?\nname: humanize\r?\n/);
  for (const tool of HUMANIZER_TOOLS) {
    assert.match(skillMarkdown, new RegExp(`- ${tool}\\b`), `allowed-tools: ${tool}`);
    assert.match(skillMarkdown, new RegExp(`    - ${tool}\\b`), `requiredTools: ${tool}`);
  }
  // The description is what a model reads when deciding whether this is the
  // skill for the turn, so the phrases people use belong in it.
  for (const phrase of ["humanize this", "sound more human", "less like AI"]) {
    assert.ok(
      skillMarkdown.toLowerCase().includes(phrase.toLowerCase()),
      `description should mention: ${phrase}`,
    );
  }
});

test("Humanize is a ready knowledge-work skill on both chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === HUMANIZE_SKILL,
    );
    assert.ok(skill, `humanize missing from ${surface}`);
    assert.equal(skill.classification, "eligible_general", surface);
    assert.ok(skill.enabled && skill.healthy, surface);
    assert.ok(
      listApprovedSkills(surface).some((candidate) => candidate.slug === HUMANIZE_SKILL),
      `humanize is not approved on ${surface}`,
    );
  }
});

test("both tools are registered on every side that has to know about them", () => {
  for (const tool of HUMANIZER_TOOLS) {
    // The Hermes plugin: the schema the model is shown.
    assert.match(plugin, new RegExp(`"${tool}"`), `plugin: ${tool}`);
    // The capability ledger: which skill a call belongs to.
    assert.match(
      source("src/lib/hermes/capability-usage.ts"),
      new RegExp(`${tool}: \\{ kind: "skill", id: "humanize"`),
      `capability-usage: ${tool}`,
    );
  }
  assert.match(plugin, /"\/api\/hermes\/tools\/humanizer"/);
  assert.match(plugin, /_HUMANIZER_REQUEST_TIMEOUT_SECONDS/);
  // The payload shape and the timeout both key off the route kind; missing
  // either sends the wrong body or times out mid-rewrite.
  assert.match(plugin, /"humanizer",\r?\n\s*"workspace",/);
  assert.match(plugin, /route_kind == "humanizer"/);

  const broker = source("src/lib/hermes/capability-broker.ts");
  assert.match(broker, /HUMANIZER_TOOLS,/);
  assert.match(broker, /for \(const tool of HUMANIZER_TOOLS\) \{/);
  // Never on the anonymous public surface.
  assert.match(broker, /for \(const tool of HUMANIZER_TOOLS\) map\[tool\] = false;/);
});

test("the sentences people actually write select the skill", () => {
  for (const text of [
    "humanize this",
    "humanize the paragraph above",
    "can you humanise this draft?",
    "de-AI this please",
    "make this sound more human",
    "rewrite this so it doesn't sound like AI",
    "make the intro read less robotic",
    "this reads like ChatGPT wrote it, can you fix it",
    "reword the summary so it sounds like a person wrote it",
    "clean up this section, it's full of AI slop",
    "make it less ai-sounding",
  ]) {
    assert.equal(selects(text), true, `should select: ${text}`);
  }
});

test("it stays out of turns that only mention humanizers", () => {
  for (const text of [
    // Talking about the idea rather than asking for it.
    "what is an AI humanizer?",
    "how do humanizers work",
    "which tool should I use to humanize text",
    "are there any good humanizers?",
    "is it ethical to humanize an essay",
    // The feature, not the rewrite.
    "how do I turn on Rewrite naturally",
    "where is the humanize switch",
    // The neighbouring skill: metadata, not prose.
    "strip the invisible characters from this",
    "remove the EXIF metadata before I post it",
    // Plain editing, which is the model's own job.
    "rewrite the intro",
    "make this shorter",
    "fix the grammar in this paragraph",
    // A detector question deserves the assistant's own words first.
    "will this pass Turnitin if I humanize it",
    "make this undetectable by GPTZero",
  ]) {
    assert.equal(selects(text), false, `should not select: ${text}`);
  }
});

test("a follow-up keeps the guidance the first rewrite was made with", () => {
  const after = [
    { role: "user", content: "humanize this" },
    {
      role: "assistant",
      content: "Here is the humanized version.\n\nAI-style pattern score\nOriginal: 44\nRewrite: 23",
    },
  ];
  assert.equal(selects("try that again", after), true);
  assert.equal(selects("make it warmer", after), true);
  // With nothing to follow up on, the same words are just a message.
  assert.equal(selects("try that again"), false);
  assert.equal(selects("make it warmer"), false);
});

test("selection is scoped to authenticated chat surfaces", () => {
  const ask = { text: "humanize this", priorMessages: [] };
  assert.equal(
    shouldAutoSelectHumanize({ ...ask, surface: "dashboard_terminal", authenticated: true }),
    true,
  );
  assert.equal(
    shouldAutoSelectHumanize({ ...ask, surface: "garden_chat", authenticated: true }),
    true,
  );
  assert.equal(
    shouldAutoSelectHumanize({ ...ask, surface: "dashboard_terminal", authenticated: false }),
    false,
  );
  assert.equal(
    shouldAutoSelectHumanize({ ...ask, surface: "quartz_ai", authenticated: true }),
    false,
  );
});

test("an explicit command is never argued with", () => {
  assert.equal(selects("/watch humanize the narration"), false);
  assert.equal(humanizeCommandText({
    text: "/humanize this",
    surface: "dashboard_terminal",
    authenticated: true,
  }).automatic, false);
});

test("the command text is the skill's slash command plus the untouched message", () => {
  const selection = humanizeCommandText({
    text: "humanize this paragraph",
    surface: "dashboard_terminal",
    authenticated: true,
  });
  assert.equal(selection.automatic, true);
  assert.equal(selection.text, "/humanize humanize this paragraph");
});

test("both turn pipelines select it, or the feature works on one surface only", () => {
  for (const file of [
    "src/lib/conversations/turn-service.ts",
    "src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const text = source(file);
    assert.match(text, /humanizeCommandText\(/, file);
    // Position in the chain: after the subject-claiming skills, before the errand.
    assert.match(text, /text: githubExplorerSelection\.text/, `${file}: chain order`);
    assert.match(text, /text: humanizeSelection\.text/, `${file}: chain order`);
    // An automatic selection must never cost the user their turn.
    assert.match(text, /!humanizeSelection\.automatic/, `${file}: unavailable fallback`);
  }
});

test("the tool route authenticates, scopes and persists nothing", () => {
  assert.match(toolRoute, /capabilityForInternalToolRequest\(request\)/);
  assert.match(toolRoute, /verifyCapabilityToken\(rawToken\)/);
  assert.match(toolRoute, /humanizer_session_scope_mismatch/);
  assert.match(toolRoute, /humanizer_tool_not_granted/);
  assert.match(toolRoute, /dashboard_terminal", "garden_chat/);
  // The whole point of the narrower door: it returns text and writes nothing.
  for (const mutation of [
    /addAssistantContentVersion/,
    /db\.prepare/,
    /completeAssistantMessage/,
    /createImportedArtifact/,
  ]) {
    assert.doesNotMatch(toolRoute, mutation);
  }
  // And it cannot be pointed anywhere: no model id, device or URL from args.
  assert.doesNotMatch(toolRoute, /args\.(?:model|device|url|serviceUrl|revision)/);
});

test("nothing here promises what a rewriter cannot deliver", () => {
  for (const text of [skillMarkdown, intent, toolRoute]) {
    for (const forbidden of [/beats? (?:an? )?(?:ai )?detector/i, /guaranteed human/i, /passes? as human/i]) {
      assert.doesNotMatch(text, forbidden);
    }
  }
  // The skill says the honest thing out loud rather than merely omitting the
  // dishonest one.
  assert.match(skillMarkdown, /\*\*not\*\* a detector-beating tool/i);
  assert.match(skillMarkdown, /"undetectable"/);
  assert.match(skillMarkdown, /not evidence about authorship/i);
  // And it tells the model to report both scores and the reverted count.
  assert.match(skillMarkdown, /Show the rewrite\. State both scores\. Report reverted sections\./);
  assert.match(skillMarkdown, /When the two scores are equal, relay `scores\.note`/);
  assert.match(skillMarkdown, /not comparable to a detector probability/i);
  assert.match(toolRoute, /note: scores\.tied/);
  assert.match(toolRoute, /not comparable to an AI-detector probability/);
});

test("the skill explains that the response action creates a humanized retry branch", () => {
  assert.match(skillMarkdown, /Rewrite naturally/);
  assert.match(skillMarkdown, /ordinary retry path/i);
  assert.match(skillMarkdown, /selectable branch/i);
  assert.doesNotMatch(skillMarkdown, /style score below the new branch/i);
  assert.match(skillMarkdown, /Nothing is saved/);
});
