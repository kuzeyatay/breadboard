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

test("Garden citation protocols resolve before Markdown URL sanitization", () => {
  const markup = renderToStaticMarkup(React.createElement(ChatMarkdown, {
    content: '[Opening-session sequence](garden:ec-2/Concepts/24.%20course/review.md) · [Course topic list](garden:ec-2/sources/lecture1-1-introduction.md)',
  }));
  assert.match(markup, /href="\/garden\/ec-2\?note=Concepts%2F24\.%20course%2Freview"/);
  assert.match(markup, /href="\/garden\/ec-2\?note=sources%2Flecture1-1-introduction"/);
  assert.match(markup, /target="_blank"/);
  assert.doesNotMatch(markup, /href=""|href="garden:/);
});

test("unusable citations retain their formatted labels without clickable anchors", () => {
  const markup = renderToStaticMarkup(React.createElement(ChatMarkdown, {
    content: '[**Source title**](sandbox:/mnt/data/book.pdf) · [Unknown](garden:bad) · [Placeholder](#) · [Relative](sources/book.md)',
  }));
  assert.match(markup, /<span><strong>Source title<\/strong><\/span>/);
  assert.match(markup, /<span>Unknown<\/span>/);
  assert.match(markup, /<span>Placeholder<\/span>/);
  assert.match(markup, /<span>Relative<\/span>/);
  assert.doesNotMatch(markup, /<a\b/);
});

test("Garden diagrams retain their canonical asset URL and accessible description", () => {
  const source = "/electromagnetism-1/assets/source-visuals/spherical-element.png";
  const markup = renderToStaticMarkup(React.createElement(ChatMarkdown, {
    content: `![Spherical element with dr, r dθ, and r sin θ dφ](${source})`,
  }));
  assert.ok(markup.includes(`src="${source}"`));
  assert.match(markup, /alt="Spherical element with dr, r dθ, and r sin θ dφ"/);
  assert.match(markup, /class="[^"]*max-w-full/);
  assert.match(markup, /class="[^"]*chat-markdown-image/);
  assert.match(markup, /loading="eager"/);
  assert.match(markup, /decoding="async"/);
});

test("markdown tables keep table semantics inside a viewport-bound frame", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChatMarkdown, {
      content: "| Name | Value |\n| --- | --- |\n| Width | Full |",
    }),
  );

  assert.match(markup, /<div class="chat-table-frame"><table>/);
  assert.match(markup, /<th>Name<\/th>/);
  assert.match(markup, /<td>Full<\/td>/);
});

test("legacy HTML breaks in table cells become wrappable text", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChatMarkdown, {
      content: "| Exam |\n| --- |\n| **Oct 28, 09:00-12:00**<br>Telecommunications Systems |",
    }),
  );

  assert.doesNotMatch(markup, /&lt;br&gt;|<br\s*\/?>/i);
  assert.match(markup, /<strong>Oct 28, 09:00-12:00<\/strong> Telecommunications Systems/);
});

test("break tags written as table-cell code remain literal code", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChatMarkdown, {
      content: "| Syntax |\n| --- |\n| `<br>` then<br>value |",
    }),
  );

  assert.match(markup, /<code>&lt;br&gt;<\/code> then value/);
});

test("chat tables fit the message and wrap their cells without a scrollbar", () => {
  const css = fs.readFileSync(path.join(dashboardRoot, "src", "app", "globals.css"), "utf8");

  assert.match(
    css,
    /\.chat-markdown\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assert.match(
    css,
    /\.chat-markdown \.chat-table-frame\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;/s,
  );
  assert.match(
    css,
    /\.chat-markdown \.chat-table-frame table\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*table-layout:\s*fixed;/s,
  );
  assert.match(css, /\.chat-markdown th,\s*\.chat-markdown td\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.doesNotMatch(css, /\.chat-markdown \.chat-table-frame\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/s);
  assert.doesNotMatch(css, /\.chat-markdown \.chat-table-frame table\s*\{[^}]*width:\s*max-content/s);
  assert.doesNotMatch(css, /\.chat-markdown table\s*\{[^}]*display:\s*block;/s);
});
