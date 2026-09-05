import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownIntegrityIssue,
  normalizeProducedMarkdown,
  repairDamagedLatex,
} from "../src/lib/markdown-safety.ts";

test("produced Markdown repairs the two observed fraction corruption forms", () => {
  const damaged = "$$\nE = \u000crac{1}{R^2} + �rac{h}{b}\n$$";
  const repaired = normalizeProducedMarkdown(damaged);

  assert.equal(repaired, "$$\nE = \\frac{1}{R^2} + \\frac{h}{b}\n$$");
  assert.equal(markdownIntegrityIssue(repaired), null);
});

test("repair leaves examples inside inline and fenced code untouched", () => {
  const sample = "`�rac{1}{2}`\n\n```text\n\u000crac{1}{2}\n```";
  assert.equal(repairDamagedLatex(sample), sample);
});

test("ordinary tabs and CRLF line endings are never mistaken for LaTeX", () => {
  const ordinary = "heading\r\nrho remains prose\n\ttheta remains indented";
  assert.equal(repairDamagedLatex(ordinary), ordinary);
});

test("unexplained lossy text and controls fail artifact integrity validation", () => {
  assert.match(markdownIntegrityIssue("damaged � text") ?? "", /replacement character/);
  assert.match(markdownIntegrityIssue("damaged \u0001 text") ?? "", /control character/);
});
