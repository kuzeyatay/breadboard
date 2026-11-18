/**
 * A same-origin address only: the player fetches it with the player's own
 * cookies, so the route that serves the bytes is the one deciding who may read
 * them. A scheme or a protocol-relative host would point it elsewhere.
 */
export function sameOriginPath(value: string | undefined): string | null {
  const src = value?.trim() ?? "";
  if (!src.startsWith("/") || src.startsWith("//") || /[\\\p{Cc}]/u.test(src)) return null;
  return src;
}
