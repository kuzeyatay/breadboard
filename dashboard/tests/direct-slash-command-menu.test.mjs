import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { directSlashCommandItems } from "../src/lib/hermes/direct-slash-commands.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const ready = (overrides) => ({
  id: "skill:ready",
  kind: "skill",
  slug: "ready",
  token: "ready",
  name: "Ready skill",
  description: "Runs immediately",
  installed: true,
  enabled: true,
  healthy: true,
  ...overrides,
});

test("direct slash commands exclude setup entries and include usable agents", () => {
  const items = directSlashCommandItems({
    surface: "dashboard_terminal",
    availableRuntimeAgentIds: ["deep-research"],
    groups: {
      skills: [
        ready({}),
        ready({ id: "skill:install", token: "install-me", installed: false }),
        ready({ id: "skill:broken", token: "broken", healthy: false }),
      ],
      mcp: [ready({ id: "mcp:live", kind: "mcp", token: "drive" })],
      prompts: [ready({ id: "prompt:brief", kind: "prompt", token: "brief" })],
      agents: [],
    },
    agencyAgents: [{
      id: "agency-agent:researcher",
      slug: "researcher",
      name: "Researcher",
      description: "Research persona",
      division: "research",
      divisionLabel: "Research",
      divisionIcon: "Search",
      divisionColor: "#123456",
      services: [],
      source: "Agency Agents",
    }],
  });

  assert.deepEqual(
    items.map((item) => item.token),
    ["ready", "agents:deep-research", "agents:agency-agents:researcher", "brief", "drive"],
  );
  assert.ok(items.every((item) => item.enabled !== false && item.healthy !== false));
});

test("matching commands are ordered skills, agents, prompts, then workflows", () => {
  const items = directSlashCommandItems({
    surface: "dashboard_terminal",
    query: "review",
    availableRuntimeAgentIds: ["deep-research"],
    groups: {
      skills: [
        // The workflow pack is installed as a skill and must still sort last.
        ready({
          id: "rlaope/oh-my-hermes/review-workflow",
          slug: "omh:review-workflow",
          token: "omh:review-workflow",
          name: "Review workflow",
          source: "https://github.com/rlaope/oh-my-hermes",
        }),
        ready({ id: "skill:review", token: "review-notes", name: "Review notes" }),
      ],
      mcp: [ready({ id: "mcp:live", kind: "mcp", token: "drive", name: "Review drive" })],
      prompts: [ready({ id: "prompt:review", kind: "prompt", token: "review-brief", name: "Review brief" })],
      agents: [ready({ id: "agent:aris", kind: "agent", token: "agent:aris", name: "Review persona" })],
    },
  });

  assert.deepEqual(
    items.map((item) => item.token),
    [
      "review-notes",
      "agent:aris",
      "review-brief",
      "drive",
      "omh:review-workflow",
    ],
  );
});

test("slash queries filter commands without exposing the full manager", () => {
  const items = directSlashCommandItems({
    surface: "dashboard_terminal",
    query: "deep",
    availableRuntimeAgentIds: ["deep-research", "codex"],
    groups: { skills: [], mcp: [], prompts: [], agents: [] },
  });
  assert.deepEqual(items.map((item) => item.token), ["agents:deep-research"]);

  const composer = source("../src/app/components/assistant-composer.tsx");
  // The token being replaced is the one under the caret, which is not the whole
  // box once the sentence has a body after the capability.
  assert.ok(
    composer.includes("slashQueryReplacementRange(value, node?.selectionStart)"),
  );
  assert.match(composer, /slashCommandMenuRef\.current\?\.handleKeyDown\(event\)/);
});
