import type { DesktopTabView } from "./desktop-browser-tabs";

export interface TabDropRect { id?: number; groupId?: string; left: number; width: number }
export interface TabDropTarget {
  index: number;
  groupId: string | null;
  groupTargetId?: number;
  markerX: number;
}

/** Whole groups land between other groups/tabs, never inside another group. */
export function tabGroupDropTarget(tabs: DesktopTabView[], rects: TabDropRect[], groupId: string, x: number): TabDropTarget {
  const rest = tabs.filter(tab => tab.groupId !== groupId);
  let markerX = rects.find(rect => rect.groupId === groupId)?.left ?? 8;
  for (let index = 0; index < rest.length;) {
    const first = rest[index];
    let end = index + 1;
    if (first.groupId) while (end < rest.length && rest[end].groupId === first.groupId) end++;
    const ids = new Set(rest.slice(index, end).map(tab => tab.id));
    const blockRects = rects.filter(rect => rect.id !== undefined ? ids.has(rect.id) : Boolean(first.groupId) && rect.groupId === first.groupId);
    if (blockRects.length) {
      const left = Math.min(...blockRects.map(rect => rect.left));
      const right = Math.max(...blockRects.map(rect => rect.left + rect.width));
      if (x < (left + right) / 2) return { index, groupId: null, markerX: left };
      if (x <= right) return { index: end, groupId: null, markerX: right };
      markerX = right;
    }
    index = end;
  }
  return { index: rest.length, groupId: null, markerX };
}

/** Uses the geometry captured before the drag, so preview movement cannot move its own hit targets. */
export function tabDropTarget(tabs: DesktopTabView[], rects: TabDropRect[], draggedId: number, x: number): TabDropTarget {
  const source = tabs.find(tab => tab.id === draggedId);
  const rest = tabs.filter(tab => tab.id !== draggedId);
  const candidates = rects.filter(rect => rect.id !== draggedId);
  for (const rect of candidates) {
    const tab = rect.id === undefined ? rest.find(tab => tab.groupId === rect.groupId) : rest.find(tab => tab.id === rect.id);
    if (!tab) continue;
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
    return { index, groupId, markerX: before ? rect.left : rect.left + rect.width,
      ...(center && canGroup ? { groupTargetId: tab.id } : {}) };
  }
  const last = candidates[candidates.length - 1];
  return { index: rest.length, groupId: null, markerX: last ? last.left + last.width : 8 };
}
