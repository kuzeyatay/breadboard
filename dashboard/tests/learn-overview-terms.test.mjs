import test from "node:test";
import assert from "node:assert/strict";
import {
  OVERVIEW_TERM_REVIEW_PROMPT,
  overviewTermReviewProblems,
  overviewUnitSummaries,
} from "../src/lib/learn-overview-terms.ts";

test("an unexplained term doing explanatory work becomes a repair problem naming the sentence", () => {
  const { problems, reviewError } = overviewTermReviewProblems({
    terms: [
      { term: "MAC", status: "explained" },
      { term: "Erlang C", status: "named_only" },
      {
        term: "trunk",
        status: "unexplained",
        sentence: "Pooling more channels also changes the statistical efficiency of the trunk.",
        missing: "a trunk is the shared pool of channels calls draw from",
      },
    ],
  });
  assert.equal(reviewError, undefined);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^unexplained-term: the overview relies on "trunk"/);
  assert.match(problems[0], /statistical efficiency of the trunk/);
  assert.match(problems[0], /shared pool of channels/);
});

test("a malformed term review is reported instead of silently passing the overview", () => {
  assert.match(overviewTermReviewProblems({}).reviewError, /no "terms" array/);
  assert.match(overviewTermReviewProblems({ terms: [{ term: "code", status: "maybe" }] }).reviewError, /invalid term entry/);
});

test("the overview writer gets each unit's question and new concepts in reading order", () => {
  const summaries = overviewUnitSummaries([
    {
      title: "2. Traffic Load and Blocking Capacity",
      purpose: "Relate call demand to blocking.",
      subsections: [
        { title: "Traffic Intensity and Trunking", learningQuestion: "How does demand load a pool of channels?", newConcepts: ["trunk", "Erlang"], prerequisiteConcepts: ["channel"] },
      ],
    },
  ]);
  assert.deepEqual(summaries[0].units[0], {
    title: "Traffic Intensity and Trunking",
    learningQuestion: "How does demand load a pool of channels?",
    newConcepts: ["trunk", "Erlang"],
    prerequisiteConcepts: ["channel"],
  });
  assert.match(OVERVIEW_TERM_REVIEW_PROMPT, /"unexplained": a sentence depends on knowing what it means/);
});
