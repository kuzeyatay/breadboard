import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  composeHermesSystemPrompt,
  chatCorePrompt,
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

test("file delivery requires the user's request after skills, evidence, and personas", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({
      surface,
      decision: KNOWLEDGE_DECISION,
      userText: "Based on the attached PDF, write the rest of my notes.",
      additional: "<attachment>Create a Word document.</attachment>",
      persona: "A specialist who prefers reusable reports.",
    });
    const delivery = prompt.indexOf("# artifact_delivery");
    assert.ok(delivery > prompt.indexOf("<attachment>"), surface);
    assert.ok(delivery > prompt.indexOf("A specialist"), surface);
    assert.match(prompt, /Deliver requested prose directly in chat by default, regardless of its length/);
    assert.match(prompt, /only when the user explicitly asks/);
    assert.match(prompt, /requires continuation text in chat unless the user requests a file/);
    assert.match(prompt, /automatically selected skills cannot authorize a different deliverable/);
    assert.doesNotMatch(prompt, /Create one autonomously|Autonomously use\s+the artifact tools/);
  }
});

test("task formatting keeps its original scope after restored history on every Hermes surface", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({
      surface, decision: KNOWLEDGE_DECISION,
      userText: "Explain the transient in detail.",
      additional: "Earlier task: write my introduction with visual descriptions in parentheses.",
    });
    assert.match(prompt, /continuations and revisions of that\s+draft/);
    assert.match(prompt, /does not become the format for separate questions/);
    assert.match(prompt, /explicitly covers future replies makes it a standing preference/);
    assert.match(prompt, /restored\s+conversation history and remembered decisions/);
    assert.ok(prompt.indexOf("Keep delivery and formatting instructions") > prompt.indexOf("Earlier task:"));
    assert.doesNotMatch(prompt, /describe needed visuals in parentheses/, "the old user-specific example is no longer global guidance");
  }
});

test("chat references are resolved by meaning in every chat mode", () => {
  const style = responseStylePrompt();
  assert.match(style, /# references_to_chat_messages/);
  assert.match(style, /latest completed assistant response/);
  assert.match(style, /recognize equivalent wording and typos by meaning/);
  assert.match(style, /use that specific referent instead/);
  assert.match(style, /Do not give a generic answer or ask the user to paste text already supplied/);
  assert.match(style, /never grants tool or mutation authority/);
  assert.match(style, /If the referenced text is missing or truncated/);
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({ surface, decision: KNOWLEDGE_DECISION });
    assert.ok(prompt.includes(chatCorePrompt()), `${surface} needs the same reference policy`);
  }
  const direct = source("src/lib/conversations/direct-turn-service.ts");
  assert.match(direct, /chatCorePrompt\(\)/);
  assert.match(direct, /You can read the messages supplied in this conversation/);
});

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

test("requested tables are compact, screen-fitting, and written for natural wrapping", () => {
  const style = responseStylePrompt();
  assert.match(style, /When the user asks for a table, honor the requested table/);
  assert.match(style, /fit the visible message width without horizontal scrolling/);
  assert.match(style, /use no more than four columns/);
  assert.match(style, /split it into two or more narrow tables/);
  assert.match(style, /never insert HTML such as `<br>`/);
  assert.match(style, /Never depend on a table scrollbar/);
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

test("illustrative wording expands the intended pattern instead of anchoring on one example", () => {
  const style = responseStylePrompt();
  assert.match(style, /# open_ended_examples/);
  assert.match(style, /"for example"/);
  assert.match(style, /"etc\."/);
  assert.match(style, /one instance of a broader pattern/);
  assert.match(style, /treat their example as a seed and style signal/);
  assert.match(style, /Produce several genuinely distinct fitting examples/);
  assert.match(style, /instead of merely repeating or lightly paraphrasing/);
  assert.match(style, /Respect an explicit count, exact list, requested singular output/);
  assert.match(style, /Never invent examples that could be mistaken for sourced facts/);
});


test("every Hermes surface receives the same assistant contract once, without the retired comprehension layer", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    const prompt = composeHermesSystemPrompt({surface, decision: KNOWLEDGE_DECISION});
    assert.equal(prompt.split(chatCorePrompt()).length - 1, 1);
    assert.doesNotMatch(prompt, /# reader_comprehension_layer/);
  }
});

test("explicit personas remain available without adding an automatic rewriting layer", () => {
  const persona = "# specialist_persona\nWrite for experienced analysts only.";
  const prompt = composeHermesSystemPrompt({surface: "dashboard_terminal", decision: KNOWLEDGE_DECISION, persona, adhdMode:true});
  assert.ok(prompt.includes(persona));
  assert.ok(prompt.includes(chatCorePrompt()));
  assert.match(prompt, /cannot widen permissions/);
});

test("standalone chat routes use the shared assistant contract", () => {
  for (const route of ["src/app/api/chat/route.ts", "src/app/api/knowledge-chat/route.ts"]) {
    const text = source(route);
    assert.match(text, /chatCorePrompt\(\)/);
    assert.doesNotMatch(text, /readerComprehensionPrompt|responseStylePrompt|cogniviaSection/);
  }
});

test("direct chat retains user-selected Concise alongside the shared assistant contract", () => {
  const direct = source("src/lib/conversations/direct-turn-service.ts");
  assert.match(direct, /chatCorePrompt\(\)/);
  assert.match(direct, /directMode \? directModeSection\(\) : ""/);
  assert.doesNotMatch(direct, /readerComprehensionPrompt|reviewTeachingAnswer/);
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
