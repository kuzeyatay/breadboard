// Splitting composer text into the parts that should look like links.
//
// A `<textarea>` cannot contain an anchor, so the composer already paints a
// mirror layer behind it to colour leading slash commands. This is the same
// trick applied to URLs: the mirror renders them as real anchors, and the only
// job here is deciding which characters are one.
//
// Pure and free of Node imports — the composer imports this, and the tests
// exercise it directly.

export interface ComposerSegment {
  kind: "text" | "link";
  text: string;
  /** Present on links: the address to open, which is not always the text. */
  href?: string;
}

/**
 * Bare `http(s)` and `www.` runs. Deliberately narrow: a scheme-less
 * `example.com` in prose is far more often a sentence than a link, and turning
 * ordinary words blue while somebody types is worse than missing one.
 */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Punctuation that ends a sentence rather than a URL. Brackets are only trimmed
 * when unbalanced, so a Wikipedia link ending in `(disambiguation)` survives.
 */
function trimTrailing(raw: string): string {
  let value = raw;
  for (;;) {
    const last = value.at(-1);
    if (!last) break;
    if (".,;:!?".includes(last)) {
      value = value.slice(0, -1);
      continue;
    }
    if (last === ")" && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) {
      value = value.slice(0, -1);
      continue;
    }
    if (last === "]" && (value.match(/\[/g)?.length ?? 0) < (value.match(/\]/g)?.length ?? 0)) {
      value = value.slice(0, -1);
      continue;
    }
    break;
  }
  return value;
}

/**
 * A link the browser can open, or null when it is not one after all. Anything
 * that is not http(s) is refused rather than made clickable — `javascript:` in
 * an href is the reason this function exists at all.
 */
export function linkHref(text: string): string | null {
  const candidate = /^www\./i.test(text) ? `https://${text}` : text;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

/**
 * Split text into plain runs and links, in order. Concatenating every segment's
 * `text` returns the input exactly — the mirror has to line up with the
 * textarea character for character, so nothing may be dropped or rewritten.
 */
export function composerSegments(value: string): ComposerSegment[] {
  if (!value) return [];
  const segments: ComposerSegment[] = [];
  let cursor = 0;

  LINK.lastIndex = 0;
  for (const match of value.matchAll(LINK)) {
    const start = match.index ?? 0;
    const matched = trimTrailing(match[0]);
    if (!matched) continue;
    const href = linkHref(matched);
    if (!href) continue;

    if (start > cursor) segments.push({ kind: "text", text: value.slice(cursor, start) });
    segments.push({ kind: "link", text: matched, href });
    cursor = start + matched.length;
  }
  if (cursor < value.length) segments.push({ kind: "text", text: value.slice(cursor) });
  return segments;
}

/** Whether painting the mirror is worth it at all. */
export function hasComposerLink(value: string): boolean {
  return composerSegments(value).some((segment) => segment.kind === "link");
}
