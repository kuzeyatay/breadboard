/* Which capability token the caret is sitting in.
 *
 * A capability selector is a leading "/token" run — one or more tokens at the
 * head of the sentence, exactly what LEADING_COMMAND_RUN in command-text.tsx
 * paints green. The composer used to look for a slash query by testing the
 * whole box against /^\/[^\s]*$/, which is true only while the sentence is
 * nothing but the token being typed. As soon as a body followed it, editing the
 * token back — "/agents can you …" — matched nothing and the picker stayed shut.
 *
 * This finds the whitespace-delimited word under the caret and reports it when
 * it is a capability token: it starts with "/" and everything before it is
 * itself a run of complete capability tokens. So the picker opens for the first
 * token of a sentence that already has a body, and for the second token of
 * "/agents:opencode /skill", but never for a "/" typed mid-sentence.
 */

// Complete capability tokens, each followed by whitespace. The empty string
// matches, which is what makes a token at position 0 the caret's own.
const COMPLETE_TOKEN_RUN = /^(?:\/[a-z0-9][a-z0-9_.:-]*\s+)*$/i;

export interface SlashQuerySpan {
  /** The token without its leading slash — what the menu filters on. */
  query: string;
  /** Index of the "/" in the text. */
  start: number;
  /** Index one past the token's last character. */
  end: number;
}

export function slashQueryAt(
  value: string,
  caret: number | null | undefined,
): SlashQuerySpan | null {
  const position = Math.max(
    0,
    Math.min(typeof caret === 'number' ? caret : value.length, value.length),
  );
  let start = position;
  while (start > 0 && !/\s/.test(value[start - 1]!)) start -= 1;
  let end = position;
  while (end < value.length && !/\s/.test(value[end]!)) end += 1;
  const token = value.slice(start, end);
  if (!token.startsWith('/')) return null;
  if (!COMPLETE_TOKEN_RUN.test(value.slice(0, start))) return null;
  return { query: token.slice(1), start, end };
}

/**
 * The range a chosen capability should overwrite. Replacing "/agent" inside
 * "/agent can you …" also swallows the single space that followed it, because
 * the inserted token brings its own — otherwise every swap leaves a gap behind.
 */
export function slashQueryReplacementRange(
  value: string,
  caret: number | null | undefined,
): { start: number; end: number } | null {
  const span = slashQueryAt(value, caret);
  if (!span) return null;
  return {
    start: span.start,
    end: span.end + (value[span.end] === ' ' ? 1 : 0),
  };
}
