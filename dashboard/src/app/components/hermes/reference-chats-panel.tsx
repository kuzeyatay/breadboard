"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HermesSurface } from "@/lib/hermes/config.ts";
import ReloadableFetchError from "@/app/components/reloadable-fetch-error";

interface ReferenceChat {
  id: string;
  title: string;
  surface: HermesSurface;
  surfaceLabel: string;
  updatedAt: string;
  snippet: string;
  token: string;
}

interface Props {
  sessionId?: string | number | null;
  surface: HermesSurface;
  onSelect: (token: string) => void;
}

const DEBOUNCE_MS = 180;

function referenceDate(value: string): string {
  const parsed = new Date(value.includes("T") ? value : `${value}Z`);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export default function ReferenceChatsPanel({ sessionId, surface, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReferenceChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ surface });
    if (sessionId) params.set("sessionId", String(sessionId));
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    return `/api/hermes/references?${params}`;
  }, [query, sessionId, surface]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(endpoint, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as {
            results?: ReferenceChat[];
            error?: string;
          };
          if (!response.ok) throw new Error(payload.error ?? "Chats could not be loaded.");
          return Array.isArray(payload.results) ? payload.results : [];
        })
        .then((chats) => {
          setResults(chats);
          setError(null);
          setActiveIndex(0);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(cause instanceof Error ? cause.message : "Chats could not be loaded.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query.trim() ? DEBOUNCE_MS : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, query, reload]);

  return (
    <section
      aria-label="Reference a chat"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) => results.length
            ? (current + 1) % results.length
            : 0);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) => results.length
            ? (current - 1 + results.length) % results.length
            : 0);
        } else if (event.key === "Enter" && results[activeIndex]) {
          event.preventDefault();
          onSelect(results[activeIndex].token);
        }
      }}
    >
      <div className="sticky top-0 z-10 bg-[var(--paper-raised)] pb-3">
        <div className="relative">
          <svg
            aria-hidden
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path strokeLinecap="round" d="m16 16 4 4" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats from every surface"
            aria-label="Search chats from every surface"
            className="neu-control w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--botanical)]"
          />
        </div>
        <p className="mt-2 px-1 text-[11px] leading-4 text-[var(--ink-muted)]">
          Choose a chat to attach its transcript to your next message.
        </p>
      </div>

      {error ? (
        <ReloadableFetchError
          message={error}
          onReload={() => {
            setError(null);
            setLoading(true);
            setReload((current) => current + 1);
          }}
          label="Reload chats"
          className="px-3 py-8 text-center text-sm"
        />
      ) : loading && results.length === 0 ? (
        <div className="space-y-2" aria-label="Loading recent chats">
          {[0, 1, 2].map((row) => (
            <div key={row} className="animate-pulse rounded-xl px-3 py-3 motion-reduce:animate-none">
              <span className="block h-3 w-2/5 rounded bg-[var(--paper-strong)]" />
              <span className="mt-2 block h-2.5 w-4/5 rounded bg-[var(--paper-strong)]" />
            </div>
          ))}
        </div>
      ) : results.length ? (
        <ul role="listbox" aria-label="Chats available to reference" className="space-y-0.5">
          {results.map((chat, index) => (
            <li key={chat.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => onSelect(chat.token)}
                className={`w-full rounded-xl px-3 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--botanical)] ${
                  index === activeIndex
                    ? "bg-[var(--paper-surface)]"
                    : "hover:bg-[var(--paper-surface)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink-heading)]">
                    {chat.title}
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--paper-strong)] px-2 py-0.5 text-[9px] font-medium text-[var(--ink-muted)]">
                    {chat.surfaceLabel}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                    {referenceDate(chat.updatedAt)}
                  </span>
                </span>
                {chat.snippet ? (
                  <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">
                    {chat.snippet}
                  </span>
                ) : null}
                <span className="mt-1.5 block truncate font-mono text-[10px] text-[var(--botanical)]">
                  /{chat.token}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-medium text-[var(--ink-heading)]">
            {query.trim() ? "No chats match that search" : "No recent chats yet"}
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--ink-muted)]">
            {query.trim()
              ? "Try a title, phrase, or topic from the conversation."
              : "Saved chats from Terminal, Gardens, and Pages will appear here."}
          </p>
        </div>
      )}
    </section>
  );
}
