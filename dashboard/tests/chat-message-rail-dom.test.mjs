// The message rail, mounted in a real DOM and actually scrolled.
//
// This exists because three rounds of string-grep and pure-function tests all
// passed while the rail was visibly broken in the app. The bug they could not
// see: the rail is handed a *ref*, not an element, and the transcript under it
// is torn down and rebuilt every time the terminal is closed and reopened. A
// scroll listener bound to that element at mount is then sitting on a detached
// node, so the highlight stays frozen wherever it last stood.
//
// jsdom performs no layout, so every rect here is stubbed from an explicit
// content-offset model. The geometry is asserted against that model, not
// against a browser.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const require = module.createRequire(import.meta.url);

/**
 * jsdom is not a dashboard dependency; it arrives with the Hermes agent. Where
 * it is missing this file skips rather than fails, so a partial checkout still
 * runs a green suite.
 */
function loadJsdom() {
  try {
    return require(
      require.resolve("jsdom", { paths: [path.join(repoRoot, "hermes-agent")] }),
    );
  } catch {
    return null;
  }
}

const jsdom = loadJsdom();
const skip = jsdom ? false : "jsdom is not installed in this checkout";

let R;
let dom;
let outDirectory;

before(async () => {
  if (skip) return;
  outDirectory = fs.mkdtempSync(
    path.join(dashboardRoot, "node_modules", ".cache", "rail-dom-"),
  );
  const entry = path.join(outDirectory, "entry.jsx");
  fs.writeFileSync(
    entry,
    'export { default as R } from "@/app/components/chat-message-rail";\n',
  );
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: path.join(outDirectory, "bundle.cjs"),
    format: "cjs",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    loader: { ".ts": "ts", ".tsx": "tsx" },
    alias: { "@": path.join(dashboardRoot, "src") },
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    logLevel: "silent",
  });

  dom = new jsdom.JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { pretendToBeVisual: true, url: "http://localhost/" },
  );
  const globals = [
    "window", "document", "navigator", "HTMLElement", "Node", "Element",
    "Event", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle",
  ];
  for (const key of globals) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  globalThis.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  ({ R } = require(path.join(outDirectory, "bundle.cjs")));
});

after(() => {
  if (outDirectory) fs.rmSync(outDirectory, { recursive: true, force: true });
});

// A transcript whose first answer is 6,000px tall — the shape that makes this
// worth getting right, since the reader spends most of their time inside it.
const SIZES = [60, 6_000, 60, 900, 60, 900];
/** The transcript's own `py-5`: the list starts below the top of the scroller. */
const LIST_OFFSET = 20;
const VIEWPORT = 600;
const rowStart = (index) =>
  LIST_OFFSET +
  SIZES.slice(0, index).reduce((total, size) => total + size + 20, 0);
const TOTAL = rowStart(SIZES.length - 1) + SIZES[SIZES.length - 1];

const ITEMS = [
  { rowIndex: 0, label: "first question" },
  { rowIndex: 2, label: "second question" },
  { rowIndex: 4, label: "third question" },
];

const BRIDGE = {
  programmaticRef: { current: false },
  activeRef: { current: true },
  scrollToEnd() {},
  scrollToIndex() {},
  // Virtualizer coordinates: counted from the list container, and saturating at
  // the furthest the scroller can travel, exactly like `getOffsetForIndex`.
  getRowStart: (index) =>
    Math.min(rowStart(index) - LIST_OFFSET, TOTAL - VIEWPORT),
  attach() {},
};

/** A fresh transcript scroller, the way reopening the terminal builds one. */
function makeScroller(state) {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "clientHeight", { value: VIEWPORT });
  Object.defineProperty(scroller, "scrollHeight", { value: TOTAL });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => state.scrollTop,
    set: (value) => {
      state.scrollTop = value;
    },
  });
  scroller.getBoundingClientRect = () => ({
    top: 0, height: VIEWPORT, bottom: VIEWPORT, left: 0, right: 900, width: 900,
  });

  const list = document.createElement("div");
  list.setAttribute("data-chat-virtual-list", "hermes-chat");
  list.getBoundingClientRect = () => ({
    top: LIST_OFFSET - state.scrollTop, height: TOTAL, bottom: 0,
    left: 0, right: 900, width: 900,
  });
  scroller.appendChild(list);
  document.body.appendChild(scroller);

  // Only the rows around the fold are in the DOM, as the virtualizer keeps them.
  scroller.mountRows = () => {
    list.replaceChildren();
    SIZES.forEach((size, index) => {
      const start = rowStart(index);
      if (start + size < state.scrollTop - VIEWPORT) return;
      if (start > state.scrollTop + VIEWPORT * 2) return;
      const row = document.createElement("div");
      row.setAttribute("data-index", String(index));
      row.getBoundingClientRect = () => ({
        top: start - state.scrollTop, height: size, bottom: 0,
        left: 0, right: 900, width: 900,
      });
      list.appendChild(row);
    });
  };
  scroller.mountRows();
  return scroller;
}

const litTick = () =>
  Number(
    document
      .querySelector("[data-chat-message-rail]")
      ?.getAttribute("data-active-tick"),
  );

async function scrollTo(scroller, state, top) {
  const { act } = require("react");
  await act(async () => {
    state.scrollTop = top;
    scroller.mountRows();
    scroller.dispatchEvent(new dom.window.Event("scroll"));
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  });
}

test("the highlight follows the reader through a very long answer", { skip }, async () => {
  const React = require("react");
  const { act } = require("react");
  const { createRoot } = require("react-dom/client");

  const state = { scrollTop: 0 };
  const scroller = makeScroller(state);
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(
      React.createElement(R, {
        items: ITEMS,
        scrollRef: { current: scroller },
        bridge: BRIDGE,
        surface: "t",
      }),
    );
  });

  assert.equal(litTick(), 0, "opens on the first question");
  await scrollTo(scroller, state, 3_000);
  assert.equal(litTick(), 0, "still nearer the first question early in its answer");
  await scrollTo(scroller, state, 3_200);
  assert.equal(litTick(), 1, "hands over around the answer's midpoint");
  await scrollTo(scroller, state, 7_000);
  assert.equal(litTick(), 2);

  await act(async () => {
    root.unmount();
  });
  scroller.remove();
});

test("closing and reopening the terminal does not strand the rail", { skip }, async () => {
  // The regression. The transcript is rebuilt underneath a rail that stays
  // mounted and whose props have not changed, so nothing React can see has
  // moved. A listener bound to the old element hears nothing from the new one,
  // and the highlight stays frozen wherever it last stood.
  const React = require("react");
  const { act } = require("react");
  const { createRoot } = require("react-dom/client");

  const scrollRef = { current: null };
  const openState = { scrollTop: 0 };
  const opened = makeScroller(openState);
  scrollRef.current = opened;

  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(
      React.createElement(R, {
        items: ITEMS, scrollRef, bridge: BRIDGE, surface: "t",
      }),
    );
  });
  await scrollTo(opened, openState, 7_000);
  assert.equal(litTick(), 2, "tracking works before the terminal is closed");

  // Close, then reopen: a brand-new scroller, handed over without a re-render.
  opened.remove();
  const reopenState = { scrollTop: 0 };
  const reopened = makeScroller(reopenState);
  scrollRef.current = reopened;

  await scrollTo(reopened, reopenState, 0);
  assert.equal(litTick(), 0, "the reopened transcript is measured, not the dead one");
  await scrollTo(reopened, reopenState, 7_000);
  assert.equal(litTick(), 2, "and it keeps tracking");

  await act(async () => {
    root.unmount();
  });
  reopened.remove();
});

test("at the bottom, two close questions light the newer one", { skip }, async () => {
  // The reported case: a short exchange under a very long one. Both questions
  // are on screen at the bottom and the older sits nearer the top of the
  // viewport, so measuring from the top would light the wrong one.
  const React = require("react");
  const { act } = require("react");
  const { createRoot } = require("react-dom/client");

  const sizes = [60, 6_000, 60, 100, 60, 100];
  const start = (index) =>
    LIST_OFFSET + sizes.slice(0, index).reduce((total, size) => total + size + 20, 0);
  const total = start(sizes.length - 1) + sizes[sizes.length - 1];
  const state = { scrollTop: 0 };

  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "clientHeight", { value: VIEWPORT });
  Object.defineProperty(scroller, "scrollHeight", { value: total });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => state.scrollTop,
    set: (value) => { state.scrollTop = value; },
  });
  scroller.getBoundingClientRect = () => ({
    top: 0, height: VIEWPORT, bottom: VIEWPORT, left: 0, right: 900, width: 900,
  });
  const list = document.createElement("div");
  list.setAttribute("data-chat-virtual-list", "hermes-chat");
  list.getBoundingClientRect = () => ({
    top: LIST_OFFSET - state.scrollTop, height: total, bottom: 0,
    left: 0, right: 900, width: 900,
  });
  scroller.appendChild(list);
  document.body.appendChild(scroller);
  scroller.mountRows = () => {
    list.replaceChildren();
    sizes.forEach((size, index) => {
      const at = start(index);
      if (at + size < state.scrollTop - VIEWPORT) return;
      if (at > state.scrollTop + VIEWPORT * 2) return;
      const row = document.createElement("div");
      row.setAttribute("data-index", String(index));
      row.getBoundingClientRect = () => ({
        top: at - state.scrollTop, height: size, bottom: 0,
        left: 0, right: 900, width: 900,
      });
      list.appendChild(row);
    });
  };
  scroller.mountRows();

  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(
      React.createElement(R, {
        items: ITEMS,
        scrollRef: { current: scroller },
        bridge: {
          ...BRIDGE,
          getRowStart: (i) => Math.min(start(i) - LIST_OFFSET, total - VIEWPORT),
        },
        surface: "t",
      }),
    );
  });

  await scrollTo(scroller, state, total - VIEWPORT);
  assert.equal(litTick(), 2, "the newest question is lit at the foot of the transcript");

  await act(async () => { root.unmount(); });
  scroller.remove();
});
