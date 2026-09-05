/** Move a bookmark before another URL, or to the end when beforeUrl is null. */
export function reorderBrowserBookmarks<T extends { url: string }>(
  items: T[],
  draggedUrl: string,
  beforeUrl: string | null,
): T[] {
  const from = items.findIndex((item) => item.url === draggedUrl);
  if (from < 0 || beforeUrl === draggedUrl) return items;
  const remaining = items.filter((item) => item.url !== draggedUrl);
  const to = beforeUrl === null ? remaining.length : remaining.findIndex((item) => item.url === beforeUrl);
  if (to < 0 || to === from) return items;
  remaining.splice(to, 0, items[from]);
  return remaining;
}
