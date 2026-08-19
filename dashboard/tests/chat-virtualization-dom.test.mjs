// The shared transcript list, mounted in a real DOM and measured for real.
//
// This exists because the whole virtualization suite stayed green while the
// terminal logged a React error on every message sent. What none of it could
// see: a row is measured from its ref callback, which React runs inside the
// commit. On a transcript anchored to its end that measurement also moves the
// scroller, and the virtualizer reports the move with a synchronous flush —
// which React refuses to perform from inside a commit, and says so:
//
//   flushSync was called from inside a lifecycle method. React cannot flush
//   when React is already rendering.
//
// jsdom performs no layout, so a row's height is stubbed from `data-index` and
// the scroller's from an explicit viewport. Every other part of the path — the
// virtualizer, its anchoring, its scroll writes — is the real one.

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
const COUNT = 20;
/** What a row turns out to be, once measured. Estimate-shaped until it isn't. */
const realHeights = new Map();

let VirtualizedMessageList;
let dom;
let outDirectory;

before(async () => {
  if (skip) return;
  fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
    recursive: true,
  });
  outDirectory = fs.mkdtempSync(
    path.join(dashboardRoot, "node_modules", ".cache", "chat-virtual-dom-"),
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
  for (const key of [
    "window", "document", "navigator", "HTMLElement", "Node", "Element",
    "Event", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle",
  ]) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }

  // The only layout jsdom is given: a row is as tall as its index says, and
  // anything told its own height (the scroller) reports that. The virtualizer
  // reads both through `offsetHeight`.
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

/** The transcript scroller the surfaces own and pass in by ref. */
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

/**
 * Rows are measured one microtask after the commit that mounted them, which in
 * a browser is still inside the frame that is about to be painted. Here it is
 * one more turn of the queue, taken inside `act` so the re-render it causes
 * belongs to the test.
 */
const measured = async (act) => {
  await act(async () => {
    await null;
  });
};

/** The list's own claim about how tall the conversation is. */
const laidOutHeight = (scroller) =>
  Number.parseFloat(
    scroller.querySelector("[data-chat-virtual-list]").style.height,
  );

test(
  "a row measured while the reader is pinned to the end does not flush from inside the commit",
  { skip },
  async () => {
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    const scroller = makeScroller();
    const scrollRef = { current: scroller };
    const bridge = inertBridge();

    // The message that is being sent: drawn from the composer under a client id,
    // then handed the id it was persisted under, mid-turn. Same row, new key,
    // so React rebuilds the node and the virtualizer measures it again.
    const conversation = (lastKey) =>
      Array.from({ length: COUNT }, (_, index) => ({
        key: index === COUNT - 1 ? lastKey : `m${index}`,
      }));

    const draw = (items) =>
      React.createElement(VirtualizedMessageList, {
        surface: "hermes-chat",
        items,
        scrollRef,
        bridge,
        gap: GAP,
        resetKey: "conversation-a",
        getItemKey: (item) => item.key,
        estimateSize: () => ESTIMATE,
        renderItem: (item) => React.createElement("div", null, item.key),
      });

    const root = createRoot(scroller);
    await act(async () => {
      root.render(draw(conversation("id:draft-7")));
    });
    await measured(act);

    // Where a chat sits: at the foot of the conversation, following the answer.
    const settled = laidOutHeight(scroller);
    assert.equal(settled, COUNT * ESTIMATE + (COUNT - 1) * GAP);
    await act(async () => {
      scroller.scrollTop = settled - VIEWPORT;
      scroller.dispatchEvent(new dom.window.Event("scroll"));
    });
    // The virtualizer measures nothing while a scroll is in flight, so the
    // reader has to have come to rest — which is exactly when a message is sent.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const errors = [];
    const realConsoleError = console.error;
    console.error = (...args) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      // The persisted id arrives, and the rebuilt row turns out to be markdown
      // well past its estimate — a measurement that has to move the scroller to
      // keep the reader's eye on the foot of the answer.
      realHeights.set(COUNT - 1, 260);
      await act(async () => {
        root.render(draw(conversation("id:msg_20")));
      });
      await measured(act);
    } finally {
      console.error = realConsoleError;
    }

    assert.deepEqual(
      errors.filter((message) => message.includes("flushSync")),
      [],
      "measuring a row flushed from inside React's commit phase",
    );
    // And the measurement itself is not what was given up to get there.
    const grown = laidOutHeight(scroller);
    assert.equal(grown, settled + 160, "the taller row was never measured");
    assert.ok(
      scroller.scrollTop >= grown - VIEWPORT - 1,
      `the reader was left ${grown - VIEWPORT - scroller.scrollTop}px above the foot of the conversation`,
    );

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);

test(
  "StrictMode's rehearsal unmount does not silence measurement for good",
  { skip },
  async () => {
    // Development StrictMode mounts, runs every cleanup, and mounts again — on
    // a component that then lives on. The cleanup marks the list unmounted, and
    // left that way the mark turns off the microtask measurement and the resize
    // sweep for the lifetime of every dev transcript: rows stand at their
    // estimates, and the thinking row of a fresh turn is drawn into the message
    // above it. Production mounts once, so only dev ever showed it — and no
    // other test here renders under StrictMode.
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    const scroller = makeScroller();
    const bridge = inertBridge();
    const items = Array.from({ length: COUNT }, (_, index) => ({ key: `m${index}` }));
    // A real height well past the estimate, on a row that is mounted from the
    // start: only a measurement can find it.
    realHeights.set(0, 300);

    const root = createRoot(scroller);
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(VirtualizedMessageList, {
            surface: "hermes-chat",
            items,
            scrollRef: { current: scroller },
            bridge,
            gap: GAP,
            resetKey: "conversation-strict",
            getItemKey: (item) => item.key,
            estimateSize: () => ESTIMATE,
            renderItem: (item) => React.createElement("div", null, item.key),
          }),
        ),
      );
    });
    await measured(act);

    assert.equal(
      laidOutHeight(scroller),
      (COUNT - 1) * ESTIMATE + 300 + (COUNT - 1) * GAP,
      "after the StrictMode mount cycle, rows were left at their estimates",
    );

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);

test("a row that never reaches the document is not measured", { skip }, async () => {
  // The cost of measuring after the commit rather than inside it: a row can be
  // gone by the time its measurement runs. It must be skipped rather than
  // reported, or a detached node's zero height becomes the row's height.
  const React = require("react");
  const { act } = require("react");
  const { createRoot } = require("react-dom/client");

  realHeights.clear();
  const scroller = makeScroller();
  const bridge = inertBridge();
  const items = Array.from({ length: COUNT }, (_, index) => ({ key: `m${index}` }));

  const root = createRoot(scroller);
  await act(async () => {
    root.render(
      React.createElement(VirtualizedMessageList, {
        surface: "hermes-chat",
        items,
        scrollRef: { current: scroller },
        bridge,
        gap: GAP,
        resetKey: "conversation-b",
        getItemKey: (item) => item.key,
        estimateSize: () => ESTIMATE,
        renderItem: (item) => React.createElement("div", null, item.key),
      }),
    );
    // Torn down inside the same act, before any measurement can run.
    root.unmount();
  });

  assert.equal(scroller.querySelector("[data-chat-virtual-list]"), null);
  scroller.remove();
});

test(
  "a row mounted while the transcript is still scrolling is measured all the same",
  { skip },
  async () => {
    // The condition every message is actually sent under. A transcript that
    // follows a streaming answer writes `scrollTop` on every frame, so the
    // virtualizer is told it is scrolling for the whole turn — and it declines
    // to measure a row from its ref callback while it believes that. Left there,
    // a row stands at its estimate for good: a finished answer never resizes, so
    // nothing ever asks it again. The estimate is capped well below what a long
    // answer really is, and the rest of the conversation is drawn on top of it.
    const React = require("react");
    const { act } = require("react");
    const { createRoot } = require("react-dom/client");

    realHeights.clear();
    const scroller = makeScroller();
    const bridge = inertBridge();
    const conversation = (length) =>
      Array.from({ length }, (_, index) => ({ key: `m${index}` }));

    const draw = (items) =>
      React.createElement(VirtualizedMessageList, {
        surface: "hermes-chat",
        items,
        scrollRef: { current: scroller },
        bridge,
        gap: GAP,
        resetKey: "conversation-c",
        getItemKey: (item) => item.key,
        estimateSize: () => ESTIMATE,
        renderItem: (item) => React.createElement("div", null, item.key),
      });

    const root = createRoot(scroller);
    await act(async () => {
      root.render(draw(conversation(COUNT)));
    });
    await measured(act);

    // The reader is following the answer: the scroller is being written on every
    // frame, and no 150ms of quiet is ever going to arrive.
    const keepScrolling = async () => {
      await act(async () => {
        scroller.scrollTop = laidOutHeight(scroller) - VIEWPORT;
        scroller.dispatchEvent(new dom.window.Event("scroll"));
      });
    };
    await keepScrolling();

    // The answer lands: one row, far past its estimate, mounted mid-scroll.
    realHeights.set(COUNT, 900);
    await act(async () => {
      root.render(draw(conversation(COUNT + 1)));
    });
    await keepScrolling();
    await measured(act);

    const rows = [...scroller.querySelectorAll("[data-index]")].map((row) => ({
      index: Number(row.getAttribute("data-index")),
      top: Number.parseFloat(
        /translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? "NaN",
      ),
      height: realHeights.get(Number(row.getAttribute("data-index"))) ?? ESTIMATE,
    }));
    rows.sort((a, b) => a.index - b.index);

    const tall = rows.find((row) => row.index === COUNT);
    assert.ok(tall, "the newest row was never mounted");
    assert.equal(
      laidOutHeight(scroller),
      COUNT * ESTIMATE + 900 + COUNT * GAP,
      "the row mounted mid-scroll was left at its estimate",
    );

    // The symptom that shows: a row drawn over the one above it.
    for (let i = 0; i < rows.length - 1; i += 1) {
      assert.ok(
        rows[i].top + rows[i].height <= rows[i + 1].top + 0.5,
        `row ${rows[i].index} is drawn ${Math.round(rows[i].top + rows[i].height - rows[i + 1].top)}px over row ${rows[i + 1].index}`,
      );
    }

    await act(async () => {
      root.unmount();
    });
    scroller.remove();
  },
);
