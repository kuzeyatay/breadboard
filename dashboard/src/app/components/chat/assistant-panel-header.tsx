"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { History, Search, SquarePen, Star, X } from "lucide-react";

export interface AssistantHistoryItem { id: string; title: string; updatedAt: string; active?: boolean }

/** "4m", "40m", "3d": the history list's right-hand age. */
export function shortAge(iso: string, now = Date.now()): string {
  const time = Date.parse(iso.includes("T") || iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 30) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 43_200)}mo`;
}

const iconButton = "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink)] disabled:opacity-40 aria-pressed:bg-[var(--paper-strong)] aria-pressed:text-[var(--ink)]";

/**
 * The assistant's one header line: the chat's name, then Starred, History and New chat. History is a
 * searchable popover: this place's chats on top, and below them the other chats the search reaches,
 * which open where they live.
 */
export default function AssistantPanelHeader({ title, starredOpen, onToggleStarred, items, activeId, onOpen, currentLabel, searchOthers, onOpenOther, onNewChat, newChatDisabled, onClose, extra }: {
  title: string;
  starredOpen: boolean;
  onToggleStarred: () => void;
  items: AssistantHistoryItem[];
  activeId?: string | null;
  onOpen: (id: string) => void;
  /** Heading over `items`, e.g. "This page". */
  currentLabel: string;
  /** Other chats: recent ones for an empty query, else search hits. Items already in `items` are dropped. */
  searchOthers?: (query: string, signal: AbortSignal) => Promise<AssistantHistoryItem[]>;
  onOpenOther?: (item: AssistantHistoryItem) => void;
  onNewChat: () => void;
  newChatDisabled?: boolean;
  onClose?: () => void;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [others, setOthers] = useState<AssistantHistoryItem[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !searchOthers) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { searchOthers(query.trim(), controller.signal).then(setOthers, () => {}); }, query ? 200 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, searchOthers]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  const needle = query.trim().toLowerCase();
  const mine = items.filter(item => !needle || item.title.toLowerCase().includes(needle));
  const ids = new Set(items.map(item => item.id));
  const rest = others.filter(item => !ids.has(item.id));
  const row = (item: AssistantHistoryItem, choose: () => void) => <li key={item.id}>
    <button type="button" onClick={() => { setOpen(false); setQuery(""); choose(); }}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-[var(--paper-strong)] ${item.id === activeId ? "bg-[var(--paper-strong)] text-[var(--ink)]" : "text-[var(--ink)]"}`}>
      <span className="min-w-0 flex-1 truncate">{item.title || "New chat"}</span>
      {item.active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--botanical,#578462)]" aria-label="Running" /> : null}
      <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">{shortAge(item.updatedAt)}</span>
    </button>
  </li>;
  return <div ref={box} className="relative flex h-11 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3" data-assistant-header>
    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink-heading,var(--ink))]" title={title}>{title || "New chat"}</p>
    {extra}
    <button type="button" className={iconButton} aria-pressed={starredOpen} onClick={onToggleStarred} title="Starred" aria-label="Starred"><Star size={16} /></button>
    <button type="button" className={iconButton} aria-pressed={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} title="Chat history" aria-label="Chat history"><History size={16} /></button>
    <button type="button" className={iconButton} onClick={onNewChat} disabled={newChatDisabled} title="New chat" aria-label="New chat"><SquarePen size={16} /></button>
    {onClose ? <button type="button" className={iconButton} onClick={onClose} title="Hide" aria-label="Hide assistant"><X size={16} /></button> : null}
    {open ? <div role="dialog" aria-label="Chat history" className="absolute inset-x-2 top-full z-50 mt-1 flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] shadow-[0_12px_32px_rgb(0_0_0/0.28)]">
      <label className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2 text-[var(--ink-muted)]">
        <Search size={14} aria-hidden />
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search recent chats" aria-label="Search recent chats"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--ink-muted)]">{currentLabel}</p>
        {mine.length ? <ul>{mine.map(item => row(item, () => onOpen(item.id)))}</ul>
          : <p className="px-3 py-1.5 text-[12px] text-[var(--ink-muted)]">{needle ? "No matching chats here." : "No chats here yet."}</p>}
        {searchOthers && rest.length ? <>
          <p className="mt-1 border-t border-[var(--line)] px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--ink-muted)]">Other chats</p>
          <ul>{rest.map(item => row(item, () => onOpenOther?.(item)))}</ul>
        </> : null}
      </div>
    </div> : null}
  </div>;
}

/** The centred empty chat: the mark, one line, and up to two suggestions about what is open. */
/** A new chat: one line about what it can do, and the surface's suggestion cards under it. */
export function AssistantEmptyState({ line, cards }: { line: string; cards: ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-5 px-4 py-10 text-center" data-assistant-empty>
    <p className="max-w-[34ch] text-sm leading-6 text-[var(--ink-muted)]">{line}</p>
    <div className="w-full text-left">{cards}</div>
  </div>;
}
