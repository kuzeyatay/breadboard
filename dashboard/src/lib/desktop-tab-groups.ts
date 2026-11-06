import type { DesktopTabGroup } from "./desktop-browser-tabs";

// Keep these helpers inside the dashboard's Turbopack root. The native owner
// uses desktop/src/shared/tab-groups.ts; desktop-tab-groups.test.mjs checks
// both implementations against the same ancestry and visibility cases.

/** Root first, including the group itself. Also safe for stale or cyclic input. */
export function tabGroupPath<T extends { id: string; parentId?: string }>(groups: T[], id?: string): T[] {
  const path: T[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const group = groups.find(group => group.id === id);
    if (!group) break;
    path.unshift(group);
    id = group.parentId;
  }
  return path;
}

export function isInTabGroup(groups: { id: string; parentId?: string }[], memberId: string | undefined, groupId: string): boolean {
  return tabGroupPath(groups, memberId).some(group => group.id === groupId);
}

export function isTabGroupHidden(groups: DesktopTabGroup[], groupId?: string): boolean {
  return tabGroupPath(groups, groupId).some(group => group.collapsed);
}
