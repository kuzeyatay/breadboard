"use client";

import { hasPrimaryShortcutModifier } from "@/app/buzz/lib/platform";

/**
 * The one vocabulary for application shortcuts on a page: Command on Apple
 * platforms, Control elsewhere, and never Alt. Buzz already speaks it for its
 * search palette and sidebar; the chat dock and the readers use the same
 * helpers so a chord means the same thing on every page.
 */

/** A chord's letter, read from the physical key when the layout disagrees. */
export function matchesShortcutKey(event: KeyboardEvent, key: string): boolean {
  if (event.key.toLowerCase() === key) return true;
  return key.length === 1 && event.code === `Key${key.toUpperCase()}`;
}

/**
 * True for the platform's primary chord (⌘ or Ctrl) on `key`, with Shift
 * exactly as asked for and Alt never held. `repeat`, an already-handled event
 * and an IME composition are rejected so a held key fires once and a shortcut
 * never steals a keystroke someone else has claimed.
 */
export function isPrimaryShortcut(
  event: KeyboardEvent,
  key: string,
  { shift = false }: { shift?: boolean } = {},
): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false;
  if (!hasPrimaryShortcutModifier(event) || event.altKey) return false;
  if (event.shiftKey !== shift) return false;
  return matchesShortcutKey(event, key);
}

/** Whether a keystroke landed in something that edits text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * A modal dialog owns the keyboard while it is up, so page-level shortcuts
 * step aside rather than act on the page behind it.
 */
export function isModalDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[aria-modal="true"]') !== null;
}
