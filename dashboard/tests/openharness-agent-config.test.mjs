import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const agentDir = path.join(root, "openharness-config", "agent");

function rawAgent(name) {
  return fs.readFileSync(path.join(agentDir, `${name}.md`), "utf8");
}

function frontmatter(name) {
  const match = rawAgent(name).match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(match, `${name} must have YAML frontmatter`);
  return yaml.load(match[1]);
}

test("breadboard-assistant is the canonical OpenHarness default", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "openharness-config", "opencode.json"), "utf8"));
  assert.equal(config.default_agent, "breadboard-assistant");
  assert.equal(config.subagent_depth, 2);
});

test("the canonical assistant defaults repository and coding permissions to deny", () => {
  const fm = frontmatter("breadboard-assistant");
  assert.equal(fm.mode, "primary");
  for (const permission of ["read", "glob", "grep", "edit", "write", "patch", "bash", "task", "skill"]) {
    assert.equal(fm.permission[permission], "deny", `${permission} is default denied`);
  }
  assert.equal(fm.tools.task, false);
  assert.equal(fm.tools.skill, false);
  assert.equal(fm.tools.question, false);
  assert.equal(fm.permission.webfetch, "ask");
  assert.equal(fm.permission.websearch, "ask");
});

test("legacy engineering identifiers remain loadable without broad authority", () => {
  for (const name of ["breadboard-workbench", "breadboard-terminal"]) {
    const fm = frontmatter(name);
    assert.equal(fm.tools["*"], false);
    assert.equal(fm.permission.read, "deny");
    assert.equal(fm.permission.edit, "deny");
    assert.equal(fm.permission.bash, "deny");
    assert.match(rawAgent(name), /knowledge mode/i);
    assert.match(rawAgent(name), /breadboard-assistant/i);
  }
});

test("surface defaults use dedicated knowledge-first agents", () => {
  const configSource = fs.readFileSync(path.join(root, "dashboard", "src", "lib", "openharness", "config.ts"), "utf8");
  assert.match(configSource, /terminal:\s*envString\("OPENHARNESS_TERMINAL_AGENT", "breadboard-assistant"\)/);
  assert.match(configSource, /garden:\s*envString\("OPENHARNESS_GARDEN_AGENT", "breadboard-garden"\)/);
  assert.match(configSource, /quartz:\s*envString\("OPENHARNESS_QUARTZ_AGENT", "breadboard-quartz"\)/);
  assert.equal(frontmatter("breadboard-garden").permission.bash, "deny");
  assert.equal(frontmatter("breadboard-quartz").permission.skill, "deny");
});

test("bounded specialists exist as subagents and cannot recursively delegate", () => {
  const specialists = [
    "planner", "repo-explorer", "web-researcher", "file-analyst", "file-operator",
    "code-implementer", "test-runner", "document-analyst", "garden-specialist",
    "memory-specialist", "verifier", "capability-scout",
  ];
  for (const name of specialists) {
    const fm = frontmatter(name);
    assert.equal(fm.mode, "subagent", `${name} is a subagent`);
    assert.equal(fm.permission.task, "deny", `${name} cannot recursively delegate`);
  }
});

test("Garden and Quartz publication remain proposal-only and coding-free", () => {
  assert.match(rawAgent("breadboard-garden"), /typed PROPOSAL/i);
  assert.match(rawAgent("breadboard-quartz"), /typed PROPOSAL/i);
  assert.equal(frontmatter("breadboard-garden").permission.edit, "deny");
  assert.equal(frontmatter("breadboard-quartz").permission.edit, "deny");
});

test("the composed system prompt contains every policy section", () => {
  const prompt = fs.readFileSync(path.join(root, "openharness-config", "system", "assistant.md"), "utf8");
  for (const section of [
    "identity_and_role", "primary_behavior", "garden_and_source_grounding", "capability_modes",
    "coding_necessity", "tools", "web_research", "skills", "mcp_connections", "memory",
    "files_and_deliverables", "implementation_behavior", "temporal_awareness",
    "safety_and_high_stakes_topics", "tone_and_formatting", "errors_and_limitations",
    "knowledge_first_boundary",
  ]) assert.match(prompt, new RegExp(`# ${section}`));
});

test("capability scout may discover skills but cannot mutate or delegate", () => {
  const fm = frontmatter("capability-scout");
  assert.equal(fm.mode, "subagent");
  assert.equal(fm.permission.edit, "deny");
  assert.equal(fm.permission.bash, "deny");
  assert.equal(fm.permission.task, "deny");
  assert.equal(fm.permission.skill["find-skills"], "allow");
});
