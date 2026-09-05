import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GENOFFICE_WORD_SKILL_BOUNDARY,
  genOfficeWritingTools,
  isGenOfficeWritingSkill,
  renderGenOfficeWritingSkillsDirective,
} from "../src/lib/hermes/genoffice-writing-skills.ts";
import { listApprovedSkills } from "../src/lib/hermes/skills.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..");
const skillsRoot = path.resolve(dashboardRoot, "..", ".agents", "skills");

const importedWritingSkills = [
  "contract-and-proposal-writer",
  "copy-editing",
  "copywriting",
  "draft-related-work",
  "draft-survey",
  "fit-page-limit",
  "iflytek-text-proofread",
  "iflytek-translate",
  "match-style",
  "polish-prose",
  "polish-tables-figures",
  "restructure-paper",
  "write-abstract",
  "write-rebuttal",
  "write-talk-script",
];

function candidate(slug, description) {
  return { slug, name: slug, description };
}

test("Word writing catalogue includes every approved writing capability and Humanize", () => {
  const skills = listApprovedSkills("dashboard_terminal")
    .filter((skill) => skill.classification === "eligible_general")
    .filter(isGenOfficeWritingSkill);
  const slugs = new Set(skills.map((skill) => skill.slug));

  const expected = [
    ...importedWritingSkills,
    "humanize",
    "i-have-adhd",
    "office",
    "patent-disclosure-skill",
    "prompt-yourself",
  ];
  assert.deepEqual(expected.filter((slug) => !slugs.has(slug)), []);

  const directive = renderGenOfficeWritingSkillsDirective(skills);
  for (const skill of skills) {
    assert.match(directive, new RegExp(`- ${skill.slug} \\u2014`));
  }
  assert.match(directive, /Opening `humanize` explicitly makes the local/);
  assert.match(GENOFFICE_WORD_SKILL_BOUNDARY, /do not request API credentials/i);
  assert.match(GENOFFICE_WORD_SKILL_BOUNDARY, /supported GenOffice actions/);
});

test("imported writing skills are pinned, licensed, permissionless, and approved for Office", () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(skillsRoot, "registry.json"), "utf8"),
  ).skills;

  for (const slug of importedWritingSkills) {
    const entry = registry[slug];
    assert.ok(entry, `${slug} has an approved registry entry`);
    assert.equal(entry.reviewState, "approved");
    assert.equal(entry.classification.classification, "eligible_general");
    assert.ok(entry.approvedAgents.includes("breadboard-document"));
    assert.deepEqual(entry.approvedPermissions, []);
    assert.ok(entry.description.toLowerCase().includes("writing"));
    assert.ok(fs.existsSync(path.join(skillsRoot, slug, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(skillsRoot, slug, "UPSTREAM_LICENSE")));
    assert.ok(fs.existsSync(path.join(skillsRoot, slug, "UPSTREAM_SOURCE.md")));
    assert.equal(
      Object.keys(entry.fileHashes).some((file) => file.includes("\\")),
      false,
      `${slug} uses portable registry paths`,
    );
  }
});

test("writing detection admits future prose skills without swallowing unrelated agents", () => {
  assert.equal(
    isGenOfficeWritingSkill(candidate("copy-editor", "Proofread and copyedit long-form prose.")),
    true,
  );
  assert.equal(
    isGenOfficeWritingSkill(candidate("grant-writer", "Draft a grant proposal.")),
    true,
  );
  assert.equal(
    isGenOfficeWritingSkill(candidate("translator", "Translate a paper while preserving citations.")),
    true,
  );
  assert.equal(
    isGenOfficeWritingSkill(candidate("edit-garden", "Move notes and rename folders.")),
    false,
  );
  assert.equal(
    isGenOfficeWritingSkill(candidate("agent-loop", "Publish a runtime audit receipt.")),
    false,
  );
});

test("Humanize tools appear only after the Humanize skill is opened", () => {
  assert.deepEqual(
    genOfficeWritingTools(new Set()).map((tool) => tool.function.name),
    ["skill_open"],
  );
  assert.deepEqual(
    genOfficeWritingTools(new Set(["humanize"])).map((tool) => tool.function.name),
    ["skill_open", "humanize_status", "humanize_text"],
  );
});

test("Word assistant route runs a bounded skill loop and feeds tool results back", () => {
  const route = fs.readFileSync(
    path.join(
      dashboardRoot,
      "src/app/api/hermes/artifacts/[artifactId]/genoffice/ai/route.ts",
    ),
    "utf8",
  );
  assert.match(route, /MAX_WRITING_TOOL_ROUNDS = 4/);
  assert.match(route, /listGenOfficeWritingSkills\(\{ userId, request: prompt \}\)/);
  assert.match(route, /runGenOfficeWritingTool\(\{/);
  assert.match(route, /role: "tool"/);
  assert.match(route, /openedSkillSlugs\.add\(openedSlug\)/);
  assert.match(route, /Tool work is bounded/);
});
