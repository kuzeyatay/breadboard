// Long messages the person sent are folded behind a Show more toggle.
//
// Two halves, both of which have bitten this transcript before:
//
//   * the height estimate. A folded message never stands at its unfolded
//     height, and a virtualized list laid out on a guess several thousand
//     pixels out is one whose scrollbar lurches as the row is measured;
//   * the fold itself, mounted in a real DOM. jsdom performs no layout, so the
//     content's height is stubbed — everything else, including the decision
//     that there is enough hidden to be worth a toggle, is the real code.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  COLLAPSED_USER_MESSAGE_PX,
  USER_MESSAGE_COLLAPSE_SLACK_PX,
  USER_MESSAGE_TOGGLE_PX,
  estimateChatRowHeight,
} from "../src/app/components/chat/chat-row-identity.ts";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const require = module.createRequire(import.meta.url);

// ── The height a folded row is assumed to have ───────────────────────────────

test("a long user message is estimated at its folded height, not its real one", () => {
  const pasted = {
    role: "user",
    content: "a line of the pasted document\n".repeat(200),
  };
  const short = { role: "user", content: "what does this do?" };
  const answer = {
    role: "assistant",
    content: "a line of the answer\n".repeat(200),
  };

  assert.equal(
    estimateChatRowHeight(pasted),
    28 + COLLAPSED_USER_MESSAGE_PX + USER_MESSAGE_TOGGLE_PX,
  );
  // An ordinary prompt is left exactly where it was.
  assert.ok(estimateChatRowHeight(short) < COLLAPSED_USER_MESSAGE_PX);
  // Answers are not folded, so their estimate is untouched by any of this.
  assert.ok(estimateChatRowHeight(answer) > COLLAPSED_USER_MESSAGE_PX + 200);
});

test("a message just over the fold is still estimated whole", () => {
  const lines = Math.floor(COLLAPSED_USER_MESSAGE_PX / 24) + 1;
  const barelyOver = { role: "user", content: "line\n".repeat(lines) };

  assert.ok(
    estimateChatRowHeight(barelyOver) > COLLAPSED_USER_MESSAGE_PX,
    "the slack is what keeps a toggle off a message that hides two lines",
  );
});

// ── Every transcript, not just the one that was looked at ───────────────

test("all four transcripts fold the messages the person sent", () => {
  const surfaces = [
    "src/app/components/hermes/agent-runtime-panel.tsx",
    "src/app/components/knowledge-terminal.tsx",
    "src/app/garden/garden-assistant.tsx",
    "src/app/gardens/[clusterSlug]/workspace-client.tsx",
  ];

  for (const surface of surfaces) {
    const code = fs.readFileSync(path.join(dashboardRoot, surface), "utf8");
    assert.match(
      code,
      /collapsible-user-message/,
      `${surface} draws user bubbles without folding the long ones`,
    );
  }
});

// ── The fold, in a real DOM ──────────────────────────────────────────────────

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

/** The only layout jsdom is given: what the message's content measures. */
let contentHeight = 0;

let CollapsibleUserMessage;
let dom;
let outDirectory;

before(async () => {
  if (skip) return;
  fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), {
    recursive: true,
  });
  outDirectory = fs.mkdtempSync(
    path.join(dashboardRoot, "node_modules", ".cache", "chat-fold-"),
  );
  const entry = path.join(outDirectory, "entry.jsx");
  fs.writeFileSync(
    entry,
    'export { default as CollapsibleUserMessage } from "@/app/components/chat/collapsible-user-message";\n',
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
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "Event",
    "MouseEvent",
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
      return contentHeight;
    },
  });
  // The component watches its content for late arrivals; jsdom has no observer.
  class InertResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  dom.window.ResizeObserver = InertResizeObserver;
  globalThis.ResizeObserver = InertResizeObserver;

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ CollapsibleUserMessage } = require(path.join(outDirectory, "bundle.cjs")));
});

after(() => {
  if (outDirectory) fs.rmSync(outDirectory, { recursive: true, force: true });
});

function mount(messageKey) {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const host = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  const draw = () =>
    React.createElement(
      CollapsibleUserMessage,
      { messageKey },
      React.createElement("p", null, "the pasted document"),
    );
  return { host, root, draw };
}

const fold = (host) => host.querySelector("[data-chat-collapsible-message]");
const toggle = (host) => host.querySelector("button");
const click = (element) =>
  element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

test("a message taller than the fold is clipped and given a toggle", { skip }, async () => {
  const { act } = require("react");
  contentHeight = 1_400;

  const { host, root, draw } = mount("id:msg_1");
  await act(async () => root.render(draw()));

  assert.equal(fold(host).dataset.expanded, "false");
  const body = fold(host).firstElementChild;
  assert.equal(body.style.maxHeight, `${COLLAPSED_USER_MESSAGE_PX}px`);
  assert.ok(body.classList.contains("bb-chat-message-fold"), "the cut is faded");
  assert.equal(toggle(host).textContent.trim(), "Show more");
  assert.equal(toggle(host).getAttribute("aria-expanded"), "false");
  assert.equal(toggle(host).getAttribute("aria-controls"), body.id);

  await act(async () => click(toggle(host)));

  assert.equal(fold(host).dataset.expanded, "true");
  assert.equal(fold(host).firstElementChild.style.maxHeight, "");
  assert.equal(toggle(host).textContent.trim(), "Show less");

  await act(async () => root.unmount());
});

test("a message barely over the fold is left whole", { skip }, async () => {
  const { act } = require("react");
  contentHeight = COLLAPSED_USER_MESSAGE_PX + USER_MESSAGE_COLLAPSE_SLACK_PX - 1;

  const { host, root, draw } = mount("id:msg_2");
  await act(async () => root.render(draw()));

  assert.equal(fold(host).dataset.chatCollapsibleMessage, "whole");
  assert.equal(toggle(host), null, "nothing worth hiding, so no toggle");
  // No fade either: the last line must not be dimmed for no reason.
  assert.ok(
    !fold(host).firstElementChild.classList.contains("bb-chat-message-fold"),
  );

  await act(async () => root.unmount());
});

test("an opened message stays open when its row is scrolled away and back", { skip }, async () => {
  const { act } = require("react");
  contentHeight = 1_400;

  const first = mount("id:msg_3");
  await act(async () => first.root.render(first.draw()));
  await act(async () => click(toggle(first.host)));
  assert.equal(fold(first.host).dataset.expanded, "true");
  // Virtualization unmounts a row that leaves the fold.
  await act(async () => first.root.unmount());

  const again = mount("id:msg_3");
  await act(async () => again.root.render(again.draw()));
  assert.equal(
    fold(again.host).dataset.expanded,
    "true",
    "a message must not re-fold itself behind the reader",
  );

  // A different message does not inherit it.
  const other = mount("id:msg_4");
  await act(async () => other.root.render(other.draw()));
  assert.equal(fold(other.host).dataset.expanded, "false");

  await act(async () => {
    again.root.unmount();
    other.root.unmount();
  });
});
