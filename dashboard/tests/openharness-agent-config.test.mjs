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

test("the common workbench is the OpenHarness default", () => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(root, "openharness-config", "opencode.json"),
      "utf8",
    ),
  );
  assert.equal(config.default_agent, "breadboard-workbench");
  assert.equal(config.subagent_depth, 2);
});

test("the common workbench exposes general tools with guarded mutation", () => {
  const fm = frontmatter("breadboard-workbench");
  assert.equal(fm.mode, "primary");
  for (const tool of [
    "read",
    "glob",
    "grep",
    "bash",
    "edit",
    "write",
    "patch",
    "task",
    "webfetch",
    "websearch",
    "skill",
  ]) {
    assert.equal(fm.tools[tool], true, `workbench enables ${tool}`);
  }
  assert.equal(fm.permission.edit, "ask");
  assert.equal(fm.permission.webfetch, "ask");
  assert.equal(fm.permission.websearch, "ask");
  assert.equal(fm.permission.bash["git push*"], "deny");
  assert.equal(fm.permission.bash["rm -rf*"], "deny");
  assert.equal(fm.permission.bash["git status*"], "allow");
  assert.equal(fm.permission.read["*"], "allow");
  assert.equal(fm.permission.read["**/.ssh/*"], "ask");
  assert.equal(fm.permission.read["**/*credentials*"], "ask");
  assert.equal(fm.tools.question, false);
  assert.equal(fm.permission.question, "deny");
});

test("permission decisions never become another chat turn", () => {
  const workbench = rawAgent("breadboard-workbench");
  assert.match(workbench, /never ask for tool approval through prose/i);
  assert.match(workbench, /invoke the intended tool exactly once/i);
  assert.match(workbench, /dedicated permission UI/i);
  assert.match(workbench, /If a tool is denied or unavailable/i);
});

test("all chat surfaces select the same capable base agent", () => {
  const configSource = fs.readFileSync(
    path.join(root, "dashboard", "src", "lib", "openharness", "config.ts"),
    "utf8",
  );
  assert.match(
    configSource,
    /terminal:\s*envString\("OPENHARNESS_TERMINAL_AGENT", "breadboard-workbench"\)/,
  );
  assert.match(
    configSource,
    /garden:\s*envString\("OPENHARNESS_GARDEN_AGENT", "breadboard-workbench"\)/,
  );
  assert.match(
    configSource,
    /quartz:\s*envString\("OPENHARNESS_QUARTZ_AGENT", "breadboard-workbench"\)/,
  );
});

test("bounded specialists exist as subagents and cannot recursively delegate", () => {
  const specialists = [
    "planner",
    "repo-explorer",
    "web-researcher",
    "file-analyst",
    "file-operator",
    "code-implementer",
    "test-runner",
    "document-analyst",
    "garden-specialist",
    "memory-specialist",
    "verifier",
    "capability-scout",
  ];
  for (const name of specialists) {
    const fm = frontmatter(name);
    assert.equal(fm.mode, "subagent", `${name} is a subagent`);
    assert.equal(
      fm.permission.task,
      "deny",
      `${name} cannot recursively delegate`,
    );
  }
});

test("Garden behavior remains proposal-only without disabling general tools", () => {
  const workbench = rawAgent("breadboard-workbench");
  assert.match(workbench, /Garden changes remain typed proposals/i);
  assert.match(workbench, /typed proposal/i);
  const adapter = fs.readFileSync(
    path.join(
      root,
      "dashboard",
      "src",
      "lib",
      "openharness",
      "garden-chat-adapter.ts",
    ),
    "utf8",
  );
  assert.match(adapter, /context is high priority but additive/i);
  assert.doesNotMatch(adapter, /Use only the garden_\* tools/);
});

test("capability scout may discover skills but cannot mutate or delegate", () => {
  const fm = frontmatter("capability-scout");
  assert.equal(fm.mode, "subagent");
  assert.equal(fm.permission.edit, "deny");
  assert.equal(fm.permission.bash, "deny");
  assert.equal(fm.permission.task, "deny");
  assert.equal(fm.permission.skill["find-skills"], "allow");
});
