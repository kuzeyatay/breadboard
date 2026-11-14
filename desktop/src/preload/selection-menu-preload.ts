// Runs in the isolated, sandboxed preload world. No API is exposed to pages.
import { ipcRenderer } from "electron";

const CHANNEL = "breadboard:selection-context-menu";
let enabled = false;
ipcRenderer.on(`${CHANNEL}:enable`, () => { enabled = true; });
const excluded = "input,textarea,select,button,a[href],[role='button'],[role='menu'],[contenteditable]:not([contenteditable='false']),[data-breadboard-selection],.bb-chat-selection-menu";
let pressed: { x: number; y: number; text: string } | null = null;
let swallowClick = false;

// Selecting text remains a normal drag/double-click. A subsequent single
// left-click inside that selection opens the menu without collapsing it.
window.addEventListener("pointerdown", event => {
  pressed = null;
  swallowClick = false;
  if (!enabled || !event.isTrusted || event.button !== 0 || event.pointerType !== "mouse" ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.composedPath().some(node => node instanceof Element && node.matches(excluded))) return;
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString().trim()) return;
  const range = selection.getRangeAt(0);
  if (range.startContainer.parentElement?.closest(excluded) || range.endContainer.parentElement?.closest(excluded)) return;
  const inside = Array.from(range.getClientRects()).some(rect =>
    event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
  if (!inside) return;
  pressed = { x: event.clientX, y: event.clientY, text: selection.toString() };
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener("pointerup", event => {
  const selection = pressed;
  pressed = null;
  if (!selection || !event.isTrusted || event.button !== 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  swallowClick = true;
  if (Math.hypot(event.clientX - selection.x, event.clientY - selection.y) > 5) return;
  // Only text and the click location cross the bridge; the main process owns
  // the source URL, menu actions, tab ownership, and navigation checks.
  ipcRenderer.send(CHANNEL, { text: selection.text.slice(0, 100_000), x: event.clientX, y: event.clientY });
}, true);

window.addEventListener("click", event => {
  if (!swallowClick) return;
  swallowClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
window.addEventListener("pointercancel", () => { pressed = null; swallowClick = false; }, true);

