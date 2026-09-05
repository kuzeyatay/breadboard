/**
 * Browser navigation: the tabs a desktop window carries along its caption
 * strip, and the one switch that turns them off.
 *
 * The Electron shell owns the tabs. Each is a whole page of its own — its own
 * history, scroll position and running work — shown one at a time inside the
 * window. The page's part is small: draw the strip from the state the shell
 * sends, and ask for changes by command. Every page in a window receives the
 * same strip state plus its own identity, so a tab brought to the front
 * already has its strip drawn without replacing its page-local browser chrome.
 *
 * None of this exists in a browser. There the browser's own tabs do the job,
 * `desktopTabsBridge` comes back undefined, and callers fall back to ordinary
 * `target="_blank"` links.
 */

export interface DesktopTabView {
  id: number;
  /** Optional when connected to an older desktop shell. */
  anchored?: boolean;
  title: string;
  url: string;
  loading: boolean;
  browser?: {
    address: string;
    canGoBack: boolean;
    canGoForward: boolean;
    terminalOpen: boolean;
    terminalWidth: number;
    zoomPercent?: number;
    translation?: { status: "original" | "translating" | "translated" | "error"; language: string; translated: number; error?: string };
    find?: { matches: number; activeMatchOrdinal: number };
    favicon?: string;
    selection?: {
      text: string;
      title: string;
      url: string;
    };
  };
}

export interface DesktopTabsState {
  /** The Profile switch. Off, the strip is empty and every shortcut is inert. */
  enabled: boolean;
  activeId: number | null;
  /** The shell retains the visible page until the destination paints. */
  navigationPending?: boolean;
  /** The receiving page's own tab. Optional for older desktop shells. */
  selfId?: number | null;
  tabs: DesktopTabView[];
  extensions: DesktopBrowserExtension[];
  browserPreferences?: { notificationsEnabled: boolean; sites: Record<string, "granted" | "denied">; translationLanguage: string };
}

export interface DesktopBrowserExtension {
  id: string;
  name: string;
  version: string;
}

export type DesktopTabsCommand =
  | { type: "browser-notifications-enabled"; enabled: boolean }
  | { type: "browser-notification-permission"; origin: string; permission: "default" | "granted" | "denied" }
  | { type: "browser-translation-language"; language: string }
  | { type: "browser-translate"; language: string }
  | { type: "browser-translation-menu" }
  | { type: "browser-translation-restore" }
  | { type: "browser-notification-action"; id: string; action: "click" | "close" }
  | { type: "open"; url: string; background?: boolean }
  | { type: "new" }
  | { type: "activate"; id: number }
  | { type: "close"; id?: number }
  | { type: "anchor"; id: number }
  | { type: "move"; id: number; index: number }
  | { type: "reopen" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "browser"; url?: string; replaceCurrent?: boolean }
  | { type: "browser-agent"; runId: string; url?: string }
  | { type: "browser-navigate"; input: string }
  | { type: "browser-stop" }
  | { type: "browser-menu"; x: number; y: number; profileLabel: string }
  | { type: "browser-find"; text: string; forward?: boolean; findNext?: boolean }
  | { type: "browser-find-close" }
  | { type: "browser-terminal"; open: boolean; width?: number }
  | { type: "browser-address-suggestions"; open: boolean }
  | { type: "browser-extension-load" }
  | { type: "browser-extension-reload"; id: string }
  | { type: "browser-extension-remove"; id: string };

export interface DesktopTabsBridge {
  getTabsState: () => Promise<DesktopTabsState>;
  onTabsState: (listener: (state: DesktopTabsState) => void) => () => void;
  tabs: (command: DesktopTabsCommand) => Promise<boolean>;
}

interface DesktopNavigationBridge {
  getBrowserNavigation?: () => Promise<boolean>;
  setBrowserNavigation?: (enabled: boolean) => Promise<boolean>;
  getBrowserBookmarks?: (ownerKey: string) => Promise<DesktopBrowserBookmark[] | null>;
  setBrowserBookmarks?: (
    ownerKey: string,
    bookmarks: DesktopBrowserBookmark[],
  ) => Promise<boolean>;
  getBrowserShortcuts?: (ownerKey: string) => Promise<DesktopBrowserBookmark[] | null>;
  setBrowserShortcuts?: (ownerKey: string, shortcuts: DesktopBrowserBookmark[]) => Promise<boolean>;
  getBrowserRecentSearches?: (ownerKey: string) => Promise<string[] | null>;
  getBrowserHistory?: () => Promise<DesktopBrowserHistorySnapshot>;
  browserHistoryCommand?: (command: DesktopBrowserHistoryCommand) => Promise<boolean>;
  onBrowserHistoryChanged?: (listener: () => void) => () => void;
  setBrowserRecentSearches?: (ownerKey: string, searches: string[]) => Promise<boolean>;
}

export interface DesktopBrowserBookmark {
  url: string;
  title: string;
  iconUrl: string;
}

export interface DesktopBrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface DesktopBrowserHistorySnapshot {
  items: DesktopBrowserHistoryEntry[];
  error: string | null;
}

export type DesktopBrowserHistoryCommand = { type: "clear" } | { type: "remove"; url: string };

export function browserHistoryControl() {
  const desktop = bridge();
  if (!desktop?.getBrowserHistory || !desktop.browserHistoryCommand || !desktop.onBrowserHistoryChanged) return null;
  return {
    read: () => desktop.getBrowserHistory!(),
    command: (command: DesktopBrowserHistoryCommand) => desktop.browserHistoryCommand!(command),
    subscribe: (listener: () => void) => desktop.onBrowserHistoryChanged!(listener),
  };
}

function bridge(): (Partial<DesktopTabsBridge> & DesktopNavigationBridge) | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window as Window & {
      breadboardDesktop?: Partial<DesktopTabsBridge> & DesktopNavigationBridge;
    }
  ).breadboardDesktop;
}

/** The shell's tabs, or undefined anywhere there is no shell. */
export function desktopTabsBridge(): DesktopTabsBridge | undefined {
  const desktop = bridge();
  if (
    !desktop ||
    typeof desktop.getTabsState !== "function" ||
    typeof desktop.onTabsState !== "function" ||
    typeof desktop.tabs !== "function"
  ) {
    return undefined;
  }
  return desktop as DesktopTabsBridge;
}

/**
 * Ask the shell to open `href` in a tab of this window. Resolves false when
 * there is no shell, the tabs are switched off, or the address is not one of
 * Breadboard's own — the caller then falls back to a window or a link.
 */
export function openInDesktopTab(
  href: string,
  options: { background?: boolean } = {},
): Promise<boolean> {
  const desktop = desktopTabsBridge();
  if (!desktop) return Promise.resolve(false);
  let url: string;
  try {
    url = new URL(href, window.location.href).toString();
  } catch {
    return Promise.resolve(false);
  }
  return desktop
    .tabs({ type: "open", url, background: options.background === true })
    .then((ok) => ok === true, () => false);
}

export function sendDesktopTabsCommand(command: DesktopTabsCommand): Promise<boolean> {
  const desktop = desktopTabsBridge();
  if (!desktop) return Promise.resolve(false);
  return desktop.tabs(command).then((ok) => ok === true, () => false);
}

/**
 * Ask the shell for its embedded Chromium browser. The page below Breadboard's
 * trusted toolbar is sandboxed and has no access to this preload bridge.
 */
export function openBrowserInDesktop(
  options: { url?: string; replaceCurrent?: boolean } = {},
): Promise<boolean> {
  return sendDesktopTabsCommand({
    type: "browser",
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.replaceCurrent ? { replaceCurrent: true } : {}),
  });
}

/** Open/focus the live built-in page controlled by one browser-agent run. */
export function openBrowserAgentRunInDesktop(
  runId: string,
  url?: string,
): Promise<boolean> {
  return sendDesktopTabsCommand({ type: "browser-agent", runId, ...(url ? { url } : {}) });
}

// ------------------------------------------------------------------- store

type Listener = () => void;

let snapshot: DesktopTabsState | null = null;
let detach: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
let connectionGeneration = 0;
let pushedStateRevision = 0;
const listeners = new Set<Listener>();

function publish(next: DesktopTabsState | null): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function clearBridgeRetry(): void {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleBridgeRetry(): void {
  if (retryTimer || listeners.size === 0 || retryAttempts >= 28) return;
  retryAttempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDesktopTabsBridge();
  }, 180);
}

function connectDesktopTabsBridge(): void {
  if (listeners.size === 0 || detach) return;
  const desktop = desktopTabsBridge();
  if (!desktop) {
    scheduleBridgeRetry();
    return;
  }

  clearBridgeRetry();
  retryAttempts = 0;
  const generation = ++connectionGeneration;
  const revisionBeforeRead = pushedStateRevision;
  try {
    detach = desktop.onTabsState((state) => {
      if (generation !== connectionGeneration) return;
      pushedStateRevision += 1;
      publish(state);
    });
  } catch {
    detach = null;
    scheduleBridgeRetry();
    return;
  }

  void desktop.getTabsState().then(
    (state) => {
      if (generation !== connectionGeneration) return;
      // Do not let a slower initial read overwrite a newer pushed update.
      if (pushedStateRevision === revisionBeforeRead) publish(state);
    },
    () => {
      if (generation !== connectionGeneration) return;
      const unsubscribe = detach;
      detach = null;
      connectionGeneration += 1;
      try {
        unsubscribe?.();
      } catch {
        // A bridge disappearing during a renderer reload is expected.
      }
      scheduleBridgeRetry();
    },
  );
}

/**
 * One subscription to the shell shared by every strip and menu on the page.
 * `useSyncExternalStore`-shaped so components read the same snapshot without
 * each asking the shell for it.
 */
export function subscribeDesktopTabs(listener: Listener): () => void {
  listeners.add(listener);
  connectDesktopTabsBridge();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearBridgeRetry();
      retryAttempts = 0;
      const unsubscribe = detach;
      detach = null;
      connectionGeneration += 1;
      try {
        unsubscribe?.();
      } catch {
        // The renderer or preload may already be gone.
      }
    }
  };
}

export function getDesktopTabsSnapshot(): DesktopTabsState | null {
  return snapshot;
}

/**
 * Re-read the window state after a renderer/preload race or a recovered shell.
 * The normal store subscription remains the source of truth; this is the
 * explicit escape hatch used by a recoverable browser startup screen.
 */
export async function refreshDesktopTabsState(): Promise<boolean> {
  const desktop = desktopTabsBridge();
  if (!desktop) {
    retryAttempts = 0;
    connectDesktopTabsBridge();
    return false;
  }
  try {
    publish(await desktop.getTabsState());
    return true;
  } catch {
    scheduleBridgeRetry();
    return false;
  }
}

// ------------------------------------------------------------------ switch

export interface BrowserNavigationControl {
  read(): Promise<boolean>;
  write(enabled: boolean): Promise<boolean>;
}

/** The Profile switch, or null anywhere there is no shell to hold the tabs. */
export function browserNavigationControl(): BrowserNavigationControl | null {
  const desktop = bridge();
  const read = desktop?.getBrowserNavigation;
  const write = desktop?.setBrowserNavigation;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    // An unanswerable read reports the tabs as on, which is what a shell that
    // has never been switched off actually does.
    read: () =>
      Promise.resolve(read.call(desktop)).then((enabled) => enabled !== false, () => true),
    write: (enabled) =>
      Promise.resolve(write.call(desktop, enabled)).then((ok) => ok === true, () => false),
  };
}

export interface BrowserBookmarksControl {
  /** Null means this profile has never had a desktop bookmark record. */
  read(): Promise<DesktopBrowserBookmark[] | null>;
  write(bookmarks: DesktopBrowserBookmark[]): Promise<boolean>;
}

/** Durable, profile-scoped bookmarks, or null in an ordinary web browser. */
export function browserBookmarksControl(ownerKey: string): BrowserBookmarksControl | null {
  const desktop = bridge();
  const read = desktop?.getBrowserBookmarks;
  const write = desktop?.setBrowserBookmarks;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    read: () => Promise.resolve().then(() => read.call(desktop, ownerKey)),
    write: (bookmarks) =>
      Promise.resolve().then(() => write.call(desktop, ownerKey, bookmarks)).then(
        (ok) => ok === true,
        () => false,
      ),
  };
}

export function browserRecentSearchesControl(ownerKey: string) {
  const desktop = bridge();
  const read = desktop?.getBrowserRecentSearches;
  const write = desktop?.setBrowserRecentSearches;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    read: (): Promise<string[] | null> => Promise.resolve().then(() => read.call(desktop, ownerKey)),
    write: (searches: string[]): Promise<boolean> =>
      Promise.resolve().then(() => write.call(desktop, ownerKey, searches)).then(
        (ok) => ok === true,
        () => false,
      ),
  };
}

export function browserShortcutsControl(ownerKey: string): BrowserBookmarksControl | null {
  const desktop = bridge();
  const read = desktop?.getBrowserShortcuts;
  const write = desktop?.setBrowserShortcuts;
  if (typeof read !== "function" || typeof write !== "function") return null;
  return {
    read: () => Promise.resolve().then(() => read.call(desktop, ownerKey)),
    write: (shortcuts) =>
      Promise.resolve().then(() => write.call(desktop, ownerKey, shortcuts)).then(
        (ok) => ok === true,
        () => false,
      ),
  };
}

// ------------------------------------------------------------------ labels

/** What kind of place a tab is showing, for the glyph beside its name. */
export type DesktopTabKind =
  | "dashboard"
  | "plan"
  | "organization"
  | "profile"
  | "calendar"
  | "gardens"
  | "lessons"
  | "workspace"
  | "timer"
  | "browser"
  | "new"
  | "page";

const ROUTE_LABELS: Record<string, { label: string; kind: DesktopTabKind }> = {
  "": { label: "Dashboard", kind: "dashboard" },
  dashboard: { label: "Dashboard", kind: "dashboard" },
  "new-tab": { label: "New tab", kind: "new" },
  plan: { label: "Plan", kind: "plan" },
  buzz: { label: "Organization", kind: "organization" },
  profile: { label: "Profile", kind: "profile" },
  calendar: { label: "Calendar", kind: "calendar" },
  garden: { label: "Gardens", kind: "gardens" },
  gardens: { label: "Gardens", kind: "gardens" },
  pomodoro: { label: "Work timer", kind: "timer" },
  browser: { label: "Browser", kind: "browser" },
  map: { label: "Map", kind: "page" },
  hooks: { label: "Hooks", kind: "page" },
  processes: { label: "Processes", kind: "page" },
  workflows: { label: "Workflows", kind: "page" },
  worldmonitor: { label: "World monitor", kind: "page" },
  artifacts: { label: "Artifacts", kind: "page" },
  attachments: { label: "Attachments", kind: "page" },
  "genoffice-docs": { label: "Documents", kind: "page" },
};

function humanize(segment: string): string {
  let words = segment;
  try {
    words = decodeURIComponent(segment);
  } catch {
    // Not encoded; the segment stands.
  }
  words = words.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * The place a tab's address leads to, named the way the navbar names it.
 *
 * Pages mostly title themselves "breadboard", which tells a person nothing
 * about which tab is which; the route does. A garden's lessons and workspace
 * are named after the garden.
 */
export function describeTabUrl(url: string): { label: string; kind: DesktopTabKind } {
  let segments: string[] = [];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return { label: "New tab", kind: "new" };
  }
  const [first = "", second] = segments;
  if (first === "garden" && second) {
    return { label: humanize(second), kind: "lessons" };
  }
  if (first === "gardens" && second) {
    return { label: humanize(second), kind: "workspace" };
  }
  const known = ROUTE_LABELS[first];
  if (known) return known;
  return { label: humanize(segments[segments.length - 1] ?? "") || "Breadboard", kind: "page" };
}

/**
 * The name a tab shows. A page's own title is used when it says something —
 * "Plan — breadboard" is the Plan page — and the route stands in when the
 * title is only the product name or has not arrived yet.
 */
export function tabLabel(title: string, url: string): string {
  const cleaned = title
    .replace(/\s*[—–|·-]\s*breadboard\s*$/i, "")
    .replace(/^\s*breadboard\s*[—–|·-]\s*/i, "")
    .trim();
  if (!cleaned || /^breadboard$/i.test(cleaned)) return describeTabUrl(url).label;
  return cleaned;
}
