import * as buzzStore from "../../buzz/store.ts";
import {
  organizationForScope,
  type BrainGraphAccessContext,
} from "../brain-graph-auth.ts";
import {
  agentNodeId,
  brainEdgeId,
  buzzRoomNodeId,
  buzzThreadNodeId,
  memberNodeId,
} from "../brain-graph-ids.ts";
import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainNode,
  BrainScope,
} from "../brain-graph-types.ts";

function meaningfulThread(message: buzzStore.BuzzMessage): boolean {
  if (message.deletedAt !== null || message.status !== "complete") return false;
  if ((message.replyCount ?? 0) > 0) return true;
  const metadata = message.metadata ?? {};
  return ["pinned", "starred", "saved", "artifactId", "gardenSlug", "repository"]
    .some((key) => Boolean(metadata[key]));
}

function threadLabel(message: buzzStore.BuzzMessage): string {
  const metadataTitle = message.metadata?.title;
  const value = typeof metadataTitle === "string" ? metadataTitle : message.body;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "Buzz thread";
  return compact.length <= 88 ? compact : `${compact.slice(0, 85).trimEnd()}…`;
}

function roomInScope(
  room: buzzStore.BuzzRoom,
  scope: BrainScope,
  selectedOrganizationId: number | null,
  members: buzzStore.BuzzMember[],
  userId: number,
): boolean {
  const participates = members.some((member) => member.userId === userId);
  if (scope.kind === "personal") {
    return room.kind === "dm" && participates;
  }
  if (scope.kind === "organization") {
    // DMs remain personal participant scopes even though the current Buzz
    // schema places every room under a community for lifecycle ownership.
    return room.kind === "channel" && room.organizationId === selectedOrganizationId;
  }
  return room.kind !== "dm" || participates;
}

function buildRooms(
  context: BrainGraphAccessContext,
  scope: BrainScope,
  limits: BrainGraphLimits,
  threadLimit: number,
  onlyRoomNodeId?: string,
): BrainGraphFragment {
  const nodes: BrainNode[] = [];
  const edges: BrainEdge[] = [];
  const selectedOrganizationId = organizationForScope(context, scope)?.id ?? null;
  const rooms = buzzStore
    .listRoomsForUser(context.database, context.userId)
    .map((room) => ({ room, members: buzzStore.listMembers(context.database, room.id) }))
    .filter(({ room, members }) =>
      roomInScope(room, scope, selectedOrganizationId, members, context.userId),
    )
    .filter(({ room }) => !onlyRoomNodeId || buzzRoomNodeId(room.publicId) === onlyRoomNodeId)
    .slice(0, limits.maxBuzzRooms);

  for (const { room, members } of rooms) {
    const organization = context.organizations.find(
      (candidate) => candidate.id === room.organizationId,
    );
    if (!organization) continue;
    const roomNode = buzzRoomNodeId(room.publicId);
    const people = members.filter((member) => member.kind === "human");
    const roomKind = room.kind === "dm" ? "conversation" : "buzz_channel";
    const dmLabel = people.length > 2 ? "Group DM" : "Direct message";
    nodes.push({
      id: roomNode,
      kind: roomKind,
      label: room.name,
      subtitle:
        room.kind === "dm"
          ? dmLabel
          : `${room.visibility === "private" ? "Private" : "Public"} Buzz channel`,
      href: `/buzz?room=${encodeURIComponent(room.publicId)}`,
      origins: ["buzz"],
      organizationId: organization.publicId,
      createdAt: room.createdAt,
      updatedAt: room.lastActivityAt,
      expandable: true,
      metrics: { activity: members.length },
      metadata: {
        medium: room.kind === "dm" ? (people.length > 2 ? "group_dm" : "dm") : "channel",
        visibility: room.visibility,
        memberCount: members.length,
      },
    });

    const parent = scope.kind === "personal"
      ? "user:self"
      : `organization:${organization.publicId}`;
    edges.push({
      id: brainEdgeId(parent, roomNode, room.kind === "dm" ? "participated_in" : "contains", "buzz"),
      source: parent,
      target: roomNode,
      relation: room.kind === "dm" ? "participated_in" : "contains",
      origin: "buzz",
      explicit: true,
      organizationId: organization.publicId,
      weight: 1.25,
    });

    for (const member of members) {
      if (member.kind === "agent" && member.personaSlug) {
        const agentId = agentNodeId(member.personaSlug);
        nodes.push({
          id: agentId,
          kind: "agent",
          label: member.displayName,
          subtitle: "Buzz agent",
          origins: ["buzz", "agent"],
          organizationId: organization.publicId,
          createdAt: member.joinedAt,
          expandable: true,
          metadata: { human: false, muted: member.muted },
        });
        edges.push({
          id: brainEdgeId(agentId, roomNode, "participated_in", "buzz"),
          source: agentId,
          target: roomNode,
          relation: "participated_in",
          origin: "buzz",
          explicit: true,
          organizationId: organization.publicId,
        });
      } else if (room.kind === "dm" && member.kind === "human") {
        const memberId =
          member.userId === context.userId
            ? "user:self"
            : memberNodeId(String(member.userId ?? member.displayName ?? member.handle));
        if (memberId !== "user:self") {
          nodes.push({
            id: memberId,
            kind: "person",
            label: member.displayName,
            subtitle: "Buzz participant",
            origins: ["buzz"],
            organizationId: organization.publicId,
            createdAt: member.joinedAt,
            expandable: true,
            metadata: { participant: true },
          });
        }
        edges.push({
          id: brainEdgeId(memberId, roomNode, "participated_in", "buzz"),
          source: memberId,
          target: roomNode,
          relation: "participated_in",
          origin: "buzz",
          explicit: true,
          organizationId: organization.publicId,
        });
      }
    }

    const membersById = new Map(members.map((member) => [member.id, member]));
    const roots = buzzStore
      .listSpineMessages(context.database, room.id, Math.max(100, threadLimit * 4))
      .filter(meaningfulThread)
      .sort(
        (left, right) =>
          (Date.parse(right.lastReplyAt ?? right.updatedAt) || 0) -
          (Date.parse(left.lastReplyAt ?? left.updatedAt) || 0),
      )
      .slice(0, threadLimit);
    for (const root of roots) {
      const threadNode = buzzThreadNodeId(room.publicId, root.id);
      nodes.push({
        id: threadNode,
        kind: "buzz_thread",
        label: threadLabel(root),
        subtitle: `${root.replyCount ?? 0} ${(root.replyCount ?? 0) === 1 ? "reply" : "replies"}`,
        href: `/buzz?room=${encodeURIComponent(room.publicId)}&thread=${encodeURIComponent(threadNode)}`,
        origins: ["buzz"],
        organizationId: organization.publicId,
        createdAt: root.createdAt,
        updatedAt: root.lastReplyAt ?? root.updatedAt,
        expandable: true,
        metrics: { activity: root.replyCount ?? 0 },
        metadata: {
          replyCount: root.replyCount ?? 0,
          authorKind: root.authorKind,
        },
      });
      edges.push({
        id: brainEdgeId(roomNode, threadNode, "contains", "buzz"),
        source: roomNode,
        target: threadNode,
        relation: "contains",
        origin: "buzz",
        explicit: true,
        organizationId: organization.publicId,
      });
      const author = root.memberId === null ? null : membersById.get(root.memberId) ?? null;
      if (author?.kind === "agent" && author.personaSlug) {
        const agentId = agentNodeId(author.personaSlug);
        edges.push({
          id: brainEdgeId(agentId, threadNode, "authored", "buzz"),
          source: agentId,
          target: threadNode,
          relation: "authored",
          origin: "buzz",
          explicit: true,
          organizationId: organization.publicId,
        });
      }
    }
  }

  return {
    nodes,
    edges,
    truncated: rooms.length >= limits.maxBuzzRooms,
  };
}

export const buzzBrainSource = {
  name: "buzz",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    try {
      return buildRooms(
        context,
        scope,
        limits,
        limits.maxBuzzThreadsPerRoom,
      );
    } catch {
      return {
        nodes: [],
        edges: [],
        warnings: [
          {
            source: "buzz",
            code: "buzz_unavailable",
            message: "Buzz is unavailable; the rest of the Knowledge Map is still current.",
          },
        ],
      };
    }
  },
  expand(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    nodeId: string,
    _depth: number,
    limits: BrainGraphLimits,
  ): BrainGraphFragment {
    if (!nodeId.startsWith("buzz-room:")) return { nodes: [], edges: [] };
    try {
      return buildRooms(
        context,
        scope,
        limits,
        Math.min(100, limits.maxBuzzThreadsPerRoom * 2),
        nodeId,
      );
    } catch {
      return {
        nodes: [],
        edges: [],
        warnings: [
          {
            source: "buzz",
            code: "buzz_unavailable",
            message: "Buzz expansion is temporarily unavailable.",
          },
        ],
      };
    }
  },
};
