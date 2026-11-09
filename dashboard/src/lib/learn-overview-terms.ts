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

import { PROMPT_LEARN_OVERVIEW_TERMS as OVERVIEW_TERM_REVIEW_PROMPT } from "./system-prompts/feature-defaults.ts";
export { OVERVIEW_TERM_REVIEW_PROMPT };

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
