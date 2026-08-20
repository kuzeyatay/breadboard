import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  listMembers,
  listRoomsForUser,
  searchMessages,
  unreadCounts,
} from "@/lib/buzz/instance.ts";
import { requireBuzzUser } from "@/lib/buzz/route-helpers.ts";

export const dynamic = "force-dynamic";

/**
 * What the search palette shows: rooms first, then messages.
 *
 * Rooms are matched here rather than in the browser because the palette has to
 * find a room the reader has not opened this session — the rails only carry
 * the rooms already loaded, and "search everything" that could not find an
 * archived room would be a search that quietly lies.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireBuzzUser();
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

    const unread = unreadCounts(userId);
    const needle = query.toLowerCase();
    const rooms = listRoomsForUser(userId, true)
      .filter(
        (room) =>
          needle === "" ||
          room.name.toLowerCase().includes(needle) ||
          room.slug.toLowerCase().includes(needle) ||
          room.topic.toLowerCase().includes(needle),
      )
      .slice(0, 12)
      .map((room) => ({
        publicId: room.publicId,
        organizationId: room.organizationId,
        slug: room.slug,
        name: room.name,
        topic: room.topic,
        kind: room.kind,
        visibility: room.visibility,
        archived: room.archivedAt !== null,
        unread: unread.get(room.id) ?? 0,
        memberCount: listMembers(room.id).length,
      }));

    // An empty query lists the rooms and stops: matching every message in
    // every room against nothing would return the whole history in id order,
    // which is noise rather than a starting point.
    const messages = query === "" ? [] : searchMessages(userId, query, 40);

    return NextResponse.json({ query, rooms, messages });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
