"use client";

import { Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { TerminalPanel } from "./terminal-sidebar";
import { useStartupLoading } from "../startup-readiness";

const DashboardAgentTerminal = dynamic(() => import("./dashboard-agent-terminal"));

function Hydrated({ onReady }: { onReady: () => void }) {
  useLayoutEffect(onReady, [onReady]);
  return null;
}

interface Props {
  scope: "mine" | "public";
  restoreOwnerKey: string;
  initialPanel?: TerminalPanel | null;
  backdropImage?: string | null;
  initialChatId?: string | null;
}

/**
 * Server-render the original Terminal, but hydrate its large chat/editor tree
 * independently. An eager import makes the clock, bookmarks, wallpaper and
 * every other home control wait for all of that JavaScript on each new tab.
 * Keep this boundary even with SSR enabled: next/dynamic does not add one by
 * default, and without it the entire dashboard suspends during hydration.
 */
export default function LazyDashboardAgentTerminal(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const pending = useRef<Array<{ target: Element; event: MouseEvent | KeyboardEvent }>>([]);
  const [hydrated, setHydrated] = useState(false);
  useStartupLoading(!hydrated);

  // The page-wide bridge can release home controls before this separate
  // boundary is ready. Preserve an early Terminal click/Enter press as well.
  useLayoutEffect(() => {
    const capture = (event: MouseEvent | KeyboardEvent) => {
      if (ready.current || !(event.target instanceof Element) || !host.current?.contains(event.target)) return;
      if (event.target.closest("a[href]")) return;
      if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pending.current.push({ target: event.target, event });
    };
    document.addEventListener("click", capture, true);
    document.addEventListener("keydown", capture, true);
    return () => {
      document.removeEventListener("click", capture, true);
      document.removeEventListener("keydown", capture, true);
      pending.current = [];
    };
  }, []);

  const onReady = useCallback(() => {
    ready.current = true;
    setHydrated(true);
    // React suppresses events during its commit, including layout effects.
    // Replay once the commit finishes and the real handlers can receive them.
    queueMicrotask(() => {
      for (const { target, event } of pending.current.splice(0)) {
        if (!target.isConnected) continue;
        target.dispatchEvent(event instanceof KeyboardEvent
          ? new KeyboardEvent(event.type, event)
          : new MouseEvent(event.type, event));
      }
    });
  }, []);

  return (
    <div ref={host} data-lazy-terminal-host>
      <Suspense fallback={null}>
        <DashboardAgentTerminal {...props} />
        <Hydrated onReady={onReady} />
      </Suspense>
    </div>
  );
}
