import type { MenuItemConstructorOptions } from "electron";

export type BrowserMenuAction =
  | "profile" | "new-tab" | "new-window" | "history" | "bookmarks" | "downloads"
  | "extensions" | "appearance" | "print" | "save" | "translate" | "find"
  | "zoom-in" | "zoom-out" | "zoom-reset" | "fullscreen" | "settings"
  | "developer-tools" | "copy-link" | "help" | "report" | "about" | "quit";

export interface BrowserMenuContext {
  profileLabel: string;
  hasPage: boolean;
  zoomPercent: number;
  fullscreen: boolean;
}

/** Native menus stay above sandboxed WebContentsViews and handle keyboard focus. */
export function browserMenuTemplate(
  context: BrowserMenuContext,
  run: (action: BrowserMenuAction) => void,
): MenuItemConstructorOptions[] {
  const item = (label: string, action: BrowserMenuAction, accelerator?: string, enabled = true): MenuItemConstructorOptions => ({
    id: action, label, accelerator, enabled, registerAccelerator: false, click: () => run(action),
  });
  return [
    item(context.profileLabel.replace(/&/g, "&&") || "Your profile", "profile"),
    { type: "separator" },
    item("New Tab", "new-tab", "CommandOrControl+T"),
    item("New Window", "new-window", "CommandOrControl+N"),
    { type: "separator" },
    item("History", "history", "CommandOrControl+H"),
    item("Bookmarks", "bookmarks", "CommandOrControl+Shift+O"),
    item("Downloads", "downloads", "CommandOrControl+J"),
    { label: "Extensions and Themes", submenu: [
      item("Manage Extensions…", "extensions", "CommandOrControl+Shift+A"),
      item("Appearance…", "appearance"),
    ] },
    { type: "separator" },
    item("Print…", "print", "CommandOrControl+P", context.hasPage),
    item("Save Page As…", "save", "CommandOrControl+S", context.hasPage),
    item("Translate Page…", "translate", undefined, context.hasPage),
    item("Find in Page…", "find", "CommandOrControl+F", context.hasPage),
    { label: `Zoom · ${context.zoomPercent}%`, submenu: [
      item("Zoom In", "zoom-in", "CommandOrControl+Plus", context.hasPage && context.zoomPercent < 300),
      item("Zoom Out", "zoom-out", "CommandOrControl+-", context.hasPage && context.zoomPercent > 25),
      item("Reset to 100%", "zoom-reset", "CommandOrControl+0", context.hasPage),
    ] },
    { ...item("Full Screen", "fullscreen", "F11"), type: "checkbox", checked: context.fullscreen },
    { type: "separator" },
    item("Settings", "settings"),
    { label: "More Tools", submenu: [
      item("Developer Tools", "developer-tools", "CommandOrControl+Shift+I", context.hasPage),
      item("Copy Page Link", "copy-link", undefined, context.hasPage),
    ] },
    { label: "Help and Report", submenu: [
      item("Breadboard Help", "help"),
      item("Report an Issue…", "report"),
      item("About Breadboard", "about"),
    ] },
    { type: "separator" },
    item("Exit", "quit", "CommandOrControl+Shift+Q"),
  ];
}

export function browserMenuShortcut(input: {
  type: string; key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean; isAutoRepeat: boolean;
}): BrowserMenuAction | null {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.alt || !(input.control || input.meta)) return null;
  const key = input.key.toLowerCase();
  if (input.shift) {
    const actions: Record<string, BrowserMenuAction> = { o: "bookmarks", a: "extensions", i: "developer-tools", q: "quit" };
    return actions[key] ?? null;
  }
  const actions: Record<string, BrowserMenuAction> = { n: "new-window", h: "history", j: "downloads", p: "print", s: "save", f: "find" };
  return actions[key] ?? null;
}

export function savedPageFilename(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 120);
  return `${name && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name : "Saved page"}.html`;
}
