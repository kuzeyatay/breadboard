"use client";

// "Search everything", and the ⌘K that opens it.
//
// It searches on the server rather than filtering the rails, because the rails
// only hold the rooms this session has loaded: a palette that could not find an
// archived room, or a line said in a room you have not opened, would be a
// search that quietly lies about what it looked at.

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Hash, Lock, MessagesSquare, Search } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import { Dialog, DialogContent, DialogTitle } from "@/app/buzz/ui/dialog";
import type { BuzzMessageHit, BuzzSearchRoom } from "../types.ts";

type Result =
  | { kind: "room"; room: BuzzSearchRoom }
  | { kind: "message"; hit: BuzzMessageHit };

/** The line around the match, with the match itself marked. */
function Excerpt({ body, query }: { body: string; query: string }) {
  const index = body.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1 || query === "") {
    return <span className="truncate">{body.slice(0, 160)}</span>;
  }
  const start = Math.max(0, index - 32);
  return (
    <span className="truncate">
      {start > 0 ? "…" : ""}
      {body.slice(start, index)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {body.slice(index, index + query.length)}
      </mark>
      {body.slice(index + query.length, index + query.length + 96)}
    </span>
  );
}

export function SearchPalette({
  open,
  onOpenChange,
  onOpenRoom,
  onOpenMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenRoom: (publicId: string, organizationId: number) => void;
  /** A hit on a thread reply opens the room and then the thread. */
  onOpenMessage: (hit: BuzzMessageHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [rooms, setRooms] = useState<BuzzSearchRoom[]>([]);
  const [messages, setMessages] = useState<BuzzMessageHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlighted(0);
  }, [open]);

  // Debounced, and every response is checked against the query that is current
  // by the time it lands — typing fast used to paint the results of a prefix.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/buzz/search?q=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          query: string;
          rooms: BuzzSearchRoom[];
          messages: BuzzMessageHit[];
        };
        if (cancelled || body.query !== query.trim()) return;
        setRooms(body.rooms);
        setMessages(body.messages);
        setHighlighted(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query === "" ? 0 : 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const results = useMemo<Result[]>(
    () => [
      ...rooms.map((room) => ({ kind: "room" as const, room })),
      ...messages.map((hit) => ({ kind: "message" as const, hit })),
    ],
    [rooms, messages],
  );

  const choose = (result: Result) => {
    if (result.kind === "room") {
      onOpenRoom(result.room.publicId, result.room.organizationId);
    } else {
      onOpenMessage(result.hit);
    }
    onOpenChange(false);
  };

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search everything</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((current) =>
                  results.length === 0 ? 0 : (current + 1) % results.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((current) =>
                  results.length === 0
                    ? 0
                    : (current - 1 + results.length) % results.length,
                );
              } else if (event.key === "Enter") {
                const result = results[highlighted];
                if (result) {
                  event.preventDefault();
                  choose(result);
                }
              }
            }}
            placeholder="Search rooms and messages…"
            className="h-6 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded border border-border/60 px-1 font-mono text-3xs text-muted-foreground">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          className="buzz-content-scrollbar max-h-[min(60vh,26rem)] min-h-24 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {loading
                ? "Looking…"
                : query.trim() === ""
                  ? "Type to search every room you can open."
                  : `Nothing matching “${query.trim()}”.`}
            </p>
          ) : null}

          {rooms.length > 0 ? <GroupLabel>Rooms</GroupLabel> : null}
          {results.map((result, index) => {
            const active = index === highlighted;
            if (result.kind === "room") {
              const room = result.room;
              const Icon =
                room.kind === "dm"
                  ? MessagesSquare
                  : room.visibility === "private"
                    ? Lock
                    : Hash;
              return (
                <Row
                  key={`room-${room.publicId}`}
                  active={active}
                  onHover={() => setHighlighted(index)}
                  onSelect={() => choose(result)}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{room.name}</span>
                  {room.topic ? (
                    <span className="truncate text-2xs text-muted-foreground">
                      {room.topic}
                    </span>
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {room.archived ? (
                      <span className="rounded bg-muted px-1 text-3xs uppercase tracking-wide text-muted-foreground">
                        archived
                      </span>
                    ) : null}
                    {room.unread > 0 ? (
                      <span className="rounded-full bg-primary px-1.5 text-badge font-semibold leading-4 text-primary-foreground">
                        {room.unread > 99 ? "99+" : room.unread}
                      </span>
                    ) : null}
                    {active ? (
                      <CornerDownLeft className="size-3 text-muted-foreground" />
                    ) : null}
                  </span>
                </Row>
              );
            }

            const hit = result.hit;
            const first = index === rooms.length;
            return (
              <div key={`msg-${hit.message.id}`}>
                {first ? <GroupLabel>Messages</GroupLabel> : null}
                <Row
                  active={active}
                  onHover={() => setHighlighted(index)}
                  onSelect={() => choose(result)}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 text-3xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">
                        {hit.message.authorName}
                      </span>
                      <span>in #{hit.roomSlug}</span>
                      {hit.mentionsYou ? (
                        <span className="rounded bg-primary/20 px-1 font-semibold text-primary">
                          mentions you
                        </span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 text-2xs text-muted-foreground">
                      <Excerpt body={hit.message.body} query={query.trim()} />
                    </span>
                  </span>
                  {active ? (
                    <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" />
                  ) : null}
                </Row>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-1.5 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function Row({
  active,
  onHover,
  onSelect,
  children,
}: {
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-highlighted={active ? "true" : undefined}
      onMouseMove={onHover}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
