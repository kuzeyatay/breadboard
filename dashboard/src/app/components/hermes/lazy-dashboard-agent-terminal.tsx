"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { TerminalPanel } from "./terminal-sidebar";

const OPEN_STATE_KEY = "breadboard:knowledge-terminal-open";
const DashboardAgentTerminal = dynamic(() => import("./dashboard-agent-terminal"), {
  ssr: false,
  loading: () => (
    <div
      data-terminal-dock
      className="bb-neu-tray neu-surface-raised fixed inset-x-0 bottom-0 z-40 flex h-12 items-center border-t px-4 text-sm text-gray-400"
    >
      Loading Terminal…
    </div>
  ),
});

interface Props {
  scope: "mine" | "public";
  restoreOwnerKey: string;
  initialPanel?: TerminalPanel | null;
  backdropImage?: string | null;
}

/**
 * Keep the dashboard's largest client graph genuinely on demand. A collapsed
 * terminal used to mount thousands of lines of UI and immediately fan out to
 * runtime/history/model endpoints even when the user only wanted a garden.
 * Restore an explicitly open terminal or route-owned panel automatically;
 * otherwise the lightweight 48px bar is the compilation boundary.
 */
export default function LazyDashboardAgentTerminal(props: Props) {
  const [enabled, setEnabled] = useState(Boolean(props.initialPanel));

  useEffect(() => {
    if (props.initialPanel || window.sessionStorage.getItem(OPEN_STATE_KEY) === "true") {
      const frame = window.requestAnimationFrame(() => setEnabled(true));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [props.initialPanel]);

  if (enabled) {
    return (
      <div data-lazy-terminal-host>
        <DashboardAgentTerminal {...props} />
      </div>
    );
  }

  return (
    <div data-lazy-terminal-host>
      <button
        type="button"
        data-terminal-dock
        aria-expanded="false"
        aria-label="Open terminal"
        onClick={() => setEnabled(true)}
        className="bb-neu-tray neu-surface-raised fixed inset-x-0 bottom-0 z-40 flex h-12 items-center border-t border-[rgba(169,193,177,0.7)] bg-[var(--terminal-bar)] px-4 text-left text-sm font-medium text-gray-100"
      >
        <span className="mr-3 h-2 w-2 rounded-full bg-[#A9C1B1]" aria-hidden />
        Terminal
      </button>
    </div>
  );
}
