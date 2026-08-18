// Where a research session lives while it is being worked.
//
// In memory, keyed by conversation, and process-global for the same reason the
// agent-launch store is: the tool route and the event stream are separate
// Next.js route bundles, and module-local state would give each its own map.
//
// Deliberately not in SQLite. A research session is scaffolding for one piece
// of work — it is meaningful while the turn (or its immediate continuation) is
// running, and reconstructing a half-finished coverage matrix from disk a week
// later would produce a stale ledger that reads as authoritative. Losing these
// on restart is the correct behaviour: the answer that was built from them is
// already persisted with its own evidence.

import type { ResearchState } from "./types.ts";

/** Conversations tracked at once, oldest evicted first. */
const MAX_TRACKED_CONVERSATIONS = 32;

interface StoreState {
  sequence: number;
  byConversation: Map<number, ResearchState>;
}

const storeGlobal = globalThis as typeof globalThis & {
  __breadboardResearchStore?: StoreState;
};
const store =
  storeGlobal.__breadboardResearchStore ??
  { sequence: 0, byConversation: new Map<number, ResearchState>() };
storeGlobal.__breadboardResearchStore = store;

export function nextSessionId(): string {
  store.sequence += 1;
  return `rs-${store.sequence}`;
}

export function getResearchState(conversationId: number): ResearchState | null {
  return store.byConversation.get(conversationId) ?? null;
}

export function putResearchState(state: ResearchState): ResearchState {
  if (
    !store.byConversation.has(state.conversationId) &&
    store.byConversation.size >= MAX_TRACKED_CONVERSATIONS
  ) {
    const oldest = store.byConversation.keys().next();
    if (!oldest.done) store.byConversation.delete(oldest.value);
  }
  store.byConversation.set(state.conversationId, state);
  return state;
}

export function clearResearchState(conversationId: number): void {
  store.byConversation.delete(conversationId);
}

/** Test seam: forget everything, so one case cannot leak into the next. */
export function resetResearchStore(): void {
  store.byConversation.clear();
  store.sequence = 0;
}
