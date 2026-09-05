import { loadSavedBrowserItems, saveBrowserItems, type SavedItemsOptions } from "./browser-saved-items.ts";
import { recentSearchFromInput } from "./browser-recent-searches.ts";

interface RecentSearchesSnapshot {
  items: string[];
  ready: boolean;
  error: string | null;
}

/** Serialize restores and edits so searches entered during startup are retained. */
export function createBrowserRecentSearchesStore(
  options: () => SavedItemsOptions<string>,
  withLock: (operation: () => Promise<boolean>) => Promise<boolean> = async (operation) => {
    // Each tab has a separate renderer/store. Lock the complete read/edit/write
    // across tabs so a stale collection cannot overwrite another tab's visits.
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request(options().key, operation);
    }
    return operation();
  },
) {
  let state: RecentSearchesSnapshot = { items: [], ready: false, error: null };
  const initial = state;
  const listeners = new Set<() => void>();
  let queue = Promise.resolve(true);

  function publish(next: RecentSearchesSnapshot) {
    state = next;
    for (const listener of listeners) listener();
  }

  function run(update?: (items: string[]) => string[]): Promise<boolean> {
    queue = queue.then(() => withLock(async () => {
      const config = options();
      // Read the authoritative collection before every edit, including edits
      // made before the initial restore or after another tab changed history.
      const current = await loadSavedBrowserItems(config);
      const items = update ? await saveBrowserItems(config, update(current)) : current;
      publish({ items, ready: true, error: null });
      return true;
    })).catch((error) => {
      publish({ ...state, error: error instanceof Error ? error.message : "Couldn’t save your recent searches. Try again." });
      return false;
    });
    return queue;
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: () => run(),
    remember(input: string) {
      const search = recentSearchFromInput(input);
      return search ? run((items) => [search, ...items.filter((entry) => entry !== search)]) : Promise.resolve(true);
    },
    remove: (search: string) => run((items) => items.filter((entry) => entry !== search)),
    clear: () => run(() => []),
  };
}
