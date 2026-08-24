"use client";

// The Buzz page.
//
// Layout follows the desktop app: a community rail, the room rail, then one
// rounded content card holding the room itself and — inside the same card — an
// auxiliary panel that shows either the member list or an open thread. Never
// both, because at this width two right-hand panels squeeze the transcript
// into a column nobody can read.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Hash, Lock, MessagesSquare, SlidersHorizontal, Users } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
import { hasPrimaryShortcutModifier } from "@/app/buzz/lib/platform";
import { BuzzThemeProvider, useTheme } from "@/app/buzz/lib/theme";
import { SidebarProvider } from "@/app/buzz/ui/sidebar";
import { CommunityRail } from "./components/community-rail";
import { Composer } from "./components/composer";
import { MembersPanel, type AddPersonOutcome } from "./components/members-panel";
import { MessageRow } from "./components/message-row";
import { AgentsView, InboxView, useRailViews } from "./components/rail-views";
import {
  NewCommunityDialog,
  NewRoomDialog,
  RoomSettingsDialog,
  type NewRoomValues,
  type RoomSettingsValues,
} from "./components/room-dialogs";
import { RoomRail, type RailView } from "./components/room-rail";
import { SearchPalette } from "./components/search-palette";
import { ThreadPanel } from "./components/thread-panel";
import { useRoom } from "./use-room";
import type {
  BuzzCommunity,
  BuzzInvite,
  BuzzMessage,
  BuzzMessageHit,
  BuzzPersona,
  BuzzRespondTo,
  BuzzRoomSummary,
} from "./types.ts";

export type { BuzzCommunity, BuzzPersona, BuzzRoomSummary } from "./types.ts";

/** Messages this close together from one member are drawn as one block. */
const GROUPING_WINDOW_MS = 5 * 60 * 1000;

function parseStamp(iso: string): number {
  const value = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(value) ? 0 : value;
}

/** The message an API error carries, or a sentence that says what failed. */
async function failureMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  return body?.message ?? fallback;
}

export default function BuzzClient(props: {
  selfUserId: number;
  communities: BuzzCommunity[];
  rooms: BuzzRoomSummary[];
  personas: BuzzPersona[];
  rosterReady: boolean;
  initialRoomId?: string | null;
  initialThreadRootId?: number | null;
}) {
  // The provider wraps the workspace rather than sitting inside it: the root
  // element carries the `dark` class the vendored stylesheet keys its palette
  // on, so whatever renders that element has to be able to read the theme.
  return (
    <BuzzThemeProvider>
      <SidebarProvider className="buzz-host-shell">
        <BuzzWorkspace {...props} />
      </SidebarProvider>
    </BuzzThemeProvider>
  );
}

function BuzzWorkspace({
  communities: initialCommunities,
  rooms: initialRooms,
  personas,
  rosterReady,
  initialRoomId,
  initialThreadRootId,
}: {
  selfUserId: number;
  communities: BuzzCommunity[];
  rooms: BuzzRoomSummary[];
  personas: BuzzPersona[];
  rosterReady: boolean;
  initialRoomId?: string | null;
  initialThreadRootId?: number | null;
}) {
  const { isDark } = useTheme();
  const [communities, setCommunities] = useState(initialCommunities);
  const [rooms, setRooms] = useState(initialRooms);
  const requestedRoom = initialRooms.find((room) => room.publicId === initialRoomId);
  const [communityId, setCommunityId] = useState<number | null>(
    requestedRoom?.organizationId ?? initialCommunities[0]?.id ?? null,
  );
  const [roomId, setRoomId] = useState<string | null>(
    requestedRoom?.publicId ??
      initialRooms.find((room) => room.organizationId === initialCommunities[0]?.id)
        ?.publicId ?? null,
  );
  const [threadRootId, setThreadRootId] = useState<number | null>(
    requestedRoom ? initialThreadRootId ?? null : null,
  );
  const [showMembers, setShowMembers] = useState(!initialThreadRootId);
  const [view, setView] = useState<RailView>("room");

  // Every control that used to call `window.prompt` opens one of these. Radix
  // portals their content to `document.body`, which is why the effect below
  // puts Buzz's palette on `body` as well as on this element.
  const [searchOpen, setSearchOpen] = useState(false);
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [newCommunityOpen, setNewCommunityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const room = useRoom(view === "room" ? roomId : null);
  const railViews = useRailViews(view !== "room");

  const community = communities.find((entry) => entry.id === communityId) ?? null;
  const communityRooms = useMemo(
    () => rooms.filter((entry) => entry.organizationId === communityId),
    [rooms, communityId],
  );
  const activeRoom = rooms.find((entry) => entry.publicId === roomId) ?? null;

  /** Re-read the rails — room list, unread badges, community membership. */
  const refreshRails = useCallback(async () => {
    const response = await fetch("/api/buzz/rooms", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as {
      organizations: BuzzCommunity[];
      rooms: BuzzRoomSummary[];
    };
    setCommunities(body.organizations);
    setRooms(body.rooms);
  }, []);

  // Badges have to move for rooms the reader is not looking at, so the rails
  // refresh on their own rather than only when a room is opened.
  useEffect(() => {
    const timer = setInterval(() => void refreshRails(), 15000);
    return () => clearInterval(timer);
  }, [refreshRails]);

  /*
   * Buzz's tokens live on `.buzz-root`, and Radix portals every dialog,
   * popover, tooltip and menu into `document.body` — outside it. Painted
   * against Breadboard's palette those surfaces came out with no fill and no
   * ink at all, which is what made the search palette and the emoji picker
   * look broken rather than merely mis-themed.
   *
   * The page owns its whole tab, so the palette is put on `body` too and the
   * portals inherit it. Removed on unmount: Buzz's colours must not follow the
   * reader to the next page.
   */
  useEffect(() => {
    const { body } = document;
    body.classList.add("buzz-root");
    body.setAttribute("data-buzz-sidebar", "");
    return () => {
      body.classList.remove("buzz-root", "dark");
      body.removeAttribute("data-buzz-sidebar");
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark", isDark);
  }, [isDark]);

  // ⌘K / Ctrl-K opens search from anywhere on the page, including from inside
  // the composer — which is where someone is when they think of a search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && hasPrimaryShortcutModifier(event)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Switching community lands in one of its rooms rather than on nothing.
  useEffect(() => {
    if (!communityId) return;
    if (activeRoom?.organizationId === communityId) return;
    setRoomId(communityRooms[0]?.publicId ?? null);
    setThreadRootId(null);
  }, [communityId, communityRooms, activeRoom?.organizationId]);

  /** Open a room by id, following it into its community if need be. */
  const openRoom = useCallback(
    (publicId: string, organizationId?: number) => {
      if (organizationId !== undefined) setCommunityId(organizationId);
      setRoomId(publicId);
      setThreadRootId(null);
      setView("room");
    },
    [],
  );

  const createCommunity = async (name: string) => {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        setDialogError(await failureMessage(response, "That community could not be created."));
        return;
      }
      await refreshRails();
      setNewCommunityOpen(false);
    } finally {
      setDialogBusy(false);
    }
  };

  const createRoom = async (values: NewRoomValues) => {
    if (!communityId) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      const response = await fetch("/api/buzz/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, organizationId: communityId }),
      });
      if (!response.ok) {
        setDialogError(await failureMessage(response, "That room could not be opened."));
        return;
      }
      // The room exists by now whatever the body looks like, so the dialog
      // closes and the rails re-read either way; only the jump into the new
      // room depends on the response naming it.
      const body = (await response.json().catch(() => null)) as
        | { room?: { publicId?: string } }
        | null;
      setNewRoomOpen(false);
      await refreshRails();
      if (body?.room?.publicId) openRoom(body.room.publicId);
    } finally {
      setDialogBusy(false);
    }
  };

  const saveRoom = async (values: RoomSettingsValues) => {
    if (!roomId) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      const response = await fetch(`/api/buzz/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        setDialogError(await failureMessage(response, "Those changes could not be saved."));
        return;
      }
      await Promise.all([refreshRails(), room.refresh()]);
      setSettingsOpen(false);
    } finally {
      setDialogBusy(false);
    }
  };

  const archiveRoom = async (archived: boolean) => {
    if (!roomId) return;
    setDialogBusy(true);
    try {
      await fetch(`/api/buzz/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      await refreshRails();
      setSettingsOpen(false);
      // An archived room leaves the rail, so staying in it would leave the
      // reader looking at a transcript nothing selects any more.
      if (archived) setRoomId(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const deleteRoom = async () => {
    if (!roomId) return;
    setDialogBusy(true);
    try {
      await fetch(`/api/buzz/rooms/${roomId}`, { method: "DELETE" });
      setRoomId(null);
      setThreadRootId(null);
      setSettingsOpen(false);
      await refreshRails();
    } finally {
      setDialogBusy(false);
    }
  };

  /**
   * Add an agent, or offer a person a place in the room.
   *
   * Answers what happened rather than nothing, because the two person-shaped
   * outcomes differ: a colleague already in the community is seated (201),
   * while anybody else is only invited to it (202) and no member row appears
   * until they accept. The panel has to be able to say which.
   */
  const addMember = async (
    payload: Record<string, unknown>,
  ): Promise<AddPersonOutcome> => {
    if (!roomId) return { kind: "failed", message: "No room is open." };
    const response = await fetch(`/api/buzz/rooms/${roomId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        kind: "failed",
        message: await failureMessage(response, "They could not be added."),
      };
    }
    const body = (await response.json().catch(() => null)) as {
      invited?: { username?: string; community?: string };
    } | null;
    if (body?.invited) {
      return {
        kind: "invited",
        username: body.invited.username ?? "them",
        community: body.invited.community ?? "this community",
      };
    }
    await room.refresh();
    await refreshRails();
    return { kind: "seated" };
  };

  const setRespondTo = async (
    targetRoomId: string,
    memberId: number,
    respondTo: BuzzRespondTo,
  ) => {
    await fetch(`/api/buzz/rooms/${targetRoomId}/members/${memberId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ respondTo }),
    });
  };

  const removeMember = async (memberId: number) => {
    if (!roomId) return;
    await fetch(`/api/buzz/rooms/${roomId}/members/${memberId}`, { method: "DELETE" });
    await room.refresh();
    await refreshRails();
  };

  /** Jump from a cross-room row to the message it names. */
  const openHit = (hit: BuzzMessageHit) => {
    openRoom(hit.roomPublicId, hit.organizationId);
    if (hit.message.parentId !== null) {
      setThreadRootId(hit.message.parentId);
      setShowMembers(false);
    }
  };

  /**
   * Answer a community invitation from the inbox.
   *
   * Accepting changes which rooms exist for this reader, so the rails are
   * re-read rather than patched: the whole left-hand side of the page is
   * different afterwards, and reconstructing that from one invite id would
   * only be a slower way of asking the server the same question.
   */
  const respondToInvite = async (invite: BuzzInvite, accept: boolean) => {
    const response = await fetch("/api/organizations/invites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteId: invite.id, accept }),
    });
    if (!response.ok) return;
    await Promise.all([railViews.refresh(), accept ? refreshRails() : null]);
  };

  const unreadTotal = rooms.reduce((total, entry) => total + entry.unread, 0);

  return (
    <div
      className={cn(
        "buzz-root relative flex h-full w-full overflow-hidden text-buzz-foreground",
        isDark && "dark",
      )}
      // `data-buzz-sidebar` selects Buzz's opaque gradient. Its sibling
      // `data-glass-background` is the translucent variant meant for a
      // vibrancy-backed window: it paints the wash at 70% and lets whatever is
      // behind show through, which here is Breadboard's own body — dark on a
      // dark-themed account — and turned Buzz's cream into a muddy olive.
      data-buzz-sidebar
    >
      {/* Buzz's signature background: a gradient underlay behind everything,
          with the light and dark layers cross-faded by the theme. This is the
          cream-to-slate wash the app is recognisable by, so it sits behind the
          rails rather than only behind the transcript. */}
      <div
        aria-hidden="true"
        className="buzz-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
        data-buzz-gradient-layer
      >
        <div className="buzz-theme-gradient-underlay absolute inset-0" />
        <div
          className="buzz-theme-gradient-layer-light absolute inset-0 opacity-0"
          data-buzz-gradient="light"
        />
        <div
          className="buzz-theme-gradient-layer-dark absolute inset-0 opacity-0"
          data-buzz-gradient="dark"
        />
      </div>

      {communities.length === 0 ? (
        <NoCommunity onCreate={() => setNewCommunityOpen(true)} />
      ) : (
        <>
          <CommunityRail
            communities={communities}
            rooms={rooms}
            activeId={communityId}
            onSelect={setCommunityId}
            onCreate={() => {
              setDialogError(null);
              setNewCommunityOpen(true);
            }}
          />
          <RoomRail
            community={community}
            rooms={communityRooms}
            activeRoomId={roomId}
            view={view}
            inboxCount={unreadTotal}
            agentCount={
              new Set(
                communityRooms.flatMap((entry) => entry.agentHandles),
              ).size
            }
            onSelect={(next) => openRoom(next)}
            onCreateRoom={() => {
              setDialogError(null);
              setNewRoomOpen(true);
            }}
            onSearch={() => setSearchOpen(true)}
            onOpenView={setView}
          />

          <div
            data-buzz-content-surface
            className="relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-buzz-background shadow-content-edge"
          >
            <div className="buzz-content-primary flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {view === "inbox" ? (
                <InboxView
                  unread={railViews.unread}
                  invites={railViews.invites}
                  loading={railViews.loading}
                  onRefresh={() => void railViews.refresh()}
                  onOpen={openHit}
                  onRespondToInvite={respondToInvite}
                />
              ) : view === "agents" ? (
                <AgentsView
                  agents={railViews.agents}
                  loading={railViews.loading}
                  onRefresh={() => void railViews.refresh()}
                  onOpenRoom={openRoom}
                  onRespondToChange={async (seat, respondTo) => {
                    await setRespondTo(seat.roomPublicId, seat.member.id, respondTo);
                    await railViews.refresh();
                  }}
                />
              ) : activeRoom ? (
                <>
                  <RoomHeader
                    room={activeRoom}
                    memberCount={room.members.length}
                    membersOpen={showMembers && threadRootId === null}
                    onToggleMembers={() => {
                      setShowMembers((current) => !(current && threadRootId === null));
                      setThreadRootId(null);
                    }}
                    onOpenSettings={() => {
                      setDialogError(null);
                      setSettingsOpen(true);
                    }}
                  />

                  <Transcript
                    messages={room.messages}
                    members={room.members}
                    selfMemberId={room.selfMemberId}
                    loading={room.loading}
                    error={room.error}
                    roomName={activeRoom.name}
                    onOpenThread={(id) => {
                      setThreadRootId(id);
                      setShowMembers(false);
                    }}
                    onReact={room.react}
                    onDelete={room.remove}
                    onEdit={room.edit}
                  />

                  <Composer
                    members={room.members}
                    autoFocus
                    placeholder={`Message #${activeRoom.slug}`}
                    onSend={(body) => void room.send(body)}
                  />
                </>
              ) : (
                <EmptyRoom onCreateRoom={() => setNewRoomOpen(true)} />
              )}
            </div>

            {/* The auxiliary panel lives inside the card, as upstream's does.
                Outside it, its square left edge butted against the card's
                rounded one and painted a second, differently-toned surface —
                the seam that made the page look assembled from two apps. */}
            {view === "room" && threadRootId !== null && roomId ? (
              <ThreadPanel
                key={threadRootId}
                roomPublicId={roomId}
                rootId={threadRootId}
                members={room.members}
                selfMemberId={room.selfMemberId}
                onClose={() => setThreadRootId(null)}
                onChanged={() => void room.refresh()}
              />
            ) : view === "room" && showMembers && activeRoom ? (
              <MembersPanel
                members={room.members}
                personas={personas}
                roomPublicId={roomId}
                rosterReady={rosterReady}
                onClose={() => setShowMembers(false)}
                onAddPersona={(slug) => void addMember({ personaSlug: slug })}
                onAddPerson={(userId) => addMember({ userId })}
                onRemove={(memberId) => void removeMember(memberId)}
                onRespondToChange={(memberId, respondTo) => {
                  if (!roomId) return;
                  void setRespondTo(roomId, memberId, respondTo).then(() =>
                    room.refresh(),
                  );
                }}
              />
            ) : null}
          </div>
        </>
      )}

      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenRoom={openRoom}
        onOpenMessage={openHit}
      />
      <NewRoomDialog
        open={newRoomOpen}
        communityName={community?.name ?? "this community"}
        busy={dialogBusy}
        error={dialogError}
        onOpenChange={(open) => {
          setNewRoomOpen(open);
          if (!open) setDialogError(null);
        }}
        onSubmit={(values) => void createRoom(values)}
      />
      <NewCommunityDialog
        open={newCommunityOpen}
        busy={dialogBusy}
        error={dialogError}
        onOpenChange={(open) => {
          setNewCommunityOpen(open);
          if (!open) setDialogError(null);
        }}
        onSubmit={(name) => void createCommunity(name)}
      />
      <RoomSettingsDialog
        open={settingsOpen}
        room={activeRoom}
        busy={dialogBusy}
        error={dialogError}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setDialogError(null);
        }}
        onSave={(values) => void saveRoom(values)}
        onArchive={(archived) => void archiveRoom(archived)}
        onDelete={() => void deleteRoom()}
      />
    </div>
  );
}

function RoomHeader({
  room,
  memberCount,
  membersOpen,
  onToggleMembers,
  onOpenSettings,
}: {
  room: BuzzRoomSummary;
  memberCount: number;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onOpenSettings: () => void;
}) {
  const Icon =
    room.kind === "dm" ? MessagesSquare : room.visibility === "private" ? Lock : Hash;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 px-4">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold leading-tight">{room.name}</h2>
        {room.topic ? (
          <p className="truncate text-2xs text-muted-foreground">{room.topic}</p>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleMembers}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-2xs transition-colors",
            membersOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          aria-pressed={membersOpen}
        >
          <Users className="size-3.5" />
          <span className="tabular-nums">{memberCount}</span>
        </button>
        {/* Huddles need the relay's voice transport, which this port does not
            have. The control stays in place, and says so, rather than being
            removed and quietly changing the room's chrome. */}
        <button
          type="button"
          disabled
          title="Huddles need Buzz's own voice transport, which this port does not carry"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground opacity-40"
          aria-label="Huddle (unavailable)"
        >
          <Headphones className="size-4" />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          data-testid="room-settings"
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Room settings"
          title="Room settings"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </div>
    </header>
  );
}

function Transcript({
  messages,
  members,
  selfMemberId,
  loading,
  error,
  roomName,
  onOpenThread,
  onReact,
  onDelete,
  onEdit,
}: {
  messages: BuzzMessage[];
  members: ReturnType<typeof useRoom>["members"];
  selfMemberId: number | null;
  loading: boolean;
  error: string | null;
  roomName: string;
  onOpenThread: (id: number) => void;
  onReact: (id: number, emoji: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onEdit: (id: number, body: string) => Promise<void>;
}) {
  // Pin to the bottom while the reader is already near it, so an arriving
  // answer follows the eye — but never yank someone who has scrolled up to
  // read back.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 240) element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scroller}
      /*
       * `pt-5` is for the first row, not for looks. A row's action bar floats
       * at `-top-3`, outside the row's own box; on the very first message that
       * put it under the room header, where it was clipped and unclickable.
       * The padding is the space that bar needs to live in.
       */
      className="buzz-content-scrollbar min-h-0 flex-1 overflow-y-auto pb-3 pt-5"
    >
      {error ? (
        <p className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {loading && messages.length === 0 ? (
        <p className="px-4 py-6 text-xs text-muted-foreground">Opening the room…</p>
      ) : null}

      {!loading && messages.length === 0 && !error ? (
        <div className="px-6 py-10">
          <p className="text-base font-semibold">This is the start of #{roomName}.</p>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Say something, or bring someone in from the members panel. Mention an
            agent by handle and it will answer here, in front of everyone.
          </p>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const grouped =
          previous !== undefined &&
          previous.memberId === message.memberId &&
          previous.authorKind === message.authorKind &&
          previous.deletedAt === null &&
          parseStamp(message.createdAt) - parseStamp(previous.createdAt) <
            GROUPING_WINDOW_MS;

        return (
          <MessageRow
            key={message.clientMessageId}
            message={message}
            member={members.find((member) => member.id === message.memberId)}
            roomMembers={members}
            grouped={grouped}
            isSelf={message.memberId === selfMemberId}
            onReact={(emoji) => void onReact(message.id, emoji)}
            onOpenThread={() => onOpenThread(message.id)}
            onDelete={() => void onDelete(message.id)}
            onEdit={(body) => void onEdit(message.id, body)}
          />
        );
      })}
    </div>
  );
}

function EmptyRoom({ onCreateRoom }: { onCreateRoom: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-base font-semibold">No room open</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        Rooms in this community will appear on the left. Open one to start.
      </p>
      <button
        type="button"
        onClick={onCreateRoom}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        New room
      </button>
    </div>
  );
}

function NoCommunity({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-semibold">Buzz needs a community</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
        Rooms belong to a community, so that the people in it and their agents
        share one place to talk. A community is a Breadboard organization — make
        one here, and its rooms are yours and your agents&rsquo; to work in.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Create a community
      </button>
    </div>
  );
}
