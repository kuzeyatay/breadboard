import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// Verifies the EFFECTIVE DECLARED configuration of the OpenHarness agents — the
// YAML frontmatter that OpenHarness's config loader parses and merges into each
// agent's tool set and permission ruleset. This is config-level evidence (not
// the prose prompt). A live tool-availability probe would require running the
// OpenHarness server, which needs Bun (unavailable in this environment); this
// asserts the exact declarations that drive effective availability.

const here = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.resolve(here, "..", "..", "openharness-config", "agent");

function frontmatter(name) {
  const raw = fs.readFileSync(path.join(agentDir, `${name}.md`), "utf8");
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(match, `${name} must have YAML frontmatter`);
  return yaml.load(match[1]);
}

test("all four agents exist and parse", () => {
  for (const name of ["breadboard-terminal", "breadboard-garden", "breadboard-quartz", "breadboard-capability-scout"]) {
    const fm = frontmatter(name);
    assert.ok(fm.mode, `${name} declares a mode`);
  }
});

test("breadboard-garden disables all generic tools and denies shell/file/git/web/task/skill", () => {
  const fm = frontmatter("breadboard-garden");
  // Generic tools off by default.
  assert.equal(fm.tools["*"], false);
  // No generic capability is turned back on.
  for (const generic of ["bash", "edit", "write", "read", "webfetch", "websearch", "task", "patch"]) {
    assert.notEqual(fm.tools[generic], true, `garden must not enable ${generic}`);
  }
  // Only garden_* tools are enabled.
  for (const [name, enabled] of Object.entries(fm.tools)) {
    if (enabled === true) assert.ok(name.startsWith("garden_"), `garden enables only garden_* (found ${name})`);
  }
  // Permission denies the dangerous classes.
  for (const perm of ["edit", "bash", "webfetch", "websearch", "task", "skill"]) {
    assert.equal(fm.permission[perm], "deny", `garden must deny ${perm}`);
  }
});

test("breadboard-quartz has the same lockdown and is proposal-only", () => {
  const fm = frontmatter("breadboard-quartz");
  assert.equal(fm.tools["*"], false);
  for (const perm of ["edit", "bash", "webfetch", "websearch", "task", "skill"]) {
    assert.equal(fm.permission[perm], "deny", `quartz must deny ${perm}`);
  }
  for (const [name, enabled] of Object.entries(fm.tools)) {
    if (enabled === true) assert.ok(name.startsWith("garden_"));
  }
});

test("neither garden nor quartz can invoke find-skills or delegate (task denied)", () => {
  for (const name of ["breadboard-garden", "breadboard-quartz"]) {
    const fm = frontmatter(name);
    assert.notEqual(fm.tools["find-skills"], true, `${name} must not enable find-skills`);
    assert.equal(fm.permission.task, "deny", `${name} must deny task (no delegation to scout)`);
    assert.equal(fm.permission.skill, "deny", `${name} must deny skills`);
  }
});

test("capability scout is a subagent limited to find-skills, cannot edit/bash/delegate", () => {
  const fm = frontmatter("breadboard-capability-scout");
  assert.equal(fm.mode, "subagent");
  assert.equal(fm.tools["*"], false);
  assert.equal(fm.permission.edit, "deny");
  assert.equal(fm.permission.bash, "deny");
  assert.equal(fm.permission.task, "deny");
  // Skill permission allows ONLY find-skills.
  assert.equal(fm.permission.skill["*"], "deny");
  assert.equal(fm.permission.skill["find-skills"], "allow");
});

test("terminal denies force-push and destructive deletes, asks before edits", () => {
  const fm = frontmatter("breadboard-terminal");
  assert.equal(fm.mode, "primary");
  assert.equal(fm.permission.edit, "ask");
  assert.equal(fm.permission.bash["git push --force*"], "deny");
  assert.equal(fm.permission.bash["rm -rf*"], "deny");
  assert.equal(fm.permission.bash["git push*"], "deny");
  // Safe reads are allowed without confirmation.
  assert.equal(fm.permission.bash["git status"], "allow");
  assert.equal(fm.permission.bash["git diff"], "allow");
});
