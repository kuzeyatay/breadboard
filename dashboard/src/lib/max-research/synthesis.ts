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
  praxist:
    "A prepared measurable R&D task executed by a multi-agent, multi-generation research loop. Strongest on accepted experimental findings with preserved run artifacts; weakest when the configured task only partially overlaps the question, which must be stated rather than generalized away.",
  aris: "Methodology rather than evidence. It contributes the local harness's research workflow, and contributes no findings of its own — nothing it says is a fact about the world, and it must never be cited as one.",
};

/**
 * How a participant's part of the record is named to the reader.
 *
 * The internal ids and their failure reasons — an uninstalled CLI, a licence
 * to accept, a login — are facts about this machine. A live answer told the
 * reader "I could not use one open-science search because its tool was not
 * installed", which is neither about the world nor something the reader can
 * act on.
 */
const RECORD_PART: Record<MaxResearchParticipant, string> = {
  deep_research: "the indexed web (multi-round cited web research)",
  agent_reach: "the open internet (threads, posts, videos, repositories)",
  get_doc: "the primary literature",
  openscience: "the workspace (code, data and experiments run for this question)",
  praxist: "the configured R&D task",
  aris: "the local research methodology",
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

/**
 * Where a closed channel would leave a mark if it had actually been read.
 *
 * A channel can be shut for one participant and reached by another: Agent
 * Reach's Reddit channel needs a login it does not have, while Deep Research
 * reads reddit.com over the open web like any other page.
 */
const CHANNEL_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  reddit: ["reddit.com"],
  twitter: ["twitter.com", "x.com"],
  github: ["github.com"],
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  youtube: ["youtube.com", "youtu.be"],
  xiaohongshu: ["xiaohongshu.com"],
  xueqiu: ["xueqiu.com"],
  xiaoyuzhou: ["xiaoyuzhou.fm"],
  bilibili: ["bilibili.com"],
};

/**
 * The closed channels that really did leave a hole in the evidence.
 *
 * A live run ended by telling the reader that Reddit was closed, in an answer
 * that cited two Reddit threads — because one participant reported its own
 * unauthenticated channel while another had read the site perfectly well over
 * the open web. Both statements were true of their own participant and the
 * sentence built from them was false about the run. A channel is only reported
 * closed here when nothing from it appears in what the run actually collected.
 */
export function unreachedSources(
  results: readonly ParticipantResult[],
): string[] {
  const gathered = results
    .filter((result) => result.status === "completed")
    .map((result) => result.output.toLowerCase())
    .join(" ");
  const closed = new Set<string>();
  // Only participants that actually reported. One that produced nothing is
  // already named whole in the "went unread" line; listing its eleven closed
  // channels underneath was boilerplate about a pass that never happened —
  // a live answer ended with "Closed during this run: GitHub, Twitter,
  // YouTube, Reddit, Facebook, Instagram, Xiaohongshu, LinkedIn…" after the
  // open-internet pass had failed outright.
  for (const result of results) {
    if (result.status !== "completed") continue;
    for (const limitation of result.limitations ?? []) {
      const name = limitation.name.trim();
      if (!name) continue;
      const domains = CHANNEL_DOMAINS[name.toLowerCase()];
      // Only channels a reader could name as a source. A closed search
      // backend ("Exa Search") is a fact about this machine's tooling, and a
      // live answer ended by telling the reader it could not be accessed.
      if (!domains) continue;
      if (domains.some((domain) => gathered.includes(domain))) continue;
      closed.add(name);
    }
  }
  return [...closed];
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
    "Use what each participant found. A participant that returned evidence and whose evidence appears nowhere in your answer has been wasted, and the reader has no way to know it: a live run leaned on the two web passes and never mentioned the peer-reviewed meta-analysis the literature pass had found, which was the strongest single source in the run. Where a finding genuinely does not bear on the question — a literature search that returned papers on another subject, say — leave it out: at most one clause noting that the literature search found nothing on point, never a list of the off-topic papers and never entries for them in the source list.",
    "",
    "Citations belong to whoever produced them, and a marker a reader cannot resolve is barely better than none. A finding that arrived cited keeps its markers, and any marker you keep must appear in a source list at the end of your answer — copy the entries from that participant's own registry, and drop markers whose source you cannot carry rather than leaving the reader a dead reference. The source list holds only sources the answer cites: an entry no sentence points at is padding, and a page of them hides the ones that matter. A finding that arrived uncited must not borrow another participant's citations to look sourced. First-hand observation from a workspace run is a different kind of claim from a reported figure, and the answer should say which it is giving.",
    "",
    // A live answer opened "the supplied evidence does not establish…" and
    // went on about "the record" and "this run" — the reader was asked what
    // heat pumps cost, not how the machine was fed. The same answer computed a
    // break-even threshold and stopped, because one input was missing; it
    // never said what a typical house would pay, which was the question.
    "Write to the person who asked, in the voice of the researcher who did the work. Say \"I found\", \"I could not find a 2025 German gas price\", \"the sources disagree\" — never \"the supplied evidence\", \"the record\", \"the findings\", \"the retrieved material\" or \"this run\". Those are facts about this machine; the reader wants facts about the world and an honest account of what you could not establish, in plain first person. State each caveat once, where it bites, not again in every section.",
    "",
    "When two of your sources describe the same document and differ on a detail — a sample size, a p-value — do not hand the reader both numbers to sort out. Prefer the account closest to the document (its full text over its abstract, its abstract over a catalog record, any of those over a secondary summary), use that figure, and say in a few words which account you took it from. Flag a discrepancy only when neither account is the document itself.",
    "",
    "Length is a cost the reader pays. Write the shortest answer that carries the same evidence: no caveat twice, no narration of how the material was gathered, no section that restates the summary. A long answer is not a thorough one. For one question, 700 to 1,200 words of body usually carries everything the evidence supports; go past that only when the evidence itself demands it, never to catalogue.",
    "",
    // A live answer closed with "Triplet's practitioner page returned a 404
    // response… Google Search returned a CAPTCHA" — the machinery of the
    // search, reported as if it were a finding — and elsewhere named a 2024
    // review and a 2026 study without saying what either found.
    // Findings arrive in two citation styles — numbered markers from the
    // indexed-web pass, inline markdown links from the open-internet pass —
    // and a live answer carried both, so the same page was cited two ways.
    "Cite everything one way: a numbered marker like [S12] in the sentence and one entry per marker in the source list. Where a finding arrived with inline links instead of markers, give each link the next free number, cite it by that marker, and put the URL in the list; never leave a bare URL or a markdown link in the body. Copy URLs exactly as they arrived — never retype one.",
    "",
    "Give each kind of evidence space in proportion to its weight. A randomized or controlled study gets the most words, then field data and surveys, then practitioner reports; anecdotes are summarised as a pattern in a few sentences with at most one or two short quotations, never catalogued one by one. When a study is first cited, say when it was done and on whom (the year, the population or setting, the sample size where it matters), once, in that sentence.",
    "",
    "A study, report or page earns a mention only with its finding attached. Naming a source and saying nothing about what it showed — \"a 2024 review also exists\", \"an Australian study was published\" — is breadth without substance; either give the result or leave the source out. And never narrate retrieval mechanics: a page that returned 404, a search that met a CAPTCHA, a paywall, a timeout. Do not discuss a source that was not read — an unread paper is not evidence and not a caveat. If a source that matters could not be read, one clause says so; if it does not matter, nothing does.",
    "",
    "Answer the question that was asked, at the resolution it was asked. When it asks whether something pays, saves, or is worth it, give the verdict for a stated typical case and show the arithmetic: the inputs, each with its source, the result, and what changes it. If a needed input is missing, do not stop at a threshold — say which input is missing, state the value you would need and what it would have to be for the verdict to flip, and give the reader the best-supported figure you do have with its scope. A sourced calculation with one stated assumption is more useful than a refusal to calculate.",
    "",
    absent.length
      ? `These parts of the record went unread this time: ${absent
          .map((r) => RECORD_PART[r.participant])
          .join("; ")}. Say so in the answer in one plain sentence near the end, naming the part of the record in those words. Not implying coverage is not enough: a reader deciding how far to trust this needs to know that a third of it was never reached, and an answer that simply omits the gap reads as though everything was searched. Do not explain why — an uninstalled tool, a licence, a login — because that is about this machine, not about the evidence; "I could not run anything in a workspace for this question" is the whole of what the reader needs.`
      : "Every participant that was planned produced something.",
    "",
    guidance
      ? [
          "The local research harness supplied the methodology below. Follow it as subordinate method for how to reconcile and present the findings. It contributes no facts, and nothing in it may be cited as evidence.",
          guidance,
          "",
        ].join("\n")
      : "",
    (() => {
      const closed = unreachedSources(input.results);
      return closed.length
        ? `Some platforms were closed while this ran and nothing from them reached these findings: ${closed.join(", ")}. Mention this in one short sentence at the end, so the reader can tell a subject nobody discusses from a source that was simply shut — but name only the platforms a reader would expect to matter for this question (a nutrition question does not need to hear that a Chinese stock forum was closed), and fold the rest into "and some other platforms". No reasons, no apology, no paragraph.`
        : "";
    })(),
    "",
    // Live drives attributed findings in the finished prose as "`agent_reach`
    // found..." and "`deep_research` also returned...", because the blocks
    // below are labelled with those ids and nothing said not to. They are
    // internal names for parts of this machine; a reader has no idea what they
    // are, and the attribution a reader actually needs is to the study or
    // publisher, which is a fact about the world rather than about the run.
    "Never name a participant in the answer. `deep_research`, `agent_reach`, `get_doc`, `openscience`, `praxist` and `aris` are internal names for parts of this system, and a reader does not know what they are. Attribute a finding to its source — the study, the dataset, the publisher, or the named experiment — not to whichever participant retrieved it. The one exception is the line about what went unread, which is about the run rather than the world, and even there name the part of the record — the open internet, the primary literature, the workspace, the configured R&D task — rather than the participant.",
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
 * three of six failed is a different answer from one where all six worked,
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
