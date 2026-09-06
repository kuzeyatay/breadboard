"use client";

import Link from "next/link";
import NavbarFlowerWind from "./navbar-flower-wind";
import WorkTimerShortcut from "./work-timer-shortcut";
import BrowserShortcut from "./browser-shortcut";
import ClickyShortcut from "./clicky-shortcut";
import VoiceShortcut from "./voice-shortcut";
import LinkContextMenu from "./link-context-menu";
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
  /**
   * Which optional shortcuts this account has asked for. Read on the server so
   * the navbar is right on first paint rather than rearranging after hydration.
   */
  shortcuts?: NavbarShortcuts;
}

export default function NavBar({
  email,
  username,
  showFlowers = true,
  showActions = true,
  shortcuts = DEFAULT_NAVBAR_SHORTCUTS,
}: Props) {
  return (
    <nav className="breadboard-flower-navbar neu-surface-subtle relative flex items-center justify-between px-6 py-2.5 border-b border-gray-800 shrink-0">
      <NavbarFlowerWind showFlowers={showFlowers} />
      <LinkContextMenu href="/dashboard" label="Dashboard">
        <Link
          href="/dashboard"
          className="relative z-10 flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
          aria-label="Go to Breadboard main page"
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
        </Link>
      </LinkContextMenu>
      {/* Agents live in the capability palette's Agents tab (the slash button),
          not in this navbar. */}
      {showActions && <div className="relative z-10 flex items-center gap-4">
        {/* Work timer, Clicky and Plan ship on by default; the rest stay opt-in.
            Every seat can be changed from the profile page. */}
        {shortcuts.workTimer && <WorkTimerShortcut />}
        {/* The embedded browser is desktop-only; its seat draws nothing on the web. */}
        {shortcuts.browser && <BrowserShortcut />}
        {/* Clicky is available in the Windows and macOS desktop shells. */}
        {shortcuts.clicky && <ClickyShortcut />}
        {shortcuts.voice && <VoiceShortcut />}
        {shortcuts.plan && (
          <LinkContextMenu href="/plan" label="Plan">
          <a
            href="/plan"
            target="_blank"
            rel="noopener noreferrer"
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
          </a>
          </LinkContextMenu>
        )}
        {shortcuts.buzz && (
          <LinkContextMenu href="/buzz" label="Organization">
          <a
            href="/buzz"
            target="_blank"
            rel="noopener noreferrer"
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
          </a>
          </LinkContextMenu>
        )}
        {/* The profile chip is the way to the profile page, which is where
            inviting and signing out now live — both are account business, and
            neither was worth a permanent seat in the navbar. */}
        <LinkContextMenu href="/profile" label="Profile">
        <Link
          href="/profile"
          title="Your profile"
          className="flex min-w-0 max-w-[240px] items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-gray-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)]"
        >
          <svg
            className="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
          <span className="truncate font-medium">{username || email}</span>
        </Link>
        </LinkContextMenu>
      </div>}
    </nav>
  );
}
