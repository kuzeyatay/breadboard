import test from "node:test";
import assert from "node:assert/strict";
import { LESSON_TERM_REVIEW_PROMPT, lessonTermReviewProblems } from "../src/lib/learn-lesson-terms.ts";

test("unexplained terms become hard repair problems; explained and earlier-taught terms do not", () => {
  // Live 2026-09-16 (telecom-1 M2 1.1): "a distributed algorithm: every user
  // follows a common decision procedure" replaced one undefined phrase with
  // another and the critic let it through.
  const outcome = lessonTermReviewProblems({
    terms: [
      { term: "arbiter", status: "explained_here" },
      { term: "shared medium", status: "taught_earlier" },
      {
        term: "common decision procedure",
        status: "unexplained",
        sentence: "Another possibility is a distributed algorithm: every user follows a common decision procedure so that access can be coordinated through agreed rules.",
        missing: "what rule each station runs locally, e.g. listen before sending and back off after a collision",
      },
      { term: "Common Decision Procedure", status: "unexplained", sentence: "dup" },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1, "duplicates collapse case-insensitively");
  const [problem] = outcome.problems;
  assert.equal(problem.code, "unexplained-term");
  assert.equal(problem.hard, true);
  assert.match(problem.message, /common decision procedure/);
  assert.match(problem.message, /listen before sending/);
  assert.deepEqual(problem.evidence, ["Another possibility is a distributed algorithm: every user follows a common decision procedure so that access can be coordinated through agreed rules."]);
});

test("a malformed review is reported as a review error, never as a clean page", () => {
  assert.match(lessonTermReviewProblems({ nope: true }).reviewError, /no "terms" array/);
  assert.match(lessonTermReviewProblems({ terms: [{ term: "x", status: "maybe" }] }).reviewError, /invalid term entry/);
  assert.deepEqual(lessonTermReviewProblems({ terms: [] }).problems, []);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /gloss/i);
});

test("restated ideas become hard repair problems carrying every repeated sentence", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 4.1): the opening said "divide
  // access by time", the next paragraph said "TDMA chooses time as the
  // dimension", the next "divides the time axis into short intervals".
  const outcome = lessonTermReviewProblems({
    terms: [],
    restatements: [
      {
        idea: "TDMA divides the carrier by time",
        sentences: [
          "One clean solution is to divide access by time: user A transmits for a short interval, then user B, then user C, and the pattern repeats.",
          "TDMA chooses time as the dimension used for that division.",
          "Instead of letting every assigned user transmit continuously, the system divides the time axis into short intervals.",
        ],
      },
      { idea: "stated once", sentences: ["Only one sentence says this."] },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1, "a single statement is not a repeat");
  const [problem] = outcome.problems;
  assert.equal(problem.code, "restated-idea");
  assert.equal(problem.hard, true);
  assert.match(problem.message, /3 times/);
  assert.equal(problem.evidence.length, 3);
  assert.match(lessonTermReviewProblems({ terms: [], restatements: "no" }).reviewError, /non-array/);
  assert.match(lessonTermReviewProblems({ terms: [], restatements: [{ idea: "", sentences: [] }] }).reviewError, /invalid restatement/);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /restatement/i);
});

test("a concept defined only in the abstract becomes a hard floating-concept problem", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 4.1): "TDMA frame" was defined
  // as "a recurring timing structure ... those values depend on the radio
  // system" with no slots, no durations, no system to picture.
  const outcome = lessonTermReviewProblems({
    terms: [],
    restatements: [],
    concepts: [
      { concept: "time slot", grounding: "concrete" },
      {
        concept: "TDMA frame",
        grounding: "abstract_only",
        definition: "The repeating organization of these transmission opportunities is called a TDMA frame.",
        example: "GSM: one carrier, 8 slots per 4.615 ms frame, each user transmitting in its slot once per frame",
      },
      { concept: "tdma frame", grounding: "abstract_only", definition: "dup" },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1);
  const [problem] = outcome.problems;
  assert.equal(problem.code, "floating-concept");
  assert.equal(problem.hard, true);
  assert.match(problem.message, /GSM/);
  assert.match(problem.message, /values depend on the system is not an example/);
  assert.deepEqual(problem.evidence, ["The repeating organization of these transmission opportunities is called a TDMA frame."]);
  assert.match(lessonTermReviewProblems({ terms: [], concepts: [{ concept: "x", grounding: "vague" }] }).reviewError, /invalid concept/);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /abstract_only/);
});

test("a result stated without its derivation becomes a hard unshown-result problem", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 4.1): "with the full-rate speech
  // coder, one radio channel supports three users" - never shown how.
  const outcome = lessonTermReviewProblems({
    terms: [],
    restatements: [],
    concepts: [],
    results: [
      { result: "48.6 kbps channel rate", status: "asserted_with_notice" },
      {
        result: "three users per radio channel",
        status: "unshown",
        sentence: "With the full-rate speech coder, one radio channel supports three users.",
        needed: "48.6 kbps over six slots per frame, two slots per full-rate user, so 16.2 kbps each carrying a 7.95 kbps coded voice stream plus coding",
      },
      { result: "Three users per radio channel", status: "unshown", sentence: "dup" },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1);
  const [problem] = outcome.problems;
  assert.equal(problem.code, "unshown-result");
  assert.equal(problem.hard, true);
  assert.match(problem.message, /six slots per frame/);
  assert.match(problem.message, /never present an unexplained number as obvious/);
  assert.deepEqual(problem.evidence, ["With the full-rate speech coder, one radio channel supports three users."]);
  assert.match(lessonTermReviewProblems({ terms: [], results: [{ result: "x", status: "true" }] }).reviewError, /invalid result/);
});

test("a purpose-only gloss the page then reasons with is a hard shallow-explanation problem", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 4.1): "error correction coding",
  // "tail bits" named for their purpose and used in the argument, never taught.
  const outcome = lessonTermReviewProblems({
    terms: [
      {
        term: "channel coding",
        status: "shallow",
        sentence: "The listed USDC parameters include a CRC and convolutional channel coding, so the channel carries structured information beyond the coded speech.",
        missing: "how a convolutional coder turns k input bits into n output bits, the rate it costs (e.g. rate 1/2 doubles the bit count), and what a corrected error looks like",
      },
      { term: "tail bits", status: "unexplained", sentence: "Tail bits end each burst." },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.deepEqual(outcome.problems.map((problem) => problem.code), ["shallow-explanation", "unexplained-term"]);
  const [shallow] = outcome.problems;
  assert.equal(shallow.hard, true);
  assert.match(shallow.message, /never teaches how it works/);
  assert.match(shallow.message, /rate 1\/2 doubles the bit count/);
  assert.match(shallow.message, /outside this lesson/);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /"shallow"/);
});

test("a callout the reader cannot use is a hard unearned-callout problem", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 4.1): a warning "do not confuse
  // TDMA with TDD" on a page that never explained duplexing.
  const outcome = lessonTermReviewProblems({
    terms: [],
    callouts: [
      { kind: "note", text: "The Erlang C derivation is taken up in 3.1.", verdict: "earned" },
      {
        kind: "warning",
        text: "TDMA and time division duplexing (TDD) use time for different assignments.",
        verdict: "unearned",
        reason: "TDD and duplexing are never taught on this page or earlier, so the reader cannot confuse them",
      },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1);
  const [problem] = outcome.problems;
  assert.equal(problem.code, "unearned-callout");
  assert.equal(problem.hard, true);
  assert.match(problem.message, /warning callout contributes nothing/);
  assert.match(problem.message, /never taught on this page/);
  assert.deepEqual(problem.evidence, ["TDMA and time division duplexing (TDD) use time for different assignments."]);
  assert.match(lessonTermReviewProblems({ terms: [], callouts: [{ kind: "tip", text: "x", verdict: "earned" }] }).reviewError, /invalid callout/);
});

test("a paragraph that teaches an earlier unit's concept again is a hard reteaches-earlier-unit problem", () => {
  // Reader feedback 2026-09-16 (telecom-1 M2 section 4): resource partitioning
  // was introduced in 1.2 and then re-introduced on every page of section 4.
  const outcome = lessonTermReviewProblems({
    terms: [],
    reteaching: [
      { concept: "resource partitioning", paragraph: "The starting point is resource partitioning.", reason: "re-motivates finite spectrum" },
      { concept: "Resource partitioning", paragraph: "A radio system has a finite amount of spectrum, so supporting many users requires some way to divide it.", reason: "redefines" },
      { concept: "resource partitioning", paragraph: "The starting point is resource partitioning.", reason: "dup" },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1, "one problem per earlier concept");
  const [problem] = outcome.problems;
  assert.equal(problem.code, "reteaches-earlier-unit");
  assert.equal(problem.hard, true);
  assert.equal(problem.evidence.length, 2);
  assert.match(problem.message, /one-sentence reminder/);
  assert.match(lessonTermReviewProblems({ terms: [], reteaching: [{ concept: "", paragraph: "x" }] }).reviewError, /invalid reteaching/);
});

test("a later unit's concept named as a destination passes; reasoning built on it is leans-on-later-unit, never explained here", () => {
  // Generation #10 (telecom-1 1.1, 2026-09-16): the reviewer marked FDMA and
  // CDMA - later units - as shallow, the repair tried to teach them on the
  // intro page, and the findings never converged.
  const outcome = lessonTermReviewProblems({
    terms: [
      { term: "FDMA", status: "named_later", laterUnit: true },
      {
        term: "CDMA",
        status: "unexplained",
        laterUnit: true,
        sentence: "Because CDMA lets every user transmit at once, the access rule can be relaxed.",
        missing: "state only that a later lesson separates users by code",
      },
    ],
  });
  assert.equal(outcome.reviewError, undefined);
  assert.equal(outcome.problems.length, 1);
  const [problem] = outcome.problems;
  assert.equal(problem.code, "leans-on-later-unit");
  assert.match(problem.message, /Do not explain it here/);
  assert.deepEqual(problem.evidence, ["Because CDMA lets every user transmit at once, the access rule can be relaxed."]);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /"named_later"/);
});

test("the review hands back what it accepted so the next review keeps those verdicts", () => {
  const outcome = lessonTermReviewProblems({
    terms: [{ term: "arbiter", status: "explained_here" }, { term: "slot", status: "unexplained", sentence: "s" }],
    concepts: [{ concept: "frame", grounding: "concrete" }],
    results: [{ result: "three users", status: "shown" }],
    callouts: [{ kind: "note", text: "Taken up in 3.1.", verdict: "earned" }],
  });
  assert.deepEqual(outcome.accepted, {
    termsFine: ["arbiter"],
    conceptsConcrete: ["frame"],
    resultsShown: ["three users"],
    calloutsEarned: ["Taken up in 3.1."],
  });
  assert.equal(outcome.problems.length, 1);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /priorVerdicts/);
});

// 11.1 of telecom-1 M2 burned all four attempts on two demands it could never
// meet (2026-09-17): the reviewer called the imaginary unit an unexplained
// course term and wanted a fiber lesson to teach that j squared is minus one,
// and it marked the V number abstract_only while itself recording that the
// assigned sources do not establish the numbers such an example would need.
test("ordinary engineering mathematics is background, not a term this course teaches", () => {
  assert.match(LESSON_TERM_REVIEW_PROMPT, /imaginary unit/i);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /phasor/i);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /taught_earlier/);
  // The exemption must be conditional, or a course that really does teach
  // complex notation would lose its own gate.
  assert.match(LESSON_TERM_REVIEW_PROMPT, /only when the course itself introduces them/i);
});

test("a concept the sources cannot ground is not floating; the boundary sentence anchors it", () => {
  assert.match(LESSON_TERM_REVIEW_PROMPT, /source boundary applies here/i);
  assert.match(LESSON_TERM_REVIEW_PROMPT, /never record a concept as abstract_only/i);
  // And the escape stays narrow: a concept the sources do ground still needs
  // its instance, which is the rule the whole grounding check exists for.
  assert.match(LESSON_TERM_REVIEW_PROMPT, /Abstract_only is for a concept whose instance the sources do supply/i);
});
