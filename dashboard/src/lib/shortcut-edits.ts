import { shortcutOrderKey, validShortcutOrder } from "./shortcut-order.ts";

export type ShortcutEdit = { sourceUrl: string; hidden: true } | { sourceUrl: string; label: string; url: string };

function validEdit(value: unknown): value is ShortcutEdit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!validShortcutOrder([item.sourceUrl])) return false;
  return item.hidden === true || (typeof item.label === "string" && item.label.trim().length > 0 &&
    item.label.length <= 24 && validShortcutOrder([item.url]));
}

export function validShortcutEdits(value: unknown): value is ShortcutEdit[] {
  return Array.isArray(value) && value.length <= 32 && value.every(validEdit);
}

export function normalizeShortcutEdits(value: unknown): ShortcutEdit[] {
  if (!Array.isArray(value)) return [];
  const edits = new Map<string, ShortcutEdit>();
  for (const item of value.filter(validEdit).slice(0, 32)) {
    const sourceUrl = shortcutOrderKey(item.sourceUrl);
    edits.set(sourceUrl, "hidden" in item ? { sourceUrl, hidden: true }
      : { sourceUrl, label: item.label.trim(), url: shortcutOrderKey(item.url) });
  }
  return [...edits.values()];
}

/** Source URLs remain stable when an address is edited, preserving saved order. */
export function applyShortcutEdits<T extends { label: string; url: string }>(items: readonly T[], edits: readonly ShortcutEdit[]) {
  const bySource = new Map(edits.map(edit => [shortcutOrderKey(edit.sourceUrl), edit]));
  const seen = new Set<string>();
  return items.flatMap(item => {
    const sourceUrl = shortcutOrderKey(item.url), edit = bySource.get(sourceUrl);
    if (edit && "hidden" in edit) return [];
    const result = { ...item, ...(edit ? { label: edit.label, url: edit.url } : {}), sourceUrl };
    const key = shortcutOrderKey(result.url);
    if (seen.has(key)) return [];
    seen.add(key);
    return [result];
  });
}
