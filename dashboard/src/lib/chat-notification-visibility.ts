/** Stable aliases shared by persisted messages and every transcript renderer. */
export function notificationMessageKeys(message: {
  id?: string | number | null;
  clientMessageId?: string | null;
  entryId?: string | null;
}): string[] {
  return [
    ...(message.id != null && (!message.clientMessageId && !message.entryId || /^\d+$/.test(String(message.id)))
      ? [`message:${String(message.id).replace(/^server:/, '')}`] : []),
    ...(message.clientMessageId ? [`client:${message.clientMessageId}`] : []),
    ...(message.entryId ? [`entry:${message.entryId}`] : []),
  ];
}

type VisibleRect = { x: number; y: number; width: number; height: number };
const nativeRegions = new WeakMap<Window, readonly VisibleRect[]>();

/** Native regions belong to the bridge's host, which may contain an editor iframe. */
export function setNotificationVisibleRects(host: Window, rects: readonly VisibleRect[] | undefined): void {
  if (rects === undefined) nativeRegions.delete(host);
  else nativeRegions.set(host, rects);
}

function intersect(a: VisibleRect, b: VisibleRect): VisibleRect[] {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
}

function uncoveredAreas(view: Window, area: VisibleRect): VisibleRect[] {
  const regions = nativeRegions.get(view);
  const local = regions === undefined ? [area] : regions.flatMap(region => intersect(area, region));
  try {
    const frame = view.frameElement as HTMLElement | null;
    if (!frame) return local;
    const parent = frame.ownerDocument.defaultView;
    if (!parent) return [];
    const bounds = frame.getBoundingClientRect();
    const sx = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
    const sy = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
    if (sx <= 0 || sy <= 0) return [];
    const ox = bounds.left + frame.clientLeft * sx, oy = bounds.top + frame.clientTop * sy;
    return local.flatMap(r => uncoveredAreas(parent, {
      x: ox + r.x * sx, y: oy + r.y * sy, width: r.width * sx, height: r.height * sy,
    }).map(r => ({ x: (r.x - ox) / sx, y: (r.y - oy) / sy, width: r.width / sx, height: r.height / sy })));
  } catch { return []; }
}

/** A mounted row is not evidence of viewing: account for clipping and covers. */
export function isNotificationElementVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const owner = element.ownerDocument;
  const view = owner.defaultView;
  if (!view) return false;
  const viewport = view.visualViewport;
  let left = viewport?.offsetLeft ?? 0;
  let top = viewport?.offsetTop ?? 0;
  let right = left + (viewport?.width ?? view.innerWidth);
  let bottom = top + (viewport?.height ?? view.innerHeight);
  const rect = element.getBoundingClientRect();
  left = Math.max(left, rect.left); top = Math.max(top, rect.top);
  right = Math.min(right, rect.right); bottom = Math.min(bottom, rect.bottom);
  let containingBlock: 'absolute' | 'fixed' | undefined;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (node.hidden || node.inert || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    // A fixed dock/absolute popover escapes overflow ancestors between it and
    // its containing block. Clipping those boxes hides readable chat pixels
    // from this check even though the browser paints them above the page.
    // https://www.w3.org/TR/CSS2/visufx.html#overflow-clipping
    if (containingBlock && style.display !== 'contents' && (
      (containingBlock === 'absolute' && style.position !== 'static') ||
      [style.transform, style.perspective, style.filter, style.backdropFilter,
        style.translate, style.rotate, style.scale].some(value => value && value !== 'none') ||
      /(?:layout|paint|strict|content)/.test(style.contain) ||
      /(?:transform|perspective|filter|contain)/.test(style.willChange) ||
      style.contentVisibility === 'auto'
    )) containingBlock = undefined;
    if (node !== element && !containingBlock) {
      const clip = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, clip.left); right = Math.min(right, clip.right);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
      }
    }
    if (!containingBlock && (style.position === 'fixed' || style.position === 'absolute')) containingBlock = style.position;
  }
  if (rect.width <= 0 || rect.height <= 0 || right <= left || bottom <= top) return false;
  // Intersect before sampling, so a readable strip beside another app is not
  // missed simply because all sample points of the full answer were covered.
  for (const area of uncoveredAreas(view, { x: left, y: top, width: right - left, height: bottom - top })) {
    if (area.width < Math.min(24, rect.width) || area.height < Math.min(16, rect.height)) continue;
    for (const x of [0.25, 0.5, 0.75]) for (const y of [0.2, 0.5, 0.8]) {
      const px = area.x + area.width * x, py = area.y + area.height * y;
      const hit = owner.elementFromPoint(px, py);
      if (hit && (hit === element || element.contains(hit)) && framePointVisible(view, px, py)) return true;
    }
  }
  return false;
}

/** Same-origin document assistants live in iframes; test their pixels in every host. */
function framePointVisible(view: Window, x: number, y: number): boolean {
  try {
    const frame = view.frameElement as HTMLElement | null;
    if (!frame) return true;
    const parent = frame.ownerDocument.defaultView;
    if (!parent || !isNotificationElementVisible(frame)) return false;
    const bounds = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1;
    const px = bounds.left + (frame.clientLeft + x) * scaleX;
    const py = bounds.top + (frame.clientTop + y) * scaleY;
    return frame.ownerDocument.elementFromPoint(px, py) === frame && framePointVisible(parent, px, py);
  } catch { return false; }
}

export function notificationHostWindows(): Window[] {
  const hosts: Window[] = [window];
  try {
    let current: Window = window;
    while (current.parent !== current && current.frameElement) {
      current = current.parent;
      hosts.push(current);
    }
  } catch { /* Cross-origin frames cannot establish host visibility. */ }
  return hosts;
}

export function visibleNotificationMessageKeys(targetKeys: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const root of document.querySelectorAll<HTMLElement>('[data-notification-chat]')) {
    if (!targetKeys.includes(root.dataset.notificationChat ?? '')) continue;
    for (const message of root.querySelectorAll<HTMLElement>('[data-notification-message]')) {
      // Nested side chats belong to their own conversation.
      if (message.closest('[data-notification-chat]') !== root) continue;
      const answers = message.querySelectorAll<HTMLElement>('[data-chat-selectable-message]');
      // Thinking/tool activity above the answer does not count as seeing it.
      if (answers.length ? ![...answers].some(isNotificationElementVisible) : !isNotificationElementVisible(message)) continue;
      try {
        const aliases: unknown = JSON.parse(message.dataset.notificationMessage ?? 'null');
        if (Array.isArray(aliases)) for (const key of aliases) if (typeof key === 'string') keys.add(key);
      } catch { /* An incomplete render is not evidence of a read. */ }
    }
  }
  return [...keys];
}
