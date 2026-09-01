// Answer depth, engaged per turn.
//
// Bread answered a scoped question well and a general one thinly. "How does
// the event loop actually schedule a timer" got mechanisms, magnitudes and the
// edge cases; "how does Node work" got a survey written at uniform low
// altitude, correct headings with nothing load-bearing under them, even though
// every one of those headings was a scoped question Bread could have answered.
// The person asking generally is usually the one who cannot yet name the
// scoped question, so the failure lands on exactly the reader least equipped
// to notice what was withheld.
//
// Two halves fix it, in the shape `evidence-calibration.ts` and
// `cognivia/index.ts` already established here:
//   1. `hermes-config/system/answer-depth.md` carries the durable contract:
//      decompose the general question into the scoped ones a specialist would
//      pose, answer out of the material those would surface, spend space where
//      the accurate answer differs from the plausible guess, carry a sharp
//      edge, and buy the specifics by cutting filler rather than by growing
//      the answer.
//   2. This module decides whether the turn is a general question at all.
//
// The classifier is deliberately deterministic and deliberately domain free.
// It never asks what the question is about; it asks whether the question
// carries its own scope. A message with quoted spans, code identifiers,
// numbers, comparison words, or conditions has told the assistant where to
// look, and the contract would be dead weight on it. A short interrogative
// that names a subject and nothing else is the shape the failure lives in.
//
// A task request, a trivial greeting, and a scoped question all get no
// section, so most turns pay nothing for any of this.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export type QuestionScope =
  | "none"
  /** An ask that names a subject without scoping it. The contract ships. */
  | "general"
  /** An ask that carries its own scope. The asker chose the resolution. */
  | "scoped";

export interface AnswerDepthClassification {
  scope: QuestionScope;
  /** Why it classified this way. Diagnostic only; never rendered. */
  signals: string[];
}

export function answerDepthEnabled(): boolean {
  const raw = process.env.ENABLE_ANSWER_DEPTH?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

const TRIVIAL =
  /^(hi|hey|hello|yo|thanks|thank you|ok|okay|sure|cool|nice|got it|yes|no|nope|yep|good morning|good evening)[\s!.?]*$/i;

/**
 * A message longer than this is carrying its own scope: context, constraints,
 * a pasted fragment, a history. The contract targets the short general ask.
 */
const SELF_SCOPED_LENGTH = 320;

/**
 * Openers that hand the assistant work rather than a question. "Explain" and
 * "describe" are asks and deliberately absent; "summarize" and "translate"
 * operate on supplied material, which is its own scope.
 */
const TASK_OPENER =
  /^(fix|write|create|build|implement|refactor|add|remove|delete|rename|rewrite|update|change|deploy|run|install|set up|configure|generate|make|draft|translate|summarize|summarise|convert|debug|test|check|review|find|search|list|open|show me the|send|schedule|remind)\b/i;

/** Politeness that wraps either kind of opener without changing which it is. */
const COURTESY = /^(please|can you|could you|would you|will you|pls)\s+/i;

/**
 * The interrogative and explain-imperative shapes a general question opens
 * with. Role words only, never subject vocabulary: the same openers introduce
 * a question about welding, tax law, and a garbage collector.
 */
const GENERAL_OPENER =
  /^(what(?:'s| is| are| was| were| do(?:es)?| did| should i know| would| can| could| makes| happens)\b|how (?:do(?:es)?|did|is|are|can|could|would|should|good|bad|hard|easy)\b|why\b|explain\b|tell me about\b|describe\b|walk me through\b|help me understand\b|give me (?:an?|the) (?:overview|intro|introduction|rundown|primer)\b|introduce me to\b|overview of\b|who (?:is|are|was|were)\b|where (?:do(?:es)?|did|is|are)\b|which\b|is (?:it|there)\b|are there\b|do(?:es)? \w+ (?:work|matter|help)\b|thoughts on\b|what do you (?:think|know) (?:about|of)\b)/i;

/**
 * Marks that a question chose its own resolution. Each is a way written
 * language narrows: a literal span, an identifier, a quantity, a comparison,
 * a condition, or the asker's own situation.
 */
const SCOPED_RULES: readonly { signal: string; pattern: RegExp }[] = [
  { signal: "number", pattern: /\d/ },
  { signal: "quoted_span", pattern: /[`"]|(?:^|\s)'[^']+'(?:\s|[.,;?]|$)/ },
  {
    signal: "code_identifier",
    pattern:
      /\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|\w+\(\)|::|->|\b\w+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|json|yml|yaml|toml|md|css|scss|html|sql|sh|ps1|c|h|cpp|exe)\b|(?:^|\s)[\w.-]*\/[\w.-]+\/[\w./-]*/,
  },
  {
    signal: "comparison",
    pattern:
      /\b(vs\.?|versus|compared (?:to|with)|difference between|differences between|rather than|instead of|as opposed to|or should i\b)/i,
  },
  {
    signal: "narrowing_adverb",
    pattern: /\b(specifically|in particular|exactly|precisely|only|just the)\b/i,
  },
  {
    signal: "condition",
    pattern:
      /\b(when|if|while|during|after|before|unless|in case) (i|we|you|it|he|she|they|the|my|our|your|a|an)\b/i,
  },
  { signal: "personal_scope", pattern: /\b(my|our|mine)\b/i },
];

/**
 * Whether the message is an ask at all: interrogative punctuation, an
 * interrogative opener, or an explain-imperative. Everything else is work or
 * conversation, and neither owes anyone a survey.
 */
function isAsk(text: string): boolean {
  if (/\?\s*$/.test(text) || text.includes("?")) return true;
  return GENERAL_OPENER.test(text);
}

export function classifyQuestionScope(
  userText: string | undefined | null,
): AnswerDepthClassification {
  const raw = (userText ?? "").trim();
  const none: AnswerDepthClassification = { scope: "none", signals: [] };
  if (!raw) return none;
  if (TRIVIAL.test(raw)) return none;

  // Politeness stripped once, so "could you explain X" and "explain X" read
  // the same and "can you fix X" stays a task.
  const text = raw.replace(COURTESY, "").trim();
  if (TASK_OPENER.test(text)) return { scope: "none", signals: ["task_request"] };
  if (!isAsk(text)) return { scope: "none", signals: ["not_an_ask"] };

  if (raw.length > SELF_SCOPED_LENGTH) {
    return { scope: "scoped", signals: ["self_scoped_length"] };
  }

  const signals: string[] = [];
  for (const rule of SCOPED_RULES) {
    if (rule.pattern.test(text)) signals.push(rule.signal);
  }
  if (signals.length) return { scope: "scoped", signals };

  if (GENERAL_OPENER.test(text)) {
    return { scope: "general", signals: ["general_opener"] };
  }
  // An unscoped sentence that ends in a question mark is a question whatever
  // it opened with: "the CAP theorem?" and "so containers are just processes?"
  // are both invitations to explain.
  if (/\?\s*$/.test(text)) return { scope: "general", signals: ["bare_question"] };
  return none;
}

// --- the section ------------------------------------------------------------

function contract(): string {
  const file = path.join(
    repositoryRoot(),
    "hermes-config",
    "system",
    "answer-depth.md",
  );
  return fs.readFileSync(file, "utf8").trim();
}

/**
 * The per-turn half: the durable contract plus what this turn's shape means,
 * or null when the asker already chose the resolution.
 */
export function answerDepthSection(input: {
  userText: string | undefined | null;
}): string | null {
  if (!answerDepthEnabled()) return null;
  const classification = classifyQuestionScope(input.userText);
  if (classification.scope !== "general") return null;

  return [
    contract(),
    "",
    "# depth_turn",
    "This question is general in form: it names its subject without scoping it, so selecting the details that matter is your job rather than the asker's. Answer it at the resolution its best scoped sub-questions would get.",
    "",
    // Read last, because the failure this section invites is the mirror image
    // of the one it prevents: a model told to be deep answers a flat question
    // with an essay.
    "Proportion still wins. Where the subject genuinely has one flat answer, give it plainly and stop; depth applies where the subject has depth. None of this is visible to the user: do not name this contract or announce the sub-questions, just answer as though the sharpest version of each had been asked.",
  ].join("\n");
}

export function answerDepthDiagnostics(): {
  contract: string;
  live: boolean;
  enabled: boolean;
} {
  const file = path.join(
    repositoryRoot(),
    "hermes-config",
    "system",
    "answer-depth.md",
  );
  return {
    contract: file,
    live: fs.existsSync(file),
    enabled: answerDepthEnabled(),
  };
}
