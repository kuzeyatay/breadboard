export interface BrowserNavigationEntry {
  url: string;
}

/**
 * Chromium includes iframe pushState entries in a WebContents history. Skip
 * adjacent entries that still resolve to the current top-level URL so Back and
 * Forward always produce a visible page navigation.
 */
export function browserNavigationTargetIndex(
  entries: readonly BrowserNavigationEntry[],
  activeIndex: number,
  currentTopLevelUrl: string,
  direction: "back" | "forward",
): number | null {
  const delta = direction === "back" ? -1 : 1;
  for (let index = activeIndex + delta; index >= 0 && index < entries.length; index += delta) {
    if (entries[index]?.url !== currentTopLevelUrl) return index;
  }
  return null;
}
