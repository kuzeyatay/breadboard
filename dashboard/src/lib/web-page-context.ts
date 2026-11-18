import { parseBrowserTerminalAccess } from "./browser-terminal.ts";
import { readBrowserTerminal } from "./hermes/browser-terminal-context.ts";

/** The page a suggestion is about: what the user is reading beside the chat. */
export interface ViewedPage { title: string; text: string }

const MAX_TEXT = 8_000;

function clean(title: unknown, text: unknown): ViewedPage | null {
  if (typeof title !== "string" || !title.trim()) return null;
  return {
    title: title.trim().slice(0, 300),
    text: typeof text === "string" ? text.replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT) : "",
  };
}

/**
 * Resolve the viewed page from a suggestion request: a browser tab is read live
 * through its bridge (the client only holds the credentials), a garden or
 * Quartz page sends its own text. Null when there is no page or it cannot be read.
 */
export async function requestViewedPage(body: Record<string, unknown>): Promise<ViewedPage | null> {
  const access = parseBrowserTerminalAccess(body.browserAccess);
  if (access) {
    try {
      const page = await readBrowserTerminal(access, "read");
      return clean(page.title, page.text);
    } catch {
      return null;
    }
  }
  const page = body.page as { title?: unknown; text?: unknown } | undefined;
  return page && typeof page === "object" ? clean(page.title, page.text) : null;
}
