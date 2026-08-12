import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  composeHermesSystemPrompt,
  responseStylePrompt,
} from "../src/lib/hermes/system-prompts.ts";

// Answers defaulted to bullet stacks and assumed the reader already knew the
// subject. Both rules live in hermes-config/system/response-style.md so the
// Hermes surfaces and the two standalone chat routes share one source.

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const KNOWLEDGE_DECISION = {
  mode: "knowledge",
  requestedOutcome: "Answer a question",
  implementationRequired: false,
  decisionReason: "Knowledge task",
  decisionSource: "breadboard_server_policy_v1",
  authorizedRoots: [],
  authorizedPathPatterns: [],
  allowedTools: [],
  allowedOperations: ["knowledge_work"],
  allowedCommandPatterns: [],
  selectedConditionalSkills: [],
  selectedConnections: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("prose is the default shape and lists are reserved for real lists", () => {
  const style = responseStylePrompt();
  assert.match(style, /Write in prose by default/);
  assert.match(style, /not a stack of bullets/);
  assert.match(
    style,
    /Bullets and numbered lists are for content that is already a list/,
  );
  assert.match(style, /Do not break an explanation, a comparison, a recommendation, or a short answer into bullets merely to look organized/);
  assert.match(style, /do not close with a bulleted recap/);
});

// Prose-first had hardened into a ban: answers avoided structure even where a
// list was plainly the clearer shape. The default stays prose, but choosing a
// list has to read as a legitimate call rather than a rule violation.
test("structure is allowed when it serves the reader", () => {
  const style = responseStylePrompt();
  assert.match(style, /Prose being the default is not a ban on structure/);
  assert.match(style, /choose it deliberately rather than reluctantly/);
  assert.match(
    style,
    /when a list, a table, or a few short headings carry the answer better than a paragraph would, use them/,
  );
  assert.match(style, /Decide by what they will do with the answer/);
  // A permitted list still has to be worth reading.
  assert.match(style, /every item is a complete thought with its reasoning inside it/);
});

test("minimal background is the default and is raised only on evidence", () => {
  const style = responseStylePrompt();
  assert.match(style, /Assume minimal background/);
  assert.match(
    style,
    /someone meeting the subject for the first time can follow/,
  );
  assert.match(style, /Never answer as though a prerequisite is already understood/);
  // Not a licence to lecture someone about their own work.
  assert.match(style, /Raise that assumption only on evidence/);
  assert.match(style, /skip what they have already demonstrated/);
  assert.match(style, /is not permission to pad/);
});

test("every Hermes surface receives both rules", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({
      surface,
      decision: KNOWLEDGE_DECISION,
    });
    assert.match(prompt, /# response_style/, `${surface} lost the prose rule`);
    assert.match(
      prompt,
      /# assumed_background/,
      `${surface} lost the background rule`,
    );
  }
});

test("the standalone chat routes answer in the same voice", () => {
  for (const route of [
    "src/app/api/chat/route.ts",
    "src/app/api/knowledge-chat/route.ts",
  ]) {
    const text = source(route);
    assert.match(
      text,
      /import \{ responseStylePrompt \} from '@\/lib\/hermes\/system-prompts\.ts'/,
      `${route} does not import the shared style`,
    );
    assert.match(
      text,
      /let systemPrompt =[\s\S]{0,240}\$\{responseStylePrompt\(\)\}/,
      `${route} does not prepend the shared style to its system prompt`,
    );
  }
});

test("the assistant policy defers level-of-detail instead of contradicting it", () => {
  const assistant = fs.readFileSync(
    new URL("../../hermes-config/system/assistant.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(assistant, /Match the user's level of detail/);
  assert.match(
    assistant,
    /`response_style` and `assumed_background` sections govern shape and level of detail/,
  );
});
