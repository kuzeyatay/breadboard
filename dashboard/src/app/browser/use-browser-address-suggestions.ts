"use client";

import { useLayoutEffect, useRef } from "react";
import { refreshDesktopTabsState, sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";

/** Raise the transparent trusted chrome over the native page while the list
 * is open. The page keeps its normal viewport and scroll position. */
export function useBrowserAddressSuggestions(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useDesktopTabs();
  const targetId = tabs?.selfId ?? tabs?.activeId ?? undefined;
  const generation = tabs?.tabs.find(tab => tab.id === targetId)?.generation;
  const presentationRevision = tabs?.presentationRevision;

  useLayoutEffect(() => {
    const target = { targetTabId: targetId, generation, presentationRevision };
    const close = () => {
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false, ...target }).then(closed => {
        // Older desktop processes validate this UI cleanup against the page's
        // generation. Refreshing a rejected snapshot reruns the effect with
        // the current identity so a hidden dropdown cannot keep blocking input.
        if (!closed) void refreshDesktopTabsState();
      });
    };
    const dropdown = ref.current;
    if (!open || !dropdown) {
      close();
      return;
    }

    const sync = () => {
      if (dropdown.isConnected) void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: true, bottom: Math.ceil(dropdown.getBoundingClientRect().bottom), ...target });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dropdown);
    // The native toolbar can resize without changing the list's box. Its
    // entrance transform also changes the bottom without a ResizeObserver
    // notification. Keep the native clip in sync with both changes.
    window.addEventListener("resize", sync);
    dropdown.addEventListener("animationend", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      dropdown.removeEventListener("animationend", sync);
      close();
    };
  }, [open, targetId, generation, presentationRevision]);

  return ref;
}
