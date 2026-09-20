"use client";

import { useEffect, useState, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  CONTEXT_MENU_CONTENT_CLASS,
  CONTEXT_MENU_ITEM_CLASS,
  CONTEXT_MENU_SEPARATOR_CLASS,
} from "../link-context-menu";

export interface TerminalWorkspace {
  slug: string;
  name: string;
}

export interface TerminalWorkspacePicker {
  selected: TerminalWorkspace | null;
  onSelect: (workspace: TerminalWorkspace | null) => void;
}

/** A new-chat destination, available even when the blank chat is selected. */
export default function TerminalWorkspaceMenu({
  children,
  selected,
  onSelect,
}: TerminalWorkspacePicker & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/clusters", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Workspaces could not be loaded.");
        const body = await response.json();
        if (!Array.isArray(body.clusters)) throw new Error("Invalid workspace list.");
        if (controller.signal.aborted) return;
        setWorkspaces(body.clusters.filter((item: TerminalWorkspace) =>
          item && typeof item.slug === "string" && typeof item.name === "string",
        ).sort((a: TerminalWorkspace, b: TerminalWorkspace) => a.name.localeCompare(b.name)));
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, attempt]);

  return (
    <ContextMenu.Root modal={false} onOpenChange={(nextOpen) => {
      if (nextOpen) { setLoading(true); setError(false); }
      setOpen(nextOpen);
    }}>
      <ContextMenu.Trigger asChild>
        <span className="block min-w-0" title={`New chats: ${selected?.name ?? "No workspace"}. Right-click to choose a workspace.`}>
          {children}
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label="New chat workspace"
          collisionPadding={8}
          className={`${CONTEXT_MENU_CONTENT_CLASS} max-h-[min(24rem,var(--radix-context-menu-content-available-height))] max-w-[min(20rem,calc(100vw-16px))] overflow-y-auto`}
        >
          <ContextMenu.RadioGroup value={selected?.slug ?? ""}>
            <ContextMenu.RadioItem value="" className={CONTEXT_MENU_ITEM_CLASS} onSelect={() => onSelect(null)}>
              <ContextMenu.ItemIndicator className="mr-2">✓</ContextMenu.ItemIndicator>
              No workspace
            </ContextMenu.RadioItem>
            <ContextMenu.Separator className={CONTEXT_MENU_SEPARATOR_CLASS} />
            {loading ? (
              <ContextMenu.Item disabled className={CONTEXT_MENU_ITEM_CLASS}>Loading workspaces…</ContextMenu.Item>
            ) : error ? (
              <ContextMenu.Item className={CONTEXT_MENU_ITEM_CLASS} onSelect={(event) => {
                event.preventDefault();
                setLoading(true);
                setError(false);
                setAttempt((value) => value + 1);
              }}>
                Couldn’t load workspaces. Retry
              </ContextMenu.Item>
            ) : workspaces.length === 0 ? (
              <ContextMenu.Item disabled className={CONTEXT_MENU_ITEM_CLASS}>No workspaces yet</ContextMenu.Item>
            ) : workspaces.map((workspace) => (
              <ContextMenu.RadioItem key={workspace.slug} value={workspace.slug} className={CONTEXT_MENU_ITEM_CLASS} onSelect={() => onSelect(workspace)}>
                <ContextMenu.ItemIndicator className="mr-2">✓</ContextMenu.ItemIndicator>
                {workspace.name}
              </ContextMenu.RadioItem>
            ))}
          </ContextMenu.RadioGroup>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
