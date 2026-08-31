import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { artifactUsesVisualHtmlEditor } from "../src/lib/hermes/artifact-editor-types.ts";

const ready = {
  status: "ready",
  metadata: {},
};

test("Vvveb is selected only for source-backed HTML documents", () => {
  assert.equal(artifactUsesVisualHtmlEditor({
    ...ready,
    kind: "html",
    renderer: "html",
    mimeType: "text/html; charset=utf-8",
  }), true);
  assert.equal(artifactUsesVisualHtmlEditor({
    ...ready,
    kind: "presentation",
    renderer: "presentation-html",
    mimeType: "text/html; charset=utf-8",
  }), true);
  assert.equal(artifactUsesVisualHtmlEditor({
    ...ready,
    kind: "markdown",
    renderer: "markdown",
    mimeType: "text/markdown; charset=utf-8",
  }), false);
  assert.equal(artifactUsesVisualHtmlEditor({
    ...ready,
    kind: "html",
    renderer: "interactive-visualizer",
    mimeType: "text/html; charset=utf-8",
  }), false);
});

test("artifact viewer mounts the visual editor and expands its working canvas", () => {
  const viewer = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/hermes/artifact-viewer.tsx"),
    "utf8",
  );
  const host = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/hermes/artifact-vvveb-editor.tsx"),
    "utf8",
  );

  assert.match(viewer, /artifactUsesVisualHtmlEditor/);
  assert.match(viewer, /<ArtifactVvvebEditor/);
  assert.match(viewer, /usesGenOfficeEditor \|\| usesVvvebEditor/);
  assert.match(host, /AUTOSAVE_DELAY_MS = 1_200/);
  assert.match(host, /expectedVersion: latestArtifact\.version/);
  assert.match(host, /keepalive: true/);
  assert.match(host, /event\.origin !== window\.location\.origin/);
  assert.match(host, /Saved automatically/);
});

test("vendored Vvveb page uses an inert inner canvas and the Breadboard bridge", () => {
  const publicRoot = path.resolve(process.cwd(), "public/vvveb-editor");
  const editor = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const bridge = fs.readFileSync(path.join(publicRoot, "breadboard-bridge.js"), "utf8");
  const breadboardStyles = fs.readFileSync(path.join(publicRoot, "breadboard-editor.css"), "utf8");
  const builder = fs.readFileSync(path.join(publicRoot, "libs/builder/builder.js"), "utf8");
  const bridgeSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/vendor/vvveb/breadboard-bridge.js"),
    "utf8",
  );

  assert.match(editor, /breadboard-bridge\.js/);
  assert.doesNotMatch(editor, /img\/logo\.png/);
  assert.doesNotMatch(editor, /<div class="logo">/);
  assert.match(editor, /id="iframe1" sandbox="allow-same-origin"/);
  assert.doesNotMatch(editor, /id="iframe1"[^>]*allow-scripts/);
  assert.doesNotMatch(editor, /let defaultPages/);
  assert.doesNotMatch(editor, /plugin-ai-assistant\.js/);
  assert.doesNotMatch(editor, /plugin-media\.js/);
  assert.match(bridge, /cloneNode\(true\)/);
  assert.match(bridge, /MutationObserver/);
  assert.match(bridge, /breadboard:vvveb-change/);
  assert.match(bridge, /data-vvveb-svg-text-editor/);
  assert.match(bridge, /pointer-events: all !important/);
  assert.match(bridge, /enableElementResizing/);
  assert.match(bridge, /breadboard-resize-svg/);
  assert.match(breadboardStyles, /breadboard-resize-html/);
  assert.match(breadboardStyles, /touch-action: none/);
  assert.match(bridge, /event\.origin !== parentOrigin/);
  assert.doesNotMatch(bridge, /Builder\.getHtml/);
  assert.equal(bridge, bridgeSource);
  assert.match(builder, /target\.getBoundingClientRect\(\)\.width/);
  assert.equal(fs.existsSync(path.join(publicRoot, "LICENSE")), true);
  assert.equal(fs.existsSync(path.join(publicRoot, "libs/builder/builder.js")), true);
});
