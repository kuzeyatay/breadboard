type FindRequest = { text: string; forward?: boolean; findNext?: boolean };
type FindResult = { matches: number; activeMatchOrdinal: number };
type FindEventBus = {
  on(name: string, listener: (event: Record<string, unknown>) => void): void;
  off(name: string, listener: (event: Record<string, unknown>) => void): void;
  dispatch(name: string, event: Record<string, unknown>): void;
};

/** Let Breadboard's native find bar search the entire PDF, including unrendered pages. */
export function installPdfFind(eventBus: FindEventBus): () => void {
  const key = Symbol.for("breadboard:document-find");
  const scope = window as unknown as Record<symbol, unknown>;
  let query = "";
  let finish: ((result: FindResult | null) => void) | undefined;
  const settle = (event: Record<string, unknown>) => {
    if (event.state === 3 || (event.rawQuery !== undefined && event.rawQuery !== query)) return;
    const count = event.matchesCount as { current: number; total: number } | undefined;
    if (!count || !finish) return;
    const resolve = finish;
    finish = undefined;
    resolve({ matches: count.total, activeMatchOrdinal: count.current });
  };
  const search = (request: FindRequest | null): Promise<FindResult | null> => {
    finish?.(null);
    finish = undefined;
    if (!request?.text.trim()) {
      query = "";
      eventBus.dispatch("findbarclose", { source: null });
      return Promise.resolve({ matches: 0, activeMatchOrdinal: 0 });
    }
    const again = request.findNext && request.text === query;
    query = request.text;
    return new Promise(resolve => {
      finish = resolve;
      eventBus.dispatch("find", {
        query, type: again ? "again" : "", findPrevious: request.forward === false,
        caseSensitive: false, entireWord: false, highlightAll: true,
        matchDiacritics: true, source: null,
      });
    });
  };
  // The controller emits complete counts with updateMatchesCountOnProgress=false.
  eventBus.on("updatefindmatchescount", settle);
  eventBus.on("updatefindcontrolstate", settle);
  scope[key] = search;
  return () => {
    finish?.(null);
    eventBus.off("updatefindmatchescount", settle);
    eventBus.off("updatefindcontrolstate", settle);
    if (scope[key] === search) delete scope[key];
  };
}
