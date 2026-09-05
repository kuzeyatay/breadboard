"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { reorderBrowserBookmarks } from "./browser-bookmark-order";

interface BookmarkDrag {
  owner: string;
  url: string;
  beforeUrl: string | null;
}

export function useBrowserBookmarkReorder<T extends { url: string; title: string }>(
  owner: string,
  items: T[],
  enabled: boolean,
  save: (next: T[]) => Promise<boolean>,
) {
  const active = useRef<BookmarkDrag | null>(null);
  const [drag, setDrag] = useState<BookmarkDrag | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function end() {
    active.current = null;
    setDrag(null);
  }

  function beforeAt(container: HTMLDivElement, clientX: number, url: string) {
    for (const node of container.querySelectorAll<HTMLElement>("[data-bookmark-url]")) {
      if (node.dataset.bookmarkUrl === url) continue;
      const rect = node.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return node.dataset.bookmarkUrl!;
    }
    return null;
  }

  async function commit(url: string, beforeUrl: string | null) {
    if (!enabled) return;
    const next = reorderBrowserBookmarks(items, url, beforeUrl);
    if (next === items) return;
    if (await save(next)) {
      const index = next.findIndex((item) => item.url === url);
      setAnnouncement(`Moved ${next[index].title} to position ${index + 1} of ${next.length}.`);
    }
  }

  return {
    drag: drag?.owner === owner ? drag : null,
    announcement,
    start(event: DragEvent<HTMLElement>, url: string) {
      if (!enabled || items.length < 2) { event.preventDefault(); return; }
      const entry = { owner, url, beforeUrl: url };
      active.current = entry;
      setDrag(entry);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", url);
    },
    over(event: DragEvent<HTMLDivElement>) {
      const current = active.current;
      if (!current || current.owner !== owner || !enabled) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const container = event.currentTarget;
      const rect = container.getBoundingClientRect();
      // Keep bookmarks beyond either end of an overflowing bar reachable.
      if (event.clientX < rect.left + 28) container.scrollLeft -= 24;
      else if (event.clientX > rect.right - 28) container.scrollLeft += 24;
      const beforeUrl = beforeAt(container, event.clientX, current.url);
      if (beforeUrl !== current.beforeUrl) {
        active.current = { ...current, beforeUrl };
        setDrag(active.current);
      }
    },
    drop(event: DragEvent<HTMLDivElement>) {
      const current = active.current;
      if (!current || current.owner !== owner || !enabled) return;
      event.preventDefault();
      const beforeUrl = beforeAt(event.currentTarget, event.clientX, current.url);
      end();
      void commit(current.url, beforeUrl);
    },
    keyDown(event: KeyboardEvent<HTMLButtonElement>, url: string) {
      if (!enabled || !event.altKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      event.stopPropagation();
      const from = items.findIndex((item) => item.url === url);
      const to = from + (event.key === "ArrowLeft" ? -1 : 1);
      if (from < 0 || to < 0 || to >= items.length) return;
      void commit(url, event.key === "ArrowLeft" ? items[to].url : items[to + 1]?.url ?? null);
    },
    end,
  };
}
