"use client";

// The narrow left rail: one tile per community.
//
// A Buzz community is a Breadboard organization, so this is the list of groups
// the account belongs to. It carries the unread badge for the communities the
// reader is *not* looking at, which is the only reason it needs the counts of
// every room rather than the open one.

import { Plus } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/buzz/ui/tooltip";
import type { BuzzCommunity, BuzzRoomSummary } from "../types.ts";

/** Two letters is enough to tell a handful of communities apart at 40px. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function CommunityRail({
  communities,
  rooms,
  activeId,
  onSelect,
  onCreate,
}: {
  communities: BuzzCommunity[];
  rooms: BuzzRoomSummary[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
}) {
  const unreadFor = (organizationId: number) =>
    rooms
      .filter((room) => room.organizationId === organizationId)
      .reduce((total, room) => total + room.unread, 0);

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        data-testid="community-rail"
        className="bg-sidebar flex w-[68px] shrink-0 flex-col items-center gap-2 py-3"
        aria-label="Communities"
      >
        {communities.map((community) => {
          const active = community.id === activeId;
          const unread = unreadFor(community.id);
          return (
            <Tooltip key={community.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSelect(community.id)}
                  data-active={active ? "true" : undefined}
                  className={cn(
                    "relative flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold transition-all",
                    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-sidebar-active text-sidebar-active-foreground rounded-xl"
                      : "bg-sidebar-accent text-sidebar-accent-foreground hover:rounded-xl hover:bg-primary/20",
                  )}
                  aria-current={active ? "true" : undefined}
                >
                  {initials(community.name)}
                  {unread > 0 && !active ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-badge font-semibold leading-4 text-primary-foreground"
                      aria-label={`${unread} unread`}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                  {/* The pill upstream draws against the rail edge for the
                      selected community. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -left-2.5 h-5 w-1 rounded-full bg-sidebar-foreground transition-all",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{community.name}</TooltipContent>
            </Tooltip>
          );
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onCreate}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-primary/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label="New community"
            >
              <Plus className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New community</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
}
