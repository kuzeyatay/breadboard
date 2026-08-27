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
const gateSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "app", "components", "interaction-hydration-gate.tsx"),
  "utf8",
);
const layoutSource = fs.readFileSync(
  path.join(dashboardRoot, "src", "app", "layout.tsx"),
  "utf8",
);

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
let dom;
let outDirectory;
let InteractionHydrationGate;
let interactionHydrationBootstrapScript;

before(async () => {
  if (skip) return;
  const cacheDirectory = path.join(dashboardRoot, "node_modules", ".cache");
  fs.mkdirSync(cacheDirectory, { recursive: true });
  outDirectory = fs.mkdtempSync(path.join(cacheDirectory, "hydration-gate-"));
  const entry = path.join(outDirectory, "entry.jsx");
  fs.writeFileSync(
    entry,
    [
      'export { default as InteractionHydrationGate } from "@/app/components/interaction-hydration-gate";',
      'export { interactionHydrationBootstrapScript } from "@/app/components/interaction-hydration-bridge";',
      "",
    ].join("\n"),
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
    runScripts: "outside-only",
    url: "http://localhost/",
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
  ]) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({
    InteractionHydrationGate,
    interactionHydrationBootstrapScript,
  } = require(path.join(outDirectory, "bundle.cjs")));
});

after(() => {
  if (outDirectory) fs.rmSync(outDirectory, { recursive: true, force: true });
  dom?.window.close();
});

function prepareServerButton() {
  document.body.innerHTML = '<button id="terminal" class="h-screen" type="button">Terminal</button>';
  delete window.__breadboardInteractionHydration;
  window.eval(interactionHydrationBootstrapScript);
}

function terminalButton(React, onOpen) {
  return React.createElement(
    "button",
    { id: "terminal", className: "h-screen", type: "button", onClick: onOpen },
    "Terminal",
  );
}

test("the hydration gate preserves direct body-child page shells without inert markup", () => {
  assert.match(gateSource, /return <>\{children\}<\/>/u);
  assert.doesNotMatch(gateSource, /<div|\binert\b|display:\s*"contents"/u);
  assert.match(
    layoutSource,
    /<head>[\s\S]*interactionHydrationBootstrapScript[\s\S]*<\/head>[\s\S]*<body/u,
  );
});

test("a click before hydration is replayed once when handlers attach", { skip }, async () => {
  const React = require("react");
  const { act } = React;
  const { hydrateRoot } = require("react-dom/client");
  prepareServerButton();
  let opens = 0;
  const handleOpen = () => {
    opens += 1;
  };

  const acceptedImmediately = document.querySelector("#terminal").dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  assert.equal(acceptedImmediately, false, "the early click should be held for React");
  assert.equal(opens, 0);

  let root;
  await act(async () => {
    root = hydrateRoot(
      document.body,
      React.createElement(
        InteractionHydrationGate,
        null,
        terminalButton(React, handleOpen),
      ),
    );
  });

  assert.equal(opens, 1, "the boot click was discarded instead of replayed");
  assert.equal(document.body.children.length, 1);
  assert.equal(document.body.firstElementChild?.id, "terminal");
  assert.equal(document.body.querySelector(":scope > .h-screen")?.id, "terminal");
  assert.equal(window.__breadboardInteractionHydration?.ready, true);

  await act(async () => {
    document.querySelector("#terminal").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(opens, 2, "normal clicks should not remain gated after hydration");
  await act(async () => root.unmount());
});

test("a click fired during hydration also opens on the first attempt", { skip }, async () => {
  const React = require("react");
  const { act } = React;
  const { hydrateRoot } = require("react-dom/client");
  prepareServerButton();
  let opens = 0;
  const handleOpen = () => {
    opens += 1;
  };

  function ClickDuringHydration() {
    React.useLayoutEffect(() => {
      document.querySelector("#terminal")?.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    }, []);
    return React.createElement(
      "button",
      {
        id: "terminal",
        className: "h-screen",
        type: "button",
        onClick: handleOpen,
      },
      "Terminal",
    );
  }

  let root;
  await act(async () => {
    root = hydrateRoot(
      document.body,
      React.createElement(
        InteractionHydrationGate,
        null,
        React.createElement(ClickDuringHydration),
      ),
    );
  });

  assert.equal(opens, 1);
  assert.equal(document.body.querySelector(":scope > #terminal")?.textContent, "Terminal");
  await act(async () => root.unmount());
});
