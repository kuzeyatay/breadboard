import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BREAD_EXTENSION_ID, BREAD_EXTENSION_VERSION, installBreadExtension } from "../src/main/vscode-bread";
import { withVSCodeTheme } from "../src/main/vscode-profile";

test("Bread registers once beside the user's extensions and hides Copilot chat once", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-bread-ext-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const other = { identifier: { id: "anthropic.claude-code" }, version: "1.0.0", relativeLocation: "anthropic.claude-code-1.0.0" };
  fs.writeFileSync(path.join(dir, "extensions.json"), JSON.stringify([other, { identifier: { id: BREAD_EXTENSION_ID }, relativeLocation: "breadboard.bread-0.0.1" }]));
  installBreadExtension(dir);
  installBreadExtension(dir);
  const entries = JSON.parse(fs.readFileSync(path.join(dir, "extensions.json"), "utf8"));
  assert.deepEqual(entries.map((entry: { identifier: { id: string } }) => entry.identifier.id), ["anthropic.claude-code", BREAD_EXTENSION_ID]);
  assert.equal(entries[1].relativeLocation, `${BREAD_EXTENSION_ID}-${BREAD_EXTENSION_VERSION}`);
  assert.ok(fs.existsSync(path.join(dir, entries[1].relativeLocation, "extension.js")));
  assert.match(withVSCodeTheme("{}", "light"), /"chat\.disableAIFeatures": true/);
  assert.doesNotMatch(withVSCodeTheme('{"chat.disableAIFeatures": false}', "light"), /"chat\.disableAIFeatures": true/);
});
