import "server-only";

import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth-options";
import { memberRole } from "@/lib/organizations/store.ts";
import { canManageRoom } from "./permissions.ts";
import { ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  ensureSelfMember,
  getRoom,
  getMessageByClientId,
  postMessage,
  listMembers,
} from "./instance.ts";
import type { BuzzMember, BuzzMessage, BuzzRoom } from "./store.ts";
import { buzzBridge } from "@/lib/crumbs/service.ts";
import { getIdentity } from "@/lib/crumbs/store.ts";
import db from "@/lib/db";
import { BREAD_AVATAR, BREAD_SLUG } from "./bread.ts";
import { botsStore } from "@/lib/bots/server.ts";
import { botHandle } from "@/lib/bots/mentions.ts";
import { BOT_PERSONA_PREFIX } from "@/lib/bots/team.ts";
import { DEFAULT_BOT_AVATAR, type BotAvatarConfig } from "@/lib/bots/types.ts";

/**
 * Members with their profile photo, when they have linked an account or sent one.
 * A bot has no photo: its face is drawn from its shape, colour and expression, so
 * bot members carry that instead. A bot this machine does not know (seated from
 * another machine) keeps the colour it was seated with on the default shape.
 */
export function withPhotos(roomId: number, members: BuzzMember[], userId?: number): Array<BuzzMember & { avatarUrl: string | null; botAvatar: BotAvatarConfig | null }> {
  const photos = buzzBridge.memberAvatars(roomId);
  let bots: Map<string, BotAvatarConfig> | null = null;
  const botAvatar = (member: BuzzMember): BotAvatarConfig | null => {
    if (!member.personaSlug?.startsWith(BOT_PERSONA_PREFIX)) return null;
    if (!bots) {
      bots = new Map();
      try {
        if (userId !== undefined) for (const bot of botsStore().list(userId)) bots.set(botHandle(bot.name), bot.avatar);
      } catch { /* a missing bot table leaves the default face */ }
    }
    return bots.get(member.personaSlug.slice(BOT_PERSONA_PREFIX.length)) ?? { ...DEFAULT_BOT_AVATAR, color: member.accent || DEFAULT_BOT_AVATAR.color };
  };
  return members.map(member => ({
    ...member,
    avatarUrl: photos[member.id] ?? (member.personaSlug === BREAD_SLUG ? BREAD_AVATAR : null),
    botAvatar: botAvatar(member),
  }));
}

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
  // A linked Crumbs account gives Breadboard its name, so rooms show the same
  // person here as they do to members on other machines.
  const identity = getIdentity(db, userId);
  return {
    userId,
    displayName: identity?.displayName || identity?.handle?.split(".")[0] || user?.name?.trim() || user?.email?.split("@")[0] || "you",
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

export function roomPermissions(userId: number, room: BuzzRoom) {
  return {
    canManage: canManageRoom(room, userId, memberRole(room.organizationId, userId)),
    canPost: room.archivedAt === null,
  };
}

export function requireRoomManager(userId: number, room: BuzzRoom): void {
  if (!roomPermissions(userId, room).canManage) {
    throw new ApiError(403, "room_manager_required", "Only an organization admin or the room creator can manage this room.");
  }
}

export function requireWritableRoom(room: BuzzRoom): void {
  if (room.archivedAt !== null) {
    throw new ApiError(409, "room_archived", "This room is archived. Restore it before posting.");
  }
}

/** A lost HTTP response may be retried, but an id cannot claim another send. */
export function postHumanMessage(room: BuzzRoom, self: BuzzMember, body: string, clientMessageId: string, parentId: number | null = null, metadata?: Record<string, unknown>) {
  requireWritableRoom(room);
  if (/^buzz_(reply|regen)_/.test(clientMessageId)) throw new ApiError(400, "reserved_message_id", "That message identifier is reserved for agent responses.");
  const previous = getMessageByClientId(room.id, clientMessageId);
  if (previous && (previous.memberId !== self.id || previous.authorKind !== "human" ||
    previous.body !== body || previous.parentId !== parentId || previous.deletedAt !== null)) {
    throw new ApiError(409, "message_id_conflict", "That message identifier was already used for another message.");
  }
  return postMessage(room.id, {
    clientMessageId, memberId: self.id, authorKind: "human", authorName: self.displayName,
    authorHandle: self.handle, body, parentId, ...(metadata ? { metadata } : {}),
  });
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

/** Shared transcripts expose the answer, while account-specific approvals stay private. */
export function presentRoomMessage(message: BuzzMessage, userId: number): BuzzMessage {
  if (!message.metadata || message.metadata.actingUserId === userId) return message;
  const metadata = { ...message.metadata };
  delete metadata.pendingPermissions; delete metadata.conversationId; delete metadata.conversationPublicId;
  return { ...message, metadata, body: metadata.needsPermission ? "This response needs permission from the person who requested it." : message.body };
}
