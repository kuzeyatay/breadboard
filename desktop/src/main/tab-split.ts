import { AI_TAB_GROUP_ID, type TabGroup } from "../shared/tab-groups";
import { normalizeTabGroups } from "./tab-groups";

interface SplitTab { id: number; groupId?: string }
interface SplitHost<T extends SplitTab> { tabs: T[]; groups: TabGroup[]; activeId: number }

/** A split is a two-tab group; strip order is also the left-to-right order. */
export function splitTabs<T extends SplitTab>(host: SplitHost<T>, id: number, targetId: number, side: "left" | "right", fresh: TabGroup): boolean {
  const source = host.tabs.find(tab => tab.id === id);
  const target = host.tabs.find(tab => tab.id === targetId);
  if (!source || !target || source === target) return false;
  const existing = source.groupId === target.groupId && host.groups.find(group => group.id === target.groupId && group.id !== AI_TAB_GROUP_ID);
  const group = existing && !host.groups.some(child => child.parentId === existing.id) && host.tabs.filter(tab => tab.groupId === existing.id).length === 2 ? existing : fresh;
  if (group === fresh) {
    group.parentId = target.groupId;
    host.groups.push(group);
  }
  group.split = true;
  group.collapsed = false;
  const rest = host.tabs.filter(tab => tab !== source && tab !== target);
  const index = host.tabs.slice(0, host.tabs.indexOf(target)).filter(tab => tab !== source).length;
  source.groupId = target.groupId = group.id;
  rest.splice(index, 0, ...(side === "left" ? [source, target] : [target, source]));
  host.tabs = rest;
  normalizeTabGroups(host);
  return true;
}

export function splitMembers<T extends SplitTab>(host: SplitHost<T>): T[] {
  const active = host.tabs.find(tab => tab.id === host.activeId);
  const group = host.groups.find(group => group.id === active?.groupId && group.split && !group.collapsed);
  const members = group ? host.tabs.filter(tab => tab.groupId === group.id) : [];
  return members.length === 2 ? members : [];
}

export function splitPaneBounds(width: number, height: number, top: number, index: number) {
  const gap = Math.min(8, Math.max(0, width - 2));
  const leftWidth = Math.max(1, Math.floor((width - gap) / 2));
  const x = index === 0 ? 0 : leftWidth + gap;
  return { x, y: top, width: index === 0 ? leftWidth : Math.max(1, width - x), height: Math.max(1, height - top) };
}
