import { clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";
import type { BrowserMenuAction } from "./browser-menu";

export type BrowserContextAction =
  | "open-link-tab" | "open-link-window" | "open-link-private" | "bookmark-link" | "save-link" | "copy-link" | "copy-clean-link"
  | "open-image" | "save-image" | "copy-image" | "copy-image-link" | "open-media" | "save-media" | "copy-media-link" | "picture-in-picture"
  | "undo" | "redo" | "cut" | "copy" | "paste" | "paste-plain" | "delete" | "select-all"
  | "copy-highlight-link" | "copy-quote" | "comment" | "search" | "translate-text" | "translate-text-dutch" | "ask" | "back" | "forward" | "reload" | "bookmark-page" | "save-page" | "print" | "translate-page" | "copy-page-link" | "inspect";

export function browserContextWebUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

/** Remove only known tracking parameters; preserve routing, signatures and fragments. */
export function cleanBrowserContextLink(value: string): string {
  if (!browserContextWebUrl(value)) return value;
  const url = new URL(value);
  let changed = false;
  const retained = url.search.slice(1).split("&").filter(parameter => {
    let key: string;
    try { key = decodeURIComponent(parameter.split("=", 1)[0]!.replace(/\+/g, " ")); } catch { return true; }
    if (/^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid)$/i.test(key)) {
      changed = true;
      return false;
    }
    return true;
  });
  // URLSearchParams would also re-encode unrelated values (for example %20 as
  // +), which can invalidate a signed download URL with tracking appended.
  if (changed) url.search = retained.join("&");
  return changed ? url.href : value;
}

export function browserSelectionLink(params: Pick<ContextMenuParams, "pageURL" | "frameURL" | "selectionText">): string | null {
  const source = params.frameURL || params.pageURL;
  if (!browserContextWebUrl(source) || !params.selectionText.trim()) return null;
  const url = new URL(source);
  // Preserve the page's anchor while replacing any previous text directive.
  const anchor = url.hash.split(":~:", 1)[0];
  const text = encodeURIComponent(params.selectionText.trim()).replace(/-/g, "%2D");
  url.hash = `${anchor}:~:text=${text}`;
  return url.href;
}

function selectedText(params: ContextMenuParams): string {
  // Password fields must never offer actions that send their contents elsewhere.
  if (params.formControlType === "input-password") return "";
  return (params.selectionText.trim() || params.linkText.trim()).slice(0, 8_000);
}

function downloadableMedia(params: ContextMenuParams): boolean {
  if (browserContextWebUrl(params.srcURL)) return true;
  try {
    const url = new URL(params.srcURL);
    return url.protocol === "blob:" && url.origin === new URL(params.frameURL || params.pageURL).origin
      || params.mediaType === "image" && /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);/i.test(params.srcURL);
  } catch { return false; }
}

/** Native menus stay above the web view and supply keyboard navigation and dismissal. */
export function browserContextMenuTemplate(
  params: ContextMenuParams,
  navigation: { canGoBack: boolean; canGoForward: boolean; annotationsEnabled?: boolean },
  run: (action: BrowserContextAction) => void,
): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];
  const item = (label: string, action: BrowserContextAction, enabled = true, accelerator?: string): MenuItemConstructorOptions => ({
    id: action, label, enabled, accelerator, registerAccelerator: false, click: () => run(action),
  });
  if (params.linkURL) {
    const web = browserContextWebUrl(params.linkURL);
    groups.push([
      item("Open Link in New Tab", "open-link-tab", web),
      item("Open Link in New Window", "open-link-window", web),
      item("Open Link in New Private Window", "open-link-private", web),
    ], [
      item("Bookmark Link", "bookmark-link", web),
      item("Save Link As…", "save-link", web),
      item("Copy Link", "copy-link"),
      item("Copy Clean Link", "copy-clean-link", web && cleanBrowserContextLink(params.linkURL) !== params.linkURL),
    ]);
  }
  if (params.mediaType === "image" || params.mediaType === "canvas") {
    groups.push([
      ...(params.srcURL ? [item("Open Image in New Tab", "open-image", browserContextWebUrl(params.srcURL)), item("Save Image As…", "save-image", downloadableMedia(params))] : []),
      item("Copy Image", "copy-image", params.hasImageContents),
      ...(params.srcURL ? [item("Copy Image Link", "copy-image-link")] : []),
    ]);
  }
  if (params.mediaType === "video" || params.mediaType === "audio") {
    const label = params.mediaType === "video" ? "Video" : "Audio";
    groups.push([
      item(`Open ${label} in New Tab`, "open-media", browserContextWebUrl(params.srcURL)),
      item(`Save ${label} As…`, "save-media", downloadableMedia(params) && params.mediaFlags.canSave),
      item(`Copy ${label} Link`, "copy-media-link", Boolean(params.srcURL)),
      ...(params.mediaType === "video" ? [item("Picture in Picture", "picture-in-picture")] : []),
    ]);
  }
  const flags = params.editFlags;
  if (params.isEditable) {
    groups.push([item("Undo", "undo", flags.canUndo, "CommandOrControl+Z"), item("Redo", "redo", flags.canRedo, "CommandOrControl+Shift+Z")], [
      item("Cut", "cut", flags.canCut, "CommandOrControl+X"),
      item("Copy", "copy", flags.canCopy, "CommandOrControl+C"),
      item("Paste", "paste", flags.canPaste, "CommandOrControl+V"),
      item("Paste Without Formatting", "paste-plain", flags.canPaste, "CommandOrControl+Shift+V"),
      item("Delete", "delete", flags.canDelete),
      item("Select All", "select-all", flags.canSelectAll, "CommandOrControl+A"),
    ]);
  } else if (params.selectionText.trim()) {
    groups.push([
      item("Copy", "copy", flags.canCopy, "CommandOrControl+C"),
      item("Select All", "select-all", flags.canSelectAll, "CommandOrControl+A"),
    ]);
  }
  if (params.selectionText.trim() && params.formControlType !== "input-password") {
    groups.push([
      item("Copy Link to Highlight", "copy-highlight-link", Boolean(browserSelectionLink(params))),
      item("Copy Quote with Source", "copy-quote"),
    ]);
  }
  const text = selectedText(params);
  if (text) {
    const label = text.replace(/\s+/gu, " ");
    const preview = (label.length > 24 ? `${label.slice(0, 24)}…` : label).replace(/&/g, "&&");
    groups.push([
      item(`Search Google for “${preview}”`, "search"),
      item(params.selectionText.trim() ? "Translate Selection to English" : "Translate Link Text to English", "translate-text"),
      item(params.selectionText.trim() ? "Translate Selection to Dutch" : "Translate Link Text to Dutch", "translate-text-dutch"),
      item("Ask Breadboard", "ask"),
    ]);
  } else if (params.linkURL && browserContextWebUrl(params.linkURL)) {
    groups.push([item("Ask Breadboard About This Link", "ask")]);
  }
  if (!params.linkURL && params.mediaType === "none" && !params.isEditable && !params.selectionText.trim()) {
    groups.push([
      item("Back", "back", navigation.canGoBack, "Alt+Left"),
      item("Forward", "forward", navigation.canGoForward, "Alt+Right"),
      item("Reload", "reload", true, "CommandOrControl+R"),
    ], [
      item("Bookmark Page", "bookmark-page", browserContextWebUrl(params.pageURL)),
      item("Save Page As…", "save-page", true, "CommandOrControl+S"),
      item("Print…", "print", true, "CommandOrControl+P"),
      item("Translate Page…", "translate-page"),
      item("Copy Page Link", "copy-page-link"),
    ]);
  }
  if (navigation.annotationsEnabled && !params.isEditable && params.formControlType !== "input-password") groups.push([item("Comment in Organization", "comment")]);
  groups.push([item("Inspect", "inspect")]);
  return groups.filter(group => group.length).flatMap((group, index) => index ? [{ type: "separator" as const }, ...group] : group);
}

export interface BrowserContextControls {
  openTab(url: string, background: boolean): void;
  openWindow(url: string, privateBrowsing: boolean): void;
  privateBrowsing: boolean;
  bookmark(value: { url: string; title: string; iconUrl?: string }): Promise<void>;
  ask(text: string): void;
  comment?(): Promise<void> | void;
  navigate(action: "back" | "forward" | "reload"): void;
  pageAction(action: BrowserMenuAction): Promise<void>;
}

export async function runBrowserContextAction(
  action: BrowserContextAction, contents: WebContents, params: ContextMenuParams, controls: BrowserContextControls,
): Promise<void> {
  if (runBrowserSelectionAction(action, contents, params, controls)) return;
  const open = (url: string, background = true) => { if (browserContextWebUrl(url)) controls.openTab(url, background); };
  switch (action) {
    case "comment": await controls.comment?.(); return;
    case "open-link-tab": open(params.linkURL); return;
    case "open-link-window": case "open-link-private":
      if (browserContextWebUrl(params.linkURL)) controls.openWindow(params.linkURL, action === "open-link-private" || controls.privateBrowsing);
      return;
    case "bookmark-link":
      if (browserContextWebUrl(params.linkURL)) await controls.bookmark({ url: params.linkURL, title: params.linkText || params.titleText || params.linkURL });
      return;
    case "bookmark-page": await controls.bookmark({ url: params.pageURL, title: contents.getTitle() }); return;
    case "save-link": if (browserContextWebUrl(params.linkURL)) contents.downloadURL(params.linkURL); return;
    case "copy-link": clipboard.writeText(params.linkURL); return;
    case "copy-clean-link": clipboard.writeText(cleanBrowserContextLink(params.linkURL)); return;
    case "open-image": case "open-media": open(params.srcURL); return;
    case "save-image": case "save-media": if (downloadableMedia(params)) contents.downloadURL(params.srcURL); return;
    case "copy-image": contents.copyImageAt(params.x, params.y); return;
    case "copy-image-link": case "copy-media-link": clipboard.writeText(params.srcURL); return;
    case "copy-page-link": clipboard.writeText(params.pageURL); return;
    case "back": case "forward": case "reload": controls.navigate(action); return;
    case "save-page": await controls.pageAction("save"); return;
    case "translate-page": await controls.pageAction("translate"); return;
    case "print": case "picture-in-picture": await controls.pageAction(action); return;
  }
}

/** The text actions also work on trusted app pages without browser-only controls. */
export function runBrowserSelectionAction(
  action: BrowserContextAction, contents: WebContents, params: ContextMenuParams,
  controls: Pick<BrowserContextControls, "openTab" | "ask">,
): boolean {
  const open = (url: string) => controls.openTab(url, false);
  switch (action) {
    case "copy-highlight-link": {
      if (params.formControlType === "input-password") return true;
      const link = browserSelectionLink(params);
      if (link) clipboard.writeText(link);
      return true;
    }
    case "copy-quote":
      if (params.formControlType !== "input-password" && params.selectionText.trim()) {
        clipboard.writeText(`${params.selectionText.trim().split(/\r?\n/).map(line => `> ${line}`).join("\n")}\n\n${params.frameURL || params.pageURL}`);
      }
      return true;
    case "undo": contents.undo(); return true;
    case "redo": contents.redo(); return true;
    case "cut": contents.cut(); return true;
    case "copy": contents.copy(); return true;
    case "paste": contents.paste(); return true;
    case "paste-plain": contents.pasteAndMatchStyle(); return true;
    case "delete": contents.delete(); return true;
    case "select-all": contents.selectAll(); return true;
    case "search": if (selectedText(params)) open(`https://www.google.com/search?q=${encodeURIComponent(selectedText(params))}`); return true;
    case "translate-text": case "translate-text-dutch":
      if (selectedText(params)) open(`https://translate.google.com/?sl=auto&tl=${action === "translate-text-dutch" ? "nl" : "en"}&text=${encodeURIComponent(selectedText(params))}&op=translate`);
      return true;
    case "ask": controls.ask([selectedText(params), params.linkURL].filter(Boolean).join("\n").slice(0, 8_000)); return true;
    case "inspect": contents.inspectElement(params.x, params.y); return true;
    default: return false;
  }
}
