import type { ContextMenuParams, Session, WebContents } from "electron";
import * as path from "node:path";

const sessions = new WeakSet<Session>();

/** Shared by app pages, browser chrome, public websites, and private tabs. */
export function installSelectionContextMenu(contents: WebContents, show: (params: ContextMenuParams) => void): void {
  const target = contents.session;
  if (!sessions.has(target)) {
    target.registerPreloadScript({ type: "frame", filePath: path.join(__dirname, "../preload/selection-menu-preload.js") });
    sessions.add(target);
  }
  // Session preloads also run in auxiliary views. Only tracked tab documents
  // opt in, so an answer card or a system dialog never swallows a text click.
  contents.on("dom-ready", () => { if (!contents.isDestroyed()) contents.send("breadboard:selection-context-menu:enable"); });
  contents.ipc.on("breadboard:selection-context-menu", (event, raw: unknown) => {
    if (contents.isDestroyed() || !event.senderFrame || !raw || typeof raw !== "object") return;
    const value = raw as Record<string, unknown>;
    if (typeof value.text !== "string" || !value.text.trim() || value.text.length > 100_000 ||
        typeof value.x !== "number" || typeof value.y !== "number" ||
        !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.y < 0) return;
    show({
      x: value.x, y: value.y, selectionText: value.text, pageURL: contents.getURL(), frameURL: event.senderFrame.url,
      frame: event.senderFrame, suggestedFilename: "", selectionRect: { x: value.x, y: value.y, width: 0, height: 0 },
      selectionStartOffset: 0, referrerPolicy: { url: "", policy: "default" }, frameCharset: "utf-8", spellcheckEnabled: false,
      linkURL: "", linkText: "", srcURL: "", mediaType: "none", formControlType: "none", isEditable: false,
      hasImageContents: false, menuSourceType: "mouse", titleText: "", altText: "", misspelledWord: "", dictionarySuggestions: [],
      mediaFlags: { inError: false, isPaused: false, isMuted: false, hasAudio: false, isLooping: false, isControlsVisible: false, canToggleControls: false, canPrint: false, canSave: false, canShowPictureInPicture: false, isShowingPictureInPicture: false, canRotate: false, canLoop: false },
      editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: true, canPaste: false, canDelete: false, canSelectAll: true, canEditRichly: false },
    });
  });
}
