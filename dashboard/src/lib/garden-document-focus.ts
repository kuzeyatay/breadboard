/**
 * The Garden documents that supplied one turn's context, retained as display
 * names so the transcript can show the same attachment-style chips after a
 * reload. They are deliberately separate from uploaded attachments: a focused
 * Garden document is already in the Garden and must not appear in Uploads.
 */
export function normalizeFocusedDocumentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((name): name is string => typeof name === "string")
        .map((name) =>
          name.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240),
        )
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

/**
 * Stable Garden document references retained with the display names above.
 *
 * Names are presentation only: two documents may share one, and a rename must
 * not change which material a retry reads. Keeping the slugs on the user turn
 * lets Retry rebuild the exact selected-document request after the composer
 * selection has changed or the page has been reloaded.
 */
export function normalizeFocusedDocumentSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((slug): slug is string => typeof slug === "string")
        .map((slug) =>
          slug.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 500),
        )
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
