import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

test("the Agents picker explains every first-party agent in user-facing terms", () => {
  const hub = source("src/app/components/hermes/command-hub.tsx");
  for (const description of [
    "Takes a research project from idea to report",
    "Clicks, types, and completes visual tasks",
    "Opens a real browser to visit sites",
    "Finds current information across social platforms",
    "Investigates a question through several rounds of web research",
    "Breaks a complex problem into connected questions",
    "Drafts a tailored post for each connected social platform",
    "Reads, edits, and tests the local project linked to this Garden",
    "Uses Codex to read, edit, and test the local project",
    "Coordinates several coding workers on larger changes",
  ]) {
    assert.match(hub, new RegExp(description));
  }

  assert.doesNotMatch(
    hub,
    /Insert its command|Investigates recursively|native post per social|queen-led hive-mind|cloned Codex coding agent/,
  );
});

test("agent metadata uses the same plain-language descriptions", () => {
  const aris = source("src/lib/aris/agent.ts");
  const agentBrowser = source("src/lib/agent-browser/store.ts");
  const agentTars = source("src/lib/ui-tars/store.ts");

  assert.match(aris, /Takes a research project from idea to report/);
  assert.match(agentBrowser, /Opens a real browser to visit sites/);
  assert.match(agentBrowser, /PREVIOUS_DEFAULT_DESCRIPTION/);
  assert.match(agentBrowser, /adoptDefaultDescription\(existing\)/);
  assert.match(agentTars, /Clicks, types, and completes visual tasks/);
  assert.match(agentTars, /PREVIOUS_DEFAULT_AGENT_DESCRIPTION/);
});
