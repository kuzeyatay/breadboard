/**
 * The assistant never writes an em dash. The rule lives in the system prompts
 * (`hermes-config/system/response-style.md` and ChatMock's council system), but
 * a prompt is a request, not a guarantee: every model slips, and the user sees
 * the slip. This module is the deterministic net applied to assistant prose on
 * its way to the browser.
 *
 * Fenced code blocks are passed through untouched — a command, a diff, or a
 * quoted file is content, not the assistant's own writing, and rewriting its
 * punctuation would corrupt it. Inline code spans are deliberately not tracked:
 * a backtick pair is far too easy to confuse with an apostrophe-heavy sentence,
 * and an em dash inside one is rarer than the false positives that tracking
 * would cause.
 */

const EM_DASH = "—";
/** One em dash run plus the spaces that belong to it. */
const EM_DASH_RUN = /[ \t]*—+[ \t]*/g;
const FENCE = /```/g;

/** Openers after which a dash is dropped rather than turned into a comma. */
const OPENERS = new Set(["(", "[", "{", '"', "'", "“", "‘"]);

function replacementFor(previous: string, next: string): string {
  // Line-leading and line-trailing dashes carry no clause to join.
  if (!previous || previous === "\n" || previous === "\r") return "";
  if (!next || next === "\n" || next === "\r") return "";
  if (OPENERS.has(previous)) return "";
  // "…, — like this" would otherwise double the punctuation.
  if (/[,;:.!?]/.test(previous)) return " ";
  // A numeric range keeps its meaning; a comma would destroy it.
  if (/\d/.test(previous) && /\d/.test(next)) return " to ";
  return ", ";
}

/**
 * Rewrite em dashes in one prose segment. `leftContext` supplies the character
 * before the segment so a streamed chunk boundary cannot change the result.
 */
function rewriteSegment(segment: string, leftContext = ""): string {
  if (!segment.includes(EM_DASH)) return segment;
  return segment.replace(EM_DASH_RUN, (match, offset: number) => {
    const before = offset > 0 ? segment[offset - 1] : leftContext.slice(-1);
    const next = segment[offset + match.length] ?? "";
    return replacementFor(before ?? "", next);
  });
}

/**
 * Split `text` on ``` fences and rewrite only the prose between them.
 * `startInFence` continues a block that an earlier chunk left open.
 */
function rewriteOutsideFences(
  text: string,
  startInFence: boolean,
  leftContext: string,
): { output: string; inFence: boolean } {
  let inFence = startInFence;
  let cursor = 0;
  let output = "";
  let context = leftContext;
  FENCE.lastIndex = 0;
  for (
    let fence = FENCE.exec(text);
    fence !== null;
    fence = FENCE.exec(text)
  ) {
    const segment = text.slice(cursor, fence.index);
    output += inFence ? segment : rewriteSegment(segment, context);
    output += fence[0];
    context = "";
    cursor = fence.index + fence[0].length;
    inFence = !inFence;
  }
  const tail = text.slice(cursor);
  output += inFence ? tail : rewriteSegment(tail, context);
  return { output, inFence };
}

/** Rewrite a complete assistant message. */
export function stripEmDashes(text: string): string {
  if (!text || !text.includes(EM_DASH)) return text;
  return rewriteOutsideFences(text, false, "").output;
}

export interface EmDashFilter {
  /** Rewrite what can be decided now; hold back what needs the next chunk. */
  push(chunk: string): string;
  /** Emit whatever is still held back at the end of the stream. */
  flush(): string;
}

/**
 * Streaming form of {@link stripEmDashes}. Feeding a message through `push` in
 * any chunking produces exactly what `stripEmDashes` produces for the whole
 * message, because two things are held back: a trailing dash whose following
 * character is still unknown, and one or two trailing backticks that may still
 * grow into a fence.
 */
export function createEmDashFilter(): EmDashFilter {
  let pending = "";
  let inFence = false;
  let lastEmitted = "";

  const holdbackIndex = (text: string): number => {
    // One or two trailing backticks may still become a fence; three already are
    // one, so holding them would stall the stream on every code block.
    const backticks = /`+$/.exec(text);
    if (backticks && backticks[0].length < 3) return backticks.index;
    const dash = /[ \t]*—+[ \t]*$/.exec(text);
    if (dash) return dash.index;
    // Trailing spaces are held too: the next chunk may open with a dash, and
    // "answers — then" must not emit its space before that is known.
    const spaces = /[ \t]+$/.exec(text);
    if (spaces) return spaces.index;
    return text.length;
  };

  return {
    push(chunk: string): string {
      if (!chunk) return "";
      const work = pending + chunk;
      const cut = holdbackIndex(work);
      pending = work.slice(cut);
      const ready = work.slice(0, cut);
      if (!ready) return "";
      const result = rewriteOutsideFences(ready, inFence, lastEmitted);
      inFence = result.inFence;
      if (result.output) lastEmitted = result.output.slice(-1);
      return result.output;
    },
    flush(): string {
      if (!pending) return "";
      const result = rewriteOutsideFences(pending, inFence, lastEmitted);
      pending = "";
      inFence = result.inFence;
      if (result.output) lastEmitted = result.output.slice(-1);
      return result.output;
    },
  };
}
