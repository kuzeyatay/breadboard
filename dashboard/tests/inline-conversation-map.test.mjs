import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { requiresGeographicGrounding } from "../src/lib/map/grounding.ts";
import * as mapFormat from "../src/lib/map/format.ts";
import { retryTargetUserMessageIndex } from "../src/app/components/hermes/conversation-branches.ts";

const source = (name) => fs.readFileSync(
  new URL(`../src/app/components/hermes/${name}.tsx`, import.meta.url), "utf8",
);

// Execute the panel's actual selection function without loading the rest of
// the chat's browser-only components.
const panel = source("agent-runtime-panel");
const selectorSource = panel.slice(
  panel.indexOf("function inlineMapKindForAssistant("),
  panel.indexOf("export default function AgentRuntimePanel("),
);
const selectMap = runInNewContext(
  `${stripTypeScriptTypes(selectorSource)}\ninlineMapKindForAssistant`,
  { requiresGeographicGrounding, retryTargetUserMessageIndex },
);

test("inline map selection respects non-geographic requests and opt-outs", () => {
  for (const [request, expected] of [
    ["navigate to instagram", null],
    ["Navigate to https://instagram.com/", null],
    ["Refactor the distance helper in src/lib/map/format.ts.", null],
    ["How long does it take?", null],
    ["Without using the map, how far is Ankara from İstanbul?", null],
    ["Navigate to Amsterdam", "route"],
    ["Recommend cafes near Eindhoven", "places"],
  ]) {
    const messages = [
      { role: "user", content: request },
      { role: "assistant", content: "I'll open Instagram using the browser's address bar." },
    ];
    assert.equal(selectMap(messages, 1), expected, request);
  }
});

const require = createRequire(import.meta.url);
const componentModule = { exports: {} };
const compiled = transformSync(source("inline-conversation-map"), {
  loader: "tsx", format: "cjs", jsx: "automatic",
});
runInNewContext(compiled.code, {
  module: componentModule,
  exports: componentModule.exports,
  require: (id) => {
    if (id.endsWith(".css")) return {};
    if (id === "@/lib/map/format.ts") return mapFormat;
    return require(id);
  },
});

test("a map with no verified results renders no empty card or loading message", () => {
  for (const kind of ["route", "places"]) {
    const html = renderToStaticMarkup(React.createElement(componentModule.exports.default, {
      conversationPublicId: "instagram-navigation",
      kind,
    }));
    assert.equal(html, "", kind);
  }
});
