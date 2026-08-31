import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-markdown-table-"),
);
after(() => fs.rmSync(outDirectory, { recursive: true, force: true }));

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  `export { default as ChatMarkdown } from "@/app/components/chat-markdown";\n`,
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
const { ChatMarkdown } = require(bundle);

test("markdown tables keep table semantics inside the scroll container", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChatMarkdown, {
      content: "| Name | Value |\n| --- | --- |\n| Width | Full |",
    }),
  );

  assert.match(markup, /<div class="chat-table-scroll"><table>/);
  assert.match(markup, /<th>Name<\/th>/);
  assert.match(markup, /<td>Full<\/td>/);
});

test("chat table styles fill the message before overflowing horizontally", () => {
  const css = fs.readFileSync(path.join(dashboardRoot, "src", "app", "globals.css"), "utf8");

  assert.match(
    css,
    /\.chat-markdown\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assert.match(
    css,
    /\.chat-markdown \.chat-table-scroll\s*\{[^}]*width:\s*100%;[^}]*overflow-x:\s*auto;/s,
  );
  assert.match(
    css,
    /\.chat-markdown \.chat-table-scroll table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s,
  );
  assert.doesNotMatch(css, /\.chat-markdown table\s*\{[^}]*display:\s*block;/s);
});
