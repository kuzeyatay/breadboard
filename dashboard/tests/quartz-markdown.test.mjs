import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { extractQuartzMath, normalizeQuartzMarkdown } from "../src/lib/quartz-markdown.ts";

describe("Quartz markdown normalization", () => {
  test("converts bracket display math to Quartz dollar blocks", () => {
    const markdown = normalizeQuartzMarkdown("Before\n\\[\nY = f(Wx + b)\n\\]\nAfter");
    assert.match(markdown, /\$\$\nY = f\(Wx \+ b\)\n\$\$/);
    assert.doesNotMatch(markdown, /\\\[/);
  });

  test("converts inline math and keeps code fences untouched", () => {
    const markdown = normalizeQuartzMarkdown("Where \\(x\\) is input.\n\n```txt\n\\(do not touch\\)\n```");
    assert.match(markdown, /Where \$x\$ is input/);
    assert.match(markdown, /```txt\n\\\(do not touch\\\)\n```/);
  });

  test("normalizes formula symbols, percentages, tags, and page links", () => {
    const markdown = normalizeQuartzMarkdown("See [[Page 6]].\n\n$$\n\\Delta t \\geq 1, 100% \\tag{2}\n$$");
    assert.match(markdown, /\[\[#Page 6\|Page 6\]\]/);
    assert.match(markdown, /\\Delta t \\geq 1, 100\\% \\qquad \\text\{\(2\)\}/);
    assert.doesNotMatch(markdown, /\\tag/);
    assert.equal(extractQuartzMath(markdown).length, 1);
  });

  test("never normalizes LaTeX delimiters inside YAML frontmatter", () => {
    const frontmatter = String.raw`---
title: "Piecewise surrogate"
formulas:
  - text: "\\begin{cases}1, & x > 0,\\\\[6pt]0, & x \\leq 0.\\end{cases}"
---
`;
    const markdown = normalizeQuartzMarkdown(`${frontmatter}\\[\ny = f(x)\n\\]\n`);

    assert.equal(markdown.slice(0, frontmatter.length), frontmatter);
    assert.doesNotMatch(markdown.slice(0, frontmatter.length), /^\$\$/m);
    assert.match(markdown.slice(frontmatter.length), /\$\$\ny = f\(x\)\n\$\$/);
  });
});
