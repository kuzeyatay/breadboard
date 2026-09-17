// The three chat-surface effects, rendered for real (esbuild -> CJS ->
// react-dom/server) rather than grepped for.
//
// What is worth pinning down is not that the libraries work — they have their
// own tests — but the promises this app makes about them:
//
//   * the orb appears beside a live status line and nowhere else, so a
//     finished turn does not sit under a frozen thought orb;
//   * the status-line orb is always `composing`, and only the volumetric orbs
//     are reachable through it; `breathing` is reserved for the loader;
//   * every send button still renders exactly the button it rendered before,
//     metal ring or not, disabled or not;
//   * the composer's beam is off until a turn is in flight.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  VOLUMETRIC_ORB_STATES,
  isVolumetricOrbState,
  orbStateForLabel,
} from "../src/app/components/effects/orb-state.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-effects-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  [
    `export { default as ThinkingOrb } from "@/app/components/effects/thinking-orb";`,
    `export { default as MetalSendButton } from "@/app/components/effects/metal-send-button";`,
    `export { default as ComposerBorderBeam, composerBeamPalette } from "@/app/components/effects/composer-border-beam";`,
    `export { default as AssistantResponseMeta } from "@/app/components/assistant-response-meta";`,
    `export { default as BreadboardLoader, BreadboardSketchLoader } from "@/app/components/breadboard-loader";`,
    "",
  ].join("\n"),
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
const {
  ThinkingOrb,
  MetalSendButton,
  ComposerBorderBeam,
  composerBeamPalette,
  AssistantResponseMeta,
  BreadboardLoader,
  BreadboardSketchLoader,
} = require(bundle);

function sendButton(extra = {}) {
  return React.createElement(
    "button",
    { type: "button", "aria-label": "Send", className: "neu-button-accent h-11 w-11", ...extra },
    "↑",
  );
}

test("only the volumetric orbs are reachable", () => {
  // `breathing` (a face-on ring) and `shaping` (a flat circle -> triangle ->
  // square outline) are the two flat states this app does not use.
  assert.deepEqual(
    [...VOLUMETRIC_ORB_STATES].sort(),
    ["composing", "connecting", "listening", "searching", "solving", "weaving", "working"],
  );
  assert.equal(isVolumetricOrbState("breathing"), false);
  assert.equal(isVolumetricOrbState("shaping"), false);
  for (const state of VOLUMETRIC_ORB_STATES) assert.equal(isVolumetricOrbState(state), true);
});

test("a status line picks the orb that matches what it says", () => {
  assert.equal(orbStateForLabel("Thinking"), "working");
  assert.equal(orbStateForLabel(undefined), "working");
  assert.equal(orbStateForLabel("Searching the web"), "searching");
  assert.equal(orbStateForLabel("Listening"), "listening");
  assert.equal(orbStateForLabel("Waiting for permission"), "connecting");
  assert.equal(orbStateForLabel("Writing the answer"), "composing");
  assert.equal(orbStateForLabel("Building the artifact"), "weaving");
  assert.equal(orbStateForLabel("Analysing the repository"), "solving");
  assert.equal(orbStateForLabel("Reading the PDF"), "solving");
  assert.equal(orbStateForLabel("Browsing github.com"), "searching");
  assert.equal(orbStateForLabel("Transcribing the recording"), "listening");
  // An unrecognised label still gets an orb rather than nothing.
  assert.equal(orbStateForLabel("Frobnicating"), "working");
});

test("the orb renders as a canvas and stays out of the accessibility tree", () => {
  const markup = renderToStaticMarkup(React.createElement(ThinkingOrb));

  assert.match(markup, /<canvas/);
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /role="presentation"/);
});

test("the status-line orb is always the composing sash", () => {
  // The user picked `composing` (2026-09-15) for every live status line, so
  // the label no longer chooses the orb.
  const orbSource = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "effects", "thinking-orb.tsx"),
    "utf8",
  );
  assert.match(orbSource, /state = "composing"/);
  assert.doesNotMatch(orbSource, /orbStateForLabel\(label\)/);

  const metaSource = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "assistant-response-meta.tsx"),
    "utf8",
  );
  assert.match(metaSource, /<ThinkingOrb state="composing"/);
});

test("the generic loader is the breathing orb, with the sketch rings kept", () => {
  const markup = renderToStaticMarkup(
    React.createElement(BreadboardLoader, { className: "h-4 w-4", label: "Loading" }),
  );
  assert.match(markup, /<span[^>]*role="status"[^>]*aria-label="Loading"[^>]*class="bb-loader bb-loader-orb h-4 w-4"/);
  assert.match(markup, /<canvas[^>]*aria-hidden="true"/);
  assert.doesNotMatch(markup, /<svg/);

  const loaderSource = fs.readFileSync(
    path.join(dashboardRoot, "src", "app", "components", "breadboard-loader.tsx"),
    "utf8",
  );
  assert.match(loaderSource, /state="breathing"/);
  // The hand-drawn mark still exists under its own name.
  assert.match(loaderSource, /export function BreadboardSketchLoader/);
  const sketch = renderToStaticMarkup(React.createElement(BreadboardSketchLoader, {}));
  assert.match(sketch, /<svg[^>]*class="bb-loader h-3\.5 w-3\.5"/);
  assert.match(sketch, /bb-loader-sketch-4/);
});

test("a live response meta shows the orb; a finished one does not", () => {
  const live = renderToStaticMarkup(
    React.createElement(AssistantResponseMeta, { active: true, label: "Thinking" }),
  );
  const done = renderToStaticMarkup(
    React.createElement(AssistantResponseMeta, { active: false, label: "Thinking" }),
  );

  assert.match(live, /<canvas/);
  assert.match(live, /Thinking/);
  // The finished row still says what it did, with no orb above it.
  assert.doesNotMatch(done, /<canvas/);
  assert.match(done, /Thought/);
});

test("a send button renders unchanged inside the metal wrapper", () => {
  const markup = renderToStaticMarkup(
    React.createElement(MetalSendButton, { variant: "circle", className: "shrink-0" }, sendButton()),
  );

  assert.match(markup, /aria-label="Send"/);
  assert.match(markup, /neu-button-accent h-11 w-11/);
  assert.match(markup, /shrink-0/);
});

test("a disabled button keeps its metal and its wrapper", () => {
  const wrapper = (disabled) =>
    renderToStaticMarkup(
      React.createElement(
        MetalSendButton,
        { variant: "circle", className: "shrink-0", disabled },
        sendButton(disabled ? { disabled: true } : {}),
      ),
    );

  const off = wrapper(true);
  const on = wrapper(false);
  assert.match(off, /aria-label="Send"/);
  assert.match(off, /disabled=""/);
  // An empty composer is the state most people see the send button in, so
  // the ring stays; only the disc colour and pacing change, both in CSS.
  assert.match(off, /bb-metal-send/);
  // Same wrapper element either way: a different one would remount the
  // button every time the draft empties.
  const tagName = (markup) => /^<([a-z]+)/.exec(markup)[1];
  assert.equal(tagName(off), tagName(on));
});

test("the composer beam overlays its composer and follows `active`", () => {
  const composer = React.createElement(
    "div",
    { className: "neu-composer relative rounded-[30px] p-2" },
    React.createElement("div", { className: "slash-menu" }, "popover"),
    "draft",
  );
  const idle = renderToStaticMarkup(
    React.createElement(ComposerBorderBeam, { active: false }, composer),
  );
  const running = renderToStaticMarkup(
    React.createElement(ComposerBorderBeam, { active: true }, composer),
  );

  for (const markup of [idle, running]) {
    assert.match(markup, /neu-composer relative rounded-\[30px\] p-2/);
    assert.match(markup, /draft/);
    // The composer's own subtree — popovers included — must not end up inside
    // the beam's clipped box. The beam opens after the composer closes.
    const composerEnd = markup.indexOf("draft");
    assert.ok(composerEnd > 0);
    assert.ok(
      markup.indexOf("slash-menu") < composerEnd,
      "the popover left the composer's subtree",
    );
    assert.ok(
      markup.indexOf("data-beam") > composerEnd,
      "the beam must overlay the composer, not contain it",
    );
  }
  // The two states must actually differ, or `active` is not wired to anything.
  assert.notEqual(idle, running);
});

test("the beam is warm on paper and cool in the dark", () => {
  assert.equal(composerBeamPalette("light"), "sunset");
  assert.equal(composerBeamPalette("dark"), "ocean");
  // Unresolved (server, first client frame): the light palette stands in.
  assert.equal(composerBeamPalette(null), "sunset");
});
