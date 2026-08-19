// The Buzz room store bound to the application database.
//
// `store.ts` stays database-agnostic so its rules can be exercised against an
// in-memory copy; this file is only the binding, matching how the calendar and
// plan stores are wired.

import "server-only";

import db from "@/lib/db";
import * as store from "./store.ts";
import type {
  AddMemberInput,
  BuzzMember,
  BuzzMessage,
  BuzzRoom,
  CreateRoomInput,
  PostMessageInput,
} from "./store.ts";

export type {
  BuzzMember,
  BuzzMessage,
  BuzzRoom,
  BuzzAuthorKind,
  BuzzMemberKind,
  BuzzMessageStatus,
  BuzzReaction,
  BuzzRespondTo,
  BuzzRoomKind,
  BuzzRoomVisibility,
} from "./store.ts";

export function listRooms(userId: number, includeArchived = false): BuzzRoom[] {
  return store.listRooms(db, userId, { includeArchived });
}

export function getRoom(userId: number, publicId: string): BuzzRoom | null {
  return store.getRoomByPublicId(db, userId, publicId);
}

export function createRoom(userId: number, input: CreateRoomInput): BuzzRoom {
  return store.createRoom(db, userId, input);
}

export function updateRoom(
  roomId: number,
  patch: Parameters<typeof store.updateRoom>[2],
): void {
  store.updateRoom(db, roomId, patch);
}

export function setRoomArchived(roomId: number, archived: boolean): void {
  store.setRoomArchived(db, roomId, archived);
}

export function deleteRoom(roomId: number): void {
  store.deleteRoom(db, roomId);
}

export function listMembers(roomId: number): BuzzMember[] {
  return store.listMembers(db, roomId);
}

export function getMember(memberId: number): BuzzMember | null {
  return store.getMember(db, memberId);
}

export function addMember(roomId: number, input: AddMemberInput): BuzzMember {
  return store.addMember(db, roomId, input);
}

export function updateMember(
  memberId: number,
  patch: Parameters<typeof store.updateMember>[2],
): void {
  store.updateMember(db, memberId, patch);
}

export function removeMember(memberId: number): void {
  store.removeMember(db, memberId);
}

export function setMemberConversation(
  memberId: number,
  conversationId: number,
): void {
  store.setMemberConversation(db, memberId, conversationId);
}

export function listSpineMessages(roomId: number, limit?: number): BuzzMessage[] {
  return store.listSpineMessages(db, roomId, limit);
}

export function listThreadMessages(
  roomId: number,
  parentId: number,
): BuzzMessage[] {
  return store.listThreadMessages(db, roomId, parentId);
}

export function getMessage(messageId: number): BuzzMessage | null {
  return store.getMessage(db, messageId);
}

export function postMessage(
  roomId: number,
  input: PostMessageInput,
): BuzzMessage {
  return store.postMessage(db, roomId, input);
}

export function updateMessageBody(
  messageId: number,
  body: string,
  status: Parameters<typeof store.updateMessageBody>[3],
  metadata?: Record<string, unknown> | null,
): void {
  store.updateMessageBody(db, messageId, body, status, metadata);
}

export function editMessage(messageId: number, body: string): void {
  store.editMessage(db, messageId, body);
}

export function softDeleteMessage(messageId: number): void {
  store.softDeleteMessage(db, messageId);
}

export function listLiveMessages(roomId: number): BuzzMessage[] {
  return store.listLiveMessages(db, roomId);
}

export function toggleReaction(
  messageId: number,
  memberId: number,
  emoji: string,
): void {
  store.toggleReaction(db, messageId, memberId, emoji);
}

export function reactionsForRoom(roomId: number, viewerMemberId: number | null) {
  return store.reactionsForRoom(db, roomId, viewerMemberId);
}

export function markRoomRead(
  roomId: number,
  userId: number,
  lastReadMessageId: number,
): void {
  store.markRoomRead(db, roomId, userId, lastReadMessageId);
}

export function unreadCounts(userId: number): Map<number, number> {
  return store.unreadCounts(db, userId);
}

/**
 * The account's own member row in a room, created on first need.
 *
 * Every room has exactly one human member — reactions and read state are keyed
 * to a member id, so the person needs a row like anyone else.
 */
export function ensureSelfMember(
  roomId: number,
  userId: number,
  displayName: string,
): BuzzMember {
  const existing = store
    .listMembers(db, roomId)
    .find((member) => member.kind === "human" && member.userId === userId);
  if (existing) return existing;
  return store.addMember(db, roomId, {
    kind: "human",
    userId,
    displayName,
    handle: displayName,
    accent: "#04a5e5",
  });
}
