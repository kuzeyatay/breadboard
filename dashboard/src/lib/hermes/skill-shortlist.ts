// The relevance shortlist an agent-mode turn is offered when nobody picked a skill.
//
// Agent mode selects a skill in one of two ways: the user types `/its-slug`, or
// one of the hand-written routers in the pre-dispatch chain recognises its
// subject — a video attachment for Watch, "draw a diagram" for Diagram Design.
// Every other installed skill is unreachable on an ordinary turn, however well
// its description fits the request, because nothing looks at the catalogue.
//
// This module is what looks. When the chain selects nothing, the request is
// ranked against the skills a Super agent turn would be allowed to open, and
// the confident matches are offered to the model behind `skill_open`: the slug,
// the name and one line, no guidance yet. The model opens one when it covers
// the task and ignores the section when none does. That is deliberately weaker
// than what a router does — a router injects the skill's guidance as though the
// user had typed the command — because a router fires on its own wording and a
// lexical match can be wrong, and a wrongly injected skill rewrites the turn
// while a wrongly offered one costs a glance at one line.
//
// Two groups are never lexically shortlisted. Skills whose selection unlocks a tool
// (`skillsOwningTools`) — selecting one here would turn a guess about relevance
// into a grant. And skills the chain already routes: the router looked at this
// exact message and declined, and offering the skill anyway second-guesses a
// selector that knows its own subject better than word overlap does.
// Computer-control guidance has a separate, permission-aware offer below: its
// tools are already brokered, and UI work can arise midway through any task.

import { skillsOwningTools } from "./capability-usage.ts";
import {
  shortlistSkills,
  type RankedSkill,
  type SkillRelevanceCandidate,
} from "./skill-relevance.ts";

export interface ShortlistedSkill {
  slug: string;
  name: string;
  description: string;
  /** Request terms that matched, strongest field first. */
  matched: string[];
  score: number;
}

/** How many skills a turn is offered at most. */
export const SKILL_SHORTLIST_LIMIT = 3;
const DESCRIPTION_MAX = 140;

/**
 * Skills with a router in the pre-dispatch chain, by slug. Kept as literals
 * rather than imported from the intent modules so this module stays free of
 * their dependencies; skill-shortlist.test.mjs pins each one against the
 * constant its router exports.
 */
export const ROUTED_SKILLS: ReadonlySet<string> = new Set([
  // The whole reviewed text-to-cad family has one domain router. Keeping every
  // member out of the lexical fallback means a CAD request is selected once,
  // by the format/process-aware rule, rather than offered a competing trio.
  "bambu-labs",
  "cad",
  "cad-viewer",
  "dfam-check",
  "dxf",
  "gcode",
  "implicit-cad",
  "sdf",
  "sendcutsend",
  "srdf",
  "step-parts",
  "urdf",
  "watch",
  // Film owns the render tool and has the router; Video shares that tool and is
  // reached by its own command, so neither is offered by the lexical fallback.
  "video",
  "film",
  "patent-disclosure-skill",
  "image-to-3d",
  "spotify",
  "audio-analysis",
  "recognize-music",
  "ascii-art-diagrams",
  "diagram-design",
  "diagram-in-chat",
  "github-explorer",
  "humanize",
  "computer-use",
  "premortem",
  "bullshit-detector",
  "send-to-my-phone",
  "agent-loop-engineering",
  "interactive-visualizer",
  "interactive-visualizer-in-chat",
  "goal",
  // A mode switch worn by the whole conversation, not a skill for a request.
  "i-have-adhd",
]);

/** Every slug the shortlist refuses to offer. */
export function shortlistExclusions(): ReadonlySet<string> {
  return new Set([...ROUTED_SKILLS, ...skillsOwningTools()]);
}

function oneLine(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * The skills to offer this turn, or none. `skills` is the openable catalogue —
 * what `skill_open` would accept — so anything returned is guaranteed readable
 * once the caller selects it.
 */
export function shortlistSkillsForTurn<T extends SkillRelevanceCandidate>(input: {
  request: string;
  skills: readonly T[];
  limit?: number;
}): ShortlistedSkill[] {
  return shortlistSkills(input.request, input.skills, {
    limit: input.limit ?? SKILL_SHORTLIST_LIMIT,
    exclude: shortlistExclusions(),
  }).map((entry: RankedSkill<T>) => ({
    slug: entry.skill.slug,
    name: entry.skill.name,
    description: oneLine(entry.skill.description, DESCRIPTION_MAX),
    matched: entry.matched,
    score: entry.score,
  }));
}

/** Computer control can become useful after another route fails. Offer its
 * operating instructions independently of phrase matching, but only when the
 * broker already granted the corresponding tool. Reading a skill grants no
 * additional authority. Already injected guidance need not be offered again. */
export function computerUseSkillChoices(input: {
  skills: readonly SkillRelevanceCandidate[];
  allowedTools: Readonly<Record<string, boolean>>;
  selectedSkills: readonly string[];
}): ShortlistedSkill[] {
  return [
    ["breadboard-use", "breadboard_use"],
    ["computer-use", "computer_use"],
  ].flatMap(([slug, tool]) => {
    if (input.allowedTools[tool] !== true || input.selectedSkills.includes(slug)) return [];
    const skill = input.skills.find(candidate => candidate.slug === slug);
    return skill ? [{
      slug: skill.slug, name: skill.name,
      description: oneLine(skill.description, DESCRIPTION_MAX),
      matched: [], score: 0,
    }] : [];
  });
}

/**
 * The system-prompt section that offers the shortlist. Stated as an offer, not
 * a selection: nothing is in play until the model opens one, and a request the
 * shortlist misjudged should be answered as if the section were not there.
 */
export function renderSkillShortlistDirective(
  shortlist: readonly ShortlistedSkill[],
): string {
  if (shortlist.length === 0) return "";
  return [
    "# relevant_skills",
    "Reviewed skills available for this turn. None is in play yet. When one covers the task better than a procedure of your own, call `skill_open` with its slug, read the guidance, and follow it before acting; open more than one only when the work spans them. Discover deferred tools with tool_search. When none fits, ignore this section — do not mention it, list it, or explain why you did not use it.",
    ...(shortlist.some(skill => skill.slug === "breadboard-use" || skill.slug === "computer-use") ? [
      "Computer-control skills listed here are possible instruments, not instructions to operate anything: breadboard-use controls Breadboard pages and its built-in browser; computer-use operates another native app when a direct tool cannot complete the task.",
    ] : []),
    ...shortlist.map(
      (skill) => `- ${skill.slug} — ${skill.name}: ${skill.description}`,
    ),
  ].join("\n");
}
