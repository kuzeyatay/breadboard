export const SHORTCUT_ORDER_LIMIT = 32;
export function shortcutOrderKey(value: string): string {
  try { return new URL(value).href; } catch { return value; }
}
function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function validShortcutOrder(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= SHORTCUT_ORDER_LIMIT && value.every(validUrl);
}
export function normalizeShortcutOrder(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(validUrl).map(shortcutOrderKey))].slice(0, SHORTCUT_ORDER_LIMIT) : [];
}
export function orderedShortcuts<T extends {url: string}>(items: readonly T[], order: readonly string[]): T[] {
  const positions = new Map(order.map((url, index) => [shortcutOrderKey(url), index]));
  const unique = items.filter((item, index) => items.findIndex(other => shortcutOrderKey(other.url) === shortcutOrderKey(item.url)) === index);
  return unique.sort((a, b) => (positions.get(shortcutOrderKey(a.url)) ?? Infinity) - (positions.get(shortcutOrderKey(b.url)) ?? Infinity));
}
