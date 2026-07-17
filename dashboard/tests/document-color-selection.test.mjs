import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workspaceSource = fs.readFileSync(
  new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
  "utf8",
);

test("Documents list has no separate chat-selection checkbox", () => {
  assert.doesNotMatch(workspaceSource, /aria-label="Select document for chat"/);
  assert.doesNotMatch(workspaceSource, /onChange=\{\(\) => toggleSelectedDocument\(doc\.slug\)\}/);
});

test("two color-button clicks toggle document chat selection", () => {
  assert.match(workspaceSource, /function handleDocumentColorButtonClick/);
  assert.match(workspaceSource, /pendingTimer !== undefined[\s\S]*?toggleSelectedDocument\(slug\)/);
  assert.match(workspaceSource, /handleDocumentColorButtonClick\(doc\.slug, isSource\)/);
  assert.match(workspaceSource, /Click twice to select for chat/);
  assert.match(workspaceSource, /border-cyan-300 ring-2 ring-cyan-300\/80/);
});

test("one color-button click still opens the color palette", () => {
  assert.match(workspaceSource, /window\.setTimeout\([\s\S]*?setOpenFlagPaletteSlug/);
  assert.match(workspaceSource, /Click once to choose a color/);
});
