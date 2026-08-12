import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const agentDir = path.join(root, "hermes-config", "agent");

function rawAgent(name) {
  return fs.readFileSync(path.join(agentDir, `${name}.md`), "utf8");
}

function frontmatter(name) {
  const match = rawAgent(name).match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(match, `${name} must have YAML frontmatter`);
  return yaml.load(match[1]);
}

test("breadboard-assistant is the canonical Hermes default", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "hermes-config", "opencode.json"), "utf8"));
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
  const configSource = fs.readFileSync(path.join(root, "dashboard", "src", "lib", "hermes", "config.ts"), "utf8");
  assert.match(configSource, /terminal:\s*envString\("HERMES_TERMINAL_AGENT", "breadboard-assistant"\)/);
  assert.match(configSource, /garden:\s*envString\("HERMES_GARDEN_AGENT", "breadboard-garden"\)/);
  assert.match(configSource, /quartz:\s*envString\("HERMES_QUARTZ_AGENT", "breadboard-quartz"\)/);
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
    assert.match(rawAgent(name), /You are Bread, the Breadboard assistant/);
  }
});

test("Garden and Quartz publication remain proposal-only and coding-free", () => {
  assert.match(rawAgent("breadboard-garden"), /typed PROPOSAL/i);
  assert.match(rawAgent("breadboard-quartz"), /typed PROPOSAL/i);
  assert.equal(frontmatter("breadboard-garden").permission.edit, "deny");
  assert.equal(frontmatter("breadboard-quartz").permission.edit, "deny");
});

test("the composed system prompt contains every policy section", () => {
  const prompt = fs.readFileSync(path.join(root, "hermes-config", "system", "assistant.md"), "utf8");
  assert.match(prompt, /You are Bread, the Breadboard assistant\./);
  assert.match(prompt, /Hermes is the agent runtime, not your name/);
  for (const section of [
    "identity_and_role", "primary_behavior", "garden_and_source_grounding", "capability_modes",
    "coding_necessity", "tools", "web_research", "current_recommendations", "current_location", "skills", "mcp_connections", "memory",
    "files_and_deliverables", "implementation_behavior", "temporal_awareness",
    "safety_and_high_stakes_topics", "tone_and_formatting", "errors_and_limitations",
    "knowledge_first_boundary",
  ]) assert.match(prompt, new RegExp(`# ${section}`));
});

test("current location remains an ephemeral, geography-only hint", () => {
  const prompt = fs.readFileSync(path.join(root, "hermes-config", "system", "assistant.md"), "utf8");
  assert.match(prompt, /short-lived device hint the user\s+explicitly enabled/i);
  assert.match(prompt, /only when geography materially changes the requested answer/i);
  assert.match(prompt, /destination the user names in their message always takes precedence/i);
  assert.match(prompt, /do not infer a home\s+or save the location to memory/i);
  assert.match(prompt, /never claim current location is available/i);
});

test("current recommendations are researched, ranked, and made practical", () => {
  const prompt = fs.readFileSync(path.join(root, "hermes-config", "system", "assistant.md"), "utf8");
  assert.match(prompt, /search before answering even if the user did not\s+explicitly ask you to browse/i);
  assert.match(prompt, /Infer the user's real outcome and constraints from the whole\s+conversation/i);
  assert.match(prompt, /name a clear best match\s+and explain why it wins/i);
  assert.match(prompt, /compare only the most useful alternatives by their\s+meaningful tradeoffs/i);
  assert.match(prompt, /Verify practical\s+claims such as location, opening hours, price, schedule, and availability/i);
  assert.match(prompt, /cite those sources as close to the claims as the channel\s+allows/i);
  assert.match(prompt, /Add a compact\s+plan or itinerary only when it makes the recommendation more useful/i);
  assert.match(prompt, /adapting the presentation,\s+not by lowering the evidence standard/i);
});

test("the authenticated Terminal advertises its gated write capability", () => {
  const shared = fs.readFileSync(path.join(root, "hermes-config", "system", "assistant.md"), "utf8");
  const terminal = fs.readFileSync(path.join(root, "hermes-config", "system", "main-assistant.md"), "utf8");
  assert.match(shared, /other valid commands, including writes, pause for native approval/i);
  assert.match(shared, /scoped_implementation[\s\S]*file create\/edit\/patch tools/i);
  assert.match(terminal, /It is not a\s+read-only surface/i);
  assert.match(terminal, /Never describe the\s+Terminal as read-only/i);
});

test("capability scout may discover skills but cannot mutate or delegate", () => {
  const fm = frontmatter("capability-scout");
  assert.equal(fm.mode, "subagent");
  assert.equal(fm.permission.edit, "deny");
  assert.equal(fm.permission.bash, "deny");
  assert.equal(fm.permission.task, "deny");
  assert.equal(fm.permission.skill["find-skills"], "allow");
});
