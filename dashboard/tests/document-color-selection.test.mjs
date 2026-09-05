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

test("one color-button click toggles document chat selection", () => {
  assert.match(workspaceSource, /function handleDocumentColorButtonClick/);
  assert.match(workspaceSource, /window\.setTimeout\([\s\S]*?toggleSelectedDocument\(slug\)/);
  assert.match(workspaceSource, /handleDocumentColorButtonClick\(doc\.slug, isSource\)/);
  assert.match(workspaceSource, /Click once to select for chat/);
});

test("two color-button clicks open the document color palette", () => {
  assert.match(workspaceSource, /pendingTimer !== undefined[\s\S]*?setOpenFlagPaletteSlug/);
  assert.match(workspaceSource, /Double-click to choose a color/);
});

test("selected documents show a high-contrast checkmark instead of a selection ring", () => {
  assert.doesNotMatch(workspaceSource, /border-cyan-300 ring-2 ring-cyan-300\/80/);
  assert.match(workspaceSource, /\{isSelectedForChat \? \([\s\S]*?stroke="rgb\(3 7 18\)"[\s\S]*?stroke="white"/);
});

test("document rows mirror media dividers and botanical selection colors", () => {
  assert.match(
    workspaceSource,
    /border-b border-gray-800\/50 px-3 py-2 transition-colors last:border-b-0/,
  );
  assert.match(
    workspaceSource,
    /isSelectedForChat[\s\S]*?border-l-2 border-l-\[var\(--botanical\)\] bg-\[color-mix\(in_srgb,var\(--botanical\)_8%,transparent\)\]/,
  );
  assert.doesNotMatch(workspaceSource, /border-cyan-400\/60 bg-cyan-950\/10/);
  assert.doesNotMatch(workspaceSource, /text-cyan-100 hover:text-white font-medium/);
});
