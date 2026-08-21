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
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-code-block-"),
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

test("an unlabeled fenced block does not show a generic Code label", () => {
  const markup = render("```\nAI-style pattern score\n```");

  assert.match(markup, /chat-code-block-unlabelled/);
  assert.doesNotMatch(markup, /chat-code-block-header/);
  assert.doesNotMatch(markup, /chat-code-block-language/);
  assert.match(markup, /aria-label="Copy code"/);
});

test("a fenced block keeps an explicitly supplied language label", () => {
  const markup = render("```typescript\nconst score: number = 41;\n```");

  assert.match(markup, /chat-code-block-language/);
  assert.match(markup, />TypeScript<\/span>/);
});
