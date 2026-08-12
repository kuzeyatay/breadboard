import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("MCP management lives in Settings and not the capability manager", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const dialog = source("../src/app/components/settings-dialog.tsx");
  const mcp = source("../src/app/components/settings-mcp.tsx");
  const composer = source("../src/app/components/assistant-composer.tsx");

  assert.doesNotMatch(hub, /\{ id: "mcp", label: "MCP" \}/);
  assert.doesNotMatch(hub, /Manage MCP servers|Add an MCP server|Search MCP servers/);
  assert.match(hub, /onOpenConnections=\{onOpenMcpSettings/);
  assert.match(dialog, /\| "mcp"/);
  assert.match(dialog, /value: "mcp"[\s\S]{0,100}label: "MCP"/);
  assert.match(dialog, /visitedTabs\.has\("mcp"\)[\s\S]*<SettingsMcp \/>/);
  assert.match(composer, /onOpenMcpSettings=\{\(\) => \{[\s\S]{0,160}setSettingsInitialTab\('mcp'\)/);

  assert.match(mcp, /fetchCachedSettings\(MCP_SETTINGS_URL/);
  assert.match(mcp, /fetch\(MCP_SETTINGS_URL,[\s\S]{0,100}method: "POST"/);
  assert.match(mcp, /fetch\(`\$\{MCP_SETTINGS_URL\}\/\$\{connection\.id\}`/);
  assert.match(mcp, /"test" \| "authenticate" \| "toggle" \| "remove"/);
  assert.match(mcp, /invalidateCommandResponseCache\(\)/);
});

test("healthy MCP commands remain directly usable from typed slash", () => {
  const direct = source("../src/lib/hermes/direct-slash-commands.ts");
  assert.match(direct, /\.\.\.\(groups\?\.mcp \?\? \[\]\)/);
  assert.match(direct, /item\.enabled === false \|\| item\.healthy === false/);
});
