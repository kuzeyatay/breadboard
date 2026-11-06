"use client";

import { useCallback, useContext, useRef, type ReactElement } from "react";
import { ContextMenuSurface } from "./link-context-menu";
import { SideChatContext, SideChatMenuContext } from "./side-chat-context";

/** Enables side-chat actions only within the central message scroller. */
export default function SideChatSurface({ children }: { children: ReactElement }) {
  const open = useContext(SideChatContext);
  const selection = useRef("");
  const start = useCallback(() => open?.({ quote: selection.current }), [open]);

  if (!open) return children;

  return <SideChatMenuContext.Provider value={start}>
    <div className="contents" onContextMenuCapture={(event) => {
      const selected = window.getSelection();
      selection.current = selected && event.currentTarget.contains(selected.anchorNode) && event.currentTarget.contains(selected.focusNode)
        ? selected.toString().trim().slice(0, 12000)
        : "";
    }}>
      <ContextMenuSurface label="Chat actions" menu={null}>{children}</ContextMenuSurface>
    </div>
  </SideChatMenuContext.Provider>;
}
