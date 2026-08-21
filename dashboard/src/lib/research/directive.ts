// The research contract, as the model reads it.
//
// Deliberately short. Everything mechanical about the loop — what counts as
// covered, which gap is worth the next search, when a field may be called
// unpublished, when the work is finished — is computed in this directory and
// returned by the tools. Restating those rules here would create a second,
// softer copy of them that the model could follow instead of the enforced one,
// which is how a prompt ends up quietly overriding a guarantee.
//
// It lives beside the pipeline rather than in super-agent.ts because it is text
// over a plan: no session, no server-only imports, and therefore testable on its
// own. The writing standard below reads one repository file, for the reason
// given on that function — the Deep Research service is a second consumer of
// the same standard and runs out of process.

import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";
import type { ResearchPlan } from "./types.ts";

let cachedStandard: string | null = null;

/** The shared standard, or an empty string when the file is unavailable. */
function answerContractStandard(): string {
  if (cachedStandard !== null) return cachedStandard;
  try {
    cachedStandard = fs
      .readFileSync(
        path.join(
          repositoryRoot(),
          "hermes-config",
          "system",
          "research-answer-contract.md",
        ),
        "utf8",
      )
      .trim();
  } catch {
    cachedStandard = "";
  }
  return cachedStandard;
}

/** Test seam: drop the memoized read. */
export function resetAnswerContractCache(): void {
  cachedStandard = null;
}

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

/**
 * How a researched answer has to be written, as opposed to how the search has
 * to be run.
 *
 * The standard itself lives in `hermes-config/system/research-answer-contract.md`
 * because Breadboard is not its only consumer: the Deep Research service runs
 * out of process with its own system prompt, and the way a figure is
 * attributed and dated must not depend on which of the two answered. That file
 * is the single author; this function adds only what a *classified* request
 * knows and a standalone reader of the file cannot.
 *
 * Reading a repository file is the one impurity in this module. It is the same
 * mechanism `system-prompts.ts` and the Deep Research service already use to
 * share a prompt, and the alternative — a second copy of the standard phrased
 * slightly differently — is how two consumers quietly drift apart.
 */
export function researchAnswerContract(plan: ResearchPlan): string {
  const standard = answerContractStandard();
  if (!standard) return "";
  const notes: string[] = [];
  if (plan.criterionUnstated) {
    // Not a restatement of the rule above: the rule tells the model what to do
    // when the basis is missing, and this says Breadboard has already checked
    // and it is missing here. Stated separately so the model spends no
    // judgement deciding whether the case applies.
    notes.push(
      "This request has been read as asking which option is better without saying by what measure. The rule about naming the basis is not optional on this turn.",
    );
  }
  if (plan.temporalScope.kind === "historical") {
    // The mirror image: a question reaching into the past is not asking for
    // today's figure, and pushing for a current one would answer a different
    // question.
    notes.push(
      "This request is about the past rather than the present, so a period-appropriate figure is the right one; date it rather than replacing it with a current value.",
    );
  }
  return notes.length ? [standard, ...notes].join("\n\n") : standard;
}
