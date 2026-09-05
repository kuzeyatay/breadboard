// The relevance shortlist an agent-mode turn is offered, and the relevance
// ordering of the Super agent inventory.
//
// Two promises are pinned. A shortlist never selects a skill that another
// selector owns — the routed skills and the tool-gated ones — because for those
// selection means something more than "you may read this". And the offer is an
// offer: the wiring opens `skill_open` only when there is something to open,
// and the directive says nothing is in play until the model opens it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ROUTED_SKILLS,
  SKILL_SHORTLIST_LIMIT,
  renderSkillShortlistDirective,
  shortlistExclusions,
  shortlistSkillsForTurn,
} from "../src/lib/hermes/skill-shortlist.ts";
import { skillsOwningTools } from "../src/lib/hermes/capability-usage.ts";
import { ASCII_ART_DIAGRAMS_SKILL } from "../src/lib/hermes/ascii-diagram-intent.ts";
import { DIAGRAM_DESIGN_SKILL } from "../src/lib/hermes/diagram-intent.ts";
import { GITHUB_EXPLORER_SKILL } from "../src/lib/hermes/github-explorer-intent.ts";
import { HUMANIZE_SKILL } from "../src/lib/hermes/humanize-intent.ts";
import { COMPUTER_USE_SKILL } from "../src/lib/hermes/computer-use-intent.ts";
import { DIRECT_MODE_SKILL_SLUG } from "../src/lib/hermes/direct-mode.ts";
import {
  INTERACTIVE_VISUALIZER_SKILL,
  INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
} from "../src/lib/hermes/interactive-visualizer-skills.ts";
import { MUSIC_RECOGNITION_SKILL } from "../src/lib/music-recognition/context.ts";
import { GOAL_MODE_SKILL } from "../src/lib/goal-mode.ts";

// Line endings normalised: the plugin is checked out with CRLF on Windows and
// the assertions below span lines.
const source = (relativePath) =>
  fs
    .readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/\r\n/g, "\n");

const turnService = source("../src/lib/conversations/turn-service.ts");
const gardenAdapter = source("../src/lib/hermes/garden-chat-adapter.ts");
const superAgent = source("../src/lib/hermes/super-agent.ts");
const plugin = source("../../hermes-agent/plugins/breadboard/__init__.py");

const skills = [
  {
    slug: "spaced-repetition",
    name: "Spaced repetition",
    description:
      "Turn notes into flashcards and schedule reviews so the user remembers what they read.",
  },
  {
    slug: "diagram-design",
    name: "Diagram Design",
    description: "Draw a diagram as one self-contained HTML file with inline SVG.",
  },
  {
    slug: "premortem",
    name: "Premortem",
    description: "Facilitate a pre-mortem for a planned initiative.",
  },
  {
    slug: "ask-sonner",
    name: "Ask Sonner",
    description: "Guide to Sonner, the React toast library.",
  },
];

test("routed skills are pinned to the constants their routers export", () => {
  for (const slug of [
    ASCII_ART_DIAGRAMS_SKILL,
    DIAGRAM_DESIGN_SKILL,
    GITHUB_EXPLORER_SKILL,
    HUMANIZE_SKILL,
    COMPUTER_USE_SKILL,
    DIRECT_MODE_SKILL_SLUG,
    INTERACTIVE_VISUALIZER_SKILL,
    INTERACTIVE_VISUALIZER_IN_CHAT_SKILL,
    MUSIC_RECOGNITION_SKILL,
    GOAL_MODE_SKILL,
    "watch",
    "patent-disclosure-skill",
    "image-to-3d",
    "spotify",
    "audio-analysis",
    "premortem",
    "bullshit-detector",
    "send-to-my-phone",
    "agent-loop-engineering",
  ]) {
    assert.ok(ROUTED_SKILLS.has(slug), `${slug} must be a routed skill`);
  }
});

test("the exclusions cover every skill whose selection unlocks a tool", () => {
  const exclusions = shortlistExclusions();
  for (const slug of skillsOwningTools()) {
    assert.ok(exclusions.has(slug), `${slug} owns a tool and must be excluded`);
  }
  // Sanity on the derivation itself: the routes that check their own skill.
  for (const slug of ["watch", "oh-my-hermes", "manim", "office"]) {
    assert.ok(skillsOwningTools().has(slug));
  }
});

test("a shortlist offers matching skills and never a routed or tool-gated one", () => {
  const offered = shortlistSkillsForTurn({
    request: "turn my lecture notes into flashcards I can review",
    skills,
  });
  assert.deepEqual(
    offered.map((skill) => skill.slug),
    ["spaced-repetition"],
  );
  assert.ok(offered[0].matched.includes("flashcard"));
  assert.ok(offered.length <= SKILL_SHORTLIST_LIMIT);

  // Diagram Design has a router that looked at this message and declined, and
  // Premortem's selection would unlock `premortem_run`. Neither is offered
  // however well the words match.
  assert.deepEqual(
    shortlistSkillsForTurn({
      request: "draw a diagram of the premortem for the launch",
      skills,
    }),
    [],
  );
});

test("the directive is an offer, and empty when there is nothing to offer", () => {
  assert.equal(renderSkillShortlistDirective([]), "");
  const text = renderSkillShortlistDirective(
    shortlistSkillsForTurn({
      request: "add toast notifications with sonner",
      skills,
    }),
  );
  assert.ok(text.startsWith("# relevant_skills"));
  assert.ok(text.includes("`skill_open`"));
  assert.ok(text.includes("None is in play yet"));
  assert.ok(text.includes("- ask-sonner — Ask Sonner:"));
});

test("the Terminal turn service offers a shortlist only when nothing else claimed the turn", () => {
  const block = turnService.slice(
    turnService.indexOf("const skillShortlist ="),
    turnService.indexOf("// A goal reaches a turn one of two ways"),
  );
  assert.ok(block.includes("!superAgent"));
  assert.ok(block.includes('input.surface !== "quartz_ai"'));
  assert.ok(block.includes("input.internalAgentContinuation !== true"));
  assert.ok(block.includes("decision.selectedConditionalSkills.length === 0"));
  assert.ok(block.includes("shortlistSkillsForTurn("));
  assert.ok(block.includes("openableSkills("));
  // Selected so the route serves them, and the tool opened only then.
  assert.ok(block.includes('"skill_open"'));
  assert.ok(
    turnService.includes(
      "...(skillShortlist.length > 0 ? { skill_open: true } : {}),",
    ),
  );
  assert.ok(turnService.includes("renderSkillShortlistDirective(skillShortlist)"));
  assert.ok(turnService.includes("suggestedSkills: skillShortlist.map"));
});

test("Garden Chat makes the same offer under the same condition", () => {
  const block = gardenAdapter.slice(
    gardenAdapter.indexOf("const skillShortlist ="),
    gardenAdapter.indexOf("// Whether this turn owes live web evidence"),
  );
  assert.ok(block.includes("decision.selectedConditionalSkills.length === 0"));
  assert.ok(block.includes('openableSkills(\n              "garden_chat"'));
  assert.ok(block.includes('"skill_open"'));
  assert.ok(
    gardenAdapter.includes(
      "...(skillShortlist.length > 0 ? { skill_open: true } : {}),",
    ),
  );
  assert.ok(gardenAdapter.includes("renderSkillShortlistDirective(skillShortlist)"));
});

test("the Super agent inventory is ordered by the request and lists every slug", () => {
  assert.ok(superAgent.includes("request: resolved.userText || input.text") || turnService.includes("request: resolved.userText || input.text"));
  assert.ok(superAgent.includes("orderSkillsForRequest("));
  assert.ok(superAgent.includes("rankSkillsForRequest(request, skills)"));
  assert.ok(superAgent.includes("moreSkillSlugs: skills.slugs.slice(MAX_DESCRIBED_SKILLS, slugOnlyCut)"));
  assert.ok(superAgent.includes("Also installed, by slug:"));
  // The old prefix listing hid everything past the first 120.
  assert.equal(superAgent.includes("MAX_LISTED_SKILLS"), false);
});

test("the plugin's skill_open description no longer says Super agent only", () => {
  const start = plugin.indexOf('"skill_open",\n        "/api/hermes/tools/skill"');
  const description = plugin.slice(start, start + 1400);
  assert.equal(description.includes("Only available while Super agent"), false);
  assert.ok(description.includes("relevant_skills"));
});
