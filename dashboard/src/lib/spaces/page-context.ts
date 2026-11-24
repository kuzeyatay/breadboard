/** Import-free: the per-turn registry names the Spaces page connection without loading its server code. */
export const SPACES_PAGE_CONNECTION = "spaces-page";

export interface OpenSpacesPage { gardenId: string; fileId: string; title: string; mode: string }
interface Presence extends OpenSpacesPage { lastSeen: number }

// Which users have an AFFiNE page open for editing right now (its editor long-polls the bridge).
const presence: Map<number, Presence> = ((globalThis as { __breadboardSpacesPagePresence?: Map<number, Presence> })
  .__breadboardSpacesPagePresence ??= new Map());

export function markPageSeen(userId: number, page: OpenSpacesPage) { presence.set(userId, { ...page, lastSeen: Date.now() }); }
/** The editor polls every 25 s, so 45 s without one means the page was closed. */
export function openSpacesPage(userId: number): OpenSpacesPage | null {
  const entry = presence.get(userId);
  return entry && Date.now() - entry.lastSeen < 45_000 ? entry : null;
}

const c = JSON.stringify(SPACES_PAGE_CONNECTION);

export function spacesPageContext(userId: number): string {
  const open = openSpacesPage(userId);
  return [
    `# spaces_page`,
    `Spaces pages and whiteboards are AFFiNE documents (.affine Garden files). Bread edits the one open in Spaces through mcp_call connection=${c}: page_read {} returns its title, mode and Markdown; page_append {markdown} adds Markdown blocks (headings, lists, tables, code, quotes, links) at the end; page_replace {markdown} replaces the whole body and keeps the title; page_set_title {title}; page_set_mode {mode:"page"|"edgeless"} switches between the document and the whiteboard. Every change is saved as a new Garden version and its Quartz note updates. Read before rewriting, and prefer page_append for additions.`,
    open
      ? `The user has the Spaces page ${JSON.stringify(open.title)} open right now (${open.mode === "edgeless" ? "whiteboard" : "page"} view): "this page/whiteboard/doc" means it.`
      : `No Spaces page is open right now, so these tools fail with spaces_page_closed. To make a new page, ask the user to open Spaces and choose Page or Whiteboard (or open an existing .affine file), then continue.`,
  ].join("\n");
}
