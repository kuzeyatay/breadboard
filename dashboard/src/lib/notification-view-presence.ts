import type { ChatNotificationTarget } from './chat-notification-inbox';
import type { DesktopTabsState } from './desktop-browser-tabs';

// Only live viewing state is shared here. Read/dismissed notifications still
// belong to the account's server-side inbox. Abandoned leases expire quickly.
const STORAGE_PREFIX = 'breadboard:notification-view:v1:';
const HEARTBEAT_MS = 4_000;
const LEASE_MS = 15_000;
type ViewLease = { targets: ChatNotificationTarget[]; inlineSelectionIds?: string[]; expiresAt: number };
let targets: ChatNotificationTarget[] = [];
const inlineSelections = new Map<symbol, string>();
let desktopState: DesktopTabsState | undefined;
let pageHidden = false;
let storageKey: string | undefined;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();

export function isNotificationPageActive(): boolean {
  if (typeof document === 'undefined' || pageHidden) return false;
  // Focus can be in native browser content, the address bar, or the overlay;
  // document.hasFocus() alone misidentifies all of those desktop cases.
  if (desktopState?.selfId != null) {
    return desktopState.selfId === desktopState.activeId &&
      desktopState.windowFocused !== false;
  }
  return document.visibilityState === 'visible' && document.hasFocus();
}

function changed(): void {
  for (const listener of listeners) listener();
}

function publish(): void {
  if (!storageKey) return;
  try {
    if ((targets.length || inlineSelections.size) && isNotificationPageActive()) {
      window.localStorage.setItem(storageKey, JSON.stringify({
        targets, inlineSelectionIds: [...inlineSelections.values()], expiresAt: Date.now() + LEASE_MS,
      } satisfies ViewLease));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch { /* Local suppression still works when storage is unavailable. */ }
  changed();
}

function start(): void {
  if (stop || typeof window === 'undefined') return;
  const id = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  storageKey = `${STORAGE_PREFIX}${id}`;
  const onHide = () => { pageHidden = true; publish(); };
  const onShow = () => { pageHidden = false; publish(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) changed();
  };
  window.addEventListener('focus', publish);
  window.addEventListener('blur', publish);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', publish);
  const timer = window.setInterval(publish, HEARTBEAT_MS);
  const desktop = (window as Window & {
    breadboardDesktop?: {
      getTabsState?: () => Promise<DesktopTabsState>;
      onTabsState?: (callback: (state: DesktopTabsState) => void) => () => void;
    };
  }).breadboardDesktop;
  let disposed = false;
  let receivedState = false;
  const unsubscribe = desktop?.onTabsState?.((state) => {
    receivedState = true;
    desktopState = state;
    publish();
  });
  void desktop?.getTabsState?.().then((state) => {
    if (disposed || receivedState) return;
    desktopState = state;
    publish();
  }).catch(() => undefined);
  stop = () => {
    disposed = true;
    unsubscribe?.();
    window.clearInterval(timer);
    window.removeEventListener('focus', publish);
    window.removeEventListener('blur', publish);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', publish);
    try { window.localStorage.removeItem(storageKey!); } catch { /* optional storage */ }
    desktopState = undefined;
    storageKey = undefined;
    pageHidden = false;
    stop = undefined;
  };
  publish();
}

function stopIfUnused(): void {
  if (!targets.length && !inlineSelections.size && !listeners.size) stop?.();
}

/** A visible Ask Here answer may belong to a conversation outside the main chat. */
export function registerInlineSelectionNotificationView(selectionId: string): () => void {
  const owner = Symbol(selectionId);
  inlineSelections.set(owner, selectionId);
  start();
  publish();
  return () => { inlineSelections.delete(owner); publish(); stopIfUnused(); };
}

export function setNotificationViewTargets(next: ChatNotificationTarget[]): void {
  targets = next;
  start();
  publish();
  stopIfUnused();
}

export function subscribeNotificationViews(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); stopIfUnused(); };
}

/** Read synchronously before displaying an inbox response, including in a
 * newly created overlay that missed the page's original opened event. */
export function readNotificationViewTargets(): unknown[] {
  const viewed: unknown[] = isNotificationPageActive() ? [...targets] : [];
  if (typeof window === 'undefined') return viewed;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX) || key === storageKey) continue;
      try {
        const lease = JSON.parse(storage.getItem(key) ?? 'null') as ViewLease | null;
        if (lease && Number.isFinite(lease.expiresAt) &&
            lease.expiresAt > Date.now() && lease.expiresAt <= Date.now() + LEASE_MS &&
            Array.isArray(lease.targets)) viewed.push(...lease.targets);
      } catch { /* Ignore incomplete or stale leases from another renderer. */ }
    }
  } catch { /* Local suppression still works without storage. */ }
  return viewed;
}

/** Includes visible answers in other renderers, such as the native toast overlay. */
export function isInlineSelectionNotificationViewed(selectionId: string): boolean {
  if (isNotificationPageActive() && [...inlineSelections.values()].includes(selectionId)) return true;
  if (typeof window === 'undefined') return false;
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX) || key === storageKey) continue;
      try {
        const lease = JSON.parse(storage.getItem(key) ?? 'null') as ViewLease | null;
        if (lease && Number.isFinite(lease.expiresAt) &&
            lease.expiresAt > Date.now() && lease.expiresAt <= Date.now() + LEASE_MS &&
            Array.isArray(lease.inlineSelectionIds) && lease.inlineSelectionIds.includes(selectionId)) return true;
      } catch { /* Ignore stale or incomplete leases. */ }
    }
  } catch { /* Local suppression still works without storage. */ }
  return false;
}
