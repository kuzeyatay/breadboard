"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ReactElement } from "react";
import {
  CONTEXT_MENU_ITEM_CLASS,
  ContextMenuSurface,
  OpenInNewTabItem,
  OpenInNewWindowItem,
} from "@/app/components/link-context-menu";

interface DocumentContextMenuProps {
  children: ReactElement;
  documentTitle: string;
  pdfHref: string | null;
  /** The PDF alone on its own page (the full PDF viewer with its own assistant), outside the Garden reader. */
  isolatedPdfHref?: string | null;
}

/**
 * Actions shown when a source document is right-clicked in the Garden library.
 *
 * The PDF opens in a tab of the desktop window, or in a window of its own by
 * the same local `target="_blank"` contract as the dashboard navbar; in a
 * browser those are the browser's own tab and window.
 */
export default function DocumentContextMenu({
  children,
  documentTitle,
  pdfHref,
  isolatedPdfHref = null,
}: DocumentContextMenuProps) {
  return (
    <ContextMenuSurface
      label={`Actions for ${documentTitle}`}
      menu={
        pdfHref ? (
          <>
            <OpenInNewTabItem href={pdfHref}>Open PDF in new tab</OpenInNewTabItem>
            <OpenInNewWindowItem href={pdfHref}>Open PDF in new window</OpenInNewWindowItem>
            {isolatedPdfHref && (
              <ContextMenuPrimitive.Item className={CONTEXT_MENU_ITEM_CLASS} onSelect={() => window.location.assign(isolatedPdfHref)}>
                Open PDF in isolated
              </ContextMenuPrimitive.Item>
            )}
          </>
        ) : (
          <ContextMenuPrimitive.Item disabled className={CONTEXT_MENU_ITEM_CLASS}>
            No PDF for this source
          </ContextMenuPrimitive.Item>
        )
      }
    >
      {children}
    </ContextMenuSurface>
  );
}
