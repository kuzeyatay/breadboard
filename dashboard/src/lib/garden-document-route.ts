export interface GardenDocumentRouteInput {
  readonly slug: string;
  readonly relPath?: string | null;
  readonly type?: string | null;
}

/**
 * Return the cluster-relative Quartz slug for a dashboard document.
 *
 * Source documents are stored and published below `sources/`, while their
 * database slug is only the basename. Prefer the filesystem-relative path so
 * every nested document opens at the page Quartz actually emitted. Older
 * source records without `relPath` still receive the canonical folder prefix.
 */
export function gardenDocumentNoteSlug(
  document: GardenDocumentRouteInput,
): string {
  const relativePath = document.relPath
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (relativePath) return relativePath;

  const slug = document.slug.trim().replace(/^\/+|\/+$/g, "");
  if (document.type === "source-document" && !slug.startsWith("sources/")) {
    return `sources/${slug}`;
  }
  return slug;
}

export function gardenDocumentHref(
  clusterSlug: string,
  document: GardenDocumentRouteInput,
): string {
  return `/garden/${clusterSlug}?note=${encodeURIComponent(
    gardenDocumentNoteSlug(document),
  )}`;
}
