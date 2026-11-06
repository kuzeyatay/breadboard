"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactElement } from "react";
import { ContextMenuSurface, CONTEXT_MENU_ITEM_CLASS, CONTEXT_MENU_SEPARATOR_CLASS } from "@/app/components/link-context-menu";

export function ShortcutContextMenu({ children, label, editable, open, openNewTab, edit, remove, copy }: {
  children: ReactElement; label: string; editable: boolean;
  open: () => void; openNewTab: () => void; edit: () => void; remove: () => void; copy: () => void;
}) {
  return <ContextMenuSurface label={`${label} shortcut`} menu={<>
    <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} onSelect={open}>Open</ContextMenu.Item>
    <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} onSelect={openNewTab}>Open in new tab</ContextMenu.Item>
    <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} onSelect={copy}>Copy link</ContextMenu.Item>
    <ContextMenu.Separator className={CONTEXT_MENU_SEPARATOR_CLASS} />
    <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} disabled={!editable} onSelect={edit}>Edit shortcut</ContextMenu.Item>
    <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} disabled={!editable} onSelect={remove}>Delete shortcut</ContextMenu.Item>
  </>}>{children}</ContextMenuSurface>;
}
