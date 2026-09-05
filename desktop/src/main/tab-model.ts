/**
 * The keyboard and ordering rules of browser tabs, kept apart from Electron so
 * they can be checked without a window. The manager that owns real views
 * (`tab-manager.ts`) only decides *when* to ask; the answers live here.
 */

export interface ShortcutInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  isAutoRepeat: boolean;
}

export type TabShortcut =
  | { type: "new" }
  | { type: "close" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "nth"; n: number }
  | { type: "last" }
  | { type: "reopen" }
  | { type: "move"; delta: -1 | 1 }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "zoom"; direction: "in" | "out" | "reset" };

export function isFullScreenShortcut(input: {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  isAutoRepeat: boolean;
}): boolean {
  if (input.type !== "keyDown" || input.isAutoRepeat) return false;
  if (input.key.toUpperCase() === "F11") return true;
  return input.key.toLowerCase() === "f" && input.shift && (input.control || input.meta);
}

/**
 * Familiar browser tab keys, on the primary modifier: Ctrl on Windows and Linux,
 * Command on macOS. `key` is what the layout produced, so Ctrl+Shift+T
 * arrives as "T"; the comparisons are case-insensitive for that reason.
 * Repeats are honoured for the ones that cycle and refused for the ones that
 * create or destroy — a held Ctrl+W closing tab after tab is a browser habit
 * worth keeping out.
 */
export function tabShortcutFor(input: ShortcutInput): TabShortcut | null {
  if (input.type !== "keyDown") return null;
  const primary = input.control || input.meta;
  const key = input.key.toLowerCase();
  if (input.alt && !primary && !input.shift) {
    if (key === "arrowleft") return { type: "back" };
    if (key === "arrowright") return { type: "forward" };
    return null;
  }
  if (!primary && key === "f5") return input.isAutoRepeat ? null : { type: "reload" };
  if (!primary) return null;

  const once = <T extends TabShortcut>(shortcut: T): T | null =>
    input.isAutoRepeat ? null : shortcut;

  if (key === "tab") return input.shift ? { type: "previous" } : { type: "next" };
  if (key === "pagedown") {
    return input.shift ? { type: "move", delta: 1 } : { type: "next" };
  }
  if (key === "pageup") {
    return input.shift ? { type: "move", delta: -1 } : { type: "previous" };
  }
  if (input.shift) {
    if (key === "t") return once({ type: "reopen" });
    return null;
  }
  if (key === "t") return once({ type: "new" });
  if (key === "w" || key === "f4") return once({ type: "close" });
  if (key === "r") return once({ type: "reload" });
  if (key === "=" || key === "+") return { type: "zoom", direction: "in" };
  if (key === "-") return { type: "zoom", direction: "out" };
  if (key === "0") return once({ type: "zoom", direction: "reset" });
  if (/^[1-8]$/.test(key)) return once({ type: "nth", n: Number(key) });
  if (key === "9") return once({ type: "last" });
  return null;
}

/** The index `delta` steps away, wrapping at both ends. */
export function cycleTabIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  return (((index + delta) % count) + count) % count;
}

/**
 * Ctrl+1 to Ctrl+8 name a position; a position that does not exist is not
 * rounded to the nearest one, as in desktop browsers. Ctrl+9 is the last tab
 * whatever the count.
 */
export function nthTabIndex(n: number | "last", count: number): number {
  if (count <= 0) return -1;
  if (n === "last") return count - 1;
  return n >= 1 && n <= count ? n - 1 : -1;
}

/**
 * Which tab takes the front when the active one closes: the one to its right,
 * or the last one when it was already rightmost. Closing a background tab
 * changes nothing about which is in front.
 */
export function activeIndexAfterClose(
  closedIndex: number,
  activeIndex: number,
  countBefore: number,
): number {
  const countAfter = countBefore - 1;
  if (countAfter <= 0) return -1;
  if (closedIndex !== activeIndex) {
    return activeIndex > closedIndex ? activeIndex - 1 : activeIndex;
  }
  return Math.min(closedIndex, countAfter - 1);
}

/**
 * Where a new tab goes. One opened from a link belongs beside the page it came
 * from, so a run of links opened from one place stays together in the order
 * they were opened; Ctrl+T's blank slate goes to the end.
 */
export function insertIndexForOpenedTab(
  activeIndex: number,
  count: number,
  origin: "link" | "blank",
  openedFromActiveSoFar: number,
): number {
  if (origin === "blank" || activeIndex < 0) return count;
  return Math.min(count, activeIndex + 1 + openedFromActiveSoFar);
}

/** A copy of `items` with the element at `from` moved to `to`, clamped. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}
