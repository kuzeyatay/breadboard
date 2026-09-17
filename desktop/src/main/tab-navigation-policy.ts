export const ANCHORED_TAB_NAVIGATION_MESSAGE = "Unanchor the page to move to a different screen.";

/** Screens own their subpages, query state and fragments. Quartz and Workspace
 * are separate screens even when they belong to the same garden. */
export function tabScreen(url: URL): string {
  const [first = "", second, third, fourth] = url.pathname.split("/").filter(Boolean);
  if ((first === "gardens" && second && third === "pdf" && fourth)
    || ((first === "artifacts" || first === "attachments") && second && third === "pdf")) return "pdf";
  return first || "dashboard";
}

export function isSameTabScreen(current: string, destination: string): boolean {
  try {
    const from = new URL(current);
    const to = new URL(destination, from);
    return from.origin === to.origin && tabScreen(from) === tabScreen(to);
  } catch {
    return false;
  }
}
