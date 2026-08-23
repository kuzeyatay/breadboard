// The pass that reads the answer back before anyone else does.
//
// Writing and checking are different jobs, and a model doing both at once does
// the second one badly. Two live runs proved it: one produced a genuinely
// excellent answer that never mentioned the peer-reviewed meta-analysis its
// literature participant had found — the strongest single source in the run —
// and left its most surprising claim, a 1978 paper tracing a myth to a 1975
// report, with no citation at all. Neither failure is a reasoning failure. Both
// are what happens when nothing checks the draft against the evidence it was
// written from.
//
// So this is a separate call with one job: audit, and repair what it finds.
// It may not research, may not add claims, and may not soften conclusions — the
// draft's judgement stands, and only its accounting is at stake.

import type { ParticipantResult } from "./participants.ts";
import type { MaxResearchPlan } from "./plan.ts";

/** What the audit looks for, in the order a reader would notice it. */
export const REVIEW_CHECKS: readonly string[] = [
  "A participant returned evidence that appears nowhere in the answer, and is not dismissed in a clause either.",
  "A figure, date or quantity a reader might act on carries no citation, or names no publisher.",
  "A citation marker appears in the answer with no matching entry in a source list at the end, so the reader cannot resolve it.",
  "The opening or a heading states something stronger than, or inconsistent with, the evidence below it.",
  "A contested figure is presented as settled, or two conflicting figures are averaged.",
  "A projection is written in the grammar of a measurement.",
  "A figure is given without the scope it only holds inside — the country, the population, the period.",
  "A participant produced nothing, or a source was closed, and the answer does not say so.",
];

/**
 * The audit prompt.
 *
 * Deliberately asks for the corrected answer rather than a list of complaints.
 * A review that returns notes needs a third call to act on them, and every
 * hand-off is a chance for the fix to be lost — which is the failure mode this
 * exists to close, not to reproduce one layer up.
 */
export function maxResearchReviewPrompt(input: {
  plan: MaxResearchPlan;
  results: readonly ParticipantResult[];
  draft: string;
}): string {
  const completed = input.results.filter(
    (result) => result.status === "completed" && result.participant !== "aris",
  );

  return [
    "You are auditing a research answer against the findings it was written from. You did not write it and you are not rewriting it: its conclusions, its structure and its voice stay as they are.",
    "",
    `The question was: ${input.plan.question}`,
    "",
    "Check for each of these, in order:",
    ...REVIEW_CHECKS.map((check, index) => `${index + 1}. ${check}`),
    "",
    "Then return the answer with every one you found repaired, and nothing else changed. Repair means: cite the claim, name the publisher, add the scope, state the disagreement, use the finding that was dropped or dismiss it in a clause, say what was missing. It does not mean adding claims, hedging a conclusion the evidence supports, or padding.",
    "",
    "You have only the findings below. If a claim *about the world* in the draft is not supported by any of them, do not invent a source for it — say in the sentence that the run could not trace it. That is the honest repair, and it is the one most likely to be needed.",
    "",
    "That repair applies to evidence and to nothing else. Statements about the run itself — that a participant produced nothing, that a source was closed, which part of the record went unread — are facts reported to you here, not claims needing a source. Leave them as plain statements. A live audit wrapped them in \"the run could not trace the claim that...\" and turned the two most useful sentences in the answer into nonsense.",
    "",
    // The findings below are labelled with internal participant ids, and a
    // repair that cites one by name puts it in front of a reader who has no
    // idea what it means.
    "Never name a participant. `deep_research`, `agent_reach`, `get_doc`, `openscience` and `aris` are internal names for parts of this system. If the draft names one, replace it with the source that finding actually came from; if you are adding a citation, cite the study or publisher, never the participant.",
    "",
    "Return only the finished answer. No preamble, no list of what you changed, no note that you reviewed it.",
    "",
    "<findings>",
    completed
      .map(
        (result) =>
          `<finding participant="${result.participant}">\n${result.output}\n</finding>`,
      )
      .join("\n\n"),
    "</findings>",
    "",
    "<draft>",
    input.draft,
    "</draft>",
  ].join("\n");
}

/**
 * Whether a reviewed answer may replace the draft.
 *
 * A review that comes back empty, truncated, or dramatically shorter has failed
 * rather than improved anything, and shipping it would trade a good answer for
 * a mangled one. The draft is the safe default: it was already the product of
 * every rule in the contract.
 */
export function reviewedAnswerIsUsable(draft: string, reviewed: string): boolean {
  const cleaned = reviewed.trim();
  if (!cleaned) return false;
  // Half is generous — a genuine audit adds citations and scope, so it should
  // come back a little longer, never much shorter.
  return cleaned.length >= draft.trim().length * 0.5;
}
