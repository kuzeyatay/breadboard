import { AI_TAB_GROUP_ID, isInTabGroup, tabGroupPath, type TabGroup } from "../shared/tab-groups";

interface GroupedTab { id: number; groupId?: string }
interface GroupedHost<T extends GroupedTab> { tabs: T[]; groups: TabGroup[] }

/** Keep the default group first, including descendants and partially restored tabs. */
export function positionAiTabGroup<T extends GroupedTab>(host: GroupedHost<T>): void {
  const ai: T[] = [], rest: T[] = [];
  for (const tab of host.tabs) {
    (isInTabGroup(host.groups, tab.groupId, AI_TAB_GROUP_ID) ? ai : rest).push(tab);
  }
  host.tabs = [...ai, ...rest];
}

/** Every subtree is contiguous. Parents survive while any descendant has tabs. */
export function normalizeTabGroups<T extends GroupedTab>(host: GroupedHost<T>): void {
  const valid = new Set(host.groups.map(group => group.id));
  for (const tab of host.tabs) if (tab.groupId && !valid.has(tab.groupId)) delete tab.groupId;
  for (const group of host.groups) {
    if (group.parentId && (!valid.has(group.parentId) || isInTabGroup(host.groups, group.parentId, group.id))) delete group.parentId;
  }
  const used = new Set(host.tabs.flatMap(tab => tabGroupPath(host.groups, tab.groupId).map(group => group.id)));
  host.groups = host.groups.filter(group => group.id === AI_TAB_GROUP_ID || used.has(group.id));
  const order = (tabs: T[], parentId?: string): T[] => {
    const seen = new Set<string>();
    const ordered: T[] = [];
    for (const tab of tabs) {
      const path = tabGroupPath(host.groups, tab.groupId);
      const child = parentId ? path[path.findIndex(group => group.id === parentId) + 1] : path[0];
      if (!child) ordered.push(tab);
      else if (!seen.has(child.id)) {
        seen.add(child.id);
        ordered.push(...order(tabs.filter(member => isInTabGroup(host.groups, member.groupId, child.id)), child.id));
      }
    }
    return ordered;
  };
  host.tabs = order(host.tabs);
  positionAiTabGroup(host);
  for (const group of host.groups) {
    if (group.split && (host.groups.some(child => child.parentId === group.id) || host.tabs.filter(tab => tab.groupId === group.id).length !== 2)) delete group.split;
  }
}

/** Inserting into a parent must not cut one of its child subtrees in two. */
function insertionIndex<T extends GroupedTab>(host: GroupedHost<T>, rest: T[], index: number, parentId?: string): number {
  let target = Math.max(0, Math.min(rest.length, index));
  const unit = (tab?: T) => {
    const path = tabGroupPath(host.groups, tab?.groupId);
    return (parentId ? path[path.findIndex(group => group.id === parentId) + 1] : path[0])?.id;
  };
  const before = unit(rest[target - 1]);
  if (before && before === unit(rest[target])) while (target < rest.length && unit(rest[target]) === before) target++;
  return target;
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
  target = insertionIndex(host, rest, target, destination);
  if (destination) tab.groupId = destination;
  else delete tab.groupId;
  rest.splice(target, 0, tab);
  host.tabs = rest;
  normalizeTabGroups(host);
  return true;
}

/** Move all members together; index is measured after removing the whole group. */
export function moveTabGroup<T extends GroupedTab>(host: GroupedHost<T>, groupId: string, index: number, parentId?: string | null): boolean {
  const group = host.groups.find(group => group.id === groupId);
  if (!Number.isInteger(index) || !group || groupId === AI_TAB_GROUP_ID) return false;
  const parent = parentId === undefined ? group.parentId : parentId ?? undefined;
  if (parent && (!host.groups.some(group => group.id === parent) || isInTabGroup(host.groups, parent, groupId))) return false;
  const members = host.tabs.filter(tab => isInTabGroup(host.groups, tab.groupId, groupId));
  if (!members.length) return false;
  const rest = host.tabs.filter(tab => !members.includes(tab));
  if (parent) group.parentId = parent;
  else delete group.parentId;
  const target = insertionIndex(host, rest, index, parent);
  rest.splice(target, 0, ...members);
  host.tabs = rest;
  normalizeTabGroups(host);
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
