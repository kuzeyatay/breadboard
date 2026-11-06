import { AI_TAB_GROUP_ID, type DesktopTabView, type DesktopTabGroup } from "./desktop-browser-tabs.ts";
import { isInTabGroup, tabGroupPath } from "./desktop-tab-groups.ts";

export interface TabDropRect { id?: number; groupId?: string; left: number; width: number }
export interface TabDropTarget {
  index: number;
  groupId: string | null;
  groupTargetId?: number;
  nestGroupId?: string;
  markerX: number;
}

/** A vertical drag leaves the strip and chooses a side of the content area. */
export function tabSplitDropTarget(tabs: DesktopTabView[], id: number, targetId: number | null,
  x: number, y: number, width: number, height: number, stripBottom: number): "left" | "right" | null {
  const source = tabs.find(tab => tab.id === id), target = tabs.find(tab => tab.id === targetId);
  if (!source || !target || source === target || Boolean(source.browser?.private) !== Boolean(target.browser?.private) ||
      x < 0 || x > width || y < stripBottom + 40 || y >= height) return null;
  return x < width / 2 ? "left" : "right";
}

/** Header centers offer nesting; other positions reorder complete subtrees. */
export function tabGroupDropTarget(tabs: DesktopTabView[], rects: TabDropRect[], groupId: string, x: number, groups: DesktopTabGroup[] = []): TabDropTarget {
  const belongs = (id: string | undefined, parent: string) => id === parent || isInTabGroup(groups, id, parent);
  const rest = tabs.filter(tab => !belongs(tab.groupId, groupId));
  const source = tabs.find(tab => belongs(tab.groupId, groupId));
  const header = rects.find(rect => rect.groupId && groups.some(group => group.id === rect.groupId) && !belongs(rect.groupId, groupId) &&
    x >= rect.left + rect.width * .2 && x <= rect.left + rect.width * .8);
  if (groupId !== AI_TAB_GROUP_ID && header?.groupId && Boolean(source?.browser?.private) === Boolean(rest.find(tab => belongs(tab.groupId, header.groupId!))?.browser?.private)) {
    return { index: rest.findLastIndex(tab => belongs(tab.groupId, header.groupId!)) + 1, groupId: null, nestGroupId: header.groupId, markerX: header.left };
  }
  let markerX = rects.find(rect => rect.groupId === groupId)?.left ?? 8;
  for (let index = 0; index < rest.length;) {
    const first = rest[index];
    let end = index + 1;
    const rootId = tabGroupPath(groups, first.groupId)[0]?.id ?? first.groupId;
    if (rootId) while (end < rest.length && belongs(rest[end].groupId, rootId)) end++;
    const ids = new Set(rest.slice(index, end).map(tab => tab.id));
    const blockRects = rects.filter(rect => rect.id !== undefined ? ids.has(rect.id) : Boolean(rootId) && belongs(rect.groupId, rootId!));
    if (blockRects.length) {
      const left = Math.min(...blockRects.map(rect => rect.left));
      const right = Math.max(...blockRects.map(rect => rect.left + rect.width));
      if (rootId === AI_TAB_GROUP_ID) { markerX = right; index = end; continue; }
      if (x < (left + right) / 2) return { index, groupId: null, markerX: left };
      if (x <= right) return { index: end, groupId: null, markerX: right };
      markerX = right;
    }
    index = end;
  }
  return { index: rest.length, groupId: null, markerX };
}

/** Uses the geometry captured before the drag, so preview movement cannot move its own hit targets. */
export function tabDropTarget(tabs: DesktopTabView[], rects: TabDropRect[], draggedId: number, x: number, groups: DesktopTabGroup[] = []): TabDropTarget {
  const source = tabs.find(tab => tab.id === draggedId);
  const rest = tabs.filter(tab => tab.id !== draggedId);
  const candidates = rects.filter(rect => rect.id !== draggedId);
  for (const rect of candidates) {
    const tab = rect.id === undefined ? rest.find(tab => tab.groupId === rect.groupId || (rect.groupId && isInTabGroup(groups, tab.groupId, rect.groupId))) : rest.find(tab => tab.id === rect.id);
    if (!tab) {
      if (source && !source.browser?.private && rect.groupId === AI_TAB_GROUP_ID && groups.some(group => group.id === rect.groupId) && x >= rect.left && x <= rect.left + rect.width) {
        return { index: 0, groupId: null, nestGroupId: rect.groupId, markerX: rect.left };
      }
      continue;
    }
    const midpoint = rect.left + rect.width / 2;
    const before = x < midpoint;
    if (x > rect.left + rect.width) continue;
    const index = rest.indexOf(tab) + (before || rect.id === undefined ? 0 : 1);
    const leftGroup = rest[index - 1]?.groupId;
    const rightGroup = rest[index]?.groupId;
    const groupId = rect.id === undefined && x < rect.left ? null : leftGroup && leftGroup === rightGroup ? leftGroup
      : source?.groupId && (leftGroup === source.groupId || rightGroup === source.groupId) ? source.groupId : null;
    const center = x >= rect.left + (rect.id === undefined ? 0 : rect.width * .28) && x <= rect.left + (rect.id === undefined ? rect.width : rect.width * .72);
    const canGroup = source && source.id !== tab.id && (!source.groupId || source.groupId !== tab.groupId) && Boolean(source.browser?.private) === Boolean(tab.browser?.private);
    if (rect.groupId && groups.length && center && source?.groupId !== rect.groupId && Boolean(source?.browser?.private) === Boolean(tab.browser?.private)) {
      return { index, groupId, nestGroupId: rect.groupId, markerX: rect.left };
    }
    const aiEnd = rest.findLastIndex(tab => isInTabGroup(groups, tab.groupId, AI_TAB_GROUP_ID)) + 1;
    const afterAi = !groupId && index < aiEnd;
    const markerX = afterAi ? Math.max(...candidates.filter(candidate => candidate.id !== undefined
      ? rest.some(tab => tab.id === candidate.id && isInTabGroup(groups, tab.groupId, AI_TAB_GROUP_ID))
      : isInTabGroup(groups, candidate.groupId, AI_TAB_GROUP_ID)).map(candidate => candidate.left + candidate.width))
      : before ? rect.left : rect.left + rect.width;
    return { index: afterAi ? aiEnd : index, groupId, markerX,
      ...(center && canGroup ? { groupTargetId: tab.id } : {}) };
  }
  const last = candidates[candidates.length - 1];
  return { index: rest.length, groupId: null, markerX: last ? last.left + last.width : 8 };
}
