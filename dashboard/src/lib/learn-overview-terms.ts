// The Topic Overview names the whole course on one page, so it is where an
// undefined technical term is most likely to do explanatory work ("pooling
// more channels changes the statistical efficiency of the trunk"). The shared
// foundation rules already forbid that; this module gives the overview what it
// needs to follow them (each unit's question and new concepts) and a focused
// review that sends an overview back when a term is used without being explained.

import type { LearningSectionPlan } from "./learn-utils.ts";

export interface OverviewUnitSummary {
  section: string;
  sectionPurpose: string;
  units: Array<{
    title: string;
    learningQuestion: string;
    newConcepts: string[];
    prerequisiteConcepts: string[];
  }>;
}

/** What each section and unit teaches, in reading order. The overview may name
 * a unit's concepts as destinations but must explain any it relies on. */
export function overviewUnitSummaries(sections: readonly LearningSectionPlan[]): OverviewUnitSummary[] {
  return sections.map((section) => ({
    section: section.title,
    sectionPurpose: section.purpose ?? "",
    units: (section.subsections ?? []).map((subsection) => ({
      title: subsection.title,
      learningQuestion: subsection.learningQuestion ?? "",
      newConcepts: [...(subsection.newConcepts ?? [])],
      prerequisiteConcepts: [...(subsection.prerequisiteConcepts ?? [])],
    })),
  }));
}

export const OVERVIEW_TERM_REVIEW_PROMPT = `You check a Topic Overview, the first page a beginner reads in a learning garden, for technical terms used without explanation.

You also receive assumedBackground: what the Scope Contract says this learner already brings. Everyday words, and any term that background covers or that any first-year student of the subject already knows (for a telecommunications course: signal, receiver, transmitter, frequency, probability, channel in its everyday sense), are NOT terms for this review - do not list them. A descriptive phrase made of everyday words whose meaning is clear from the words themselves ("error-checking information", "control information", "holding time" for how long a call lasts) is not a technical term either - do not list it. The terms that matter are the ones this course itself introduces (the units' newConcepts) or that are specialist beyond that background.

List every such technical term, abbreviation, symbol, or unit that appears in the page body (ignore the reading-order links themselves). For each one decide:
- "explained": the page itself says in plain words what it means before or where it relies on it.
- "named_only": it appears only as a destination - a topic the learner will reach later, naming what that lesson does - and no sentence uses its meaning to explain, compare, or give a reason.
- "unexplained": a sentence depends on knowing what it means (it explains, compares, gives a cause, or states a result using it) and the page never explains it.

A term inside a bold definition that actually says what it is counts as explained. A term that only gets a one-word gloss or a restated name ("TDMA separates users in time") is explained only if a beginner could now say what it does.

Return ONLY one JSON object:
{"terms":[{"term":"exact term","status":"explained|named_only|unexplained","sentence":"the exact sentence that relies on it (required for unexplained)","missing":"what a beginner would need to be told (required for unexplained)"}]}`;

export interface OverviewTermReview {
  term: string;
  status: "explained" | "named_only" | "unexplained";
  sentence?: string;
  missing?: string;
}

/** Validate the review and turn every unexplained term into a repair problem. */
export function overviewTermReviewProblems(parsed: unknown): { problems: string[]; reviewError?: string } {
  const terms = (parsed as { terms?: unknown } | null)?.terms;
  if (!Array.isArray(terms)) {
    return { problems: [], reviewError: 'overview term review returned no "terms" array' };
  }
  const problems: string[] = [];
  for (const entry of terms) {
    const record = entry as Record<string, unknown>;
    const term = typeof record?.term === "string" ? record.term.trim() : "";
    const status = record?.status;
    if (!term || (status !== "explained" && status !== "named_only" && status !== "unexplained")) {
      return { problems: [], reviewError: "overview term review returned an invalid term entry" };
    }
    if (status !== "unexplained") continue;
    const sentence = typeof record.sentence === "string" ? record.sentence.trim() : "";
    const missing = typeof record.missing === "string" ? record.missing.trim() : "";
    problems.push(
      `unexplained-term: the overview relies on "${term}" without explaining it` +
        (sentence ? ` in: ${JSON.stringify(sentence)}` : "") +
        (missing ? `. Explain in plain words: ${missing}` : "") +
        `. Either explain it at first use or remove it from sentences that do explanatory work and name it only as the lesson that teaches it.`,
    );
  }
  return { problems: [...new Set(problems)] };
}
