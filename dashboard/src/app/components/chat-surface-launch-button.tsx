"use client";

import { useState } from "react";
import type { ChatSurfaceKind } from "@/lib/chat-surface-launch-client";

const SURFACE_NAMES: Record<Exclude<ChatSurfaceKind, "terminal">, string> = {
  pdf: "PDF Assistant",
  explore: "Explore Assistant",
  workspace: "Garden workspace",
  browser: "browser",
  code: "VS Code",
};

export function chatSurfaceLaunchLabel(kind: ChatSurfaceKind): string {
  if (kind === "pdf") return "Open this chat with its PDF";
  if (kind === "explore") return "Open this chat beside its garden page";
  if (kind === "browser") return "Open this chat on its website";
  if (kind === "workspace") return "Open this chat in its garden workspace";
  if (kind === "code") return "Open this chat in VS Code";
  return "Open this chat";
}

/**
 * The corner control that takes the place of the temporary-chat switch once a
 * chat is on screen that belongs to another surface: it opens that surface
 * (the PDF and its assistant, the reader page, the workspace) on this chat.
 */
export function ChatSurfaceLaunchButton({
  kind,
  onLaunch,
  className = "",
  iconClassName = "h-[22px] w-[22px]",
}: {
  kind: ChatSurfaceKind;
  onLaunch: () => void | Promise<unknown>;
  className?: string;
  iconClassName?: string;
}) {
  // One launch at a time: a second click while the first is under way would
  // queue a second navigation behind it.
  const [launching, setLaunching] = useState(false);
  const label = chatSurfaceLaunchLabel(kind);
  const name = kind === "terminal" ? null : SURFACE_NAMES[kind];
  return (
    <button
      type="button"
      onClick={() => {
        if (launching) return;
        setLaunching(true);
        Promise.resolve(onLaunch()).finally(() => setLaunching(false));
      }}
      disabled={launching}
      aria-label={label}
      title={name ? `${label} (${name})` : label}
      data-chat-surface-launch={kind}
      className={`flex items-center justify-center rounded-lg transition-colors disabled:cursor-default disabled:opacity-60 ${className}`}
    >
      <svg
        className={iconClassName}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13.5 4.5h6v6" />
        <path d="M19.5 4.5 11 13" />
        <path d="M18 14v3.75A2.25 2.25 0 0 1 15.75 20H6.25A2.25 2.25 0 0 1 4 17.75V8.25A2.25 2.25 0 0 1 6.25 6H10" />
      </svg>
    </button>
  );
}
