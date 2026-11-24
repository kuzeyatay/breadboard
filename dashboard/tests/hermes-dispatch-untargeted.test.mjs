import test from "node:test";
import assert from "node:assert/strict";
import { prepareTurn } from "../src/lib/hermes/dispatch-core.ts";
import { authorizeTerminalCommand } from "../src/lib/hermes/terminal-execution.ts";

const turn = (request, interactiveApprovals) => prepareTurn({
  request, surface: "dashboard_terminal", userId: 1, grants: [],
  workspaceRoot: process.cwd(), interactiveApprovals,
});

test("a request missing only its folder reaches a model that holds the terminal", () => {
  const request = "Summarize the files in that folder.";
  const withTerminal = turn(request, true);
  assert.equal(withTerminal.grant.allowedTools.terminal_execute_command, true);
  assert.equal(withTerminal.blocked, false);
  assert.deepEqual(withTerminal.pendingPermissions, []);
  // No terminal (no interactive approvals): the planner's stop still applies.
  const withoutTerminal = turn(request, false);
  assert.equal(withoutTerminal.blocked, true);
});

test("read pipelines are judged stage by stage", () => {
  for (const command of [
    "Get-Content notes.txt | Select-String error",
    "Select-String -Pattern TODO -Path src | Measure-Object",
    "Test-Path package.json",
  ]) assert.equal(authorizeTerminalCommand(command).allowed, true, command);
  for (const command of [
    "Get-Content notes.txt | Set-Content copy.txt",
    String.raw`Get-Content C:\Windows\win.ini | Select-String x`,
  ]) assert.equal(authorizeTerminalCommand(command).allowed, false, command);
});
