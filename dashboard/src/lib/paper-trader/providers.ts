// When to give up on one provider and ask another.
//
// The desk runs everything through ChatMock, which fronts several providers, and
// the account behind the default one has a usage limit. Reaching it is not an
// exotic failure: it is the ordinary end of a busy day, and when it happens
// every model call the desk makes fails at once — the analyses that produce its
// verdicts and the advisers that temper them. The desk then holds every cycle,
// indefinitely, while looking entirely healthy.
//
// So exhaustion gets a second attempt on Anthropic, and nothing else does. That
// asymmetry is the whole point of this module. A run that fell over on a bad
// ticker, an unreachable vendor or a broken environment will fall over the same
// way on any model; retrying it elsewhere costs a second quota to reach the same
// failure more slowly. Only "you have run out" is a reason to ask someone else.
//
// Lives apart from ./committee.ts and ./decisions.ts because both of them need
// it and they already reference each other's types.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";

/**
 * Whether a failure is "you have run out", rather than "this went wrong".
 *
 * The strings are the ones the relay and the SDKs beneath it actually emit; a
 * 429 arrives wrapped in whatever the provider's client library calls it, so the
 * status code is matched as well as the words. It is matched on word boundaries
 * because a completion that happens to use 3429 tokens is not a rate limit, and
 * spending someone's Anthropic quota over one would be a silly way to read a
 * number.
 */
export function isUsageExhausted(message: string): boolean {
  return /\b429\b|rate[ _-]?limit|usage limit|quota|insufficient_quota|too many requests|exceeded your current/i.test(
    message,
  );
}

/**
 * Preference order for the fallback. The middle model is the right balance for
 * the work the desk asks of it; the others exist so a machine that offers only
 * one of them still gets an answer.
 */
const ANTHROPIC_PREFERENCE = ["claude-sonnet", "claude-opus", "claude-haiku", "claude"];

export function pickAnthropicModel(available: readonly string[]): string | null {
  for (const wanted of ANTHROPIC_PREFERENCE) {
    const found = available.find((id) => id.toLowerCase().includes(wanted));
    if (found) return found;
  }
  return null;
}

/**
 * Which Claude to fall back to, asked of the relay rather than hard-coded.
 *
 * The ids carry a prefix that depends on how this machine reaches Anthropic —
 * `cliproxy/claude-sonnet-5` through the subscription proxy today, something
 * else on a differently configured machine. Guessing one produces a model error
 * at the worst possible moment: when the desk has already been told it is out of
 * quota and this is its last chance to get an answer.
 */
export async function anthropicFallbackModel(): Promise<string | null> {
  try {
    const response = await fetch(`${localChatmockBaseUrl().replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${chatmockApiKeyValue()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
      .filter(Boolean);
    return pickAnthropicModel(ids);
  } catch {
    // No catalogue means no fallback; the caller reports the original failure.
    return null;
  }
}
