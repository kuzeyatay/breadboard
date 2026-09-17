export const TAB_GROUP_COLORS = {
  blue: "#85c5ff", purple: "#dca8ff", cyan: "#59dbe5", orange: "#ffb870",
  yellow: "#f6d45f", pink: "#ffadd6", green: "#87dc93", gray: "#b7c2cd", red: "#ff9baa",
} as const;

export interface TabGroup {
  id: string;
  name: string;
  color: keyof typeof TAB_GROUP_COLORS;
  collapsed: boolean;
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
  }).map(({ id, name, color, collapsed }) => ({ id, name, color, collapsed }));
}
