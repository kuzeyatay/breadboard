import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REVIEW_PASSES,
  cleanArtifactTypography,
  reviewArtifactProse,
} from "../src/lib/hermes/artifact-prose-review.ts";
import { lintDeckLook } from "../src/lib/bolt-slides/author.ts";

test("written artifacts lose dashes, curly quotes and dot separators, but code and math stay", () => {
  const source = [
    "The plan — simple – works for pages 1–2.",
    "“Quoted” and it’s fine. Design · Build · Ship",
    "Math stays: $a · b$ and 2 · 3.",
    "```",
    "x — y · “z”",
    "```",
  ].join("\n");
  const out = cleanArtifactTypography(source, "docx");
  assert.match(out, /The plan, simple, works for pages 1–2\./);
  assert.match(out, /"Quoted" and it's fine\. Design, Build, Ship/);
  assert.match(out, /\$a · b\$ and 2 · 3\./);
  assert.match(out, /x — y · “z”/, "fenced code is untouched");
  // HTML keeps curly quotes (straightening them could close an attribute).
  assert.equal(cleanArtifactTypography("<p>“hi” — there</p>", "html"), "<p>“hi”, there</p>");
  // Non-prose renderers are never touched.
  assert.equal(cleanArtifactTypography('{"a":"x — y"}', "json"), '{"a":"x — y"}');
});

test("review asks for a rewrite of sloppy, hard-to-follow prose, then stops asking", () => {
  const sloppy = Array.from({ length: 4 }, () =>
    "In today's fast-paced landscape, it is important to note that this robust and seamless solution serves as a testament to our commitment to delve into the multifaceted tapestry of innovation, leveraging cutting-edge synergies that empower stakeholders across every vertical while fostering a vibrant ecosystem of holistic transformation and pivotal growth.",
  ).join("\n\n");
  const first = reviewArtifactProse(sloppy, "markdown", 1);
  assert.ok(first?.needsRevision);
  assert.ok(first.longSentences.length >= 3);
  assert.match(first.instructions, /artifact_update/);
  const last = reviewArtifactProse(sloppy, "markdown", MAX_REVIEW_PASSES);
  assert.equal(last?.needsRevision, false, "loop is capped");

  const plain = Array.from({ length: 12 }, (_, i) =>
    `Step ${i + 1} sets the pump to a new rate. Check the gauge after a minute. Write the reading in the log.`,
  ).join(" ");
  assert.equal(reviewArtifactProse(plain, "markdown", 1)?.needsRevision, false);
  assert.equal(reviewArtifactProse("short note", "markdown", 1), null);
});

test("slide decks are checked for the generated look", () => {
  const deck = {
    appTsx: "export default () => <h1>Fast · Simple</h1>; const t = 'Plan — now';".padEnd(220, " "),
    tokensRoot: "--font-display: 'Playfair Display', serif;",
    fontImport: "",
  };
  const problems = lintDeckLook(deck);
  assert.equal(problems.length, 3);
  assert.deepEqual(
    lintDeckLook({ appTsx: "<h1>Fast and simple</h1>", tokensRoot: "--font: Inter, sans-serif;", fontImport: "" }),
    [],
  );
});

test("short posts can be reviewed with a lower word floor", () => {
  const post = "Excited to announce our robust, seamless, cutting-edge platform that empowers teams to unlock synergies and elevate their journey in today's fast-paced landscape.";
  assert.equal(reviewArtifactProse(post, "text", 1), null, "default floor skips short text");
  assert.ok(reviewArtifactProse(post, "text", 1, 12));
});
