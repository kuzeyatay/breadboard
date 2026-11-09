import type Database from "better-sqlite3";
import { addMember } from "./store.ts";

/** Runs in the same transaction as the organization invitation response. */
export function settleRoomInvites(database: Database.Database, inviteId: number, userId: number, accept: boolean): void {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'buzz_room_invites'").get()) return;
  const rooms = database.prepare(`SELECT r.id, m.role
    FROM buzz_room_invites i JOIN buzz_rooms r ON r.id = i.room_id
    JOIN organization_invites oi ON oi.id = i.invite_id AND oi.organization_id = r.organization_id
    LEFT JOIN organization_members m ON m.organization_id = r.organization_id AND m.user_id = i.invited_by_user_id
    WHERE i.invite_id = ? AND oi.invited_user_id = ?`).all(inviteId, userId) as Array<{ id: number; role: string | null }>;
  if (accept) {
    const user = database.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;
    for (const room of rooms) {
      // An invitation must not resurrect an administrator's revoked access.
      if (user && (room.role === "owner" || room.role === "admin")) {
        addMember(database, room.id, { kind: "human", userId, displayName: user.username, handle: user.username, accent: "#04a5e5" });
      }
    }
  }
  database.prepare("DELETE FROM buzz_room_invites WHERE invite_id = ?").run(inviteId);
}
