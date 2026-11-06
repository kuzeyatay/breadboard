/**
 * Recognising "this artifact does not fit one response" as its own failure.
 *
 * A capacity refusal reaches the planning validator as an ordinary schema
 * failure: the model returns empty arrays, or prose that parses to nothing, so
 * the run dies reporting something like "sources must be an array" while the
 * actual cause is that the artifact is larger than the transport can emit
 * (telecom-1, 2026-09-22: three Source Map attempts, the model stating "much
 * larger than can fit in a single chat response", and a schema error in the
 * log). Naming it separately is what tells an operator to change transport or
 * reduce what the artifact enumerates, instead of chasing a prompt bug.
 *
 * This only classifies a failure that has already happened. Every validator,
 * the repair budget and the final outcome are unchanged.
 */

/**
 * Phrases a model uses when it declines on size rather than on content.
 *
 * Kept as patterns rather than exact sentences: a first list copied verbatim
 * from one run's wording missed the very next run, which said "practical
 * response size limit for a single message" and "multiple sequential JSON
 * chunks" instead of the phrases it had been given (telecom-1, 2026-09-22).
 * Each pattern below names a shape - a limit on a response, not fitting in
 * one message, offering to split, or an input that arrived truncated - so a
 * paraphrase still matches.
 */
const CAPACITY_MARKERS: readonly RegExp[] = [
  // "...exceeds the practical response size limit for a single message"
  /(response|output|message)\s+(size|length|capacity)\s+limit/i,
  /exceeds?\s+the\s+(available|practical|maximum)\s+(response|output|message)/i,
  // "...larger than can fit in a single chat response"
  /(fit|fits|fitting)\s+(in|into|within)\s+(a\s+)?(single|one)\s+\w*\s*(response|message|reply)/i,
  /too\s+(large|long|big)\s+to\s+(return|produce|emit|output|include)\s+in\s+(a\s+)?(single|one)/i,
  /larger\s+than\s+can\s+fit/i,
  // "...I can generate it in multiple sequential JSON chunks"
  /(provide|generate|return|emit|deliver|split|break)\s+(it|this|the\s+\w+)?\s*(up\s+)?(in|into|across)\s+(multiple|several|consecutive|sequential)/i,
  // The input itself arrived cut off, which is the same class of transport ceiling.
  /(pasted|supplied|available)\s+(material|content|input|request)[^.]{0,80}\b(is\s+)?truncat/i,
  /truncat\w*\s+before\s+the\s+(full|complete|entire)/i,
];

/**
 * The model's own sentence claiming the artifact exceeds one response, or
 * `null` when the response shows no such claim.
 */
export function planningCapacityRefusal(raw: string): string | null {
  if (!raw) return null;
  const text = raw.slice(0, 20_000);
  let hit: RegExpExecArray | null = null;
  for (const pattern of CAPACITY_MARKERS) {
    const match = pattern.exec(text);
    if (match && (!hit || match.index < hit.index)) hit = match;
  }
  if (!hit) return null;
  // Return the claim verbatim, so the log carries what was actually said
  // rather than the pattern that matched it.
  const start = Math.max(0, text.lastIndexOf(".", hit.index) + 1);
  const end = text.indexOf(".", hit.index + hit[0].length);
  return text
    .slice(start, end === -1 ? Math.min(text.length, hit.index + 240) : end + 1)
    .trim();
}
