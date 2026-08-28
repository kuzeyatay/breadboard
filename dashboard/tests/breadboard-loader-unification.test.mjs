import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appRoot = new URL("../src/app/", import.meta.url);
const sharedLoader = fs.readFileSync(
  new URL("components/breadboard-loader.tsx", appRoot),
  "utf8",
);

const loadingSurfaces = [
  "dashboard/dashboard-client.tsx",
  "worldmonitor/worldmonitor-client.tsx",
  "gardens/[clusterSlug]/workspace-client.tsx",
  "gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx",
  "workflows/workflows-client.tsx",
  "workflows/components/canvas-editor.tsx",
  "components/assistant-composer.tsx",
  "components/assistant-message-actions.tsx",
  "components/speech-dictation-button.tsx",
  "components/garden-video-import.tsx",
  "components/hermes/dashboard-agent-terminal.tsx",
  "components/hermes/inline-artifact-cards.tsx",
  "components/hermes/inline-deep-research-run.tsx",
  "components/hermes/inline-spotify-player.tsx",
  "buzz/components/message-row.tsx",
  "buzz/components/rail-views.tsx",
  "buzz/ui/spinner.tsx",
];

test("the shared loader redraws the voice interface's wobbly circle", () => {
  assert.match(sharedLoader, /inkRingPath/);
  assert.match(sharedLoader, /scribbleRings/);
  assert.match(sharedLoader, /LOADER_SKETCH_RINGS = scribbleRings\(12, 12, 7\.45, 4\)/);
  assert.match(sharedLoader, /LOADER_SKETCH_RINGS\.map/);
  assert.match(sharedLoader, /bb-loader-sketch bb-loader-sketch-/);
  assert.match(sharedLoader, /pathLength=\{100\}/);
  assert.match(sharedLoader, /index \* -210/);
  assert.match(sharedLoader, /--bb-loader-sketch-delay/);
  assert.doesNotMatch(sharedLoader, /<circle|bb-loader-snake|bb-loader-rotor/);
});

test("the hand-drawn paths are traced rather than rotated as rigid rings", () => {
  const globalStyles = fs.readFileSync(new URL("globals.css", appRoot), "utf8");

  assert.match(globalStyles, /@keyframes bb-loader-trace/);
  assert.match(globalStyles, /stroke-dashoffset:\s*-100/);
  assert.doesNotMatch(globalStyles, /@keyframes bb-loader-turn/);
  assert.doesNotMatch(globalStyles, /\.bb-loader-sketch\s*\{[^}]*transform:/s);
});

test("circular loading states use BreadboardLoader instead of local spinning arcs", () => {
  for (const relativePath of loadingSurfaces) {
    const source = fs.readFileSync(new URL(relativePath, appRoot), "utf8");
    assert.match(source, /BreadboardLoader/, `${relativePath} should use the shared loader`);
    assert.doesNotMatch(source, /animate-spin|sprout-arc-spinner/, `${relativePath} still has a local spinner`);
  }

  const buzzTheme = fs.readFileSync(new URL("buzz/buzz-theme.css", appRoot), "utf8");
  assert.doesNotMatch(buzzTheme, /sprout-arc-spinner/);
});
