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
const { websiteSnapshotMarkdown } = await import('../src/lib/website-to-markdown.ts');

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

test("website chapter links retain real heading targets after garden sanitization", () => {
  const markdown = websiteSnapshotMarkdown({
    rootUrl: 'https://example.com/', aliases: {}, failures: [], skipped: [], complete: true,
    pages: [{ originalUrl: 'https://example.com/', title: 'An original page', anchor: 'website-page-1',
      markdown: 'The complete original body.\n\n[Home](/)', discoveredLinks: [] }],
  });
  const saved = sanitizeKnowledgeMarkdownForQuartz(markdown);
  assert.match(saved, /\[An original page\]\(#website-page-1\)/);
  assert.match(saved, /^## Website page 1$/m);
  assert.match(saved, /\[Home\]\(#website-page-1\)/);
  assert.doesNotMatch(saved, /&lt;a id=/);
});
