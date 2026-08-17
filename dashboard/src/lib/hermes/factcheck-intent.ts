import type { HermesSurface } from "./config.ts";

/**
 * Selects the Bullshit Detector skill from what the user actually types. The
 * pack's whole premise is that the question arrives casually — "is this
 * bullshit?" with a link pasted after it — so requiring `/bullshit-detector`
 * would put the skill behind a phrasing nobody uses at the moment they want it.
 *
 * The bar is deliberately higher than the premortem router's: this one can be
 * triggered by a bare URL in a sentence, so an ambiguous ask must not claim the
 * turn. A verification verb has to be present, or a continuation has to follow
 * a report this conversation already produced.
 */

/** An explicit ask to audit something's truth. */
const EXPLICIT_FACTCHECK =
  /\b(?:bull-?shit|bs[-\s]?(?:score|check|detector)|fact[-\s]?check(?:ed|ing)?|debunk(?:ed|ing)?)\b/i;

/**
 * Verification verbs that only mean "audit this" when they are pointed at a
 * piece of content. `is this true` about the conversation itself is a different
 * question, and it does not carry a link.
 */
const VERIFY_VERB =
  /\b(?:is (?:this|that|it) (?:true|real|legit|accurate|actually true|for real)|how much of (?:this|it) (?:is true|holds up|checks out)|does (?:this|it) (?:hold up|check out)|verify (?:this|the claims)|check (?:the )?claims|are these claims|is (?:this|he|she|they) lying)\b/i;

/** A link or attached document is the thing being audited. */
const CONTENT_REFERENCE =
  /(?:https?:\/\/\S+|\b(?:this|that|the) (?:video|article|post|tweet|thread|paper|pdf|clip|podcast|transcript|draft|readme|announcement)\b)/i;

/** Vocabulary that only appears once a report exists. */
const REPORT_CONTEXT =
  /\b(?:bs score|claims? table|load[-\s]?bearing|incidental claims?|hype signals?|steel-?man|verdicts?|unverifiable|misleading|tally|not checked|hostile reader|incentive analysis)\b/i;

const CONTINUATION =
  /^(?:(?:yes|no|okay|ok|sure|continue|next|proceed|go ahead|retry|try again|keep going)\b|(?:check|verify|recheck|re-?check|search|source|expand|split|drop|add|explain|why|show)\b[\s\S]{0,220}|[\s\S]{0,220}\b(?:claim|verdict|source|score|row|tally|evidence|steelman|origin)\b)/i;

const AWAITING_REPORT_INPUT =
  /\b(?:what would you like me to (?:fact-?check|check)|paste the (?:text|transcript|tweet)|which claims? should i|want me to (?:check|verify) (?:the rest|more)|should i run the full check)\b/i;

function isFactcheckContinuation(input: {
  text: string;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  const recentAssistants = [...(input.priorMessages ?? [])]
    .reverse()
    .filter((message) => message.role === "assistant")
    .slice(0, 3)
    .map((message) => message.content.trim());
  const latestAssistant = recentAssistants[0];
  if (!latestAssistant) return false;
  if (
    AWAITING_REPORT_INPUT.test(latestAssistant) ||
    (
      recentAssistants.some((message) => REPORT_CONTEXT.test(message)) &&
      /\?\s*$/.test(latestAssistant)
    )
  ) {
    return input.text.trim().length <= 2_000;
  }
  return REPORT_CONTEXT.test(latestAssistant) && CONTINUATION.test(input.text.trim());
}

export function factcheckCommandText(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available =
    input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  const automatic =
    available &&
    Boolean(text) &&
    !text.startsWith("/") &&
    (
      EXPLICIT_FACTCHECK.test(text) ||
      (VERIFY_VERB.test(text) && CONTENT_REFERENCE.test(text)) ||
      isFactcheckContinuation({ text, priorMessages: input.priorMessages })
    );
  return {
    text: automatic ? `/bullshit-detector ${input.text}` : input.text,
    automatic,
  };
}
