"use client";

import { useLayoutEffect, useRef } from "react";
import { useDesktopTabs } from "@/app/components/use-desktop-tabs";
import { sendDesktopTabsCommand } from "@/lib/desktop-browser-tabs";

/** Like address suggestions, an error card must grow the native toolbar;
 * CSS overflow and z-index alone cannot paint over a website's native view. */
export function useBrowserToolbarError(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useDesktopTabs();
  const targetTabId = tabs?.selfId ?? tabs?.activeId ?? undefined;
  const generation = tabs?.tabs.find(tab => tab.id === targetTabId)?.generation;
  const presentationRevision = tabs?.presentationRevision;

  useLayoutEffect(() => {
    const target = { targetTabId, generation, presentationRevision };
    const close = () => { void sendDesktopTabsCommand({ type: "browser-toolbar-error", open: false, ...target }); };
    const node = ref.current;
    if (!open || !node) { close(); return; }
    const measure = () => {
      if (node.isConnected) void sendDesktopTabsCommand({ type: "browser-toolbar-error", open: true,
        bottom: Math.ceil(node.getBoundingClientRect().bottom) + 2, ...target });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); close(); };
  }, [open, targetTabId, generation, presentationRevision]);
  return ref;
}
