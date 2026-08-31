"use client";

import DashboardAgentTerminal from "./dashboard-agent-terminal";
import type { TerminalPanel } from "./terminal-sidebar";

interface Props {
  scope: "mine" | "public";
  restoreOwnerKey: string;
  initialPanel?: TerminalPanel | null;
  backdropImage?: string | null;
  initialChatId?: string | null;
}

/**
 * Load the Terminal with the dashboard's startup bundle. The desktop shell
 * prepares that dashboard behind its startup screen, so the first dock the
 * person can see is the real brown Terminal bar, never a second placeholder.
 */
export default function LazyDashboardAgentTerminal(props: Props) {
  return (
    <div data-lazy-terminal-host>
      <DashboardAgentTerminal {...props} />
    </div>
  );
}
