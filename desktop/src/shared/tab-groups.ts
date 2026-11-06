export const TAB_GROUP_COLORS = {
  blue: "#85c5ff", purple: "#dca8ff", cyan: "#59dbe5", orange: "#ffb870",
  yellow: "#f6d45f", pink: "#ffadd6", green: "#87dc93", gray: "#b7c2cd", red: "#ff9baa", black: "#000000",
} as const;

export const AI_TAB_GROUP_ID = "breadboard-ai";

/** Each window keeps one home for pages opened by Breadboard. */
export function ensureAiTabGroup(host: { groups: TabGroup[] }): TabGroup {
  let group = host.groups.find(group => group.id === AI_TAB_GROUP_ID);
  if (!group) {
    group = { id: AI_TAB_GROUP_ID, name: "AI", color: "black", collapsed: false };
    host.groups.push(group);
  }
  group.name = "AI";
  group.color = "black";
  delete group.parentId;
  delete group.split;
  return group;
}

export interface TabGroup {
  id: string;
  parentId?: string;
  name: string;
  color: keyof typeof TAB_GROUP_COLORS;
  collapsed: boolean;
  /** Show the two group members side by side. */
  split?: boolean;
}

export function isTabGroupId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

export function isTabGroupColor(value: unknown): value is TabGroup["color"] {
  return typeof value === "string" && Object.hasOwn(TAB_GROUP_COLORS, value);
}

export function readTabGroups(value: unknown): TabGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((group): group is TabGroup => {
    if (!group || !isTabGroupId(group.id) || ids.has(group.id) ||
      typeof group.name !== "string" || group.name.length > 80 ||
      !isTabGroupColor(group.color) || typeof group.collapsed !== "boolean") return false;
    ids.add(group.id);
    return true;
  }).map(({ id, name, color, collapsed, split, parentId }) => ({ id, name, color, collapsed,
    ...(isTabGroupId(parentId) && parentId !== id && ids.has(parentId) ? { parentId } : {}),
    ...(split === true ? { split: true } : {}) }));
}

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

export function isTabGroupHidden(groups: TabGroup[], groupId?: string): boolean {
  return tabGroupPath(groups, groupId).some(group => group.collapsed);
}
