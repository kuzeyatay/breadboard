export interface SavedItemsControl<T> {
  read(): Promise<unknown[] | null>;
  write(items: T[]): Promise<boolean>;
}

export interface SavedItemsOptions<T> {
  key: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  control: SavedItemsControl<T> | null;
  desktop: boolean;
  normalize: (value: unknown) => T[];
}

function requireDesktopStore<T>(options: SavedItemsOptions<T>) {
  if (options.desktop && !options.control) {
    throw new Error("Restart Breadboard to enable saving these sites.");
  }
}

function cacheItems<T>(options: SavedItemsOptions<T>, items: T[]) {
  try {
    options.storage.setItem(options.key, JSON.stringify(items));
  } catch {
    // The disk store is authoritative. A full/blocked renderer cache cannot
    // prevent a desktop save; a regular browser still needs its local store.
    if (!options.control) throw new Error("Couldn’t save your sites. Try again.");
  }
}

export async function loadSavedBrowserItems<T>(options: SavedItemsOptions<T>): Promise<T[]> {
  requireDesktopStore(options);
  let local: T[] = [];
  try {
    local = options.normalize(JSON.parse(options.storage.getItem(options.key) ?? "[]"));
  } catch {
    // Legacy renderer storage can be unavailable without affecting disk reads.
  }
  if (!options.control) return local;
  let stored: unknown[] | null;
  try {
    stored = await options.control.read();
  } catch {
    throw new Error("Couldn’t load your saved sites. Try again.");
  }
  const items = stored === null ? local : options.normalize(stored);
  // One-time migration from the former port-scoped renderer store. An empty
  // cache must never create an empty disk record during startup.
  if (stored === null && items.length && !(await options.control.write(items))) {
    throw new Error("Couldn’t save your existing sites. Try again.");
  }
  cacheItems(options, items);
  return items;
}

export async function saveBrowserItems<T>(options: SavedItemsOptions<T>, next: T[]): Promise<T[]> {
  requireDesktopStore(options);
  const items = options.normalize(next);
  if (options.control && !(await options.control.write(items))) {
    throw new Error("Couldn’t save your sites. Try again.");
  }
  cacheItems(options, items);
  return items;
}
