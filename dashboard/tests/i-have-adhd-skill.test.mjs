import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  directModeSection,
  resetDirectModeCache,
} from "../src/lib/hermes/direct-mode.ts";
import {
  DIRECT_MODE_STORAGE_KEY,
  isDirectModeEnabled,
} from "../src/app/components/use-direct-mode.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

// Direct mode is one skill wearing two hats: `/i-have-adhd` for a single turn, and
// the composer switch that shapes every send while it is on. Both read the same
// manifest, so these tests pin the manifest, the classification that keeps it
// off the OpenCode-conditional path, and the switch's reach.

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const MANIFEST = "../hermes-skills/prebuilt/i-have-adhd/SKILL.md";
const composer = source("src/app/components/assistant-composer.tsx");

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

test("i-have-adhd is a ready prebuilt skill on both authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === "i-have-adhd",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    // The upstream skill is written for a repository assistant, and that
    // vocabulary alone would classify it as coding-conditional and force it
    // through OpenCode. It shapes answers about anything, so it must not.
    assert.equal(skill.classification, "eligible_general");
    assert.equal(skill.category, "Featured");
    // An output style claims nothing. It reads no file and calls no tool.
    assert.deepEqual(skill.capabilityContract?.requiredTools, []);
    assert.deepEqual(skill.capabilityContract?.requiredRuntimes, []);
    assert.deepEqual(skill.capabilityContract?.requiredMcpServers, []);
    assert.deepEqual(skill.capabilityContract?.requiredArtifactKinds, []);
    assert.equal(skill.capabilityContract?.category, "reviewed-guidance");
  }
});

test("the guidance carries no implementation vocabulary", () => {
  const manifest = source(MANIFEST).toLowerCase();
  for (const word of [
    "npm",
    "codebase",
    "repository",
    "refactor",
    "typescript",
    "javascript",
    "python",
    "dockerfile",
    "source code",
  ]) {
    assert.ok(
      !manifest.includes(word),
      `"${word}" would reclassify the skill as coding-conditional`,
    );
  }
});

test("the five Direct-mode rules that make it more than brevity survive", () => {
  const manifest = source(MANIFEST);
  assert.match(manifest, /Lead with the answer or necessary next action/);
  assert.match(manifest, /Number multi-step work/);
  assert.match(manifest, /End when the answer is done/);
  assert.match(manifest, /Restate where things stand during ongoing work/);
  assert.match(manifest, /Give specific time estimates/);
  // Persistence is the point of a switch rather than a one-shot instruction.
  assert.match(manifest, /for the rest of the conversation/);
  assert.match(manifest, /stop direct mode/);
});

test("Direct mode does not manufacture a next action for a complete answer", () => {
  const manifest = source(MANIFEST);
  assert.match(manifest, /Do not invent an action for a factual/);
  assert.match(
    manifest,
    /Do not append a next action, follow-up question, or suggested task to a complete\s*\nanswer/,
  );
  assert.match(manifest, /If another step is necessary, or a suggestion would materially help/);
  assert.match(composer, /Direct answers; next actions only when useful/);
});

test("Direct mode preserves the former saved toggle during the rename", () => {
  const previousWindow = globalThis.window;
  const values = new Map([["breadboard:adhd-mode", "true"]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    assert.equal(isDirectModeEnabled(), true);
    assert.equal(values.get(DIRECT_MODE_STORAGE_KEY), "true");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("structure is chosen for the reader, not suppressed", () => {
  const manifest = source(MANIFEST);
  assert.match(manifest, /Use the structure that actually helps/);
  assert.match(manifest, /structure is not a failure\s*\nmode/);
  assert.match(manifest, /Rank long lists rather than truncating them/);
  assert.match(
    manifest,
    /do not delete an item the reader needs just to hit\na number/,
  );
});

test("the section is the skill body, without its catalog machinery", () => {
  resetDirectModeCache();
  const section = directModeSection();
  assert.match(section, /^# direct_mode\n/);
  assert.match(section, /Where it disagrees with `response_style` about layout, this section wins/);
  assert.match(section, /Lead with the answer or necessary next action/);
  // Frontmatter and the capability contract are catalog plumbing: they cost
  // tokens on every turn and tell the model nothing about writing an answer.
  assert.doesNotMatch(section, /^---$/m);
  assert.doesNotMatch(section, /breadboard:\n/);
  assert.doesNotMatch(section, /requiredArtifactKinds/);
  // It shapes answers. It must never read as a grant.
  assert.match(section, /it grants no capability/);
});

test("the switch reaches every Hermes surface, and only when it is on", () => {
  for (const surface of ["dashboard_terminal", "garden_chat", "quartz_ai"]) {
    assert.doesNotMatch(
      composeHermesSystemPrompt({ surface, decision: KNOWLEDGE_DECISION }),
      /# direct_mode/,
      `${surface} injected the style with the switch off`,
    );
    assert.match(
      composeHermesSystemPrompt({
        surface,
        decision: KNOWLEDGE_DECISION,
        adhdMode: true,
      }),
      /# direct_mode/,
      `${surface} lost the style with the switch on`,
    );
  }
});

test("the style is composed after the default it overrides", () => {
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision: KNOWLEDGE_DECISION,
    adhdMode: true,
  });
  assert.ok(
    prompt.indexOf("# response_style") < prompt.indexOf("# direct_mode"),
    "the exception must be read after the rule it amends",
  );
});

test("both turn pipelines and both legacy chat routes carry the switch", () => {
  // Agent mode off has its own system prompt, so a style wired only into the
  // agent pipeline would silently stop working when the user switched it off.
  const direct = source("src/lib/conversations/direct-turn-service.ts");
  assert.match(direct, /directMode \? directModeSection\(\) : ""/);
  assert.match(direct, /directSystemPrompt\(input\.adhdMode === true\)/);

  const agent = source("src/lib/conversations/turn-service.ts");
  assert.match(agent, /adhdMode: input\.adhdMode === true/);

  for (const route of [
    "src/app/api/chat/route.ts",
    "src/app/api/knowledge-chat/route.ts",
  ]) {
    assert.match(
      source(route),
      /adhdMode === true \? `\$\{directModeSection\(\)\}\\n\\n` : ''/,
      `${route} does not carry the switch`,
    );
  }
});

test("the composer offers the switch above YOLO mode", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  assert.match(composer, /useDirectMode/);
  assert.match(composer, /<span className="block">Direct mode<\/span>/);
  assert.ok(
    composer.indexOf(">Direct mode<") < composer.indexOf(">YOLO mode<"),
    "Direct mode must sit above YOLO mode in the Intelligence popover",
  );

  // Read at send time on both pipelines, so flipping the switch governs every
  // message sent afterwards rather than only a freshly opened chat.
  const session = source("src/app/components/hermes/use-agent-session.ts");
  assert.equal(session.match(/adhdMode: isDirectModeEnabled\(\)/g)?.length, 2);
});
