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

test("the shared loader traces several hand-drawn passes over one stationary circle", () => {
  assert.match(sharedLoader, /inkRingPath/);
  assert.doesNotMatch(sharedLoader, /scribbleRings/);
  assert.equal((sharedLoader.match(/inkRingPath\(/g) ?? []).length, 4);
  assert.match(sharedLoader, /LOADER_SKETCH_RINGS\.map/);
  assert.match(sharedLoader, /bb-loader-sketch bb-loader-sketch-/);
  assert.match(sharedLoader, /<circle[\s\S]*className="bb-loader-settled"/);
  assert.match(sharedLoader, /pathLength=\{1\}/);
  assert.match(sharedLoader, /index \* -705/);
  assert.match(sharedLoader, /--bb-loader-sketch-delay/);
  assert.doesNotMatch(sharedLoader, /bb-loader-snake|bb-loader-rotor/);
});

test("the whole hand-drawn paths draw, hold, and lift without rotating", () => {
  const globalStyles = fs.readFileSync(new URL("globals.css", appRoot), "utf8");
  const loaderStyles = globalStyles.slice(0, globalStyles.indexOf(":root"));

  assert.match(loaderStyles, /\.bb-loader-sketch \{[\s\S]*?stroke-dasharray:\s*1;/);
  assert.match(loaderStyles, /@keyframes bb-loader-trace/);
  assert.match(
    loaderStyles,
    /@keyframes bb-loader-trace \{[\s\S]*?stroke-dashoffset:\s*1;[\s\S]*?stroke-dashoffset:\s*0;/,
  );
  assert.doesNotMatch(loaderStyles, /stroke-dashoffset:\s*-100/);
  assert.doesNotMatch(loaderStyles, /@keyframes bb-loader-turn/);
  assert.doesNotMatch(loaderStyles, /\.bb-loader(?:-sketch)?\s*\{[^}]*transform:/s);
  assert.doesNotMatch(loaderStyles, /rotate\(/);
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
