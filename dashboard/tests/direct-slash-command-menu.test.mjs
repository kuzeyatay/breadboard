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
    ["agents:deep-research", "ready", "agent:researcher", "drive", "brief"],
  );
  assert.ok(items.every((item) => item.enabled !== false && item.healthy !== false));
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
  assert.ok(composer.includes("const replacingSlashQuery = /^\\/[^\\s]*$/.test(value);"));
  assert.match(composer, /slashCommandMenuRef\.current\?\.handleKeyDown\(event\)/);
});
