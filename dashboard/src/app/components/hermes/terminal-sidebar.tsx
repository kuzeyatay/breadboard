"use client";

// The terminal's left rail: the fixed actions on top (new chat, the panels that
// open beside the transcript, search), then the chat list split into Pinned and
// Recents.
//
// Per-chat actions are hover-revealed on purpose — the rail is read far more
// often than it is acted on, and a row that shows three controls at rest reads
// as a toolbar instead of a list. The Recents header follows the same rule: its
// own menu — pick several chats, or clear the section — appears only on hover.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ActiveChatIcon, ChatHistoryLoading, UnreadChatDot } from "./history-client";
import { ArtifactArchiveIcon } from "./artifact-panel";
import RailDivider from "./rail-divider";
import type { RailResize } from "./use-rail-resize";
import { CHAT_HIGHLIGHTS, chatHighlight } from "@/lib/conversations/highlights";

export type TerminalPanel = "artifacts" | "uploads" | "scheduled" | "hooks" | "processes";

/**
 * The rail's own widths, so every surface that mounts it agrees on them —
 * spread into `useRailResize` and pass the result back as `resize`.
 *
 * `min` is where a chat title stops being readable and `threshold` is the gap
 * below it that no release may land in: between the icon rail and a readable
 * list there is nothing to be left at, which is what a drag-to-any-width
 * sidebar got wrong the first time this one had a drag.
 */
export const CHAT_RAIL_RESIZE = {
  side: "left",
  defaultWidth: 260,
  min: 220,
  max: 420,
  railWidth: 52,
  threshold: 150,
} as const;

/** Reading order of the rail's panel buttons, whichever subset is shown. */
export const TERMINAL_PANELS: readonly TerminalPanel[] = [
  "artifacts",
  "uploads",
  "scheduled",
  "hooks",
  "processes",
];

export interface TerminalSidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  active: boolean;
  pinned: boolean;
  /** A palette slug from lib/conversations/highlights, or null for unmarked. */
  highlight: string | null;
  /** Finished while the user was in another chat, and still unread. */
  unread: boolean;
}

/** What the rail is doing to Recents: nothing, picking chats, or marking them. */
export type RailMode = "idle" | "selecting" | "highlighting";

interface Props {
  chats: TerminalSidebarChat[];
  loading: boolean;
  error: string | null;
  activeChatId: string | null;
  openPanel: TerminalPanel | null;
  onNewChat: () => void;
  onTogglePanel: (panel: TerminalPanel) => void;
  /**
   * Which panel buttons the rail offers, in `TERMINAL_PANELS` order. Defaults to
   * all of them. Garden Chat passes every panel but Artifacts: a garden already
   * carries its artifacts in its own pages, so a second archive beside the
   * transcript would be a duplicate of something the garden is.
   */
  panels?: readonly TerminalPanel[];
  onOpenSearch: () => void;
  onOpenChat: (chat: TerminalSidebarChat) => void;
  onRenameChat: (chat: TerminalSidebarChat, title: string) => void;
  onTogglePin: (chat: TerminalSidebarChat) => void;
  onDeleteChat: (chat: TerminalSidebarChat) => void;
  /** Bulk delete from the Recents menu. Confirmation lives with the caller. */
  onDeleteChats: (chats: TerminalSidebarChat[]) => void;
  /** Mark one chat with a palette color, or clear it with null. */
  onHighlightChat: (chat: TerminalSidebarChat, highlight: string | null) => void;
  /**
   * A control belonging to this surface's Recents, rendered in the section
   * header beside its menu. Garden Chat puts its "View public chats" switch
   * here — it filters the list the header names, so it belongs on that header
   * rather than somewhere else on the rail.
   */
  recentsAction?: React.ReactNode;
  /**
   * What the rail is painted with.
   *
   * `paper` is the Terminal's: flat `--paper-surface`, so the rail reads as the
   * same sheet as the transcript and the panels inside one dock. `tinted` keeps
   * the shared rail class's own green-tinted gradient, which is what a garden's
   * sidebar has always been — there the rail frames the page rather than
   * sharing a surface with it.
   */
  surface?: "paper" | "tinted";
  /** Narrow icon-only rail: the actions stay, the chat list steps out. */
  collapsed: boolean;
  /** Fired by the rail's own edge — the divider is the toggle. */
  onToggleCollapsed: () => void;
  /**
   * Given, the rail's edge drags to any width as well as clicking between two,
   * and the width comes from here instead of the two built-in ones. See
   * `useRailResize`; `collapsed` is expected to be its `collapsed`.
   */
  resize?: RailResize;
}

const SECTION_STATE_KEY = "breadboard:terminal-sidebar:sections";
const PLACEHOLDER_CHAT_TITLES = new Set(["New chat", "Assistant conversation"]);

export function formatChatTime(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function NewChatIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a1.88 1.88 0 1 1 2.65 2.65L8.4 18.25l-3.53.88.88-3.53L16.86 4.49Z" />
    </svg>
  );
}

function UploadsIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75V4.5m0 0L8.25 8.25M12 4.5l3.75 3.75" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 14.25v3.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-3.5" />
    </svg>
  );
}

function SearchIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path strokeLinecap="round" d="m15.5 15.5 4 4" />
    </svg>
  );
}

function ScheduledIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 1.75" />
    </svg>
  );
}

function HooksIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <circle cx="6" cy="12" r="2.25" />
      <circle cx="17.5" cy="6.5" r="2.25" />
      <circle cx="17.5" cy="17.5" r="2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12h2.25a3 3 0 0 0 2.4-1.2l2.75-3.67M12.9 13.2l2.75 3.67" />
    </svg>
  );
}

function ProcessesIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h11.5M14 4.5 16.5 7 14 9.5M19 17H7.5M10 14.5 7.5 17l2.5 2.5" />
      <circle cx="4.5" cy="17" r="1.5" />
      <circle cx="19.5" cy="7" r="1.5" />
    </svg>
  );
}

function PinIcon({ className = "h-3.5 w-3.5", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 3.5 20.5 8.5l-2.9 1.2-3.3 3.3.5 3.2-2 2-4.3-4.3-4 4-.7-.7 4-4L3.5 8.9l2-2 3.2.5 3.3-3.3 1.2-2.9Z" />
    </svg>
  );
}

function MoreIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}

function SelectIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.4 12.2 2.5 2.5 4.7-5" />
    </svg>
  );
}

function HighlighterIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 15.5-3 .8.8-3 7.4-7.4a1.6 1.6 0 0 1 2.3 0l.1.1a1.6 1.6 0 0 1 0 2.3l-7.6 7.2Z" />
      <path strokeLinecap="round" d="M4.5 20.5h15" />
    </svg>
  );
}

function ChevronIcon({ open, className = "h-3.5 w-3.5" }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className} transition-transform ${open ? "" : "-rotate-90"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function readSectionState(): { pinned: boolean; recents: boolean } {
  if (typeof window === "undefined") return { pinned: true, recents: true };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SECTION_STATE_KEY) ?? "{}") as {
      pinned?: unknown;
      recents?: unknown;
    };
    return {
      pinned: parsed.pinned !== false,
      recents: parsed.recents !== false,
    };
  } catch {
    return { pinned: true, recents: true };
  }
}

// A name too long for the rail scrolls itself while the row is hovered, then
// slides back — the row is narrow enough that an ellipsis often hides the part
// that tells two chats apart.
//
// The travel distance is measured on hover rather than on render: the row's
// pin and menu buttons only appear on hover, so the width the name actually has
// is not known until then. Waiting out the delay also keeps a cursor crossing
// the rail from setting every row in motion.
const MARQUEE_DELAY_MS = 350;
const MARQUEE_SPEED_PX_PER_SEC = 42;
/** Share of the animation spent travelling one way; the rest is the pause at each end. */
const MARQUEE_TRAVEL_SHARE = 0.36;

// The element to measure is passed in rather than handed back, so nothing the
// hook returns carries a ref into the render path.
function useTitleMarquee(textRef: React.RefObject<HTMLSpanElement | null>) {
  const timerRef = useRef<number | null>(null);
  const [scroll, setScroll] = useState<{ distance: number; duration: number } | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setScroll(null);
  }, []);

  const start = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const text = textRef.current;
      if (!text) return;
      const distance = text.scrollWidth - text.clientWidth;
      // Sub-pixel overflow is rounding, not a cut-off name.
      if (distance < 2) return;
      const duration = distance / MARQUEE_SPEED_PX_PER_SEC / MARQUEE_TRAVEL_SHARE;
      setScroll({ distance, duration });
    }, MARQUEE_DELAY_MS);
  }, [textRef]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    running: scroll !== null,
    style: scroll
      ? ({
          "--bb-marquee-distance": `${scroll.distance}px`,
          "--bb-marquee-duration": `${scroll.duration.toFixed(2)}s`,
        } as CSSProperties)
      : undefined,
    start,
    stop,
  };
}

function NavButton({
  label,
  icon,
  active = false,
  compact = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  /** Icon-only, for the collapsed rail. The label stays as the accessible name. */
  compact?: boolean;
  onClick?: () => void;
}) {
  // Flat list items, not cards: a column of raised controls reads as separate
  // objects and swamps the chat list underneath it.
  const className = compact
    ? `flex h-9 w-9 items-center justify-center rounded-lg transition ${
        active
          ? "bg-[var(--paper-strong)] text-[var(--ink-heading)]"
          : "text-[var(--ink)] hover:bg-[var(--paper-strong)]"
      }`
    : `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
        active
          ? "bg-[var(--paper-strong)] font-medium text-[var(--ink-heading)]"
          : "text-[var(--ink)] hover:bg-[var(--paper-strong)]"
      }`;
  const content = (
    <>
      <span
        className={`shrink-0 ${active ? "text-[var(--ink-heading)]" : "text-[var(--ink-muted)]"}`}
      >
        {icon}
      </span>
      {compact ? null : <span className="truncate">{label}</span>}
    </>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // Collapsed, the icon is the whole button, so the name has to be said out
      // loud — to the screen reader and, on hover, to the eye.
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={className}
    >
      {content}
    </button>
  );
}

// The header is a row, not one button: `action` renders a control beside the
// collapse toggle, and a button inside a button is invalid markup.
function SectionHeader({
  label,
  open,
  count,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  count: number;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="group/section flex w-full items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
      >
        <ChevronIcon open={open} />
        <span>{label}</span>
        {count > 0 ? (
          <span className="ml-auto text-[10px] font-normal text-[var(--ink-muted)]">{count}</span>
        ) : null}
      </button>
      {action}
    </div>
  );
}

function ChatRow({
  chat,
  selected,
  menuOpen,
  mode = "idle",
  checked = false,
  onPick,
  onOpenMenu,
  onCloseMenu,
  onOpen,
  onRename,
  onRenamingChange,
  onTogglePin,
  onDelete,
}: {
  chat: TerminalSidebarChat;
  selected: boolean;
  menuOpen: boolean;
  /** While Recents is being worked over, the row picks instead of opening. */
  mode?: RailMode;
  checked?: boolean;
  onPick?: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  /** Follows the rename input's mounted life, so the rail can freeze its
   * order while one is open — a row that moves under a focused input blurs
   * it, and blur commits whatever was typed so far. */
  onRenamingChange: (chatId: string, renaming: boolean) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [titleTransition, setTitleTransition] = useState({
    seenTitle: chat.title,
    typing: false,
  });
  // Prop-derived state is adjusted during render so the generated title's
  // first painted frame is already clipped; an effect would briefly flash the
  // complete name before beginning the typing reveal.
  if (titleTransition.seenTitle !== chat.title) {
    setTitleTransition({
      seenTitle: chat.title,
      typing:
        PLACEHOLDER_CHAT_TITLES.has(titleTransition.seenTitle) &&
        !PLACEHOLDER_CHAT_TITLES.has(chat.title),
    });
  }
  // Measured when the menu is opened: the rail scrolls, so the menu is placed
  // against the viewport rather than inside the row.
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const marquee = useTitleMarquee(titleRef);

  // Reported through an effect rather than the handlers so every way out of
  // renaming — commit, Escape, or the row unmounting under a collapsed
  // section — releases the freeze.
  useEffect(() => {
    if (!renaming) return;
    onRenamingChange(chat.id, true);
    return () => onRenamingChange(chat.id, false);
  }, [renaming, chat.id, onRenamingChange]);

  function commitRename() {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== chat.title) onRename(title);
    else setDraft(chat.title);
  }

  if (renaming) {
    return (
      <li className="px-1">
        <input
          autoFocus
          // The server stores at most 200 characters; letting more through
          // would show a title the next refresh silently shortens.
          maxLength={200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(chat.title);
              setRenaming(false);
            }
          }}
          aria-label={`Rename ${chat.title}`}
          className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-1.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
        />
      </li>
    );
  }

  const highlight = chatHighlight(chat.highlight);

  return (
    <li
      // The pressed material means "the chat you are in" at rest and "picked"
      // while Recents is being selected over — two readings of one state, never
      // both at once, so a checked row cannot be mistaken for the open one.
      className={`bb-neu-conversation-row group relative flex items-center rounded-lg transition ${
        (mode === "selecting" ? checked : selected)
          ? "bb-neu-conversation-row-selected"
          : "text-[var(--ink)]"
      }`}
      // A marked chat carries its color at rest, in every mode: an edge bar for
      // the eye scanning the rail and a wash for the row it belongs to. Both are
      // mixed against the paper rather than painted over it, so one palette
      // works on the light and the dark surface.
      style={
        highlight
          ? {
              background: `color-mix(in srgb, ${highlight.color} 15%, transparent)`,
              boxShadow: `inset 3px 0 0 ${highlight.color}`,
            }
          : undefined
      }
    >
      {mode === "selecting" ? (
        // A sibling of the row button, never inside it: the whole row toggles the
        // box, and the box itself stays operable by keyboard on its own.
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onPick?.()}
          aria-label={`Select ${chat.title}`}
          className="ml-2.5 h-3.5 w-3.5 shrink-0 accent-[var(--botanical)]"
        />
      ) : null}
      <button
        type="button"
        onClick={mode === "idle" ? onOpen : () => onPick?.()}
        onMouseEnter={marquee.start}
        onMouseLeave={marquee.stop}
        onFocus={marquee.start}
        onBlur={marquee.stop}
        title={
          mode === "highlighting"
            ? `Highlight ${chat.title}`
            : `${chat.title} · ${formatChatTime(chat.updatedAt)}`
        }
        className="min-w-0 flex-1 rounded-lg px-2.5 py-[7px] text-left"
      >
        <span className="bb-chat-marquee text-[13px]">
          <span
            ref={titleRef}
            className="bb-chat-marquee-text"
            data-marquee={marquee.running ? "run" : undefined}
            data-title-renaming={titleTransition.typing ? "true" : undefined}
            onAnimationEnd={(event) => {
              if (
                event.animationName === "bb-chat-title-type" ||
                event.animationName === "bb-chat-title-fade"
              ) {
                setTitleTransition((current) => ({
                  ...current,
                  typing: false,
                }));
              }
            }}
            style={
              {
                ...marquee.style,
                "--bb-title-character-count": Math.max(1, chat.title.length),
              } as CSSProperties
            }
          >
            {chat.title}
          </span>
        </span>
      </button>
      {/* One spot for the whole life of a run: the spinner while it works, then
          the dot until someone reads what came back. */}
      {chat.active ? (
        <ActiveChatIcon label={`${chat.title} is running`} className="mr-1 h-3.5 w-3.5" />
      ) : chat.unread ? (
        <UnreadChatDot label={`${chat.title} finished — unread`} className="mr-2 h-2 w-2" />
      ) : null}
      <span
        className={`mr-1 shrink-0 items-center gap-0.5 ${
          mode !== "idle"
            ? "hidden"
            : menuOpen
              ? "flex"
              : "hidden group-hover:flex group-focus-within:flex"
        }`}
      >
        <button
          type="button"
          onClick={onTogglePin}
          title={chat.pinned ? "Unpin chat" : "Pin chat"}
          aria-label={chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
          className={`rounded-md p-1 transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] ${
            chat.pinned ? "text-[var(--botanical)]" : "text-[var(--ink-muted)]"
          }`}
        >
          <PinIcon filled={chat.pinned} />
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          data-row-menu-button
          onClick={() => {
            if (menuOpen) {
              onCloseMenu();
              return;
            }
            const rect = menuButtonRef.current?.getBoundingClientRect();
            if (rect) {
              setMenuPosition(
                menuPositionFor(rect, { width: window.innerWidth, height: window.innerHeight }),
              );
            }
            onOpenMenu();
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More actions"
          aria-label={`More actions for ${chat.title}`}
          className="rounded-md p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
        >
          <MoreIcon />
        </button>
      </span>
      {/* The rail scrolls, so the menu is positioned against the viewport. */}
      {menuOpen ? (
        <RowMenu
          chat={chat}
          position={menuPosition}
          onClose={onCloseMenu}
          onRename={() => {
            onCloseMenu();
            setDraft(chat.title);
            setRenaming(true);
          }}
          onTogglePin={() => {
            onCloseMenu();
            onTogglePin();
          }}
          onDelete={() => {
            onCloseMenu();
            onDelete();
          }}
        />
      ) : null}
    </li>
  );
}

interface MenuPosition {
  top: number;
  left: number;
}

const MENU_WIDTH = 176;
const MENU_HEIGHT = 132;

/** Where the menu should sit given the button that opened it. */
export function menuPositionFor(
  anchor: { bottom: number; right: number },
  viewport: { width: number; height: number },
): MenuPosition {
  return {
    top: Math.max(8, Math.min(anchor.bottom + 4, viewport.height - MENU_HEIGHT - 8)),
    left: Math.max(8, Math.min(anchor.right - MENU_WIDTH + 8, viewport.width - MENU_WIDTH - 8)),
  };
}

/** Escape, or a press anywhere outside, closes a menu. Shared by both menus. */
function useDismissOnOutside(
  menuRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // The button that opened the menu closes it through its own click
      // handler; treating its mousedown as "outside" would reopen it.
      if (target?.closest?.("[data-row-menu-button]")) return;
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuRef, onClose]);
}

function RowMenu({
  chat,
  position,
  onClose,
  onRename,
  onTogglePin,
  onDelete,
}: {
  chat: TerminalSidebarChat;
  position: MenuPosition;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuRef, onClose);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${chat.title}`}
      style={{ top: position.top, left: position.left }}
      className="fixed z-[70] w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-1 shadow-[0_10px_26px_rgba(0,0,0,0.18)]"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onRename}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
      >
        <svg className="h-4 w-4 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.86 4.49a1.88 1.88 0 1 1 2.65 2.65L8.4 18.25l-3.53.88.88-3.53L16.86 4.49Z" />
        </svg>
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onTogglePin}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
      >
        <PinIcon className="h-4 w-4 text-[var(--ink-muted)]" filled={chat.pinned} />
        {chat.pinned ? "Unpin chat" : "Pin chat"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[#9a4438] transition hover:bg-[color-mix(in_srgb,#9a4438_10%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-6 0 .6 12.1A1.5 1.5 0 0 0 10.1 20.5h3.8a1.5 1.5 0 0 0 1.5-1.4L16 7" />
        </svg>
        Delete
      </button>
    </div>
  );
}

/** The hover-revealed dots on a section header. Mirrors the per-chat control. */
function SectionMenuButton({
  label,
  open,
  onOpen,
  onClose,
}: {
  label: string;
  open: boolean;
  onOpen: (position: MenuPosition) => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-row-menu-button
      onClick={() => {
        if (open) {
          onClose();
          return;
        }
        const rect = buttonRef.current?.getBoundingClientRect();
        onOpen(
          rect
            ? menuPositionFor(rect, { width: window.innerWidth, height: window.innerHeight })
            : { top: 0, left: 0 },
        );
      }}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`${label} actions`}
      aria-label={`More actions for ${label}`}
      className={`mr-1 shrink-0 rounded-md p-1 text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] ${
        open ? "block" : "hidden group-hover/section:block group-focus-within/section:block"
      }`}
    >
      <MoreIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function RecentsMenu({
  position,
  onClose,
  onStartSelecting,
  onStartHighlighting,
}: {
  position: MenuPosition;
  onClose: () => void;
  onStartSelecting: () => void;
  onStartHighlighting: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuRef, onClose);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Actions for Recents"
      style={{ top: position.top, left: position.left }}
      className="fixed z-[70] w-48 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] py-1 shadow-[0_10px_26px_rgba(0,0,0,0.18)]"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onStartSelecting}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
      >
        <SelectIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        Select chats
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onStartHighlighting}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--paper-surface)]"
      >
        <HighlighterIcon className="h-4 w-4 text-[var(--ink-muted)]" />
        Highlight chats
      </button>
    </div>
  );
}

/**
 * The bar Recents grows while it is being marked: pick up a color, then click
 * chats to paint them. The pen stays in hand between chats, which is the whole
 * point of a mode — marking five chats is five clicks, not five menus.
 */
function HighlightBar({
  pen,
  onPickPen,
  onDone,
}: {
  pen: string | null;
  onPickPen: (highlight: string | null) => void;
  onDone: () => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-1">
      {CHAT_HIGHLIGHTS.map((highlight) => (
        <button
          key={highlight.id}
          type="button"
          onClick={() => onPickPen(highlight.id)}
          aria-pressed={pen === highlight.id}
          title={highlight.label}
          aria-label={`${highlight.label} highlighter`}
          className={`h-4 w-4 shrink-0 rounded-full transition ${
            pen === highlight.id
              ? "ring-2 ring-[var(--ink-heading)] ring-offset-1 ring-offset-[var(--paper-raised)]"
              : "hover:scale-110"
          }`}
          style={{ background: highlight.color }}
        />
      ))}
      {/* The eraser is the same pen holding no color, so clearing a row is the
          same click as marking one. */}
      <button
        type="button"
        onClick={() => onPickPen(null)}
        aria-pressed={pen === null}
        title="Erase"
        aria-label="Eraser"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink-muted)] transition ${
          pen === null
            ? "ring-2 ring-[var(--ink-heading)] ring-offset-1 ring-offset-[var(--paper-raised)]"
            : "hover:text-[var(--ink)]"
        }`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDone}
        className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
      >
        Done
      </button>
    </div>
  );
}

/** The bar Recents grows while chats are being picked. */
function SelectionBar({
  count,
  total,
  onSelectAll,
  onClear,
  onDelete,
  onCancel,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const allSelected = count === total && total > 0;
  return (
    <div className="mb-1 flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-1">
      <button
        type="button"
        onClick={allSelected ? onClear : onSelectAll}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]"
      >
        {allSelected ? "Clear" : "Select all"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={count === 0}
        className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#9a4438] transition hover:bg-[color-mix(in_srgb,#9a4438_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Delete{count > 0 ? ` ${count}` : ""}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)]"
      >
        Cancel
      </button>
    </div>
  );
}

export default function TerminalSidebar({
  chats,
  loading,
  error,
  activeChatId,
  openPanel,
  onNewChat,
  onTogglePanel,
  panels = TERMINAL_PANELS,
  onOpenSearch,
  onOpenChat,
  onRenameChat,
  onTogglePin,
  onDeleteChat,
  onDeleteChats,
  onHighlightChat,
  recentsAction,
  surface = "paper",
  collapsed,
  onToggleCollapsed,
  resize,
}: Props) {
  // The rail only mounts once the dock is open, so reading the stored state
  // during the first render cannot desynchronize from server HTML.
  const [sections, setSections] = useState(readSectionState);
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [recentsMenu, setRecentsMenu] = useState<MenuPosition | null>(null);
  // What the rail is doing to Recents. Only Recents is worked over: a pinned
  // chat is one the user asked to keep, so it stays out of every sweep.
  const [mode, setMode] = useState<RailMode>("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The color in hand while highlighting; null is the eraser.
  const [pen, setPen] = useState<string | null>(CHAT_HIGHLIGHTS[0].id);

  // While a rename input is open the rail renders the list as it stood when
  // editing began. The list refreshes every few seconds, and a refresh that
  // reorders rows moves the focused input's DOM node, which blurs it — and
  // blur commits a half-typed title. Freezing the order for the few seconds
  // of typing is invisible; losing the input mid-word is not. The live list
  // rides a ref so the freeze handler can stay referentially stable — its
  // identity feeds the row effect that reports the input's mounted life.
  const liveChats = useRef(chats);
  useEffect(() => {
    liveChats.current = chats;
  });
  const [frozen, setFrozen] = useState<{
    chatId: string;
    chats: TerminalSidebarChat[];
  } | null>(null);
  const handleRenamingChange = useCallback((chatId: string, renaming: boolean) => {
    if (renaming) setFrozen({ chatId, chats: liveChats.current });
    else setFrozen((current) => (current?.chatId === chatId ? null : current));
  }, []);
  const visibleChats = frozen ? frozen.chats : chats;

  const pinned = visibleChats.filter((chat) => chat.pinned);
  const recents = visibleChats.filter((chat) => !chat.pinned);

  const stopWorking = useCallback(() => {
    setMode("idle");
    setSelectedIds(new Set());
  }, []);

  const toggleSection = useCallback(
    (key: "pinned" | "recents") => {
      setSections((current) => {
        const next = { ...current, [key]: !current[key] };
        window.localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(next));
        // Collapsing Recents hides the rows and the bar that acts on them;
        // leaving the mode alive would make it invisible state.
        if (key === "recents" && !next.recents) stopWorking();
        return next;
      });
    },
    [stopWorking],
  );

  // Collapsing takes the list away, and everything that acts on the list goes
  // with it. The menus are fixed-positioned, so one left open would otherwise
  // hang in the transcript beside a rail that no longer shows its rows.
  useEffect(() => {
    if (!collapsed) return;
    setMenuChatId(null);
    setRecentsMenu(null);
    stopWorking();
  }, [collapsed, stopWorking]);

  // Escape leaves either mode, the same way it closes a menu.
  useEffect(() => {
    if (mode === "idle") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopWorking();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, stopWorking]);

  // Checked ids are intersected with the list on every render rather than
  // pruned when it changes: a chat can leave Recents while it is checked (it
  // was deleted here, deleted in another tab, or pinned), and deriving keeps
  // the count and the delete honest without a second copy of the list. The
  // ones that failed to delete are still there, so they stay checked.
  const selectedChats = recents.filter((chat) => selectedIds.has(chat.id));

  const toggleChecked = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Painting a chat that already carries the pen's color lifts it instead, so
  // one pen both marks and unmarks and a mis-click is undone by repeating it.
  const paint = (chat: TerminalSidebarChat) =>
    onHighlightChat(chat, chat.highlight === pen ? null : pen);

  // Collapsed the actions stack as a centered column of icons; open they are a
  // list of rows.
  const navClassName = collapsed
    ? "flex flex-col items-center gap-0.5 p-2"
    : "space-y-0.5 p-2";

  const renderRow = (chat: TerminalSidebarChat, workable = false) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      selected={chat.id === activeChatId}
      menuOpen={menuChatId === chat.id}
      mode={workable ? mode : "idle"}
      checked={selectedIds.has(chat.id)}
      onPick={() => (mode === "selecting" ? toggleChecked(chat.id) : paint(chat))}
      onOpenMenu={() => setMenuChatId(chat.id)}
      onCloseMenu={() => setMenuChatId(null)}
      onOpen={() => onOpenChat(chat)}
      onRename={(title) => onRenameChat(chat, title)}
      onRenamingChange={handleRenamingChange}
      onTogglePin={() => onTogglePin(chat)}
      onDelete={() => onDeleteChat(chat)}
    />
  );

  return (
    // The rail and the divider that moves it are one unit: the divider is the
    // rail's right edge, so it travels with the width instead of sitting in the
    // toolbar as a separate button.
    <div className="flex shrink-0">
      {/* The shared rail class paints a green-tinted gradient off --paper-bg, and
          it is unlayered CSS, so a background utility cannot beat it. In the
          Terminal the rail is meant to read as the same paper as the chat and
          the panels beside it, so the surface is overridden here and only the
          class's edge shadow is kept; a garden keeps the green. */}
      <aside
        style={{
          ...(surface === "paper" ? { background: "var(--paper-surface)" } : null),
          // A dragged width is the pointer's to set, so the transition steps
          // aside for the length of the gesture — animating toward a position
          // that moves every frame is what makes a drag feel like syrup.
          ...(resize ? { width: resize.width } : null),
        }}
        className={`bb-neu-sidebar-left flex shrink-0 flex-col overflow-hidden text-[var(--ink)] ${
          resize?.dragging ? "" : "bb-rail-travel"
        } ${resize ? "" : collapsed ? "w-[52px]" : "w-[260px]"}`}
      >
        <nav aria-label="Terminal actions" className={navClassName}>
          <NavButton
            label="New chat"
            icon={<NewChatIcon />}
            compact={collapsed}
            onClick={onNewChat}
          />
          {panels.includes("artifacts") ? (
            <NavButton
              label="Artifacts"
              icon={<ArtifactArchiveIcon className="h-[18px] w-[18px]" />}
              active={openPanel === "artifacts"}
              compact={collapsed}
              onClick={() => onTogglePanel("artifacts")}
            />
          ) : null}
          {panels.includes("uploads") ? (
            <NavButton
              label="Uploads"
              icon={<UploadsIcon />}
              active={openPanel === "uploads"}
              compact={collapsed}
              onClick={() => onTogglePanel("uploads")}
            />
          ) : null}
          <NavButton
            label="Search"
            icon={<SearchIcon />}
            compact={collapsed}
            onClick={onOpenSearch}
          />
          {panels.includes("scheduled") ? (
            <NavButton
              label="Scheduled"
              icon={<ScheduledIcon />}
              active={openPanel === "scheduled"}
              compact={collapsed}
              onClick={() => onTogglePanel("scheduled")}
            />
          ) : null}
          {panels.includes("hooks") ? (
            <NavButton
              label="Hooks"
              icon={<HooksIcon />}
              active={openPanel === "hooks"}
              compact={collapsed}
              onClick={() => onTogglePanel("hooks")}
            />
          ) : null}
          {panels.includes("processes") ? (
            <NavButton
              label="Processes"
              icon={<ProcessesIcon />}
              active={openPanel === "processes"}
              compact={collapsed}
              onClick={() => onTogglePanel("processes")}
            />
          ) : null}
        </nav>

        <div
          // Collapsed, the list is not narrowed — it is gone. A 52px column of
          // clipped chat names would be noise, and hiding it keeps the rows out
          // of the tab order while the rail is shut.
          hidden={collapsed}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        >
          {error ? <p className="px-2 pb-1 text-[11px] text-[#9a4438]">{error}</p> : null}

          {pinned.length > 0 ? (
            <section className="pt-1">
              <SectionHeader
                label="Pinned"
                open={sections.pinned}
                count={pinned.length}
                onToggle={() => toggleSection("pinned")}
              />
              {sections.pinned ? (
                <ul className="space-y-0.5">{pinned.map((chat) => renderRow(chat))}</ul>
              ) : null}
            </section>
          ) : null}

          <section className="pt-1">
            <SectionHeader
              label="Recents"
              open={sections.recents}
              count={recents.length}
              onToggle={() => toggleSection("recents")}
              action={
                <>
                  {mode === "idle" ? recentsAction : null}
                  {recents.length > 0 && mode === "idle" ? (
                    <SectionMenuButton
                      label="Recents"
                      open={recentsMenu !== null}
                      onOpen={setRecentsMenu}
                      onClose={() => setRecentsMenu(null)}
                    />
                  ) : null}
                </>
              }
            />
            {recentsMenu ? (
              <RecentsMenu
                position={recentsMenu}
                onClose={() => setRecentsMenu(null)}
                onStartSelecting={() => {
                  setRecentsMenu(null);
                  setSelectedIds(new Set());
                  setMode("selecting");
                  // Working on a collapsed section would show nothing.
                  if (!sections.recents) toggleSection("recents");
                }}
                onStartHighlighting={() => {
                  setRecentsMenu(null);
                  setMode("highlighting");
                  if (!sections.recents) toggleSection("recents");
                }}
              />
            ) : null}
            {sections.recents ? (
              loading && chats.length === 0 ? (
                <ChatHistoryLoading />
              ) : recents.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-[var(--ink-muted)]">
                  {pinned.length > 0 ? "Everything is pinned" : "No chats yet"}
                </p>
              ) : (
                <>
                  {mode === "selecting" ? (
                    <SelectionBar
                      count={selectedChats.length}
                      total={recents.length}
                      onSelectAll={() => setSelectedIds(new Set(recents.map((chat) => chat.id)))}
                      onClear={() => setSelectedIds(new Set())}
                      onDelete={() => onDeleteChats(selectedChats)}
                      onCancel={stopWorking}
                    />
                  ) : null}
                  {mode === "highlighting" ? (
                    <HighlightBar pen={pen} onPickPen={setPen} onDone={stopWorking} />
                  ) : null}
                  <ul className="space-y-0.5">{recents.map((chat) => renderRow(chat, true))}</ul>
                </>
              )
            ) : null}
          </section>
        </div>
      </aside>
      <RailDivider
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
        name="Toggle the sidebar"
        moves="the chat list"
        onPointerDown={resize?.onPointerDown}
        dragging={resize?.dragging}
      />
    </div>
  );
}
