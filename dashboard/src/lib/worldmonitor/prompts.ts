import { renderSystemPrompt } from "../system-prompts/service.ts";
// The prompts, ported from the worldmonitor clone (github.com/koala73/worldmonitor,
// AGPL-3.0): `server/worldmonitor/news/v1/_shared.ts` (brief),
// `server/worldmonitor/intelligence/v1/chat-analyst-prompt.ts` (analyst) and
// `.../classify-event.ts` (classification).
//
// Upstream fans these out over Ollama → OpenRouter → Groq. Breadboard sends all
// three to ChatMock, so whichever model the Intelligence picker is pointing at
// is the one reading the wire.
//
// The injection defense in the analyst prompt is upstream's and is not
// optional: every word of context here is third-party feed text, and a headline
// is perfectly capable of containing "ignore your previous instructions".

import type { ClimateIndicator, HazardEvent, NewsItem } from "./types.ts";

/** Strip the shapes a feed could use to end the data section and start giving orders. */
export function sanitizeForPrompt(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/^\s*(?:---+|===+|```+)\s*$/gm, " ")
    .replace(/\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:your\s+|the\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/gi, "[redacted]")
    .replace(/\b(?:system|assistant|developer)\s*:/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

// ── Measured context ────────────────────────────────────────────────────────

/**
 * The climate panel's numbers, compressed into a few lines the brief and the
 * analyst can quote. This is the one part of the context that is not feed text:
 * it comes from NOAA, NASA, NSIDC and GDACS, so it is the only thing on the
 * page a model is allowed to state as fact rather than as reporting.
 *
 * Returns an empty string when nothing was read, so the prompt simply loses the
 * section rather than carrying an empty heading the model might try to fill.
 */
export function buildMeasuredContext(
  indicators: ClimateIndicator[],
  hazards: HazardEvent[],
): string {
  const lines: string[] = [];

  for (const indicator of indicators) {
    const change =
      indicator.change === undefined
        ? ""
        : ` (${indicator.change > 0 ? "+" : ""}${indicator.change} ${indicator.changeLabel ?? ""})`;
    lines.push(
      `- ${sanitizeForPrompt(indicator.label)}: ${indicator.value} ${indicator.unit}${change}, observed ${indicator.asOf}, ${sanitizeForPrompt(indicator.source)}`,
    );
  }

  // Only the assessed alerts. GDACS raises a green one for every tracked event,
  // and a list of two hundred routine tremors would drown the section.
  const alerting = hazards.filter((hazard) => hazard.alert !== "green").slice(0, 12);
  for (const hazard of alerting) {
    lines.push(
      `- ${hazard.alert.toUpperCase()} ${hazard.kind} alert: ${sanitizeForPrompt(hazard.title)}${hazard.country ? ` (${sanitizeForPrompt(hazard.country)})` : ""}`,
    );
  }

  return lines.join("\n");
}

// ── Brief ───────────────────────────────────────────────────────────────────

/**
 * Upstream's brief prompt asks for the single most important story, and every
 * rule in it exists because a model broke that rule: the "separate stories"
 * insistence stops facts being welded across headlines, and the TV-opening ban
 * stops "Good evening, tonight…".
 *
 * Breadboard widens it from one story to a short situational read, because this
 * pane is the top of a dashboard rather than a ticker — the anti-merging and
 * anti-speculation rules are kept verbatim in spirit.
 */
export function buildBriefPrompts(
  items: NewsItem[],
  scopeLabel: string,
  /** The climate panel's readings, when they were available. */
  measured = "", userId?: number | null
): {
  system: string;
  user: string;
} {
  const system = renderSystemPrompt("world-brief", userId, { "current_date": String(today()), "coverage": String(scopeLabel), "measurement_rules": String(measured
    ? `- MEASUREMENTS below are instrument readings, not reporting: cite one only when a headline touches weather, climate or a natural hazard, and never build a paragraph out of them alone
`
    : "") });

  const lines = items.map((item, index) => {
    const level = item.threat.level.toUpperCase();
    const corroboration =
      item.corroboration > 1 ? ` [${item.corroboration} sources]` : "";
    return `${index + 1}. [${level}] ${sanitizeForPrompt(item.title)} — ${sanitizeForPrompt(item.source)}${corroboration}`;
  });

  // The measured block sits outside the HEADLINES delimiters on purpose: those
  // fence off untrusted feed text, and these numbers are not that.
  const measuredBlock = measured ? `\n\nMEASUREMENTS\n${measured}\nEND MEASUREMENTS` : "";

  return {
    system,
    user: `HEADLINES\n${lines.join("\n")}\nEND HEADLINES${measuredBlock}`,
  };
}

// ── Analyst ─────────────────────────────────────────────────────────────────

/** Upstream's senior-analyst prompt, with the live window as its only ground. */
export function buildAnalystSystemPrompt(
  items: NewsItem[],
  context: { escalation: number; scopeLabel: string; measured?: string }, userId?: number | null
): string {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const headlines = items.length
    ? items
        .map((item) => {
          const when = new Date(item.published).toISOString().slice(5, 16).replace("T", " ");
          const corroboration =
            item.corroboration > 1 ? ` (${item.corroboration} sources)` : "";
          return `- [${item.threat.level}/${item.threat.category}] ${sanitizeForPrompt(item.title)} — ${sanitizeForPrompt(item.source)}, ${when}${corroboration}`;
        })
        .join("\n")
    : "(No live headlines available. Acknowledge this limitation explicitly. Do not present inference or training knowledge as current intelligence.)";

  return renderSystemPrompt("world-analyst", userId, { "timestamp": String(timestamp), "coverage": String(context.scopeLabel), "escalation": String(context.escalation), "headlines": String(headlines), "measurements": String(context.measured
      ? `

## Measurements
These are instrument readings from NOAA, NASA, NSIDC and the GDACS alerting service — not feed text, and the only figures here you may state as fact. Quote them when the question touches climate, weather or a natural hazard; do not extrapolate a trend from them.
${context.measured}`
      : "") });
}

// ── Classification ──────────────────────────────────────────────────────────

/** Upstream's classifier prompt, verbatim apart from the batching instruction. */
import { PROMPT_WORLD_CLASSIFICATION as CLASSIFY_SYSTEM_PROMPT } from "../system-prompts/feature-defaults.ts";
export { CLASSIFY_SYSTEM_PROMPT };
