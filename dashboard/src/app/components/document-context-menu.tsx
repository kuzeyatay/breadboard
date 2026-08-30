"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ReactElement } from "react";

interface DocumentContextMenuProps {
  children: ReactElement;
  documentTitle: string;
  pdfHref: string | null;
}

/**
 * Actions shown when a source document is right-clicked in the Garden library.
 *
 * The PDF action deliberately uses the same local `target="_blank"` contract as
 * the dashboard navbar. In the desktop app, the shell intercepts that request
 * and opens the route behind its native loading scene; in a browser it remains
 * an ordinary new tab.
 */
export default function DocumentContextMenu({
  children,
  documentTitle,
  pdfHref,
}: DocumentContextMenuProps) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          aria-label={`Actions for ${documentTitle}`}
          collisionPadding={12}
          className="bb-modal-panel neu-dialog z-[200] w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-1.5 text-[var(--ink)] shadow-[0_18px_48px_rgba(15,23,18,0.28)] outline-none"
        >
          <ContextMenuPrimitive.Label className="px-2.5 py-2">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-faint)]">
              Document
            </span>
            <span
              className="mt-0.5 block truncate text-xs font-medium text-[var(--ink-heading)]"
              title={documentTitle}
            >
              {documentTitle}
            </span>
          </ContextMenuPrimitive.Label>
          <ContextMenuPrimitive.Separator className="mx-1 my-1 h-px bg-[var(--line)]" />

          {pdfHref ? (
            <ContextMenuPrimitive.Item asChild>
              <a
                href={pdfHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 cursor-default select-none items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors data-[highlighted]:bg-[var(--paper-strong)] data-[highlighted]:text-[var(--ink-heading)]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink-muted)]">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 4.5H19.5V10.5M19 5 11.25 12.75M10.5 6H6.75A2.25 2.25 0 0 0 4.5 8.25v9A2.25 2.25 0 0 0 6.75 19.5h9A2.25 2.25 0 0 0 18 17.25V13.5"
                    />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    Open PDF viewer in new window
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--ink-faint)]">
                    Opens beside this Garden
                  </span>
                </span>
              </a>
            </ContextMenuPrimitive.Item>
          ) : (
            <ContextMenuPrimitive.Item
              disabled
              className="flex min-h-11 cursor-not-allowed select-none items-center gap-3 rounded-lg px-2.5 py-2 text-left opacity-55 outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--paper-surface)] text-[var(--ink-faint)]">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3.75h7.5L19.5 9v10.5a.75.75 0 0 1-.75.75h-12a.75.75 0 0 1-.75-.75v-15a.75.75 0 0 1 .75-.75ZM14.25 3.75V9h5.25M9 14.25h6"
                  />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  PDF viewer unavailable
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--ink-faint)]">
                  This source has no PDF file
                </span>
              </span>
            </ContextMenuPrimitive.Item>
          )}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
