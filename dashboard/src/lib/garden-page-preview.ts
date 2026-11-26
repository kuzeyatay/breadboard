/**
 * The app path that shows one garden (Quartz) page on its own, for the page
 * card a garden chat message carries. A path rather than a Quartz address:
 * Quartz gets a fresh port each launch, so a saved address would go stale.
 */
export function gardenPagePreviewHref(clusterSlug: string, noteSlug: string): string {
  return `/garden/${encodeURIComponent(clusterSlug)}/preview?note=${encodeURIComponent(noteSlug)}`;
}
