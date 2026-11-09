import type { ChatNotificationTarget } from './chat-notification-inbox';
import type { DesktopTabsState } from './desktop-browser-tabs';
import { isNotificationElementVisible, visibleNotificationMessageKeys, notificationHostWindows, setNotificationVisibleRects } from './chat-notification-visibility.ts';
import { acknowledgeVisibleChatMessages } from './chat-notification-receipts.ts';

// Only live viewing state is shared here. Read/dismissed notifications still
// belong to the account's server-side inbox. Abandoned leases expire quickly.
const STORAGE_PREFIX = 'breadboard:notification-view:v1:';
const HEARTBEAT_MS = 4_000;
const LEASE_MS = 15_000;
type ViewLease = { targets: ChatNotificationTarget[]; inlineSelectionIds?: string[]; expiresAt: number };
let targets: ChatNotificationTarget[] = [];
const inlineSelections = new Map<symbol, { id: string; element?: HTMLElement }>();
let desktopState: DesktopTabsState | undefined;
let pageHidden = false;
let storageKey: string | undefined;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();
let targetSnapshot: ChatNotificationTarget[] | undefined;

export function isNotificationPageActive(): boolean {
  if (typeof document === 'undefined' || pageHidden) return false;
  if (desktopState?.notificationVisibleRects !== undefined) {
    const presented = desktopState.notificationPageVisible ?? (desktopState.selfId != null &&
      (desktopState.visibleIds ?? [desktopState.visibleId !== undefined ? desktopState.visibleId : desktopState.activeId]).includes(desktopState.selfId));
    // Uncovered pixels prove the answer *can* be seen, not that anyone is
    // looking. A Breadboard window beside the app that has focus still gets
    // the OS alert and the chime; focusing it retires the notice.
    return presented && desktopState.windowFocused !== false && desktopState.notificationVisibleRects.length > 0;
  }
  if (desktopState?.notificationPageVisible !== undefined) {
    return desktopState.notificationPageVisible && desktopState.windowFocused === true;
  }
  // Focus can be in native browser content, the address bar, or the overlay;
  // document.hasFocus() alone misidentifies all of those desktop cases.
  if (desktopState?.selfId != null) {
    const visible = desktopState.visibleIds ?? [desktopState.visibleId !== undefined
      ? desktopState.visibleId : desktopState.activeId];
    return visible.includes(desktopState.selfId) &&
      desktopState.windowFocused !== false;
  }
  return document.visibilityState === 'visible' && (notificationHostWindows().at(-1)?.document ?? document).hasFocus();
}

function currentTargets(): ChatNotificationTarget[] {
  if (!isNotificationPageActive()) return [];
  if (targetSnapshot) return targetSnapshot;
  // One geometry read per JS turn, shared by toast, voice and unread consumers.
  queueMicrotask(() => { targetSnapshot = undefined; });
  return targetSnapshot = targets.map(target => target.observeMessages ? {
    ...target,
    visibleMessageKeys: visibleNotificationMessageKeys([
      target.surface === 'garden_chat' ? `garden_chat:${target.gardenSlug}:${target.chatId}` : `dashboard_terminal:${target.chatId}`,
      ...(target.conversationId ? [`dashboard_terminal:${target.conversationId}`] : []),
    ]),
  } : target);
}

function currentInlineSelections(): string[] {
  return isNotificationPageActive() ? [...inlineSelections.values()]
    .filter(view => !view.element || isNotificationElementVisible(view.element)).map(view => view.id) : [];
}

function changed(): void {
  for (const listener of listeners) listener();
}

function publish(): void {
  if (!storageKey) return;
  targetSnapshot = undefined;
  const visibleTargets = currentTargets();
  acknowledgeVisibleChatMessages(visibleTargets);
  try {
    if ((targets.length || inlineSelections.size) && isNotificationPageActive()) {
      window.localStorage.setItem(storageKey, JSON.stringify({
        targets: visibleTargets, inlineSelectionIds: currentInlineSelections(), expiresAt: Date.now() + LEASE_MS,
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
  // Scrolls, virtualization, drawers and modal covers can change what is seen
  // without changing the selected chat. Coalesce geometry work into one frame.
  let frame = 0;
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; publish(); }); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'inert', 'open', 'data-notification-chat', 'data-notification-message'] });
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  const timer = window.setInterval(publish, HEARTBEAT_MS);
  const hosts = notificationHostWindows();
  for (const host of hosts.slice(1)) {
    host.addEventListener('focus', publish);
    host.addEventListener('blur', publish);
    host.addEventListener('scroll', schedule, true);
    host.addEventListener('resize', schedule);
    host.document.addEventListener('visibilitychange', publish);
  }
  type VisibilityHost = Window & {
    breadboardNotificationVisibility?: {
      getState: () => Promise<DesktopTabsState>;
      onState: (callback: (state: DesktopTabsState) => void) => () => void;
    };
    breadboardDesktop?: {
      getTabsState?: () => Promise<DesktopTabsState>;
      onTabsState?: (callback: (state: DesktopTabsState) => void) => () => void;
    };
  };
  const desktopHost = hosts.find(host => (host as VisibilityHost).breadboardNotificationVisibility || (host as VisibilityHost).breadboardDesktop);
  const standalone = (desktopHost as VisibilityHost | undefined)?.breadboardNotificationVisibility;
  const desktop = standalone ? { getTabsState: standalone.getState, onTabsState: standalone.onState }
    : (desktopHost as VisibilityHost | undefined)?.breadboardDesktop;
  let disposed = false;
  let receivedState = false;
  const unsubscribe = desktop?.onTabsState?.((state) => {
    receivedState = true;
    desktopState = state;
    if (desktopHost) setNotificationVisibleRects(desktopHost, state.notificationVisibleRects);
    publish();
  });
  void desktop?.getTabsState?.().then((state) => {
    if (disposed || receivedState) return;
    desktopState = state;
    if (desktopHost) setNotificationVisibleRects(desktopHost, state.notificationVisibleRects);
    publish();
  }).catch(() => undefined);
  stop = () => {
    disposed = true;
    unsubscribe?.();
    window.clearInterval(timer);
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    for (const host of hosts.slice(1)) {
      host.removeEventListener('focus', publish);
      host.removeEventListener('blur', publish);
      host.removeEventListener('scroll', schedule, true);
      host.removeEventListener('resize', schedule);
      host.document.removeEventListener('visibilitychange', publish);
    }
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    window.removeEventListener('focus', publish);
    window.removeEventListener('blur', publish);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', publish);
    try { window.localStorage.removeItem(storageKey!); } catch { /* optional storage */ }
    desktopState = undefined;
    if (desktopHost) setNotificationVisibleRects(desktopHost, undefined);
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
export function registerInlineSelectionNotificationView(selectionId: string, element?: HTMLElement): () => void {
  const owner = Symbol(selectionId);
  inlineSelections.set(owner, { id: selectionId, element });
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
  const viewed: unknown[] = currentTargets();
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
  if (currentInlineSelections().includes(selectionId)) return true;
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
