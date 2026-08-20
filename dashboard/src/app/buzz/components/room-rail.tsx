"use client";

// Buzz's app sidebar, built from its own primitives.
//
// The structure is upstream's: a pinned header holding search, a primary menu
// (Inbox / Agents), and the channel sections below it. The menu rows, badges,
// active states and hover treatments all come from the vendored `sidebar.tsx`,
// so this file describes what goes in the rail rather than restyling it.
//
// Upstream pins a profile card to the bottom naming the reader. It is left out
// here: this page is only ever open for the account that is signed in, and the
// rail was spending its quietest corner telling that account its own name.

import { useSyncExternalStore } from "react";
import { Bot, Hash, Inbox, Lock, Plus, Search } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import { isMacPlatform } from "@/app/buzz/lib/platform";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/app/buzz/ui/sidebar";
import { SidebarMenuLabel } from "@/app/buzz/ui/sidebar-menu-label";
import type { BuzzCommunity, BuzzRoomSummary } from "../types.ts";

/** The platform does not change while the page is open. */
const NEVER_CHANGES = () => () => {};

export type RailView = "room" | "inbox" | "agents";

export function RoomRail({
  community,
  rooms,
  activeRoomId,
  view,
  inboxCount,
  agentCount,
  onSelect,
  onCreateRoom,
  onSearch,
  onOpenView,
}: {
  community: BuzzCommunity | null;
  rooms: BuzzRoomSummary[];
  activeRoomId: string | null;
  /** Which of the rail's surfaces the content pane is showing. */
  view: RailView;
  inboxCount: number;
  agentCount: number;
  onSelect: (publicId: string) => void;
  onCreateRoom: () => void;
  onSearch: () => void;
  onOpenView: (view: Exclude<RailView, "room">) => void;
}) {
  // The server has no platform to read, so it renders the Windows label and
  // the client corrects it after hydration. `useSyncExternalStore` is what
  // makes that legal: the server snapshot and the first client snapshot are
  // allowed to differ, where a lazy `useState` initialiser would simply be a
  // hydration mismatch on a Mac.
  const shortcutHint = useSyncExternalStore(
    NEVER_CHANGES,
    () => (isMacPlatform() ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );

  const channels = rooms.filter((room) => room.kind === "channel");
  const directs = rooms.filter((room) => room.kind === "dm");

  const roomRow = (room: BuzzRoomSummary) => {
    const active = view === "room" && room.publicId === activeRoomId;
    const unread = room.unread > 0;
    const Icon = room.visibility === "private" ? Lock : Hash;

    // Upstream's three-state weighting, which is what gives the rail its
    // rhythm: a room with something waiting is bold at full strength, an open
    // room is plain, and every other row sits back at 80% so the two loud
    // states have something quiet to be loud against.
    const restingOpacity = cn(!active && !unread && "opacity-80");

    return (
      <SidebarMenuItem key={room.publicId}>
        <SidebarMenuButton
          isActive={active}
          onClick={() => onSelect(room.publicId)}
          tooltip={room.name}
          type="button"
          className={cn(
            // The base variant bolds the active row; Buzz overrides that so
            // weight means "unread" and never "open".
            "data-[active=true]:font-normal",
            active
              ? "group-hover/menu-item:bg-sidebar-active group-hover/menu-item:text-sidebar-active-foreground"
              : "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-foreground",
            unread &&
              "font-bold text-sidebar-foreground hover:text-sidebar-foreground data-[active=true]:font-bold",
          )}
        >
          <Icon className={cn("h-4 w-4", restingOpacity)} />
          <span
            className={cn("min-w-0 flex-1 truncate", restingOpacity)}
            data-sidebar-row-label
          >
            {room.name}
          </span>
          {unread ? (
            room.kind === "dm" ? (
              // A direct room says how many, because they are all addressed to
              // you. A channel only says that there is something.
              <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-badge font-semibold leading-4 text-primary-foreground">
                {room.unread > 99 ? "99+" : room.unread}
              </span>
            ) : (
              <span
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary"
                data-testid={`channel-unread-dot-${room.slug}`}
              >
                <span className="sr-only">unread</span>
              </span>
            )
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="none" data-testid="app-sidebar" className="w-60 border-0">
      <SidebarHeader className="gap-0 p-0">
        <div
          className="mx-[3px] shrink-0 px-2 pb-2 pt-3"
          data-testid="sidebar-pinned-header"
        >
          <button
            type="button"
            onClick={onSearch}
            data-testid="open-search"
            className="flex h-8 w-full items-center gap-2 rounded-lg bg-sidebar-accent/60 px-2.5 text-left text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">Search everything</span>
            <kbd className="shrink-0 font-mono text-3xs opacity-60">{shortcutHint}</kbd>
          </button>
        </div>

        {/* Upstream also carries a "Projects" row here. It is left out rather
            than drawn dead: this port has no project model behind it, and a
            row that can never do anything is worse than a row that is not
            there. Inbox and Agents both open a real cross-room view. */}
        <SidebarMenu className="sidebar-primary-menu px-2 pb-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              data-testid="rail-inbox"
              isActive={view === "inbox"}
              onClick={() => onOpenView("inbox")}
              tooltip="Inbox"
              type="button"
            >
              <Inbox className="h-4 w-4" />
              <SidebarMenuLabel>Inbox</SidebarMenuLabel>
              {inboxCount > 0 ? (
                <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-badge font-semibold leading-4 text-primary-foreground">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              data-testid="rail-agents"
              isActive={view === "agents"}
              onClick={() => onOpenView("agents")}
              tooltip="Agents"
              type="button"
            >
              <Bot className="h-4 w-4" />
              <SidebarMenuLabel>Agents</SidebarMenuLabel>
              {agentCount > 0 ? (
                <span className="ml-auto shrink-0 text-2xs tabular-nums text-sidebar-foreground/50">
                  {agentCount}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="buzz-sidebar-scrollbar">
        <SidebarGroup>
          <SidebarGroupLabel>{community?.name ?? "Rooms"}</SidebarGroupLabel>
          <SidebarGroupAction
            onClick={onCreateRoom}
            title="New room"
            className="sidebar-section-action"
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">New room</span>
          </SidebarGroupAction>
          <SidebarMenu>{channels.map(roomRow)}</SidebarMenu>
        </SidebarGroup>

        {directs.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Direct messages</SidebarGroupLabel>
            <SidebarMenu>{directs.map(roomRow)}</SidebarMenu>
          </SidebarGroup>
        ) : null}

        {rooms.length === 0 ? (
          <p className="px-4 py-2 text-xs leading-relaxed text-sidebar-foreground/60">
            No rooms here yet. Open one and bring in whoever should be in it —
            people and agents alike.
          </p>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
