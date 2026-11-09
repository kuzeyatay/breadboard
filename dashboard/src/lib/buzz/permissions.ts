/** Room access is checked separately, including private-room membership. */
export function canManageRoom(
  room: { createdByUserId: number | null },
  userId: number,
  organizationRole: string | null,
): boolean {
  return organizationRole === "owner" || organizationRole === "admin" ||
    (organizationRole === "member" && room.createdByUserId === userId);
}

export function canDeleteMessage(
  message: { memberId: number | null; authorKind: string },
  selfMemberId: number,
  managesRoom: boolean,
): boolean {
  return managesRoom || (message.authorKind === "human" && message.memberId === selfMemberId);
}
