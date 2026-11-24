"use client";

import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import NavigationLink from "./navigation-link";
import VSCodeIcon from "./vscode-icon";
import NavbarFlowerWind from "./navbar-flower-wind";
import VoiceShortcut from "./voice-shortcut";
import {
  DEFAULT_NAVBAR_SHORTCUTS,
  type NavbarShortcuts,
} from "@/lib/profile/navbar-shortcuts.ts";

interface Props {
  email: string;
  username?: string | null;
  showFlowers?: boolean;
  /** Show the right-hand shortcuts and profile link. */
  showActions?: boolean;
  trailingActions?: ReactNode;
  /**
   * Which optional shortcuts this account has asked for. Read on the server so
   * the navbar is right on first paint rather than rearranging after hydration.
   */
  shortcuts?: NavbarShortcuts;
}

export default function NavBar({
  showFlowers = true,
  showActions = true,
  trailingActions,
  shortcuts = DEFAULT_NAVBAR_SHORTCUTS,
}: Props) {
  return (
    <nav className="breadboard-flower-navbar neu-surface-subtle relative flex items-center justify-between px-6 py-2.5 border-b border-gray-800 shrink-0">
      <NavbarFlowerWind showFlowers={showFlowers} />
      <NavigationLink newTab label="Terminal"
        href="/new-tab"
        className="relative z-10 flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
        aria-label="Go to Terminal"
      >
        {/* logo.png is white line-art; darken it to the ink tone so it reads on the light theme. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="breadboard"
          className="breadboard-logo h-12 w-12 object-contain [filter:brightness(0)_saturate(100%)] opacity-90"
        />
        <span className="text-lg font-medium text-white tracking-tight">
          breadboard
        </span>
      </NavigationLink>
      {/* Agents live in the capability palette's Agents tab (the slash button),
          not in this navbar. */}
      {showActions && <div className="relative z-10 flex items-center gap-4">
        {/* Browsing now starts through the combined home search and shortcuts.
            BrowserShortcut and the browser route remain available in code. */}
        {shortcuts.voice && <VoiceShortcut />}
        {shortcuts.plan && (
          <NavigationLink newTab label="Plan"
            href="/plan"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            title="Open Plan — your board and calendar — in a new tab"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="5.5" height="15" rx="1.6" />
              <rect x="11.5" y="4.5" width="5.5" height="9.5" rx="1.6" />
              <path strokeLinecap="round" d="M19.5 6.5v11" />
            </svg>
            Plan
          </NavigationLink>
        )}
        <NavigationLink newTab label="Code" href="/code"
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors" title="Open Code in a new tab">
          <VSCodeIcon />
          Code
        </NavigationLink>
        {shortcuts.buzz && (
          <NavigationLink newTab label="Organization"
            href="/buzz"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            title="Open Organization — rooms you share with your team and their agents — in a new tab"
          >
            {/* An org chart, not a speech bubble: the room list is organised by
                team, so the glyph names the structure rather than the chatter. */}
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="5" rx="1.4" />
              <rect x="2.5" y="16" width="6" height="5" rx="1.4" />
              <rect x="15.5" y="16" width="6" height="5" rx="1.4" />
              <path d="M12 8v3.5M5.5 16v-2.5h13V16" />
            </svg>
            Organization
          </NavigationLink>
        )}
        <NavigationLink newTab label="Settings"
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="browser-toolbar-button"
        >
          <Settings aria-hidden="true" />
        </NavigationLink>
      </div>}
      {trailingActions}
    </nav>
  );
}
