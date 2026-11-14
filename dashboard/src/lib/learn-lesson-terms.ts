// A lesson may use a technical term only after it has explained it, or when
// an earlier unit taught it (or the Scope Contract says the learner brings it).
// The deterministic gate cannot know which words are terms, and the critic's
// leniency let glosses through ("a distributed algorithm: every user follows a
// common decision procedure" - telecom-1 M2 1.1, 2026-09-16). This review asks
// the model to list every technical term the page relies on and to say where
// it was explained; anything unexplained becomes a hard repair problem the
// lesson repair loop already knows how to act on.

import type { QualityProblem } from "./learn-utils.ts";
import { type TeachingReviewContext } from "./learn-teaching-context.ts";

import { PROMPT_LEARN_LESSON_TERMS as LESSON_TERM_REVIEW_PROMPT } from "./system-prompts/feature-defaults.ts";
export { LESSON_TERM_REVIEW_PROMPT };

export interface LessonTermReviewEntry {
  term: string;
  status: "explained_here" | "shallow" | "taught_earlier" | "named_later" | "unexplained";
  laterUnit?: boolean;
  sentence?: string;
  missing?: string;
}

/** Validate the review and turn every unexplained term, restated idea,
 * concept left without a concrete instance, result stated without its
 * derivation, unearned callout, and retaught earlier concept into a hard
 * quality problem the lesson repair prompt acts on. */
export interface LessonReviewVerdicts {
  termsFine: string[];
  conceptsConcrete: string[];
  resultsShown: string[];
  calloutsEarned: string[];
}

export function lessonTermReviewProblems(parsed: unknown, context?: TeachingReviewContext): {
  problems: QualityProblem[];
  /** What the review accepted, handed back to the next review so unchanged
   * passages keep their verdicts instead of being re-litigated. */
  accepted?: LessonReviewVerdicts;
  reviewError?: string;
} {
  if (context) {
    for (const field of ["terms", "restatements", "concepts", "results", "callouts", "reteaching", "flow"]) {
      if (!Array.isArray((parsed as Record<string, unknown> | null)?.[field])) {
        return { problems: [], reviewError: `lesson teaching review omitted its "${field}" inspection` };
      }
    }
  }
  const terms = (parsed as { terms?: unknown } | null)?.terms;
  if (!Array.isArray(terms)) {
    return { problems: [], reviewError: 'lesson term review returned no "terms" array' };
  }
  const problems: QualityProblem[] = [];
  const accepted: LessonReviewVerdicts = { termsFine: [], conceptsConcrete: [], resultsShown: [], calloutsEarned: [] };
  const seen = new Set<string>();
  for (const entry of terms) {
    const record = entry as Record<string, unknown>;
    const term = typeof record?.term === "string" ? record.term.trim() : "";
    const status = record?.status;
    if (
      !term ||
      (status !== "explained_here" && status !== "shallow" && status !== "taught_earlier" && status !== "named_later" && status !== "unexplained")
    ) {
      return { problems: [], reviewError: "lesson term review returned an invalid term entry" };
    }
    if (status !== "unexplained" && status !== "shallow") {
      if (status === "taught_earlier" && context) {
        const prior = record.priorExplanation as { pageId?: unknown; quote?: unknown } | undefined;
        const quote = typeof prior?.quote === "string" ? prior.quote.trim() : "";
        const supported = typeof record.backgroundItem === "string" && context.assumedBackground.includes(record.backgroundItem)
          || quote.length >= 30 && context.earlierLessons.some((lesson) => lesson.pageId === prior?.pageId && lesson.markdown.includes(quote));
        if (!supported) {
          problems.push({ code: "unverified-prerequisite", hard: true, subject: term,
            message: `The review assumes "${term}" was taught, but supplies no matching earlier explanation or declared background. Teach the needed bridge from evidence, or remove the dependency; a planned concept label is insufficient.`,
            evidence: typeof record.sentence === "string" ? [record.sentence] : undefined });
          continue;
        }
      }
      accepted.termsFine.push(term);
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
    const missing = typeof record.missing === "string" ? record.missing.trim() : "";
    if (record.laterUnit === true) {
      // A later unit owns this concept: the page may point at it, never lean
      // on it. Explaining it here would teach the later unit's material.
      problems.push({
        code: "leans-on-later-unit",
        message:
          `the lesson builds reasoning on "${term}", which a later lesson teaches` +
          (missing ? `; ${missing}` : "") +
          `. For an unnecessary future application, remove or defer the dependency and use an example the reader can follow now. If this meaning is essential to the current learning question, teach the smallest source-supported bridge before using it; leave the later topic's full treatment to its owning lesson.`,
        hard: true,
        evidence: sentence ? [sentence] : undefined,
      });
      continue;
    }
    problems.push(
      status === "shallow"
        ? {
            code: "shallow-explanation",
            message:
              `the lesson names what "${term}" is for and then reasons with it, but never teaches how it works` +
              (missing ? `; the reader still needs: ${missing}` : "") +
              `. Teach it where it is first used, to the depth this page's reasoning needs: the problem it solves, the mechanism step by step, what it costs or what goes wrong without it, and one concrete instance with numbers from the sources. If that is more than this page can carry and no earlier unit teaches it, stop relying on it: state in one sentence what role it plays and that it is outside this lesson, and build the reasoning on what the page does teach.`,
            hard: true,
            evidence: sentence ? [sentence] : undefined,
            subject: term,
          }
        : {
            code: "unexplained-term",
            message:
              `the lesson relies on "${term}" without explaining it` +
              (missing ? `; a beginner needs to be told: ${missing}` : "") +
              `. Explain it in plain words at its first use - what it is, what it does, with the concrete steps or an example - before any sentence depends on it. A gloss or synonym is not an explanation.`,
            hard: true,
            evidence: sentence ? [sentence] : undefined,
            subject: term,
          },
    );
  }
  const restatements = (parsed as { restatements?: unknown }).restatements;
  if (restatements !== undefined && !Array.isArray(restatements)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "restatements"' };
  }
  for (const entry of restatements ?? []) {
    const record = entry as Record<string, unknown>;
    const idea = typeof record?.idea === "string" ? record.idea.trim() : "";
    const sentences = Array.isArray(record?.sentences)
      ? record.sentences.filter((line): line is string => typeof line === "string" && line.trim().length > 0).map((line) => line.trim())
      : [];
    if (!idea || sentences.length === 0) {
      return { problems: [], reviewError: "lesson term review returned an invalid restatement entry" };
    }
    // One sentence is a statement, not a repeat.
    if (sentences.length < 2) continue;
    problems.push({
      code: "restated-idea",
      message:
        `the lesson states the same idea ${sentences.length} times (${idea}) without adding a step, consequence, number, or example` +
        `. Keep the one statement that teaches it best where the idea is first needed; delete the others or rewrite each into a sentence that moves the explanation forward.`,
      hard: true,
      evidence: sentences,
    });
  }
  const concepts = (parsed as { concepts?: unknown }).concepts;
  if (concepts !== undefined && !Array.isArray(concepts)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "concepts"' };
  }
  const floating = new Set<string>();
  for (const entry of concepts ?? []) {
    const record = entry as Record<string, unknown>;
    const concept = typeof record?.concept === "string" ? record.concept.trim() : "";
    const grounding = record?.grounding;
    if (!concept || (grounding !== "concrete" && grounding !== "abstract_only")) {
      return { problems: [], reviewError: "lesson term review returned an invalid concept entry" };
    }
    if (grounding === "concrete") accepted.conceptsConcrete.push(concept);
    if (grounding !== "abstract_only" || floating.has(concept.toLowerCase())) continue;
    floating.add(concept.toLowerCase());
    const definition = typeof record.definition === "string" ? record.definition.trim() : "";
    const example = typeof record.example === "string" ? record.example.trim() : "";
    problems.push({
      code: "floating-concept",
      message:
        `"${concept}" is defined only in the abstract; nothing on the page lets the reader picture one` +
        (example ? `. Anchor it: ${example}` : "") +
        `. Right after its definition, give one concrete, fully specified instance: the named system the sources describe with its actual numbers, or a small worked case with every value written out. If the concept has a structure, a small ASCII diagram in a fenced text block with the numbers labelled (slot 0 ... slot 7 across one 4.615 ms frame, say) usually anchors it best; when you use one, read it back in the prose beneath it. A sentence saying the values depend on the system is not an example.`,
      hard: true,
      evidence: definition ? [definition] : undefined,
      subject: concept,
    });
  }
  const results = (parsed as { results?: unknown }).results;
  if (results !== undefined && !Array.isArray(results)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "results"' };
  }
  const unshown = new Set<string>();
  for (const entry of results ?? []) {
    const record = entry as Record<string, unknown>;
    const result = typeof record?.result === "string" ? record.result.trim() : "";
    const status = record?.status;
    if (!result || (status !== "shown" && status !== "asserted_with_notice" && status !== "unshown" && status !== "incorrect")) {
      return { problems: [], reviewError: "lesson term review returned an invalid result entry" };
    }
    if (status === "shown" || status === "asserted_with_notice") accepted.resultsShown.push(result);
    if ((status !== "unshown" && status !== "incorrect") || unshown.has(result.toLowerCase())) continue;
    unshown.add(result.toLowerCase());
    const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
    const needed = typeof record.needed === "string" ? record.needed.trim() : "";
    problems.push({
      code: status === "incorrect" ? "incorrect-result" : "unshown-result",
      message:
        (status === "incorrect" ? `the lesson states an incorrect result (${result})` : `the lesson states a result (${result}) without showing how it is reached`) +
        (needed ? `; show: ${needed}` : "") +
        `. Right where the result appears, work it out from facts already on the page - the calculation with every number written out, or the chain of reasoning step by step. If the sources give the result without its derivation, say that plainly and name what the derivation would need; never present an unexplained number as obvious.`,
      hard: true,
      evidence: sentence ? [sentence] : undefined,
    });
  }
  const flow = (parsed as { flow?: unknown }).flow;
  if (flow !== undefined && !Array.isArray(flow)) return { problems: [], reviewError: 'lesson term review returned a non-array "flow"' };
  for (const entry of flow ?? []) {
    if (typeof entry?.sentence !== "string" || !entry.sentence.trim() || typeof entry?.missingStep !== "string" || !entry.missingStep.trim()) {
      return { problems: [], reviewError: "lesson term review returned an invalid flow entry" };
    }
    problems.push({ code: "broken-learning-sequence", hard: true, evidence: [entry.sentence],
      message: `The reader cannot follow this step: ${entry.missingStep}. Repair the transition or use an example built only from meanings already established.` });
  }
  // Passages the reader could skip and lose nothing. Optional so a review
  // written before this inspection existed still parses.
  const cuts = (parsed as { cuts?: unknown }).cuts;
  if (cuts !== undefined && !Array.isArray(cuts)) return { problems: [], reviewError: 'lesson term review returned a non-array "cuts"' };
  for (const entry of cuts ?? []) {
    const passage = typeof entry?.passage === "string" ? entry.passage.trim() : "";
    const reason = typeof entry?.reason === "string" ? entry.reason.trim() : "";
    if (!passage || !reason) return { problems: [], reviewError: "lesson term review returned an invalid cut entry" };
    problems.push({ code: "dead-weight", hard: true, evidence: [passage],
      message: `the reader loses nothing without this passage (${reason}). Delete it; do not rewrite it or replace it with other text.` });
  }
  const callouts = (parsed as { callouts?: unknown }).callouts;
  if (callouts !== undefined && !Array.isArray(callouts)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "callouts"' };
  }
  for (const entry of callouts ?? []) {
    const record = entry as Record<string, unknown>;
    const kind = record?.kind;
    const text = typeof record?.text === "string" ? record.text.trim() : "";
    const verdict = record?.verdict;
    if (
      (kind !== "warning" && kind !== "note" && kind !== "info") ||
      !text ||
      (verdict !== "earned" && verdict !== "unearned")
    ) {
      return { problems: [], reviewError: "lesson term review returned an invalid callout entry" };
    }
    if (verdict !== "unearned") {
      accepted.calloutsEarned.push(text);
      continue;
    }
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    problems.push({
      code: "unearned-callout",
      message:
        `the ${kind} callout contributes nothing to a reader at that point` +
        (reason ? ` (${reason})` : "") +
        `. Delete it, or rewrite it as something that reader can use right now: a warning names a mistake they could actually make with what the page has taught, a note names a debt this page really incurs, an info adds one connection they can now understand. Never warn about confusing the topic with something the page has not taught.`,
      hard: true,
      evidence: [text],
    });
  }
  const reteaching = (parsed as { reteaching?: unknown }).reteaching;
  if (reteaching !== undefined && !Array.isArray(reteaching)) {
    return { problems: [], reviewError: 'lesson term review returned a non-array "reteaching"' };
  }
  const retaught = new Map<string, string[]>();
  const repetitionReasons = new Map<string, string>();
  for (const entry of reteaching ?? []) {
    const record = entry as Record<string, unknown>;
    const concept = typeof record?.concept === "string" ? record.concept.trim() : "";
    const paragraph = typeof record?.paragraph === "string" ? record.paragraph.trim() : "";
    if (!concept || !paragraph) {
      return { problems: [], reviewError: "lesson term review returned an invalid reteaching entry" };
    }
    const prior = record.priorExplanation as { pageId?: unknown; quote?: unknown } | undefined;
    const quote = typeof prior?.quote === "string" ? prior.quote.trim() : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!reason || quote.length < 30 || !context?.earlierLessons.some(lesson => lesson.pageId === prior?.pageId && lesson.markdown.includes(quote))) {
      return { problems: [], reviewError: "A reteaching finding must quote an actual earlier reader lesson and explain the unnecessary repetition; retrieved source notes alone do not establish prior reading." };
    }
    const key = concept.toLowerCase();
    repetitionReasons.set(key, reason);
    const paragraphs = retaught.get(key) ?? [];
    if (!paragraphs.includes(paragraph)) paragraphs.push(paragraph);
    retaught.set(key, paragraphs);
  }
  for (const [concept, paragraphs] of retaught) {
    problems.push({
      code: "reteaches-earlier-unit",
      message:
        `the lesson teaches "${concept}" again although an earlier page established it` +
        `. ${repetitionReasons.get(concept)}. Remove only the unnecessary repetition, preserving all instruction, examples and coverage the user requested.`,
      hard: true,
      evidence: paragraphs,
    });
  }
  return { problems, accepted };
}
