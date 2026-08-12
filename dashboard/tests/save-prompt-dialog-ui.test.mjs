import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const panel = source(
  "../src/app/components/hermes/agent-runtime-panel.tsx",
);
const dialog = source(
  "../src/app/components/hermes/save-prompt-dialog.tsx",
);
const client = source("../src/lib/hermes/prompt-save-client.ts");

test("user-message actions include Save to Prompts beside copy and edit", () => {
  const copy = panel.indexOf("copyUserMessage(");
  const save = panel.indexOf('title="Save to Prompts"');
  const edit = panel.indexOf('title="Edit message"');
  assert.ok(copy >= 0 && save > copy && edit > save);
  assert.match(panel, /aria-label="Save message to Prompts"/);
  assert.match(panel, /setPromptToSave\(message\.content\)/);
  assert.match(panel, /<SavePromptDialog/);
});

test("the save dialog is accessible and writes to the canonical Prompts catalog", () => {
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /Save this message as a reusable prompt in the Prompts tab/);
  assert.match(dialog, /suggestedPromptTitle\(content\)/);
  assert.match(dialog, /savePromptToCatalog/);
  assert.match(dialog, /Saved to Prompts\./);
  assert.match(client, /"\/api\/hermes\/prompts"/);
  assert.match(client, /method: "POST"/);
});
