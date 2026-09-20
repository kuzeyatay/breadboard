import type { ContextMenuParams, Event, WebContents } from "electron";

/** Use Chromium's paste path so selection, undo and page paste handlers work. */
export function pasteOnRightClick(contents: WebContents, event: Event, params: ContextMenuParams): boolean {
  if (params.menuSourceType !== "mouse" || !params.isEditable) return false;
  event.preventDefault();
  if (params.editFlags.canPaste && !contents.isDestroyed()) {
    contents.focus();
    contents.paste();
  }
  return true;
}
