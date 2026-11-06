"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { reorderBrowserBookmarks } from "./browser-bookmark-order";

interface ShortcutDrag { owner: string; url: string; beforeUrl: string | null }
export function useShortcutReorder<T extends {url:string; label:string}>(owner: string, items: T[], enabled: boolean, save: (next: T[]) => Promise<boolean>) {
  const current = useRef<ShortcutDrag | null>(null), suppressClickUntil = useRef(0);
  const [drag, setDrag] = useState<ShortcutDrag | null>(null);
  const [pending, setPending] = useState<{owner:string;items:T[]} | null>(null);
  const [announcement, setAnnouncement] = useState("");
  function end() { current.current = null; setDrag(null); suppressClickUntil.current = Date.now() + 250; }
  function beforeAt(container: HTMLDivElement, x: number, y: number, url: string) {
    for (const node of container.querySelectorAll<HTMLElement>("[data-shortcut-url]")) {
      if (node.dataset.shortcutUrl === url) continue;
      const rect = node.getBoundingClientRect();
      if (y < rect.top || (y <= rect.bottom && x < rect.left + rect.width / 2)) return node.dataset.shortcutUrl!;
    }
    return null;
  }
  async function commit(url: string, beforeUrl: string | null) {
    if (!enabled || pending) return;
    const next = reorderBrowserBookmarks(items, url, beforeUrl);
    if (next === items) return;
    setPending({owner,items:next});
    try {
      if (await save(next)) {
        const index = next.findIndex(item => item.url === url);
        setAnnouncement(`Moved ${next[index].label} to position ${index + 1} of ${next.length}.`);
      } else setAnnouncement("Couldn’t save the new order. Your previous order has been kept.");
    } finally { setPending(null); }
  }
  function validDrop(event: DragEvent<HTMLDivElement>) {
    return enabled && !pending && current.current?.owner === owner &&
      !(event.target instanceof Element && event.target.closest(".browser-add-shortcut"));
  }
  return {
    items: pending?.owner === owner ? pending.items : items,
    drag: enabled && drag?.owner === owner ? drag : null, announcement,
    canNavigate: () => !current.current && Date.now() >= suppressClickUntil.current,
    start(event: DragEvent<HTMLButtonElement>, url: string) {
      if (!enabled || pending) { event.preventDefault(); return; }
      current.current = {owner,url,beforeUrl:url};setDrag(current.current);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", url);
    },
    over(event: DragEvent<HTMLDivElement>) {
      if (!validDrop(event)) return;
      event.preventDefault();event.dataTransfer.dropEffect = "move";
      const active = current.current!;
      const beforeUrl = beforeAt(event.currentTarget, event.clientX, event.clientY, active.url);
      if (beforeUrl !== active.beforeUrl) { current.current = {...active,beforeUrl};setDrag(current.current); }
    },
    drop(event: DragEvent<HTMLDivElement>) {
      if (!validDrop(event)) { end(); return; }
      event.preventDefault();
      const url = current.current!.url, beforeUrl = beforeAt(event.currentTarget, event.clientX, event.clientY, url);
      end();void commit(url,beforeUrl);
    },
    keyDown(event: KeyboardEvent<HTMLButtonElement>, url: string) {
      if (event.key === "Escape" && current.current) { event.preventDefault();end();return; }
      if (!enabled || !event.altKey || !event.shiftKey || !["ArrowLeft","ArrowRight"].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      const from = items.findIndex(item => item.url === url), to = from + (event.key === "ArrowLeft" ? -1 : 1);
      if (from < 0 || to < 0 || to >= items.length) return;
      void commit(url,event.key === "ArrowLeft" ? items[to].url : items[to + 1]?.url ?? null);
    },
    end,
  };
}
