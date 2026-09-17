import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultAgentPreferences, parseAgentPreferences, renderAgentPreferences,
  serializeAgentPreferences, validateAgentPreferences,
} from "../src/lib/agent-preferences/preferences.ts";
import { taskPresetCandidates } from "../src/lib/agent-preferences/task-presets.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";
import {
  agentPreferencesContext, agentPreferencesPath, readAgentPreferences, writeAgentPreferences,
} from "../src/lib/agent-preferences/store.ts";

test("enabling alone never selects an agent, and task sections cover the runtime catalog", () => {
  const settings = defaultAgentPreferences();
  assert.equal(settings.enabled, false);
  assert.ok(settings.tasks.every((task) => task.agents.length === 0));
  assert.equal(renderAgentPreferences({ ...settings, enabled: true }), "");
  for (const agent of RUNTIME_AGENT_PROFILES) {
    assert.ok(settings.tasks.some((task) => taskPresetCandidates(task.id).includes(agent.command)), `Missing task for ${agent.name} (${agent.command})`);
  }
  assert.notEqual(defaultAgentPreferences().tasks, settings.tasks);
});

test("only customized tasks create a bias; clearing a choice removes the rule", () => {
  const settings = defaultAgentPreferences();
  settings.enabled = true;
  settings.tasks.find((task) => task.id === "video").agents = ["/agents:hyperframes", "/agents:vimax"];
  const prompt = renderAgentPreferences(settings);
  assert.match(prompt, /### Producing video/);
  assert.match(prompt, /\/agents:hyperframes → \/agents:vimax/);
  assert.doesNotMatch(prompt, /### Creating music|### Analyzing stocks|\/agents:stock-analyst/);
  assert.match(prompt, /Explicit user choices and the current request take priority/);
  assert.match(prompt, /Tasks not listed below have no saved bias/);
  settings.tasks.find((task) => task.id === "video").agents = [];
  assert.equal(renderAgentPreferences(settings), "");
});

test("fallback and explanation instructions apply only when enabled", () => {
  const settings = defaultAgentPreferences();
  settings.tasks[0].agents = ["/agents:hyperframes"];
  settings.fallback = "ask";
  settings.explainChoice = true;
  assert.equal(renderAgentPreferences(settings), "");
  const prompt = renderAgentPreferences({ ...settings, enabled: true });
  assert.match(prompt, /ask the user before substituting/);
  assert.match(prompt, /explain why it fits before starting/);
  assert.match(prompt, /does not grant tools, authorize a launch, or activate a persona/);
});

test("Markdown round trips Unicode guidance, ranked agents, and no-preference tasks", () => {
  const settings = defaultAgentPreferences();
  settings.tasks[0].agents = ["/agents:hyperframes", "/agent:aris"];
  settings.guidance = "## Personal style\nPrefer calm motion — café scenes.\n\n---\nKeep narration brief.";
  assert.deepEqual(parseAgentPreferences(serializeAgentPreferences(settings)), settings);
  assert.deepEqual(parseAgentPreferences(serializeAgentPreferences(settings).replaceAll("\n", "\r\n")), { ...settings, guidance: settings.guidance.replaceAll("\n", "\r\n") });
  assert.throws(() => validateAgentPreferences({ ...settings, enabled: "true" }));
  assert.throws(() => validateAgentPreferences({ ...settings, tasks: [{ ...settings.tasks[0], when: "" }] }));
  assert.throws(() => validateAgentPreferences({ ...settings, guidance: "a".repeat(6001) }));
  assert.throws(() => validateAgentPreferences({ ...settings, tasks: [{ ...settings.tasks[0], agents: ["../escape"] }] }));
  assert.throws(() => parseAgentPreferences("---\ninvalid json\n---\n"));
});

test("real per-user file is re-read each turn; disabling and clearing cannot retain an old bias", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-preferences-"));
  const previous = process.env.BREADBOARD_DATA_DIR;
  process.env.BREADBOARD_DATA_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(agentPreferencesContext(null), "");
  assert.equal(agentPreferencesContext(1), "");
  const settings = defaultAgentPreferences();
  settings.enabled = true;
  settings.tasks[0].agents = ["/agents:hyperframes"];
  writeAgentPreferences(1, settings);
  assert.deepEqual(readAgentPreferences(1), settings);
  assert.match(fs.readFileSync(agentPreferencesPath(1), "utf8"), /hyperframes/);
  assert.match(agentPreferencesContext(1), /\/agents:hyperframes/);
  assert.equal(agentPreferencesContext(2), "");
  writeAgentPreferences(1, { ...settings, enabled: false });
  assert.match(agentPreferencesContext(1), /ignore saved agent preferences from earlier turns/);
  assert.doesNotMatch(agentPreferencesContext(1), /hyperframes/);
  settings.tasks[0].agents = [];
  writeAgentPreferences(1, settings);
  assert.doesNotMatch(agentPreferencesContext(1), /hyperframes/);
  assert.deepEqual(fs.readdirSync(path.dirname(agentPreferencesPath(1))), ["AGENT_PREFERENCES.md"]);
  assert.throws(() => agentPreferencesPath(-1));
  fs.writeFileSync(agentPreferencesPath(1), "broken");
  assert.throws(() => readAgentPreferences(1));
  assert.match(agentPreferencesContext(1), /could not be read/);
});
