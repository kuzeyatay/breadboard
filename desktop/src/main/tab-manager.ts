import {
  BrowserWindow,
  app,
  clipboard,
  Menu,
  View,
  WebContentsView,
  dialog,
  net,
  screen,
  session,
  webContents,
  type BrowserWindowConstructorOptions,
  type Event as ElectronEvent,
  type HandlerDetails,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
} from "electron";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { ANCHORED_TAB_NAVIGATION_MESSAGE, isSameTabScreen } from "./tab-navigation-policy";
import { pathToFileURL } from "node:url";
import { BrowserPreferenceStore } from "./browser-preferences";
import { BrowserNotifications } from "./browser-notifications";
import { browserUserAgent } from "./browser-user-agent";
import { toggleBrowserPictureInPicture } from "./browser-picture-in-picture";
import { GooglePipExtension, GOOGLE_PIP_EXTENSION_ID } from "./google-pip-extension";
import { BrowserTranslation, type TranslatePageBatch } from "./browser-translation";
import { TRANSLATION_LANGUAGES, translationSite } from "../shared/browser-preferences";
import { readTabSession, rebaseDashboardUrl, restoredTabUrl, saveTab, writeTabSession, type SavedTabWindow, type SavedTabGroup } from "./tab-session";
import { flushBrowserSession } from "./browser-session-persistence";
import { TAB_GROUP_COLORS, type TabGroup } from "../shared/tab-groups";
import { groupTabs, moveGroupedTab, moveTabGroup, normalizeTabGroups } from "./tab-groups";
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
  tabRendererWebPreferences,
  type BreadboardWindowTheme,
} from "./window-options";
import { waitForFirstPaint, waitForRevealFrame } from "./first-paint";
import { waitForTabChrome } from "./tab-chrome";
import {
  STARTUP_PAGE_LOAD_MAX_WAIT_MS,
  waitForStartupPageLoad,
  waitForStartupPageReady,
} from "./startup-page-load";
import { installRendererRecovery } from "./renderer-recovery";
import {
  IPC_CHANNELS,
  type BrowserExtensionView,
  type BrowserSignInsState,
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
  nthTabIndex,
  tabShortcutFor,
  type TabShortcut,
} from "./tab-model";
import {
  browserAgentBootstrapUrl,
  chatgptWebBootstrapUrl,
  isBrowserAgentBootstrapUrl,
  isBrowserAgentRunId,
  isChatgptWebBootstrapUrl,
  readDebuggingTargetId,
  resolveDebuggingTargetId,
} from "./browser-agent-session";
import { browserPageBackgroundColor } from "./browser-theme";
import { browserNavigationTargetIndex } from "./browser-navigation-history";
import { BrowserVisitedLinks } from "./browser-visited-links";
import { BrowserHistory } from "./browser-history";
import { BrowserToolbarPopover } from "./browser-toolbar-popover";
import { FindInPage } from "./find-in-page";
import { browserMenuTemplate, browserMenuShortcut, savedPageFilename, type BrowserMenuAction } from "./browser-menu";
import { browserContextMenuTemplate, runBrowserContextAction } from "./browser-context-menu";
import { pasteOnRightClick } from "./right-click-paste";
import { tabContextMenuTemplate, type TabContextAction } from "./tab-context-menu";
import {
  BrowserExtensionCompatibilityError,
  browserExtensionCompatibilityError,
  type BrowserWebStoreInstallState,
  browserExtensionInstallId,
  browserWebStoreInstallBootstrapScript,
  browserWebStoreInstallCleanupScript,
  downloadChromeWebStorePackage,
  chromeWebStoreExtensionId,
  installChromeWebStorePackage,
  readBrowserExtensionIcon,
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
  openWindow: (url: string, privateBrowsing?: boolean) => BrowserWindow | void;
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
  /** Ceiling for a restored page to hold startup; tests may shorten it. */
  startupPageLoadMaxWaitMs?: number;
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
interface PageFindState {
  find?: { matches: number; activeMatchOrdinal: number };
  findQuery?: string;
  findRequestId?: number;
}

interface BrowserPage extends PageFindState {
  /** Only script-opened popups may retire their tab when the page closes itself. */
  scriptOpened?: boolean;
  /** In-memory web profile shared only by currently open private tabs. */
  privatePartition?: string;
  translation?: BrowserTranslation;
  menu?: Menu;
  /** The authenticated local page that owns the trusted toolbar. */
  shellUrl: string;
  /**
   * The untrusted page is allocated only after the tab leaves browser home.
   * A home tab needs trusted chrome, but no second Chromium renderer yet.
   */
  view: WebContentsView | null;
  contents: WebContents | null;
  /** A document has finished loading and can replace the trusted home page. */
  ready: boolean;
  /** Reveals waiting for the first external document, including link popups. */
  onReady: Array<() => void>;
  attached: boolean;
  /** The trusted Terminal workspace is revealed beside this page. */
  terminalOpen: boolean;
  /** Rail plus drawer width, continuously updated while its edge is dragged. */
  terminalWidth: number;
  /** Raise the transparent trusted chrome over the page while recents is open. */
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

/** The hidden chatgpt.com page ChatMock drives; see TabManager.openChatgptWebTab. */
interface ChatgptWebPage {
  /** Which of ChatMock's lanes this page serves (see CHATGPT_WEB_DEFAULT_LANE). */
  lane: string;
  view: WebContentsView;
  contents: WebContents;
  /** Its host window: parked off every display while hidden. */
  window: BrowserWindow;
  /** The DevTools target id, once Chromium has listed the bootstrap document. */
  targetId: string | undefined;
  /** True while the window is parked offscreen rather than in front of anyone. */
  hidden: boolean;
}

/**
 * ChatMock keeps one chatgpt.com page per lane: "interactive" for a person's
 * chat (and signing in), "batch" for Learn, the council and Thought Topology.
 * A request that names no lane is an older ChatMock and gets the interactive
 * page, exactly as before there were lanes. Each page is a whole conversation
 * with the site, so a Learn stage that thinks for fifteen minutes no longer
 * holds up the chat composer (2026-09-18: three chat turns refused in a row).
 */
const CHATGPT_WEB_DEFAULT_LANE = "interactive";

/**
 * How the ChatGPT page stays out of sight without stopping.
 *
 * Three things were measured against the live site before this shape settled,
 * and each rules out something simpler:
 *
 *  - A window that has never been shown gives its page a 0x0 viewport, and
 *    chatgpt.com will not focus a composer that has no box.
 *  - A view attached before its window is first shown keeps a *hidden* page
 *    even once that window appears, so the window is shown first.
 *  - A shown window parked off every display counts as occluded, which is
 *    hidden again, and a page the site believes nobody can see never renders
 *    the answer it was asked for.
 *
 * So the window is on screen, above everything (nothing can occlude it) and
 * drawn at zero opacity, which hides chatgpt.com's own opaque page as
 * `transparent: true` would not. Clicks pass through it, and it stays out of
 * the taskbar and Alt-Tab.
 */
const CHATGPT_WEB_PAGE_SIZE = { width: 1280, height: 900 } as const;

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
  view: View;
  rendererView: WebContentsView;
  contents: WebContents;
  width: number;
  height: number;
  ready: boolean;
  pending: DesktopNotificationToast[];
  audible?: boolean;
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
  backgroundThrottling: true,
  // The tab manager owns HTML fullscreen so it can expand the page view and
  // restore the window's previous F11 state independently of video fullscreen.
  disableHtmlFullscreenWindowResize: true,
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
/**
 * Native views remember the bounds they were last given, so re-sending the
 * same rectangle is pure cost. Selecting a tab lays the whole window out, and
 * every hidden tab in it was being handed the identical full-window rectangle
 * again on each switch — fifteen or thirty compositor calls to change nothing
 * (TAB-01). Every `setBounds` in this file goes through `setViewBounds` so
 * this record cannot drift from what the views actually have.
 */
const appliedViewBounds = new WeakMap<object, Rectangle>();

function setViewBounds(
  view: { setBounds(bounds: Rectangle): void },
  bounds: Rectangle,
): void {
  const previous = appliedViewBounds.get(view);
  if (
    previous &&
    previous.x === bounds.x &&
    previous.y === bounds.y &&
    previous.width === bounds.width &&
    previous.height === bounds.height
  ) {
    return;
  }
  appliedViewBounds.set(view, bounds);
  view.setBounds(bounds);
}

/** A view leaving the window's tree must be measured again when it returns. */
function forgetViewBounds(view: object): void {
  appliedViewBounds.delete(view);
}

export const TAB_RECOVERY_DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000] as const;
/** How long startup holds its loading screen for a tab that is reconnecting. */
export const STARTUP_TAB_RECOVERY_MAX_WAIT_MS = 12_000;
/** Ctrl+Shift+T reaches back this many closed tabs. */
export const MAX_REOPENABLE_TABS = 10;
/**
 * Once a destination document exists, bound the wait for its renderer to
 * confirm a frame. This must never substitute for document readiness: a slow
 * server still owns only an empty initial surface, which cannot be revealed.
 */
export const REVEAL_MAX_WAIT_MS = 10_000;

interface Tab extends PageFindState {
  groupId?: string;
  /** Live chat destinations, including those selected without URL changes. */
  notificationUrls?: string[];
  voiceOverlay?: boolean;
  /** Transient renderer state; never saved with the tab session. */
  learnActivity?: { pathname: string; active: boolean };
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
  /** May change while a retry is waiting for the runtime to restart. */
  recoveryUrl?: string;
  /** Identity of the current retry loop; a newer navigation retires it. */
  recoveryAttempt?: { expectedUrl?: string };
  /** Settles when the retry loop above gets the page back or is retired. */
  recoveryPromise?: Promise<void>;
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
  /** One unlisted launcher, prepared before the next Ctrl+T/plus click. */
  preparedNewTab?: Tab;
  prepareNewTabTimer?: ReturnType<typeof setTimeout>;
  newTabPreparationFailed?: boolean;
  tabMenu?: Menu;
  findBar?: FindInPage;
  groups: TabGroup[];
  savedGroups: SavedTabGroup[];
  groupPopover?: BrowserToolbarPopover;
  privateBrowsing?: boolean;
  window: BrowserWindow;
  browserFullscreen?: { contents: WebContents; wasWindowFullscreen: boolean };
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
  downloadsPopover?: BrowserToolbarPopover;
  downloadsClosedAt?: number;
  extensionsPopover?: BrowserToolbarPopover;
  extensionsClosedAt?: number;
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

export function browserContentTop(
  viewportHeight = Infinity,
): number {
  return Math.min(
    Math.max(0, viewportHeight - 1),
    BROWSER_CONTENT_TOP_INSET,
  );
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
  private browserSignInsResetting = false;

  private browserSignInPageCount(): number {
    let count = 0;
    for (const host of this.hosts.values()) {
      for (const tab of host.tabs) {
        if (!tab.browser?.privatePartition && liveBrowserPage(tab.browser)) count += 1;
      }
    }
    return count;
  }

  async browserSignIns(): Promise<BrowserSignInsState> {
    const cookies = await session.fromPartition(BROWSER_SESSION_PARTITION).cookies.get({});
    const sites = [...new Set(cookies.map(cookie => (cookie.domain ?? "").replace(/^\./, "")).filter(Boolean))].sort();
    return { sites, openPages: this.browserSignInPageCount() };
  }

  /** Sign-ins always belong to the persistent built-in browser, even in a private window. */
  openBrowserSignIn(sender: WebContents, url: unknown): boolean {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed() || !host.tabs.some(tab => tab.contents === sender) || !this.enabled || !this.browserUrl || this.browserSignInsResetting) return false;
    if (url !== undefined && (typeof url !== "string" || !isSafeBrowserUrl(url))) return false;
    // Check availability here so openBrowserTab cannot fall back to the OS browser.
    return this.openBrowserTab(host, url as string | undefined, false, undefined, undefined, undefined, null) !== null;
  }

  async resetBrowserSignIns(): Promise<boolean> {
    // Live pages (including agents and popups) could immediately recreate cookies.
    if (this.browserSignInsResetting || this.browserSignInPageCount() > 0) return false;
    this.browserSignInsResetting = true;
    try {
      // The hidden ChatGPT pages hold this profile too and would quietly
      // re-create cookies; they go first. ChatMock asks for new ones later.
      this.destroyChatgptWebPages();
      const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
      await browserSession.clearStorageData();
      await browserSession.clearAuthCache();
      await flushBrowserSession(browserSession);
      return true;
    } finally {
      this.browserSignInsResetting = false;
    }
  }

  /** Visible surfaces in the voice user's last focused Breadboard window. */
  voiceContextTargets(window: BrowserWindow) {
    const host = this.hosts.get(window.id);
    if (!host || host.pending || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return null;
    const tab = tabById(host, host.activeId);
    if (!tab || tab.contents.isDestroyed() || !/^https?:\/\//i.test(tab.contents.getURL())) return null;
    const browser = liveBrowserPage(tab.browser);
    const page = browser?.attached && !tab.browser?.showingHome && !tab.voiceOverlay ? browser.contents : null;
    return { page: page ?? tab.contents, app: tab.contents };
  }

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
  /** The pages lent to ChatMock's "OpenAI (web)" provider, by lane; see openChatgptWebTab. */
  private readonly chatgptWeb = new Map<string, ChatgptWebPage>();
  private enabled = true;
  private newTabUrl: string | null = null;
  private browserUrl: string | null = null;
  private notificationOverlayUrl: string | null = null;
  private notificationsVisible = false;
  private browserExtensionSession: Session | null = null;
  private googlePipExtension: GooglePipExtension | undefined;
  private privateProfile: { partition: string; session: Session; users: number; translationSites: Map<string, string> } | null = null;
  private browserExtensionsReady: Promise<void> | null = null;
  private readonly browserExtensionIcons = new Map<string, string | undefined>();
  private readonly browserVisitedLinks: BrowserVisitedLinks;
  private readonly browserPreferences: BrowserPreferenceStore;
  private readonly browserNotifications: BrowserNotifications;
  readonly browserHistory: BrowserHistory;
  private browserExtensionPaths: string[];
  private readonly browserExtensionInstalls = new Map<string, Promise<boolean>>();
  private readonly browserExtensionInstallErrors = new Map<string, { state: "failed" | "unsupported"; message: string }>();
  private readonly savedWindows = new Map<number, SavedTabWindow>();
  private sessionDashboardUrl: string | null = null;
  private sessionRestored = false;
  private restoringSession = false;
  private sessionFrozen = false;
  private sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSessionJson = "";

  constructor(options: TabManagerOptions) {
    this.options = options;
    // A prepared page must never survive a sign-out or account change.
    session.defaultSession.cookies.on("changed", (_event, cookie) => {
      if (!cookie.name.includes("session-token")) return;
      for (const host of this.hosts.values()) {
        // Loading the spare can itself refresh the session cookie. Retire that
        // document, but do not start another load/refresh/dispose loop. An
        // explicit new-tab request or runtime change can try preparation again.
        if (host.preparedNewTab && !host.preparedNewTab.painted) {
          host.newTabPreparationFailed = true;
        }
        this.discardPreparedNewTab(host);
        this.scheduleNewTabPreparation(host);
      }
    });
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
    if (this.newTabUrl === url) return;
    this.newTabUrl = url;
    for (const host of this.hosts.values()) {
      host.newTabPreparationFailed = false;
      this.discardPreparedNewTab(host);
      this.scheduleNewTabPreparation(host);
    }
  }

  /** A recovered runtime can bind a different port while these tabs stay open. */
  async reconnectDashboard(previous: string, next: string): Promise<void> {
    const rebase = (url: string) => rebaseDashboardUrl(url, previous, next);
    this.sessionDashboardUrl = next;
    const loads: Promise<unknown>[] = [];
    for (const host of this.hosts.values()) {
      for (const closed of host.closedTabs) {
        if (!closed.browser) closed.url = rebase(closed.url);
      }
      for (const tab of host.tabs) {
        const oldUrl = tab.browser?.shellUrl ?? tab.url;
        const target = rebase(oldUrl);
        if (target === oldUrl || tab.contents.isDestroyed()) continue;
        if (tab.browser) tab.browser.shellUrl = target;
        else tab.url = target;
        tab.notificationUrls = tab.notificationUrls?.map(rebase);
        if (tab.recovering) {
          tab.recoveryUrl = target;
        } else {
          loads.push(loadRecoveryUrlIfAlive(tab.contents, target).then(loaded => {
            if (!loaded && tab.view) void this.recover(tab, target);
          }));
        }
      }
      this.broadcast(host);
    }
    await Promise.all(loads);
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
   * Anchors and groups are durable; ordinary ungrouped tabs belong to the
   * previous run. Restore them beside a fresh page, which stays active.
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
    let completed = false;
    try {
      this.trackSessionWindow(window, true);
      for (const [index, entry] of saved.windows.entries()) {
        if (window.isDestroyed() || this.sessionFrozen) return;
        const anchoredTabs = entry.tabs.filter((tab) => tab.anchored || tab.groupId);
        if (index > 0 && !anchoredTabs.length && !entry.savedGroups?.length) continue;
        const target = index === 0 ? host : this.hosts.get(createWindow().id);
        if (!target) continue;
        target.sessionTracked = true;
        // Every restored group starts folded: the strip opens tidy and the
        // fresh New tab (activated below) never sits inside a hidden group.
        target.groups = (entry.groups ?? []).map(group => ({ ...group, collapsed: true }));
        target.savedGroups = entry.savedGroups ?? [];
        // The main window is enrolled by WindowManager even with no saved tabs.
        if (index > 0) await this.prepareStartupTab(target, target.base, paintBeforeReveal);
        const restored: Array<Tab | undefined> = new Array(anchoredTabs.length);
        let next = 0;
        // Creating a view starts its requests immediately. Keep creation inside
        // the queue so cold routes and widget reads do not flood the server.
        const restoreNext = async () => {
          while (next < anchoredTabs.length && !target.window.isDestroyed() && !this.sessionFrozen) {
            const position = next++;
            const savedTab = anchoredTabs[position]!;
            const url = restoredTabUrl(savedTab, dashboardUrl);
            if (url === null) continue;
            const tab = savedTab.kind === "browser"
              ? this.openBrowserTab(target, url || undefined, true)
              : this.openTab(target, url, { background: true, origin: "blank" });
            if (!tab) continue;
            tab.anchored = savedTab.anchored;
            tab.groupId = savedTab.groupId;
            // Older sessions persisted the browser home as "New tab". Keep the
            // trusted browser surface named consistently after an upgrade.
            tab.title = savedTab.kind === "browser" && url === "" ? "Browser" : savedTab.title;
            restored[position] = tab;
            await this.prepareStartupTab(target, tab, paintBeforeReveal);
          }
        };
        await Promise.all([restoreNext(), restoreNext()]);
        if (target.window.isDestroyed() || this.sessionFrozen) return;
        const restoredTabs = restored.filter((tab): tab is Tab => Boolean(tab));
        if (!restoredTabs.length) continue;
        // Restoration awaits page loads, during which another action can open
        // or select a tab. Keep those live tabs registered: dropping one here
        // leaves its native view painted over the window without layout or
        // selection updates. Background restoration keeps the current focus.
        const restoredSet = new Set(restoredTabs);
        target.tabs = [...restoredTabs, ...target.tabs.filter(tab => !restoredSet.has(tab))];
        this.activate(target, target.activeId);
      }
      completed = true;
    } finally {
      this.restoringSession = false;
      // Closing during a queued restore must preserve the complete saved run.
      if (completed && !this.sessionFrozen && !window.isDestroyed()) {
        for (const owner of this.hosts.values()) this.rememberSession(owner);
        this.flushSession();
      }
    }
  }

  /**
   * A restored tab whose service is still starting fails its first load and
   * enters the reconnect loop. Waiting only for that first load would end the
   * loading screen on a window full of reconnect scenes that quietly settle
   * seconds later, so keep waiting for the retry too. Actual connection
   * failures get a bounded recovery allowance; slow successful loads wait.
   */
  private async waitForStartupTabPage(
    tab: Tab,
    contents: WebContents,
    waitMs: number,
  ): Promise<boolean> {
    while (!contents.isDestroyed() && !contents.isCrashed()) {
      if (await waitForStartupPageLoad(contents, waitMs)) return true;
      if (tab.recovering || contents.isDestroyed() || contents.isCrashed() || !contents.isLoading()) break;
      this.log(`still loading startup document for ${tab.title}`);
    }
    // A page that never arrives must not add the whole startup budget to
    // every launch, so the reconnect wait gets its own shorter allowance.
    const recoveryDeadline = Date.now() + STARTUP_TAB_RECOVERY_MAX_WAIT_MS;
    const recoveryRemaining = () => Math.max(0, recoveryDeadline - Date.now());
    while (recoveryRemaining() > 0 && !contents.isDestroyed() && tab.recovering) {
      const recovery = tab.recoveryPromise;
      if (!recovery) break;
      let expired = false;
      await Promise.race([
        recovery.catch(() => undefined),
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            expired = true;
            resolve();
          }, recoveryRemaining());
          timer.unref?.();
        }),
      ]);
      if (expired) break;
      // The retry loop reloads the page; wait for that document as well.
      if (await waitForStartupPageLoad(contents, recoveryRemaining())) return true;
    }
    return false;
  }

  async prepareStartupWindow(window: BrowserWindow): Promise<void> {
    const host = this.hosts.get(window.id);
    if (host) await this.prepareStartupTab(host, host.base, true);
  }

  private async prepareStartupTab(host: Host, tab: Tab, paint: boolean): Promise<void> {
    // A browser tab has a trusted shell and, except on its home page, a
    // separate web page. Initialize both before revealing the app.
    const pages = [
      { contents: tab.contents, view: tab.view },
      ...(tab.browser?.contents ? [{ contents: tab.browser.contents, view: tab.browser.view }] : []),
    ];
    const waitMs = Math.max(500, this.options.startupPageLoadMaxWaitMs ?? STARTUP_PAGE_LOAD_MAX_WAIT_MS);
    await Promise.all(pages.map(async ({ contents, view }) => {
      if (host.window.isDestroyed() || contents.isDestroyed()) return;
      const throttled = contents.getBackgroundThrottling();
      contents.setBackgroundThrottling(false);
      // Detached views cannot paint. The owning startup window is transparent
      // and parked offscreen. Attach BEFORE loading so visibility-gated effects
      // and animation frames can initialize instead of waiting for tab selection.
      if (view && paint) {
        const [width = 1, height = 1] = host.window.getContentSize();
        const browser = contents === tab.browser?.contents ? tab.browser : null;
        const x = browser ? browserContentLeft(width, browser.terminalOpen, browser.terminalWidth) : 0;
        const y = browser ? browserContentTop(height) : 0;
        setViewBounds(view, { x, y, width: Math.max(1, width - x), height: Math.max(1, height - y) });
        host.window.contentView.addChildView(view);
        view.setVisible(true);
      }
      try {
        if (!await this.waitForStartupTabPage(tab, contents, waitMs)) return;
        while (!contents.isDestroyed() && !contents.isCrashed() && !host.window.isDestroyed()) {
          if (await waitForStartupPageReady(contents, waitMs)) {
            if (paint) await waitForFirstPaint(contents, waitMs);
            return;
          }
          // A slow response is still pending. Only actual readiness or a
          // failed/destroyed page may finish this tab's startup work.
          if (tab.recovering && !await this.waitForStartupTabPage(tab, contents, waitMs)) return;
          this.log(`still waiting for startup content in ${tab.title}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } finally {
        if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled);
        if (view && paint && !host.window.isDestroyed() && !contents.isDestroyed()) {
          forgetViewBounds(view);
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
    for (const host of this.hosts.values()) this.discardPreparedNewTab(host);
  }

  private rememberSession(host: Host): void {
    if (host.privateBrowsing || !host.sessionTracked || !this.sessionDashboardUrl || this.sessionFrozen || this.restoringSession) return;
    const tabs = host.tabs.filter(tab => !tab.browser?.privatePartition).map((tab) => ({ tab, saved: saveTab(tab, this.sessionDashboardUrl!) }))
      .filter((entry) => entry.saved !== null);
    this.savedWindows.set(host.window.id, {
      tabs: tabs.map((entry) => entry.saved!),
      activeIndex: Math.max(0, tabs.findIndex((entry) => entry.tab.id === host.activeId)),
      groups: host.groups.filter(group => tabs.some(entry => entry.tab.groupId === group.id)),
      savedGroups: host.savedGroups,
    });
    if (!this.sessionWriteTimer) {
      this.sessionWriteTimer = setTimeout(() => this.flushSession(), 200);
      this.sessionWriteTimer.unref();
    }
  }

  private flushSession(): void {
    if (this.sessionWriteTimer) clearTimeout(this.sessionWriteTimer);
    this.sessionWriteTimer = null;
    if (!this.options.tabSessionConfigDir || !this.sessionRestored || this.restoringSession || this.sessionFrozen) return;
    const session = { version: 1 as const, windows: [...this.savedWindows.values()].filter((entry) => entry.tabs.length || entry.savedGroups?.length) };
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
    for (const host of this.hosts.values()) {
      const scene = host.loadingScene;
      if (scene) this.updateLoadingSceneTheme(scene, theme);
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
      for (const host of [...this.hosts.values()]) {
        this.discardPreparedNewTab(host);
        this.popOutViews(host);
      }
    }
    for (const host of this.hosts.values()) this.broadcast(host);
  }

  /** The window a page belongs to, when the page is one of a window's tabs.
   *  `BrowserWindow.fromWebContents` answers only for a window's own page. */
  windowFor(contents: WebContents): BrowserWindow | null {
    const host = this.hostByContents.get(contents.id);
    return host && !host.window.isDestroyed() ? host.window : null;
  }

  isPrivateBrowser(sender: WebContents): boolean {
    const host = this.hostByContents.get(sender.id);
    return Boolean(host?.privateBrowsing || host?.tabs.find(tab =>
      tab.contents === sender || tab.browser?.contents === sender)?.browser?.privatePartition);
  }

  /** Set before loading a private window's trusted browser shell. */
  setPrivateWindow(window: BrowserWindow): void {
    const host = this.hosts.get(window.id);
    if (host) {
      host.privateBrowsing = true;
      this.discardPreparedNewTab(host);
    }
  }

  private privateBrowserPartition(): string {
    if (!this.privateProfile) {
      const partition = `breadboard-private-${randomUUID()}`;
      this.privateProfile = { partition, session: session.fromPartition(partition, { cache: false }), users: 0, translationSites: new Map() };
    }
    return this.privateProfile.partition;
  }

  private retainPrivateProfile(tab: Tab): void {
    const profile = this.privateProfile;
    if (!profile || tab.browser?.privatePartition !== profile.partition) return;
    profile.users++;
    tab.contents.once("destroyed", () => {
      if (--profile.users !== 0) return;
      profile.translationSites.clear();
      if (this.privateProfile === profile) this.privateProfile = null;
      // Retire the identity before cleanup so a newly opened private tab
      // cannot race with removal of the preceding session's data.
      void Promise.allSettled([
        profile.session.closeAllConnections(), profile.session.clearStorageData(),
        profile.session.clearCache(), profile.session.clearAuthCache(),
      ]);
    });
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
      groups: [],
      savedGroups: [],
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
    window.on("focus", () => this.broadcast(host));
    window.on("blur", () => this.broadcast(host));
    const updateNotificationVisibility = () => this.layoutNotificationOverlay(host);
    window.on("show", updateNotificationVisibility);
    window.on("hide", updateNotificationVisibility);
    window.on("minimize", updateNotificationVisibility);
    window.on("restore", updateNotificationVisibility);
    window.on("focus", updateNotificationVisibility);
    window.on("blur", updateNotificationVisibility);
    window.on("maximize", relayout);
    window.on("unmaximize", relayout);
    window.on("enter-full-screen", relayout);
    window.on("leave-full-screen", () => {
      this.exitBrowserFullscreen(host, true, false);
      relayout();
    });
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
        if (anchored.length || host.savedGroups.length) this.savedWindows.set(window.id, {
          tabs: anchored, activeIndex: 0, groups: host.groups.filter(group => anchored.some(tab => tab.groupId === group.id)), savedGroups: host.savedGroups,
        });
        else this.savedWindows.delete(window.id);
        this.flushSession();
      }
      this.hosts.delete(window.id);
      this.discardPreparedNewTab(host);
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
      host.downloadsPopover?.close();
      host.extensionsPopover?.close();
      host.groupPopover?.close();
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
    this.discardPreparedNewTab(source);
    this.discardPreparedNewTab(target);
    source.downloadsPopover?.close();
    target.downloadsPopover?.close();
    source.extensionsPopover?.close();
    target.extensionsPopover?.close();
    source.findBar?.close();
    target.findBar?.close();
    target.privateBrowsing = source.privateBrowsing;
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
    target.base.groupId = source.base.groupId;
    target.groups = source.groups;
    target.savedGroups = source.savedGroups;
    source.groupPopover?.close();
    target.groupPopover?.close();
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
    // A closed/replaced page can remain painted beneath a slow destination.
    // Its timers still run, but it no longer owns any tab controls.
    if (!host.tabs.some(tab => tab.contents === sender) &&
        sender !== host.notificationOverlay?.contents &&
        sender !== host.downloadsPopover?.contents &&
        sender !== host.extensionsPopover?.contents &&
        sender !== host.groupPopover?.contents &&
        sender !== host.findBar?.contents) {
      // "open" callers fall back to window.open on false. Consume obsolete
      // link requests so a retired renderer cannot create a fallback window.
      return command.type === "open";
    }
    switch (command.type) {
      case "notification-targets": {
        const tab = host.tabs.find(candidate => candidate.contents === sender);
        if (!tab || tab.browser || !command.urls.every(url => isTabPageUrl(this.options.allowed, url))) return false;
        tab.notificationUrls = command.urls;
        return true;
      }
      case "notification-open": {
        const url = command.urls[0];
        if (!url || !command.urls.every(candidate => isTabPageUrl(this.options.allowed, candidate))) return false;
        // Live selection takes precedence over a stale deep link. Before a new
        // renderer reports its selection, its requested URL prevents duplicates.
        const windows = [host, ...Array.from(this.hosts.values()).filter(other => other !== host && !other.privateBrowsing)];
        for (const owner of windows) {
          if (owner.window.isDestroyed()) continue;
          const existing = owner.tabs.find(tab => !tab.browser && !tab.contents.isDestroyed() &&
            (tab.notificationUrls ?? [tab.url]).some(candidate => command.urls.includes(candidate)));
          if (!existing) continue;
          if (owner.window.isMinimized()) owner.window.restore();
          owner.window.show();
          owner.window.focus();
          this.activate(owner, existing.id, false);
          return true;
        }
        if (!this.enabled) {
          this.options.openWindow(url);
          return true;
        }
        return this.openTab(host, url, { background: false, origin: "link", showLoader: false }) !== null;
      }
      case "learn-activity": {
        const tab = host.tabs.find(candidate => candidate.contents === sender);
        if (!tab || tab.browser) return false;
        const pathname = new URL(sender.getURL()).pathname.replace(/\/$/, "");
        // A late update from the workspace being left cannot mark its successor.
        if (pathname !== `/gardens/${encodeURIComponent(command.gardenId)}`) return false;
        if (tab.learnActivity?.pathname === pathname && tab.learnActivity.active === command.active) return true;
        tab.learnActivity = { pathname, active: command.active };
        this.broadcast(host);
        return true;
      }
      case "voice-overlay": {
        const tab = host.tabs.find(candidate => candidate.contents === sender);
        if (!tab || (command.open && (tab.id !== host.activeId || host.pending))) return false;
        tab.voiceOverlay = command.open;
        if (command.open) host.downloadsPopover?.close();
        if (command.open) host.extensionsPopover?.close();
        if (command.open) this.detachBrowser(host.window, tab);
        else this.syncBrowser(host);
        this.layoutNotificationOverlay(host);
        if (command.open) tab.contents.focus();
        return true;
      }
      case "browser-notifications-enabled":
      case "browser-notification-permission":
      case "browser-translation-language": {
        const saved = this.browserPreferences.update(command);
        if (saved) this.browserNotifications.preferencesChanged();
        return saved;
      }
      case "browser-notification-action":
        return sender === host.notificationOverlay?.contents && this.browserNotifications.action(command.id, command.action, host.window);
      case "browser-notification-permission-response":
        return sender === host.notificationOverlay?.contents && this.browserNotifications.respondToPermission(command.id, command.permission, host.window);
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
      case "navigation-check": {
        const tab = host.tabs.find(tab => tab.contents === sender);
        return !!tab && this.allowTabNavigation(tab, command.url);
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
        if (!tab || tab.browser?.privatePartition || host.privateBrowsing) return false;
        tab.anchored = !tab.anchored;
        this.broadcast(host);
        this.flushSession();
        return true;
      }
      case "move": {
        if (!this.enabled) return false;
        if (command.groupId) {
          const source = tabById(host, command.id), member = host.tabs.find(tab => tab.groupId === command.groupId);
          if (!source || !member || Boolean(source.browser?.privatePartition) !== Boolean(member.browser?.privatePartition)) return false;
        }
        if (!moveGroupedTab(host, command.id, command.index, command.groupId)) return false;
        this.broadcast(host);
        return true;
      }
      case "group-move": {
        if (!this.enabled || !moveTabGroup(host, command.groupId, command.index)) return false;
        this.broadcast(host);
        return true;
      }
      case "tab-menu":
        return this.enabled && this.openTabMenu(host, command);
      case "group-tabs": {
        if (!this.enabled) return false;
        const source = tabById(host, command.id), target = tabById(host, command.targetId);
        if (!source || !target || Boolean(source.browser?.privatePartition) !== Boolean(target.browser?.privatePartition)) return false;
        const colors = Object.keys(TAB_GROUP_COLORS) as TabGroup["color"][];
        const fresh: TabGroup = { id: randomUUID(), name: "", color: colors[host.groups.length % colors.length]!, collapsed: false };
        if (!groupTabs(host, command.id, command.targetId, fresh)) return false;
        if (source.id === host.activeId) {
          const group = host.groups.find(group => group.id === source.groupId);
          if (group) group.collapsed = false;
        }
        this.broadcast(host);
        return true;
      }
      case "group-update": {
        if (!this.enabled) return false;
        const group = host.groups.find(group => group.id === command.groupId);
        if (!group) return false;
        if (command.name !== undefined) group.name = command.name.trim();
        if (command.color !== undefined) group.color = command.color;
        if (command.collapsed !== undefined) group.collapsed = command.collapsed;
        if (group.collapsed && tabById(host, host.activeId)?.groupId === group.id) {
          const next = host.tabs.find(tab => tab.groupId !== group.id && !host.groups.some(group => group.id === tab.groupId && group.collapsed));
          if (next) this.activate(host, next.id);
          else this.openBlankTab(host);
        }
        this.broadcast(host);
        return true;
      }
      case "group-action":
        return this.enabled && this.groupAction(host, command.groupId, command.action);
      case "group-menu":
        return this.enabled && this.openGroupMenu(host, command);
      case "group-menu-resize":
        if (host.groupPopover?.contents !== sender) return false;
        host.groupPopover.resize(command.height);
        return true;
      case "group-menu-close":
        if (host.groupPopover?.contents !== sender) return false;
        host.groupPopover.close(true);
        return true;
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
          undefined,
          host.tabs.find(tab => tab.contents === sender)?.browser?.privatePartition
            ?? (host.privateBrowsing ? this.privateBrowserPartition() : null),
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
      case "browser-downloads-popover": {
        const tab = host.tabs.find(candidate => candidate.contents === sender && candidate.id === host.activeId);
        if (!tab?.browser) return false;
        // A click on the toolbar first focuses its native view, dismissing
        // the popup. Do not reopen it from that same click's later event.
        if (Date.now() - (host.downloadsClosedAt ?? 0) < 200) return true;
        return this.openToolbarPopover(host, tab, command, "downloads");
      }
      case "browser-downloads-resize": {
        if (host.downloadsPopover?.contents !== sender) return false;
        host.downloadsPopover.resize(command.height);
        return true;
      }
      case "browser-downloads-close": {
        const popup = host.downloadsPopover;
        if (!popup) return true;
        const tab = tabById(host, popup.ownerId);
        if (sender !== popup.contents && sender !== tab?.contents) return false;
        popup.close();
        if (tab && !tab.contents.isDestroyed()) tab.contents.focus();
        return true;
      }
      case "browser-downloads-show-all": {
        const popup = host.downloadsPopover;
        if (!popup || popup.contents !== sender) return false;
        const tab = tabById(host, popup.ownerId);
        popup.close();
        if (!tab || tab.contents.isDestroyed()) return false;
        tab.contents.focus();
        void this.browserMenuAction(host, tab, "downloads");
        return true;
      }
      case "browser-extensions-popover": {
        const tab = host.tabs.find(candidate => candidate.contents === sender && candidate.id === host.activeId);
        if (!tab?.browser || host.pending) return false;
        if (Date.now() - (host.extensionsClosedAt ?? 0) < 200) return true;
        return this.openToolbarPopover(host, tab, command, "extensions");
      }
      case "browser-extensions-resize": {
        if (host.extensionsPopover?.contents !== sender) return false;
        host.extensionsPopover.resize(command.height);
        return true;
      }
      case "browser-extensions-close": {
        const popup = host.extensionsPopover;
        if (!popup) return true;
        if (sender !== popup.contents && sender !== tabById(host, popup.ownerId)?.contents) return false;
        popup.close(true);
        return true;
      }
      case "browser-extensions-picture-in-picture": {
        const popup = host.extensionsPopover;
        if (!popup || popup.contents !== sender) return false;
        const tab = tabById(host, popup.ownerId);
        popup.close(true);
        if (!tab) return false;
        void this.browserMenuAction(host, tab, "picture-in-picture");
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
        if (!tab) return false;
        const target = this.findTarget(tab);
        if (!target || target.contents.isDestroyed()) return false;
        if (command.type === "browser-find-close" || !command.text) {
          this.clearFind(target);
          if (command.type === "browser-find-close") {
            if (host.activeId === tab.id) target.contents.focus();
          }
          this.broadcast(host);
        } else {
          // A tab can move between browser home and a native website. Clear
          // the previous document's highlights before searching the new one.
          const previous = target === tab ? liveBrowserPage(tab.browser) : tab;
          if (previous?.findQuery) this.clearFind(previous);
          const continuing = target.findQuery === command.text && target.findRequestId !== undefined;
          target.findQuery = command.text;
          // Electron's findNext means start a new session; our command means
          // advance to another match in the existing session.
          target.findRequestId = target.contents.findInPage(command.text, { forward: command.forward !== false, findNext: command.findNext !== true || !continuing });
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
        if (tab.browser.addressSuggestionsOpen === command.open) return true;
        tab.browser.addressSuggestionsOpen = command.open;
        if (host.activeId === tab.id) this.layout(host);
        return true;
      }
      case "browser-extension-load": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = host.tabs.find(candidate => candidate.contents === sender || candidate.id === popup?.ownerId);
        if (!tab?.browser) return false;
        return popup ? popup.keepOpenDuring(() => this.loadBrowserExtension(host, tab)) : this.loadBrowserExtension(host, tab);
      }
      case "browser-extension-action": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = host.tabs.find(candidate => candidate.contents === sender || candidate.id === popup?.ownerId);
        const page = liveBrowserPage(tab?.browser);
        if (!tab?.browser || tab.id !== host.activeId || tab.browser.privatePartition || (!page && command.menuId === undefined) || command.id !== GOOGLE_PIP_EXTENSION_ID || !this.googlePipExtension?.state(command.id)) return false;
        return this.googlePipExtension.activate(page?.contents ?? null, command.menuId).then(() => {
          if (command.menuId === undefined) popup?.close(true);
          return true;
        }, error => {
          this.log(`Google PiP action failed: ${String(error)}`);
          return false;
        });
      }
      case "browser-extension-reload": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = host.tabs.find(candidate => candidate.contents === sender || candidate.id === popup?.ownerId);
        return tab?.browser
          ? this.reloadBrowserExtension(tab, command.id)
          : false;
      }
      case "browser-extension-remove": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = host.tabs.find(candidate => candidate.contents === sender || candidate.id === popup?.ownerId);
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

  private openTabMenu(host: Host, command: Extract<TabsCommand, { type: "tab-menu" }>): boolean {
    const tab = tabById(host, command.id);
    if (!tab) return false;
    const index = tabIndex(host, tab.id);
    const menu = Menu.buildFromTemplate(tabContextMenuTemplate({
      anchored: tab.anchored,
      private: Boolean(tab.browser?.privatePartition || host.privateBrowsing),
      hasLink: Boolean(tab.url),
      canCloseOthers: host.tabs.some(other => other !== tab && !other.anchored),
      canCloseRight: host.tabs.slice(index + 1).some(other => !other.anchored),
      canReopen: host.closedTabs.length > 0 && !host.privateBrowsing &&
        !tabById(host, host.activeId)?.browser?.privatePartition,
    }, action => setImmediate(() => this.tabContextAction(host, tab, action))));
    host.tabMenu?.closePopup(host.window);
    host.groupPopover?.close();
    host.downloadsPopover?.close();
    host.extensionsPopover?.close();
    host.tabMenu = menu;
    const [width = 1200, height = 800] = host.window.getContentSize();
    menu.popup({
      window: host.window,
      x: Math.max(0, Math.min(width - 1, Math.round(command.x))),
      y: Math.max(0, Math.min(height - 1, Math.round(command.y))),
      callback: () => { if (host.tabMenu === menu) host.tabMenu = undefined; },
    });
    return true;
  }

  private tabContextAction(host: Host, tab: Tab, action: TabContextAction): void {
    // Selection may change, or the source may close/move, while the menu is open.
    if (!this.enabled || host.window.isDestroyed() || !host.tabs.includes(tab)) return;
    switch (action) {
      case "duplicate":
      case "new-right": {
        const url = action === "duplicate" ? tab.url : this.newTabUrl;
        const created = tab.browser
          ? this.openBrowserTab(host, action === "duplicate" && !tab.browser.showingHome ? tab.url || undefined : undefined,
              true, undefined, undefined, undefined, tab.browser.privatePartition ?? null)
          : url ? this.openTab(host, url, { background: true, origin: "blank" }) : null;
        if (!created) return;
        const rest = host.tabs.filter(other => other !== created);
        moveGroupedTab(host, created.id, rest.indexOf(tab) + 1, tab.groupId ?? null);
        this.activate(host, created.id);
        return;
      }
      case "reload":
        if (tab.browser?.showingHome) { if (!tab.contents.isDestroyed()) tab.contents.reload(); }
        else this.reloadTab(host, tab);
        return;
      case "anchor":
        this.handleCommand(tab.contents, { type: "anchor", id: tab.id });
        return;
      case "copy-link":
        if (tab.url) clipboard.writeText(tab.url);
        return;
      case "close":
        this.closeTab(host, tab.id);
        return;
      case "close-others":
      case "close-right": {
        const candidates = action === "close-right" ? host.tabs.slice(tabIndex(host, tab.id) + 1) : [...host.tabs];
        for (const other of candidates.reverse()) {
          if (other !== tab && !other.anchored) this.closeTab(host, other.id);
        }
        return;
      }
      case "reopen":
        this.reopenClosedTab(host);
    }
  }

  private findTarget(tab: Tab): (PageFindState & { contents: WebContents }) | null {
    return tab.browser && !tab.browser.showingHome ? liveBrowserPage(tab.browser) : tab;
  }

  private clearFind(target: PageFindState & { contents: WebContents }): void {
    target.findQuery = undefined;
    target.findRequestId = undefined;
    target.find = undefined;
    if (!target.contents.isDestroyed()) target.contents.stopFindInPage("clearSelection");
  }

  private requestFind(host: Host, tab: Tab, close = false): void {
    if (tab.contents.isDestroyed()) return;
    if (close) { host.findBar?.close(); return; }
    if (host.findBar?.ownerId === tab.id) { host.findBar.focus(); return; }
    host.findBar?.close();
    this.exitBrowserFullscreen(host);
    const localPage = !tab.browser || tab.browser.showingHome;
    if (localPage) void tab.contents.executeJavaScript(`(() => {
      const focused = document.activeElement;
      window[Symbol.for('breadboard:find-return-focus')] = () => {
        if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true });
      };
    })()`).catch(() => undefined);
    const bar = new FindInPage(host.window, tab.id,
      tab.browser ? BROWSER_CONTENT_TOP_INSET : BREADBOARD_TITLE_BAR.height,
      this.options.theme(),
      command => { void this.handleCommand(tab.contents, command); },
      (event, input) => this.handleInput(host, event, input),
      () => {
        if (host.findBar === bar) host.findBar = undefined;
        void this.handleCommand(tab.contents, { type: "browser-find-close" });
        if (localPage && !tab.contents.isDestroyed()) void tab.contents.executeJavaScript(`(() => {
          const key = Symbol.for('breadboard:find-return-focus');
          window[key]?.();
          delete window[key];
        })()`).catch(() => undefined);
      },
    );
    host.findBar = bar;
    bar.update(this.findTarget(tab)?.find);
  }

  private async browserMenuAction(host: Host, tab: Tab, action: BrowserMenuAction): Promise<void> {
    if (host.window.isDestroyed() || tab.contents.isDestroyed() || !host.tabs.includes(tab) || !tab.browser) return;
    const browser = liveBrowserPage(tab.browser);
    const page = browser && !tab.browser.showingHome ? browser.contents : null;
    const internal = (pathname: string) => this.openTab(host, new URL(pathname, tab.browser!.shellUrl).toString(), { background: false, origin: "link", from: tab });
    try {
      switch (action) {
        case "picture-in-picture":
          if (page && !tab.browser.privatePartition && this.googlePipExtension?.state(GOOGLE_PIP_EXTENSION_ID)) {
            await this.googlePipExtension.activate(page);
            return;
          }
          if (page && !await toggleBrowserPictureInPicture(page)) {
            this.publishNotificationToast(tab.contents, { type: "error", message: "No video is ready for Picture in Picture on this page. Start a video and try again." });
          }
          return;
        case "profile": internal("/profile"); return;
        case "settings": internal("/browser/settings"); return;
        case "appearance": internal("/browser/settings?section=appearance"); return;
        case "new-tab": this.openBrowserTab(host); return;
        case "new-window": this.options.openWindow(tab.browser.shellUrl, Boolean(tab.browser.privatePartition || host.privateBrowsing)); return;
        case "new-private-tab": this.openBrowserTab(host, undefined, false, undefined, undefined, undefined, this.privateBrowserPartition()); return;
        case "new-private-window": this.options.openWindow(tab.browser.shellUrl, true); return;
        case "find": this.requestFind(host, tab); return;
        case "history": case "bookmarks": case "downloads":
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
            { label: this.googlePipExtension?.state(GOOGLE_PIP_EXTENSION_ID) && !tab.browser.privatePartition ? "Picture in Picture (Google)" : "Picture in Picture (Built-in)", enabled: Boolean(page), accelerator: "Alt+P", registerAccelerator: false,
              click: () => { void this.browserMenuAction(host, tab, "picture-in-picture"); } },
            { type: "separator" as const },
            ...extensions.map(extension => ({ label: extension.name.replace(/&/g, "&&"), submenu: [
              ...(extension.action ? [
                { label: "Open", enabled: Boolean(page) && !tab.browser!.privatePartition, click: () => run(async () => { await this.googlePipExtension!.activate(page); return true; }) },
                ...extension.action.menus.map(item => ({ label: item.title, ...(item.checked === undefined ? {} : {type: "checkbox" as const, checked:item.checked}),
                  enabled: !tab.browser!.privatePartition, click: () => run(async () => { await this.googlePipExtension!.activate(page, item.id); return true; }) })),
                { type: "separator" as const },
              ] : []),
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
        case "fullscreen": this.toggleWindowFullscreen(host); return;
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
      if (!tab.browser?.privatePartition) this.browserPreferences.update({ type: "browser-translation-language", language: target });
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
      ? this.stateForTab(host, host.tabs.find((tab) => tab.contents.id === sender.id))
      : {
          enabled: this.enabled,
          activeId: null,
          selfId: null,
          tabs: [],
          extensions: this.browserExtensionViews(),
        };
  }

  /** Startup owns this gate: loading or painting alone never dismisses welcome. */
  setNotificationsVisible(visible: boolean): void {
    this.notificationsVisible = visible;
    for (const host of this.hosts.values()) this.layoutNotificationOverlay(host);
  }

  private openGroupMenu(host: Host, command: Extract<TabsCommand, { type: "group-menu" }>): Promise<boolean> {
    const tab = tabById(host, host.activeId);
    if (!tab || !this.newTabUrl || (command.groupId && !host.groups.some(group => group.id === command.groupId))) return Promise.resolve(false);
    host.groupPopover?.close();
    host.downloadsPopover?.close();
    host.extensionsPopover?.close();
    const popup = new BrowserToolbarPopover(host.window, tab.id,
      { x: command.x + 280, y: command.y }, this.options.preloadPath,
      [tab.contents, ...(tab.browser?.contents ? [tab.browser.contents] : [])], () => {
        this.hostByContents.delete(popup.contents.id);
        if (host.groupPopover === popup) host.groupPopover = undefined;
      }, 280);
    host.groupPopover = popup;
    this.hostByContents.set(popup.contents.id, host);
    const url = new URL("/browser/tab-group-popover", this.newTabUrl);
    if (command.groupId) url.searchParams.set("group", command.groupId);
    url.searchParams.set("theme", this.options.theme());
    return popup.contents.loadURL(url.toString()).then(() => true, error => {
      this.log(`tab group menu failed: ${String(error)}`);
      popup.close();
      return false;
    });
  }

  private groupAction(host: Host, id: string, action: Extract<TabsCommand, { type: "group-action" }>["action"]): boolean {
    if (action === "restore" || action === "delete-saved") {
      const saved = host.savedGroups.find(group => group.id === id);
      if (!saved || host.privateBrowsing || !this.newTabUrl) return false;
      if (action === "restore") {
        const members: Tab[] = [];
        for (const entry of saved.tabs) {
          const url = restoredTabUrl(entry, this.newTabUrl);
          if (url === null || (entry.kind !== "browser" && !isTabPageUrl(this.options.allowed, url))) return false;
        }
        for (const entry of saved.tabs) {
          const url = restoredTabUrl(entry, this.newTabUrl)!;
          const tab = entry.kind === "browser" ? this.openBrowserTab(host, url || undefined, true)
            : this.openTab(host, url, { background: true, origin: "blank" });
          if (!tab) return false;
          tab.title = entry.title;
          tab.anchored = entry.anchored;
          members.push(tab);
        }
        const group = { id: randomUUID(), name: saved.name, color: saved.color, collapsed: false };
        host.tabs = [...host.tabs.filter(tab => !members.includes(tab)), ...members];
        host.groups.push(group);
        for (const tab of members) tab.groupId = group.id;
        if (members[0]) this.activate(host, members[0].id);
      }
      host.savedGroups = host.savedGroups.filter(group => group.id !== id);
      this.broadcast(host);
      this.flushSession();
      return true;
    }
    const group = host.groups.find(group => group.id === id);
    const members = host.tabs.filter(tab => tab.groupId === id);
    if (!group || !members.length) return false;
    switch (action) {
      case "copy-links":
        clipboard.writeText(members.map(tab => tab.url).filter(Boolean).join("\n"));
        return true;
      case "new-tab": {
        const first = members[0]!;
        const tab = first.browser ? this.openBrowserTab(host, undefined, true, undefined, undefined, undefined, first.browser.privatePartition ?? null)
          : this.newTabUrl ? this.openTab(host, this.newTabUrl, { background: true, origin: "blank" }) : null;
        if (!tab) return false;
        moveGroupedTab(host, tab.id, host.tabs.map(tab => tab.groupId).lastIndexOf(id) + 1, id);
        this.activate(host, tab.id);
        return true;
      }
      case "ungroup":
        for (const tab of members) delete tab.groupId;
        break;
      case "new-window":
        return this.moveGroupToWindow(host, group, members);
      case "save-close":
      case "delete": {
        if (members.some(tab => tab.anchored)) return false;
        if (action === "save-close") {
          if (host.privateBrowsing || !this.newTabUrl || members.some(tab => tab.browser?.privatePartition)) return false;
          const tabs = members.map(tab => saveTab(tab, this.newTabUrl!));
          if (tabs.some(tab => !tab)) return false;
          host.savedGroups.push({ ...group, tabs: tabs as SavedTabGroup["tabs"] });
          this.rememberSession(host);
          this.flushSession();
        }
        // Keep the window (and the saved-group entry) available after closing all members.
        if (host.tabs.length === members.length && !this.openBlankTab(host)) return false;
        const replacement = host.tabs.find(tab => tab.groupId !== id);
        if (replacement && members.some(tab => tab.id === host.activeId)) this.activate(host, replacement.id);
        for (const tab of members) this.closeTab(host, tab.id);
        break;
      }
    }
    this.broadcast(host);
    this.flushSession();
    return true;
  }

  private moveGroupToWindow(source: Host, group: TabGroup, members: Tab[]): boolean {
    if (!this.newTabUrl) return false;
    const baseMember = members.find(tab => !tab.view);
    const window = this.options.openWindow(baseMember?.url || this.newTabUrl, Boolean(source.privateBrowsing || members[0]?.browser?.privatePartition));
    const target = window && this.hosts.get(window.id);
    if (!target) return false;
    source.groupPopover?.close();
    if (source.tabs.length === members.length && !this.openBlankTab(source)) return false;
    this.cancelReveal(source);
    this.runAfterReveal(source);
    const moved: Tab[] = [];
    for (const tab of members) {
      if (!tab.view) {
        // Electron's window-owned contents cannot be reparented. Reopen that
        // original page; all WebContentsView tabs below retain their live state.
        target.base.groupId = group.id;
        target.base.anchored = tab.anchored;
        target.base.title = tab.title;
        moved.push(target.base);
      } else {
        this.detach(source.window, tab);
        tab.id = target.nextId++;
        this.hostByContents.set(tab.contents.id, target);
        if (tab.browser?.contents) this.hostByContents.set(tab.browser.contents.id, target);
        moved.push(tab);
      }
    }
    source.tabs = source.tabs.filter(tab => !members.includes(tab));
    target.groups.push({ ...group, collapsed: false });
    target.tabs = [...moved, ...(baseMember ? [] : [target.base])];
    if (source.tabs[0]) this.activate(source, source.tabs[0].id);
    if (baseMember) this.whenRevealed(source, () => this.retireBase(source));
    if (moved[0]) this.activate(target, moved[0].id);
    this.broadcast(source);
    this.broadcast(target);
    return true;
  }

  private openToolbarPopover(host: Host, tab: Tab, anchor: { x: number; y: number }, kind: "downloads" | "extensions"): Promise<boolean> {
    host.groupPopover?.close();
    const key = kind === "downloads" ? "downloadsPopover" : "extensionsPopover";
    if (host[key]) return Promise.resolve(true);
    host[kind === "downloads" ? "extensionsPopover" : "downloadsPopover"]?.close();
    const popup = new BrowserToolbarPopover(
      host.window, tab.id, anchor, this.options.preloadPath,
      [tab.contents, ...(tab.browser?.contents ? [tab.browser.contents] : [])],
      () => {
        this.hostByContents.delete(popup.contents.id);
        if (host[key] === popup) host[key] = undefined;
        host[kind === "downloads" ? "downloadsClosedAt" : "extensionsClosedAt"] = Date.now();
        if (!host.window.isDestroyed()) this.broadcast(host);
      },
      kind === "extensions" ? 350 : 440,
    );
    host[key] = popup;
    this.hostByContents.set(popup.contents.id, host);
    this.broadcast(host);
    const url = new URL(`/browser/${kind}-popover`, tab.browser!.shellUrl);
    if (kind === "extensions") url.searchParams.set("theme", this.options.theme());
    return popup.contents.loadURL(url.toString()).then(() => true, error => {
      if (popup.isClosed) return true;
      this.log(`${kind} popover failed: ${String(error)}`);
      popup.close();
      return false;
    });
  }

  /** Only app-owned tabs and their embedded browser pages, never DevTools or
   * unrelated Electron contents. Used by the authenticated Breadboard skill. */
  breadboardUseTargets() {
    return [...this.hosts.values()].filter(host => !host.window.isDestroyed()).flatMap(host =>
      host.tabs.flatMap(tab => {
        const info = { windowId: host.window.id, tabId: tab.id, active: tab.id === host.activeId, focusedWindow: host.window.isFocused(), chrome: tab.contents };
        const targets = [{ ...info, kind: tab.browser ? "chrome" : "app", contents: tab.contents }];
        const browser = liveBrowserPage(tab.browser);
        if (browser && !tab.browser?.showingHome) targets.push({ ...info, kind: "browser", contents: browser.contents! });
        return targets.filter(target => !target.contents.isDestroyed() && /^https?:\/\//i.test(target.contents.getURL()));
      }),
    );
  }

  private browserExtensionPathKey(extensionPath: string): string {
    const resolved = path.resolve(this.googlePipExtension?.sourcePath(extensionPath) ?? extensionPath);
    return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  }

  private browserExtensionViews(): BrowserExtensionView[] {
    return (this.browserExtensionSession?.getAllExtensions() ?? [])
      .map((extension) => {
        if (!this.browserExtensionIcons.has(extension.id)) {
          this.browserExtensionIcons.set(extension.id, readBrowserExtensionIcon(extension.path, extension.manifest.icons));
        }
        return {
          id: extension.id,
          name: extension.name,
          version: extension.version,
          iconUrl: this.browserExtensionIcons.get(extension.id),
          ...(this.googlePipExtension?.state(extension.id) ? {action: this.googlePipExtension.state(extension.id)} : {}),
        };
      })
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
    this.googlePipExtension ??= new GooglePipExtension(browserSession,
      path.join(this.options.browserExtensionsConfigDir ?? app.getPath("userData"), "extension-runtime"), () => this.broadcastAll());
    browserSession.on("extension-loaded", (_event, extension) => {
      this.browserExtensionIcons.delete(extension.id);
      this.broadcastAll();
      this.refreshBrowserStoreInstallButtons();
    });
    browserSession.on("extension-unloaded", (_event, extension) => {
      this.browserExtensionIcons.delete(extension.id);
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
          const extension = await this.googlePipExtension!.load(extensionPath);
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
      if (!alreadyLoaded) await this.googlePipExtension!.load(extensionPath);
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
      await this.googlePipExtension!.load(extension.path);
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
    page: BrowserPage,
    override?: BrowserWebStoreInstallState,
    errorMessage?: string,
  ): void {
    // Electron queues each executeJavaScript call behind its own loading
    // listener. SPA route changes and extension updates can arrive repeatedly
    // during one stalled load; refresh from did-stop-loading using current state.
    // Teardown nulls contents/view while these same listeners are still firing,
    // so resolve the live page here rather than trusting the caller's cast.
    const browser = liveBrowserPage(page);
    if (!browser) return;
    if (browser.contents.isLoadingMainFrame() || !browser.contents.getURL()) return;
    const extensionId = chromeWebStoreExtensionId(browser.contents.getURL());
    if (!extensionId) {
      void browser.contents
        .executeJavaScript(browserWebStoreInstallCleanupScript())
        .catch(() => undefined);
      return;
    }
    const extension = this.browserExtensionSession?.getExtension(extensionId);
    const compatibilityError = extension ? browserExtensionCompatibilityError(extension.manifest, extensionId) : undefined;
    const failure = this.browserExtensionInstallErrors.get(extensionId);
    const state = override ?? (compatibilityError ? "unsupported"
      : this.browserExtensionInstalls.has(extensionId) ? "installing"
      : extension ? "installed" : failure?.state ?? "available");
    void browser.contents
      .executeJavaScript(browserWebStoreInstallBootstrapScript(extensionId, state, errorMessage ?? compatibilityError ?? failure?.message))
      .catch(() => undefined);
  }

  private async performBrowserStoreInstall(extensionId: string): Promise<boolean> {
    const configDir = this.options.browserExtensionsConfigDir;
    if (!configDir) throw new Error("Browser extension storage is unavailable. Restart Breadboard and try again.");
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    await this.ensureBrowserExtensions(browserSession);
    const existingExtension = browserSession.getExtension(extensionId);
    if (existingExtension) {
      const compatibilityError = browserExtensionCompatibilityError(existingExtension.manifest, extensionId);
      if (compatibilityError) throw new BrowserExtensionCompatibilityError(compatibilityError);
      return true;
    }
    const chromeVersion = process.versions.chrome;
    if (!chromeVersion) throw new Error("Chromium version is unavailable.");
    const archive = await downloadChromeWebStorePackage(extensionId, chromeVersion, (options) => net.request(options));
    const extensionPath = installChromeWebStorePackage(configDir, extensionId, archive);
    const extension = await this.googlePipExtension!.load(extensionPath);
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
    this.browserExtensionInstallErrors.delete(extensionId);
    const install = this.performBrowserStoreInstall(extensionId);
    this.browserExtensionInstalls.set(extensionId, install);
    this.refreshBrowserStoreInstallButton(browser, "installing");
    try {
      const installed = await install;
      this.refreshBrowserStoreInstallButton(browser, installed ? "installed" : "failed");
      return installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = error instanceof BrowserExtensionCompatibilityError ? "unsupported" : "failed";
      this.browserExtensionInstallErrors.set(extensionId, { state, message });
      this.log(
        `Chrome Web Store extension ${extensionId} failed to install: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.refreshBrowserStoreInstallButton(browser, state, message);
      return false;
    } finally {
      if (this.browserExtensionInstalls.get(extensionId) === install) {
        this.browserExtensionInstalls.delete(extensionId);
      }
      this.refreshBrowserStoreInstallButtons();
    }
  }

  /** Reload the page in front of `window`, which is not always its own page. */
  reloadActive(window: BrowserWindow): void {
    const host = this.hosts.get(window.id);
    const active = host ? tabById(host, host.activeId) : undefined;
    if (host && active) this.reloadTab(host, active);
    else if (!window.isDestroyed()) window.webContents.reload();
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
    const from = host.tabs.find(tab => tab.contents === sender || tab.browser?.contents === sender);
    this.openBrowserTab(host, url, background, undefined, undefined, undefined,
      from?.browser?.privatePartition ?? (host.privateBrowsing ? this.privateBrowserPartition() : null));
  }

  // ------------------------------------------------------------------ state

  private state(host: Host): TabsState {
    const tabs: TabView[] = host.tabs.map((tab) => ({
      id: tab.id,
      anchored: tab.anchored,
      ...(tab.groupId ? { groupId: tab.groupId } : {}),
      title: tab.title,
      url: tab.url,
      loading: tab.loading || !tab.loaded,
      ...(tab.find ? { find: tab.find } : {}),
      learnActive: !tab.browser && tab.learnActivity?.active === true &&
        new URL(tab.url).pathname.replace(/\/$/, "") === tab.learnActivity.pathname,
      ...(tab.browser
        ? {
            browser: {
              private: Boolean(tab.browser.privatePartition),
              // The run marker only exists so the worker can select this exact
              // Chromium target. It is not an address the person can use, so
              // keep the trusted toolbar looking like an ordinary fresh tab.
              address:
                tab.browser.automationRunId &&
                isBrowserAgentBootstrapUrl(tab.url, tab.browser.automationRunId)
                  ? ""
                  : tab.url,
              pageReady: tab.browser.ready && !tab.browser.showingHome,
              canGoBack:
                !tab.browser.showingHome &&
                (tab.browser.homeEntryAvailable ||
                  this.browserNavigationTarget(tab, "back") !== null),
              canGoForward: tab.browser.showingHome
                ? this.browserHomeForwardAvailable(tab)
                : this.browserNavigationTarget(tab, "forward") !== null,
              terminalOpen: tab.browser.terminalOpen,
              downloadsOpen: host.downloadsPopover?.ownerId === tab.id,
              extensionsOpen: host.extensionsPopover?.ownerId === tab.id,
              terminalWidth: tab.browser.terminalWidth,
              zoomPercent: liveBrowserPage(tab.browser) ? Math.round(tab.browser.contents!.getZoomFactor() * 100) : 100,
              ...(tab.browser.translation ? { translation: tab.browser.translation.state } : {}),
              ...(this.findTarget(tab)?.find ? { find: this.findTarget(tab)!.find } : {}),
              ...(tab.browser.favicon ? { favicon: tab.browser.favicon } : {}),
              ...(tab.browser.selection ? { selection: tab.browser.selection } : {}),
            },
          }
        : {}),
    }));
    return {
      enabled: this.enabled,
      windowFocused: host.window.isFocused(),
      activeId: host.activeId,
      navigationPending: host.pending !== null && host.pendingNavigation && !host.loadingScene?.attached,
      selfId: null,
      tabs,
      groups: host.groups,
      savedGroups: host.savedGroups.map(({ tabs, ...group }) => ({ ...group, tabCount: tabs.length })),
      extensions: this.browserExtensionViews(),
      browserPreferences: this.browserPreferences.snapshot(),
    };
  }

  private broadcast(host: Host): void {
    if (!this.restoringSession) normalizeTabGroups(host);
    this.rememberSession(host);
    const state = this.state(host);
    for (const tab of host.tabs) this.send(tab.contents, this.stateForTab(host, tab, state));
    if (host.preparedNewTab) this.send(host.preparedNewTab.contents, state);
    this.scheduleNewTabPreparation(host);
    if (host.extensionsPopover) this.send(host.extensionsPopover.contents, state);
    if (host.groupPopover) this.send(host.groupPopover.contents, state);
    const findOwner = host.findBar && tabById(host, host.findBar.ownerId);
    if (findOwner) host.findBar?.update(this.findTarget(findOwner)?.find);
  }

  private stateForTab(host: Host, tab: Tab | undefined, state = this.state(host)): TabsState {
    // A reveal belongs to the outgoing page and its destination. Starting the
    // bar in every background renderer leaves a completion animation waiting
    // when the user switches back to an otherwise fully loaded website.
    const outgoing = host.tabs.find((candidate) =>
      candidate.view && candidate.attached && candidate !== host.pending,
    ) ?? host.base;
    return {
      ...state,
      selfId: tab?.id ?? null,
      navigationPending: state.navigationPending === true &&
        (tab === host.pending || tab === outgoing),
    };
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

  private discardPreparedNewTab(host: Host): void {
    if (host.prepareNewTabTimer) clearTimeout(host.prepareNewTabTimer);
    host.prepareNewTabTimer = undefined;
    const tab = host.preparedNewTab;
    host.preparedNewTab = undefined;
    if (tab) this.dispose(host, tab);
  }

  private scheduleNewTabPreparation(host: Host): void {
    if (!this.enabled || this.sessionFrozen || !this.newTabUrl || host.privateBrowsing ||
        host.window.isDestroyed() || host.preparedNewTab || host.prepareNewTabTimer || host.pending || host.newTabPreparationFailed) return;
    const active = tabById(host, host.activeId);
    if (!active?.loaded || active.browser?.privatePartition || !isTabPageUrl(this.options.allowed, active.browser?.shellUrl ?? active.url)) return;
    if (new URL(active.browser?.shellUrl ?? active.url).pathname.startsWith("/auth/")) return;
    // Give the page the person just opened priority over preparing its successor.
    host.prepareNewTabTimer = setTimeout(() => {
      host.prepareNewTabTimer = undefined;
      if (host.pending || host.window.isDestroyed()) return;
      void this.prepareNewTab(host).catch(error => {
        host.newTabPreparationFailed = true;
        this.discardPreparedNewTab(host);
        this.log(`new tab preparation failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 500);
    host.prepareNewTabTimer.unref();
  }

  private async prepareNewTab(host: Host): Promise<void> {
    const url = this.newTabUrl;
    if (!url || !this.enabled || this.sessionFrozen || host.privateBrowsing ||
        host.preparedNewTab || host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    if (!active?.loaded || active.browser?.privatePartition ||
        !isTabPageUrl(this.options.allowed, active.browser?.shellUrl ?? active.url) ||
        new URL(active.browser?.shellUrl ?? active.url).pathname.startsWith("/auth/")) return;
    const previousFocus = webContents.getFocusedWebContents();
    const tab = this.createView(host, url);
    host.preparedNewTab = tab;
    const current = () => host.preparedNewTab === tab && !host.window.isDestroyed() && !tab.contents.isDestroyed();
    // Windows can focus an offscreen WebContentsView as its document loads.
    // Only a deliberate activation may give the spare keyboard focus.
    const restoreFocus = () => {
      if (!current() || !host.window.isFocused()) return;
      const foreground = tabById(host, host.activeId);
      const target = foreground === active && previousFocus && !previousFocus.isDestroyed()
        ? previousFocus
        : liveBrowserPage(foreground?.browser)?.contents ?? foreground?.contents;
      if (target && !target.isDestroyed()) target.focus();
    };
    tab.contents.on("focus", restoreFocus);
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") {
      this.discardPreparedNewTab(host);
      return;
    }
    setViewBounds(tab.view!, offscreenBounds(width, height));
    host.window.contentView.addChildView(tab.view!);
    tab.attached = true;
    tab.view!.setVisible(true);
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        (async () => {
          if (!tab.loaded) await new Promise<void>(resolve => tab.onLoaded.push(resolve));
          if (!current() || tab.contents.getURL() !== url) return false;
          await waitForTabChrome(tab.contents, current);
          if (!current()) return false;
          await this.frameReady(tab);
          return current() && tab.contents.getURL() === url && !tab.recovering;
        })(),
        new Promise<false>(resolve => { ceiling = setTimeout(() => resolve(false), 30_000); }),
      ]);
      if (!current()) return; // Already claimed or disposed; the foreground owns it now.
      if (!ready) {
        host.newTabPreparationFailed = true;
        this.discardPreparedNewTab(host);
        return;
      }
      tab.painted = true;
      this.detach(host.window, tab);
    } catch (error) {
      if (current()) {
        host.newTabPreparationFailed = true;
        this.discardPreparedNewTab(host);
      }
      this.log(`new tab preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (ceiling) clearTimeout(ceiling);
      tab.contents.removeListener("focus", restoreFocus);
    }
  }

  private takePreparedNewTab(host: Host, url: string): Tab | undefined {
    const tab = host.preparedNewTab;
    if (!tab || url !== this.newTabUrl) return;
    if (tab.contents.isDestroyed() || tab.contents.isCrashed() || tab.recovering || tab.url !== url) {
      this.discardPreparedNewTab(host);
      return;
    }
    host.preparedNewTab = undefined;
    // An in-flight preparation can be claimed too, but must use normal reveal.
    this.detach(host.window, tab);
    return tab;
  }

  private openBlankTab(host: Host): boolean {
    if (host.privateBrowsing || tabById(host, host.activeId)?.browser?.privatePartition) {
      return this.openBrowserTab(host) !== null;
    }
    const url = this.newTabUrl;
    if (!url || host.window.isDestroyed()) return false;
    host.newTabPreparationFailed = false;
    return this.openTab(host, url, { background: false, origin: "blank" }) !== null;
  }

  /** A view with a hardened page loading `url`, tracked but not yet a tab. */
  private createView(host: Host, url: string): Tab {
    const view = new WebContentsView({
      webPreferences: tabRendererWebPreferences(this.options.preloadPath),
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
    const tab = (options.origin === "blank" ? this.takePreparedNewTab(host, url) : undefined)
      ?? this.createView(host, url);

    const activeIndex = tabIndex(host, host.activeId);
    const from = options.from ?? tabById(host, host.activeId);
    const index = insertIndexForOpenedTab(
      activeIndex,
      host.tabs.length,
      options.origin,
      options.origin === "link" && from ? from.spawned : 0,
    );
    if (options.origin === "link" && from) from.spawned += 1;
    if (options.origin === "link" && from?.groupId) tab.groupId = from.groupId;
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

  private allowTabNavigation(tab: Tab, url: string): boolean {
    if (!tab.anchored || isSameTabScreen(tab.browser?.shellUrl ?? tab.url, url)) return true;
    this.publishNotificationToast(tab.contents, {
      type: "error",
      message: ANCHORED_TAB_NAVIGATION_MESSAGE,
    });
    return false;
  }

  /** A page-local completion enters the overlay belonging to that page's
   * window. Durable chat notices are polled by the overlay renderer itself. */
  publishNotificationToast(
    sender: WebContents,
    notice: DesktopNotificationToast,
  ): boolean {
    // Both deliveries must identify the same card, including native notices
    // that did not originate in a page's useToast hook.
    notice = { ...notice, id: notice.id ?? (notice.notificationPermission ? `website-permission:${notice.notificationPermission.id}`
      : notice.website ? `website:${notice.website.id}` : `toast:${randomUUID()}`) };
    this.onVoiceNotification?.(notice);
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

  onVoiceNotification?: (notice: DesktopNotificationToast) => void;

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
    this.layoutNotificationOverlay(host, true);
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
    privatePartition: string | null = replace?.browser?.privatePartition ?? tabById(host, host.activeId)?.browser?.privatePartition
      ?? (host.privateBrowsing ? this.privateBrowserPartition() : null),
  ): Tab | null {
    const shellUrl = this.browserUrl;
    const initialUrl = requestedUrl === undefined ? null : browserUrlForInput(requestedUrl);
    if (requestedUrl !== undefined && !initialUrl) return null;
    if (!this.enabled || !shellUrl || host.window.isDestroyed()) {
      if (initialUrl) this.options.openExternal?.(initialUrl);
      return null;
    }

    if (replace && !this.allowTabNavigation(replace, shellUrl)) return null;
    const tab = this.createView(host, shellUrl);
    // The toolbar and recents paint above the native page when the omnibox
    // is open; the rest of this renderer must allow that page to show through.
    tab.view?.setBackgroundColor("#00000000");
    tab.anchored = replace?.anchored ?? false;
    tab.groupId = replace?.groupId;
    tab.browser = {
      scriptOpened: Boolean(popup),
      privatePartition: privatePartition ?? undefined,
      shellUrl,
      view: null,
      contents: null,
      ready: false,
      onReady: [],
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
    this.retainPrivateProfile(tab);
    tab.title = privatePartition ? "Private Tab" : automationRunId ? "Agent Browser" : "Browser";
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
      const active = tabById(host, host.activeId);
      const end = active?.groupId ? host.tabs.map(tab => tab.groupId).lastIndexOf(active.groupId) : tabIndex(host, host.activeId);
      host.tabs.splice(end + 1, 0, tab);
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
      // Opening a website is navigation even when the link requests a new
      // tab. Retain the outgoing page and its bar until that website is ready.
      this.activate(host, tab.id, !replace && !initialUrl && !popup);
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
    if (!browser.privatePartition && this.browserSignInsResetting) return null;
    const existing = liveBrowserPage(browser);
    if (existing) return existing;

    if (browser.contents) this.hostByContents.delete(browser.contents.id);
    // Set the profile before creating a view so native login popups and their
    // first request inherit the same browser identity, including in private mode.
    const browserSession = session.fromPartition(browser.privatePartition ?? BROWSER_SESSION_PARTITION);
    const userAgent = browserUserAgent(browserSession.getUserAgent());
    browserSession.setUserAgent(userAgent);
    // Chromium-owned window.open navigations ignore per-page overrides in
    // Electron 33 (electron/electron#45897). They use the process fallback.
    // Pin the product session's identity before changing that fallback.
    const fallbackUserAgent = browserUserAgent(app.userAgentFallback);
    if (app.userAgentFallback !== fallbackUserAgent) {
      session.defaultSession.setUserAgent(session.defaultSession.getUserAgent());
      app.userAgentFallback = fallbackUserAgent;
    }
    const view = new WebContentsView({
      ...(popupContents ? { webContents: popupContents } : {}),
      webPreferences: {
        ...BROWSER_WEB_PREFERENCES,
        partition: browser.privatePartition ?? BROWSER_SESSION_PARTITION,
      },
    });
    // Adopted popup contents already exist; a session change alone cannot update them.
    view.webContents.setUserAgent(userAgent);
    view.setBackgroundColor(browserPageBackgroundColor(this.options.theme()));
    browser.view = view;
    browser.contents = view.webContents;
    browser.ready = false;
    browser.attached = false;
    const live = browser as LiveBrowserPage;
    this.trackBrowser(host, tab, live);
    // Translation can publish once more while its WebContents is closing. The
    // mutable browser slot is deliberately nulled during teardown, so retain
    // the identity used by hostByContents instead of dereferencing it later.
    const translationContents = live.contents;
    const translationContentsId = translationContents.id;
    const privateTranslationSites = browser.privatePartition ? this.privateProfile?.translationSites ?? new Map<string, string>() : undefined;
    browser.translation = new BrowserTranslation(translationContents, this.options.translatePageBatch ?? (async (segments, language, signal) => {
      const endpoint = new URL("/api/browser/translate", browser.shellUrl).toString();
      const cookies = await tab.contents.session.cookies.get({ url: endpoint });
      // Node's abortable fetch avoids retaining Chromium network requests when
      // the document closes mid-translation. Only this trusted local endpoint
      // receives the shell's session cookies; they never enter the web page.
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") }, redirect: "error",
        body: JSON.stringify({ segments, language }), signal: AbortSignal.any([signal, AbortSignal.timeout(100000)]),
      });
      const value = await response.json() as { segments?: Array<{ id: number; text: string }>; error?: string };
      if (!response.ok || !Array.isArray(value.segments)) throw new Error(value.error || "Translation is unavailable. Check your AI connection in Settings and try again.");
      return value.segments;
    }), () => { const owner = this.hostByContents.get(translationContentsId); if (owner) this.broadcast(owner); }, {
      languageFor: url => privateTranslationSites
        ? privateTranslationSites.get(translationSite(url) ?? "") : this.browserPreferences.translationLanguageFor(url),
      remember: (url, language) => {
        const site = translationSite(url);
        if (!site) return;
        if (privateTranslationSites) {
          if (language === null) privateTranslationSites.delete(site);
          else privateTranslationSites.set(site, language);
        } else this.browserPreferences.setSiteTranslation(url, language);
      },
    });
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

  /**
   * The chatgpt.com page lent to ChatMock's "OpenAI (web)" provider.
   *
   * Not a tab. ChatMock types every request into this page and reads the
   * answer back over the shell's CDP port, and none of that is for the
   * person to watch: the page is a WebContentsView that belongs to no window
   * and appears in no strip. It shares the ordinary browser partition, so the
   * chatgpt.com sign-in is the one the person already has here.
   *
   * The first request creates the page on a unique bootstrap document and
   * records the DevTools target id Chromium assigned; every later request
   * answers with the same id, so ChatMock reattaches after its own restart.
   * `foreground` is the one time the page is shown - signing in, which only
   * a person can do - in a window of its own; a `background` request, or the
   * person closing that window, puts the page back out of sight with its
   * session intact. `reset` is ChatMock saying the page it holds has stopped
   * answering: the page is replaced, target id and all.
   */
  async openChatgptWebTab(options: {
    foreground: boolean;
    cdpPort: number | null;
    reset?: boolean;
    lane?: string;
  }): Promise<{ ok: true; cdpPort: number; targetId: string; lane: string } | { ok: false; error: string }> {
    if (!this.enabled) return { ok: false, error: "browser navigation is turned off" };
    if (!options.cdpPort) return { ok: false, error: "the built-in browser has no DevTools port" };
    if (this.browserSignInsResetting) return { ok: false, error: "browser sign-ins are being reset" };
    const cdpPort = options.cdpPort;
    const lane = options.lane?.trim() || CHATGPT_WEB_DEFAULT_LANE;

    let page = this.chatgptWeb.get(lane) ?? null;
    if (page && page.contents.isDestroyed()) {
      this.chatgptWeb.delete(lane);
      page = null;
    }
    // A crashed renderer keeps its WebContents and its DevTools target, so
    // handing this page back would hand back one that answers nothing. The
    // session is a cookie in the shared partition, not page state, so a
    // replacement costs nothing but a reload.
    if (page && (options.reset === true || page.contents.isCrashed())) {
      this.log(
        `chatgpt-web ${lane} page replaced (${options.reset === true ? "asked for a fresh page" : "its renderer had crashed"})`,
      );
      this.destroyChatgptWebPage(lane);
      page = null;
    }
    if (!page) {
      page = this.createChatgptWebPage(lane);
      this.chatgptWeb.set(lane, page);
    }
    if (!page.targetId) {
      const contents = page.contents;
      const targetUrl = chatgptWebBootstrapUrl(randomUUID().replace(/-/g, ""));
      try {
        // A brand-new WebContents starts on about:blank. Let Chromium publish
        // that target before changing only its fragment; otherwise the remote
        // debugger can permanently retain the initial empty URL for this target.
        await new Promise<void>((resolve) => setImmediate(resolve));
        await contents.loadURL(targetUrl);
        // The page names itself; the listing is only the fallback, and only
        // because a debugger session can be unavailable.
        let targetId = await readDebuggingTargetId(contents);
        if (!targetId && !contents.isDestroyed()) {
          targetId = await resolveDebuggingTargetId(cdpPort, targetUrl);
        }
        if (!targetId) {
          this.log(`chatgpt-web ${lane} page was not listed as ${targetUrl}; url=${contents.getURL()}`);
          return { ok: false, error: "the built-in browser did not list the page" };
        }
        page.targetId = targetId;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.log(`chatgpt-web ${lane} page failed: ${reason}`);
        return { ok: false, error: reason };
      }
    }
    if (options.foreground) this.showChatgptWebPage(page);
    else if (!page.hidden) this.hideChatgptWebPage(page);
    return { ok: true, cdpPort, targetId: page.targetId, lane };
  }

  /** The hidden page's contents, for tests that check it stays alive. */
  chatgptWebPageContents(lane: string = CHATGPT_WEB_DEFAULT_LANE): WebContents | null {
    const page = this.chatgptWeb.get(lane);
    return page && !page.contents.isDestroyed() ? page.contents : null;
  }

  /**
   * Whether the ChatGPT page is in front of the person (a test seam). Parked,
   * its window is deliberately still shown and on screen, so what settles it
   * is whether anything of it is actually drawn.
   */
  chatgptWebPageVisible(lane: string = CHATGPT_WEB_DEFAULT_LANE): boolean {
    const page = this.chatgptWeb.get(lane);
    if (!page || page.window.isDestroyed() || page.hidden) return false;
    return page.window.isVisible() && page.window.getOpacity() > 0;
  }

  private createChatgptWebPage(lane: string): ChatgptWebPage {
    // Same profile and identity as an ordinary browser tab, so the site sees
    // the browser the person signed into.
    const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
    const userAgent = browserUserAgent(browserSession.getUserAgent());
    browserSession.setUserAgent(userAgent);
    const view = new WebContentsView({
      webPreferences: {
        ...BROWSER_WEB_PREFERENCES,
        partition: BROWSER_SESSION_PARTITION,
        // The page answers ChatMock while nobody is looking at it; Chromium's
        // background timer throttling would slow the site's own streaming and
        // the composer automation to a crawl.
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    contents.setUserAgent(userAgent);
    view.setBackgroundColor(browserPageBackgroundColor(this.options.theme()));
    const window = new BrowserWindow({
      ...CHATGPT_WEB_PAGE_SIZE,
      title: "Sign in to ChatGPT",
      show: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      backgroundColor: browserPageBackgroundColor(this.options.theme()),
    });
    window.setMenuBarVisibility(false);
    const page: ChatgptWebPage = { lane, view, contents, window, targetId: undefined, hidden: true };
    const fit = () => {
      if (window.isDestroyed()) return;
      const { width, height } = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    window.on("resize", fit);
    // Shown first, then given the page (see CHATGPT_WEB_PAGE_SIZE above).
    this.parkChatgptWebWindow(window);
    window.contentView.addChildView(view);
    fit();

    // The sandboxed browser preload asks for the notification permission
    // *synchronously* on every document (browser-preload.ts). Without a reply
    // the renderer's main thread blocks forever, which looks exactly like a
    // page that has stopped answering CDP. A page nobody is looking at has no
    // business raising notifications, so the answer is a flat refusal rather
    // than the notification surface an ordinary tab gets.
    contents.ipc.on("breadboard:web-notification:permission", (event) => {
      event.returnValue = "denied";
    });
    contents.ipc.handle("breadboard:web-notification:request", async () => "denied");
    hardenExternalBrowserWebContents(contents, {
      // The partition is shared with every ordinary browser tab, so its
      // permission policy stays exactly what those tabs install. This page's
      // own refusals are the per-page handlers above.
      configurePermissions: (target: Session) => this.browserNotifications.installSession(target),
      // Identity providers may open a popup while the person signs in; that is
      // the only time one is allowed, and it is a plain window of the same
      // profile. Parked out of sight, the page has no business opening
      // anything.
      onOpenWindow: (details) =>
        !page.hidden && isSafeBrowserUrl(details.url)
          ? {
              action: "allow",
              overrideBrowserWindowOptions: {
                autoHideMenuBar: true,
                webPreferences: { ...BROWSER_WEB_PREFERENCES, partition: BROWSER_SESSION_PARTITION },
              },
            }
          : { action: "deny" },
      isTrustedBootstrapUrl: (url) => isChatgptWebBootstrapUrl(url),
    });
    // A renderer that has gone - crashed, or killed for memory - leaves the
    // WebContents alive and its DevTools target listed, which to ChatMock is
    // indistinguishable from a page that simply never replies. Let it go here
    // so the next request builds a fresh page instead of reattaching to a
    // corpse.
    contents.on("render-process-gone", (_event, details) => {
      this.log(`chatgpt-web ${lane} page renderer gone: ${details.reason} (exit ${details.exitCode})`);
      if (this.chatgptWeb.get(lane) === page) this.destroyChatgptWebPage(lane);
    });
    contents.on("unresponsive", () => {
      // Recoverable on its own; ChatMock asks for a replacement if it is not.
      this.log(`chatgpt-web ${lane} page is not responding`);
    });
    contents.on("destroyed", () => {
      if (this.chatgptWeb.get(lane) === page) this.chatgptWeb.delete(lane);
      if (!window.isDestroyed()) window.destroy();
    });
    // The X is the person saying "I am done signing in", not "destroy the page
    // ChatMock is attached to". It parks the window again.
    window.on("close", (event) => {
      if (this.chatgptWeb.get(lane) !== page || contents.isDestroyed()) return;
      event.preventDefault();
      this.hideChatgptWebPage(page);
    });
    return page;
  }

  /** Centre the page's window on the display the person is working on. */
  private centreChatgptWebWindow(window: BrowserWindow): void {
    const owner = [...this.hosts.values()].find((host) => !host.window.isDestroyed())?.window ?? null;
    const area = screen.getDisplayMatching(
      owner && !owner.isDestroyed() ? owner.getBounds() : screen.getPrimaryDisplay().bounds,
    ).workArea;
    const width = Math.min(CHATGPT_WEB_PAGE_SIZE.width, area.width - 80);
    const height = Math.min(CHATGPT_WEB_PAGE_SIZE.height, area.height - 80);
    window.setBounds({
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    });
  }

  /** On screen and running, but drawn at zero opacity and click-through. */
  private parkChatgptWebWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    this.centreChatgptWebWindow(window);
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setSkipTaskbar(true);
    // Above everything only so that nothing can occlude it; at zero opacity
    // there is nothing on top of anything as far as the person is concerned.
    window.setAlwaysOnTop(true, "floating");
    if (window.isMinimized()) window.restore();
    window.showInactive();
  }

  /** Bring the page in front of the person, which only signing in calls for. */
  private showChatgptWebPage(page: ChatgptWebPage): void {
    const window = page.window;
    if (window.isDestroyed()) return;
    page.hidden = false;
    window.setAlwaysOnTop(false);
    window.setIgnoreMouseEvents(false);
    window.setSkipTaskbar(false);
    this.centreChatgptWebWindow(window);
    window.setOpacity(1);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Back out of sight; the page carries on running. */
  private hideChatgptWebPage(page: ChatgptWebPage): void {
    if (page.window.isDestroyed()) return;
    page.hidden = true;
    this.parkChatgptWebWindow(page.window);
  }

  private destroyChatgptWebPage(lane: string): void {
    const page = this.chatgptWeb.get(lane);
    if (!page) return;
    this.chatgptWeb.delete(lane);
    if (!page.contents.isDestroyed()) page.contents.close();
    if (!page.window.isDestroyed()) page.window.destroy();
  }

  private destroyChatgptWebPages(): void {
    for (const lane of [...this.chatgptWeb.keys()]) this.destroyChatgptWebPage(lane);
  }

  private navigateBrowser(host: Host, tab: Tab, input: string): boolean {
    const url = browserUrlForInput(input);
    if (!url) return false;
    if (host.downloadsPopover?.ownerId === tab.id) host.downloadsPopover.close();
    if (host.extensionsPopover?.ownerId === tab.id) host.extensionsPopover.close();
    const browser = this.ensureBrowserPage(host, tab);
    if (!browser) return false;
    if (browser.showingHome) {
      if (host.findBar?.ownerId === tab.id) host.findBar.close();
      browser.showingHome = false;
      browser.ready = false;
      browser.pendingHomeNavigation = browser.homeEntryAvailable;
      browser.homeForwardTitle = undefined;
      browser.homeForwardFavicon = undefined;
    }
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
      // Replacing a pending URL rejects its loadURL promise. The successor
      // still owns the loading bar until Chromium reports that it has stopped.
      if (error?.errno === -3 || error?.code === "ERR_ABORTED") return;
      this.setTabLoading(tab, false);
      if (!browser.privatePartition) this.log(
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
    const releaseReady = () => {
      const waiting = browser.onReady;
      browser.onReady = [];
      for (const resume of waiting) resume();
    };
    let contextRevision = 0;
    contents.on("context-menu", (event, params) => {
      const owner = current();
      if (!owner || owner.window.isDestroyed() || owner.activeId !== tab.id || browser.showingHome || !browser.attached) return;
      event.preventDefault();
      const revision = ++contextRevision;
      browser.menu?.closePopup(owner.window);
      if (pasteOnRightClick(contents, event, params)) return;
      const menu = Menu.buildFromTemplate(browserContextMenuTemplate(params, {
        canGoBack: browser.homeEntryAvailable || this.browserNavigationTarget(tab, "back") !== null,
        canGoForward: this.browserNavigationTarget(tab, "forward") !== null,
      }, action => setImmediate(() => {
        // Menu actions belong to the document and tab that were right-clicked.
        if (revision !== contextRevision || contents.isDestroyed() || tab.contents.isDestroyed() || owner.window.isDestroyed()
          || owner.activeId !== tab.id || browser.showingHome || !owner.tabs.includes(tab)) return;
        contents.focus();
        void runBrowserContextAction(action, contents, params, {
          privateBrowsing: Boolean(browser.privatePartition || owner.privateBrowsing),
          openTab: (url, background) => {
            this.openBrowserTab(owner, url, background, undefined, undefined, undefined, browser.privatePartition ?? null);
          },
          openWindow: (url, privateBrowsing) => this.options.openWindow(url, privateBrowsing),
          navigate: type => this.run(owner, { type }),
          pageAction: pageAction => this.browserMenuAction(owner, tab, pageAction),
          ask: text => this.askAboutBrowserSelection(owner, tab, browser, text),
          bookmark: async value => {
            const bookmark = { ...value, title: value.title.trim().slice(0, 100) || value.url,
              ...(value.url === tab.url && browser.favicon ? { iconUrl: browser.favicon } : {}) };
            const saved = await tab.contents.executeJavaScript(`new Promise(resolve => {
              const timeout = setTimeout(() => resolve(false), 5000);
              window.dispatchEvent(new CustomEvent('breadboard:bookmark-browser-page', { detail: {
                bookmark: ${JSON.stringify(bookmark)}, complete: result => { clearTimeout(timeout); resolve(result === true); }
              } }));
            })`, true);
            if (!saved) throw new Error("Bookmark could not be saved");
            this.publishNotificationToast(tab.contents, { type: "success", message: "Bookmark saved." });
          },
        }).catch(error => {
          this.log(`browser context action ${action} failed: ${String(error)}`);
          if (!tab.contents.isDestroyed()) this.publishNotificationToast(tab.contents, {
            type: "error", message: action.startsWith("bookmark-") ? "Couldn’t save this bookmark. Check the bookmarks bar and try again." : "Couldn’t complete this browser action. Try again.",
          });
        });
      })));
      browser.menu = menu;
      // Let Electron anchor to the native pointer; page coordinates are relative
      // to the web view and would otherwise miss the toolbar/fullscreen offset.
      menu.popup({ window: owner.window, callback: () => { if (browser.menu === menu) browser.menu = undefined; } });
    });
    contents.on("did-start-navigation", (_event, _url, inPlace) => {
      if (inPlace) return;
      contextRevision++;
      const owner = current();
      if (owner && !owner.window.isDestroyed()) browser.menu?.closePopup(owner.window);
    });
    contents.on("found-in-page", (_event, result) => {
      if (!browser.findQuery || result.requestId !== browser.findRequestId) return;
      browser.find = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal };
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.once("destroyed", () => {
      releaseReady();
      const owner = current();
      if (owner?.browserFullscreen?.contents === contents) this.exitBrowserFullscreen(owner, false);
      this.browserNotifications.clearForPage(contents);
      this.hostByContents.delete(contents.id);
      if (browser.contents !== contents) return;
      if (browser.attached && browser.view && owner && !owner.window.isDestroyed()) {
        try {
          forgetViewBounds(browser.view);
          owner.window.contentView.removeChildView(browser.view);
        } catch {
          // The native view was already removed with its renderer/window.
        }
      }
      browser.contents = null;
      browser.view = null;
      browser.ready = false;
      browser.attached = false;
      if (owner && !owner.window.isDestroyed()) {
        const index = tabIndex(owner, tab.id);
        if (index < 0) return; // Explicit close/replacement already removed it.
        if (browser.scriptOpened) {
          // Login popups close themselves after messaging their opener.
          this.dropTab(owner, index);
          return;
        }
        // Losing an ordinary page is not an instruction to close its tab (or
        // the whole app when it is the last tab). Keep the URL and trusted
        // chrome; Reload creates a fresh native page without a self-close loop.
        this.log(`browser page ${contents.id} disappeared; retaining tab ${tab.id} for reload`);
        browser.showingHome = true;
        browser.homeHistoryIndex = null;
        browser.pendingHomeNavigation = false;
        browser.homeForwardTitle = undefined;
        browser.homeForwardFavicon = undefined;
        browser.find = undefined;
        browser.findRequestId = undefined;
        browser.translation = undefined;
        this.setTabLoading(tab, false);
        this.syncBrowser(owner);
        this.broadcast(owner);
        this.publishNotificationToast(tab.contents, {
          type: "error", message: "This page closed unexpectedly. Press Reload to reopen it.",
        });
      }
    });

    hardenExternalBrowserWebContents(contents, {
      configurePermissions: (target: Session) => {
        if (!browser.privatePartition) return this.browserNotifications.installSession(target);
        // Keep ordinary page controls working without persisting site grants.
        const allowed = (permission: string) => permission === "fullscreen" || permission === "clipboard-sanitized-write";
        target.setPermissionCheckHandler((_contents, permission) => allowed(permission));
        target.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
      },
      onOpenWindow: (details) => {
        const owner = current();
        if (!owner || !this.enabled || !this.browserUrl || owner.window.isDestroyed()) {
          return { action: "deny" };
        }
        if (!browser.automationRunId && !browser.privatePartition) this.browserVisitedLinks.remember(contents.getURL(), details.url);
        return {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences: { ...BROWSER_WEB_PREFERENCES, partition: browser.privatePartition ?? BROWSER_SESSION_PARTITION } },
          createWindow: (options) => {
            const popup = this.openBrowserTab(
              owner, undefined, details.disposition === "background-tab",
              undefined, undefined, { details, options }, browser.privatePartition ?? null,
            );
            const page = liveBrowserPage(popup?.browser);
            if (!page) throw new Error("The browser popup could not be attached to a tab.");
            return page.contents;
          },
        };
      },
      isTrustedBootstrapUrl: (url) =>
        Boolean(
          (browser.automationRunId &&
            isBrowserAgentBootstrapUrl(url, browser.automationRunId)),
        ),
    });
    if (browser.privatePartition) {
      // The sandboxed preload asks synchronously on every document. Private
      // pages need a reply too, without consulting or changing saved grants.
      contents.ipc.on("breadboard:web-notification:permission", event => { event.returnValue = "denied"; });
      contents.ipc.handle("breadboard:web-notification:request", async () => "denied");
    } else this.browserNotifications.attach(contents);
    contents.on("enter-html-full-screen", () => {
      const owner = current();
      if (!owner || owner.window.isDestroyed()) return;
      if (owner.activeId !== tab.id || !browser.attached) {
        this.exitPageFullscreen(contents);
        return;
      }
      if (owner.browserFullscreen?.contents === contents) return;
      owner.browserFullscreen = { contents, wasWindowFullscreen: owner.window.isFullScreen() };
      browser.addressSuggestionsOpen = false;
      owner.downloadsPopover?.close();
      owner.extensionsPopover?.close();
      owner.window.setFullScreen(true);
      this.layout(owner);
      contents.focus();
    });
    contents.on("leave-html-full-screen", () => {
      const owner = current();
      if (owner?.browserFullscreen?.contents === contents) this.exitBrowserFullscreen(owner, false);
    });
    contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      const owner = current();
      if (isMainFrame && !inPlace && owner?.browserFullscreen?.contents === contents) {
        this.exitBrowserFullscreen(owner);
      }
    });
    if (!browser.automationRunId && !browser.privatePartition) this.browserVisitedLinks.attach(contents);
    if (!browser.automationRunId && !browser.privatePartition) this.browserHistory.attach(contents);
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
      if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        remember(url);
        if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser);
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
      if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser);
      const owner = current();
      if (!owner) return;
      // The address is published before the response arrives. Keep home
      // opaque until the native page can cover it, and finish the same loading
      // cycle that drives the top bar. An aborted first request has no page.
      if (!browser.showingHome && isSafeBrowserUrl(contents.getURL())) {
        browser.ready = true;
      }
      releaseReady();
      this.syncBrowser(owner);
      this.broadcast(owner);
    });
    contents.on("dom-ready", () => {
      if (browser.findQuery) {
        browser.find = undefined;
        browser.findRequestId = contents.findInPage(browser.findQuery, { findNext: true });
      }
      const owner = current();
      if (!owner) return;
      if (!browser.automationRunId) {
        void contents
          // Passive page setup must not grant transient/sticky user activation.
          // Sites use it for popups, autoplay and same-document history behavior.
          .executeJavaScript(browserSelectionBootstrapScript())
          .catch(() => undefined);
        this.refreshBrowserStoreInstallButton(browser);
      }
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
      this.askAboutBrowserSelection(owner, tab, browser, text);
    });
    contents.on("did-fail-load", (_event, errorCode, _description, failedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      remember(failedUrl);
      this.setTabLoading(tab, false);
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    installRendererRecovery(contents, () => {
      const owner = current();
      if (owner?.browserFullscreen?.contents === contents) this.exitBrowserFullscreen(owner, false);
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

  private askAboutBrowserSelection(host: Host, tab: Tab, browser: BrowserPage, text: string): void {
    if (!text.trim()) return;
    browser.selection = { text: text.slice(0, 8_000), title: tab.title || browserFallbackTitle(tab.url), url: tab.url };
    browser.terminalOpen = true;
    browser.addressSuggestionsOpen = false;
    this.layout(host);
    this.broadcast(host);
    tab.contents.focus();
  }

  private reopenClosedTab(host: Host): boolean {
    if (host.privateBrowsing || tabById(host, host.activeId)?.browser?.privatePartition) return false;
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
    if (tab.url && !tab.browser?.privatePartition && !host.privateBrowsing) {
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
    if (host.findBar?.ownerId === tab.id) host.findBar.close();
    tab.browser?.menu?.closePopup(host.window);
    this.detach(host.window, tab);
    if (tab.browser?.contents) this.browserNotifications.clearForPage(tab.browser.contents);
    this.hostByContents.delete(tab.contents.id);
    if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
    this.destroyView(tab);
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    const host = this.hostByContents.get(tab.contents.id);
    if (host?.downloadsPopover?.ownerId === tab.id) host.downloadsPopover.close();
    if (host?.extensionsPopover?.ownerId === tab.id) host.extensionsPopover.close();
    if (host?.groupPopover?.ownerId === tab.id) host.groupPopover.close();
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
      void host.base.contents.loadURL("about:blank").catch(() => undefined);
    });
  }

  private clearRetiredBaseDragRegion(host: Host): void {
    const contents = host.base.contents;
    if (!host.baseRetired || contents.isDestroyed() || contents.getURL() !== "about:blank") return;
    // Electron 33 can retain the previous document's caption hit regions under
    // live tabs. Reapply this for every blank document, including a reload.
    void contents.executeJavaScript(`
      document.documentElement.style.setProperty('-webkit-app-region', 'no-drag');
      document.documentElement.style.minHeight = '100vh';
    `).catch(() => undefined);
  }

  /** Every view becomes a window of its own; the switch was turned off. */
  private popOutViews(host: Host): void {
    if (host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    const views = host.tabs.filter((tab) => tab.view);
    if (views.length === 0) return;
    for (const tab of views) {
      if (tab.browser) {
        if (tab.url && !tab.browser.privatePartition) this.options.openExternal?.(tab.url);
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
      if (tab.browser?.contents) this.browserNotifications.clearForPage(tab.browser.contents);
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
    const group = host.groups.find(group => group.id === tab.groupId);
    if (group) group.collapsed = false;
    if (host.activeId !== id) {
      this.exitBrowserFullscreen(host);
      host.downloadsPopover?.close();
      host.extensionsPopover?.close();
      host.groupPopover?.close();
      host.findBar?.close();
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
   * A cold view that is attached has no frame to show at first — Chromium paints
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
    this.layoutNotificationOverlay(host);
    host.findBar?.layout();
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
    if (active.loaded && active.painted) {
      // Reattach a warm surface at its final bounds. Parking it offscreen and
      // immediately moving it back invalidates the compositor's visible area
      // just as the outgoing page is removed, exposing the background between
      // tabs. Its existing frame needs neither a move nor a renderer probe.
      this.layout(host);
      host.window.contentView.addChildView(view);
      active.attached = true;
      view.setVisible(true);
      this.commitReveal(host, active);
      return;
    }
    host.pending = active;
    // Only a cold document needs an offscreen paint. Page navigation also
    // starts the blue progress bar while the outgoing page remains visible.
    host.pendingNavigation = !showLoader;
    const token = ++host.revealToken;
    const [width, height] = host.window.getContentSize();
    if (typeof width === "number" && typeof height === "number") {
      // Bounds first, then attach, so no frame of it lands in the window.
      setViewBounds(view, offscreenBounds(width, height));
    }
    host.window.contentView.addChildView(view);
    active.attached = true;
    view.setVisible(true);
    this.layout(host);
    if (showLoader && (active.loading || !active.loaded)) this.showLoadingScene(host, active);
    this.raiseNotificationOverlay(host);
    host.findBar?.layout();
    void this.reveal(host, active, token, !showLoader);
  }

  private async reveal(host: Host, tab: Tab, token: number, retainUntilLoaded = false): Promise<void> {
    // Route generation can outlast the compositor timeout. This also applies
    // when selecting a restored tab that is still waiting for its document.
    // Keep the outgoing page until DOM-ready before starting the paint clock.
    if (!tab.loaded) {
      await new Promise<void>((resolve) => tab.onLoaded.push(resolve));
    }
    const browser = liveBrowserPage(tab.browser);
    if (retainUntilLoaded && browser && !browser.ready && tab.loading && !browser.showingHome && isSafeBrowserUrl(tab.url)) {
      await new Promise<void>((resolve) => browser.onReady.push(resolve));
    }
    if (host.window.isDestroyed() || host.pending !== tab || host.revealToken !== token || tab.contents.isDestroyed()) return;
    const current = () => !host.window.isDestroyed() && host.pending === tab && host.revealToken === token &&
      !tab.contents.isDestroyed();
    // One ceiling spans everything after DOM-ready. Each probe is bounded on
    // its own, but the tab must come forward within this window regardless of
    // what the page does with its document: an outgoing page held in front
    // indefinitely is a window that no longer switches tabs.
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      (async () => {
        // DOM-ready and two compositor frames can still expose an empty caption
        // strip while React or its initial IPC read is pending. Keep the outgoing
        // controls until this cold page has its own tabs; warm switches stay instant.
        if (!tab.painted && this.enabled) {
          await waitForTabChrome(tab.contents, () => this.enabled && current());
        }
        if (!current()) return;
        await this.frameReady(tab);
      })(),
      new Promise<void>((resolve) => {
        ceiling = setTimeout(resolve, REVEAL_MAX_WAIT_MS);
        ceiling.unref?.();
      }),
    ]);
    if (ceiling) clearTimeout(ceiling);
    if (host.window.isDestroyed() || host.pending !== tab || host.revealToken !== token) return;
    if (tab.contents.isDestroyed()) return;
    this.commitReveal(host, tab);
  }

  private commitReveal(host: Host, tab: Tab): void {
    host.pending = null;
    host.pendingNavigation = false;
    tab.painted = true;
    this.layout(host);
    // A browser's trusted shell is transparent below its toolbar. Attach its
    // page before removing the outgoing shell so that hole stays covered.
    this.syncBrowser(host);
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
    host.window.setTitle(`${active?.browser?.privatePartition || host.privateBrowsing ? "Private — " : ""}${active?.title || "Breadboard"}`);
  }

  private detach(window: BrowserWindow, tab: Tab): void {
    this.detachBrowser(window, tab);
    if (!tab.view || !tab.attached) return;
    tab.attached = false;
    if (window.isDestroyed()) return;
    try {
      forgetViewBounds(tab.view);
      window.contentView.removeChildView(tab.view);
    } catch {
      // Already gone with the window.
    }
  }

  // ---------------------------------------------------------- loading scene

  private updateLoadingSceneTheme(scene: TabLoadingScene, theme: BreadboardWindowTheme): void {
    if (scene.contents.isDestroyed() || scene.theme === theme) return;
    scene.theme = theme;
    scene.view.setBackgroundColor(backgroundColorForTheme(theme));
    // A theme change must never navigate or replace a live renderer. If its
    // first document is still loading, dom-ready below applies the latest pick.
    if (!scene.contents.isLoadingMainFrame()) this.paintLoadingSceneTheme(scene);
  }

  private paintLoadingSceneTheme(scene: TabLoadingScene): void {
    if (scene.contents.isDestroyed()) return;
    void scene.contents.executeJavaScript(
      `document.documentElement.dataset.theme = ${JSON.stringify(scene.theme)}`,
    ).catch(() => undefined);
  }

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
    scene.contents.on("dom-ready", () => this.paintLoadingSceneTheme(scene));
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
    this.updateLoadingSceneTheme(scene, theme);
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
      forgetViewBounds(scene.view);
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
    setViewBounds(scene.view, {
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
    if (host.preparedNewTab?.view) setViewBounds(host.preparedNewTab.view, offscreen);
    for (const tab of host.tabs) {
      if (tab.view) {
        setViewBounds(
          tab.view,
          tab === host.pending ? offscreen : { x: 0, y: 0, width, height },
        );
      }
      const browser = liveBrowserPage(tab.browser);
      if (browser?.attached) {
        const fullscreen = host.browserFullscreen?.contents === browser.contents;
        const x = fullscreen ? 0 : browserContentLeft(
          width,
          browser.terminalOpen,
          browser.terminalWidth,
        );
        const y = fullscreen ? 0 : browserContentTop(height);
        setViewBounds(browser.view, {
          x,
          y,
          width: Math.max(1, width - x),
          height: Math.max(1, height - y),
        });
      }
    }
    const active = tabById(host, host.activeId);
    this.stackBrowserChrome(host);
    if (host.loadingScene?.attached && active) this.layoutLoadingScene(host, active);
    this.layoutNotificationOverlay(host);
    host.findBar?.layout();
  }

  // ---------------------------------------------------------- browser page

  private exitPageFullscreen(contents: WebContents): void {
    if (contents.isDestroyed()) return;
    void contents.executeJavaScript("if (document.fullscreenElement) document.exitFullscreen();").catch(() => undefined);
  }

  private exitBrowserFullscreen(host: Host, exitPage = true, restoreWindow = true): void {
    const fullscreen = host.browserFullscreen;
    if (!fullscreen) return;
    host.browserFullscreen = undefined;
    if (exitPage) this.exitPageFullscreen(fullscreen.contents);
    if (host.window.isDestroyed()) return;
    if (restoreWindow) host.window.setFullScreen(fullscreen.wasWindowFullscreen);
    this.layout(host);
  }

  private toggleWindowFullscreen(host: Host): void {
    if (host.window.isDestroyed()) return;
    const fullscreen = host.window.isFullScreen();
    this.exitBrowserFullscreen(host, true, false);
    host.window.setFullScreen(!fullscreen);
  }

  /** Put the active browser page immediately below its trusted toolbar. */
  private syncBrowser(host: Host): void {
    if (host.window.isDestroyed() || host.pending) return;
    const active = tabById(host, host.activeId);
    const browser = liveBrowserPage(active?.browser);
    if (active?.attached && !active.voiceOverlay && browser && active.url && browser.ready) {
      const [width, height] = host.window.getContentSize();
      if (typeof width === "number" && typeof height === "number") {
        const fullscreen = host.browserFullscreen?.contents === browser.contents;
        const x = fullscreen ? 0 : browserContentLeft(width, browser.terminalOpen, browser.terminalWidth);
        const y = fullscreen ? 0 : browserContentTop(height);
        setViewBounds(browser.view, {
          x,
          y,
          width: Math.max(1, width - x),
          height: Math.max(1, height - y),
        });
        if (!browser.attached) {
          host.window.contentView.addChildView(browser.view);
          browser.attached = true;
          browser.view.setVisible(true);
        }
      }
    }
    // Both browser shells can be transparent here. Put the incoming native
    // page in place before removing the outgoing one to keep the base covered.
    for (const tab of host.tabs) {
      if (tab !== active) this.detachBrowser(host.window, tab);
    }
    if (active?.voiceOverlay) { this.detachBrowser(host.window, active); return; }
    this.stackBrowserChrome(host);
  }

  /** Recents overlay the page; opening them never changes its viewport. */
  private stackBrowserChrome(host: Host): void {
    if (host.window.isDestroyed() || host.pending) return;
    const tab = tabById(host, host.activeId);
    const browser = liveBrowserPage(tab?.browser);
    if (!tab?.view || !tab.attached || !browser?.attached) return;
    const chromeOnTop = browser.addressSuggestionsOpen && !host.browserFullscreen;
    const views: View[] = [chromeOnTop ? tab.view : browser.view];
    for (const popup of [host.downloadsPopover, host.extensionsPopover, host.groupPopover]) {
      if (popup && !popup.isClosed) views.push(popup.view);
    }
    if (host.notificationOverlay && !host.notificationOverlay.contents.isDestroyed()) {
      views.push(host.notificationOverlay.view);
    }
    if (host.findBar) views.push(host.findBar.view);
    this.raiseViews(host, views);
    host.findBar?.layout();
  }

  /** Reordering native views can reset Windows keyboard focus, even when the
   * same view is re-added. Leave a correct stack alone and preserve focus when
   * autocomplete actually needs to move the trusted toolbar over the page. */
  private raiseViews(host: Host, views: View[]): void {
    const container = host.window.contentView;
    const current = container.children;
    const ordered = [...current.filter(view => !views.includes(view)), ...views];
    if (ordered.every((view, index) => current[index] === view)) return;
    const focused = webContents.getFocusedWebContents();
    for (const [index, view] of ordered.entries()) {
      if (container.children[index] !== view) container.addChildView(view, index);
    }
    if (host.window.isFocused() && focused && !focused.isDestroyed()) focused.focus();
  }

  private detachBrowser(window: BrowserWindow, tab: Tab): void {
    const browser = liveBrowserPage(tab.browser);
    const host = this.hosts.get(window.id);
    if (browser && host?.browserFullscreen?.contents === browser.contents) this.exitBrowserFullscreen(host);
    if (!browser?.attached) return;
    browser.attached = false;
    if (window.isDestroyed()) return;
    try {
      forgetViewBounds(browser.view);
      window.contentView.removeChildView(browser.view);
    } catch {
      // Already gone with the window.
    }
  }

  private navigationContents(tab: Tab): WebContents {
    return liveBrowserPage(tab.browser)?.contents ?? tab.contents;
  }

  private reloadTab(host: Host, tab: Tab): void {
    if (tab.browser && !liveBrowserPage(tab.browser) && isSafeBrowserUrl(tab.url)) {
      this.navigateBrowser(host, tab, tab.url);
      return;
    }
    const contents = this.navigationContents(tab);
    if (!contents.isDestroyed()) contents.reload();
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
    if (host.findBar?.ownerId === tab.id) host.findBar.close();
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
    tab.title = browser.privatePartition ? "Private Tab" : "Browser";
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
    const rendererView = new WebContentsView({
      webPreferences: {
        ...rendererWebPreferences(this.options.preloadPath),
        // This trusted overlay receives notifications before it is clicked.
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    // Alpha is AARRGGBB in Electron. The renderer paints only its cards; the
    // rest of the view must never become a sheet over the active tab.
    rendererView.setBackgroundColor("#00000000");
    const view = new View();
    view.setBackgroundColor("#00000000");
    view.addChildView(rendererView);
    const overlay: NotificationOverlay = {
      view,
      rendererView,
      contents: rendererView.webContents,
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
        forgetViewBounds(overlay.view);
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
    this.raiseViews(host, [overlay.view, ...(host.findBar ? [host.findBar.view] : [])]);
  }

  private layoutNotificationOverlay(host: Host, reportVisibility = false): void {
    const overlay = host.notificationOverlay;
    if (!overlay || host.window.isDestroyed() || overlay.contents.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    const paintPomodoroActive = active?.url && !active.browser &&
      isTabPageUrl(this.options.allowed, active.url) &&
      /^\/pomodoro\/?$/.test(new URL(active.url).pathname);
    // Spoken notifications must remain readable while the voice panel is open.
    // Paint Pomodoro keeps the shared cards hidden until another tab is selected.
    const visible = this.notificationsVisible && !paintPomodoroActive;
    overlay.view.setVisible(visible);
    // Focus is deliberately not required. A response usually finishes while
    // the person is in another app or in the voice companion, which is exactly
    // when the chime is needed; a shown, unminimized window still shows the
    // card. Cross-window duplicates are settled by the renderer's receipts.
    const audible = visible && overlay.width > 0 && overlay.height > 0 &&
      host.window.isVisible() && !host.window.isMinimized();
    // Hiding a native View does not stop Web Audio in its renderer. Mute
    // synchronously as well as telling the cards whether they may announce.
    overlay.contents.setAudioMuted(!audible);
    if (overlay.audible !== audible || reportVisibility) {
      overlay.audible = audible;
      overlay.contents.send(IPC_CHANNELS.notificationOverlayVisibility, audible);
    }
    const [windowWidth, windowHeight] = host.window.getContentSize();
    if (typeof windowWidth !== "number" || typeof windowHeight !== "number") return;
    const renderWidth = Math.max(1, Math.min(NOTIFICATION_OVERLAY_MAX_WIDTH, windowWidth));
    if (overlay.width <= 0 || overlay.height <= 0) {
      // Keep one transparent pixel inside the compositor so this renderer's
      // timers and polling stay live while it has no card to show.
      setViewBounds(overlay.view, {
        x: Math.max(0, windowWidth - 1),
        y: 1 - windowHeight,
        width: renderWidth,
        height: windowHeight,
      });
      setViewBounds(overlay.rendererView, { x: 0, y: 0, width: renderWidth, height: windowHeight });
      return;
    }
    const width = Math.max(1, Math.min(Math.ceil(overlay.width), renderWidth));
    const height = Math.max(1, Math.min(Math.ceil(overlay.height), windowHeight));
    // Size the clickable parent to the cards, but lay out CSS against all of
    // the available space. Shrinking the renderer itself makes vw/vh limits
    // trap later response cards inside the size of the previous small toast.
    setViewBounds(overlay.rendererView, {
      x: width - renderWidth,
      y: height - windowHeight,
      width: renderWidth,
      height: windowHeight,
    });
    setViewBounds(overlay.view, {
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
    contents.on("context-menu", (event, params) => {
      const owner = current();
      if (!owner || owner.window.isDestroyed() || owner.activeId !== tab.id) return;
      pasteOnRightClick(contents, event, params);
    });
    contents.on("found-in-page", (_event, result) => {
      if (!tab.findQuery || result.requestId !== tab.findRequestId) return;
      tab.find = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal };
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      if (inPlace || !isMainFrame) return;
      tab.find = undefined;
      tab.findRequestId = undefined;
    });
    const markDocumentReady = () => {
      if (tab.loaded) return;
      tab.loaded = true;
      const waiting = tab.onLoaded;
      tab.onLoaded = [];
      for (const resume of waiting) resume();
      const owner = current();
      if (owner && !contents.isDestroyed()) {
        if (owner.tabs.includes(tab)) owner.newTabPreparationFailed = false;
        this.broadcast(owner);
      }
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
      if (owner) {
        this.layoutNotificationOverlay(owner);
        this.broadcast(owner);
      }
    };
    const guardNavigation = (event: ElectronEvent, url: string) => {
      // External links are opened in a separate browser tab by the security
      // handler. Recovery documents also need to remain reachable.
      if (!isTabPageUrl(this.options.allowed, url) || event.defaultPrevented) return;
      if (!this.allowTabNavigation(tab, url)) event.preventDefault();
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    contents.on("did-navigate", (_event, url) => remember(url));
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) remember(url);
    });
    contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && tab.recoveryAttempt) {
        if (tab.recoveryAttempt.expectedUrl === _url) {
          tab.recoveryAttempt.expectedUrl = undefined;
        } else {
          // Back/Forward, links, or a new load supersede the failed page even
          // while its reachability check is waiting for a server response.
          tab.recoveryAttempt = undefined;
          tab.recovering = false;
          tab.recoveryUrl = undefined;
        }
      }
      if (!isMainFrame || isInPlace) return;
      tab.notificationUrls = [_url];
      tab.voiceOverlay = false;
      tab.learnActivity = undefined;
      const owner = current();
      if (owner) { this.syncBrowser(owner); this.layoutNotificationOverlay(owner); }
      if (owner && owner.preparedNewTab !== tab && isTabPageUrl(this.options.allowed, _url) &&
          new URL(_url).pathname.startsWith("/auth/")) this.discardPreparedNewTab(owner);
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
    contents.on("dom-ready", () => {
      if (tab === host.base) this.clearRetiredBaseDragRegion(host);
      if (tab.findQuery) tab.findRequestId = contents.findInPage(tab.findQuery, { findNext: true });
      markDocumentReady();
    });
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
      // Windows may focus the parked base when a native view loses focus.
      // It is no longer a tab/IPC sender, but must still route window shortcuts.
      const owner = current() ?? (tab === host.base && host.baseRetired ? host : undefined);
      if (owner) this.handleInput(owner, event, input);
    });

    if (tab.view) {
      // The window's own page is looked after by window recovery; a view has
      // to look after itself.
      contents.on("did-fail-load", (_event, errorCode, _description, failedUrl, isMainFrame) => {
        // -3 is an intentional aborted navigation, normally a redirect.
        if (!isMainFrame || errorCode === -3) return;
        const owner = current();
        if (owner?.preparedNewTab === tab) {
          owner.newTabPreparationFailed = true;
          this.discardPreparedNewTab(owner);
          return;
        }
        remember(failedUrl);
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url);
      });
      installRendererRecovery(contents, () => {
        const owner = current();
        if (!owner) return;
        if (owner.preparedNewTab === tab) {
          owner.newTabPreparationFailed = true;
          this.discardPreparedNewTab(owner);
          return;
        }
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url);
      });
    }
  }

  private handleInput(host: Host, event: ElectronEvent, input: Input): void {
    const active = tabById(host, host.activeId);
    if (active && host.findBar && input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      this.requestFind(host, active, true);
      return;
    }
    if (host.browserFullscreen && input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      this.exitBrowserFullscreen(host);
      return;
    }
    const browserAction = browserMenuShortcut(input);
    const browserTab = tabById(host, host.activeId);
    if (browserAction === "find" && browserTab) {
      event.preventDefault();
      this.requestFind(host, browserTab);
      return;
    }
    if (browserAction && browserTab?.browser) {
      event.preventDefault();
      void this.browserMenuAction(host, browserTab, browserAction);
      return;
    }
    if (isFullScreenShortcut(input)) {
      event.preventDefault();
      this.toggleWindowFullscreen(host);
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
      case "new-dashboard":
        if (this.newTabUrl) {
          this.openTab(host, new URL("/dashboard", this.newTabUrl).toString(), {
            background: false,
            origin: "blank",
          });
        }
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
        moveGroupedTab(host, host.activeId, activeIndex + shortcut.delta);
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
            if (!active.browser && !this.allowTabNavigation(active, contents.navigationHistory.getEntryAtIndex(target)?.url ?? "")) return;
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
            if (!active.browser && !this.allowTabNavigation(active, contents.navigationHistory.getEntryAtIndex(target)?.url ?? "")) return;
            if (contents.isLoading()) contents.stop();
            contents.navigationHistory.goToIndex(target);
          }
        }
        return;
      case "reload":
        if (active) this.reloadTab(host, active);
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
  private recover(tab: Tab, recoveryUrl = tab.url): Promise<void> {
    // Startup waits on this promise so restored tabs finish reconnecting
    // behind the loading screen rather than in front of the person.
    if (tab.recovering) return tab.recoveryPromise ?? Promise.resolve();
    const attempt = this.runRecovery(tab, recoveryUrl);
    tab.recoveryPromise = attempt;
    void attempt.finally(() => {
      if (tab.recoveryPromise === attempt) tab.recoveryPromise = undefined;
    });
    return attempt;
  }

  private async runRecovery(tab: Tab, recoveryUrl: string | undefined): Promise<void> {
    if (tab.recovering || !recoveryUrl || tab.contents.isDestroyed()) return;
    tab.recovering = true;
    tab.recoveryUrl = recoveryUrl;
    const sceneUrl = pathToFileURL(this.options.recoveryHtmlPath());
    sceneUrl.searchParams.set("theme", this.options.theme());
    const attempt: NonNullable<Tab["recoveryAttempt"]> = { expectedUrl: sceneUrl.toString() };
    tab.recoveryAttempt = attempt;
    const current = () => tab.recoveryAttempt === attempt && !tab.contents.isDestroyed() &&
      this.hostByContents.has(tab.contents.id);
    this.log(`page lost in a tab; showing the reconnect scene and waiting for ${recoveryUrl}`);
    try {
      try {
        await tab.contents.loadFile(this.options.recoveryHtmlPath(), {
          query: { theme: this.options.theme() },
        });
      } catch {
        // The scene is a courtesy; the wait below is what brings the page back.
      }
      let retry = 0;
      while (current()) {
        const delay =
          TAB_RECOVERY_DELAYS_MS[Math.min(retry, TAB_RECOVERY_DELAYS_MS.length - 1)] ?? 5_000;
        retry += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (!current()) break;
        const url: string | undefined = tab.recoveryUrl;
        if (!url) break;
        if (await this.reachable(url)) {
          if (!current()) break;
          if (url !== tab.recoveryUrl) continue;
          attempt.expectedUrl = url;
          if (await loadRecoveryUrlIfAlive(tab.contents, url)) return;
        }
      }
    } finally {
      if (tab.recoveryAttempt === attempt) {
        tab.recoveryAttempt = undefined;
        tab.recovering = false;
        tab.recoveryUrl = undefined;
      }
    }
  }

  private async reachable(url: string): Promise<boolean> {
    try {
      const response = await net.fetch(url, { method: "GET", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5_000) });
      void response.body?.cancel().catch(() => undefined);
      return response.status < 500;
    } catch {
      return false;
    }
  }
}
