"use client";

// The two rail entries that read across rooms instead of inside one.
//
// Inbox and Agents replace the transcript rather than opening beside it: both
// answer a question about every room at once ("what is waiting", "who is
// seated where"), and a column of cross-room rows next to one room's spine
// reads as a second, competing transcript.

import { useCallback, useEffect, useState } from "react";
import { Bot, Hash, Inbox, MessagesSquare, RefreshCw } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import type { BuzzAgentSeat, BuzzMessageHit, BuzzRespondTo } from "../types.ts";

const RESPOND_LABELS: Record<BuzzRespondTo, string> = {
  always: "Always",
  mention: "Mentions",
  never: "Never",
};

const RESPOND_TITLES: Record<BuzzRespondTo, string> = {
  always: "Answers every message in this room",
  mention: "Answers when someone names it by handle",
  never: "Stays quiet unless asked directly",
};

export interface RailViewData {
  unread: BuzzMessageHit[];
  agents: BuzzAgentSeat[];
}

/**
 * One read for both views, refreshed while either is open.
 *
 * They share a request because they share an endpoint: reading them apart lets
 * the two disagree about a room that changed between the calls.
 */
export function useRailViews(active: boolean) {
  const [data, setData] = useState<RailViewData>({ unread: [], agents: [] });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/buzz/inbox", { cache: "no-store" });
      if (!response.ok) return;
      setData((await response.json()) as RailViewData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => void load(), 12000);
    return () => clearInterval(timer);
  }, [active, load]);

  return { ...data, loading, refresh: load };
}

function ViewHeader({
  title,
  count,
  loading,
  onRefresh,
}: {
  title: string;
  count: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="mx-auto flex h-14 w-full max-w-3xl shrink-0 items-center gap-2 px-2">
      <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
      <span className="text-2xs tabular-nums text-muted-foreground">{count}</span>
      <button
        type="button"
        onClick={onRefresh}
        aria-label={`Refresh ${title.toLowerCase()}`}
        className="ml-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      </button>
    </header>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Inbox;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function clockTime(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function InboxView({
  unread,
  loading,
  onRefresh,
  onOpen,
}: {
  unread: BuzzMessageHit[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (hit: BuzzMessageHit) => void;
}) {
  // Mentions first: in a busy community the line that names you is the one
  // thing an inbox exists to surface, and it would otherwise sink under
  // whatever a chatty room posted after it.
  const mentions = unread.filter((hit) => hit.mentionsYou);
  const rest = unread.filter((hit) => !hit.mentionsYou);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        title="Inbox"
        count={unread.length}
        loading={loading}
        onRefresh={onRefresh}
      />
      {unread.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting"
          body="Everything in your rooms has been read. New messages from other people and their agents land here."
        />
      ) : (
        <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <div className="mx-auto w-full max-w-3xl">
          {mentions.length > 0 ? (
            <>
              <SectionLabel>Mentions you — {mentions.length}</SectionLabel>
              {mentions.map((hit) => (
                <InboxRow key={hit.message.id} hit={hit} onOpen={onOpen} />
              ))}
            </>
          ) : null}
          {rest.length > 0 ? (
            <>
              <SectionLabel>Unread — {rest.length}</SectionLabel>
              {rest.map((hit) => (
                <InboxRow key={hit.message.id} hit={hit} onOpen={onOpen} />
              ))}
            </>
          ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-3 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function InboxRow({
  hit,
  onOpen,
}: {
  hit: BuzzMessageHit;
  onOpen: (hit: BuzzMessageHit) => void;
}) {
  const Icon = hit.roomKind === "dm" ? MessagesSquare : Hash;
  return (
    <button
      type="button"
      onClick={() => onOpen(hit)}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60",
        hit.mentionsYou && "bg-primary/5",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold">
            {hit.message.authorName}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground">
            <Icon className="size-3" />
            {hit.roomSlug}
          </span>
          <span className="ml-auto shrink-0 text-3xs text-muted-foreground">
            {clockTime(hit.message.createdAt)}
          </span>
        </span>
        <span className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
          {hit.message.body || "…"}
        </span>
      </span>
    </button>
  );
}

export function AgentsView({
  agents,
  loading,
  onRefresh,
  onOpenRoom,
  onRespondToChange,
}: {
  agents: BuzzAgentSeat[];
  loading: boolean;
  onRefresh: () => void;
  onOpenRoom: (publicId: string, organizationId: number) => void;
  onRespondToChange: (
    seat: BuzzAgentSeat,
    respondTo: BuzzRespondTo,
  ) => void | Promise<void>;
}) {
  // Grouped by agent rather than by room: the question this view answers is
  // "where does this specialist speak, and how loudly", and one persona seated
  // in five rooms is one line of thinking, not five.
  const byHandle = new Map<string, BuzzAgentSeat[]>();
  for (const seat of agents) {
    const list = byHandle.get(seat.member.handle) ?? [];
    list.push(seat);
    byHandle.set(seat.member.handle, list);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        title="Agents"
        count={byHandle.size}
        loading={loading}
        onRefresh={onRefresh}
      />
      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents seated yet"
          body="Open a room, add a specialist from the members panel, and it will appear here with every room it sits in."
        />
      ) : (
        <div className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
          <div className="mx-auto w-full max-w-3xl">
          {[...byHandle.entries()].map(([handle, seats]) => (
            <div key={handle} className="mb-2 rounded-xl px-2 py-2 hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {seats[0].member.displayName}
                  </span>
                  <span className="block truncate text-3xs text-muted-foreground">
                    @{handle} · {seats.length}{" "}
                    {seats.length === 1 ? "room" : "rooms"}
                  </span>
                </span>
              </div>

              <div className="mt-1.5 flex flex-col gap-1 pl-9">
                {seats.map((seat) => (
                  <div
                    key={`${seat.roomPublicId}-${seat.member.id}`}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onOpenRoom(seat.roomPublicId, seat.organizationId)
                      }
                      className="flex items-center gap-1 rounded-md px-1 py-0.5 text-2xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <Hash className="size-3" />
                      {seat.roomSlug}
                    </button>
                    <span className="flex flex-wrap gap-1">
                      {(Object.keys(RESPOND_LABELS) as BuzzRespondTo[]).map(
                        (option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => void onRespondToChange(seat, option)}
                            title={RESPOND_TITLES[option]}
                            className={cn(
                              "rounded-full border px-1.5 py-0.5 text-3xs transition-colors",
                              seat.member.respondTo === option
                                ? "border-primary/60 bg-primary/15 text-foreground"
                                : "border-border/50 text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {RESPOND_LABELS[option]}
                          </button>
                        ),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
