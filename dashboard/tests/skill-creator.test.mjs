import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSkillFiles,
  composeSkillMarkdown,
  normalizeSkillName,
  parseSkillDraftResponse,
  validateSkillDraft,
} from "../src/lib/hermes/skill-authoring.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const validDraft = {
  name: "flashcard-builder",
  description:
    "Builds spaced-repetition flashcards from notes. Use when the user asks for flashcards, review questions, or self-testing material.",
  instructions: "## Workflow\n1. Read the notes.\n2. Write question-answer pairs.",
  references: [],
};

test("a well-formed draft validates cleanly and composes real frontmatter", () => {
  const validation = validateSkillDraft(validDraft);
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.warnings, []);
  const markdown = composeSkillMarkdown(validDraft);
  assert.match(markdown, /^---\nname: flashcard-builder\ndescription: "/);
  assert.match(markdown, /\n---\n\n## Workflow/);
});

test("skill-creator naming and description rules are enforced", () => {
  assert.ok(validateSkillDraft({ ...validDraft, name: "Flashcard Builder" }).issues.length);
  assert.ok(validateSkillDraft({ ...validDraft, name: "9lives" }).issues.length);
  assert.ok(validateSkillDraft({ ...validDraft, name: "" }).issues.length);
  assert.ok(validateSkillDraft({ ...validDraft, description: "x".repeat(1100) }).issues.length);
  const noTrigger = validateSkillDraft({ ...validDraft, description: "Builds flashcards from notes." });
  assert.deepEqual(noTrigger.issues, []);
  assert.match(noTrigger.warnings.join(" "), /when to use it/);
});

test("progressive disclosure guidance: long bodies warn, own frontmatter is rejected", () => {
  const long = validateSkillDraft({ ...validDraft, instructions: Array(560).fill("step").join("\n") });
  assert.match(long.warnings.join(" "), /under 500 lines/);
  const fronted = validateSkillDraft({ ...validDraft, instructions: "---\nname: sneaky\n---\nbody" });
  assert.match(fronted.issues.join(" "), /frontmatter/);
});

test("reference docs are validated and land under references/", () => {
  const bad = validateSkillDraft({
    ...validDraft,
    references: [{ filename: "../escape.md", contents: "x" }],
  });
  assert.ok(bad.issues.length);
  const script = validateSkillDraft({
    ...validDraft,
    references: [{ filename: "run.sh", contents: "x" }],
  });
  assert.ok(script.issues.length);
  const unmentioned = validateSkillDraft({
    ...validDraft,
    references: [{ filename: "advanced.md", contents: "deep detail" }],
  });
  assert.match(unmentioned.warnings.join(" "), /never point/);
  const files = buildSkillFiles({
    ...validDraft,
    instructions: `${validDraft.instructions}\nSee references/advanced.md for edge cases.`,
    references: [{ filename: "advanced.md", contents: "deep detail" }],
  });
  assert.ok(files["SKILL.md"]);
  assert.equal(files["references/advanced.md"], "deep detail");
});

test("model drafts parse from fenced JSON and normalize the name", () => {
  const draft = parseSkillDraftResponse(
    '```json\n{"name": "Meeting Summarizer!", "description": "d", "instructions": "i"}\n```',
  );
  assert.equal(draft.name, "meeting-summarizer");
  assert.equal(normalizeSkillName("--9 Weird__Name--"), "weird-name");
  assert.equal(parseSkillDraftResponse("no json here"), null);
});

test("the create route stages quarantine only and never promotes", () => {
  const route = read("src/app/api/hermes/skills/create/route.ts");
  assert.match(route, /requireUserId/);
  assert.match(route, /requireEnabled/);
  assert.match(route, /quarantineSkill/);
  assert.match(route, /skill\.authored_quarantined/);
  assert.doesNotMatch(route, /promoteSkill/);
});

test("the creator UI stages, reviews, and reuses the human promotion boundary", () => {
  const creator = read("src/app/components/hermes/skill-creator-panel.tsx");
  assert.match(creator, /\/api\/hermes\/skills\/create/);
  assert.match(creator, /\/api\/hermes\/skills\/promote/);
  assert.match(creator, /Stage for review/);
  assert.match(creator, /Approve and install/);
  assert.match(creator, /Discard/);
  assert.match(creator, /Draft with AI/);
  assert.match(creator, /skill-creator/);
  const catalog = read("src/app/components/hermes/skills-catalog-panel.tsx");
  assert.match(catalog, /SkillCreatorPanel/);
});
