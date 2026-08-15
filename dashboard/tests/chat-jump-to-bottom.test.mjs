// Renders the chat jump control for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what its class strings would produce.
//
// The control's whole point is that it has two faces on one body: three dots
// while an answer is still being written, a chevron once it has landed. Both
// faces are always in the markup — the swap is a cross-fade — so the states are
// easy to break in a way that still renders something.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
  recursive: true,
});
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-jump-"),
);

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ChatJumpToBottom } from "@/app/components/chat-jump-to-bottom";\n`,
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatJumpToBottom } = require(bundle);

const render = (props) =>
  renderToStaticMarkup(React.createElement(ChatJumpToBottom, props));

/** The <svg> element, which carries the chevron's own transition classes. */
const chevronClasses = (markup) => {
  const match = markup.match(/<svg[^>]*class="([^"]*)"/);
  assert.ok(match, "expected the chevron svg to render");
  return match[1];
};

test("a working chat shows pulsing dots and hides the chevron", () => {
  const markup = render({ visible: true, busy: true, onJump: () => {} });

  assert.equal(markup.match(/bb-chat-jump-dot/g)?.length, 3);
  // Each dot is offset from the last so the three read as a wave.
  assert.match(markup, /animation-delay:0\.16s/);
  assert.match(markup, /animation-delay:0\.32s/);
  assert.match(chevronClasses(markup), /opacity-0/);
  assert.match(markup, /aria-label="Still responding — jump to the newest message"/);
});

test("a finished chat swaps the dots for a chevron that stays clickable", () => {
  const markup = render({ visible: true, busy: false, onJump: () => {} });

  // The dots stop animating rather than unmounting: the swap is a cross-fade.
  assert.doesNotMatch(markup, /bb-chat-jump-dot/);
  assert.match(chevronClasses(markup), /opacity-100/);
  assert.doesNotMatch(chevronClasses(markup), /opacity-0/);
  assert.match(markup, /aria-label="Jump to the newest message"/);
  assert.match(markup, /tabindex="0"/i);
  assert.match(markup, /pointer-events-auto/);
});

test("a reader already at the bottom gets an inert, invisible control", () => {
  const markup = render({ visible: false, busy: false, onJump: () => {} });

  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /tabindex="-1"/i);
  // Faded out and pushed down, so returning to view animates rather than pops.
  assert.match(markup, /opacity-0/);
  assert.match(markup, /translate-y-3/);
  assert.doesNotMatch(markup, /pointer-events-auto/);
});

test("every conversation transcript mounts the jump control on its own scroller", () => {
  const paths = [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
    "src/app/garden/garden-assistant.tsx",
    "src/app/components/knowledge-terminal.tsx",
  ];

  for (const relativePath of paths) {
    const text = source(`../${relativePath}`);
    assert.match(text, /ChatJumpToBottom/, relativePath);
    assert.match(text, /scrollToBottom: jumpToNewestMessage/, relativePath);
    assert.match(text, /onJump=\{jumpToNewestMessage\}/, relativePath);
    assert.match(text, /visible=\{transcriptAwayFromBottom\}/, relativePath);
    // Absolute positioning only lands at the foot of the transcript when the
    // wrapper — not the column that also holds the composer — is the context.
    assert.match(
      text,
      /className="relative flex min-h-0 (min-w-0 )?flex-1 flex-col"/,
      relativePath,
    );
  }
});

test("the hook reports distance from the bottom and offers a smooth way back", () => {
  const hook = source("../src/app/components/use-chat-auto-scroll.ts");

  assert.match(hook, /return \{ ref: containerRef, awayFromBottom, scrollToBottom \}/);
  assert.match(hook, /behavior: reduceMotion \? "auto" : "smooth"/);
  // A jump re-enters follow mode, or a click during a streaming answer would
  // land at the bottom and immediately be left behind again.
  assert.match(hook, /followingRef\.current = true;\s*\n\s*jumpingRef\.current = true;/);
  // The glide passes through "away" on every frame; those frames must not
  // flash the control back on under the reader's cursor.
  assert.match(hook, /if \(away && jumpingRef\.current\) return;/);
});
