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
