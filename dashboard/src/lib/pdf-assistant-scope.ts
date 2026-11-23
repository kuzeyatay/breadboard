/** PDF reading conversations use an opaque document key, including PDFs outside a garden. */
export function isPdfAssistantPageContext(
  surface: string,
  pageSlug: unknown,
): boolean {
  return (
    surface === "dashboard_terminal" &&
    typeof pageSlug === "string" &&
    /^pdf:[0-9a-f]{16}$/.test(pageSlug)
  );
}

/** Video Studio's assistant keys its chats to the video being edited, the same way. */
export function isVideoAssistantPageContext(surface: string, pageSlug: unknown): boolean {
  return surface === "dashboard_terminal" && typeof pageSlug === "string" && /^video:[0-9a-f]{16}$/.test(pageSlug);
}

/** A reader assistant's key names one document or video; it grants no garden or file access. */
export function isReaderAssistantPageContext(surface: string, pageSlug: unknown): boolean {
  return isPdfAssistantPageContext(surface, pageSlug) || isVideoAssistantPageContext(surface, pageSlug);
}
