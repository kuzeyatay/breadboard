"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { desktopTabsBridge, openInDesktopTab } from "@/lib/desktop-browser-tabs";
import { useDesktopTabsEnabled } from "./use-desktop-tabs";

/**
 * The one look every right-click menu in the dashboard shares: a small flat
 * panel of plain text rows. No icons, no headings, no descriptions.
 */
export const CONTEXT_MENU_CONTENT_CLASS =
  "z-[200] min-w-[10rem] rounded-md border border-[var(--line)] bg-[var(--paper-raised)] p-1 text-[13px] leading-none text-[var(--ink)] shadow-[0_6px_20px_rgba(15,23,18,0.14)] outline-none";

export const CONTEXT_MENU_ITEM_CLASS =
  "block w-full cursor-default select-none rounded px-2.5 py-2 text-left outline-none data-[highlighted]:bg-[var(--paper-strong)] data-[highlighted]:text-[var(--ink-heading)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

export const CONTEXT_MENU_SEPARATOR_CLASS = "my-1 h-px bg-[var(--line)]";

interface ContextMenuSurfaceProps {
  children: ReactElement;
  menu: ReactNode;
  label?: string;
}

/**
 * Wraps one clickable element with a right-click menu. The menu content is
 * marked as a card action so a parent card's click and drag guards ignore
 * clicks inside it (React bubbles portal events through the owner tree).
 *
 * Not modal. A modal menu locks the page's scroll and marks every other
 * element in the document aria-hidden the moment it opens — a walk over the
 * whole dashboard, then a relayout of it — which is a visible pause before a
 * two-row menu on a page this size. Outside clicks still dismiss it.
 */
export function ContextMenuSurface({
  children,
  menu,
  label,
}: ContextMenuSurfaceProps) {
  return (
    <ContextMenuPrimitive.Root modal={false}>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          aria-label={label}
          collisionPadding={8}
          data-card-action="true"
          className={CONTEXT_MENU_CONTENT_CLASS}
        >
          {menu}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

interface OpenItemProps {
  href: string;
  children?: ReactNode;
}

/**
 * A menu row that opens `href` in a new tab.
 *
 * In the desktop app a tab is one of the window's own: the shell is asked for
 * it and opens the page beside this one, in the background, the way a browser
 * answers "Open Link in New Tab". The row is absent there while browser
 * navigation is switched off on the Profile page, because "new tab" would
 * then have nothing to mean. In a browser it is an ordinary `target="_blank"`
 * link, which is a tab of the browser's own.
 */
export function OpenInNewTabItem({
  href,
  children = "Open in new tab",
}: OpenItemProps) {
  const desktopTabs = useDesktopTabsEnabled();
  const inDesktop = typeof window !== "undefined" && desktopTabsBridge() !== undefined;
  if (inDesktop && !desktopTabs) return null;
  if (inDesktop) {
    return (
      <ContextMenuPrimitive.Item
        className={CONTEXT_MENU_ITEM_CLASS}
        onSelect={() => {
          void openInDesktopTab(href, { background: true });
        }}
      >
        {children}
      </ContextMenuPrimitive.Item>
    );
  }
  return (
    <ContextMenuPrimitive.Item asChild>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={CONTEXT_MENU_ITEM_CLASS}
      >
        {children}
      </a>
    </ContextMenuPrimitive.Item>
  );
}

function openBrowserWindow(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  // The desktop shell turns any `target="_blank"` into a Breadboard window of
  // its own, so the anchor is left alone there. A browser would make a tab of
  // it; asking for a popup is what makes it a window instead.
  if (desktopTabsBridge()) return;
  event.preventDefault();
  const absolute = new URL(href, window.location.href).toString();
  window.open(absolute, "_blank", "popup,noopener,noreferrer");
}

/**
 * A menu row that opens `href` in a new window. It is a real anchor with
 * `target="_blank"`, the same contract the navbar uses: the desktop shell
 * turns that into a new Breadboard window.
 */
export function OpenInNewWindowItem({
  href,
  children = "Open in new window",
}: OpenItemProps) {
  return (
    <ContextMenuPrimitive.Item asChild>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={CONTEXT_MENU_ITEM_CLASS}
        onClick={(event) => openBrowserWindow(event, href)}
      >
        {children}
      </a>
    </ContextMenuPrimitive.Item>
  );
}

interface LinkContextMenuProps {
  /** The route the wrapped element leads to. */
  href: string;
  /** What the menu is for, read by assistive tech only. */
  label?: string;
  children: ReactElement;
}

/**
 * Right-click on any link-like element to open its destination in a new tab
 * or a new window. Wrap the `Link`, `<a>`, or button that navigates.
 */
export default function LinkContextMenu({
  href,
  label,
  children,
}: LinkContextMenuProps) {
  return (
    <ContextMenuSurface
      label={label}
      menu={
        <>
          <OpenInNewTabItem href={href} />
          <OpenInNewWindowItem href={href} />
        </>
      }
    >
      {children}
    </ContextMenuSurface>
  );
}
