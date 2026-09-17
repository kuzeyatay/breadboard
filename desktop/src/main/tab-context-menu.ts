import type { MenuItemConstructorOptions } from "electron";

export type TabContextAction = "duplicate" | "new-right" | "reload" | "anchor" | "copy-link" |
  "close" | "close-others" | "close-right" | "reopen";

export interface TabContextMenuState {
  anchored: boolean;
  private: boolean;
  hasLink: boolean;
  canCloseOthers: boolean;
  canCloseRight: boolean;
  canReopen: boolean;
}

/** Native menus stay above embedded WebContentsViews and provide keyboard navigation. */
export function tabContextMenuTemplate(
  state: TabContextMenuState,
  run: (action: TabContextAction) => void,
): MenuItemConstructorOptions[] {
  const item = (id: TabContextAction, label: string, enabled = true): MenuItemConstructorOptions => ({
    id, label, enabled, click: () => run(id),
  });
  return [
    item("duplicate", "Open same in new tab"),
    item("new-right", "New tab to the right"),
    item("reload", "Reload tab"),
    { type: "separator" },
    item("anchor", state.anchored ? "Unanchor tab" : "Anchor tab", !state.private),
    item("copy-link", "Copy tab link", state.hasLink),
    { type: "separator" },
    item("close", "Close tab", !state.anchored),
    item("close-others", "Close other tabs", state.canCloseOthers),
    item("close-right", "Close tabs to the right", state.canCloseRight),
    { type: "separator" },
    item("reopen", "Reopen closed tab", state.canReopen),
  ];
}
