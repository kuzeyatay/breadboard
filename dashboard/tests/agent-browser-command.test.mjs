import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const identity = await import("../src/lib/agent-browser/identity.ts");
const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

test("Agent Browser has one canonical slash command", () => {
  assert.equal(identity.AGENT_BROWSER_SLASH_COMMAND, "/agents:agent-browser");
  assert.equal(
    identity.agentBrowserUserMessage("open example.com"),
    "/agents:agent-browser open example.com",
  );
  assert.equal(
    identity.taskFromAgentBrowserCommand("  /AGENTS:AGENT-BROWSER  open example.com"),
    "open example.com",
  );
  assert.equal(identity.taskFromAgentBrowserCommand("/agents:agent-browser"), "");
  assert.equal(identity.taskFromAgentBrowserCommand("/agents:agent-tars task"), null);
});

test("Agent Browser selection, display, and transcript use the slash command", () => {
  const composer = source("src/app/components/assistant-composer.tsx");
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");

  assert.match(composer, />\{AGENT_BROWSER_SLASH_COMMAND\}<\/span>/);
  assert.match(
    composer,
    /onSelectAgentBrowser=\{onSelectAgentBrowser \? \(\) => insertCommandToken\(AGENT_BROWSER_SLASH_COMMAND\)/,
  );
  assert.match(terminal, /taskFromAgentBrowserCommand\(text\)/);
  assert.match(terminal, /content: agentBrowserUserMessage\(task\)/);

  // Explicit slash commands are parsed before either sticky browser-agent mode.
  assert.ok(
    terminal.indexOf("taskFromAgentBrowserCommand(text)") <
      terminal.indexOf("if (agentBrowserAgent) {", terminal.indexOf("const submit")),
  );
  assert.ok(
    terminal.indexOf("taskFromAgentTarsCommand(text)") <
      terminal.indexOf("if (agentBrowserAgent) {", terminal.indexOf("const submit")),
  );
});
