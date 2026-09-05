// Ranking installed skills against a request.
//
// The ranker is what decides which skills a Super agent turn can see and which
// an agent-mode turn is offered, so the things pinned here are the judgements a
// person would make from the same words: a slug or name match outranks a stray
// description word, a phrase beats scattered terms, a word half the catalogue
// shares does not crown one of its members, and a greeting matches nothing.

import test from "node:test";
import assert from "node:assert/strict";
import {
  rankSkillsForRequest,
  requestTerms,
  shortlistSkills,
} from "../src/lib/hermes/skill-relevance.ts";

const catalogue = [
  {
    slug: "ask-sonner",
    name: "Ask Sonner",
    description:
      "Guide to Sonner, the React toast library — install and wire up the Toaster, pick the right toast() call, promise and loading toasts, styling and theming.",
  },
  {
    slug: "apple-design",
    name: "Apple design",
    description:
      "Apple's approach to interface design and fluid, physical motion, translated for the web. Use when building gesture-driven UI, spring animations, sheets.",
  },
  {
    slug: "animate",
    name: "Animate",
    description:
      "Build an animation from scratch, deciding whether it should animate at all, which properties, which curve and duration, how it interrupts and exits.",
  },
  {
    slug: "spaced-repetition",
    name: "Spaced repetition",
    description:
      "Turn notes into flashcards and schedule reviews with an SM-2 style interval so the user remembers what they read.",
  },
  {
    slug: "office",
    name: "Office documents",
    description:
      "Create, inspect and edit real Office documents — Word (.docx), Excel (.xlsx), PowerPoint (.pptx) — with the OfficeCLI document DOM.",
  },
  {
    slug: "premortem",
    name: "Premortem",
    description:
      "Facilitate a Gary Klein-style pre-mortem for a planned initiative, identify concrete failure paths from distinct stakeholder perspectives.",
  },
  {
    slug: "diagram-design",
    name: "Diagram Design",
    description:
      "Draw a diagram as one self-contained HTML file with inline SVG — architecture, flowchart, sequence, state machine, ER/data model, timeline.",
  },
  {
    slug: "long-winded",
    name: "Long winded",
    description:
      "design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design design toast",
  },
];

test("request terms drop function words and stem plurals", () => {
  assert.deepEqual(
    requestTerms("Can you please make me some flashcards from these notes?"),
    ["flashcard", "note"],
  );
  assert.deepEqual(requestTerms("hi there"), []);
  // Short technical tokens survive; two-letter noise does not.
  assert.deepEqual(requestTerms("turn this into a 3d model in js"), [
    "3d",
    "model",
    "js",
  ]);
});

test("a slug or name match outranks a description mention", () => {
  const ranked = rankSkillsForRequest(
    "I need toast notifications in my React app with Sonner",
    catalogue,
  );
  assert.equal(ranked[0].skill.slug, "ask-sonner");
  // The padded description mentions "toast" once and is discounted for its
  // length; it must not beat the skill actually named in the request.
  assert.ok(
    ranked.findIndex((entry) => entry.skill.slug === "long-winded") > 0,
  );
  assert.ok(ranked[0].matched.includes("sonner"));
});

test("every candidate is returned, zero scores last in name order", () => {
  const ranked = rankSkillsForRequest("make flashcards from my notes", catalogue);
  assert.equal(ranked.length, catalogue.length);
  assert.equal(ranked[0].skill.slug, "spaced-repetition");
  const zeros = ranked.filter((entry) => entry.score === 0);
  assert.deepEqual(
    zeros.map((entry) => entry.skill.name),
    [...zeros.map((entry) => entry.skill.name)].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
});

test("an empty request keeps the catalogue in name order with zero scores", () => {
  const ranked = rankSkillsForRequest("", catalogue);
  assert.ok(ranked.every((entry) => entry.score === 0));
  assert.equal(ranked[0].skill.name, "Animate");
});

test("a verbatim phrase from the request earns a bonus", () => {
  const withPhrase = rankSkillsForRequest(
    "draw a state machine for the checkout flow",
    catalogue,
  );
  assert.equal(withPhrase[0].skill.slug, "diagram-design");
  const scattered = rankSkillsForRequest(
    "the machine is in a bad state, draw something",
    catalogue,
  );
  const phraseScore = withPhrase[0].score;
  const scatteredScore = scattered.find(
    (entry) => entry.skill.slug === "diagram-design",
  ).score;
  assert.ok(phraseScore > scatteredScore);
});

test("the shortlist refuses greetings, weak matches and excluded slugs", () => {
  assert.deepEqual(shortlistSkills("hello", catalogue), []);
  assert.deepEqual(shortlistSkills("thanks, that helps", catalogue), []);
  // One description word in a long description is not a confident match.
  assert.deepEqual(
    shortlistSkills("what is the weather like in the fluid", catalogue),
    [],
  );
  const offered = shortlistSkills(
    "run a premortem on the launch plan",
    catalogue,
  );
  assert.equal(offered[0].skill.slug, "premortem");
  assert.deepEqual(
    shortlistSkills("run a premortem on the launch plan", catalogue, {
      exclude: ["premortem"],
    }).map((entry) => entry.skill.slug),
    [],
  );
});

test("the shortlist is capped and ordered best first", () => {
  const offered = shortlistSkills(
    "animate the sheet with an apple-style spring and toast when it lands",
    catalogue,
    { limit: 2 },
  );
  assert.equal(offered.length, 2);
  assert.ok(offered[0].score >= offered[1].score);
  const slugs = offered.map((entry) => entry.skill.slug);
  assert.ok(slugs.includes("apple-design") || slugs.includes("animate"));
});

test("a term most of the catalogue shares is discounted", () => {
  const crowd = Array.from({ length: 8 }, (_, index) => ({
    slug: `design-${index}`,
    name: `Design ${index}`,
    description: `Design guidance number ${index} for design work.`,
  }));
  const catalogueWithCrowd = [
    ...crowd,
    {
      slug: "logo-maker",
      name: "Logo maker",
      description: "Sketch a logo from a brief and export it as SVG.",
    },
  ];
  const ranked = rankSkillsForRequest("design a logo for my bakery", catalogueWithCrowd);
  assert.equal(ranked[0].skill.slug, "logo-maker");
});
