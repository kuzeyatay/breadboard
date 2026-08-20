import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import { listOrganizations } from "@/lib/organizations/store.ts";
import {
  createRoom,
  ensureSelfMember,
  listMembers,
  listRooms,
  listRoomsForUser,
  listSpineMessages,
  unreadCounts,
} from "@/lib/buzz/instance.ts";
import { buzzThreadNodeId } from "@/lib/profile/brain-graph-ids.ts";
import BuzzClient, {
  type BuzzCommunity,
  type BuzzPersona,
  type BuzzRoomSummary,
} from "./buzz-client";

export const dynamic = "force-dynamic";

/**
 * Buzz opens in its own tab from the navbar, so — like Plan — it renders its
 * own shell rather than the dashboard's.
 *
 * A Buzz community is a Breadboard organization: rooms belong to one, and
 * anyone in it can walk into its public rooms. The rail, the rooms and the
 * roster are all read here so the first paint is the real page — a chat
 * surface that flashes empty and then fills in reads as broken even when it is
 * fast.
 */
export default async function BuzzPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string | string[]; thread?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/buzz");

  const user = session.user as {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
  const userId = Number(user.id);
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "you";

  const organizations = listOrganizations(userId);
  const communities: BuzzCommunity[] = organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    role: organization.role,
    people: organization.members.map((member) => ({
      userId: member.userId,
      username: member.username,
    })),
  }));

  // Without a community there is nowhere for a room to live. The client shows
  // the way to make one rather than this page inventing an organization on
  // someone's behalf — an organization is shared state, and creating it
  // silently would change what other pages show.
  if (communities.length > 0) {
    const first = communities[0];
    if (listRooms(first.id).length === 0) {
      createRoom(first.id, userId, {
        name: "general",
        topic: "Everything that does not have a room yet.",
      });
    }
  }

  const readableRooms = listRoomsForUser(userId);
  const unread = unreadCounts(userId);
  const rooms: BuzzRoomSummary[] = readableRooms.map((room) => {
    const members = listMembers(room.id);
    return {
      publicId: room.publicId,
      organizationId: room.organizationId,
      slug: room.slug,
      name: room.name,
      topic: room.topic,
      kind: room.kind,
      visibility: room.visibility,
      archived: room.archivedAt !== null,
      unread: unread.get(room.id) ?? 0,
      memberCount: members.length,
      agentHandles: members
        .filter((member) => member.kind === "agent")
        .map((member) => member.handle),
      peopleHandles: members
        .filter((member) => member.kind === "human")
        .map((member) => member.handle),
    };
  });

  // The reader needs a member row in whichever room opens first; reactions and
  // read state are keyed to one.
  const requested = await searchParams;
  const requestedRoom = Array.isArray(requested.room) ? requested.room[0] : requested.room;
  const requestedThread = Array.isArray(requested.thread)
    ? requested.thread[0]
    : requested.thread;
  // Resolve opaque deep links only after the normal Buzz room authorization
  // filter. Missing, forged, private, and revoked targets all fall back to the
  // first readable room without revealing which case occurred.
  const opening =
    readableRooms.find((room) => room.publicId === requestedRoom) ?? readableRooms[0];
  if (opening) ensureSelfMember(opening.id, userId, displayName);
  const initialThreadRootId =
    opening && requestedThread
      ? (listSpineMessages(opening.id).find(
          (message) =>
            buzzThreadNodeId(opening.publicId, message.id) === requestedThread,
        )?.id ?? null)
      : null;

  const catalog = loadAgencyAgentsCatalog();
  const personas: BuzzPersona[] = catalog.agents.map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    division: agent.divisionLabel,
    divisionColor: agent.divisionColor,
    color: agent.color ?? agent.divisionColor,
    emoji: agent.emoji ?? "",
  }));

  return (
    <BuzzClient
      selfUserId={userId}
      communities={communities}
      rooms={rooms}
      personas={personas}
      rosterReady={catalog.status === "ready"}
      initialRoomId={opening?.publicId ?? null}
      initialThreadRootId={initialThreadRootId}
    />
  );
}
