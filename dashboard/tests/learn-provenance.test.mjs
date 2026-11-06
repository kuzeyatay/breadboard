import assert from "node:assert/strict";
import test from "node:test";
import { compiledReferenceLines, relocateSourceProvenance } from "../src/lib/learn-utils.ts";

const sources = [
  { slug: "couch-digital-and-analog", title: "Digital and Analog Communication Systems (Leon W Couch II) (z-library.sk, 1lib.sk).pdf", index: 16 },
  { slug: "5xta0-ber", title: "5XTA0.M1.SR_BER.pdf", index: 11 },
];

test("references are compiled per source with their pages", () => {
  assert.deepEqual(
    compiledReferenceLines(["S16.P522.E6", "S16.P519.G1", "text-5xta0-ber-page-3", "S11.P6.F1", "S99.P1.F1"], sources),
    ["- 5XTA0.M1.SR_BER, pp. 3, 6.", "- Digital and Analog Communication Systems (Leon W Couch II), pp. 519, 522."],
  );
});

test("provenance leaves the story and lands once at the end", () => {
  const body = [
    "A paragraph ends with ids. (S11.P3.F1)",
    "",
    "Two ids here (S16.P460.E1; S16.P522.E6) mid sentence.",
    "",
    "*S13.P12.G1: Continuous analog signal* *(p. 12)*",
    "",
    "$$",
    "x (S1.P1.E1) = 1",
    "$$",
    "",
    "<!-- restated-source-formulas: S16.P522.E6 -->",
    "",
    "Keep a real parenthetical (like this).",
  ].join("\n");
  const refs = ["- Couch, p. 12."];
  const out = relocateSourceProvenance(body, refs);
  assert.match(out, /A paragraph ends with ids\.\n/);
  assert.match(out, /Two ids here mid sentence\./);
  assert.match(out, /^\*Continuous analog signal\*$/m);
  assert.match(out, /x \(S1\.P1\.E1\) = 1/);
  assert.match(out, /\(like this\)/);
  assert.match(out, /\*\*References\*\*\n\n- Couch, p\. 12\.\n\n<!-- restated-source-formulas: S16\.P522\.E6 -->\n$/);
  assert.equal(relocateSourceProvenance(out, refs), out);
});
