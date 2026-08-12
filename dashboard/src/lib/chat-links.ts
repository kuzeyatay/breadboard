/* Plain-text URL detection for chat transcripts.

   Assistant answers go through react-markdown + remark-gfm, which already turns
   bare URLs into anchors. Messages the user typed are rendered as plain text, so
   they need the same treatment applied by hand — this module is the shared,
   testable half of that. It mirrors GFM autolink literals: "http(s)://…" and
   bare "www.…", with trailing sentence punctuation left outside the link. */

export type ChatLinkSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

/* A candidate starts at a word boundary that is not part of an email address or
   a longer token, and runs to the first whitespace or "<". */
const LINK_CANDIDATE = /(^|[^A-Za-z0-9@._%+-])((?:https?:\/\/|www\.)[^\s<]+)/gi;

/* Punctuation that reads as sentence punctuation rather than part of a URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"“”‘’*_~]+$/;

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countChar(value: string, char: string): number {
  let total = 0;
  for (const current of value) if (current === char) total += 1;
  return total;
}

/* "see https://example.com/a_(b)." keeps the balanced paren and drops the dot. */
function trimTrailingPunctuation(candidate: string): string {
  let url = candidate;

  for (;;) {
    const withoutPunctuation = url.replace(TRAILING_PUNCTUATION, '');
    if (withoutPunctuation !== url) {
      url = withoutPunctuation;
      continue;
    }

    const last = url.slice(-1);
    const opener = CLOSERS[last];
    if (opener && countChar(url, last) > countChar(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }

    return url;
  }
}

/* Returns the navigable href for a matched candidate, or null when it is not a
   usable web address. Only http(s) survives, so "javascript:" and friends can
   never reach an anchor's href. */
export function chatLinkHref(candidate: string): string | null {
  if (!candidate) return null;

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname;
  if (host === 'localhost') return parsed.href;
  /* A host needs a dot-separated label that could plausibly be a TLD, so
     "https://oops" and "www." on their own stay plain text. */
  if (!/^[^.]+(?:\.[^.]+)*\.[A-Za-z]{2,}$/.test(host)) return null;

  return parsed.href;
}

/* Splits chat text into plain runs and link runs, in order. Text is preserved
   verbatim (including whitespace) so callers can keep `white-space: pre-wrap`. */
export function linkifyChatText(text: string): ChatLinkSegment[] {
  const segments: ChatLinkSegment[] = [];
  let cursor = 0;

  LINK_CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LINK_CANDIDATE.exec(text)) !== null) {
    const start = match.index + (match[1]?.length ?? 0);
    const value = trimTrailingPunctuation(match[2]);
    const href = chatLinkHref(value);
    if (!href) continue;

    if (start > cursor) segments.push({ type: 'text', value: text.slice(cursor, start) });
    segments.push({ type: 'link', value, href });

    cursor = start + value.length;
    /* Re-scan from the end of the link so trimmed punctuation stays as text. */
    LINK_CANDIDATE.lastIndex = cursor;
  }

  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });

  return segments;
}

export function hasChatLink(text: string): boolean {
  return linkifyChatText(text).some((segment) => segment.type === 'link');
}
