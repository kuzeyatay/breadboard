import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BASE_SLOP_RULES,
  BREADBOARD_PROFILE,
  PROSE_SCORE_TARGET,
  maskGardenMarkdown,
  scoreGardenPage,
  scoreProse,
} from "../src/lib/prose-score/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const clone = process.env.SOUNDSHUMAN_DIR || path.join(repoRoot, "soundshuman");
const sloplint = path.join(clone, "bin", "sloplint.js");

const upstreamOpts = {
  profile: null,
  maskGardenStructures: false,
  ignoreQuotes: false,
};

const SLOP = `In today's rapidly evolving landscape, this groundbreaking platform
serves as a testament to our commitment to excellence. It is important to note
that the seamless integration empowers teams to leverage cutting-edge workflows,
underscoring the pivotal role of innovation. It's not just a tool, it's a
paradigm shift. The future looks bright.`;

const HUMAN = `The pump ran for six hours and then stopped. We found a cracked
seal on the intake side, replaced it with the spare from the van, and it has run
since. Nobody has looked at why the spare was already in the van. That is the
next question, and it is the more interesting one.`;

test("the port reproduces upstream sloplint's score exactly", { skip: !fs.existsSync(sloplint) && "soundshuman clone not present" }, () => {
  const samples = [SLOP, HUMAN, fs.readFileSync(path.join(clone, "README.md"), "utf8")];
  for (const sample of samples) {
    const raw = execFileSync("node", [sloplint, "score", "--json"], {
      input: sample,
      encoding: "utf8",
    });
    const upstream = JSON.parse(raw);
    const ours = scoreProse(sample, upstreamOpts);
    assert.equal(
      ours.score,
      upstream.score,
      `score drift on sample starting ${JSON.stringify(sample.slice(0, 40))}`,
    );
    assert.equal(ours.findings.length, upstream.findings.length);
  }
});

test("slop scores high and plain writing scores low", () => {
  assert.ok(scoreProse(SLOP, upstreamOpts).score > 60);
  assert.ok(scoreProse(HUMAN).score <= PROSE_SCORE_TARGET);
});

test("masking preserves offsets so line numbers stay true", () => {
  const md = "line one\n\n$$ E = mc^2 $$\n\nthis delves into the tapestry\n";
  const masked = maskGardenMarkdown(md);
  assert.equal(masked.length, md.length);
  assert.equal(masked.split("\n").length, md.split("\n").length);
  const result = scoreProse(md);
  const delve = result.findings.find((f) => f.id.toLowerCase() === "vocab:delves");
  assert.ok(delve, "expected the prose finding to survive masking");
  assert.equal(delve.line, 5);
});

test("LaTeX, anchors, wikilinks and visual blocks are not scored", () => {
  const page = [
    "The particle sits in a well.",
    "",
    "$$ \\text{crucial} = \\frac{1}{2} \\quad \\text{robust} $$",
    "",
    "See [[Topic Overview|the overview]] and anchor S1.P12.F1 for the derivation.",
    "",
    "```breadboard-visual",
    '{"kind":"plot","title":"a seamless, groundbreaking tapestry"}',
    "```",
    "",
    "Inline $\\delta$ and a range of 2–3 eV follow from the same argument.",
  ].join("\n");

  const { tuned } = { tuned: scoreProse(page) };
  const ids = tuned.findings.map((f) => f.id.toLowerCase());
  for (const banned of ["vocab:crucial", "vocab:seamless", "vocab:groundbreaking", "vocab:tapestry"]) {
    assert.ok(!ids.includes(banned), `${banned} leaked from a masked region`);
  }
  assert.ok(!ids.includes("em-dash"), "the numeric range was scored as an em dash");
});

test("an unbalanced $$ does not swallow the document", () => {
  const prose = "This groundbreaking tapestry delves into the vibrant realm. ".repeat(40);
  const page = `$$ E = mc^2\n\n${prose}`;
  const masked = maskGardenMarkdown(page);
  assert.ok(
    masked.includes("groundbreaking"),
    "a runaway mask hid real prose behind an unbalanced delimiter",
  );
});

test("the Breadboard profile spares technical senses and keeps the rest", () => {
  const technical =
    "The robust estimator rejects outliers, so the controller stays stable. " +
    "The wiring harness carries the connector pinout to the board. " +
    "The effective mass of the electron sets the band curvature.";
  const ids = scoreProse(technical).findings.map((f) => f.id.toLowerCase());
  assert.ok(!ids.includes("vocab:robust"));
  assert.ok(!ids.includes("vocab:harness"));

  const marketing =
    "Our robust platform delivers a seamless experience that empowers every team.";
  const marketingIds = scoreProse(marketing).findings.map((f) => f.id.toLowerCase());
  assert.ok(
    marketingIds.includes("vocab:robust"),
    "robust with no technical context must still be flagged",
  );
});

test("the rule-of-three detector is off for garden prose but present upstream", () => {
  const text = "We measured accuracy, latency, and energy for every model.";
  assert.ok(
    scoreProse(text, upstreamOpts).findings.some((f) => f.id === "oxford-triple"),
  );
  assert.ok(
    !scoreProse(text).findings.some((f) => f.id === "oxford-triple"),
  );
  assert.ok(BREADBOARD_PROFILE.disable.includes("oxford-triple"));
});

test("the profile can only forgive, never add findings", () => {
  const page = fs.readFileSync(
    path.join(repoRoot, "quartz", "content", "physics-for-ee", "_index.md"),
    "utf8",
  );
  const { tuned, upstream } = scoreGardenPage(page);
  assert.ok(tuned.findings.length <= upstream.findings.length);
});

test("the vendored rule pack records where it came from", () => {
  assert.match(BASE_SLOP_RULES.source ?? "", /soundshuman/);
  assert.ok(BASE_SLOP_RULES.regex.length > 10);
});
