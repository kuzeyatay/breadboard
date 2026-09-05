// The search dialog's "Last opened" group is browser-local navigation history,
// not conversation activity. A chat can receive a background answer without
// being opened, so updated_at cannot stand in for this list.

const STORAGE_KEY = "breadboard:chat-search:last-opened";
const MAX_LAST_OPENED = 2;

function storageKey(surface: string, gardenSlug?: string | null): string {
  const scope = gardenSlug ? `${surface}:${gardenSlug}` : surface;
  return `${STORAGE_KEY}:${encodeURIComponent(scope)}`;
}

export function readLastOpenedChats(
  storage: Pick<Storage, "getItem">,
  surface: string,
  gardenSlug?: string | null,
): string[] {
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(storageKey(surface, gardenSlug)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, MAX_LAST_OPENED);
  } catch {
    return [];
  }
}

export function recordLastOpenedChat(
  storage: Pick<Storage, "getItem" | "setItem">,
  surface: string,
  chatId: string,
  gardenSlug?: string | null,
): void {
  const id = chatId.trim();
  if (!id) return;
  try {
    const previous = readLastOpenedChats(storage, surface, gardenSlug);
    storage.setItem(
      storageKey(surface, gardenSlug),
      JSON.stringify(
        [id, ...previous.filter((candidate) => candidate !== id)].slice(
          0,
          MAX_LAST_OPENED,
        ),
      ),
    );
  } catch {
    // A blocked or full store only removes this convenience across openings.
  }
}
