import { countClusterMarkdownAsync, gardenDirectory } from "./garden-directory.ts";
import { cachedGardenNoteCountAsync, readCachedGardenNoteCount } from "./garden-note-count-cache.ts";

/** Card rendering must not block the server on a synchronous directory walk.
 * A first read still returns a real count; later tabs reuse it during refresh. */
export async function gardenCardNoteCount(contentPath: string, slug: string): Promise<number> {
  if (!contentPath) return 0;
  try {
    return await cachedGardenNoteCountAsync(contentPath, slug,
      () => countClusterMarkdownAsync(gardenDirectory(slug, contentPath)),
      { staleWhileRevalidate: true });
  } catch {
    return readCachedGardenNoteCount(contentPath, slug) ?? 0;
  }
}
