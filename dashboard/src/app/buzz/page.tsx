import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";
import { loadAgencyAgentsCatalog } from "@/lib/hermes/agency-agents.ts";
import {
  createRoom,
  ensureSelfMember,
  listMembers,
  listRooms,
  unreadCounts,
} from "@/lib/buzz/instance.ts";
import BuzzClient, { type BuzzPersona, type BuzzRoomSummary } from "./buzz-client";

export const dynamic = "force-dynamic";

/**
 * Buzz opens in its own tab from the navbar, so — like Plan — it renders its
 * own shell rather than the dashboard's.
 *
 * The roster and the room list are read here so the first paint is the real
 * page: a chat surface that flashes empty and then fills in reads as broken
 * even when it is fast.
 */
export default async function BuzzPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/login?callbackUrl=/buzz");

  const user = session.user as { id?: string; name?: string | null; email?: string | null };
  const userId = Number(user.id);
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "you";

  // A first visit lands in a room rather than an empty page. `#general` is the
  // name every chat product has taught people to expect, and it is created
  // once — a user who deletes it is not given it back.
  let rooms = listRooms(userId);
  if (rooms.length === 0) {
    createRoom(userId, {
      name: "general",
      topic: "Everything that does not have a room yet.",
    });
    rooms = listRooms(userId);
  }

  const unread = unreadCounts(userId);
  const summaries: BuzzRoomSummary[] = rooms.map((room) => {
    const members = listMembers(room.id);
    return {
      publicId: room.publicId,
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
    };
  });

  // The account needs a member row in whichever room opens first; reactions and
  // read state are keyed to one.
  const first = rooms[0];
  if (first) ensureSelfMember(first.id, userId, displayName);

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
      selfName={displayName}
      rooms={summaries}
      personas={personas}
      rosterReady={catalog.status === "ready"}
    />
  );
}
