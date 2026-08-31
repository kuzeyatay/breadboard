// What a reply cost, in money rather than tokens.
//
// Breadboard talks to every provider through one local doorway, so the reply
// itself never carries a price — only a model id and a token count. This module
// is the hand-maintained bridge between the two, and it is deliberately the
// only place a rate appears.
//
// Two rules keep the number honest rather than merely impressive:
//
//   * A model with no entry here is *unpriced*, never free. The profile counts
//     those replies separately and says so, because a subscription model, a
//     local model and a model nobody has added a rate for are three different
//     things that a silent zero would render identical.
//   * Cached-input and reasoning discounts are not modelled. Providers disagree
//     about whether cached tokens are already inside the input count, and a
//     double-subtraction would understate the bill. What comes out is therefore
//     an upper bound, and the profile says that too.
//
// Rates are USD per million tokens. Add a model by its bare id — the provider
// prefix and the release-date stamp are stripped before the lookup, so one
// entry covers `claude-opus-5`, `cliproxy/claude-opus-5` and
// `openrouter/anthropic/claude-opus-5-20260101` alike.

export interface ModelRate {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * Published list prices, current as of August 2026.
 *
 * OpenAI source: https://developers.openai.com/api/docs/models/compare
 * Anthropic source: https://www.anthropic.com/pricing
 *
 * These are API list prices, not a claim about what a ChatGPT subscription or
 * a locally hosted model actually bills. The profile explains that distinction
 * beside the estimate.
 */
export const MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  // The unsuffixed alias resolves to Sol and carries the same list price.
  "gpt-5.6": { input: 4, output: 20 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "claude-fable-5": { input: 10, output: 50 },
  // Same model at the same published rate. The pxpipe route saves money by
  // sending far fewer input tokens for the same context, not by buying them
  // cheaper — so the discount has to show up in the token counts, and a lower
  // rate here would double-count it.
  "claude-fable-5-efficient": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Release-date suffix: `-20260101`, or the dashed `-2026-01-01` spelling. */
const RELEASE_DATE_SUFFIX = /-\d{4}-?\d{2}-?\d{2}$/;

/**
 * The model id with its routing stripped off.
 *
 * Only the last path segment names the model — everything before it is the
 * route that carried the request (`cliproxy/`, `openrouter/anthropic/`), which
 * says nothing about price.
 */
export function bareModelId(modelId: string): string {
  const lastSegment = modelId.slice(modelId.lastIndexOf("/") + 1).trim().toLowerCase();
  return lastSegment.replace(RELEASE_DATE_SUFFIX, "") || lastSegment;
}

export function modelRate(modelId: string): ModelRate | null {
  return MODEL_RATES[bareModelId(modelId)] ?? null;
}

/**
 * What those tokens cost on that model, or null when the model has no rate.
 *
 * Null is the whole point: it is what lets the caller report "3,412 replies
 * priced, 806 we have no rate for" instead of quietly adding zero.
 */
export function priceUsd(
  modelId: string,
  tokens: { inputTokens: number; outputTokens: number },
): number | null {
  const rate = modelRate(modelId);
  if (!rate) return null;
  return (
    (Math.max(0, tokens.inputTokens) / 1_000_000) * rate.input +
    (Math.max(0, tokens.outputTokens) / 1_000_000) * rate.output
  );
}

/**
 * A money string that stays readable across four orders of magnitude.
 *
 * Sub-cent totals are the normal case early on, and rounding them to "$0.00"
 * reads as "this was free" — which is the one thing the number exists to
 * contradict.
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  if (amount < 100) return `$${amount.toFixed(2)}`;
  if (amount < 10_000) return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `$${(amount / 1000).toFixed(1)}k`;
}
