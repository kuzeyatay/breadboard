// Money is not maths.
//
// `remark-math` reads a `$…$` pair as inline math, so an answer containing
// "Helsing at $18B, Hadrian at $7.87B" was parsed as the formula
// "18B, Hadrian at" and rendered in italic serif with both amounts swallowed.
// Renders the real component rather than reasoning about the regex.

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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-chat-markdown-"),
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

const render = (content) =>
  renderToStaticMarkup(React.createElement(ChatMarkdown, { content }));

test("two dollar amounts in one sentence stay money, not a formula", () => {
  const markup = render(
    "Large private valuations (Helsing at $18B, Hadrian at $7.87B) lead the sector.",
  );
  assert.doesNotMatch(markup, /katex/);
  assert.match(markup, /\$18B/);
  assert.match(markup, /\$7\.87B/);
  // The words that used to be swallowed into the formula are still prose.
  assert.match(markup, /Hadrian at/);
});

test("a run of amounts survives intact", () => {
  const markup = render("Galaxy Bot $453M, Apptronik $403M to $935M.");
  assert.doesNotMatch(markup, /katex/);
  for (const amount of ["$453M", "$403M", "$935M"]) {
    assert.ok(markup.includes(amount), `${amount} survives`);
  }
});

test("real inline maths still renders", () => {
  const markup = render(String.raw`Energy is \(E = mc^2\) exactly.`);
  assert.match(markup, /katex/);
});

test("display maths still renders", () => {
  const markup = render("Result:\n\n$$\nx^2 + y^2 = z^2\n$$\n");
  assert.match(markup, /katex/);
});

test("a dollar inside code is the author's, and is left alone", () => {
  const inline = render('Run `echo "$5"` to print it.');
  assert.doesNotMatch(inline, /\\$5/);
  assert.match(inline, /\$5/);

  const fenced = render('```bash\necho "$42"\n```');
  assert.doesNotMatch(fenced, /\\$42/);
  assert.match(fenced, /\$42/);
});

test("a single amount on its own is untouched", () => {
  const markup = render("It costs $5 today.");
  assert.doesNotMatch(markup, /katex/);
  assert.match(markup, /\$5/);
});
