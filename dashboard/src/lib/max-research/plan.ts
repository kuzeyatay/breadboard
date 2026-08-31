// Who does what, decided before anything starts.
//
// The six research agents are not interchangeable, which is why Max Research
// commissions all of them. Each reaches a different part of the record:
//
//   Deep Research  the indexed web, multi-round, and returns it cited
//   Agent Reach    the open internet — threads, posts, videos, repositories
//   Get Doc        the academic record, and saves the free full texts
//   OpenScience    a full research loop in its own workspace, including code
//   Praxist        a configured measurable R&D task, run across generations
//   ARIS           methodology rather than retrieval: the local harness's own
//                  research workflow, which shapes how the rest is planned and
//                  reconciled
//
// The plan is a pure function of the question. Deciding here rather than in the
// orchestrator means the division of labour is inspectable before an hour of
// compute is spent on it, and testable without standing up five services.

import { classifyResearch } from "../research/classify.ts";
import type { ResearchPlan } from "../research/types.ts";

export type MaxResearchParticipant =
  | "deep_research"
  | "agent_reach"
  | "get_doc"
  | "openscience"
  | "praxist"
  | "aris";

export interface ParticipantAssignment {
  participant: MaxResearchParticipant;
  /**
   * The question, exactly as asked and with nothing appended.
   *
   * Kept apart from the guidance because not every participant takes a task.
   * Get Doc takes a *search query* — "in the user's own words" by its own
   * contract — and handing it a question with three hundred characters of
   * instructions bolted on produced catalog queries the catalogs rejected: a
   * live run drew HTTP 400 from both arXiv and Crossref, found no papers, and
   * that reached the answer as "the literature has nothing to say".
   */
  question: string;
  /** How this participant should approach it. Never part of a search query. */
  guidance: string;
  /** Question and guidance together, for participants that take a task. */
  brief: string;
  /** Why it was included, shown to the user while the run works. */
  rationale: string;
  /**
   * Participants in the same wave run together; a later wave starts when the
   * one before it settles. Retrieval goes first because everything downstream
   * reads better with the record already in hand.
   */
  wave: number;
  /**
   * Reserved. No single participant is required any more — see
   * `RETRIEVAL_PARTICIPANTS`: what a run needs is that *something* fetched
   * evidence, not that one named service did.
   */
  required: boolean;
}

/**
 * The participants that actually fetch evidence.
 *
 * A run needs at least one of them to have produced something; which one is not
 * the point. Naming Deep Research as the single required participant meant a
 * run where Get Doc found ten papers and Agent Reach found a practitioner
 * thread still failed outright because one service was misconfigured — which is
 * throwing away an answer the evidence supports. ARIS is excluded because it
 * contributes method rather than findings.
 */
export const RETRIEVAL_PARTICIPANTS: readonly MaxResearchParticipant[] = [
  "deep_research",
  "agent_reach",
  "get_doc",
  "openscience",
  "praxist",
];

export interface MaxResearchPlan {
  question: string;
  /** The shared classifier's reading, so one module owns "what kind of ask". */
  research: ResearchPlan;
  assignments: ParticipantAssignment[];
  /** True when the question wants the scholarly record, not just the web. */
  academic: boolean;
  /** True when the question can be settled by running something, not reading. */
  empirical: boolean;
}

/** Questions the published literature answers better than the open web. */
const ACADEMIC_SUBJECT =
  /\b(?:stud(?:y|ies)|research|paper|papers|literature|evidence|trial|trials|meta[-\s]?analys[ie]s|systematic review|peer[-\s]?review(?:ed)?|paper'?s|paradox|theorem|paediatric|pediatric|clinical|epidemiolog|neuro|psycholog|sociolog|biolog|chemistr|physics|genom|protein|algorithm|complexity|proof)\b/i;

/**
 * Questions about a measured quantity in a population.
 *
 * These belong with the academic branch even when nothing in them says
 * "study": a rate, a percentage, a prevalence or a survival curve is produced
 * by somebody's methodology, and the primary source is the only place the
 * method is visible. It is also where widely repeated figures with no origin
 * survive longest, which is exactly what a literature pass is for.
 */
const STATISTICAL_SUBJECT =
  /\b(?:percentage|percent|proportion|share of|rate of|rates?\b|prevalence|incidence|survival|surviv(?:e|es|ing)|likelihood|odds|risk of|average|mean\b|median|correlat|causal|how (?:many|often|likely)|statistics?|per capita|per \d)\b/i;

/** Questions that are settled by running something rather than reading about it. */
const EMPIRICAL_SUBJECT =
  /\b(?:benchmark|benchmarks?|reproduce|replicat(?:e|ion)|simulat(?:e|ion)|dataset|datasets|experiment|experiments?|measure|measurement|compute|calculat(?:e|ion)|model(?:ling|ing)?|implement(?:ation)?|code|prototype|test\s+whether|does\s+it\s+actually)\b/i;

/** Questions whose answer lives in what people are saying, not what is indexed. */
const DISCOURSE_SUBJECT =
  /\b(?:reddit|hacker\s?news|twitter|x\.com|forum|thread|threads|discussion|community|reviews?|complaints?|reports? from|people say|users? say|anecdot|youtube|video|repo|repository|github|issue tracker|changelog|release notes)\b/i;

function guidanceFor(participant: MaxResearchParticipant): string {
  switch (participant) {
    case "deep_research":
      return "";
    case "agent_reach":
      // The first version described the job and got a description back: a live
      // run returned "Reddit via OpenCLI gets one login-backed attempt; GitHub
      // via gh will check whether…" — the agent's plan, reported as its
      // finding. Asking for an approach is how you get one.
      return "Read the open internet rather than the indexed summary of it: discussion threads, practitioner posts, video transcripts, repositories and issue trackers. Report only what you actually found and where you found it — quote or paraphrase what people said, and name the thread, post or repository. Do not describe your plan, your approach, or which tools you intend to use; none of that is a finding. If you reached nothing, say plainly that you reached nothing and which places you tried.";
    case "get_doc":
      return "Prefer the paper that first established a finding over anything that cites it, and note where a widely repeated figure has no primary source behind it.";
    case "openscience":
      return "Where the question can be settled or narrowed by doing rather than reading — a calculation, a reproduction, a small experiment against real data — do that in your workspace and report what you actually observed, separately from what you read.";
    case "praxist":
      return "Run the operator-configured measurable Praxist task project. Report its accepted findings and experiment conditions as empirical evidence; do not imply that the project tested this question when its declared task does not bear on it.";
    case "aris":
      return "";
  }
}

function rationaleFor(participant: MaxResearchParticipant): string {
  switch (participant) {
    case "deep_research":
      return "Multi-round web research, returned cited.";
    case "agent_reach":
      return "The open internet: threads, posts, videos, repositories.";
    case "get_doc":
      return "The primary literature, with free full texts saved.";
    case "openscience":
      return "Settles by doing: code, data and experiments in its own workspace.";
    case "praxist":
      return "Runs the configured multi-agent, multi-generation R&D task and returns its accepted experimental findings.";
    case "aris":
      return "The local research harness's methodology, shaping the plan and the reconciliation.";
  }
}

/**
 * Divide one question among the six.
 *
 * Every question gets all six. Availability is an execution outcome, not a
 * planning filter: a missing service remains visible in the roster and in the
 * final coverage statement instead of making a partial run look complete.
 */
export function planMaxResearch(input: {
  question: string;
}): MaxResearchPlan {
  const question = input.question.trim();
  const research = classifyResearch({ question });

  const academic =
    ACADEMIC_SUBJECT.test(question) ||
    STATISTICAL_SUBJECT.test(question) ||
    research.intent === "historical_reconstruction" ||
    research.factors.conflictLikelihood >= 0.5;
  const empirical = EMPIRICAL_SUBJECT.test(question);
  const discourse = DISCOURSE_SUBJECT.test(question);

  // All six, every time. Choosing between them was the wrong instinct: this is
  // the agent someone reaches for when they have decided the question is worth
  // an hour, and the only thing narrowing the roster buys is a slightly shorter
  // run in exchange for a hole in the answer nobody can see. The classifier was
  // also wrong in the direction that costs most — a question about the highest
  // return in a market reads as neither `academic` nor `empirical`, so the two
  // participants that would have priced it left the plan before it started.
  //
  // `academic` and `empirical` survive as guidance rather than gates: they still
  // shape what each participant is asked to do, they just no longer decide
  // whether it is asked at all.
  const wanted: Array<{
    participant: MaxResearchParticipant;
    wave: number;
    required: boolean;
  }> = [
    // Wave 0 is retrieval, run together. Everything downstream is better for
    // having the record already in hand.
    { participant: "deep_research", wave: 0, required: false },
    { participant: "agent_reach", wave: 0, required: false },
    { participant: "get_doc", wave: 0, required: false },
    // Wave 1 works on what wave 0 found, so it waits.
    { participant: "openscience", wave: 1, required: false },
    { participant: "praxist", wave: 1, required: false },
    { participant: "aris", wave: 1, required: false },
  ];

  const assignments = wanted.map(({ participant, wave, required }) => {
      const guidance = guidanceFor(participant);
      return {
      participant,
      question,
      guidance,
      brief: guidance ? `${question}\n\n${guidance}` : question,
      rationale:
        participant === "agent_reach" && discourse
          ? "The open internet, which this question points at directly."
          : rationaleFor(participant),
      wave,
      required,
      };
    });

  return { question, research, assignments, academic, empirical };
}

/** The waves in order, each as the set that runs together. */
export function participantWaves(
  plan: MaxResearchPlan,
): ParticipantAssignment[][] {
  const byWave = new Map<number, ParticipantAssignment[]>();
  for (const assignment of plan.assignments) {
    byWave.set(assignment.wave, [
      ...(byWave.get(assignment.wave) ?? []),
      assignment,
    ]);
  }
  return [...byWave.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, assignments]) => assignments);
}
