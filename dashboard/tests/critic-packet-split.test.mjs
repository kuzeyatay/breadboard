// An oversized final-critic packet is reviewed in whole-section parts that fit
// the model context (em1, 2026-10-16: a 6.25M-character packet failed every
// attempt with context_length_exceeded).

import test from "node:test";
import assert from "node:assert/strict";
import { buildCriticUserPrompt, splitCriticReviewPacket } from "../src/lib/critic-loop.ts";

const excerpt = (text) => ({ text, fullLength: text.length, packetTruncated: false });

function packet(sectionCount, bodyChars) {
  const sections = Array.from({ length: sectionCount }, (_, s) => ({
    title: `${s + 1}. Section`,
    indexExcerpt: excerpt(""),
    pages: [{
      path: `learning/${s + 1}/page.md`,
      title: `Page ${s + 1}`,
      learningUnitId: `U${s + 1}`,
      openingExcerpt: excerpt(""),
      frontmatterSummary: { sourceAnchors: [`S1.P${s + 1}.E1`], sourceFormulaAnchors: [], formulas: [], tags: [], visuals: [] },
      bodyExcerpts: [],
      bodyText: excerpt("x".repeat(bodyChars)),
    }],
  }));
  return {
    gardenTitle: "g",
    sections,
    sourceAnchors: sections.map((_, s) => ({ id: `S1.P${s + 1}.E1`, kind: "formula", title: "t", semanticSummary: "t" })),
    visualSummaries: [],
    sourceCoverageSummary: excerpt(""),
    sourceVisualSummaries: [],
    deterministicValidationSummary: "",
    evidenceNote: "",
  };
}

test("a packet within budget is reviewed whole", () => {
  const whole = packet(3, 100);
  assert.deepEqual(splitCriticReviewPacket(whole, 1_000_000), [whole]);
});

test("an oversized packet splits into whole sections within budget, each with only its own anchors", () => {
  const big = packet(6, 4000);
  const budget = 10_000;
  const parts = splitCriticReviewPacket(big, budget);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.ok(buildCriticUserPrompt(part).length <= budget);
    const own = new Set(part.sections.flatMap((s) => s.pages.flatMap((p) => p.frontmatterSummary.sourceAnchors)));
    assert.deepEqual(part.sourceAnchors.map((a) => a.id).sort(), [...own].sort());
  }
  const titles = parts.flatMap((p) => p.sections.map((s) => s.title));
  assert.deepEqual(titles, big.sections.map((s) => s.title));
});
