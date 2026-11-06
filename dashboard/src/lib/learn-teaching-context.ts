import { createHash } from "node:crypto";
import type { QualityProblem } from "./learn-utils.ts";

// v15 (2026-10-08): need-before-tool, one notation per relation, provenance
// out of prose. Stage keys carry this, so changed prompts never collide with
// checkpoints recorded under the old wording.
export const TEACHING_REVIEW_VERSION = "reader-progression-v15";

export interface EarlierLessonEvidence {
  pageId: string;
  title: string;
  /** Routing hints only: these labels do not prove that the prose teaches them. */
  concepts: readonly string[];
  markdown: string;
}

export interface TeachingReviewContext {
  assumedBackground: readonly string[];
  earlierLessons: readonly EarlierLessonEvidence[];
}

/** Keep complete, relevant earlier explanations and the immediate transition.
 * Never substitute a plan's concept labels for the text the reader saw. */
export function selectEarlierLessonEvidence(
  lessons: readonly EarlierLessonEvidence[],
  prerequisites: readonly string[],
): EarlierLessonEvidence[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const needed = prerequisites.map(normalize).filter(Boolean);
  return lessons.filter((lesson, index) => index === lessons.length - 1 ||
    lesson.concepts.some((concept) => needed.some((term) => {
      const key = normalize(concept);
      return key && (key === term || key.includes(term) || term.includes(key));
    })));
}

export function teachingEvidenceHash<T extends TeachingReviewContext>(context: T): string {
  return createHash("sha256").update(JSON.stringify({ version: TEACHING_REVIEW_VERSION, ...context })).digest("hex");
}

/** Only minor presentation findings may survive bounded repairs. Unknown codes
 * fail closed; a future knowledge check must never silently become cosmetic. */
export function lessonReviewResidualIsAcceptable(
  problems: readonly QualityProblem[],
  _newConcepts: readonly string[] = [],
  allowance = 3,
): boolean {
  const presentationOnly = new Set(["restated-idea", "unearned-callout", "reteaches-earlier-unit"]);
  return problems.length <= allowance && problems.every((problem) => presentationOnly.has(problem.code));
}

export const TEACHING_STORY_RULES = `Reader progression:
- Keep a familiar object or worked case in view as the idea changes. Explain what the previous step leaves unanswered and why the next step helps; an announcement of the next topic is not that bridge.
- Introduce only the notation and vocabulary needed for the present step. Give each symbol a meaning before using it. A future application is not a useful example if understanding it needs that future lesson.
- Move from a concrete case to its reasoning and then its general form. When switching representations, show the same case in both so the reader can follow what stayed the same.
- Use precise everyday verbs and short, connected sentences. Technical names follow their meaning. Never replace a missing explanation with another technical phrase.
- Need before tool. A transform, integral, complex number, new representation, or new quantity enters only after the running example has run into a problem the reader can see it solves, stated in that example's own terms. Then show in plain words, on that same example, how the tool does its job (what is multiplied, what is added up, what the result measures) before the general formula appears. "A factor that rotates at frequency f" followed by an integral is a name and a formula, not a mechanism; "use a quantity with two numbers at each instant" before any problem needs two numbers is a tool without a reason.
- Question before task. Before any mathematical construction ("write the field as derivatives of another set of arrows", "expand in a series", "take the curl of both sides"), the reader must already hold the question it answers: what they want to know or compute, and why the tools they have cannot get it. A construction is a method, not a motivation; "we want to generate this field from another quantity" still owes the reason anyone would want that. Keep the question visible: when the argument turns, say how the next step moves toward the answer, and close by answering it.
- Use the least mathematics that does the job. When the result can be reached by a route that needs only the declared background and earlier lessons, take that route rather than a heavier one. When the page uses a tool from the declared background (a series, a factorial, an integration technique), remind the reader in a sentence what it says at the moment it is used. Never call a tool "familiar" or "well known" to skip that reminder, and never use a tool the background does not name without teaching it first.
- One cast of symbols. Choose the lesson's names for conductors, charges, regions, and quantities once, and keep each symbol meaning one thing for the whole page. When a source figure labels things differently, translate it into the lesson's names in at most one sentence beside that figure; do not spend paragraphs reconciling different figures' conventions, and never interrupt the central experiment or argument to decode a figure.
- A displayed equation is true as written. Use $\\approx$ for approximations, truncated or sampled sums, and small-quantity estimates, and say what the approximation drops; reserve $=$ for exact relations and state a limit explicitly when exactness needs one. Never display "=" and then explain below that it only approximately holds.
- One relation, one notation. Use one consistent notation for the whole lesson and display each relation once. Do not show the same relation again in another source's symbols, do not display or discuss misprinted versions, and do not narrate how sources write it; teach the correct relation.
- Admit extra material only for what it does in the running problem. When a source table or figure carries more than the lesson develops, interpret the part that answers the current question and leave the rest unexplained-and-unused rather than half-explaining new mechanisms.
- Provenance stays out of the story: no source anchor ids, page numbers, or book names in sentences or captions. The pipeline compiles the references at the end of the lesson.
- Use Markdown math delimiters: $...$ for inline mathematics and $$...$$ on separate lines for display mathematics.
- A practice question should require a fresh application or explanation. Preserve a question and its inputs when the user requires that; improve the surrounding worked example or ask for reasoning within the authorized scope rather than replacing the protected exercise.
- Earlier lesson labels are a reading plan, not proof of understanding. Consult earlierLessons for the actual explanation. A missing bridge must be taught from supported evidence before it is used.
Reference for the progression, not text or subject matter to copy: begin with two simple equations asking for the same two numbers. Try one pair and show why it satisfies both. Keep those very equations while recording their coefficients in a matrix; identify where each number went and explain why this shorter record helps. The new representation solves a problem the reader has just encountered. Aim for that continuity in the present subject, rather than a fresh unrelated example for every definition.`;

export const TEACHING_HEALING_RULES = `Repair the reader's path through this lesson:
1. Identify the first sentence the declared learner cannot follow and the exact missing meaning, symbol, or reasoning step.
2. For a premature example or future concept, replace it with a concrete case using what the reader already knows, or defer that application. Do not insert a miniature later chapter just to retain an unnecessary sentence.
3. For an essential missing foundation, use the supplied evidence to teach the smallest sufficient bridge before the dependent sentence. If an earlier page only named it, do not claim it was taught. Check every new term, symbol, and method introduced by the replacement against the declared background and preceding text. Explain any essential new dependency within the same repair; do not merely trade the reported gap for another unexplained method.
4. Carry the repaired reasoning through the worked example and the transition to the next idea. Reviewer corrections are fallible suggestions, not mathematical authority: recompute from the stated inputs rather than copying a suggested replacement. Check each equality, exact-versus-decimal consistency, and an available independent invariant such as total, units, or magnitude. Preserve correct source formulas, protected questions, and images; explain source errors explicitly rather than copying them as truth.
5. Preserve the learning question and supported scope. Do not add a more advanced generalization, alternate proof, or new operator merely because it appears in a reference. If an unnecessary addition introduces new prerequisites, remove the addition instead of expanding the lesson to teach them. If an essential explanation is unsupported, report the precise evidence gap; do not disguise an incomplete lesson as complete or invent a derivation.
6. Correct arithmetic in place. Do not leave a false intermediate equality followed by a self-correction narrative unless the user explicitly requested an exercise in diagnosing that error.
Return the repair format requested by activeStageTask, with no repair commentary. The complete resulting lesson will be independently reviewed again; a blocking finding is never waived because the repair budget is exhausted.`;
