"use client";

// Search across past chats. Two things have to work here: recalling a word you
// know is in the chat, and describing a chat whose words you have forgotten.
// The ranking that makes the second case work lives on the server
// (lib/conversations/search.ts); this dialog only debounces, lists and picks.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { readLastOpenedChats } from "@/lib/conversations/last-opened";
import { formatChatTime, type TerminalSidebarChat } from "./terminal-sidebar";

export interface ChatSearchResult {
  id: string;
  title: string;
  updatedAt: string;
  pinned: boolean;
  matchedOn: "title" | "message";
  snippet: string;
}

interface Props {
  surface: string;
  /** Set inside a garden: only that garden's chats are searched. */
  gardenSlug?: string | null;
  /** Shown before anything is typed, so the dialog is never blank. */
  recents: TerminalSidebarChat[];
  onClose: () => void;
  onSelect: (chatId: string) => void;
}

const DEBOUNCE_MS = 180;

/**
 * Mounted only while open — the host renders it conditionally — so every
 * opening starts from an empty box instead of the last search.
 */
export default function ChatSearchDialog({
  surface,
  gardenSlug = null,
  recents,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lastOpenedIds, setLastOpenedIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLastOpenedIds(
      readLastOpenedChats(window.localStorage, surface, gardenSlug),
    );
  }, [surface, gardenSlug]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetch(
        `/api/hermes/sessions/search?surface=${encodeURIComponent(surface)}&q=${encodeURIComponent(trimmed)}${
          gardenSlug ? `&gardenSlug=${encodeURIComponent(gardenSlug)}` : ""
        }`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as {
            results?: ChatSearchResult[];
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error ?? "Search is unavailable.");
          return payload.results ?? [];
        })
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setError(null);
          setActiveIndex(0);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setResults([]);
          setError(cause instanceof Error ? cause.message : "Search is unavailable.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, surface, gardenSlug]);

  const searchingNow = searching && query.trim().length > 0;
  const recentRows = recents.slice(0, 12).map((chat) => ({
    id: chat.id,
    title: chat.titlePrefix ? `${chat.titlePrefix}: ${chat.title}` : chat.title,
    updatedAt: chat.updatedAt,
    snippet: "",
  }));
  const recentById = new Map(
    recents.map((chat) => [
      chat.id,
      {
        id: chat.id,
        title: chat.titlePrefix ? `${chat.titlePrefix}: ${chat.title}` : chat.title,
        updatedAt: chat.updatedAt,
        snippet: "",
      },
    ]),
  );
  const lastOpenedRows = lastOpenedIds.flatMap((id) => {
    const chat = recentById.get(id);
    return chat ? [chat] : [];
  });
  const displayRows = query.trim()
    ? results.map((row) => ({
        key: `result:${row.id}`,
        section: null,
        row,
      }))
    : [
        ...lastOpenedRows.map((row) => ({
          key: `last-opened:${row.id}`,
          section: "Last opened",
          row,
        })),
        ...recentRows.map((row) => ({
          key: `recent:${row.id}`,
          section: "Recent",
          row,
        })),
      ];
  const rows = displayRows.map(({ row }) => row);

  const choose = useCallback(
    (chatId: string) => {
      onSelect(chatId);
      onClose();
    },
    [onClose, onSelect],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search chats"
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        // Plain drop shadow: the shared dialog material adds a pale outward
        // highlight, which turns into a white halo over the dimmed page.
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_18px_44px_rgba(0,0,0,0.22)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(rows.length - 1, current + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
          } else if (event.key === "Enter") {
            const row = rows[activeIndex];
            if (row) {
              event.preventDefault();
              choose(row.id);
            }
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
          <svg className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <circle cx="10.75" cy="10.75" r="6.25" />
            <path strokeLinecap="round" d="m15.5 15.5 4 4" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats, or describe one…"
            aria-label="Search chats"
            className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
          />
          {searchingNow ? <span className="text-[11px] text-[var(--ink-muted)]">Searching…</span> : null}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {error ? <p className="px-3 py-4 text-xs text-[#9a4438]">{error}</p> : null}
          {!error && rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--ink-muted)]">
              {query.trim() && !searchingNow ? "No chat matches that." : "Nothing here yet."}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {displayRows.map(({ key, section, row }, index) => (
              <Fragment key={key}>
                {section && section !== displayRows[index - 1]?.section ? (
                  <li role="presentation">
                    <p
                      className={`px-2 pb-1 text-xs font-semibold text-[var(--ink-muted)] ${
                        index === 0 ? "pt-1" : "pt-3"
                      }`}
                    >
                      {section}
                    </p>
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    onClick={() => choose(row.id)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition ${
                      index === activeIndex
                        ? "bg-[var(--paper-strong)]"
                        : "hover:bg-[var(--paper-surface)]"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">{row.title}</span>
                      <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">{formatChatTime(row.updatedAt)}</span>
                    </span>
                    {row.snippet ? (
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">{row.snippet}</span>
                    ) : null}
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
