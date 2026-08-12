import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const globals = read("src/app/globals.css");
// The navbar used to belong here for its invite dialog. Inviting moved to the
// profile page and stopped being a dialog at all, so the navbar no longer has
// a scrim to share.
const modalSources = [
  "src/app/components/learn-confirmation-dialog.tsx",
  "src/app/components/learn-error-dialog.tsx",
  "src/app/components/settings-dialog.tsx",
  "src/app/components/agents/browser-operator.tsx",
  "src/app/dashboard/dashboard-client.tsx",
  "src/app/garden/garden-assistant.tsx",
  "src/app/gardens/[clusterSlug]/workspace-client.tsx",
].map(read);
const learnErrorDialog = modalSources[1];
const profileClient = read("src/app/profile/profile-client.tsx");
const terminalSources = [
  "src/app/components/hermes/dashboard-agent-terminal.tsx",
  "src/app/components/knowledge-terminal.tsx",
].map(read);

test("custom dialogs share a crisp, unblurred Breadboard scrim", () => {
  assert.match(globals, /\.bb-modal-backdrop\s*\{/);
  assert.match(globals, /backdrop-filter:\s*none !important/);
  assert.match(globals, /\.bb-modal-panel\s*\{/);
  for (const source of modalSources) {
    assert.match(source, /bb-modal-backdrop/);
    assert.doesNotMatch(source, /backdrop-blur/);
  }
  assert.doesNotMatch(globals, /backdrop-filter:\s*blur\(/);
});

test("popup actions keep the original soft Breadboard button treatment", () => {
  assert.match(globals, /\.neu-button,[\s\S]*?box-shadow:\s*var\(--neu-soft-shadow\)/);
  assert.doesNotMatch(globals, /:is\(\.bb-modal-backdrop, \.neu-popover\) \.neu-button/);
  assert.doesNotMatch(globals, /\.bb-popup-action--(?:secondary|primary|destructive)/);
  assert.match(learnErrorDialog, /className="neu-button inline-flex/);
});

test("the invite panel uses the shared surface and action variants", () => {
  assert.match(profileClient, /neu-surface-raised rounded-2xl border/);
  assert.match(profileClient, /neu-button-primary/);
  assert.match(profileClient, /neu-button shrink-0/);
});

test("fixed terminals stay beneath modal backdrops", () => {
  for (const source of terminalSources) {
    assert.match(
      source,
      /fixed inset-x-0 bottom-0 z-40 flex flex-col/,
    );
    assert.doesNotMatch(
      source,
      /fixed inset-x-0 bottom-0 z-50 flex flex-col/,
    );
  }
  for (const source of modalSources) {
    assert.match(source, /bb-modal-backdrop fixed inset-0 z-(?:50|\[1[23]0\])/);
  }
});
