// Ratings as a source of eval cases, not as a training signal.
//
// This is the layer that makes the thumbs worth having. A downvote is a bad
// input to a prompt — there are too few of them, they are confounded, and
// feeding them back directly optimises toward whatever happened to get clicked.
// A downvote is an excellent input to a *regression suite*: it is a real
// failure, on a real question, that a human noticed. Turning it into a scenario
// costs nothing at answer time, cannot reward-hack because a human decides what
// gets promoted, and pays off every time a contract changes.
//
// The output of this module is a *candidate*, never a scenario. Candidates land
// in `qa/answer-quality/candidates.json`; promoting one into `scenarios.json`
// is a human edit. That is deliberate: a scenario carries the question and the
// answer verbatim out of a private conversation, and a benchmark file is read,
// diffed and shared in a way a chat transcript is not.
//
// The properties generated per reason are the assertions a grader checks. Three
// of the four reasons map onto a property that holds for any subject; `style`
// does not, and says so rather than inventing one.

import type { AnswerSignal, SignalReason } from "./answer-signals.ts";

/** Questions shorter than this carry no scenario worth replaying. */
export const MIN_QUESTION_CHARS = 12;

export const MAX_QUESTION_CHARS = 2_000;
export const MAX_ANSWER_CHARS = 8_000;

export interface ScenarioCandidateInput {
  signal: AnswerSignal;
  /** The user turn the rated answer replied to. */
  question: string;
  /** The answer as rated. */
  answer: string;
}

export interface ScenarioCandidate {
  id: string;
  reason: SignalReason;
  question: string;
  /** Kept so a reviewer can see what was actually wrong before promoting it. */
  failingAnswer: string;
  conditions: Record<string, unknown>;
  must: string[];
  mustNot: string[];
  /**
   * True when the generated properties are placeholders a human has to replace
   * before the scenario means anything. A benchmark that asserts a property
   * nobody chose will pass or fail for reasons unrelated to the complaint.
   */
  propertiesNeedReview: boolean;
  nominatedAt: string;
}

interface ReasonProperties {
  must: string[];
  mustNot: string[];
  needsReview: boolean;
}

/**
 * What a corrected answer would have to do, per reason.
 *
 * These are written as properties of *any* answer on *any* subject, in the
 * style the evidence-calibration set already uses: nothing here looks for a
 * particular sentence, because an answer that satisfies the property in its own
 * words is a passing answer.
 */
function propertiesFor(reason: SignalReason): ReasonProperties {
  switch (reason) {
    case "wrong":
      return {
        must: [
          "Every factual claim is supported by the material supplied with the question, or is marked as unverified.",
          "Where the material does not settle the question, the answer says so instead of choosing an answer.",
        ],
        mustNot: [
          "States as fact anything the supplied material does not support.",
          "Presents an inference as an observation.",
        ],
        needsReview: false,
      };
    case "too_long":
      return {
        must: [
          "The answer to the question asked appears before any background, caveats or alternatives.",
          "A question with one factual answer gets that answer without a survey around it.",
        ],
        mustNot: [
          "Opens by restating the question or narrating what it is about to do.",
          "Adds qualifications that do not change what the asker should do.",
        ],
        needsReview: false,
      };
    case "missed_point":
      return {
        must: [
          "The literal question asked is answered before anything adjacent to it.",
          "Every constraint stated in the question is addressed.",
        ],
        mustNot: [
          "Answers a related question the asker did not ask.",
          "Reframes the question before answering the original.",
        ],
        needsReview: false,
      };
    case "style":
    default:
      // There is no subject-independent property for register. A reviewer has
      // to say what the answer should have sounded like, because the rating
      // said only that it sounded wrong.
      return {
        must: ["REVIEW: state what register or shape this answer should have had."],
        mustNot: ["REVIEW: state what this answer did that it should not have."],
        needsReview: true,
      };
  }
}

function condense(value: string, limit: number): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

/**
 * A slug from the question, so two nominations of the same question collide
 * instead of accumulating. The message id is deliberately not used: the same
 * question asked twice and rated down twice is one scenario, not two.
 */
export function candidateId(reason: SignalReason, question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-");
  return `${reason}-${slug || "untitled"}`;
}

export function nominateScenarios(
  inputs: readonly ScenarioCandidateInput[],
): ScenarioCandidate[] {
  const candidates = new Map<string, ScenarioCandidate>();

  for (const input of inputs) {
    const { signal } = input;
    // Only an explicit, reasoned complaint nominates. An implicit signal says
    // an answer was not taken as given and nothing about what a correct one
    // would look like, which is not enough to write an assertion from.
    if (signal.kind !== "rated_down" || !signal.reason) continue;

    const question = condense(input.question, MAX_QUESTION_CHARS);
    const answer = condense(input.answer, MAX_ANSWER_CHARS);
    if (question.length < MIN_QUESTION_CHARS || !answer) continue;

    const id = candidateId(signal.reason, question);
    // First nomination wins. A later one carries the same question and a
    // different answer, and the earlier answer is the one that was rated.
    if (candidates.has(id)) continue;

    const properties = propertiesFor(signal.reason);
    candidates.set(id, {
      id,
      reason: signal.reason,
      question,
      failingAnswer: answer,
      conditions: signal.conditions,
      must: properties.must,
      mustNot: properties.mustNot,
      propertiesNeedReview: properties.needsReview,
      nominatedAt: signal.updatedAt,
    });
  }

  return [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Merge freshly nominated candidates into the file already on disk, keeping
 * reviewer edits. A reviewer who has rewritten a `style` candidate's properties
 * must not have that work overwritten the next time the miner runs.
 */
export function mergeCandidates(
  existing: readonly ScenarioCandidate[],
  nominated: readonly ScenarioCandidate[],
): { candidates: ScenarioCandidate[]; added: number } {
  const merged = new Map(existing.map((candidate) => [candidate.id, candidate]));
  let added = 0;
  for (const candidate of nominated) {
    if (merged.has(candidate.id)) continue;
    merged.set(candidate.id, candidate);
    added += 1;
  }
  return {
    candidates: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
    added,
  };
}
