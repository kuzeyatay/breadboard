import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dialog = source("../src/app/components/confirm-dialog.tsx");
const terminal = source(
  "../src/app/components/hermes/dashboard-agent-terminal.tsx",
);
const gardenChat = source("../src/app/components/hermes/garden-agent-chat.tsx");
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const css = source("../src/app/globals.css");

test("the confirmation sheet is a real dialog, not the shell's", () => {
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby="bb-confirm-title"/);
  assert.match(dialog, /aria-describedby="bb-confirm-body"/);
  // House modal material, so it carries the page's theme in light and dark.
  assert.match(dialog, /bb-modal-backdrop/);
  assert.match(dialog, /bb-modal-panel/);
  // Portalled, so a fixed or transformed host cannot clip it.
  assert.match(dialog, /createPortal\(/);
  assert.match(dialog, /document\.body,/);
});

test("it can be dismissed the three ways a dialog should be", () => {
  assert.match(dialog, /event\.key === "Escape"/);
  // Backdrop click, but only the backdrop itself.
  assert.match(dialog, /event\.target === event\.currentTarget\) onCancel\(\)/);
  assert.match(dialog, /\{cancelLabel\}/);
  // Focus starts on Cancel and is trapped in the panel while it is open.
  assert.match(dialog, /cancelRef\.current\?\.focus\(\)/);
  assert.match(dialog, /event\.key !== "Tab"/);
});

test("an unanswered question always settles", () => {
  // A second ask, and an unmount, both resolve the pending promise as false so
  // no caller is left awaiting forever.
  const hook = dialog.slice(dialog.indexOf("export function useConfirmDialog"));
  assert.match(hook, /resolveRef\.current\?\.\(false\);\n {4}return new Promise/);
  assert.match(hook, /\(\) => \(\) => \{\n {6}resolveRef\.current\?\.\(false\);/);
});

test("the sheet animates in, and holds still for reduced motion", () => {
  assert.match(css, /prefers-reduced-motion: no-preference\)\s*\{\s*\.bb-confirm-backdrop/);
  assert.match(css, /@keyframes bb-confirm-panel-in/);
});

test("deleting a chat asks in the app, on every surface that offers it", () => {
  for (const [name, text] of [
    ["dashboard terminal", terminal],
    ["garden chat", gardenChat],
    ["garden workspace rail", workspace],
  ]) {
    assert.ok(
      !/window\.confirm\(\s*`Delete /.test(text),
      `${name} still deletes chats behind window.confirm`,
    );
    assert.match(text, /useConfirmDialog\(\)/, `${name} does not use the sheet`);
    assert.match(text, /\{confirmDialog\}/, `${name} never renders the sheet`);
    assert.match(
      text,
      /title: "Delete this chat\?"/,
      `${name} lost the delete confirmation`,
    );
  }
});

test("the consequence is stated apart from the chat's own title", () => {
  // The title goes in `subject` so a long one cannot swallow the sentence that
  // says what is lost — the failure mode of a single-string confirm.
  for (const text of [terminal, gardenChat, workspace]) {
    assert.match(text, /subject: `“\$\{[a-zA-Z]+\.title\}”`/);
    assert.match(text, /body:\s*\n?\s*"?Anything it is still running is stopped/);
  }
});

test("bulk delete says how many chats it takes", () => {
  for (const text of [terminal, workspace]) {
    assert.match(text, /Delete \$\{(items|chats)\.length\} chats\?/);
    assert.match(text, /confirmLabel: single \? "Delete chat"/);
  }
});
