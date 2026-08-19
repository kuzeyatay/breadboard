// A row that changes height *after* it was measured, mounted in a real DOM.
//
// This is the half of measurement the library gives up on. Its ResizeObserver
// follows a row as it grows, but refuses the correction while a smooth scroll
// is in flight and the row sits outside a band around the one being travelled
// to — and never retries it, because a row reports its height again only when
// it resizes again, which a finished answer never does. Landing on a
// conversation is a smooth glide over exactly those rows, and markdown reflows
// under them: a table settles its column widths, a font arrives late. The
// transcript then came to rest holding a height for content that had since
// grown, and every row below it was laid out on top of it — messages drawn
// inside each other.
//
// jsdom performs no layout and ships no ResizeObserver, so both are supplied
// here: a row is as tall as `realHeights` says, and the observer is fired by
// hand. Everything else — the virtualizer, its size cache, its anchoring — is
// the real one.

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

/** jsdom arrives with the Hermes agent, so a partial checkout skips instead. */
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

const VIEWPORT = 600;
const ESTIMATE = 100;
const GAP = 20;
const COUNT = 12;
const realHeights = new Map();

/** Every element the component asked to observe, so the test can fire them. */
const observers = new Set();

let VirtualizedMessageList;
let dom;
let outDirectory;

before(async () => {
  if (skip) return;
  fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
    recursive: true,
  });
  outDirectory = fs.mkdtempSync(
    path.join(dashboardRoot, "node_modules", ".cache", "chat-virtual-remeasure-"),
  );
  const entry = path.join(outDirectory, "entry.jsx");
  fs.writeFileSync(
    entry,
    'export { default as VirtualizedMessageList } from "@/app/components/chat/virtualized-message-list";\n',
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

  dom = new jsdom.JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });

  // The observer the component reaches for. Recorded rather than driven by
  // layout, because jsdom has none to report.
  class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.add(this);
    }
    observe(target) {
      this.targets.add(target);
    }
    unobserve(target) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  dom.window.ResizeObserver = TestResizeObserver;

  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "Event",
    "ResizeObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ]) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (typeof this.__height === "number") return this.__height;
      const index = this.getAttribute("data-index");
      if (index === null) return 0;
      return realHeights.get(Number(index)) ?? ESTIMATE;
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 900;
    },
  });

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ VirtualizedMessageList } = require(path.join(outDirectory, "bundle.cjs")));
});

after(() => {
  if (outDirectory) fs.rmSync(outDirectory, { recursive: true, force: true });
});

function makeScroller() {
  const scroller = dom.window.document.createElement("div");
  scroller.__height = VIEWPORT;
  let scrollTop = 0;
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (value) => {
      scrollTop = Math.max(0, value);
    },
  });
  scroller.scrollTo = ({ top }) => {
    scrollTop = Math.max(0, top ?? 0);
  };
  dom.window.document.body.appendChild(scroller);
  return scroller;
}

const inertBridge = () => ({
  programmaticRef: { current: false },
  activeRef: { current: true },
  scrollToEnd() {},
  scrollToIndex() {},
  attach() {},
});

const measured = async (act) => {
  await act(async () => {
    await null;
  });
};

/** Lets the deferred sweep take its frame, inside the test's own act scope. */
const swept = async (act) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
};

const laidOutHeight = (scroller) =>
  Number.parseFloat(
    scroller.querySelector("[data-chat-virtual-list]").style.height,
  );

/**
 * Fires every observer the component registered, the way a reflow would, and
 * lets the sweep it schedules take its frame. Both halves belong inside `act`:
 * the correction lands from a frame callback, so React would otherwise report
 * the re-render as an update escaping the test.
 */
const reportResize = async (act) => {
  await act(async () => {
    for (const observer of observers) {
      const entries = [...observer.targets].map((target) => ({ target }));
      if (entries.length > 0) observer.callback(entries, observer);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
};

test(
  "a row that grows after it was measured is corrected, not left under the rows below it",
  { skip },
  async () => {
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    observers.clear();
    const scroller = makeScroller();
    const items = Array.from({ length: COUNT }, (_, index) => ({
      key: `m${index}`,
    }));

    const root = createRoot(scroller);
    await act(async () => {
      root.render(
        React.createElement(VirtualizedMessageList, {
          surface: "hermes-chat",
          items,
          scrollRef: { current: scroller },
          bridge: inertBridge(),
          gap: GAP,
          resetKey: "conversation-a",
          getItemKey: (item) => item.key,
          estimateSize: () => ESTIMATE,
          renderItem: (item) => React.createElement("div", null, item.key),
        }),
      );
    });
    await measured(act);
    await swept(act);

    const settled = laidOutHeight(scroller);
    assert.equal(settled, COUNT * ESTIMATE + (COUNT - 1) * GAP);

    const rowStart = (index) => {
      const row = scroller.querySelector(`[data-index="${index}"]`);
      return Number.parseFloat(
        /translateY\((-?[\d.]+)px\)/.exec(row.style.transform)[1],
      );
    };
    const before = rowStart(3);

    // The reflow. No React render and no new row: the same mounted node is
    // simply taller than it was when it was measured, which is all a markdown
    // table settling its columns actually is.
    realHeights.set(2, 380);
    await reportResize(act);

    assert.equal(
      laidOutHeight(scroller),
      settled + 280,
      "the row's new height was never taken",
    );
    assert.equal(
      rowStart(3),
      before + 280,
      "the row below was still laid out on top of the grown one",
    );

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);

test(
  "a row whose height has not changed is not resized on every reflow",
  { skip },
  async () => {
    // The sweep runs on every resize report, including the one the observer
    // fires the moment a row is observed. Rows that already agree with the DOM
    // must fall straight through it, or a streaming answer would re-anchor the
    // scroller on every frame.
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    observers.clear();
    const scroller = makeScroller();
    const items = Array.from({ length: COUNT }, (_, index) => ({
      key: `m${index}`,
    }));

    const root = createRoot(scroller);
    await act(async () => {
      root.render(
        React.createElement(VirtualizedMessageList, {
          surface: "hermes-chat",
          items,
          scrollRef: { current: scroller },
          bridge: inertBridge(),
          gap: GAP,
          resetKey: "conversation-b",
          getItemKey: (item) => item.key,
          estimateSize: () => ESTIMATE,
          renderItem: (item) => React.createElement("div", null, item.key),
        }),
      );
    });
    await measured(act);
    await swept(act);

    const settled = laidOutHeight(scroller);
    const restingScrollTop = scroller.scrollTop;

    await reportResize(act);
    await reportResize(act);

    assert.equal(laidOutHeight(scroller), settled);
    assert.equal(scroller.scrollTop, restingScrollTop);

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);

test(
  "a row that mounts empty is laid out on its estimate, then corrected when its content arrives",
  { skip },
  async () => {
    // The seed of the overlapping-messages bug. A markdown-heavy answer mounts
    // as an empty shell — its content still hydrating — and its first
    // measurement records that emptiness. Every row below is then laid out on
    // top of it, and nothing ever takes the zero back. The fix has two halves:
    // an empty mount is never recorded (the estimate stands), and the sweep
    // takes the row's first real height when the content lands.
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    observers.clear();
    const scroller = makeScroller();
    const items = Array.from({ length: COUNT }, (_, index) => ({
      key: `m${index}`,
    }));

    // The answer whose markdown has not hydrated yet.
    realHeights.set(4, 0);

    const root = createRoot(scroller);
    await act(async () => {
      root.render(
        React.createElement(VirtualizedMessageList, {
          surface: "hermes-chat",
          items,
          scrollRef: { current: scroller },
          bridge: inertBridge(),
          gap: GAP,
          resetKey: "conversation-c",
          getItemKey: (item) => item.key,
          estimateSize: () => ESTIMATE,
          renderItem: (item) => React.createElement("div", null, item.key),
        }),
      );
    });
    await measured(act);
    await swept(act);

    // The emptiness was never recorded: the row stands at its estimate, and
    // nothing below it has collapsed onto it.
    const settled = laidOutHeight(scroller);
    assert.equal(settled, COUNT * ESTIMATE + (COUNT - 1) * GAP);

    // The markdown arrives, well past the estimate.
    realHeights.set(4, 340);
    await reportResize(act);

    assert.equal(
      laidOutHeight(scroller),
      settled + 240,
      "the hydrated row's first real height was never taken",
    );

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);
