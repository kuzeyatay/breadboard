// "Always allow" terminal rules: Codex-style prefixes, saved per user from a
// permission card, never broad enough to allow arbitrary code or deletion.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-terminal-rules-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const { commandRulePrefix, commandMatchesPrefix } = await import("../src/lib/hermes/terminal-command-prefix.ts");
const rules = await import("../src/lib/hermes/terminal-command-rules.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("a prefix is the program plus its plain subcommands", () => {
  assert.deepEqual(commandRulePrefix("winget install --id PowerWorld.Simulator -e"), ["winget", "install"]);
  assert.deepEqual(commandRulePrefix("npm run dev -- --port 3000"), ["npm", "run", "dev"]);
  assert.deepEqual(commandRulePrefix("git push origin main"), ["git", "push", "origin"]);
  assert.deepEqual(
    commandRulePrefix(String.raw`"C:\Users\me\Downloads\PW24Setup.exe" /S`),
    [String.raw`C:\Users\me\Downloads\PW24Setup.exe`],
  );
  assert.deepEqual(
    commandRulePrefix(String.raw`Start-Process "C:\Users\me\Downloads\PW24Setup.exe" -Wait`),
    ["Start-Process", String.raw`C:\Users\me\Downloads\PW24Setup.exe`],
  );
});

test("arbitrary code, deletion, composition and whole tools are never ruleable", () => {
  for (const command of [
    "python setup.py install",
    "node build.js",
    "powershell -File x.ps1",
    "Remove-Item C:\\temp\\x",
    "rm -rf build",
    "Invoke-Expression $code",
    "winget install x; Remove-Item y",
    "git -C repo push",
    "Start-Process powershell",
    "Start-Process -FilePath x.exe",
  ]) assert.equal(commandRulePrefix(command), null, command);
});

test("a saved rule allows matching commands only, for its own user", () => {
  db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash) VALUES (901, 'rules-a', 'a@test', 'x'), (902, 'rules-b', 'b@test', 'x')").run();
  assert.deepEqual(rules.addTerminalCommandRule(901, "winget install --id A"), ["winget", "install"]);
  assert.equal(rules.addTerminalCommandRule(901, "python x.py"), null);
  assert.ok(rules.matchingTerminalCommandRule(901, "WINGET install --id B -e"));
  assert.equal(rules.matchingTerminalCommandRule(901, "winget uninstall --id B"), null);
  assert.equal(rules.matchingTerminalCommandRule(901, "winget install B | Out-File x"), null);
  assert.equal(rules.matchingTerminalCommandRule(902, "winget install --id B"), null);
  const [rule] = rules.listTerminalCommandRules(901);
  assert.ok(rules.removeTerminalCommandRule(901, rule.id));
  assert.equal(rules.matchingTerminalCommandRule(901, "winget install --id B"), null);
  assert.equal(commandMatchesPrefix("winget", ["winget", "install"]), false);
});

test("the pending command is taken once", () => {
  rules.rememberPendingTerminalCommand(77, "winget install x");
  assert.equal(rules.takePendingTerminalCommand(77), "winget install x");
  assert.equal(rules.takePendingTerminalCommand(77), null);
});
