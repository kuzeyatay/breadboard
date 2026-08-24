// Shapes the Buzz page passes between its server and client halves.
//
// These mirror the store's types rather than re-exporting them, because the
// client must not import anything that reaches the database.

export type BuzzRoomKind = "channel" | "dm";
export type BuzzRoomVisibility = "public" | "private";
export type BuzzMemberKind = "human" | "agent";
export type BuzzRespondTo = "always" | "mention" | "never";
export type BuzzAuthorKind = "human" | "agent" | "system";
export type BuzzMessageStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "failed"
  | "aborted";

export interface BuzzCommunity {
  id: number;
  name: string;
  role: string;
  people: Array<{ userId: number; username: string }>;
}

export interface BuzzRoomSummary {
  publicId: string;
  organizationId: number;
  slug: string;
  name: string;
  topic: string;
  kind: BuzzRoomKind;
  visibility: BuzzRoomVisibility;
  archived: boolean;
  unread: number;
  memberCount: number;
  agentHandles: string[];
  peopleHandles: string[];
}

export interface BuzzPersona {
  slug: string;
  name: string;
  description: string;
  division: string;
  divisionColor: string;
  color: string;
  emoji: string;
}

export interface BuzzMember {
  id: number;
  roomId: number;
  kind: BuzzMemberKind;
  userId: number | null;
  personaSlug: string | null;
  displayName: string;
  handle: string;
  accent: string;
  respondTo: BuzzRespondTo;
  model: string | null;
  conversationId: number | null;
  muted: boolean;
  joinedAt: string;
}

export interface BuzzReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface BuzzMessage {
  id: number;
  roomId: number;
  clientMessageId: string;
  memberId: number | null;
  authorKind: BuzzAuthorKind;
  authorName: string;
  authorHandle: string;
  personaSlug: string | null;
  body: string;
  parentId: number | null;
  status: BuzzMessageStatus;
  runId: string | null;
  metadata: Record<string, unknown> | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replyCount?: number;
  lastReplyAt?: string | null;
  reactions?: BuzzReaction[];
}

export interface RoomDetail {
  room: {
    publicId: string;
    slug: string;
    name: string;
    topic: string;
    purpose: string;
    kind: BuzzRoomKind;
    visibility: BuzzRoomVisibility;
  };
  selfMemberId: number;
  members: BuzzMember[];
  messages: BuzzMessage[];
}

/**
 * A message carrying enough of its room to be shown outside it — a search
 * result, or a line waiting in the inbox.
 */
export interface BuzzMessageHit {
  message: BuzzMessage;
  roomPublicId: string;
  roomName: string;
  roomSlug: string;
  roomKind: BuzzRoomKind;
  organizationId: number;
  mentionsYou: boolean;
}

/** One agent's seat in one room, as the Agents view lists it. */
export interface BuzzAgentSeat {
  member: BuzzMember;
  roomPublicId: string;
  roomName: string;
  roomSlug: string;
  organizationId: number;
}

/**
 * A community invitation waiting on the reader, as the inbox shows it.
 *
 * Mirrors `ReceivedInvite` from the organizations store; redeclared here so
 * the Buzz client keeps its own flat type surface rather than importing a
 * server module's shape into the browser bundle.
 */
export interface BuzzInvite {
  id: number;
  organizationId: number;
  organizationName: string;
  role: string;
  /** The account that sent it, or null if that account is gone. */
  invitedBy: string | null;
  createdAt: string;
}

/** A room as the search palette lists it — including archived ones. */
export interface BuzzSearchRoom {
  publicId: string;
  organizationId: number;
  slug: string;
  name: string;
  topic: string;
  kind: BuzzRoomKind;
  visibility: BuzzRoomVisibility;
  archived: boolean;
  unread: number;
  memberCount: number;
}

/** A message still being written by an agent member. */
export function isLive(message: BuzzMessage): boolean {
  return message.status === "pending" || message.status === "streaming";
}
