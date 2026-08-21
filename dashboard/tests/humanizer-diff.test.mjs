// The first-party diff primitives and the scoring/integrity review.
//
// The diff is first-party, so it is tested like a library rather than trusted
// like a dependency: line pairing, word marks inside a changed line, exact
// reconstruction of the text from the parts, and the unified projection a
// narrow screen gets.

import assert from "node:assert/strict";
import test from "node:test";

const { diffText, diffWords, unifiedRows, splitWords } = await import(
  "../src/lib/humanizer/diff.ts"
);
const { describeWarnings, reviewRewriteIntegrity, scoreReview, scoreForReview } = await import(
  "../src/lib/humanizer/review.ts"
);

test("identical text produces an identical diff and no changes", () => {
  const diff = diffText("one\ntwo\n", "one\ntwo\n");
  assert.equal(diff.identical, true);
  assert.equal(diff.added + diff.removed + diff.changed, 0);
});

test("a changed line is one replace row, not a delete and an insert", () => {
  const diff = diffText("keep\nchange me\nkeep\n", "keep\nchanged it\nkeep\n");
  assert.equal(diff.changed, 1);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  const replaced = diff.lines.find((line) => line.op === "replace");
  assert.equal(replaced.originalText, "change me");
  assert.equal(replaced.rewriteText, "changed it");
  assert.equal(replaced.originalNumber, 2);
  assert.equal(replaced.rewriteNumber, 2);
});

test("inserted and deleted lines keep the right line numbers", () => {
  const diff = diffText("a\nb\n", "a\nnew\nb\n");
  const inserted = diff.lines.find((line) => line.op === "insert");
  assert.equal(inserted.rewriteText, "new");
  assert.equal(inserted.originalNumber, null);
  assert.equal(inserted.rewriteNumber, 2);
});

test("word parts reconstruct their line exactly, whitespace included", () => {
  const before = "The  system   represents a groundbreaking step forward.";
  const after = "The  system is a real step forward.";
  const parts = diffWords(before, after);
  assert.equal(parts.original.map((part) => part.text).join(""), before);
  assert.equal(parts.rewrite.map((part) => part.text).join(""), after);
  // Unchanged words are not marked, so the eye lands on what moved.
  assert.ok(parts.rewrite.some((part) => part.op === "equal" && part.text.includes("system")));
  assert.ok(parts.rewrite.some((part) => part.op === "insert"));
});

test("tokenization keeps whitespace as its own token", () => {
  assert.deepEqual(splitWords("a  b"), ["a", "  ", "b"]);
});

test("the unified projection puts the removal before the addition", () => {
  const diff = diffText("old line", "new line");
  const rows = unifiedRows(diff);
  assert.deepEqual(
    rows.map((row) => row.op),
    ["delete", "insert"],
  );
  assert.equal(rows[0].text, "old line");
  assert.equal(rows[1].text, "new line");
  // Word marks survive the projection, so the mobile view is not coarser.
  assert.ok(rows[1].parts?.some((part) => part.op === "insert"));
});

test("a very long line does not blow up the diff", () => {
  const long = "word ".repeat(4000);
  const diff = diffText(long, long + "tail");
  assert.equal(diff.lines.length >= 1, true);
});

test("both versions are scored with Breadboard's existing scorer", () => {
  const machine =
    "In today's rapidly evolving landscape, it is important to note that this " +
    "groundbreaking solution serves as a testament to the transformative power " +
    "of innovation. Moreover, it is worth noting that this represents a pivotal " +
    "moment in the ever-evolving world of technology.";
  const plain =
    "The tool does one job. It reads a file, checks the numbers, and prints what " +
    "it found. There is not much more to it than that.";

  const review = scoreReview(machine, plain);
  assert.equal(typeof review.original.score, "number");
  assert.equal(typeof review.rewrite.score, "number");
  assert.ok(review.original.band.length > 0);
  assert.ok(["high", "medium", "low"].includes(review.original.confidence));
  assert.equal(review.delta, review.rewrite.score - review.original.score);
  assert.equal(review.tied, review.rewrite.score === review.original.score);
  assert.equal(review.worsened, review.rewrite.score > review.original.score);
  assert.ok(Array.isArray(review.original.topPatterns));
});

test("an equal score is identified as a measurement tie", () => {
  const review = scoreReview("The pump stopped.", "The pump has stopped.");
  assert.equal(review.original.score, review.rewrite.score);
  assert.equal(review.tied, true);
  assert.equal(review.worsened, false);
});

test("a rewrite that scores worse is reported, not hidden", () => {
  const plain = "The tool reads a file and prints what it found.";
  const machine =
    "In today's rapidly evolving landscape, this groundbreaking solution serves " +
    "as a testament to the transformative power of innovation.";
  const review = scoreReview(plain, machine);
  assert.equal(review.worsened, true);
  assert.ok(review.delta > 0);
});

test("markdown structure is masked rather than scored as prose", () => {
  const withCode = "```js\nconst delve = 1;\n```\n\nA short sentence.";
  const scored = scoreForReview(withCode);
  assert.equal(typeof scored.score, "number");
});

test("a clean prose rewrite passes the automatic integrity review", () => {
  const result = reviewRewriteIntegrity(
    "**Part I**\n\nThe pump stopped after three turns.",
    "**Part I**\n\nAfter three turns, the pump stopped.",
  );
  assert.deepEqual(result, { passed: true, issues: [] });
});

test("the corrupted Harvard rewrite is rejected before automatic adoption", () => {
  const result = reviewRewriteIntegrity(
    "**Fragment I. Junghans, 1924**\n\nLichens are composite organisms.",
    "I. Junghans, 1924** * * + +\n\nehens are composite organisms.",
  );
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("Markdown")));
  assert.ok(result.issues.some((issue) => issue.includes("truncated")));
});

test("warnings become sentences that carry no user text", () => {
  const described = describeWarnings(
    [
      { code: "literal_invented", chunkIndex: 1, kinds: ["percent"], count: 1 },
      { code: "literal_invented", chunkIndex: 2, kinds: ["percent"], count: 1 },
      { code: "placeholder_lost", chunkIndex: 3, kinds: [], count: 1 },
    ],
    2,
  );
  assert.match(described.headline, /^2 sections kept their original wording/);
  // Repeated codes collapse; the reader gets reasons, not a log.
  assert.equal(described.details.length, 2);
  assert.ok(described.details.some((detail) => detail.includes("a percentage")));
  for (const detail of described.details) {
    assert.doesNotMatch(detail, /chunk|\[\[P|humanizer-service|127\.0\.0\.1/i);
  }
});

test("one reverted section is described in the singular", () => {
  const described = describeWarnings(
    [{ code: "literal_removed", chunkIndex: 0, kinds: ["citation"], count: 1 }],
    1,
  );
  assert.equal(
    described.headline,
    "1 section kept its original wording because the model's alternative did not pass the safety checks.",
  );
});

test("no reverted sections means no headline", () => {
  assert.equal(describeWarnings([], 0).headline, null);
});
