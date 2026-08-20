import "server-only";

import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth-options";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import { getRoom, listMembers, ensureSelfMember } from "./instance.ts";
import type { BuzzMember, BuzzRoom } from "./store.ts";

/**
 * The signed-in account and the name it posts under.
 *
 * `requireUserId` answers only the id, and every room write needs a display
 * name too — the caller's member row is created on first use and has to be
 * labelled with something a room-mate would recognise.
 */
export async function requireBuzzUser(): Promise<{
  userId: number;
  displayName: string;
}> {
  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id?: string; name?: string | null; email?: string | null }
    | undefined;
  const userId = Number(user?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new ApiError(401, "unauthorized", "Sign in to use Buzz.");
  }
  return {
    userId,
    displayName: user?.name?.trim() || user?.email?.split("@")[0] || "you",
  };
}

/**
 * The room named by a route, or a 404.
 *
 * `getRoom` decides access from organization membership, so a room in an
 * organization the caller does not belong to answers exactly like one that
 * does not exist and the id space cannot be probed.
 */
export function requireRoom(userId: number, publicId: string): BuzzRoom {
  const room = getRoom(userId, publicId);
  if (!room) throw new ApiError(404, "room_not_found", "Room not found.");
  return room;
}

/** The room, plus the caller's own member row in it. */
export function requireRoomAndSelf(
  userId: number,
  publicId: string,
  displayName: string,
): { room: BuzzRoom; self: BuzzMember; members: BuzzMember[] } {
  const room = requireRoom(userId, publicId);
  const self = ensureSelfMember(room.id, userId, displayName);
  return { room, self, members: listMembers(room.id) };
}

export function requireString(value: unknown, field: string, max = 4000): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "invalid_request", `\`${field}\` is required.`);
  }
  if (value.length > max) {
    throw new ApiError(400, "invalid_request", `\`${field}\` is too long.`);
  }
  return value;
}
