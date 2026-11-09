import { screen, WebContentsView, type BrowserWindow, type Rectangle, type View, type WebContents } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

type Watch = { window: BrowserWindow; handle: string; changed: () => void };
const watches = new Set<Watch>();
let helper: ChildProcessWithoutNullStreams | undefined;
let snapshot: Record<string, Rectangle[]> = {};
let receivedAt = 0;
let startedAt = 0;
let retryAt = 0;
let timer: ReturnType<typeof setInterval> | undefined;
// Electron 33 has setVisible() without a getter. Record the application's own
// native visibility changes so a hidden sibling cannot cover another surface.
const viewVisibility = new WeakMap<View, boolean>();
type PaintedRegions = { selector: string; rects: Rectangle[]; sampledAt: number; nextAt: number; pending: boolean; generation: number };
const paintedRegions = new WeakMap<WebContents, PaintedRegions>();

/** Runs in a trusted transparent renderer. Return geometry only, never content.
 * Selectors name painted cards/controls, not transparent page-sized wrappers. */
export function readNotificationPaintedRects(selector: string): Rectangle[] {
  const result: Rectangle[] = [];
  for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 128)) {
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), top = Math.max(0, box.top);
    let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    let ancestor: Element | null = element;
    let depth = 0;
    let containingBlock: 'absolute' | 'fixed' | undefined;
    while (ancestor && ++depth <= 32) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') {
        right = left; break;
      }
      if (containingBlock && style.display !== 'contents' && (
        (containingBlock === 'absolute' && style.position !== 'static') ||
        [style.transform, style.perspective, style.filter, style.backdropFilter, style.translate, style.rotate, style.scale]
          .some(value => value && value !== 'none') ||
        /(?:layout|paint|strict|content)/.test(style.contain) ||
        /(?:transform|perspective|filter|contain)/.test(style.willChange) || style.contentVisibility === 'auto'
      )) containingBlock = undefined;
      if (ancestor !== element && !containingBlock) {
        const bounds = ancestor.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
          left = Math.max(left, bounds.left + ancestor.clientLeft);
          right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
          top = Math.max(top, bounds.top + ancestor.clientTop);
          bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
      if (!containingBlock && (style.position === 'fixed' || style.position === 'absolute')) containingBlock = style.position;
      ancestor = ancestor.parentElement;
    }
    if (!ancestor && right > left && bottom > top) result.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return result;
}

/** Register only the app's known transparent native surfaces. There is no
 * renderer-callable API and no sampling of arbitrary websites. */
export function trackTransparentNotificationView(view: WebContentsView, selector: string): void {
  const contents = view.webContents;
  if (paintedRegions.has(contents)) return;
  const state: PaintedRegions = { selector, rects: [], sampledAt: 0, nextAt: 0, pending: false, generation: 0 };
  paintedRegions.set(contents, state);
  const reset = () => { state.generation++; state.rects = []; state.sampledAt = 0; state.nextAt = 0; };
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) reset(); });
  contents.on('render-process-gone', reset);
}

function paintedCover(view: WebContentsView, bounds: Rectangle, clip: Rectangle): Rectangle[] {
  const contents = view.webContents;
  const state = paintedRegions.get(contents);
  if (!state) return [clip];
  const now = Date.now();
  // Reuse the last sample between native visibility pulses. Never overlap
  // queries, including a stalled renderer; detached/hidden views never get here.
  if (!state.pending && now >= state.nextAt) {
    state.pending = true; state.nextAt = now + 150;
    const generation = state.generation;
    void contents.executeJavaScript(`(${readNotificationPaintedRects.toString()})(${JSON.stringify(state.selector)})`)
      .then((value: unknown) => {
        if (contents.isDestroyed() || generation !== state.generation) return;
        if (!Array.isArray(value) || value.length > 128 || !value.every(rect => rect &&
            ['x', 'y', 'width', 'height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) &&
            rect.width > 0 && rect.height > 0)) return;
        const changed = JSON.stringify(state.rects) !== JSON.stringify(value);
        state.rects = value; state.sampledAt = Date.now();
        if (changed) pulse();
      }).catch(() => { /* A replaced/stalled document must not retain a cover indefinitely. */ })
      .finally(() => { state.pending = false; });
  }
  // An unknown mask must not acknowledge an answer through a possibly opaque
  // panel. The delivery settle window allows the first fresh geometry sample;
  // detached, hidden and destroyed native views are excluded before this call.
  if (!state.sampledAt || now - state.sampledAt > 1_000) return [clip];
  const zoom = contents.getZoomFactor();
  return state.rects.flatMap(rect => {
    const visible = intersectNotificationRects(clip, { x: bounds.x + rect.x * zoom, y: bounds.y + rect.y * zoom,
      width: rect.width * zoom, height: rect.height * zoom });
    return visible ? [visible] : [];
  });
}

export function setNotificationViewVisible(view: View, visible: boolean): void {
  view.setVisible(visible);
  viewVisibility.set(view, visible);
}

export function intersectNotificationRects(a: Rectangle, b: Rectangle): Rectangle | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function pulse(): void { for (const watch of watches) if (!watch.window.isDestroyed()) watch.changed(); }
function configure(): void { helper?.stdin.write([...watches].map(w => w.handle).join(',') + '\n'); }
function ensureHelper(): void {
  if (helper || !watches.size || Date.now() < retryAt) return;
  const executable = path.join(__dirname, '../native/windows-visible-region.exe')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const child = spawn(executable, [], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
  });
  helper = child;
  startedAt = Date.now();
  let buffer = '';
  const failed = () => {
    if (helper !== child) return;
    helper = undefined; snapshot = {}; receivedAt = 0; retryAt = Date.now() + 5_000;
    child.kill(); pulse();
  };
  child.on('error', failed); child.on('exit', failed); child.stdin.on('error', failed);
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 1_048_576) { failed(); return; }
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid regions');
        const next: Record<string, Rectangle[]> = {};
        for (const { handle } of watches) {
          const rects = (value as Record<string, unknown>)[handle];
          if (rects === undefined) continue; // registration reached the helper after this sample
          if (!Array.isArray(rects) || rects.length > 4096 || !rects.every(r => r &&
            ['x', 'y', 'width', 'height'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key])) &&
            r.width > 0 && r.height > 0)) throw new Error('Invalid rectangle');
          next[handle] = rects;
        }
        snapshot = next; receivedAt = Date.now(); pulse();
      } catch { failed(); return; }
    }
  });
  configure();
}

/** One read-only helper for all native windows; a stalled helper cannot claim a read. */
export function watchNotificationVisibility(window: BrowserWindow, changed: () => void): () => void {
  if (process.platform !== 'win32') return () => {};
  const native = window.getNativeWindowHandle();
  const handle = native.length === 8 ? native.readBigUInt64LE().toString() : String(native.readUInt32LE());
  const watch = { window, handle, changed };
  watches.add(watch); ensureHelper(); configure();
  timer ??= setInterval(() => {
    if (helper && Date.now() - (receivedAt || startedAt) > 1_000) {
      snapshot = {}; receivedAt = 0; const old = helper; helper = undefined; old?.kill(); pulse();
    }
    ensureHelper();
  }, 500);
  timer.unref();
  return () => {
    watches.delete(watch); delete snapshot[handle];
    if (watches.size) configure();
    else {
      clearInterval(timer); timer = undefined;
      const old = helper; helper = undefined; old?.stdin.end(); old?.kill();
      snapshot = {}; receivedAt = 0;
    }
  };
}

function subtractRect(area: Rectangle, cover: Rectangle): Rectangle[] {
  const cut = intersectNotificationRects(area, cover);
  if (!cut) return [area];
  return [
    { x: area.x, y: area.y, width: area.width, height: cut.y - area.y },
    { x: area.x, y: cut.y + cut.height, width: area.width, height: area.y + area.height - cut.y - cut.height },
    { x: area.x, y: cut.y, width: cut.x - area.x, height: cut.height },
    { x: cut.x + cut.width, y: cut.y, width: area.x + area.width - cut.x - cut.width, height: cut.height },
  ].filter(rect => rect.width > 0 && rect.height > 0);
}

function contentsBox(window: BrowserWindow, contents: WebContents): { bounds: Rectangle; clips: Rectangle[] } | undefined {
  const [width = 0, height = 0] = window.getContentSize();
  const viewport = { x: 0, y: 0, width, height };
  const layers: Array<{ contents: WebContents; bounds: Rectangle; clip: Rectangle; covers: Rectangle[] }> = [
    { contents: window.webContents, bounds: viewport, clip: viewport, covers: [viewport] },
  ];
  function collect(parent: View, offset: Rectangle, clip: Rectangle): void {
    for (const view of parent.children) {
      if (viewVisibility.get(view) === false) continue;
      const local = view.getBounds();
      const bounds = { ...local, x: offset.x + local.x, y: offset.y + local.y };
      const visible = intersectNotificationRects(clip, bounds);
      if (!visible) continue;
      if (view instanceof WebContentsView && !view.webContents.isDestroyed()) {
        layers.push({ contents: view.webContents, bounds, clip: visible, covers: paintedCover(view, bounds, visible) });
      }
      collect(view, bounds, visible);
    }
  }
  collect(window.contentView, viewport, viewport);
  const index = layers.findIndex(layer => layer.contents === contents);
  if (index < 0) return;
  const own = layers[index]!;
  let clips = [own.clip];
  // Later children paint above earlier ones, including children of a later
  // parent View. DOM hit-testing cannot see these separate native renderers.
  for (const above of layers.slice(index + 1)) {
    for (const cover of above.covers) {
      clips = clips.flatMap(rect => subtractRect(rect, cover));
      if (clips.length > 4096) return { bounds: own.bounds, clips: [] };
    }
    if (!clips.length) break;
  }
  return { bounds: own.bounds, clips };
}

/** Uncovered regions in this renderer's CSS viewport (including nested native views and zoom). */
export function notificationVisibleRects(window: BrowserWindow, contents: WebContents): Rectangle[] | undefined {
  if (process.platform !== 'win32') return undefined;
  if (window.isDestroyed() || contents.isDestroyed() || !window.isVisible() || window.isMinimized() ||
      !receivedAt || Date.now() - receivedAt > 1_000) return [];
  const watch = [...watches].find(w => w.window === window);
  const regions = watch && snapshot[watch.handle];
  if (!regions?.length) return [];
  const box = contentsBox(window, contents);
  if (!box) return [];
  const origin = window.getContentBounds();
  const zoom = contents.getZoomFactor();
  return box.clips.flatMap(area => {
    const clip = screen.dipToScreenRect(window, { ...area, x: origin.x + area.x, y: origin.y + area.y });
    return regions.flatMap(region => {
      const visible = intersectNotificationRects(region, clip);
      if (!visible) return [];
      const dip = screen.screenToDipRect(window, visible);
      return [{ x: (dip.x - origin.x - box.bounds.x) / zoom, y: (dip.y - origin.y - box.bounds.y) / zoom,
        width: dip.width / zoom, height: dip.height / zoom }];
    });
  });
}
