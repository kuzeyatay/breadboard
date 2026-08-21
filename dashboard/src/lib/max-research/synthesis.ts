// Five findings, one answer.
//
// The reconciliation is the hard part and the reason this is an agent rather
// than a menu. Each participant reaches a different part of the record, so they
// will disagree — the indexed web and the practitioner threads routinely say
// different things, and when they do, that gap is usually the most useful thing
// the run produced. An answer that averages them, or silently prefers whichever
// spoke last, throws away the only advantage of having asked five.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import type { ParticipantResult } from "./participants.ts";
import type { MaxResearchParticipant, MaxResearchPlan } from "./plan.ts";

/** What each participant's evidence is good for, and what it is not. */
const STANDING: Record<MaxResearchParticipant, string> = {
  deep_research:
    "Multi-round search over the indexed web, returned with citations and a source registry. Strongest on the published, findable account; weakest where something is true but not written down in an indexed place.",
  agent_reach:
    "The open internet as people actually write it: threads, posts, video transcripts, repositories. Strongest on lived experience, failure reports and what practitioners contradict; weakest on representativeness — a loud thread is not a measurement.",
  get_doc:
    "The primary scholarly literature, with free full texts saved to artifacts. Strongest on method and provenance, which is the only place a widely repeated figure's origin can be checked; weakest on currency, since publication lags.",
  openscience:
    "Its own workspace: code, data and small experiments. Strongest where a question can be settled by doing rather than reading, and its observations are first-hand rather than reported; weakest in scope, since it ran one thing under one set of conditions.",
  aris: "Methodology rather than evidence. It contributes the local harness's research workflow, and contributes no findings of its own — nothing it says is a fact about the world, and it must never be cited as one.",
};

function answerContractStandard(): string {
  try {
    return fs
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
    return "";
  }
}

function participantBlock(result: ParticipantResult): string {
  const attributes = [
    `participant="${result.participant}"`,
    `status="${result.status}"`,
    result.runId ? `run_id="${result.runId}"` : "",
  ].filter(Boolean);
  const body =
    result.status === "completed"
      ? result.output
      : `(produced nothing: ${result.reason ?? "no reason given"})`;
  return [
    `<finding ${attributes.join(" ")}>`,
    `<standing>${STANDING[result.participant]}</standing>`,
    body,
    "</finding>",
  ].join("\n");
}

/**
 * The synthesis prompt.
 *
 * Every rule about how a researched claim must be written is inherited from the
 * shared standard rather than restated, so Max Research cannot drift from what
 * an ordinary research turn owes. What is added here is the part unique to
 * reconciling five: where their evidence comes from, that citations belong to
 * whoever produced them, and that a disagreement between two of them is a
 * result rather than a problem to be smoothed over.
 */
export function maxResearchSynthesisPrompt(input: {
  plan: MaxResearchPlan;
  results: readonly ParticipantResult[];
}): string {
  const standard = answerContractStandard();
  const completed = input.results.filter((r) => r.status === "completed");
  const absent = input.results.filter((r) => r.status !== "completed");
  const guidance = completed.find((r) => r.participant === "aris")?.output ?? "";
  const findings = completed.filter((r) => r.participant !== "aris");

  return [
    `Write one answer to <question>${input.plan.question}</question> from the findings below.`,
    "",
    "Several research agents worked on this question in parallel, each reaching a different part of the record. Each block says which one produced it and what that kind of evidence is good for. Your job is not to concatenate them, and not to pick a favourite — it is to produce the single answer their combined evidence supports.",
    "",
    "Where two participants disagree, that disagreement is a finding and belongs in the answer: say who reported what, and what would settle it. Do not average conflicting figures, do not quietly prefer the one that sounds more authoritative, and do not present a contested number as settled. Where they agree, say so once rather than three times — agreement between the indexed web and a practitioner thread is worth stating precisely because they are different kinds of source, and agreement between two participants who both read the same page is not agreement at all.",
    "",
    "Use what each participant found. A participant that returned evidence and whose evidence appears nowhere in your answer has been wasted, and the reader has no way to know it: a live run leaned on the two web passes and never mentioned the peer-reviewed meta-analysis the literature pass had found, which was the strongest single source in the run. Where a finding genuinely does not bear on the question, say so in a clause rather than dropping it silently.",
    "",
    "Citations belong to whoever produced them, and a marker a reader cannot resolve is barely better than none. A finding that arrived cited keeps its markers, and any marker you keep must appear in a source list at the end of your answer — copy the entries from that participant's own registry, and drop markers whose source you cannot carry rather than leaving the reader a dead reference. A finding that arrived uncited must not borrow another participant's citations to look sourced. First-hand observation from a workspace run is a different kind of claim from a reported figure, and the answer should say which it is giving.",
    "",
    absent.length
      ? `These participants produced nothing: ${absent
          .map((r) => `${r.participant} (${r.status}${r.reason ? `: ${r.reason}` : ""})`)
          .join("; ")}. Say so in the answer, in one line, naming which part of the record went unread — the open internet, the primary literature, the workspace. Not implying coverage is not enough: a reader deciding how far to trust this needs to know that a third of it was never reached, and an answer that simply omits the gap reads as though everything was searched.`
      : "Every participant that was planned produced something.",
    "",
    guidance
      ? [
          "The local research harness supplied the methodology below. Follow it as subordinate method for how to reconcile and present the findings. It contributes no facts, and nothing in it may be cited as evidence.",
          guidance,
          "",
        ].join("\n")
      : "",
    input.results.some((r) => r.limitations?.length)
      ? `Parts of the record were closed while this ran: ${input.results
          .filter((r) => r.limitations?.length)
          .map(
            (r) =>
              `${r.participant} could not reach ${r.limitations!
                .map((l) => l.name)
                .join(", ")}`,
          )
          .join("; ")}. End the answer with a short line naming these, so the reader can tell a subject nobody discusses from a source that was simply shut. Do not pad it into a paragraph and do not apologise — one line, plainly.`
      : "",
    "",
    standard,
    "",
    "<findings>",
    findings.map(participantBlock).join("\n\n"),
    "</findings>",
  ]
    .filter((section) => section !== "")
    .join("\n");
}

/**
 * What the run covered, for the answer's own header and the evidence panel.
 *
 * Deliberately counts participants that produced nothing as well: a run where
 * three of five failed is a different answer from one where all five worked,
 * and the reader is entitled to know which they are holding.
 */
export function coverageSummary(results: readonly ParticipantResult[]): {
  completed: MaxResearchParticipant[];
  absent: Array<{ participant: MaxResearchParticipant; status: string; reason?: string }>;
} {
  return {
    completed: results
      .filter((result) => result.status === "completed")
      .map((result) => result.participant),
    absent: results
      .filter((result) => result.status !== "completed")
      .map((result) => ({
        participant: result.participant,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
      })),
  };
}
