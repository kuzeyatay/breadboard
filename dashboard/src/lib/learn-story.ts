// A lesson page is a short story plus two appendices. The story is the only
// part that teaches; `## Practice` holds the assigned exercises and
// `## More from the sources` holds assigned figures and formulas the story did
// not need. Coverage stays complete without forcing every artifact into the
// explanation, which is what made lessons thirty times longer than a student's
// own notes on the same course (electromagnetism-1, 2026-11-09).
//
// Length follows the number of ideas: the story has a word ceiling computed
// from the teaching plan's steps, and a repair may not grow the page unless a
// reader could not follow it. No function here rewrites learner prose.

import type { QualityProblem } from "./learn-utils.ts";

export const PRACTICE_HEADING = "## Practice";
export const SOURCE_EXTRAS_HEADING = "## More from the sources";

/** A stub below this is not a lesson; there is no other length floor. */
export const MIN_LESSON_STORY_WORDS = 120;

/** Content repairs one draft may receive. Eight additive rounds was the loop
 * that grew pages; a page three targeted fixes cannot rescue needs a new
 * draft, not a ninth paragraph. */
export const MAX_LESSON_REPAIRS = 3;

const STORY_WORDS_BASE = 180;
const STORY_WORDS_PER_STEP = 110;
const STORY_WORDS_MIN = 350;
const STORY_WORDS_MAX = 1500;

/** Prose-word ceiling for the story of a lesson whose plan has `steps` ideas. */
export function lessonStoryWordCeiling(steps: number): number {
  const planned = STORY_WORDS_BASE + STORY_WORDS_PER_STEP * Math.max(1, Math.floor(steps) || 1);
  return Math.min(STORY_WORDS_MAX, Math.max(STORY_WORDS_MIN, planned));
}

/** The number a writer is given: models overshoot a stated word limit by
 * about 15%, and a first draft over the ceiling costs a repair round. */
export function lessonStoryWordTarget(ceiling: number): number {
  return Math.round(ceiling * 0.85);
}

function appendixStart(markdown: string): number {
  let inFence = false;
  let offset = 0;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && /^##\s+(Practice|More from the sources)\s*$/i.test(line)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** The teaching part of a page: everything before its first appendix. */
export function lessonStory(markdown: string): string {
  const start = appendixStart(markdown);
  return start < 0 ? markdown : markdown.slice(0, start);
}

/** The appendices of a page, or "" when it has none. */
export function lessonAppendices(markdown: string): string {
  const start = appendixStart(markdown);
  return start < 0 ? "" : markdown.slice(start);
}

/** Prose words of the story, outside mathematics, figures, tables, code,
 * collapsed answers, markers and the compiled reference list. */
export function lessonStoryWordCount(markdown: string): number {
  const text = lessonStory(markdown)
    .replace(/^---\n[\s\S]*?\n---\n/, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<details>[\s\S]*?<\/details>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^\*\*References\*\*[\s\S]*$/m, " ")
    .replace(/[#>*_`|-]+/g, " ");
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

/** Review and gate codes that ask the page for something it lacks. Every
 * other code asks for less, or for the same amount said correctly. */
const ADDITIVE_PROBLEM_CODES = new Set([
  "unexplained-term", "shallow-explanation", "floating-concept", "unshown-result",
  "incorrect-result", "broken-learning-sequence", "leans-on-later-unit",
  "unverified-prerequisite", "missing-teaching-coverage", "short", "empty",
  "missing-visual", "missing-source-formula", "missing-source-question", "missing-practice",
]);

export function problemAsksForMore(problem: Pick<QualityProblem, "code">): boolean {
  return ADDITIVE_PROBLEM_CODES.has(problem.code);
}

/** Words a repair may add per additive finding before it counts as growth. */
const REPAIR_WORDS_PER_ADDITIVE_PROBLEM = 90;
const REPAIR_GROWTH_SLACK = 25;

/** A repair must return the whole page, and one that makes the story longer
 * than its findings justify is the additive loop again. The caller keeps the earlier draft and repairs once
 * more with this problem listed; the model does the rewriting, never code. */
export function repairGrowthProblem(
  before: string,
  after: string,
  problems: readonly Pick<QualityProblem, "code">[],
): QualityProblem | null {
  const previous = lessonStoryWordCount(before);
  const next = lessonStoryWordCount(after);
  // A model that fails to return the page answers with a sentence saying so
  // ("I could not produce the repaired page"). Later repairs then worked on
  // that sentence instead of the lesson (benchmark, 2026-11-10).
  if (previous >= MIN_LESSON_STORY_WORDS && next < previous / 2) {
    return {
      code: "repair-collapse",
      hard: true,
      message: `the repair returned ${next} prose words in place of a ${previous}-word story. Return the complete page with only the listed problems fixed.`,
    };
  }
  const allowance = REPAIR_GROWTH_SLACK + REPAIR_WORDS_PER_ADDITIVE_PROBLEM * problems.filter(problemAsksForMore).length;
  if (next <= previous + allowance) return null;
  return {
    code: "repair-growth",
    hard: true,
    message: `the repair grew the story from ${previous} to ${next} prose words, more than its ${problems.filter(problemAsksForMore).length} missing-step finding(s) justify. Make each fix with the fewest sentences that close the gap and add nothing else.`,
  };
}

/** Deterministic length and placement checks for a story being drafted.
 * Without a ceiling the page is a published one, written before pages had
 * appendices, and is never failed for where its exercises sit. */
export function lessonStoryProblems(markdown: string, options: { maxStoryWords?: number } = {}): QualityProblem[] {
  const problems: QualityProblem[] = [];
  const story = lessonStory(markdown);
  const words = lessonStoryWordCount(markdown);
  if (options.maxStoryWords && words > Math.ceil(options.maxStoryWords * 1.1)) {
    problems.push({
      code: "over-length",
      hard: true,
      message: `the story holds ${words} prose words; its ceiling is ${options.maxStoryWords}. Cut previews, recaps, repeated statements and explanation of the explanation until it fits; keep every derivation step and the need that motivates each idea.`,
    });
  }
  const strayExercises = options.maxStoryWords ? story.match(/^\s*\*\*Question\.\*\*.*$/gm) ?? [] : [];
  if (strayExercises.length > 0) {
    problems.push({
      code: "exercise-in-story",
      hard: true,
      message: `an exercise sits inside the story; move it, unchanged, under "${PRACTICE_HEADING}" at the end of the page`,
      evidence: strayExercises.map((line) => line.trim().slice(0, 200)),
    });
  }
  return problems;
}
