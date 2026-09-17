import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
await import("../scripts/learn-worker-import-hook.mjs");
const { sanitizeKnowledgeMarkdownForQuartz } = await import(
  pathToFileURL(path.join(dashboardRoot, "src", "lib", "knowledge.ts")).href,
);

test("knowledge Markdown encodes raw angle brackets without changing math or code", () => {
  const input = [
    "---",
    'title: "A < comparison"',
    "---",
    "",
    'The model emitted <p<1,\\quad q="1-p$&lt;/td>.',
    "",
    "$$p<1$$",
    "",
    "```html",
    "<p>literal code</p>",
    "```",
  ].join("\n");

  const output = sanitizeKnowledgeMarkdownForQuartz(input);
  assert.match(output, /title: "A < comparison"/);
  assert.match(output, /The model emitted &lt;p&lt;1/);
  assert.match(output, /\$\$p<1\$\$/);
  assert.match(output, /```html\n<p>literal code<\/p>\n```/);
  assert.doesNotMatch(output, /(?<!&lt;)<p<1/);
});

test("knowledge Markdown sanitization is idempotent", () => {
  const input = "# Topic\n\nA < b and `c < d` and $p<1$.";
  const once = sanitizeKnowledgeMarkdownForQuartz(input);
  assert.equal(sanitizeKnowledgeMarkdownForQuartz(once), once);
});
