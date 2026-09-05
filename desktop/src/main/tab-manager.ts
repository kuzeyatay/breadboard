import {
  BrowserWindow,
  app,
  clipboard,
  Menu,
  WebContentsView,
  dialog,
  net,
  session,
  type BrowserWindowConstructorOptions,
  type Event as ElectronEvent,
  type HandlerDetails,
  type Input,
  type Session,
  type WebContents,
} from "electron";
import * as path from "node:path";
import { BrowserPreferenceStore } from "./browser-preferences";
import { BrowserNotifications } from "./browser-notifications";
import { BrowserTranslation, type TranslatePageBatch } from "./browser-translation";
import { TRANSLATION_LANGUAGES } from "../shared/browser-preferences";
import { readTabSession, restoredTabUrl, saveTab, writeTabSession, type SavedTabWindow } from "./tab-session";
import { BrowserTerminalBridge } from "./browser-terminal";
import {
  hardenExternalBrowserWebContents,
  hardenWebContents,
  isNavigationAllowed,
  isSafeBrowserUrl,
  type AllowedOrigins,
} from "./security";
import {
  BREADBOARD_TITLE_BAR,
  backgroundColorForTheme,
  rendererWebPreferences,
  type BreadboardWindowTheme,
} from "./window-options";
import { waitForFirstPaint, waitForRevealFrame } from "./first-paint";
import { waitForStartupPageLoad } from "./startup-page-load";
import {
  IPC_CHANNELS,
  type BrowserExtensionView,
  type DesktopNotificationToast,
  type NotificationOverlaySize,
  type TabsCommand,
  type TabsState,
  type TabView,
} from "../shared/ipc-contract";
import {
  activeIndexAfterClose,
  cycleTabIndex,
  insertIndexForOpenedTab,
  isFullScreenShortcut,
  moveItem,
  nthTabIndex,
  tabShortcutFor,
  type TabShortcut,
} from "./tab-model";
import {
  browserAgentBootstrapUrl,
  isBrowserAgentBootstrapUrl,
  isBrowserAgentRunId,
} from "./browser-agent-session";
import { browserPageBackgroundColor } from "./browser-theme";
import { browserNavigationTargetIndex } from "./browser-navigation-history";
import { BrowserVisitedLinks } from "./browser-visited-links";
import { BrowserHistory } from "./browser-history";
import { browserMenuTemplate, browserMenuShortcut, savedPageFilename, type BrowserMenuAction } from "./browser-menu";
import {
  MAX_EXTENSION_ARCHIVE_BYTES,
  browserExtensionInstallId,
  browserWebStoreInstallBootstrapScript,
  browserWebStoreInstallCleanupScript,
  chromeWebStoreDownloadUrl,
  chromeWebStoreExtensionId,
  installChromeWebStorePackage,
  readBrowserExtensionPaths,
  writeBrowserExtensionPaths,
} from "./browser-extensions";

export interface TabManagerOptions {
  browserPreferencesConfigDir?: string;
  /** Dependency injection for deterministic page translation integration checks. */
  translatePageBatch?: TranslatePageBatch;
  allowed: AllowedOrigins;
  preloadPath: string;
  /** The same animated field shown while Breadboard itself opens. */
  loadingHtmlPath: () => string;
  /** The reconnect scene a tab shows while its page's server is away. */
  recoveryHtmlPath: () => string;
  theme: () => BreadboardWindowTheme;
  /** A new hardened window: where a page goes when it cannot go in a tab. */
  openWindow: (url: string) => void;
  /** Open a web page in the operating system browser when tabs are disabled. */
  openExternal?: (url: string) => void;
  /** Lets F12 open the inspector in a tab. Development builds only. */
  devTools?: boolean;
  log?: (line: string) => void;
  /** Directory containing the durable list of unpacked browser extensions. */
  browserExtensionsConfigDir?: string;
  browserVisitedLinksConfigDir?: string;
  browserHistoryConfigDir?: string;
  tabSessionConfigDir?: string;
  /** Publish the loopback CDP handoff after the exact visible page exists. */
  onBrowserAgentPageReady?: (runId: string, targetUrl: string) => Promise<boolean>;
}

/**
 * Electron may destroy a tab between an `isDestroyed()` check and `loadURL()`.
 * `loadURL` can throw synchronously in that race, before a Promise exists for a
 * trailing `.catch()` to observe. Keep that expected lifecycle race contained.
 */
export async function loadRecoveryUrlIfAlive(
  contents: Pick<WebContents, "isDestroyed" | "loadURL">,
  url: string,
): Promise<boolean> {
  if (contents.isDestroyed()) return false;
  try {
    await contents.loadURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * The untrusted page beneath a browser tab's trusted Breadboard chrome.
 */
interface BrowserPage {
  translation?: BrowserTranslation;
  menu?: Menu;
  find?: { matches: number; activeMatchOrdinal: number };
  findQuery?: string;
  findRequestId?: number;
  /** The authenticated local page that owns the trusted toolbar. */
  shellUrl: string;
  /**
   * The untrusted page is allocated only after the tab leaves browser home.
   * A home tab needs trusted chrome, but no second Chromium renderer yet.
   */
  view: WebContentsView | null;
  contents: WebContents | null;
  /** The first document has produced DOM and is safe to reveal. */
  ready: boolean;
  attached: boolean;
  /** The trusted Terminal workspace is revealed beside this page. */
  terminalOpen: boolean;
  /** Rail plus drawer width, continuously updated while its edge is dragged. */
  terminalWidth: number;
  /** The trusted address dropdown temporarily occupies space above the page. */
  addressSuggestionsOpen: boolean;
  /** The trusted new-tab page precedes the first web page in user navigation. */
  homeEntryAvailable: boolean;
  /** The trusted new-tab page is currently shown instead of the web view. */
  showingHome: boolean;
  /** Chromium index of the first page after the current virtual home entry. */
  homeHistoryIndex: number | null;
  /** A navigation launched from home records its Chromium index on commit. */
  pendingHomeNavigation: boolean;
  /** Page presentation restored when Forward leaves the virtual home entry. */
  homeForwardTitle?: string;
  homeForwardFavicon?: string;
  /** Last safe favicon reported by the main frame. */
  favicon?: string;
  /** Latest explicit web selection handed to the Terminal composer. */
  selection?: {
    text: string;
    title: string;
    url: string;
  };
  /** Present when this page is the visible surface for one browser-agent run. */
  automationRunId?: string;
}

type LiveBrowserPage = BrowserPage & {
  view: WebContentsView;
  contents: WebContents;
};

function liveBrowserPage(browser: BrowserPage | undefined): LiveBrowserPage | null {
  if (!browser?.view || !browser.contents || browser.contents.isDestroyed()) return null;
  return browser as LiveBrowserPage;
}

/** A trusted, transparent renderer owned by the window rather than by a tab.
 * Its bounds collapse to the cards it contains, leaving the page beneath fully
 * interactive while keeping the cards above even an untrusted browser view. */
interface NotificationOverlay {
  view: WebContentsView;
  contents: WebContents;
  width: number;
  height: number;
  ready: boolean;
  pending: DesktopNotificationToast[];
}

/** The window-level scene shown while the selected tab has no finished page. */
interface TabLoadingScene {
  view: WebContentsView;
  contents: WebContents;
  attached: boolean;
  theme: BreadboardWindowTheme;
}

/** Where the trusted chrome of an embedded browser tab lives. */
export const BROWSER_TAB_PATH = "/browser";
export const NOTIFICATION_OVERLAY_PATH = "/notification-overlay";
export const NOTIFICATION_OVERLAY_MAX_WIDTH = 608;
/** Matches dashboard's --breadboard-navbar-height exactly. */
export const BROWSER_TOOLBAR_HEIGHT = 69;
/** Compact trusted row containing the user's saved browser pages. */
export const BROWSER_BOOKMARKS_HEIGHT = 34;
/** A trusted launcher remains visible beside every untrusted web page. */
export const BROWSER_RAIL_WIDTH = 40;
/** Width of the real Terminal workspace when its launcher is active. */
export const BROWSER_TERMINAL_WIDTH = 640;
export const BROWSER_TERMINAL_MIN_WIDTH = 420;
export const BROWSER_TERMINAL_MAX_VIEWPORT_SHARE = 0.5;
/** Keep a useful reading column beside the drawer in compact windows. */
export const BROWSER_MIN_CONTENT_WIDTH = 320;
/** Room left for the trusted address autocomplete above an external page. */
export const BROWSER_ADDRESS_SUGGESTIONS_HEIGHT = 312;
export const BROWSER_CONTENT_TOP_INSET =
  BREADBOARD_TITLE_BAR.height + BROWSER_TOOLBAR_HEIGHT + BROWSER_BOOKMARKS_HEIGHT;
/** Keep both the window tabs and Breadboard's Garden navbar on screen while
 * the selected internal page is still loading. */
export const TAB_LOADING_SCENE_TOP_INSET =
  BREADBOARD_TITLE_BAR.height + BROWSER_TOOLBAR_HEIGHT;
/** Cookies and storage persist, but never share Breadboard's local session. */
export const BROWSER_SESSION_PARTITION = "persist:breadboard-browser";
const BROWSER_WEB_PREFERENCES = {
  preload: path.join(__dirname, "../preload/browser-preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webviewTag: false,
  spellcheck: true,
  backgroundThrottling: false,
  partition: BROWSER_SESSION_PARTITION,
};
// Electron annotates popup preferences internally. Pass a fresh copy to each
// constructor/handler so later tabs cannot adopt the preceding popup's contents.

interface BrowserPopup {
  details: HandlerDetails;
  // Electron supplies the native popup contents to createWindow, though its
  // BrowserWindow options type omits this internal constructor property.
  options: BrowserWindowConstructorOptions & { webContents?: WebContents };
}
/** Back off quickly at first, then keep checking without spinning forever. */
export const TAB_RECOVERY_DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000] as const;
/** Ctrl+Shift+T reaches back this many closed tabs. */
export const MAX_REOPENABLE_TABS = 10;
/**
 * A tab arriving in front stays behind the loading field until its renderer
 * confirms a frame, but not forever: a page whose server never answers is
 * still the tab the strip says is in front. The reconnect scene normally
 * paints long before this; the ceiling only stops a wedged renderer from
 * pinning the window on the loading field.
 */
export const REVEAL_MAX_WAIT_MS = 10_000;

interface Tab {
  id: number;
  anchored: boolean;
  /** The view this tab draws in, or null for the window's own page. */
  view: WebContentsView | null;
  contents: WebContents;
  title: string;
  url: string;
  loading: boolean;
  /** The first document has produced a DOM. Until then a view has only
   *  Chromium's cold initial surface to show. */
  loaded: boolean;
  /** Reveals that began before the first document arrived. */
  onLoaded: Array<() => void>;
  /** The page has put pixels up. */
  painted: boolean;
  /** Tabs opened beside this one since it last came to the front. */
  spawned: number;
  /** A retry loop is waiting for the page's server to answer again. */
  recovering: boolean;
  /**
   * The view is in the window's view tree: the tab in front, the tab on its
   * way to the front ({@link Host.pending}), and a closed tab that is still
   * the pixels on screen until its replacement is in place.
   */
  attached: boolean;
  /** Set when this tab carries a sandboxed web page under trusted chrome. */
  browser?: BrowserPage;
}

interface ClosedTab {
  url: string;
  browser: boolean;
}

interface Host {
  window: BrowserWindow;
  sessionTracked: boolean;
  sessionMain: boolean;
  /** In strip order. The window's own page is in here until it is closed. */
  tabs: Tab[];
  activeId: number;
  base: Tab;
  /**
   * The window's own page has been closed while other tabs stayed open. It
   * cannot be destroyed the way a view can, so it is parked on a blank page
   * underneath the views and never used again; closing the last view then
   * closes the window, as closing the last tab of a browser window does.
   */
  baseRetired: boolean;
  closedTabs: ClosedTab[];
  nextId: number;
  /**
   * The tab on its way to the front. Its view is attached out of the window's
   * visible area, rendering, while the page currently on screen stays exactly
   * as it is; see {@link TabManager.show}.
   */
  pending: Tab | null;
  /** The pending reveal replaces a page during navigation, rather than selecting a tab. */
  pendingNavigation: boolean;
  /** Invalidates a reveal when the requested front tab changes under it. */
  revealToken: number;
  /**
   * Work that must wait until whatever is on screen has been replaced:
   * destroying a closed view that is still the window's paint, parking the
   * window's own page on a blank document.
   */
  afterReveal: Array<() => void>;
  /** One native layer shared by every tab in this window. */
  notificationOverlay: NotificationOverlay | null;
  /** Lazily-created copy of Breadboard's startup loading field. */
  loadingScene: TabLoadingScene | null;
}

function tabIndex(host: Host, id: number): number {
  return host.tabs.findIndex((tab) => tab.id === id);
}

function tabById(host: Host, id: number): Tab | undefined {
  return host.tabs.find((tab) => tab.id === id);
}

/**
 * Where a view renders before it is shown.
 *
 * Chromium treats a view with no visible pixels as hidden — a view clipped
 * entirely outside the window, or one wholly beneath another view, stops
 * running animation frames and never composites (measured on Electron 33, not
 * assumed). So the arriving view is placed at the window's full size with
 * exactly one pixel inside: its bottom-left pixel under the top-right corner,
 * beneath the native caption buttons. Everything about it is live — layout,
 * paint, animation frames, at the size it will be shown at — while nothing of
 * it can be seen.
 */
export function offscreenBounds(width: number, height: number) {
  return { x: Math.max(0, width - 1), y: 1 - height, width, height };
}

/** Only a page of one of the owned origins is worth remembering as a tab's
 *  address; the local reconnect scene a tab shows meanwhile is not. */
function isTabPageUrl(allowed: AllowedOrigins, url: string): boolean {
  return isNavigationAllowed(allowed, url) && !url.startsWith("file:");
}

/** Turn an address-bar value into an ordinary http(s) page or a web search. */
export function browserUrlForInput(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const isLocalhost = /^localhost(?::\d+)?(?:[/?#]|$)/i.test(value);
  if (isLocalhost) {
    try {
      return new URL(`http://${value}`).toString();
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return isSafeBrowserUrl(value) ? new URL(value).toString() : null;
  }
  const looksLikeHost =
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(value) ||
    /^[^\s/]+\.[^\s/]+(?:[/?#]|$)/.test(value);
  if (looksLikeHost) {
    try {
      return new URL(`https://${value}`).toString();
    } catch {
      // A malformed host is more useful as a search than as a dead address.
    }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

/** The only message an untrusted page may send through a navigation attempt. */
export function browserSelectionText(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "breadboard-selection:" || url.hostname !== "ask") return null;
    const text = url.searchParams.get("text")?.replace(/\s+/gu, " ").trim() ?? "";
    return text ? text.slice(0, 4_000) : null;
  } catch {
    return null;
  }
}

/**
 * A tiny selection affordance is injected into sandboxed pages. It cannot use
 * the product preload; clicking it makes one blocked custom-scheme navigation
 * that the main process validates and turns into trusted Terminal state.
 */
export function browserSelectionBootstrapScript(): string {
  return String.raw`(() => {
    const ID = "breadboard-selection-action";
    document.getElementById(ID)?.remove();
    const button = document.createElement("button");
    button.id = ID;
    button.type = "button";
    button.textContent = "✦";
    button.setAttribute("aria-label", "Ask Terminal about selected text");
    button.setAttribute("title", "Ask Terminal");
    Object.assign(button.style, {
      all: "initial",
      position: "fixed",
      zIndex: "2147483647",
      display: "none",
      width: "30px",
      height: "30px",
      placeItems: "center",
      border: "1px solid rgba(255,255,255,.32)",
      borderRadius: "10px",
      background: "#171a18",
      color: "#f7f4ec",
      boxShadow: "0 8px 24px rgba(0,0,0,.24)",
      font: "600 16px/1 system-ui, sans-serif",
      cursor: "pointer",
      userSelect: "none"
    });
    document.documentElement.appendChild(button);
    let selected = "";
    const hide = () => { button.style.display = "none"; };
    const place = () => {
      const selection = window.getSelection();
      const text = selection && !selection.isCollapsed ? selection.toString().replace(/\s+/gu, " ").trim() : "";
      if (!text || !selection || selection.rangeCount === 0) { selected = ""; hide(); return; }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { hide(); return; }
      selected = text.slice(0, 4000);
      const left = Math.max(8, Math.min(innerWidth - 38, rect.right - 15));
      const top = Math.max(8, Math.min(innerHeight - 38, rect.top - 38));
      button.style.left = left + "px";
      button.style.top = top + "px";
      button.style.display = "grid";
    };
    document.addEventListener("pointerup", () => setTimeout(place, 0), true);
    document.addEventListener("keyup", () => setTimeout(place, 0), true);
    document.addEventListener("pointerdown", (event) => {
      if (event.target !== button) hide();
    }, true);
    addEventListener("scroll", hide, true);
    addEventListener("resize", hide);
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (!selected) return;
      location.href = "breadboard-selection://ask?text=" + encodeURIComponent(selected);
    });
  })()`;
}

export function browserContentLeft(
  width: number,
  terminalOpen: boolean,
  terminalWidth = BROWSER_TERMINAL_WIDTH,
): number {
  if (!terminalOpen) return Math.min(BROWSER_RAIL_WIDTH, Math.max(0, width - 1));
  const preferred = Math.max(
    BROWSER_TERMINAL_MIN_WIDTH,
    Math.min(browserTerminalMaxWidth(width), Math.round(terminalWidth)),
  );
  return Math.min(preferred, Math.max(BROWSER_RAIL_WIDTH, width - BROWSER_MIN_CONTENT_WIDTH));
}

export function browserTerminalMaxWidth(width: number): number {
  return Math.max(
    BROWSER_TERMINAL_MIN_WIDTH,
    Math.floor(width * BROWSER_TERMINAL_MAX_VIEWPORT_SHARE),
  );
}

export function browserContentTop(addressSuggestionsOpen: boolean): number {
  return BROWSER_CONTENT_TOP_INSET +
    (addressSuggestionsOpen ? BROWSER_ADDRESS_SUGGESTIONS_HEIGHT : 0);
}

/**
 * Before trusted browser chrome has painted, the previous page's navbar is
 * still what the person sees. Reserving the future bookmarks row at that
 * point creates a conspicuous empty strip between it and the loading field.
 */
export function tabLoadingSceneTop(isBrowserTab: boolean, shellVisible: boolean): number {
  return isBrowserTab && shellVisible
    ? BROWSER_CONTENT_TOP_INSET
    : TAB_LOADING_SCENE_TOP_INSET;
}

export function browserFaviconUrl(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 100_000) return null;
  if (/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/iu.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && value.length <= 2_048
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Preserve the last usable site identity through transient empty updates. */
export function browserFaviconFromUpdate(
  current: string | undefined,
  candidates: readonly string[],
): string | undefined {
  return candidates.map(browserFaviconUrl).find((value) => value !== null) ?? current;
}

function browserFallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || "Browser";
  } catch {
    return "Browser";
  }
}

/** The shortcuts that stay on with the Profile switch off: they act on the
 *  page in front, not on the strip. */
function isNavigationShortcut(shortcut: TabShortcut): boolean {
  return (
    shortcut.type === "back" ||
    shortcut.type === "forward" ||
    shortcut.type === "reload" ||
    shortcut.type === "zoom"
  );
}

/**
 * Browser-style tabs for every Breadboard window.
 *
 * A window's own page is its first tab. Every further tab has a trusted
 * `WebContentsView` covering the whole window, shown one at a time. An embedded
 * browser tab adds a second, untrusted view below the trusted toolbar. Each tab
 * keeps its own history, scroll position and running work, which is what makes
 * these tabs rather than bookmarks. The strip along the caption is drawn by
 * the trusted page inside each tab from the state sent here, so a tab brought
 * to the front already has the strip drawn when it is seen.
 */
export class TabManager {
  private readonly browserTerminal = new BrowserTerminalBridge();

  async browserTerminalAccess(sender: WebContents) {
    const host = this.hostByContents.get(sender.id);
    const tab = host?.tabs.find(candidate => candidate.contents === sender);
    if (!tab?.browser || sender.getURL() !== tab.browser.shellUrl || !tab.browser.terminalOpen) return null;
    const target = () => {
      const browser = tab.browser;
      return !sender.isDestroyed() && sender.getURL() === browser?.shellUrl
        && this.hostByContents.get(sender.id)?.tabs.includes(tab)
        && browser.terminalOpen && !browser.showingHome
        && browser.contents && !browser.contents.isDestroyed()
        ? browser.contents : null;
    };
    if (!target()) return null;
    return this.browserTerminal.grant(target);
  }
  private readonly options: TabManagerOptions;
  private readonly hosts = new Map<number, Host>();
  private readonly hostByContents = new Map<number, Host>();
  private enabled = true;
  private newTabUrl: string | null = null;
  private browserUrl: string | null = null;
  private notificationOverlayUrl: string | null = null;
  private browserExtensionSession: Session | null = null;
  private browserExtensionsReady: Promise<void> | null = null;
  private readonly browserVisitedLinks: BrowserVisitedLinks;
  private readonly browserPreferences: BrowserPreferenceStore;
  private readonly browserNotifications: BrowserNotifications;
  readonly browserHistory: BrowserHistory;
  private browserExtensionPaths: string[];
  private readonly browserExtensionInstalls = new Map<string, Promise<boolean>>();
  private readonly savedWindows = new Map<number, SavedTabWindow>();
  private sessionDashboardUrl: string | null = null;
  private sessionRestored = false;
  private restoringSession = false;
  private sessionFrozen = false;
  private sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSessionJson = "";

  constructor(options: TabManagerOptions) {
    this.options = options;
    this.browserPreferences = new BrowserPreferenceStore(options.browserPreferencesConfigDir ?? options.browserExtensionsConfigDir ?? app.getPath("userData"), message => this.log(message));
    this.browserNotifications = new BrowserNotifications(this.browserPreferences,
      contents => this.hostByContents.get(contents.id)?.window,
      (contents, notice) => this.publishNotificationToast(contents, notice),
      contents => {
        const host = this.hostByContents.get(contents.id);
        const tab = host?.tabs.find(tab => tab.browser?.contents === contents);
        if (host && tab) { if (host.window.isMinimized()) host.window.restore(); host.window.show(); this.activate(host, tab.id); host.window.focus(); }
      },
      () => { for (const host of this.hosts.values()) this.broadcast(host); },
    );
    this.browserVisitedLinks = new BrowserVisitedLinks(options.browserVisitedLinksConfigDir, (message) => this.log(message));
    this.browserHistory = new BrowserHistory(options.browserHistoryConfigDir, () => {
      for (const host of this.hosts.values()) {
        for (const tab of host.tabs) {
          if (tab.contents.isDestroyed()) continue;
          try { tab.contents.send(IPC_CHANNELS.browserHistoryChanged); } catch { /* Tab closed during navigation. */ }
        }
      }
    });
    this.browserExtensionPaths = options.browserExtensionsConfigDir
      ? readBrowserExtensionPaths(options.browserExtensionsConfigDir)
      : [];
    try {
      void this.ensureBrowserExtensions(session.fromPartition(BROWSER_SESSION_PARTITION));
    } catch (error) {
      this.log(
        `browser extension profile unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private log(line: string): void {
    this.options.log?.(`[tabs] ${line}`);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Where Ctrl+T goes. Nothing until the dashboard is serving. */
  setNewTabUrl(url: string | null): void {
    this.newTabUrl = url;
  }

  /** Where an embedded browser tab's trusted toolbar lives. */
  setBrowserUrl(url: string | null): void {
    if (this.browserUrl === url) return;
    this.browserUrl = url;
    this.setNotificationOverlayUrl(
      url ? new URL(NOTIFICATION_OVERLAY_PATH, url).toString() : null,
    );
    if (url) {
      // In development this route is otherwise compiled only after the click,
      // leaving the shared loading field up for several seconds. A loopback
      // request warms Next's route and chunks without creating another view;
      // the real browser shell still authenticates in its own renderer.
      void net.fetch(url, { redirect: "manual" }).then(
        (response) => response.body?.cancel(),
        (error) => this.log(
          `browser shell warmup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Restore behind the startup screen, before the fresh page is revealed.
   * Anchors are the durable places a person deliberately keeps; ordinary tabs
   * belong to the previous run. Every restored window therefore starts with
   * its anchors followed by the already-loaded fresh page, which stays active.
   */
  async restoreSession(
    window: BrowserWindow,
    dashboardUrl: string,
    createWindow: () => BrowserWindow,
    paintBeforeReveal = false,
  ): Promise<void> {
    const host = this.hosts.get(window.id);
    if (!host || !this.options.tabSessionConfigDir || this.sessionRestored) return;
    // Keep a saved tabbed session intact while the Profile switch is off.
    if (!this.enabled) return;
    this.sessionRestored = true;
    this.sessionDashboardUrl = dashboardUrl;
    this.restoringSession = true;
    const saved = readTabSession(this.options.tabSessionConfigDir);
    const ready: Promise<void>[] = [];
    try {
      this.trackSessionWindow(window, true);
      for (const [index, entry] of saved.windows.entries()) {
        const anchoredTabs = entry.tabs.filter((tab) => tab.anchored);
        if (index > 0 && !anchoredTabs.length) continue;
        const target = index === 0 ? host : this.hosts.get(createWindow().id);
        if (!target) continue;
        target.sessionTracked = true;
        ready.push(this.prepareStartupTab(target, target.base, paintBeforeReveal));
        const restored: Tab[] = [];
        for (const savedTab of anchoredTabs) {
          const url = restoredTabUrl(savedTab, dashboardUrl);
          if (url === null) continue;
          const tab = savedTab.kind === "browser"
            ? this.openBrowserTab(target, url || undefined, true)
            : this.openTab(target, url, { background: true, origin: "blank" });
          if (!tab) continue;
          tab.anchored = savedTab.anchored;
          // Older sessions persisted the browser home as "New tab". Keep the
          // trusted browser surface named consistently after an upgrade.
          tab.title = savedTab.kind === "browser" && url === "" ? "Browser" : savedTab.title;
          restored.push(tab);
          ready.push(this.prepareStartupTab(target, tab, paintBeforeReveal));
        }
        if (!restored.length) continue;
        // Anchors occupy the stable left edge; the fresh New tab is the open
        // workspace immediately beside them, regardless of last run's focus.
        target.tabs = [...restored, target.base];
        this.activate(target, target.base.id);
      }
    } finally {
      this.restoringSession = false;
      for (const owner of this.hosts.values()) this.rememberSession(owner);
      this.flushSession();
    }
    await Promise.all(ready);
  }

  private async prepareStartupTab(host: Host, tab: Tab, paint: boolean): Promise<void> {
    // A browser tab has a trusted shell and, except on its home page, a
    // separate web page. Both must finish even when the tab stays inactive.
    const pages = [
      { contents: tab.contents, view: tab.view },
      ...(tab.browser?.contents ? [{ contents: tab.browser.contents, view: tab.browser.view }] : []),
    ];
    await Promise.all(pages.map(async ({ contents, view }) => {
      if (!await waitForStartupPageLoad(contents) || !paint || host.window.isDestroyed() || contents.isDestroyed()) return;
      // Detached views cannot paint. The owning startup window is transparent
      // and parked offscreen, so they can render at their real size here.
      if (view) {
        const [width = 1, height = 1] = host.window.getContentSize();
        const browser = contents === tab.browser?.contents ? tab.browser : null;
        const x = browser ? browserContentLeft(width, browser.terminalOpen, browser.terminalWidth) : 0;
        const y = browser ? browserContentTop(browser.addressSuggestionsOpen) : 0;
        view.setBounds({ x, y, width: Math.max(1, width - x), height: Math.max(1, height - y) });
        host.window.contentView.addChildView(view);
        view.setVisible(true);
      }
      try {
        await waitForFirstPaint(contents);
      } finally {
        if (view && !host.window.isDestroyed() && !contents.isDestroyed()) {
          host.window.contentView.removeChildView(view);
        }
      }
    }));
  }

  trackSessionWindow(window: BrowserWindow, main = false): void {
    const host = this.hosts.get(window.id);
    if (!host) return;
    host.sessionTracked = true;
    host.sessionMain = main;
    this.rememberSession(host);
  }

  /** Snapshot before services or windows begin tearing down. */
  freezeSession(): void {
    if (this.sessionFrozen) return;
    for (const host of this.hosts.values()) this.rememberSession(host);
    this.flushSession();
    this.sessionFrozen = true;
  }

  private rememberSession(host: Host): void {
    if (!host.sessionTracked || !this.sessionDashboardUrl || this.sessionFrozen || this.restoringSession) return;
    const tabs = host.tabs.map((tab) => ({ tab, saved: saveTab(tab, this.sessionDashboardUrl!) }))
      .filter((entry) => entry.saved !== null);
    this.savedWindows.set(host.window.id, {
      tabs: tabs.map((entry) => entry.saved!),
      activeIndex: Math.max(0, tabs.findIndex((entry) => entry.tab.id === host.activeId)),
    });
    if (!this.sessionWriteTimer) {
      this.sessionWriteTimer = setTimeout(() => this.flushSession(), 200);
      this.sessionWriteTimer.unref();
    }
  }

  private flushSession(): void {
    if (this.sessionWriteTimer) clearTimeout(this.sessionWriteTimer);
    this.sessionWriteTimer = null;
    if (!this.options.tabSessionConfigDir || !this.sessionRestored) return;
    const session = { version: 1 as const, windows: [...this.savedWindows.values()].filter((entry) => entry.tabs.length) };
    const json = JSON.stringify(session);
    if (json === this.lastSessionJson) return;
    try {
      writeTabSession(this.options.tabSessionConfigDir, session);
      this.lastSessionJson = json;
    } catch (error) {
      this.log(`could not save tab session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Where the transparent, window-level notification renderer lives. */
  setNotificationOverlayUrl(url: string | null): void {
    if (this.notificationOverlayUrl === url) return;
    this.notificationOverlayUrl = url;
    for (const host of this.hosts.values()) {
      this.destroyNotificationOverlay(host);
      if (url) this.createNotificationOverlay(host, url);
    }
  }

  /** Keep browser and tab-loading surfaces in step with the native scheme. */
  synchronizeBrowserTheme(theme: BreadboardWindowTheme): void {
    const color = backgroundColorForTheme(theme);
    for (const host of this.hosts.values()) {
      const scene = host.loadingScene;
      if (scene && !scene.contents.isDestroyed()) {
        scene.theme = theme;
        scene.view.setBackgroundColor(color);
        void scene.contents
          .loadFile(this.options.loadingHtmlPath(), {
            query: { theme, embedded: "true" },
          })
          .catch(() => undefined);
      }
      for (const tab of host.tabs) {
        const browser = liveBrowserPage(tab.browser);
        if (!browser) continue;
        browser.view.setBackgroundColor(browserPageBackgroundColor(theme));
      }
    }
  }

  /**
   * The Profile switch. Switching off with tabs open does not strand them: each
   * becomes a window of its own, which is the only other place a page can be.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      for (const host of [...this.hosts.values()]) this.popOutViews(host);
    }
    for (const host of this.hosts.values()) this.broadcast(host);
  }

  /** The window a page belongs to, when the page is one of a window's tabs.
   *  `BrowserWindow.fromWebContents` answers only for a window's own page. */
  windowFor(contents: WebContents): BrowserWindow | null {
    const host = this.hostByContents.get(contents.id);
    return host && !host.window.isDestroyed() ? host.window : null;
  }

  attach(window: BrowserWindow): void {
    if (this.hosts.has(window.id)) return;
    const base: Tab = {
      id: 1,
      anchored: false,
      view: null,
      contents: window.webContents,
      title: "",
      url: "",
      loading: false,
      loaded: false,
      onLoaded: [],
      painted: false,
      spawned: 0,
      recovering: false,
      attached: false,
    };
    const host: Host = {
      window,
      sessionTracked: false,
      sessionMain: false,
      tabs: [base],
      activeId: base.id,
      base,
      baseRetired: false,
      closedTabs: [],
      nextId: 2,
      pending: null,
      pendingNavigation: false,
      revealToken: 0,
      afterReveal: [],
      notificationOverlay: null,
      loadingScene: null,
    };
    this.hosts.set(window.id, host);
    this.track(host, base);
    if (this.notificationOverlayUrl) {
      this.createNotificationOverlay(host, this.notificationOverlayUrl);
    }

    const relayout = () => this.layout(host);
    window.on("resize", relayout);
    window.on("maximize", relayout);
    window.on("unmaximize", relayout);
    window.on("enter-full-screen", relayout);
    window.on("leave-full-screen", relayout);
    window.on("app-command", (_event, command) => {
      if (command === "browser-backward") this.run(host, { type: "back" });
      else if (command === "browser-forward") this.run(host, { type: "forward" });
    });
    window.on("close", () => {
      if (host.sessionMain) this.freezeSession();
      else {
        this.rememberSession(host);
        this.flushSession();
      }
    });
    window.once("closed", () => {
      if (host.sessionMain && !this.sessionFrozen) {
        // A native window lost without a close request is recovered in-process.
        this.freezeSession();
        this.sessionFrozen = false;
        this.sessionRestored = false;
        this.savedWindows.clear();
        host.sessionTracked = false;
      }
      if (!this.sessionFrozen && host.sessionTracked) {
        // A separately closed window keeps only tabs explicitly anchored.
        const anchored = this.savedWindows.get(window.id)?.tabs.filter((tab) => tab.anchored) ?? [];
        if (anchored.length) this.savedWindows.set(window.id, { tabs: anchored, activeIndex: 0 });
        else this.savedWindows.delete(window.id);
        this.flushSession();
      }
      this.hosts.delete(window.id);
      if (this.hosts.size === 0) void this.browserTerminal.close();
      host.pending = null;
      host.pendingNavigation = false;
      host.revealToken += 1;
      // Closed views still waiting for a replacement to come forward go too.
      this.runAfterReveal(host);
      for (const tab of host.tabs) {
        this.hostByContents.delete(tab.contents.id);
        if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
        if (tab.view) this.destroyView(tab);
      }
      this.destroyLoadingScene(host);
      this.destroyNotificationOverlay(host);
      this.hostByContents.delete(base.contents.id);
    });
  }

  /**
   * Carry the tabs of a window being retired over to its replacement. Window
   * recovery swaps a failed main window for a fresh one; the views inside it
   * are whole pages that survive the swap, and losing them would turn a server
   * hiccup into losing one's place in every tab.
   */
  transfer(from: BrowserWindow, to: BrowserWindow): void {
    const source = this.hosts.get(from.id);
    const target = this.hosts.get(to.id);
    if (!source || !target || source === target) return;
    target.sessionTracked = source.sessionTracked;
    target.sessionMain = source.sessionMain;
    source.sessionTracked = false;
    source.sessionMain = false;
    const saved = this.savedWindows.get(from.id);
    if (saved) {
      // Keep the primary window first when a recovery window replaces it.
      const entries = [...this.savedWindows.entries()].map(([id, entry]) =>
        [id === from.id ? to.id : id, entry] as const);
      this.savedWindows.clear();
      for (const [id, entry] of entries) this.savedWindows.set(id, entry);
    }
    target.base.anchored = source.base.anchored;
    this.cancelReveal(source);
    this.runAfterReveal(source);
    const views = source.tabs.filter((tab) => tab.view);
    if (views.length === 0) {
      this.broadcast(target);
      return;
    }
    for (const tab of views) {
      if (!tab.view) continue;
      this.detach(from, tab);
      tab.spawned = 0;
      this.hostByContents.set(tab.contents.id, target);
      if (tab.browser?.contents) this.hostByContents.set(tab.browser.contents.id, target);
    }
    target.tabs = source.tabs.map((tab) => tab === source.base ? target.base : tab);
    source.tabs = source.tabs.filter((tab) => !tab.view);
    target.nextId = Math.max(target.nextId, ...target.tabs.map((tab) => tab.id + 1));
    if (source.baseRetired) {
      target.baseRetired = true;
    }
    if (source.activeId !== source.base.id) target.activeId = source.activeId;
    source.activeId = source.base.id;
    target.closedTabs = [...source.closedTabs, ...target.closedTabs].slice(
      -MAX_REOPENABLE_TABS,
    );
    this.layout(target);
    this.present(target);
    if (source.baseRetired) this.retireBase(target);
    this.broadcast(target);
  }

  /** What the page asked for through the bridge. False when it is not a tab
   *  of any window, or the request was not one this window can honour. */
  handleCommand(sender: WebContents, command: TabsCommand): boolean | Promise<boolean> {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) return false;
    if (host.tabs.some(tab => tab.browser?.contents === sender)) return false;
    switch (command.type) {
      case "browser-notifications-enabled":
      case "browser-notification-permission":
      case "browser-translation-language": {
        const saved = this.browserPreferences.update(command);
        if (saved) this.browserNotifications.preferencesChanged();
        return saved;
      }
      case "browser-notification-action":
        return sender === host.notificationOverlay?.contents && this.browserNotifications.action(command.id, command.action, host.window);
      case "browser-translation-menu": {
        const tab = host.tabs.find(tab => tab.contents === sender);
        if (!tab?.browser) return false;
        this.showTranslationMenu(host, tab);
        return true;
      }
      case "browser-translate":
      case "browser-translation-restore": {
        const tab = host.tabs.find(tab => tab.contents === sender);
        const translation = tab?.browser?.translation;
        if (!translation || tab?.browser?.showingHome) return false;
        if (command.type === "browser-translation-restore") return translation.restore().then(() => true);
        return translation.start(command.language).then(() => true);
      }
      case "open": {
        if (!this.enabled) return false;
        const from = host.tabs.find((tab) => tab.contents.id === sender.id);
        return (
          this.openTab(host, command.url, {
            background: command.background === true,
            origin: "link",
            from,
            showLoader: sender !== host.notificationOverlay?.contents,
          }) !== null
        );
      }
      case "new":
        return this.enabled && this.openBlankTab(host);
      case "activate":
        if (!this.enabled || !tabById(host, command.id)) return false;
        this.activate(host, command.id);
        return true;
      case "close":
        if (!this.enabled) return false;
        return this.closeTab(host, command.id ?? host.activeId);
      case "anchor": {
        if (!this.enabled) return false;
        const tab = tabById(host, command.id);
        if (!tab) return false;
        tab.anchored = !tab.anchored;
        this.broadcast(host);
        this.flushSession();
        return true;
      }
      case "move": {
        if (!this.enabled) return false;
        const from = tabIndex(host, command.id);
        if (from < 0) return false;
        host.tabs = moveItem(host.tabs, from, command.index);
        this.broadcast(host);
        return true;
      }
      case "reopen":
        return this.enabled && this.reopenClosedTab(host);
      case "back":
      case "forward":
      case "reload":
        this.run(host, { type: command.type });
        return true;
      case "browser": {
        const current = command.replaceCurrent
          ? host.tabs.find(
              (tab) =>
                tab.id === host.activeId && tab.contents.id === sender.id,
            )
          : undefined;
        if (command.replaceCurrent && !current) return false;
        return this.openBrowserTab(
          host,
          command.url,
          false,
          undefined,
          current,
        ) !== null;
      }
      case "browser-agent":
        return this.openBrowserAgentTab(host, command.runId, command.url);
      case "browser-navigate": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        return tab?.browser ? this.navigateBrowser(host, tab, command.input) : false;
      }
      case "browser-stop": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        const browser = liveBrowserPage(tab?.browser);
        if (!browser) return false;
        browser.contents.stop();
        return true;
      }
      case "browser-menu": {
        const tab = host.tabs.find(candidate => candidate.contents.id === sender.id && candidate.id === host.activeId);
        if (!tab?.browser) return false;
        const browser = liveBrowserPage(tab.browser);
        const menu = Menu.buildFromTemplate(browserMenuTemplate({
          profileLabel: command.profileLabel, hasPage: Boolean(browser && !tab.browser.showingHome),
          zoomPercent: browser ? Math.round(browser.contents.getZoomFactor() * 100) : 100,
          fullscreen: host.window.isFullScreen(),
        }, action => setImmediate(() => { void this.browserMenuAction(host, tab, action); })));
        tab.browser.menu?.closePopup(host.window);
        tab.browser.menu = menu;
        const [width = 1200, height = 800] = host.window.getContentSize();
        return new Promise<boolean>(resolve => menu.popup({
          window: host.window, x: Math.min(width - 1, Math.round(command.x)), y: Math.min(height - 1, Math.round(command.y)),
          callback: () => { if (tab.browser?.menu === menu) tab.browser.menu = undefined; resolve(true); },
        }));
      }
      case "browser-find":
      case "browser-find-close": {
        const tab = host.tabs.find(candidate => candidate.contents.id === sender.id);
        const browser = liveBrowserPage(tab?.browser);
        if (!browser) return false;
        if (command.type === "browser-find-close" || !command.text) {
          browser.findQuery = undefined;
          browser.findRequestId = undefined;
          browser.contents.stopFindInPage("clearSelection");
          browser.find = undefined;
          this.broadcast(host);
        } else {
          browser.findQuery = command.text;
          // Electron's findNext means start a new session; our command means
          // advance to another match in the existing session.
          browser.findRequestId = browser.contents.findInPage(command.text, { forward: command.forward !== false, findNext: command.findNext !== true });
        }
        return true;
      }
      case "browser-terminal": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        if (!tab?.browser) return false;
        tab.browser.terminalOpen = command.open;
        if (typeof command.width === "number") {
          const [hostWidth = BROWSER_TERMINAL_WIDTH] = host.window.getContentSize();
          tab.browser.terminalWidth = Math.max(
            BROWSER_TERMINAL_MIN_WIDTH,
            Math.min(browserTerminalMaxWidth(hostWidth), command.width),
          );
        }
        if (command.open) tab.browser.addressSuggestionsOpen = false;
        this.layout(host);
        this.broadcast(host);
        if (command.open) tab.contents.focus();
        else {
          const browser = liveBrowserPage(tab.browser);
          if (browser?.attached) browser.contents.focus();
        }
        return true;
      }
      case "browser-address-suggestions": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        if (!tab?.browser) return false;
        tab.browser.addressSuggestionsOpen = command.open;
        this.layout(host);
        return true;
      }
      case "browser-extension-load": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        return tab?.browser ? this.loadBrowserExtension(host, tab) : false;
      }
      case "browser-extension-reload": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        return tab?.browser
          ? this.reloadBrowserExtension(tab, command.id)
          : false;
      }
      case "browser-extension-remove": {
        const tab = host.tabs.find((candidate) => candidate.contents.id === sender.id);
        return tab?.browser
          ? this.removeBrowserExtension(tab, command.id)
          : false;
      }
      case "notification-toast":
        return this.publishNotificationToast(sender, command.notice);
      case "notification-overlay-resize":
        return this.resizeNotificationOverlay(sender, command.size);
      default:
        return false;
    }
  }

  private async browserMenuAction(host: Host, tab: Tab, action: BrowserMenuAction): Promise<void> {
    if (host.window.isDestroyed() || tab.contents.isDestroyed() || !host.tabs.includes(tab) || !tab.browser) return;
    const browser = liveBrowserPage(tab.browser);
    const page = browser && !tab.browser.showingHome ? browser.contents : null;
    const internal = (pathname: string) => this.openTab(host, new URL(pathname, tab.browser!.shellUrl).toString(), { background: false, origin: "link", from: tab });
    try {
      switch (action) {
        case "profile": internal("/profile"); return;
        case "settings": internal("/browser/settings"); return;
        case "appearance": internal("/browser/settings?section=appearance"); return;
        case "new-tab": this.openBrowserTab(host); return;
        case "new-window": this.options.openWindow(tab.browser.shellUrl); return;
        case "history": case "bookmarks": case "downloads": case "find":
          tab.contents.focus();
          await tab.contents.executeJavaScript(`window.dispatchEvent(new CustomEvent('breadboard:browser-menu-action', { detail: ${JSON.stringify(action)} }))`, true);
          return;
        case "extensions": {
          const run = (operation: () => Promise<boolean>) => { void operation().catch(error => {
            this.log(`browser extension action failed: ${String(error)}`);
            return false;
          }).then(ok => {
            if (!ok) this.publishNotificationToast(tab.contents, { type: "error", message: "Couldn’t update this extension." });
          }); };
          const extensions = this.browserExtensionViews();
          const menu = Menu.buildFromTemplate([
            ...extensions.map(extension => ({ label: extension.name.replace(/&/g, "&&"), submenu: [
              { label: "Reload", click: () => run(() => this.reloadBrowserExtension(tab, extension.id)) },
              { label: "Remove", click: () => run(() => this.removeBrowserExtension(tab, extension.id)) },
            ] })),
            ...(extensions.length ? [{ type: "separator" as const }] : []),
            { label: "Load Unpacked Extension…", click: () => run(() => this.loadBrowserExtension(host, tab)) },
            { label: "Chrome Web Store", click: () => { this.openBrowserTab(host, "https://chromewebstore.google.com/"); } },
          ]);
          tab.browser.menu = menu;
          menu.popup({ window: host.window, callback: () => { if (tab.browser?.menu === menu) tab.browser.menu = undefined; } });
          return;
        }
        case "print":
          if (page) page.print({ silent: false, printBackground: true }, (success, reason) => {
            if (!success && !/cancel/i.test(reason)) this.publishNotificationToast(tab.contents, { type: "error", message: "Printing did not finish. Check the selected printer and try again." });
          });
          return;
        case "save": {
          if (!page) return;
          const selection = await dialog.showSaveDialog(host.window, {
            title: "Save Page As", defaultPath: path.join(app.getPath("downloads"), savedPageFilename(tab.title)),
            filters: [{ name: "Web page, complete", extensions: ["html"] }],
          });
          if (selection.canceled || !selection.filePath || page.isDestroyed()) return;
          await page.savePage(selection.filePath, "HTMLComplete");
          this.publishNotificationToast(tab.contents, { type: "success", message: "Page saved." });
          return;
        }
        case "translate": {
          if (!page) return;
          this.showTranslationMenu(host, tab);
          return;
        }
        case "zoom-in": case "zoom-out": case "zoom-reset":
          if (page) this.zoomBrowserPage(host, page, action === "zoom-reset" ? "reset" : action === "zoom-in" ? "in" : "out");
          return;
        case "fullscreen": host.window.setFullScreen(!host.window.isFullScreen()); return;
        case "developer-tools": page?.toggleDevTools(); return;
        case "copy-link": if (page) clipboard.writeText(page.getURL()); return;
        case "help": this.openBrowserTab(host, "https://github.com/kuzeyatay/breadboard#readme"); return;
        case "report": this.openBrowserTab(host, "https://github.com/kuzeyatay/breadboard/issues/new"); return;
        case "about":
          await dialog.showMessageBox(host.window, { type: "info", title: "About Breadboard", message: "Breadboard", detail: `Version ${app.getVersion()}\nChromium ${process.versions.chrome}\nElectron ${process.versions.electron}` });
          return;
        case "quit": app.quit(); return;
      }
    } catch (error) {
      this.log(`browser menu action ${action} failed: ${String(error)}`);
      this.publishNotificationToast(tab.contents, { type: "error", message: "Couldn’t complete this browser action. Try again." });
    }
  }

  private zoomBrowserPage(host: Host, contents: WebContents, direction: "in" | "out" | "reset"): void {
    const factor = contents.getZoomFactor();
    contents.setZoomFactor(direction === "reset" ? 1 : Math.max(.25, Math.min(3, Math.round((factor + (direction === "in" ? .1 : -.1)) * 100) / 100)));
    this.broadcast(host);
  }

  private showTranslationMenu(host: Host, tab: Tab): void {
    const translation = tab.browser?.translation;
    if (!translation || tab.browser?.showingHome) return;
    const language = this.browserPreferences.snapshot().translationLanguage;
    const names = new Intl.DisplayNames([app.getLocale() || "en"], { type: "language" });
    const label = (code: string) => names.of(code) ?? code;
    const run = (target: string) => {
      this.browserPreferences.update({ type: "browser-translation-language", language: target });
      this.browserNotifications.preferencesChanged();
      void translation.start(target);
    };
    const menu = Menu.buildFromTemplate([
      { label: `Translate to ${label(language)}`, click: () => run(language) },
      { label: "Translate to…", submenu: TRANSLATION_LANGUAGES.map(code => ({
        label: label(code), type: "radio" as const, checked: code === language, click: () => run(code),
      })).sort((a, b) => a.label.localeCompare(b.label)) },
      { label: "Show original", enabled: translation.state.status !== "original", click: () => { void translation.restore(); } },
      { type: "separator" },
      { label: "Page text is sent to your configured AI provider", enabled: false },
    ]);
    tab.browser!.menu?.closePopup(host.window);
    tab.browser!.menu = menu;
    menu.popup({ window: host.window, callback: () => { if (tab.browser?.menu === menu) tab.browser.menu = undefined; } });
  }

  stateFor(sender: WebContents): TabsState {
    const host = this.hostByContents.get(sender.id);
    return host
      ? {
          ...this.state(host),
          selfId: host.tabs.find((tab) => tab.contents.id === sender.id)?.id ?? null,
        }
      : {
          enabled: this.enabled,
          activeId: null,
          selfId: null,
          tabs: [],
          extensions: this.browserExtensionViews(),
        };
  }

  private browserExtensionPathKey(extensionPath: string): string {
    const resolved = path.resolve(extensionPath);
    return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  }

  private browserExtensionViews(): BrowserExtensionView[] {
    return (this.browserExtensionSession?.getAllExtensions() ?? [])
      .map((extension) => ({
        id: extension.id,
        name: extension.name,
        version: extension.version,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private broadcastAll(): void {
    for (const host of this.hosts.values()) this.broadcast(host);
  }

  private persistBrowserExtensionPaths(): void {
    const configDir = this.options.browserExtensionsConfigDir;
    if (!configDir) return;
    try {
      writeBrowserExtensionPaths(configDir, this.browserExtensionPaths);
    } catch (error) {
      this.log(
        `browser extensions could not be saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private ensureBrowserExtensions(browserSession: Session): Promise<void> {
    if (this.browserExtensionSession === browserSession && this.browserExtensionsReady) {
      return this.browserExtensionsReady;
    }
    this.browserExtensionSession = browserSession;
    browserSession.on("extension-loaded", () => {
      this.broadcastAll();
      this.refreshBrowserStoreInstallButtons();
    });
    browserSession.on("extension-unloaded", () => {
      this.broadcastAll();
      this.refreshBrowserStoreInstallButtons();
    });
    const restore = async () => {
      const loadedPaths = new Set(
        browserSession.getAllExtensions().map((extension) =>
          this.browserExtensionPathKey(extension.path),
        ),
      );
      for (const extensionPath of this.browserExtensionPaths) {
        if (loadedPaths.has(this.browserExtensionPathKey(extensionPath))) continue;
        try {
          const extension = await browserSession.loadExtension(extensionPath);
          loadedPaths.add(this.browserExtensionPathKey(extension.path));
        } catch (error) {
          this.log(
            `browser extension failed to restore from ${extensionPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      this.broadcastAll();
    };
    this.browserExtensionsReady = restore();
    return this.browserExtensionsReady;
  }

  private async loadBrowserExtension(host: Host, tab: Tab): Promise<boolean> {
    const browser = tab.browser;
    if (!browser) return false;
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    await this.ensureBrowserExtensions(browserSession);
    const selection = await dialog.showOpenDialog(host.window, {
      title: "Load unpacked browser extension",
      buttonLabel: "Load extension",
      properties: ["openDirectory", "dontAddToRecent"],
    });
    if (selection.canceled || !selection.filePaths[0]) return true;
    const extensionPath = path.resolve(selection.filePaths[0]);
    const extensionKey = this.browserExtensionPathKey(extensionPath);
    const alreadyLoaded = browserSession
      .getAllExtensions()
      .some((extension) => this.browserExtensionPathKey(extension.path) === extensionKey);
    try {
      if (!alreadyLoaded) await browserSession.loadExtension(extensionPath);
      if (!this.browserExtensionPaths.some(
        (candidate) => this.browserExtensionPathKey(candidate) === extensionKey,
      )) {
        this.browserExtensionPaths.push(extensionPath);
        this.persistBrowserExtensionPaths();
      }
      this.broadcastAll();
      return true;
    } catch (error) {
      this.log(
        `browser extension failed to load from ${extensionPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async reloadBrowserExtension(tab: Tab, extensionId: string): Promise<boolean> {
    const browser = tab.browser;
    if (!browser) return false;
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    await this.ensureBrowserExtensions(browserSession);
    const extension = browserSession.getExtension(extensionId);
    if (!extension) return false;
    browserSession.removeExtension(extensionId);
    try {
      await browserSession.loadExtension(extension.path);
      this.broadcastAll();
      return true;
    } catch (error) {
      this.log(
        `browser extension ${extension.name} failed to reload: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.broadcastAll();
      return false;
    }
  }

  private async removeBrowserExtension(tab: Tab, extensionId: string): Promise<boolean> {
    const browser = tab.browser;
    if (!browser) return false;
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    await this.ensureBrowserExtensions(browserSession);
    const extension = browserSession.getExtension(extensionId);
    if (!extension) return false;
    const extensionKey = this.browserExtensionPathKey(extension.path);
    browserSession.removeExtension(extensionId);
    this.browserExtensionPaths = this.browserExtensionPaths.filter(
      (candidate) => this.browserExtensionPathKey(candidate) !== extensionKey,
    );
    this.persistBrowserExtensionPaths();
    this.broadcastAll();
    return true;
  }

  private refreshBrowserStoreInstallButtons(): void {
    for (const host of this.hosts.values()) {
      for (const tab of host.tabs) {
        const browser = liveBrowserPage(tab.browser);
        if (browser && !browser.automationRunId) this.refreshBrowserStoreInstallButton(browser);
      }
    }
  }

  /** Keep the Web Store's Breadboard-owned button in step with native state. */
  private refreshBrowserStoreInstallButton(
    browser: LiveBrowserPage,
    override?: "available" | "installing" | "installed" | "failed",
  ): void {
    if (browser.contents.isDestroyed()) return;
    const extensionId = chromeWebStoreExtensionId(browser.contents.getURL());
    if (!extensionId) {
      void browser.contents
        .executeJavaScript(browserWebStoreInstallCleanupScript(), true)
        .catch(() => undefined);
      return;
    }
    const state = override ?? (
      this.browserExtensionSession?.getExtension(extensionId)
        ? "installed"
        : this.browserExtensionInstalls.has(extensionId)
          ? "installing"
          : "available"
    );
    void browser.contents
      .executeJavaScript(browserWebStoreInstallBootstrapScript(extensionId, state), true)
      .catch(() => undefined);
  }

  private async responseBytes(response: Response, maximum: number): Promise<Buffer> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximum) {
      throw new Error("The browser extension package is too large.");
    }
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const bytes = Buffer.from(chunk.value);
        length += bytes.length;
        if (length > maximum) {
          await reader.cancel();
          throw new Error("The browser extension package is too large.");
        }
        chunks.push(bytes);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, length);
  }

  private async performBrowserStoreInstall(extensionId: string): Promise<boolean> {
    const configDir = this.options.browserExtensionsConfigDir;
    if (!configDir) return false;
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    await this.ensureBrowserExtensions(browserSession);
    if (browserSession.getExtension(extensionId)) return true;
    const chromeVersion = process.versions.chrome;
    if (!chromeVersion) throw new Error("Chromium version is unavailable.");
    const response = await net.fetch(chromeWebStoreDownloadUrl(extensionId, chromeVersion), {
      redirect: "follow",
      headers: {
        accept: "application/x-chrome-extension",
      },
    });
    if (!response.ok) {
      throw new Error(`Chrome Web Store download failed with HTTP ${response.status}.`);
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:") {
      throw new Error("Chrome Web Store redirected to an unsafe download.");
    }
    const archive = await this.responseBytes(response, MAX_EXTENSION_ARCHIVE_BYTES);
    const extensionPath = installChromeWebStorePackage(configDir, extensionId, archive);
    const extension = await browserSession.loadExtension(extensionPath);
    if (extension.id !== extensionId) {
      browserSession.removeExtension(extension.id);
      throw new Error("The loaded extension id does not match the Web Store item.");
    }
    const extensionKey = this.browserExtensionPathKey(extensionPath);
    if (!this.browserExtensionPaths.some(
      (candidate) => this.browserExtensionPathKey(candidate) === extensionKey,
    )) {
      this.browserExtensionPaths.push(extensionPath);
      this.persistBrowserExtensionPaths();
    }
    this.broadcastAll();
    return true;
  }

  private async installBrowserStoreExtension(tab: Tab, extensionId: string): Promise<boolean> {
    const browser = liveBrowserPage(tab.browser);
    if (
      !browser ||
      browser.automationRunId ||
      chromeWebStoreExtensionId(browser.contents.getURL()) !== extensionId
    ) {
      return false;
    }
    const existing = this.browserExtensionInstalls.get(extensionId);
    if (existing) return existing;
    const install = this.performBrowserStoreInstall(extensionId);
    this.browserExtensionInstalls.set(extensionId, install);
    this.refreshBrowserStoreInstallButton(browser, "installing");
    try {
      const installed = await install;
      this.refreshBrowserStoreInstallButton(browser, installed ? "installed" : "failed");
      return installed;
    } catch (error) {
      this.log(
        `Chrome Web Store extension ${extensionId} failed to install: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.refreshBrowserStoreInstallButton(browser, "failed");
      return false;
    } finally {
      if (this.browserExtensionInstalls.get(extensionId) === install) {
        this.browserExtensionInstalls.delete(extensionId);
      }
    }
  }

  /** Reload the page in front of `window`, which is not always its own page. */
  reloadActive(window: BrowserWindow): void {
    const host = this.hosts.get(window.id);
    const active = host ? tabById(host, host.activeId) : undefined;
    (active ? this.navigationContents(active) : window.webContents).reload();
  }

  /**
   * The gesture a browser answers with a background tab (a Ctrl- or
   * middle-click), from a page that is one of a window's tabs. False hands the
   * request back to be opened as a window.
   */
  openLocalTab(sender: WebContents, url: string): boolean {
    if (!this.enabled) return false;
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) return false;
    const from = host.tabs.find((tab) => tab.contents.id === sender.id);
    return this.openTab(host, url, { background: true, origin: "link", from }) !== null;
  }

  /** Route a trusted Breadboard page's external web link into its own browser. */
  openExternalTab(sender: WebContents, url: string, background = false): void {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) {
      this.options.openExternal?.(url);
      return;
    }
    this.openBrowserTab(host, url, background);
  }

  // ------------------------------------------------------------------ state

  private state(host: Host): TabsState {
    const tabs: TabView[] = host.tabs.map((tab) => ({
      id: tab.id,
      anchored: tab.anchored,
      title: tab.title,
      url: tab.url,
      loading: tab.loading || !tab.loaded,
      ...(tab.browser
        ? {
            browser: {
              // The run marker only exists so the worker can select this exact
              // Chromium target. It is not an address the person can use, so
              // keep the trusted toolbar looking like an ordinary fresh tab.
              address:
                tab.browser.automationRunId &&
                isBrowserAgentBootstrapUrl(tab.url, tab.browser.automationRunId)
                  ? ""
                  : tab.url,
              canGoBack:
                !tab.browser.showingHome &&
                (tab.browser.homeEntryAvailable ||
                  this.browserNavigationTarget(tab, "back") !== null),
              canGoForward: tab.browser.showingHome
                ? this.browserHomeForwardAvailable(tab)
                : this.browserNavigationTarget(tab, "forward") !== null,
              terminalOpen: tab.browser.terminalOpen,
              terminalWidth: tab.browser.terminalWidth,
              zoomPercent: liveBrowserPage(tab.browser) ? Math.round(tab.browser.contents!.getZoomFactor() * 100) : 100,
              ...(tab.browser.translation ? { translation: tab.browser.translation.state } : {}),
              ...(tab.browser.find ? { find: tab.browser.find } : {}),
              ...(tab.browser.favicon ? { favicon: tab.browser.favicon } : {}),
              ...(tab.browser.selection ? { selection: tab.browser.selection } : {}),
            },
          }
        : {}),
    }));
    return {
      enabled: this.enabled,
      activeId: host.activeId,
      navigationPending: host.pending !== null && host.pendingNavigation && !host.loadingScene?.attached,
      selfId: null,
      tabs,
      extensions: this.browserExtensionViews(),
      browserPreferences: this.browserPreferences.snapshot(),
    };
  }

  private broadcast(host: Host): void {
    this.rememberSession(host);
    const state = this.state(host);
    for (const tab of host.tabs) this.send(tab.contents, { ...state, selfId: tab.id });
  }

  private send(contents: WebContents, state: TabsState): void {
    if (contents.isDestroyed()) return;
    try {
      contents.send(IPC_CHANNELS.tabsState, state);
    } catch (error) {
      // A page mid-teardown can throw here for a frame that is already gone.
      // The state is replayed on the next change; it must never take down the
      // main process.
      this.log(
        `page unavailable while sending tab state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------- opening

  private openBlankTab(host: Host): boolean {
    const url = this.newTabUrl;
    if (!url || host.window.isDestroyed()) return false;
    return this.openTab(host, url, { background: false, origin: "blank" }) !== null;
  }

  /** A view with a hardened page loading `url`, tracked but not yet a tab. */
  private createView(host: Host, url: string): Tab {
    const view = new WebContentsView({
      webPreferences: rendererWebPreferences(this.options.preloadPath),
    });
    view.setBackgroundColor(backgroundColorForTheme(this.options.theme()));
    const tab: Tab = {
      id: host.nextId++,
      anchored: false,
      view,
      contents: view.webContents,
      title: "",
      url,
      loading: true,
      loaded: false,
      onLoaded: [],
      painted: false,
      spawned: 0,
      recovering: false,
      attached: false,
    };
    hardenWebContents(view.webContents, this.options.allowed, {
      onOpenLocalWindow: this.options.openWindow,
      onOpenLocalTab: (target) => this.openLocalTab(view.webContents, target),
      onOpenExternalTab: (target, background) =>
        this.openExternalTab(view.webContents, target, background),
    });
    // Not attached to the window yet: a view is only in the window's view
    // tree while its tab is in front (see `show`). It loads and runs all the
    // same, the way a background tab does.
    this.track(host, tab);
    this.layout(host);
    void view.webContents.loadURL(url).catch(() => undefined);
    return tab;
  }

  private openTab(
    host: Host,
    url: string,
    options: { background: boolean; origin: "link" | "blank"; from?: Tab; showLoader?: boolean },
  ): Tab | null {
    if (host.window.isDestroyed() || !isTabPageUrl(this.options.allowed, url)) return null;
    const tab = this.createView(host, url);

    const activeIndex = tabIndex(host, host.activeId);
    const from = options.from ?? tabById(host, host.activeId);
    const index = insertIndexForOpenedTab(
      activeIndex,
      host.tabs.length,
      options.origin,
      options.origin === "link" && from ? from.spawned : 0,
    );
    if (options.origin === "link" && from) from.spawned += 1;
    host.tabs.splice(index, 0, tab);

    if (options.background) this.broadcast(host);
    // Notification arrows retain the current page while their destination
    // loads. Explicit tab creation and selection keep the cold-tab scene.
    else this.activate(host, tab.id, options.showLoader);
    return tab;
  }

  /** Set a tab's public loading flag. State broadcasting stays with the caller
   * because some browser events update adjacent state in the same notification. */
  private setTabLoading(tab: Tab, loading: boolean): void {
    tab.loading = loading;
  }

  /** A page-local completion enters the overlay belonging to that page's
   * window. Durable chat notices are polled by the overlay renderer itself. */
  publishNotificationToast(
    sender: WebContents,
    notice: DesktopNotificationToast,
  ): boolean {
    const host = this.hostByContents.get(sender.id);
    const overlay = host?.notificationOverlay;
    if (!host || !overlay || overlay.contents.isDestroyed()) return false;
    if (!overlay.ready) {
      overlay.pending.push(notice);
      return true;
    }
    try {
      overlay.contents.send(IPC_CHANNELS.notificationToast, notice);
      return true;
    } catch {
      return false;
    }
  }

  /** Resize only the overlay renderer that sent the measurement. */
  resizeNotificationOverlay(
    sender: WebContents,
    size: NotificationOverlaySize,
  ): boolean {
    const host = this.hostByContents.get(sender.id);
    const overlay = host?.notificationOverlay;
    if (!host || !overlay || overlay.contents !== sender) return false;
    overlay.width = Math.ceil(size.width);
    overlay.height = Math.ceil(size.height);
    if (!overlay.ready) {
      overlay.ready = true;
      const pending = overlay.pending;
      overlay.pending = [];
      for (const [index, notice] of pending.entries()) {
        try {
          overlay.contents.send(IPC_CHANNELS.notificationToast, notice);
        } catch {
          overlay.pending.push(...pending.slice(index));
          overlay.ready = false;
          break;
        }
      }
    }
    this.layoutNotificationOverlay(host);
    return true;
  }

  /** Open Breadboard's built-in Chromium browser beside or in place of a tab. */
  private openBrowserTab(
    host: Host,
    requestedUrl?: string,
    background = false,
    automationRunId?: string,
    replace?: Tab,
    popup?: BrowserPopup,
  ): Tab | null {
    const shellUrl = this.browserUrl;
    const initialUrl = requestedUrl === undefined ? null : browserUrlForInput(requestedUrl);
    if (requestedUrl !== undefined && !initialUrl) return null;
    if (!this.enabled || !shellUrl || host.window.isDestroyed()) {
      if (initialUrl) this.options.openExternal?.(initialUrl);
      return null;
    }

    const tab = this.createView(host, shellUrl);
    tab.anchored = replace?.anchored ?? false;
    tab.browser = {
      shellUrl,
      view: null,
      contents: null,
      ready: false,
      attached: false,
      terminalOpen: false,
      terminalWidth: BROWSER_TERMINAL_WIDTH,
      addressSuggestionsOpen: false,
      homeEntryAvailable: requestedUrl === undefined && !automationRunId && !popup,
      showingHome: requestedUrl === undefined && !automationRunId && !popup,
      homeHistoryIndex: null,
      pendingHomeNavigation: false,
      ...(automationRunId ? { automationRunId } : {}),
    };
    tab.title = automationRunId ? "Agent Browser" : "Browser";
    tab.url = "";
    this.setTabLoading(tab, false);
    // A blank browser tab is entirely the trusted home page. Creating the
    // sandboxed page here as well would spend one renderer per home tab on an
    // unused about:blank document. Pages with a target (including automation)
    // are materialized synchronously by navigate/agent setup below.

    const replaceIndex = replace ? tabIndex(host, replace.id) : -1;
    if (replace && replaceIndex >= 0) {
      host.tabs.splice(replaceIndex, 1, tab);
    } else {
      host.tabs.splice(tabIndex(host, host.activeId) + 1, 0, tab);
    }
    if (popup) {
      const browser = this.ensureBrowserPage(host, tab, popup.options.webContents);
      if (!browser) return null;
      tab.url = popup.details.url;
      tab.title = browserFallbackTitle(tab.url);
      this.setTabLoading(tab, true);
      if (!popup.options.webContents) {
        // Link/form opens may have no native guest yet. Electron's custom
        // createWindow callback owns navigation in that case, including POST.
        const postBody = popup.details.postBody;
        const contentType = postBody?.boundary
          ? `${postBody.contentType}; boundary=${postBody.boundary}`
          : postBody?.contentType;
        void browser.contents.loadURL(popup.details.url, {
          httpReferrer: popup.details.referrer,
          ...(postBody ? { postData: postBody.data, extraHeaders: `content-type: ${contentType}` } : {}),
        }).catch(() => undefined);
      }
      // With native guest contents Chromium performs the navigation itself;
      // a second loadURL would interrupt the login request or discard its POST.
    } else if (initialUrl) this.navigateBrowser(host, tab, initialUrl);
    if (background) this.broadcast(host);
    else {
      // Replacing the page is navigation: retain its content and progress bar
      // until the browser shell paints. Opening a separate tab uses the loader.
      this.activate(host, tab.id, !replace);
      if (replace && replaceIndex >= 0) {
        if (replace.view) {
          this.whenRevealed(host, () => this.dispose(host, replace));
        } else {
          this.retireBase(host);
        }
      }
    }
    return tab;
  }

  /** Materialize the sandboxed half of a browser tab on first navigation. */
  private ensureBrowserPage(host: Host, tab: Tab, popupContents?: WebContents): LiveBrowserPage | null {
    const browser = tab.browser;
    if (!browser || host.window.isDestroyed()) return null;
    const existing = liveBrowserPage(browser);
    if (existing) return existing;

    if (browser.contents) this.hostByContents.delete(browser.contents.id);
    const view = new WebContentsView({
      ...(popupContents ? { webContents: popupContents } : {}),
      webPreferences: { ...BROWSER_WEB_PREFERENCES },
    });
    view.setBackgroundColor(browserPageBackgroundColor(this.options.theme()));
    browser.view = view;
    browser.contents = view.webContents;
    browser.ready = false;
    browser.attached = false;
    const live = browser as LiveBrowserPage;
    this.trackBrowser(host, tab, live);
    browser.translation = new BrowserTranslation(live.contents, this.options.translatePageBatch ?? (async (segments, language, signal) => {
      const response = await tab.contents.session.fetch(new URL("/api/browser/translate", browser.shellUrl).toString(), {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", redirect: "error",
        body: JSON.stringify({ segments, language }), signal: AbortSignal.any([signal, AbortSignal.timeout(100000)]),
      });
      const value = await response.json() as { segments?: Array<{ id: number; text: string }>; error?: string };
      if (!response.ok || !Array.isArray(value.segments)) throw new Error(value.error || "Translation is unavailable. Check your AI connection in Settings and try again.");
      return value.segments;
    }), () => { const owner = this.hostByContents.get(live.contents.id); if (owner) this.broadcast(owner); });
    return live;
  }

  /** Open and focus one built-in browser page for a Runtime V2 browser run. */
  private async openBrowserAgentTab(
    host: Host,
    runId: string,
    requestedUrl?: string,
  ): Promise<boolean> {
    if (!isBrowserAgentRunId(runId) || !this.enabled || host.window.isDestroyed()) {
      return false;
    }
    const existing = host.tabs.find((tab) => tab.browser?.automationRunId === runId);
    if (existing) {
      this.activate(host, existing.id);
      return requestedUrl === undefined || this.navigateBrowser(host, existing, requestedUrl);
    }
    const targetUrl = browserAgentBootstrapUrl(runId);
    const tab = this.openBrowserTab(host, undefined, false, runId);
    if (!tab) return false;
    const browser = this.ensureBrowserPage(host, tab);
    if (!browser) return false;
    const contents = browser.contents;
    tab.url = targetUrl;
    tab.title = "Agent Browser";
    this.setTabLoading(tab, true);
    this.broadcast(host);
    try {
      // A brand-new WebContents starts on about:blank. Let Chromium publish
      // that target before changing only its fragment; otherwise the remote
      // debugger can permanently retain the initial empty URL for this target.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (contents.isDestroyed()) return false;
      await contents.loadURL(targetUrl);
      const published = await this.options.onBrowserAgentPageReady?.(runId, targetUrl);
      if (published !== true) return false;
      if (requestedUrl !== undefined) return this.navigateBrowser(host, tab, requestedUrl);
      return true;
    } catch (error) {
      this.log(
        `browser-agent tab failed for ${runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private navigateBrowser(host: Host, tab: Tab, input: string): boolean {
    const url = browserUrlForInput(input);
    if (!url) return false;
    const browser = this.ensureBrowserPage(host, tab);
    if (!browser) return false;
    if (browser.showingHome) {
      browser.showingHome = false;
      browser.pendingHomeNavigation = browser.homeEntryAvailable;
      browser.homeForwardTitle = undefined;
      browser.homeForwardFavicon = undefined;
    }
    browser.ready = browser.attached;
    browser.addressSuggestionsOpen = false;
    browser.favicon = undefined;
    tab.url = url;
    tab.title = browserFallbackTitle(url);
    this.setTabLoading(tab, true);
    this.broadcast(host);
    const contents = browser.contents;
    void contents.loadURL(url).catch((error) => {
      const owner = this.hostByContents.get(contents.id);
      const currentBrowser = liveBrowserPage(tab.browser);
      if (!owner || currentBrowser?.contents !== contents) return;
      this.setTabLoading(tab, false);
      this.log(
        `browser navigation failed for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.broadcast(owner);
    });
    return true;
  }

  private trackBrowser(host: Host, tab: Tab, browser: BrowserPage): void {
    const contents = browser.contents;
    if (!contents) return;
    this.hostByContents.set(contents.id, host);
    const current = (): Host | undefined => this.hostByContents.get(contents.id);
    contents.on("found-in-page", (_event, result) => {
      if (!browser.findQuery || result.requestId !== browser.findRequestId) return;
      browser.find = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal };
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.once("destroyed", () => {
      const owner = current();
      this.hostByContents.delete(contents.id);
      if (browser.contents !== contents) return;
      if (browser.attached && browser.view && owner && !owner.window.isDestroyed()) {
        try {
          owner.window.contentView.removeChildView(browser.view);
        } catch {
          // The native view was already removed with its renderer/window.
        }
      }
      browser.contents = null;
      browser.view = null;
      browser.ready = false;
      browser.attached = false;
      // A login popup can close itself after messaging its opener. Retire its
      // trusted chrome too, otherwise an empty, stale tab is left behind.
      if (owner && !owner.window.isDestroyed()) {
        const index = tabIndex(owner, tab.id);
        if (index >= 0) this.dropTab(owner, index);
      }
    });

    hardenExternalBrowserWebContents(contents, {
      configurePermissions: target => this.browserNotifications.installSession(target),
      onOpenWindow: (details) => {
        const owner = current();
        if (!owner || !this.enabled || !this.browserUrl || owner.window.isDestroyed()) {
          return { action: "deny" };
        }
        if (!browser.automationRunId) this.browserVisitedLinks.remember(contents.getURL(), details.url);
        return {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences: { ...BROWSER_WEB_PREFERENCES } },
          createWindow: (options) => {
            const popup = this.openBrowserTab(
              owner, undefined, details.disposition === "background-tab",
              undefined, undefined, { details, options },
            );
            const page = liveBrowserPage(popup?.browser);
            if (!page) throw new Error("The browser popup could not be attached to a tab.");
            return page.contents;
          },
        };
      },
      isTrustedBootstrapUrl: (url) =>
        Boolean(
          browser.automationRunId &&
            isBrowserAgentBootstrapUrl(url, browser.automationRunId),
        ),
    });
    this.browserNotifications.attach(contents);
    if (!browser.automationRunId) this.browserVisitedLinks.attach(contents);
    if (!browser.automationRunId) this.browserHistory.attach(contents);
    contents.on("page-title-updated", (_event, title) => {
      if (browser.showingHome) return;
      if (
        browser.automationRunId &&
        isBrowserAgentBootstrapUrl(tab.url, browser.automationRunId)
      ) {
        return;
      }
      tab.title = title.trim() || browserFallbackTitle(tab.url);
      const owner = current();
      if (!owner) return;
      if (owner.activeId === tab.id) this.applyTitle(owner);
      this.broadcast(owner);
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      if (browser.showingHome) return;
      const favicon = browserFaviconFromUpdate(browser.favicon, favicons);
      // Complex apps such as Gmail can publish an empty favicon set between
      // same-page loading phases. Keep the last icon until a real replacement
      // arrives instead of making trusted chrome flash back to the globe.
      if (!favicon || favicon === browser.favicon) return;
      browser.favicon = favicon;
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    const remember = (url: string) => {
      if (browser.showingHome) return;
      if (!isSafeBrowserUrl(url)) return;
      if (tab.url === url) return;
      tab.url = url;
      const owner = current();
      if (owner) this.broadcast(owner);
    };
    contents.on("did-navigate", (_event, url) => {
      remember(url);
      if (browser.pendingHomeNavigation && !browser.showingHome) {
        browser.homeHistoryIndex = contents.navigationHistory.getActiveIndex();
        browser.pendingHomeNavigation = false;
      }
      if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser as LiveBrowserPage);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        remember(url);
        if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser as LiveBrowserPage);
      }
    });
    contents.on("did-start-loading", () => {
      if (browser.showingHome) {
        contents.stop();
        return;
      }
      const loadingChanged = !tab.loading;
      const suggestionsWereOpen = browser.addressSuggestionsOpen;
      this.setTabLoading(tab, true);
      const owner = current();
      if (owner) {
        browser.addressSuggestionsOpen = false;
        if (suggestionsWereOpen) this.layout(owner);
        // An address-bar navigation already published this exact optimistic
        // state before loadURL. Avoid a duplicate native layout + React render
        // when Chromium echoes did-start-loading a moment later.
        if (loadingChanged || suggestionsWereOpen) this.broadcast(owner);
      }
    });
    contents.on("did-stop-loading", () => {
      this.setTabLoading(tab, false);
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.on("dom-ready", () => {
      browser.ready = true;
      if (browser.findQuery) {
        browser.find = undefined;
        browser.findRequestId = contents.findInPage(browser.findQuery, { findNext: true });
      }
      const owner = current();
      if (!owner) return;
      if (!browser.automationRunId) {
        void contents
          .executeJavaScript(browserSelectionBootstrapScript(), true)
          .catch(() => undefined);
        this.refreshBrowserStoreInstallButton(browser as LiveBrowserPage);
      }
      this.syncBrowser(owner);
      this.broadcast(owner);
    });
    contents.on("will-navigate", (event, targetUrl) => {
      const extensionId = browserExtensionInstallId(targetUrl);
      if (extensionId) {
        event.preventDefault();
        const owner = current();
        if (
          owner &&
          !browser.automationRunId &&
          chromeWebStoreExtensionId(contents.getURL()) === extensionId
        ) {
          void this.installBrowserStoreExtension(tab, extensionId);
        }
        return;
      }
      const text = browserSelectionText(targetUrl);
      if (!text) return;
      event.preventDefault();
      const owner = current();
      if (!owner) return;
      browser.selection = {
        text,
        title: tab.title || browserFallbackTitle(tab.url),
        url: tab.url,
      };
      browser.terminalOpen = true;
      browser.addressSuggestionsOpen = false;
      this.layout(owner);
      this.broadcast(owner);
      tab.contents.focus();
    });
    contents.on("did-fail-load", (_event, errorCode, _description, failedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      remember(failedUrl);
      this.setTabLoading(tab, false);
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.on("render-process-gone", () => {
      const owner = current();
      if (!owner || !tab.url || contents.isDestroyed()) return;
      this.setTabLoading(tab, true);
      this.broadcast(owner);
      void contents.loadURL(tab.url).catch(() => undefined);
    });
    contents.on("before-input-event", (event, input) => {
      const owner = current();
      if (owner) this.handleInput(owner, event, input);
    });
  }

  private reopenClosedTab(host: Host): boolean {
    const closed = host.closedTabs.pop();
    if (!closed) return false;
    if (closed.browser) return this.openBrowserTab(host, closed.url || undefined) !== null;
    return this.openTab(host, closed.url, { background: false, origin: "blank" }) !== null;
  }

  // ---------------------------------------------------------------- closing

  private closeTab(host: Host, id: number): boolean {
    const index = tabIndex(host, id);
    if (index < 0) return false;
    const tab = host.tabs[index];
    if (!tab || tab.anchored) return false;
    return this.dropTab(host, index);
  }

  /** Take a tab out of the strip and put the next one in front. */
  private dropTab(host: Host, index: number): boolean {
    const tab = host.tabs[index];
    if (!tab) return false;
    const countBefore = host.tabs.length;
    const activeIndex = tabIndex(host, host.activeId);
    if (tab.url) {
      host.closedTabs.push({ url: tab.url, browser: Boolean(tab.browser) });
      if (host.closedTabs.length > MAX_REOPENABLE_TABS) host.closedTabs.shift();
    }
    host.tabs.splice(index, 1);

    if (host.tabs.length === 0) {
      this.rememberSession(host);
      // It is already out of host.tabs, so window teardown cannot dispose it.
      if (tab.view) this.dispose(host, tab);
      // The last tab: the window goes with it, as in a browser.
      host.window.close();
      return true;
    }

    // Bring the replacement forward first. The closed page may be the pixels
    // on screen right now, and it stays that way until the replacement has a
    // frame of its own; destroying it here would show whatever lies beneath.
    const nextIndex = activeIndexAfterClose(index, activeIndex, countBefore);
    const next = host.tabs[nextIndex] ?? host.tabs[0];
    if (next) this.activate(host, next.id);
    else this.broadcast(host);

    if (tab.view) this.whenRevealed(host, () => this.dispose(host, tab));
    else this.retireBase(host);
    return true;
  }

  /** A view that is no longer a tab: off the window, out of the maps, closed. */
  private dispose(host: Host, tab: Tab): void {
    tab.browser?.menu?.closePopup(host.window);
    this.detach(host.window, tab);
    this.hostByContents.delete(tab.contents.id);
    if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
    this.destroyView(tab);
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    const host = this.hostByContents.get(tab.contents.id);
    if (host) this.detach(host.window, tab);
    const browserContents = tab.browser?.contents;
    if (browserContents && !browserContents.isDestroyed()) {
      try {
        browserContents.close();
      } catch {
        // Closing an untrusted page that is already tearing itself down.
      }
    }
    if (tab.browser) {
      tab.browser.contents = null;
      tab.browser.view = null;
      tab.browser.ready = false;
      tab.browser.attached = false;
    }
    if (!tab.contents.isDestroyed()) {
      try {
        tab.contents.close();
      } catch {
        // Closing a page that is already tearing itself down.
      }
    }
  }

  /** Park the window's own page on nothing; see {@link Host.baseRetired}. */
  private retireBase(host: Host): void {
    host.baseRetired = true;
    host.base.title = "";
    host.base.url = "";
    // The page may still be what the window shows while the next tab renders
    // out of sight; blanking it any earlier would put that blank on screen.
    this.whenRevealed(host, () => {
      this.hostByContents.delete(host.base.contents.id);
      if (host.base.contents.isDestroyed()) return;
      // Not a navigation the page started, so the origin guard does not run —
      // and a blank page is the one thing there is no reason to guard against.
      void host.base.contents.loadURL("about:blank").then(async () => {
        if (!host.baseRetired || host.base.contents.isDestroyed()) return;
        // Electron 33 retains the previous document's native drag region on
        // about:blank. The base is still attached underneath the live tabs, so
        // its old caption gaps swallow clicks on tabs added later. Publish an
        // explicit non-draggable region from the blank document to clear it.
        await host.base.contents.executeJavaScript(`
          document.documentElement.style.setProperty('-webkit-app-region', 'no-drag');
          document.documentElement.style.minHeight = '100vh';
        `);
      }).catch(() => undefined);
    });
  }

  /** Every view becomes a window of its own; the switch was turned off. */
  private popOutViews(host: Host): void {
    if (host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    const views = host.tabs.filter((tab) => tab.view);
    if (views.length === 0) return;
    for (const tab of views) {
      if (tab.browser) {
        if (tab.url) this.options.openExternal?.(tab.url);
      } else if (host.baseRetired && tab === active && tab.url) {
        // The window's own page is blank; give it the page that was in front
        // rather than send that one away and leave the window empty.
        host.baseRetired = false;
        host.base.url = tab.url;
        this.hostByContents.set(host.base.contents.id, host);
        void host.base.contents.loadURL(tab.url).catch(() => undefined);
      } else if (tab.url) {
        this.options.openWindow(tab.url);
      }
      this.detach(host.window, tab);
      this.hostByContents.delete(tab.contents.id);
      if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
      this.destroyView(tab);
    }
    host.tabs = host.baseRetired ? [] : [host.base];
    if (host.tabs.length === 0) {
      host.window.close();
      return;
    }
    host.activeId = host.base.id;
    this.present(host);
  }

  // ---------------------------------------------------------- presentation

  private activate(host: Host, id: number, showLoader = true): void {
    const tab = tabById(host, id);
    if (!tab) return;
    if (host.activeId !== id) {
      const previous = tabById(host, host.activeId);
      if (previous?.browser) {
        previous.browser.addressSuggestionsOpen = false;
        previous.browser.menu?.closePopup(host.window);
      }
      for (const other of host.tabs) other.spawned = 0;
      host.activeId = id;
    }
    this.present(host, showLoader);
    this.broadcast(host);
  }

  /** Put the active tab on screen without ever exposing a view that has no
   * frame yet. A loading tab gets the startup field beneath the still-visible
   * window tabs and Garden navbar. */
  private present(host: Host, showLoader = true): void {
    if (host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    if (active) this.show(host, active, showLoader);
  }

  /**
   * Only the tab in front has its view in the window's view tree. A view that
   * is merely hidden is not reliably shown again (Electron 33 left the
   * window's own page on screen through every switch), and a view left
   * attached underneath would still take layout and paint work. Attaching
   * and detaching leaves each page running exactly as a background tab does.
   *
   * A view that is attached has no frame to show at first — Chromium paints
   * its background colour until the renderer submits one, and a cold page has
   * only its white initial document before that — so the arriving view is
   * attached *out of the window's visible area* (see {@link offscreenBounds}).
   * The page on screen stays on screen, live, while the arriving one lays out
   * and paints; when its renderer confirms a frame the view is moved into
   * place and the previous one detached in the same turn. A cold selection
   * puts the shared loading field over the content area during that wait while
   * leaving the previous page's live tabs and Garden navbar exposed above it.
   */
  private show(host: Host, active: Tab, showLoader: boolean): void {
    if (host.window.isDestroyed()) return;
    // The window's title follows the strip at once, even while the page
    // itself is still on its way.
    this.applyTitle(host);
    if (host.pending === active) {
      // Clicking the loading tab opts into the startup scene, even if its
      // initial reveal began as a page replacement without that scene.
      if (showLoader && (active.loading || !active.loaded)) {
        this.showLoadingScene(host, active);
        this.raiseNotificationOverlay(host);
      }
      return;
    }
    const view = active.view;
    if (!view) {
      if (active.loading || !active.loaded) {
        this.cancelReveal(host);
        host.pending = active;
        host.pendingNavigation = !showLoader;
        const token = ++host.revealToken;
        if (showLoader) this.showLoadingScene(host, active);
        this.raiseNotificationOverlay(host);
        void this.reveal(host, active, token);
        return;
      }
      // The window's own page is always live underneath the views (Chromium is
      // never told it is covered), so uncovering it is instant.
      this.cancelReveal(host);
      for (const tab of host.tabs) if (tab.view) this.detach(host.window, tab);
      this.settle(host, active);
      return;
    }
    if (active.contents.isDestroyed()) return;
    if (active.attached) {
      // Already the page in front; a reveal that was under way is abandoned.
      this.cancelReveal(host);
      this.layout(host);
      this.settle(host, active);
      return;
    }
    this.cancelReveal(host);
    host.pending = active;
    // Every child-view selection waits for a reveal, including already loaded
    // tabs. Only page navigation should start the blue progress bar.
    host.pendingNavigation = !showLoader;
    const token = ++host.revealToken;
    const [width, height] = host.window.getContentSize();
    if (typeof width === "number" && typeof height === "number") {
      // Bounds first, then attach, so no frame of it lands in the window.
      view.setBounds(offscreenBounds(width, height));
    }
    host.window.contentView.addChildView(view);
    active.attached = true;
    view.setVisible(true);
    this.layout(host);
    if (showLoader && (active.loading || !active.loaded)) this.showLoadingScene(host, active);
    this.raiseNotificationOverlay(host);
    void this.reveal(host, active, token, !showLoader);
  }

  private async reveal(host: Host, tab: Tab, token: number, retainUntilLoaded = false): Promise<void> {
    // Route compilation can outlast the compositor timeout. A navigation must
    // keep its outgoing page until a document exists, then wait for its frame.
    if (retainUntilLoaded && !tab.loaded) {
      await new Promise<void>((resolve) => tab.onLoaded.push(resolve));
    }
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.frameReady(tab),
      new Promise<void>((resolve) => {
        ceiling = setTimeout(resolve, REVEAL_MAX_WAIT_MS);
        ceiling.unref?.();
      }),
    ]);
    if (ceiling) clearTimeout(ceiling);
    if (host.window.isDestroyed() || host.pending !== tab || host.revealToken !== token) return;
    if (tab.contents.isDestroyed()) return;
    host.pending = null;
    host.pendingNavigation = false;
    tab.painted = true;
    this.layout(host);
    for (const other of host.tabs) {
      if (other.view && other !== tab) this.detach(host.window, other);
    }
    // Remove the cover last, after the selected tab is in place and everything
    // that used to be beneath it is gone, so even the base-tab path cannot
    // expose one stale frame between the loading field and the finished page.
    this.hideLoadingScene(host);
    this.settle(host, tab);
    // DOM-ready can precede the actual reveal. Release the navigation bar only
    // after the destination is in place, including on the outgoing renderer.
    this.broadcast(host);
  }

  /** The first document has arrived and the renderer has composited it. */
  private async frameReady(tab: Tab): Promise<void> {
    // Full navigations clear `painted`; background network activity does not.
    // A previously composited document can therefore return immediately.
    if (tab.painted) return;
    if (!tab.loaded) await new Promise<void>((resolve) => tab.onLoaded.push(resolve));
    await waitForRevealFrame(tab.contents);
  }

  /** Abandon the tab on its way to the front: it was never seen, so it can
   *  simply leave the view tree. */
  private cancelReveal(host: Host): void {
    const pending = host.pending;
    host.pending = null;
    host.pendingNavigation = false;
    host.revealToken += 1;
    if (pending) this.detach(host.window, pending);
    this.hideLoadingScene(host);
  }

  /** The screen has just reached a stable state with `active` in front. */
  private settle(host: Host, active: Tab): void {
    this.runAfterReveal(host);
    this.applyTitle(host);
    // Trusted browser chrome comes forward first; only after it has painted do
    // we layer the untrusted page beneath its toolbar.
    this.syncBrowser(host);
    const browser = liveBrowserPage(active.browser);
    if (browser?.attached) {
      browser.contents.focus();
      return;
    }
    if (!active.contents.isDestroyed()) active.contents.focus();
  }

  private whenRevealed(host: Host, work: () => void): void {
    if (host.pending) host.afterReveal.push(work);
    else work();
  }

  private runAfterReveal(host: Host): void {
    const work = host.afterReveal;
    host.afterReveal = [];
    for (const item of work) item();
  }

  private applyTitle(host: Host): void {
    if (host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    host.window.setTitle(active?.title || "Breadboard");
  }

  private detach(window: BrowserWindow, tab: Tab): void {
    this.detachBrowser(window, tab);
    if (!tab.view || !tab.attached) return;
    tab.attached = false;
    if (window.isDestroyed()) return;
    try {
      window.contentView.removeChildView(tab.view);
    } catch {
      // Already gone with the window.
    }
  }

  // ---------------------------------------------------------- loading scene

  /** Create the shared startup field only when a tab first needs it. */
  private ensureLoadingScene(host: Host): TabLoadingScene | null {
    const existing = host.loadingScene;
    if (existing && !existing.contents.isDestroyed()) return existing;
    if (host.window.isDestroyed()) return null;

    const theme = this.options.theme();
    const view = new WebContentsView({
      webPreferences: rendererWebPreferences(this.options.preloadPath),
    });
    view.setBackgroundColor(backgroundColorForTheme(theme));
    const scene: TabLoadingScene = {
      view,
      contents: view.webContents,
      attached: false,
      theme,
    };
    host.loadingScene = scene;
    hardenWebContents(scene.contents, this.options.allowed);
    // The tab strip remains clickable above this view. Keyboard tab controls
    // should work when focus happens to be inside the loading field too.
    scene.contents.on("before-input-event", (event, input) => {
      if (this.hosts.get(host.window.id) === host) this.handleInput(host, event, input);
    });
    scene.contents.once("destroyed", () => {
      if (host.loadingScene === scene) host.loadingScene = null;
    });
    void scene.contents
      .loadFile(this.options.loadingHtmlPath(), {
        query: { theme, embedded: "true" },
      })
      .catch((error) => {
        this.log(
          `tab loading scene failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    return scene;
  }

  private showLoadingScene(host: Host, tab: Tab): void {
    const scene = this.ensureLoadingScene(host);
    if (!scene || host.window.isDestroyed()) return;
    const theme = this.options.theme();
    if (scene.theme !== theme) {
      scene.theme = theme;
      scene.view.setBackgroundColor(backgroundColorForTheme(theme));
      void scene.contents
        .loadFile(this.options.loadingHtmlPath(), {
          query: { theme, embedded: "true" },
        })
        .catch(() => undefined);
    }
    this.layoutLoadingScene(host, tab);
    if (!scene.attached) {
      host.window.contentView.addChildView(scene.view);
      scene.attached = true;
    }
    scene.view.setVisible(true);
  }

  private hideLoadingScene(host: Host): void {
    const scene = host.loadingScene;
    if (!scene?.attached) return;
    scene.attached = false;
    if (host.window.isDestroyed()) return;
    try {
      host.window.contentView.removeChildView(scene.view);
    } catch {
      // Already detached with the window.
    }
  }

  private destroyLoadingScene(host: Host): void {
    const scene = host.loadingScene;
    if (!scene) return;
    this.hideLoadingScene(host);
    host.loadingScene = null;
    if (!scene.contents.isDestroyed()) {
      try {
        scene.contents.close();
      } catch {
        // Already tearing down.
      }
    }
  }

  private layoutLoadingScene(host: Host, tab: Tab): void {
    const scene = host.loadingScene;
    if (!scene || host.window.isDestroyed() || scene.contents.isDestroyed()) return;
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") return;
    // DOM-ready is not visible: the arriving shell remains offscreen until
    // reveal commits its frame. Keep covering the future bookmarks row until then.
    const top = tabLoadingSceneTop(Boolean(tab.browser), host.pending !== tab && tab.painted);
    scene.view.setBounds({
      x: 0,
      y: top,
      width,
      height: Math.max(1, height - top),
    });
  }

  private layout(host: Host): void {
    if (host.window.isDestroyed()) return;
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") return;
    const offscreen = offscreenBounds(width, height);
    for (const tab of host.tabs) {
      tab.view?.setBounds(tab === host.pending ? offscreen : { x: 0, y: 0, width, height });
      const browser = liveBrowserPage(tab.browser);
      if (browser?.attached) {
        const x = browserContentLeft(
          width,
          browser.terminalOpen,
          browser.terminalWidth,
        );
        const y = browserContentTop(browser.addressSuggestionsOpen);
        browser.view.setBounds({
          x,
          y,
          width: Math.max(1, width - x),
          height: Math.max(1, height - y),
        });
      }
    }
    const active = tabById(host, host.activeId);
    if (host.loadingScene?.attached && active) this.layoutLoadingScene(host, active);
    this.layoutNotificationOverlay(host);
  }

  // ---------------------------------------------------------- browser page

  /** Put the active browser page immediately below its trusted toolbar. */
  private syncBrowser(host: Host): void {
    if (host.window.isDestroyed() || host.pending) return;
    const active = tabById(host, host.activeId);
    for (const tab of host.tabs) {
      if (tab !== active) this.detachBrowser(host.window, tab);
    }
    const browser = liveBrowserPage(active?.browser);
    if (!active?.attached || !browser || !active.url || !browser.ready) return;
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") return;
    const x = browserContentLeft(width, browser.terminalOpen, browser.terminalWidth);
    const y = browserContentTop(browser.addressSuggestionsOpen);
    browser.view.setBounds({
      x,
      y,
      width: Math.max(1, width - x),
      height: Math.max(1, height - y),
    });
    if (!browser.attached) {
      host.window.contentView.addChildView(browser.view);
      browser.attached = true;
    }
    browser.view.setVisible(true);
    this.raiseNotificationOverlay(host);
  }

  private detachBrowser(window: BrowserWindow, tab: Tab): void {
    const browser = liveBrowserPage(tab.browser);
    if (!browser?.attached) return;
    browser.attached = false;
    if (window.isDestroyed()) return;
    try {
      window.contentView.removeChildView(browser.view);
    } catch {
      // Already gone with the window.
    }
  }

  private navigationContents(tab: Tab): WebContents {
    return liveBrowserPage(tab.browser)?.contents ?? tab.contents;
  }

  private browserNavigationTarget(
    tab: Tab,
    direction: "back" | "forward",
  ): number | null {
    const browser = tab.browser;
    const contents = browser?.contents;
    if (!browser || !contents || contents.isDestroyed()) return null;
    const history = contents.navigationHistory;
    if (browser.showingHome) return null;
    const target = browserNavigationTargetIndex(
      history.getAllEntries(),
      history.getActiveIndex(),
      contents.getURL(),
      direction,
    );
    if (
      direction === "back" &&
      target !== null &&
      browser.homeHistoryIndex !== null &&
      target < browser.homeHistoryIndex
    ) {
      return null;
    }
    return target;
  }

  private browserHomeForwardAvailable(tab: Tab): boolean {
    const browser = liveBrowserPage(tab.browser);
    return Boolean(
      browser?.showingHome &&
        isSafeBrowserUrl(browser.contents.getURL()),
    );
  }

  /** Reveal the trusted new-tab surface as the entry before the first web page. */
  private showBrowserHome(host: Host, tab: Tab): boolean {
    const browser = liveBrowserPage(tab.browser);
    if (
      !browser?.homeEntryAvailable ||
      browser.showingHome
    ) {
      return false;
    }
    browser.showingHome = true;
    browser.pendingHomeNavigation = false;
    browser.homeForwardTitle = tab.title;
    browser.homeForwardFavicon = browser.favicon;
    browser.addressSuggestionsOpen = false;
    browser.favicon = undefined;
    tab.url = "";
    tab.title = "Browser";
    if (browser.contents.isLoading()) browser.contents.stop();
    this.setTabLoading(tab, false);
    this.detachBrowser(host.window, tab);
    this.layout(host);
    this.applyTitle(host);
    this.broadcast(host);
    if (!tab.contents.isDestroyed()) tab.contents.focus();
    return true;
  }

  /** Forward from virtual home restores the still-live Chromium page instantly. */
  private showBrowserPageFromHome(host: Host, tab: Tab): boolean {
    const browser = liveBrowserPage(tab.browser);
    if (!browser?.showingHome) return false;
    const url = browser.contents.getURL();
    if (!isSafeBrowserUrl(url)) return false;
    browser.showingHome = false;
    tab.url = url;
    tab.title = browser.homeForwardTitle || browserFallbackTitle(url);
    browser.favicon = browser.homeForwardFavicon;
    browser.homeForwardTitle = undefined;
    browser.homeForwardFavicon = undefined;
    this.setTabLoading(tab, browser.contents.isLoading());
    this.layout(host);
    this.syncBrowser(host);
    this.applyTitle(host);
    this.broadcast(host);
    browser.contents.focus();
    return true;
  }

  // ------------------------------------------------ notification overlay

  private createNotificationOverlay(host: Host, url: string): void {
    if (host.window.isDestroyed() || host.notificationOverlay) return;
    const view = new WebContentsView({
      webPreferences: rendererWebPreferences(this.options.preloadPath),
    });
    // Alpha is AARRGGBB in Electron. The renderer paints only its cards; the
    // rest of the view must never become a sheet over the active tab.
    view.setBackgroundColor("#00000000");
    const overlay: NotificationOverlay = {
      view,
      contents: view.webContents,
      width: 0,
      height: 0,
      ready: false,
      pending: [],
    };
    host.notificationOverlay = overlay;
    this.hostByContents.set(overlay.contents.id, host);
    hardenWebContents(overlay.contents, this.options.allowed, {
      onOpenLocalWindow: this.options.openWindow,
      onOpenLocalTab: (target) => this.openLocalTab(overlay.contents, target),
      onOpenExternalTab: (target, background) =>
        this.openExternalTab(overlay.contents, target, background),
    });
    this.layoutNotificationOverlay(host);
    host.window.contentView.addChildView(view);
    view.setVisible(true);
    void overlay.contents.loadURL(url).catch((error) => {
      this.log(
        `notification overlay failed for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private destroyNotificationOverlay(host: Host): void {
    const overlay = host.notificationOverlay;
    if (!overlay) return;
    host.notificationOverlay = null;
    this.hostByContents.delete(overlay.contents.id);
    if (!host.window.isDestroyed()) {
      try {
        host.window.contentView.removeChildView(overlay.view);
      } catch {
        // Already detached with the window.
      }
    }
    if (!overlay.contents.isDestroyed()) {
      try {
        overlay.contents.close();
      } catch {
        // Already tearing down.
      }
    }
  }

  private raiseNotificationOverlay(host: Host): void {
    const overlay = host.notificationOverlay;
    if (!overlay || host.window.isDestroyed() || overlay.contents.isDestroyed()) return;
    // Electron explicitly treats re-adding an existing child as a z-order
    // change. This is required after an ordinary tab or browser page is added.
    host.window.contentView.addChildView(overlay.view);
  }

  private layoutNotificationOverlay(host: Host): void {
    const overlay = host.notificationOverlay;
    if (!overlay || host.window.isDestroyed() || overlay.contents.isDestroyed()) return;
    const [windowWidth, windowHeight] = host.window.getContentSize();
    if (typeof windowWidth !== "number" || typeof windowHeight !== "number") return;
    const renderWidth = Math.max(1, Math.min(NOTIFICATION_OVERLAY_MAX_WIDTH, windowWidth));
    if (overlay.width <= 0 || overlay.height <= 0) {
      // Keep one transparent pixel inside the compositor so this renderer's
      // timers and polling stay live while it has no card to show.
      overlay.view.setBounds({
        x: Math.max(0, windowWidth - 1),
        y: 1 - windowHeight,
        width: renderWidth,
        height: windowHeight,
      });
      return;
    }
    const width = Math.max(1, Math.min(Math.ceil(overlay.width), windowWidth));
    const height = Math.max(1, Math.min(Math.ceil(overlay.height), windowHeight));
    overlay.view.setBounds({
      x: Math.max(0, windowWidth - width),
      y: Math.max(0, windowHeight - height),
      width,
      height,
    });
    this.raiseNotificationOverlay(host);
  }

  // --------------------------------------------------------------- tracking

  private track(host: Host, tab: Tab): void {
    const contents = tab.contents;
    this.hostByContents.set(contents.id, host);
    // The window a page belongs to can change (recovery hands tabs to a
    // replacement window), so every handler asks again rather than closing
    // over the host it was created under.
    const current = (): Host | undefined => this.hostByContents.get(contents.id);
    const markDocumentReady = () => {
      if (tab.loaded) return;
      tab.loaded = true;
      const waiting = tab.onLoaded;
      tab.onLoaded = [];
      for (const resume of waiting) resume();
      const owner = current();
      if (owner && !contents.isDestroyed()) this.broadcast(owner);
    };
    // A cold view can be closed before DOM readiness (for example, Ctrl+W
    // during a slow navigation). `reveal()` may already be waiting in
    // `frameReady()`; releasing those waiters lets that cancelled reveal end
    // instead of retaining the destroyed renderer and its host indefinitely.
    contents.once("destroyed", () => {
      markDocumentReady();
      this.hostByContents.delete(contents.id);
    });

    contents.on("page-title-updated", (event, title) => {
      const owner = current();
      if (owner?.baseRetired && tab === owner.base) return;
      // A browser tab is named after the untrusted page, not its trusted shell.
      if (tab.browser) {
        event.preventDefault();
        return;
      }
      tab.title = title;
      if (!owner) return;
      // The window's own page would otherwise retitle the window from
      // underneath the tab that is actually in front.
      if (tab === owner.base && owner.activeId !== tab.id) event.preventDefault();
      if (owner.activeId === tab.id) this.applyTitle(owner);
      this.broadcast(owner);
    });
    const remember = (url: string) => {
      if (tab.browser) return;
      if (!isTabPageUrl(this.options.allowed, url)) return;
      const owner = current();
      if (owner?.baseRetired && tab === owner.base) return;
      tab.url = url;
      if (owner) this.broadcast(owner);
    };
    contents.on("did-navigate", (_event, url) => remember(url));
    contents.on("did-navigate-in-page", (_event, url) => remember(url));
    contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      // `painted` describes the current document, not the lifetime of the tab.
      // A full navigation must earn its first frame before it can use the warm
      // reactivation path. Same-document/App Router navigation keeps the live
      // frame and deliberately does not invalidate it.
      tab.loaded = false;
      tab.painted = false;
    });
    contents.on("did-start-loading", () => {
      if (tab.browser) return;
      this.setTabLoading(tab, true);
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.on("did-stop-loading", () => {
      if (tab.browser) return;
      this.setTabLoading(tab, false);
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    // Reveal as soon as the document can paint. Images, fonts, analytics, and
    // other subresources may continue normally after the tab is visible.
    contents.on("dom-ready", markDocumentReady);
    contents.on("did-finish-load", () => {
      // Covers a listener attached after an extremely fast dom-ready event.
      markDocumentReady();
      // A view proves its frame when it is brought forward (see `show`); a
      // probe run while it is hidden would only ever time out, as animation
      // frames do not run there. The window's own page is on screen from the
      // start and can use the ordinary visible-paint probe.
      if (tab.view || tab.painted) return;
      void waitForFirstPaint(contents).then(() => {
        tab.painted = true;
      });
    });
    contents.on("before-input-event", (event, input) => {
      const owner = current();
      if (owner) this.handleInput(owner, event, input);
    });

    if (tab.view) {
      // The window's own page is looked after by window recovery; a view has
      // to look after itself.
      contents.on("did-fail-load", (_event, errorCode, _description, failedUrl, isMainFrame) => {
        // -3 is an intentional aborted navigation, normally a redirect.
        if (!isMainFrame || errorCode === -3) return;
        remember(failedUrl);
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url);
      });
      contents.on("render-process-gone", () => {
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url);
      });
    }
  }

  private handleInput(host: Host, event: ElectronEvent, input: Input): void {
    const browserAction = browserMenuShortcut(input);
    const browserTab = tabById(host, host.activeId);
    if (browserAction && browserTab?.browser) {
      event.preventDefault();
      void this.browserMenuAction(host, browserTab, browserAction);
      return;
    }
    if (isFullScreenShortcut(input)) {
      event.preventDefault();
      if (!host.window.isDestroyed()) host.window.setFullScreen(!host.window.isFullScreen());
      return;
    }
    if (
      this.options.devTools &&
      input.type === "keyDown" &&
      !input.isAutoRepeat &&
      (input.key === "F12" ||
        ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i"))
    ) {
      event.preventDefault();
      const active = tabById(host, host.activeId);
      if (active) this.navigationContents(active).toggleDevTools();
      return;
    }
    if (
      input.type === "keyDown" &&
      !input.isAutoRepeat &&
      (((input.control || input.meta) && input.key.toLowerCase() === "l") ||
        input.key === "F6")
    ) {
      const active = tabById(host, host.activeId);
      if (!active?.browser || active.contents.isDestroyed()) return;
      event.preventDefault();
      active.contents.focus();
      void active.contents
        .executeJavaScript(
          'window.dispatchEvent(new CustomEvent("breadboard:focus-browser-address"))',
          true,
        )
        .catch(() => undefined);
      return;
    }
    const shortcut = tabShortcutFor(input);
    if (!shortcut) return;
    if (!this.enabled && !isNavigationShortcut(shortcut)) return;
    event.preventDefault();
    this.run(host, shortcut);
  }

  private run(host: Host, shortcut: TabShortcut): void {
    if (host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    const activeIndex = tabIndex(host, host.activeId);
    const count = host.tabs.length;
    switch (shortcut.type) {
      case "new":
        this.openBlankTab(host);
        return;
      case "close":
        if (active) this.closeTab(host, active.id);
        return;
      case "next":
      case "previous": {
        const target = host.tabs[cycleTabIndex(activeIndex, count, shortcut.type === "next" ? 1 : -1)];
        if (target) this.activate(host, target.id);
        return;
      }
      case "nth":
      case "last": {
        const target = host.tabs[nthTabIndex(shortcut.type === "last" ? "last" : shortcut.n, count)];
        if (target) this.activate(host, target.id);
        return;
      }
      case "reopen":
        this.reopenClosedTab(host);
        return;
      case "move":
        if (activeIndex < 0) return;
        host.tabs = moveItem(host.tabs, activeIndex, activeIndex + shortcut.delta);
        this.broadcast(host);
        return;
      case "back":
        if (active) {
          const contents = this.navigationContents(active);
          const target = active.browser
            ? this.browserNavigationTarget(active, "back")
            : contents.navigationHistory.canGoBack()
              ? contents.navigationHistory.getActiveIndex() - 1
              : null;
          if (target !== null) {
            if (contents.isLoading()) contents.stop();
            contents.navigationHistory.goToIndex(target);
          } else if (active.browser) {
            this.showBrowserHome(host, active);
          }
        }
        return;
      case "forward":
        if (active) {
          if (active.browser?.showingHome) {
            this.showBrowserPageFromHome(host, active);
            return;
          }
          const contents = this.navigationContents(active);
          const target = active.browser
            ? this.browserNavigationTarget(active, "forward")
            : contents.navigationHistory.canGoForward()
              ? contents.navigationHistory.getActiveIndex() + 1
              : null;
          if (target !== null) {
            if (contents.isLoading()) contents.stop();
            contents.navigationHistory.goToIndex(target);
          }
        }
        return;
      case "reload":
        if (active) this.navigationContents(active).reload();
        return;
      case "zoom": {
        if (!active) return;
        const contents = this.navigationContents(active);
        if (active.browser) { this.zoomBrowserPage(host, contents, shortcut.direction); return; }
        const level = contents.getZoomLevel();
        contents.setZoomLevel(
          shortcut.direction === "reset" ? 0 : level + (shortcut.direction === "in" ? 0.5 : -0.5),
        );
        return;
      }
      default:
        return;
    }
  }

  // --------------------------------------------------------------- recovery

  /**
   * A view whose page has gone (the local server restarting, most often)
   * shows the reconnect scene and waits for the server to answer again before
   * asking for the page back. Retrying the page itself would put Chromium's
   * own error document up between attempts.
   */
  private async recover(tab: Tab, recoveryUrl = tab.url): Promise<void> {
    if (tab.recovering || !recoveryUrl || tab.contents.isDestroyed()) return;
    tab.recovering = true;
    const url = recoveryUrl;
    this.log(`page lost in a tab; showing the reconnect scene and waiting for ${url}`);
    try {
      try {
        await tab.contents.loadFile(this.options.recoveryHtmlPath(), {
          query: { theme: this.options.theme() },
        });
      } catch {
        // The scene is a courtesy; the wait below is what brings the page back.
      }
      let attempt = 0;
      while (!tab.contents.isDestroyed() && this.hostByContents.has(tab.contents.id)) {
        const delay =
          TAB_RECOVERY_DELAYS_MS[Math.min(attempt, TAB_RECOVERY_DELAYS_MS.length - 1)] ?? 5_000;
        attempt += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (tab.contents.isDestroyed()) break;
        if (await this.reachable(url)) {
          if (
            tab.contents.isDestroyed() ||
            !this.hostByContents.has(tab.contents.id)
          ) {
            break;
          }
          if (await loadRecoveryUrlIfAlive(tab.contents, url)) return;
        }
      }
    } finally {
      tab.recovering = false;
    }
  }

  private async reachable(url: string): Promise<boolean> {
    try {
      const response = await net.fetch(url, { method: "GET", cache: "no-store", redirect: "manual" });
      void response.body?.cancel().catch(() => undefined);
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
