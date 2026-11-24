// The relay between Bread's mcp_call and the AFFiNE page editor open in the user's browser.
// BlockSuite only runs in the page, so a call is queued here, taken by the editor's long poll,
// run against the open document, and answered back. Same shape as the Video Studio bridge.
import { markPageSeen, openSpacesPage, type OpenSpacesPage } from "./page-context.ts";

export interface PageCall { id: string; name: string; args: Record<string, unknown> }
interface Pending extends PageCall { resolve: (value: unknown) => void; reject: (error: Error) => void }
interface UserBridge { queue: Pending[]; inflight: Map<string, Pending>; waiters: Set<() => void> }

export class SpacesPageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export const PAGE_TOOLS = ["page_read", "page_append", "page_replace", "page_set_title", "page_set_mode"] as const;

const bridges: Map<number, UserBridge> = ((globalThis as { __breadboardSpacesPageBridge?: Map<number, UserBridge> })
  .__breadboardSpacesPageBridge ??= new Map());

function bridgeFor(userId: number): UserBridge {
  let bridge = bridges.get(userId);
  if (!bridge) bridges.set(userId, bridge = { queue: [], inflight: new Map(), waiters: new Set() });
  return bridge;
}

let counter = 0;

/** Run one tool in the user's open page and wait for its answer. */
export function callPage(userId: number, name: string, args: Record<string, unknown>, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
  if (!openSpacesPage(userId)) {
    return Promise.reject(new SpacesPageError("spaces_page_closed", "No Spaces page is open. Ask the user to open the page (Spaces, then Page or Whiteboard, or an existing .affine file) and try again."));
  }
  const bridge = bridgeFor(userId);
  return new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
    const settle = () => { clearTimeout(timer); bridge.queue = bridge.queue.filter(entry => entry.id !== id); bridge.inflight.delete(id); };
    const timer = setTimeout(() => { settle(); reject(new SpacesPageError("spaces_page_timeout", `The page did not answer ${name} in time.`)); }, options.timeoutMs ?? 60_000);
    options.signal?.addEventListener("abort", () => { settle(); reject(new SpacesPageError("spaces_page_aborted", "The call was cancelled.")); }, { once: true });
    bridge.queue.push({ id, name, args, resolve: value => { settle(); resolve(value); }, reject: error => { settle(); reject(error); } });
    for (const wake of bridge.waiters) wake();
  });
}

/** The editor's long poll: calls waiting to run, or none after `waitMs`. */
export async function takePageCalls(userId: number, page: OpenSpacesPage, waitMs = 25_000, signal?: AbortSignal): Promise<PageCall[]> {
  markPageSeen(userId, page);
  const bridge = bridgeFor(userId);
  if (!bridge.queue.length) {
    await new Promise<void>(resolve => {
      const wake = () => { clearTimeout(timer); bridge.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, waitMs);
      bridge.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }
  markPageSeen(userId, page);
  if (signal?.aborted) return [];
  const taken = bridge.queue.splice(0);
  for (const call of taken) bridge.inflight.set(call.id, call);
  return taken.map(({ id, name, args }) => ({ id, name, args }));
}

export function completePageCall(userId: number, id: string, outcome: { result?: unknown; error?: string }): boolean {
  const call = bridgeFor(userId).inflight.get(id);
  if (!call) return false;
  if (typeof outcome.error === "string") call.reject(new SpacesPageError("spaces_page_tool_failed", outcome.error));
  else call.resolve(outcome.result);
  return true;
}

/** Bread's mcp_call on the spaces-page connection. */
export async function callSpacesPageTool(input: { userId: number; tool: string; args: Record<string, unknown>; signal?: AbortSignal }): Promise<unknown> {
  const { userId, tool, args } = input;
  try {
    if (tool === "__breadboard_list_tools") return { tools: PAGE_TOOLS, open: openSpacesPage(userId) };
    if (!(PAGE_TOOLS as readonly string[]).includes(tool)) throw new SpacesPageError("spaces_page_tool_unknown", `Unknown page tool ${tool}. Use one of ${PAGE_TOOLS.join(", ")}.`);
    if ((tool === "page_append" || tool === "page_replace") && (typeof args.markdown !== "string" || !args.markdown.trim())) throw new SpacesPageError("spaces_page_argument", "Pass markdown as a non-empty string.");
    if (typeof args.markdown === "string" && args.markdown.length > 400_000) throw new SpacesPageError("spaces_page_argument", "That Markdown is too long for one call; add it in parts with page_append.");
    if (tool === "page_set_title" && (typeof args.title !== "string" || !args.title.trim())) throw new SpacesPageError("spaces_page_argument", "Pass title as a non-empty string.");
    if (tool === "page_set_mode" && args.mode !== "page" && args.mode !== "edgeless") throw new SpacesPageError("spaces_page_argument", 'Pass mode "page" or "edgeless".');
    return await callPage(userId, tool, args, { signal: input.signal });
  } catch (error) {
    if (error instanceof SpacesPageError) return { isError: true, error: error.code, message: error.message };
    throw error;
  }
}
