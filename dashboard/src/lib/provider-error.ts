/**
 * Turning a failed model call into something worth reading.
 *
 * When an upstream refuses a request it usually says why, and says it to the
 * person who can act on it — "Add more at claude.ai/settings/usage", "The usage
 * limit has been reached". That sentence is the most useful thing Breadboard
 * can show, so a failed turn renders it as the assistant's answer instead of a
 * generic "something went wrong".
 *
 * Getting there means stripping what each layer wrapped around it. A single
 * message can arrive as:
 *
 *   ❌ Non-retryable error (HTTP 400): HTTP 400: cliproxy returned HTTP 400: <it>
 *
 * — the agent runtime, its HTTP client, and the gateway each prepending their
 * own frame, including internal routing ids (`cliproxy` is Breadboard's own
 * subscription proxy) that name plumbing rather than anything the reader chose.
 * This module is provider-agnostic on purpose: the same unwrapping applies to
 * whichever upstream is serving.
 */

/**
 * Ids that name Breadboard's internal plumbing rather than a provider the user
 * picked, and what to call them instead. These must never reach the screen; a
 * provider the user actually configured (Anthropic, OpenRouter, Groq) is fair
 * to name. Wording matches the usage popover, which already calls the
 * subscription proxy "your subscription".
 */
const INTERNAL_ROUTE_IDS: ReadonlyArray<[string, string]> = [
  ["cliproxy", "your subscription"],
  ["chatmock", "the model gateway"],
  ["breadboard", "the model gateway"],
];

/** Wrappers each layer adds, stripped from the front until none are left. */
const WRAPPER_PREFIXES: RegExp[] = [
  /^[⚙⚠❌❗ℹ️\u{1F534}\u{1F6D1}\u{1F6A8}]+\s*/u,
  /^(?:non-retryable\s+)?(?:client\s+)?error(?:\s*\(HTTP\s*\d{3}\))?\s*[:\-]\s*/i,
  /^API call failed(?:\s+after\s+\d+\s+retries?)?\s*[:\-]\s*/i,
  /^(?:Streaming|Request)\s+failed(?:\s+before\s+delivery)?\s*[:\-]\s*/i,
  /^Error code:\s*\d{3}\s*-\s*/i,
  /^HTTP\s*\d{3}\s*[:\-]\s*/i,
  // "<provider> returned HTTP 400: ", including the internal ids above.
  /^[A-Za-z][\w .-]{0,40}\s+returned\s+HTTP\s*\d{3}\s*[:\-]\s*/i,
];

/** A bare JSON error envelope, which some layers stringify verbatim. */
function unwrapJsonEnvelope(text: string): string {
  if (!text.startsWith("{")) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return text;
    const record = parsed as Record<string, unknown>;
    // `detail` belongs here beside `error`: the ChatGPT backend refuses a model
    // or an account with {"detail": "..."} and nothing else, and that sentence
    // is the whole explanation.
    const error = record.error ?? record.message ?? record.detail;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  } catch {
    // Not JSON after all — the raw text is still the best we have.
  }
  return text;
}

/**
 * The upstream's own explanation, with every wrapper and internal id removed.
 *
 * Returns an empty string when nothing readable survives, so callers can decide
 * between showing this and their own fallback rather than being handed a stub.
 */
export function humanizeProviderError(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  if (!text) return "";

  // Bounded: each pass must remove something or the loop ends.
  for (let pass = 0; pass < 8; pass += 1) {
    const before = text;
    text = unwrapJsonEnvelope(text).trim();
    for (const prefix of WRAPPER_PREFIXES) {
      text = text.replace(prefix, "").trim();
    }
    if (text === before) break;
  }

  // Anything still naming internal plumbing is describing our own routing, not
  // a fact about the provider — drop the clause rather than rename it, since a
  // renamed one ("Subscriptions returned HTTP 400") is still noise in front of
  // an explanation that already stands on its own.
  for (const [id, replacement] of INTERNAL_ROUTE_IDS) {
    text = text
      .replace(
        new RegExp(`\\b${id}\\b\\s+returned\\s+HTTP\\s*\\d{3}\\s*[:\\-]?\\s*`, "gi"),
        "",
      )
      .replace(new RegExp(`\\b${id}\\b`, "gi"), replacement);
  }

  return text.replace(/\s{2,}/g, " ").trim();
}

/**
 * Failure *shapes*, not the mere mention of a status code — an answer about
 * writing an HTTP 404 handler is not a failure, and rewriting it would corrupt
 * ordinary output.
 */
const FAILURE_SHAPES: RegExp[] = [
  /^(?:non-retryable|API call failed|Error code:|Streaming failed|Request failed)/i,
  /\breturned\s+HTTP\s*[45]\d{2}\b/i,
  /^HTTP\s*[45]\d{2}\s*[:\-]/i,
];

/** Does this text look like an upstream failure rather than a model answer? */
export function isProviderErrorText(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  // Runtime status lines lead with an emoji marker; ignore it when matching.
  const text = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!text) return false;
  return FAILURE_SHAPES.some((shape) => shape.test(text));
}

/**
 * What a failed turn shows the user.
 *
 * Prefers the upstream's own sentence; falls back to a plain statement rather
 * than an empty bubble when the failure carried no readable text.
 */
export function providerErrorResponse(
  raw: unknown,
  fallback = "The model provider could not complete this request.",
): string {
  const message = humanizeProviderError(raw);
  // A status code is not an explanation, but it is the only fact left when the
  // upstream sent no message — keep it as a detail on a sentence that reads.
  if (!message || /^HTTP\s*\d{3}\.?$/i.test(message)) {
    const status =
      typeof raw === "string" ? /\bHTTP\s*([45]\d{2})\b/i.exec(raw)?.[1] : undefined;
    return status ? `${fallback} (HTTP ${status})` : fallback;
  }
  return message;
}
