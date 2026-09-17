import type { TabGroup } from "../shared/tab-groups";

interface GroupedTab { id: number; groupId?: string }
interface GroupedHost<T extends GroupedTab> { tabs: T[]; groups: TabGroup[] }

/** Every group is one contiguous run. Empty groups disappear immediately. */
export function normalizeTabGroups<T extends GroupedTab>(host: GroupedHost<T>): void {
  const valid = new Set(host.groups.map(group => group.id));
  for (const tab of host.tabs) if (tab.groupId && !valid.has(tab.groupId)) delete tab.groupId;
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const tab of host.tabs) {
    if (!tab.groupId) ordered.push(tab);
    else if (!seen.has(tab.groupId)) {
      seen.add(tab.groupId);
      ordered.push(...host.tabs.filter(member => member.groupId === tab.groupId));
    }
  }
  host.tabs = ordered;
  host.groups = host.groups.filter(group => seen.has(group.id));
}

/** Index is measured after removing the dragged tab. An explicit null exits a group. */
export function moveGroupedTab<T extends GroupedTab>(host: GroupedHost<T>, id: number, index: number, groupId?: string | null): boolean {
  const tab = host.tabs.find(tab => tab.id === id);
  if (!tab || !Number.isInteger(index) || (groupId && !host.groups.some(group => group.id === groupId))) return false;
  const rest = host.tabs.filter(candidate => candidate !== tab);
  let target = Math.max(0, Math.min(rest.length, index));
  const before = rest[target - 1]?.groupId;
  const after = rest[target]?.groupId;
  const destination = groupId === undefined
    ? before && before === after ? before : tab.groupId && (before === tab.groupId || after === tab.groupId) ? tab.groupId : undefined
    : groupId ?? undefined;
  // An ungrouped tab cannot split a run, even for an old renderer/shortcut.
  if (!destination && before && before === after) {
    while (target < rest.length && rest[target]?.groupId === before) target++;
  }
  if (destination) tab.groupId = destination;
  else delete tab.groupId;
  rest.splice(target, 0, tab);
  host.tabs = rest;
  normalizeTabGroups(host);
  return true;
}

/** Move all members together; index is measured after removing the whole group. */
export function moveTabGroup<T extends GroupedTab>(host: GroupedHost<T>, groupId: string, index: number): boolean {
  if (!Number.isInteger(index) || !host.groups.some(group => group.id === groupId)) return false;
  const members = host.tabs.filter(tab => tab.groupId === groupId);
  if (!members.length) return false;
  const rest = host.tabs.filter(tab => tab.groupId !== groupId);
  let target = Math.max(0, Math.min(rest.length, index));
  const before = rest[target - 1]?.groupId;
  // A stale or older renderer must not split another group.
  if (before && before === rest[target]?.groupId) {
    while (target < rest.length && rest[target]?.groupId === before) target++;
  }
  rest.splice(target, 0, ...members);
  host.tabs = rest;
  return true;
}

export function groupTabs<T extends GroupedTab>(host: GroupedHost<T>, id: number, targetId: number, fresh: TabGroup): boolean {
  const source = host.tabs.find(tab => tab.id === id);
  const target = host.tabs.find(tab => tab.id === targetId);
  if (!source || !target || source === target || (source.groupId && source.groupId === target.groupId)) return false;
  let group = host.groups.find(group => group.id === target.groupId);
  if (!group) {
    group = fresh;
    host.groups.push(group);
    target.groupId = group.id;
  }
  const rest = host.tabs.filter(tab => tab !== source);
  const last = rest.map(tab => tab.groupId).lastIndexOf(group.id);
  source.groupId = group.id;
  rest.splice(last + 1, 0, source);
  host.tabs = rest;
  normalizeTabGroups(host);
  return true;
}
