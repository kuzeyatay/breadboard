"use client";

import { createContext, useContext } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";

export interface SideChatRequest {
  conversationId?: string;
  messageId?: string;
  quote?: string;
}

export const SideChatContext = createContext<((request?: SideChatRequest) => void) | null>(null);

// Only the transcript supplies this action; the workspace context also serves
// saved side-chat navigation from the sidebars.
export const SideChatMenuContext = createContext<(() => void) | null>(null);

/** Also appended to nested menus so links and cards keep their own actions. */
export function SideChatMenuItem({ className }: { className: string }) {
  const open = useContext(SideChatMenuContext);
  return open ? <ContextMenu.Item className={className} onSelect={() => open()}>
    Start side chat
  </ContextMenu.Item> : null;
}
