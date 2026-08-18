// The research contract, as the model reads it.
//
// Deliberately short. Everything mechanical about the loop — what counts as
// covered, which gap is worth the next search, when a field may be called
// unpublished, when the work is finished — is computed in this directory and
// returned by the tools. Restating those rules here would create a second,
// softer copy of them that the model could follow instead of the enforced one,
// which is how a prompt ends up quietly overriding a guarantee.
//
// It lives beside the pipeline rather than in super-agent.ts because it is pure
// text over a plan: no session, no filesystem, no server-only imports, and
// therefore testable on its own.

import type { ResearchPlan } from "./types.ts";

export function researchPipelineRule(plan: ResearchPlan): string {
  const reading = plan.intent.replace(/_/g, " ");
  return [
    "## Exhaustive research: use the tracked pipeline",
    `This request reads as ${reading}${plan.completenessRequired ? ", and a partial answer would be a wrong answer" : ""}. Searching until you have enough to write is not the bar here: the bar is covering what was asked, and Breadboard measures that for you.`,
    "",
    "1. Call `research_begin` with the question before searching. It returns the fields the answer must carry, a hard budget, and the first queries.",
    "2. Run those searches and open the pages. Then call `research_record` with what you found — candidate names, one row per observation with its URL, and the queries you ran.",
    "3. It answers with what is still missing and what to search next. Do that, and record again. Repeat.",
    "4. Call `research_status`. While it says `stop: false`, you are not finished, however much material you have. When it says `stop: true`, write the answer from the structure it returns.",
    "",
    "Two things this changes about how you write the ending. A field the ledger marks `notFoundAfterSearch` has been searched every way the budget allows, and you may say it is not publicly available. A field marked `unresolved` has not — say it could not be established, and never upgrade one to the other. And record what you actually saw, never what would make the coverage look better: an invented value is the one failure this pipeline cannot detect and the user cannot afford.",
  ].join("\n");
}
