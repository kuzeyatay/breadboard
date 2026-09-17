"use client";

import { useLayoutEffect, useRef } from "react";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

/** Raise the transparent trusted chrome over the native page while the list
 * is open. The page keeps its normal viewport and scroll position. */
export function useBrowserAddressSuggestions(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dropdown = ref.current;
    if (!open || !dropdown) {
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
      return;
    }

    void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: true });
    return () => {
      void sendDesktopTabsCommand({ type: "browser-address-suggestions", open: false });
    };
  }, [open]);

  return ref;
}
