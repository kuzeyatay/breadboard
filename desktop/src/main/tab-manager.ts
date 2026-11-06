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
import { installWindowSurfaceRecovery } from "./window-surface-recovery";
import { annotationPageUrl, browserOrganizationWidth, normalizeAnnotationTarget, type BrowserAnnotationTarget } from "../shared/browser-annotations";
import { browserAnnotationCaptureScript, browserAnnotationPaintScript } from "./browser-annotations-dom";
import { BrowserPreferenceStore } from "./browser-preferences";
import { BrowserAdBlocker } from "./browser-adblocker";
import { BrowserNotifications } from "./browser-notifications";
import { BrowserNotificationPages } from "./browser-notification-pages";
import { browserUserAgent } from "./browser-user-agent";
import { toggleBrowserPictureInPicture } from "./browser-picture-in-picture";
import { GooglePipExtension, GOOGLE_PIP_EXTENSION_ID } from "./google-pip-extension";
import { BrowserTranslation, type TranslatePageBatch } from "./browser-translation";
import { TRANSLATION_LANGUAGES, translationSite, notificationOrigin } from "../shared/browser-preferences";
import { BrowserWebPush } from "./browser-web-push";
import { readTabSession, readAccountTabSession, rebaseDashboardUrl, restoredTabUrl, saveTab, writeTabSession, writeAccountTabSession, type SavedTabWindow, type SavedTabGroup } from "./tab-session";
import { authReturnPath, isAuthenticationUrl } from "../shared/auth-navigation";
import { flushBrowserSession } from "./browser-session-persistence";
import { browserSignedInSites } from "./browser-sign-in-sites";
import { AI_TAB_GROUP_ID, ensureAiTabGroup, TAB_GROUP_COLORS, isInTabGroup, isTabGroupHidden, tabGroupPath, type TabGroup } from "../shared/tab-groups";
import { groupTabs, moveGroupedTab, moveTabGroup, normalizeTabGroups, positionAiTabGroup } from "./tab-groups";
import { splitTabs, splitMembers, splitPaneBounds } from "./tab-split";
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
import { allowBackgroundFrames, waitForFirstPaint, waitForRevealFrame, waitForDocumentFrame } from "./first-paint";
import { WindowShell } from "./window-shell";
import { waitForTabChrome } from "./tab-chrome";
import { TAB_SURFACE_BUDGET_BYTES, TabSurfaceCache, idleUnloadDelayMs, surfaceReservation, warmBackgroundTabs, type TabMemoryPressure } from "./tab-surface-cache";
import {
  STARTUP_PAGE_LOAD_MAX_WAIT_MS,
  waitForStartupPageLoad,
  waitForStartupPageReady,
} from "./startup-page-load";
import { installRendererRecovery } from "./renderer-recovery";
import { BoundedWorkQueue } from "./bounded-work-queue";
import {
  IPC_CHANNELS,
  isTabsCommand,
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
  CHATGPT_WEB_ORIGIN,
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
import { BrowserTextHighlights } from "./browser-text-highlights";
import { BrowserInlineAnswer } from "./browser-inline-answer";
import { browserTextHighlightsBootstrapScript } from "./browser-text-highlights-dom";
import { parseWebSelectionAction, type BrowserSelection, type WebTextHighlight } from "../shared/web-text-selection";
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
  /** Rebind window recovery when its initial content view moves to another window. */
  onBaseReplaced?: (window: BrowserWindow) => void;
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
  /** Load every restored tab during startup, as before 2026-10-27. Off by
   * default: restored tabs keep their place and title and load when selected,
   * so startup costs the visible tab rather than the whole saved workspace. */
  restoreAllTabsAtStartup?: boolean;
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
  find?: { matches: number; activeMatchOrdinal: number; query: string; requestId: number; finalUpdate: boolean };
  findQuery?: string;
  findRequestId?: number;
}

interface BrowserPage extends PageFindState {
  uiKey?: string;
  uiVisited?: boolean;
  paintController?: AbortController;
  paintRetry?: ReturnType<typeof setTimeout>;
  documentCommitted?: boolean;
  suggestionsBottom?: number;
  /** Session restoration loads the page without authorizing media playback. */
  restoredMediaBlocked?: boolean;
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
  organizationOpen?: boolean;
  annotationTarget?: BrowserAnnotationTarget;
  annotationMarkers?: Array<{ id: string; target: BrowserAnnotationTarget }>;
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
  selection?: BrowserSelection;
  highlights?: BrowserTextHighlights;
  /** Present while this temporary page belongs to an AI task. */
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
/**
 * How long startup holds its loading screen for a tab that keeps loading.
 *
 * A restored page can report `isLoading()` forever - an SSO redirect that
 * never settles, a long-poll that never ends - and the slow-load wait had no
 * overall deadline, so one such tab held the whole app in its loading scene
 * indefinitely (2026-09-22: two canvas.tue.nl tabs blocked startup for over
 * eight minutes, with the app otherwise healthy). Past this the tab keeps
 * loading in the background and simply stops gating startup.
 */
export const STARTUP_TAB_LOAD_MAX_WAIT_MS = 20_000;
/** Ctrl+Shift+T reaches back this many closed tabs. */
export const MAX_REOPENABLE_TABS = 10;
/**
 * Show navigation progress if a loaded destination takes this long to paint.
 * The deadline never authorizes replacing the outgoing page with a blank one.
 */
export const REVEAL_MAX_WAIT_MS = 10_000;

interface Tab extends PageFindState {
  /** Temporary app page owned by an AI run, just like browser automation pages. */
  automationRunId?: string;
  /** Temporarily parked for input/inspection without changing the visible page. */
  automationPreparing?: boolean;
  highlighted?: boolean;
  /** Set from the tab menu: idle unloading never discards this tab. */
  keepLoaded?: boolean;
  menu?: Menu;
  splitPreparation?: AbortController;
  splitRetry?: ReturnType<typeof setTimeout>;
  generation: number;
  pageLoading?: boolean;
  /** Initial Terminal controls and widget reads have settled in this document. */
  terminalReady?: boolean;
  /** A response is committed; its parser may still be streaming. */
  documentCommitted?: boolean;
  sharedChrome?: boolean;
  releasePrivateProfile?: () => void;
  primary?: boolean;
  /** Restored background pages load on selection, without a login request storm. */
  deferredUrl?: string;
  deferredBrowserUrl?: string;
  authReturnUrl?: string;
  authReturnTitle?: string;
  groupId?: string;
  /** Live chat destinations, including those selected without URL changes. */
  notificationUrls?: string[];
  voiceOverlay?: boolean;
  /** Transient renderer state; never saved with the tab session. */
  learnActivity?: { pathname: string; active: boolean };
  /** When this tab last left the front; idle unloading measures from here. */
  backgroundSince?: number;
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
  recoveryAttempt?: { expectedUrl?: string; directTerminal?: boolean };
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
  highlighted?: boolean;
}

interface Host {
  shell?: WindowShell;
  browserChrome?: Tab;
  browserOwnerKey?: string;
  shellEnabled: boolean;
  tabDragActive?: boolean;
  tabDragPreview?: boolean;
  splitLayoutKey?: string;
  splitDivider?: View;
  surfaces: TabSurfaceCache;
  foregroundFrameLeases: Map<WebContents, () => void>;
  presentedId: number | null;
  presentationRevision: number;
  presentationStatus: "pending" | "presented" | "failed";
  revealRetry?: ReturnType<typeof setTimeout>;
  backgroundBroadcast?: ReturnType<typeof setTimeout>;
  notifiedActiveId?: number;
  /** One unlisted launcher, prepared before the next Ctrl+T/plus click. */
  preparedNewTab?: Tab;
  prepareNewTabTimer?: ReturnType<typeof setTimeout>;
  newTabPreparationFailed?: boolean;
  newTabPreparationRetryAt?: number;
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
  /** Incoming views are in place; the outgoing surfaces remain underneath. */
  pendingAtFront: boolean;
  /** The pending reveal replaces a page during navigation, rather than selecting a tab. */
  pendingNavigation: boolean;
  /** Invalidates a reveal when the requested front tab changes under it. */
  revealToken: number;
  revealController?: AbortController;
  /**
   * Work that must wait until whatever is on screen has been replaced:
   * destroying a closed view that is still the window's paint, parking the
   * window's own page on a blank document.
   */
  afterReveal: Array<() => void>;
  /** Closed/replaced pages whose visible tab strips still serve the window. */
  retainedTabControls: Set<Tab>;
  /** One native layer shared by every tab in this window. */
  notificationOverlay: NotificationOverlay | null;
  downloadsPopover?: BrowserToolbarPopover;
  downloadsClosedAt?: number;
  extensionsPopover?: BrowserToolbarPopover;
  selectionPopover?: BrowserToolbarPopover;
  selectionCandidate?: { tab: Tab; entry: WebTextHighlight; anchor: { x: number; y: number; height?: number } };
  inlineAnswer?: BrowserInlineAnswer;
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

/** Typed text that exists only in the page: a changed field, or a focused editor
 * with content. A probe that fails or does not answer in 2 s counts as unsaved. */
function hasUnsavedInput(contents: WebContents): Promise<boolean> {
  // executeJavaScript waits for did-stop-loading on a page still loading its
  // main frame. One that never settles kept a listener per idle sweep forever
  // (MaxListenersExceededWarning, 2026-10-27). Busy counts as unsaved anyway.
  if (!contents.getURL() || contents.isLoadingMainFrame()) return Promise.resolve(true);
  const probe = contents.executeJavaScript(`(() => {
    const skip = ["hidden", "checkbox", "radio", "submit", "button", "reset", "file", "range", "color", "image"];
    for (const field of document.querySelectorAll("textarea, input")) {
      if (skip.includes((field.type || "text").toLowerCase())) continue;
      if (field.value && field.value !== field.defaultValue) return true;
    }
    const focused = document.activeElement;
    return Boolean(focused && focused.isContentEditable && (focused.textContent || "").trim());
  })()`).then(Boolean, () => true);
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(true), 2000).unref?.(); });
  return Promise.race([probe, timeout]);
}

function isTabStripCommand(command: TabsCommand): boolean {
  switch (command.type) {
    case "new": case "activate": case "close": case "anchor": case "move":
    case "tab-menu": case "group-move": case "group-tabs": case "group-update":
    case "group-action": case "group-menu": case "reopen":
    case "split-tabs": case "tab-drag":
      return true;
    case "browser":
      return command.url === undefined && !command.replaceCurrent;
    default:
      return false;
  }
}

/**
 * Keep one pixel of a preparing view uncovered so Chromium submits frames.
 * With the persistent shell, that pixel must be below the toolbar. Covering
 * the old top-right parking pixel prevents painting even with timer throttling
 * disabled. The rest of the view stays outside the visible content area.
 */
export function offscreenBounds(width: number, height: number, uncoveredTop = 0) {
  return { x: Math.max(0, width - 1), y: uncoveredTop + 1 - height, width, height };
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
  return browserTextHighlightsBootstrapScript();
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
    const sites = browserSignedInSites(cookies);
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
      for (const contents of this.backgroundNotificationTabs.keys()) this.destroyNotificationTab(contents);
      this.browserNotificationPages.clear();
      this.browserNotifications.resetPushSubscriptions();
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
    const tab = host && sender === host.browserChrome?.contents ? tabById(host, host.activeId)
      : host?.tabs.find(candidate => candidate.contents === sender);
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
    return this.browserTerminal.grant(target, { prepareCapture: contents => this.prepareBreadboardUseInput(contents) });
  }
  private readonly options: TabManagerOptions;
  private readonly hosts = new Map<number, Host>();
  private documentFindRequestId = 0;
  private readonly releasedAutomationRuns = new Set<string>();
  private readonly hostByContents = new Map<number, Host>();
  private readonly inspectionPreparations = new WeakMap<WebContents, { ready: Promise<boolean>; release: () => void; users: number }>();
  /** The pages lent to ChatMock's "OpenAI (web)" provider, by lane; see openChatgptWebTab. */
  private readonly chatgptWeb = new Map<string, ChatgptWebPage>();
  private memoryPressure: TabMemoryPressure = "normal";
  private unloadingIdleTabs = false;
  private readonly foregroundSurfaceViews = new WeakMap<Host, Set<WebContentsView>>();
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
  private readonly browserAdBlocker: BrowserAdBlocker;
  private readonly browserNotifications: BrowserNotifications;
  private readonly browserNotificationPages: BrowserNotificationPages;
  /** Closed, opted-in sites keep receiving events without occupying a tab. */
  private readonly backgroundNotificationTabs = new Map<WebContents, {
    host: Host; tab: Tab; origin: string; muted: boolean;
  }>();
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
  private authenticationUrl: string | null = null;
  private authenticatedUser: string | null | undefined;
  private authenticationCheck: Promise<boolean> | null = null;
  private authenticationDirty = false;
  private authenticationTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreGeneration = 0;

  constructor(options: TabManagerOptions) {
    this.options = options;
    // JWT rotation is not an account change. Verify once in the shell instead
    // of repeatedly discarding/reloading a spare renderer on every cookie write.
    session.defaultSession.cookies.on("changed", (_event, cookie) => {
      if (!/^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name)) return;
      if (this.authenticationUrl) {
        if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
        this.authenticationTimer = setTimeout(() => {
          this.authenticationTimer = null;
          void this.synchronizeAuthentication();
        }, 100);
        this.authenticationTimer.unref();
        return;
      }
      for (const host of this.hosts.values()) {
        // Loading the spare can itself refresh the session cookie. Retire that
        // document, but do not start another load/refresh/dispose loop. An
        // explicit new-tab request or runtime change can try preparation again.
        if (host.preparedNewTab && !host.preparedNewTab.painted) {
          host.newTabPreparationFailed = true;
          host.newTabPreparationRetryAt = undefined;
        }
        this.discardPreparedNewTab(host);
        this.scheduleNewTabPreparation(host);
      }
    });
    this.browserPreferences = new BrowserPreferenceStore(options.browserPreferencesConfigDir ?? options.browserExtensionsConfigDir ?? app.getPath("userData"), message => this.log(message));
    this.browserAdBlocker = new BrowserAdBlocker(options.browserExtensionsConfigDir ?? app.getPath("userData"),
      () => this.broadcastAll(), message => this.log(message));
    this.browserNotifications = new BrowserNotifications(this.browserPreferences,
      contents => this.hostByContents.get(contents.id)?.window,
      (contents, notice) => this.publishNotificationToast(contents, notice),
      contents => {
        const host = this.hostByContents.get(contents.id);
        const tab = host?.tabs.find(tab => tab.browser?.contents === contents)
          ?? this.restoreNotificationTab(contents, true);
        if (host && tab) { if (host.window.isMinimized()) host.window.restore(); host.window.show(); this.activate(host, tab.id); host.window.focus(); }
      },
      () => {
        this.browserNotificationPages.reconcile(this.browserPreferences.snapshot().sites);
        for (const [contents, entry] of this.backgroundNotificationTabs) {
          if (this.browserPreferences.permission(entry.origin) !== "granted") this.destroyNotificationTab(contents);
        }
        for (const host of this.hosts.values()) for (const tab of host.tabs) this.rememberNotificationPage(host, tab);
        this.restoreBackgroundNotificationTabs();
        for (const host of this.hosts.values()) this.broadcast(host);
      },
      new BrowserWebPush(options.browserPreferencesConfigDir ?? options.browserExtensionsConfigDir ?? app.getPath("userData"),
        url => this.browserPreferences.permission(url), message => this.log(message)),
    );
    this.browserVisitedLinks = new BrowserVisitedLinks(options.browserVisitedLinksConfigDir, (message) => this.log(message));
    this.browserHistory = new BrowserHistory(options.browserHistoryConfigDir, () => {
      const sent = new Set<number>();
      for (const host of this.hosts.values()) {
        for (const tab of host.tabs) {
          const contents = tab.contents;
          if (contents.isDestroyed() || sent.has(contents.id)) continue;
          sent.add(contents.id);
          try {
            // Browser tabs share this renderer. Notify it once, and never
            // access a disposed frame while the interface is recovering.
            if (contents.isCrashed()) continue;
            const frame = contents.mainFrame;
            if (frame && !frame.isDestroyed()) frame.send(IPC_CHANNELS.browserHistoryChanged);
          } catch { /* Tab closed during navigation; restored pages read the current history. */ }
        }
      }
    });
    this.browserNotificationPages = new BrowserNotificationPages(
      options.browserPreferencesConfigDir ?? options.browserExtensionsConfigDir ?? app.getPath("userData"),
      this.browserPreferences.snapshot().sites, this.browserHistory.snapshot().items, message => this.log(message),
    );
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
    setInterval(() => void this.unloadIdleTabs(), 60_000).unref?.();
  }

  private log(line: string): void {
    this.options.log?.(`[tabs] ${line}`);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setAuthenticationUrl(dashboardUrl: string): void {
    this.authenticationUrl = new URL("/api/auth/session", dashboardUrl).href;
  }

  private async readAuthenticatedUser(): Promise<string | null> {
    const endpoint = this.authenticationUrl!;
    const cookies = await session.defaultSession.cookies.get({ url: endpoint });
    // Node fetch deliberately does not apply Set-Cookie. A session probe must
    // not rotate Chromium's JWT and trigger its own cookie listener forever.
    const response = await fetch(endpoint, {
      headers: { Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Session check failed (${response.status})`);
    const value = await response.json() as { user?: { id?: unknown } } | null;
    if (value === null || (value && typeof value === "object" && !value.user)) return null;
    const id = value?.user?.id;
    if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) throw new Error("Invalid session response");
    return id;
  }

  /** One login screen owns authentication for every tab and window. */
  synchronizeAuthentication(): Promise<boolean> {
    if (!this.authenticationUrl || !this.sessionDashboardUrl || this.sessionFrozen) return Promise.resolve(false);
    if (this.authenticationCheck) {
      this.authenticationDirty = true;
      return this.authenticationCheck;
    }
    this.authenticationCheck = (async () => {
      let result = false;
      do {
        this.authenticationDirty = false;
        result = await this.applyAuthentication();
      } while (this.authenticationDirty && !this.sessionFrozen);
      return result;
    })().catch(error => {
      this.log(`could not synchronize login: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }).finally(() => { this.authenticationCheck = null; });
    return this.authenticationCheck;
  }

  private async applyAuthentication(): Promise<boolean> {
    const userId = await this.readAuthenticatedUser();
    if (this.sessionFrozen) return false;
    if (userId === this.authenticatedUser) {
      if (userId) {
        for (const host of this.hosts.values()) for (const tab of host.tabs) {
          if (tab.contents.isDestroyed() || !isAuthenticationUrl(tab.contents.getURL(), this.authenticationUrl!)) continue;
          const current = new URL(tab.contents.getURL());
          const url = tab.browser?.shellUrl ?? new URL(authReturnPath(tab.authReturnUrl ?? current.searchParams.get("callbackUrl"), this.authenticationUrl!), this.authenticationUrl!).href;
          if (!tab.browser) tab.url = url;
          void tab.contents.loadURL(url).catch(() => undefined);
        }
      }
      return true;
    }
    const owners = [...this.hosts.values()].filter(host => !host.window.isDestroyed());
    const main = owners.find(host => host.sessionMain) ?? owners.find(host => !host.privateBrowsing);
    if (!main) return false;
    // Capture the outgoing account before clearing live tabs. During a queued
    // restore its complete disk snapshot is more authoritative than partial UI.
    if (this.authenticatedUser) {
      for (const host of owners) this.rememberSession(host);
      this.flushSession();
    }
    this.restoreGeneration += 1;
    this.restoringSession = false;
    this.sessionRestored = false;
    this.authenticatedUser = userId;
    this.savedWindows.clear();
    this.lastSessionJson = "";
    for (const host of owners) {
      host.sessionTracked = false;
      this.discardPreparedNewTab(host);
      this.destroyNotificationTabsForHost(host);
      this.destroyNotificationOverlay(host);
      host.downloadsPopover?.close();
      host.extensionsPopover?.close();
      host.selectionPopover?.close(); host.inlineAnswer?.close();
      host.groupPopover?.close();
      host.findBar?.close();
      if (host !== main) {
        host.sessionMain = false;
        host.window.destroy();
        continue;
      }
      this.exitBrowserFullscreen(host);
      host.pending = null;
      host.pendingAtFront = false;
      host.pendingNavigation = false;
      host.revealToken += 1;
      host.revealController?.abort();
      this.runAfterReveal(host);
      this.destroyLoadingScene(host);
      for (const tab of host.tabs) if (tab.view && tab !== host.base) this.dispose(host, tab);
      host.browserChrome?.contents.close();
      host.browserChrome = undefined;
      host.browserOwnerKey = undefined;
      host.base.generation += 1;
      host.base.painted = false;
      host.base.loaded = false;
      host.presentedId = null;
      host.presentationRevision += 1;
      host.presentationStatus = "pending";
      host.tabs = [host.base];
      host.closedTabs = [];
      host.groups = [];
      host.savedGroups = [];
      host.baseRetired = false;
      host.base.anchored = false;
      host.base.highlighted = false;
      host.base.groupId = undefined;
      host.base.authReturnUrl = undefined;
      host.base.authReturnTitle = undefined;
      host.base.title = userId ? "Terminal" : "Sign in";
      host.activeId = host.base.id;
      this.hostByContents.set(host.base.contents.id, host);
    }
    main.sessionMain = true;
    const destination = userId ? this.newTabUrl ?? new URL("/dashboard", this.sessionDashboardUrl!).href
      : new URL("/auth/login", this.sessionDashboardUrl!).href;
    main.base.url = destination;
    // Reload the document to discard the previous account's React/router caches.
    const navigation = main.base.contents.loadURL(destination).catch(() => undefined);
    this.broadcast(main);
    if (userId) {
      await this.restoreSession(main.window, this.sessionDashboardUrl!, () =>
        this.options.openWindow(this.newTabUrl ?? destination) as BrowserWindow);
      if (this.notificationOverlayUrl && !main.notificationOverlay) this.createNotificationOverlay(main, this.notificationOverlayUrl);
    }
    await navigation;
    return true;
  }

  /** Where Ctrl+T goes. Nothing until the dashboard is serving. */
  setNewTabUrl(url: string | null): void {
    if (this.newTabUrl === url) return;
    this.newTabUrl = url;
    for (const host of this.hosts.values()) {
      host.newTabPreparationFailed = false;
      host.newTabPreparationRetryAt = undefined;
      this.discardPreparedNewTab(host);
      this.scheduleNewTabPreparation(host);
    }
  }

  private readonly dashboardRecoveryLoads = new BoundedWorkQueue(2);

  /** A recovered runtime can bind a different port while these tabs stay open. */
  async reconnectDashboard(previous: string, next: string): Promise<void> {
    const rebase = (url: string) => rebaseDashboardUrl(url, previous, next);
    this.sessionDashboardUrl = next;
    const loads: Promise<unknown>[] = [];
    const queuedContents = new Set<number>();
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
        if (tab.authReturnUrl) tab.authReturnUrl = rebase(tab.authReturnUrl);
        tab.notificationUrls = tab.notificationUrls?.map(rebase);
        if (tab.deferredUrl) { tab.deferredUrl = target; continue; }
        // Browser tabs share one toolbar renderer. Rebase each tab's metadata,
        // but navigate that shared document only once.
        if (queuedContents.has(tab.contents.id)) continue;
        queuedContents.add(tab.contents.id);
        if (tab.recovering) {
          tab.recoveryUrl = target;
        } else {
          loads.push(this.dashboardRecoveryLoads.run(() => {
            // A queued page may have closed, navigated, or been rebased again.
            // Never replace that newer document with the old recovery target.
            if ((tab.browser?.shellUrl ?? tab.url) !== target || tab.recovering) return Promise.resolve(true);
            return loadRecoveryUrlIfAlive(tab.contents, target);
          }).then(loaded => {
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
   * Every saved tab returns, whether anchored, grouped or ordinary. Keep the
   * fresh page active, reusing a saved New tab when possible.
   */
  async restoreSession(
    window: BrowserWindow,
    dashboardUrl: string,
    createWindow: () => BrowserWindow,
    paintBeforeReveal = false,
  ): Promise<void> {
    const host = this.hosts.get(window.id);
    if (!host || this.sessionRestored) return;
    if (this.authenticationUrl && this.authenticatedUser === undefined) {
      try { this.authenticatedUser = await this.readAuthenticatedUser(); }
      catch (error) {
        this.sessionDashboardUrl = dashboardUrl;
        this.log(`startup session check failed: ${String(error)}`);
        return;
      }
    }
    if (window.isDestroyed() || this.sessionFrozen || this.sessionRestored) return;
    this.sessionDashboardUrl = dashboardUrl;
    host.sessionMain = true;
    if (this.authenticatedUser && this.notificationOverlayUrl && !host.notificationOverlay) {
      this.createNotificationOverlay(host, this.notificationOverlayUrl);
    }
    this.broadcast(host);
    // Authentication still owns windows when the Profile tab switch is off.
    // Keep the saved tabbed workspace intact until that switch is enabled.
    if (this.authenticationUrl && !this.authenticatedUser) return;
    if (!this.options.tabSessionConfigDir || !this.enabled) {
      this.restoreBackgroundNotificationTabs();
      return;
    }
    const generation = ++this.restoreGeneration;
    const cancelled = () => this.sessionFrozen || generation !== this.restoreGeneration;
    this.sessionRestored = true;
    this.sessionDashboardUrl = dashboardUrl;
    this.restoringSession = true;
    const saved = this.authenticatedUser
      ? readAccountTabSession(this.options.tabSessionConfigDir, this.authenticatedUser)
      : readTabSession(this.options.tabSessionConfigDir);
    const isNewTabUrl = (value: string): boolean => {
      if (!this.newTabUrl || !value) return false;
      const candidate = new URL(value);
      const newTab = new URL(this.newTabUrl);
      // WindowManager adds the current theme to the startup page's URL.
      candidate.searchParams.delete("theme");
      newTab.searchParams.delete("theme");
      return candidate.toString() === newTab.toString();
    };
    let completed = false;
    try {
      this.trackSessionWindow(window, true);
      for (const [index, entry] of saved.windows.entries()) {
        if (window.isDestroyed() || cancelled()) return;
        if (index > 0 && !entry.tabs.length && !entry.savedGroups?.length) continue;
        const target = index === 0 ? host : this.hosts.get(createWindow().id);
        if (!target) continue;
        target.sessionTracked = true;
        // Every restored group starts folded: the strip opens tidy and the
        // fresh New tab never sits inside a hidden group.
        target.groups = (entry.groups ?? []).map(group => ({ ...group, collapsed: true }));
        target.savedGroups = entry.savedGroups ?? [];
        // The main window is enrolled by WindowManager even with no saved tabs.
        if (index > 0) await this.prepareStartupTab(target, target.base, paintBeforeReveal);
        const restored: Array<Tab | undefined> = new Array(entry.tabs.length);
        let reusedStartupTab = false;
        // Register the whole saved workspace before waiting on any page. A
        // stalled widget or response in the first pair must not hide all the
        // remaining tabs from the strip or prevent their documents starting.
        for (let position = 0; position < entry.tabs.length; position++) {
          const savedTab = entry.tabs[position]!;
          const url = restoredTabUrl(savedTab, dashboardUrl);
          if (url === null) continue;
          // Reuse at most one plain New tab. Preserve intentional duplicates
          // and grouped/anchored New tabs without adding one on every launch.
          const reuseStartupTab = !reusedStartupTab && savedTab.kind === "dashboard" &&
            !savedTab.anchored && !savedTab.groupId && isNewTabUrl(url) &&
            isNewTabUrl(target.base.url) && !target.base.anchored && !target.base.groupId &&
            !target.base.browser && target.tabs.includes(target.base);
          if (reuseStartupTab) reusedStartupTab = true;
          const tab = reuseStartupTab ? target.base : savedTab.kind === "browser"
            ? this.openBrowserTab(target, url || undefined, true, undefined, undefined, undefined, null, { restored: true, deferred: true })
            : this.openTab(target, url, { background: true, origin: "blank", deferred: true });
          if (!tab) continue;
          tab.anchored = savedTab.anchored;
          tab.highlighted = savedTab.highlighted === true;
          tab.keepLoaded = savedTab.keepLoaded === true;
          tab.groupId = savedTab.groupId;
          // Older sessions persisted the browser home as "New tab". Keep the
          // trusted browser surface named consistently after an upgrade.
          tab.title = savedTab.kind === "browser" && url === "" ? "Browser"
            : isAuthenticationUrl(savedTab.url, dashboardUrl) ? "" : savedTab.title;
          restored[position] = tab;
        }
        this.broadcast(target);
        // Loading all saved tabs at boot held startup for minutes and about
        // 6 GB. Restored tabs now wait to be selected (activate starts them),
        // except the startup tab reused here. "Never offload tab" means it is
        // never unloaded once loaded; with 15 of 34 tabs marked, starting them
        // all here still held the reveal on a queue of PDFs (2026-10-27).
        const startsAtRestore = (tab: Tab) =>
          this.options.restoreAllTabsAtStartup === true || tab === target.base;
        let next = 0;
        const restoreNext = async () => {
          while (next < restored.length && !target.window.isDestroyed() && !cancelled()) {
            const tab = restored[next++];
            if (!tab || !target.tabs.includes(tab) || !startsAtRestore(tab)) continue;
            this.startDeferredTab(target, tab);
            await this.prepareStartupTab(target, tab, paintBeforeReveal);
          }
        };
        await Promise.all([restoreNext(), restoreNext()]);
        if (target.window.isDestroyed() || cancelled()) return;
        const restoredTabs = restored.filter((tab): tab is Tab => Boolean(tab && target.tabs.includes(tab)));
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
      if (generation === this.restoreGeneration) this.restoringSession = false;
      // Closing during a queued restore must preserve the complete saved run.
      if (completed && !cancelled() && !window.isDestroyed()) {
        this.restoreBackgroundNotificationTabs();
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
    const loadDeadline = Date.now() + STARTUP_TAB_LOAD_MAX_WAIT_MS;
    while (!contents.isDestroyed() && !contents.isCrashed()) {
      if (await waitForStartupPageLoad(contents, Math.min(waitMs, Math.max(1, loadDeadline - Date.now())))) return true;
      if (tab.recovering || contents.isDestroyed() || contents.isCrashed() || !contents.isLoading()) break;
      if (Date.now() >= loadDeadline) {
        this.log(`stopped gating startup on ${tab.title}; it keeps loading in the background`);
        return false;
      }
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
      const releaseFrames = allowBackgroundFrames(contents);
      const page = contents === tab.browser?.contents ? tab.browser : tab;
      const attachedForPreparation = Boolean(view && paint && !page.attached);
      // Detached views cannot paint. The owning startup window is transparent
      // and parked offscreen. Attach BEFORE loading so visibility-gated effects
      // and animation frames can initialize instead of waiting for tab selection.
      // A selection may already own this view; preparation must not move it.
      if (view && attachedForPreparation) {
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
        const readyDeadline = Date.now() + STARTUP_TAB_LOAD_MAX_WAIT_MS;
        while (!contents.isDestroyed() && !contents.isCrashed() && !host.window.isDestroyed()) {
          const remaining = readyDeadline - Date.now();
          if (remaining <= 0) {
            this.log(`startup content still pending in ${tab.title}; continuing its load in the background`);
            return;
          }
          if (await waitForStartupPageReady(contents, Math.min(waitMs, remaining))) {
            // Content readiness already covers hydration. Waiting for fonts,
            // idle and FCP again can add 12 seconds to each offscreen document.
            // A missed parked frame is retried by normal foreground reveal.
            if (paint) await waitForRevealFrame(contents, 1500);
            return;
          }
          // A slow response is still pending. Only actual readiness or a
          // failed/destroyed page may finish this tab's startup work.
          if (tab.recovering && !await this.waitForStartupTabPage(tab, contents, waitMs)) return;
          this.log(`still waiting for startup content in ${tab.title}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } finally {
        releaseFrames();
        // Selection can claim the view while readiness is still pending. Its
        // late cleanup used to remove the foreground page, exposing New tab
        // underneath while the strip still showed the selected workspace/site.
        if (view && attachedForPreparation && !page.attached &&
            !host.window.isDestroyed() && !contents.isDestroyed()) {
          forgetViewBounds(view);
          host.window.contentView.removeChildView(view);
        }
        if (view && !page.attached) this.hideBackgroundView(host, view, contents);
      }
    }));
  }

  /**
   * A page that loads without ever being attached starts out "visible" to
   * Chromium and never gets a hidden transition: it ran unthrottled, with every
   * visibility-gated poll, for as long as it lived (2026-10-27, 7 of 9
   * background PDF tabs). Only an attached view can be hidden, so park it
   * offscreen for the transition, the way a selected-then-left tab gets it.
   * Every attach path shows the view again.
   */
  private hideBackgroundView(host: Host, view: WebContentsView, contents: WebContents): void {
    if (contents.isDestroyed() || host.window.isDestroyed()) return;
    const throttled = contents.getBackgroundThrottling();
    if (!throttled) contents.setBackgroundThrottling(true);
    const parked = !host.window.contentView.children.includes(view);
    if (parked) {
      const [width = 1, height = 1] = host.window.getContentSize();
      setViewBounds(view, offscreenBounds(width, height, this.preparationTop(host, height)));
      host.window.contentView.addChildView(view);
    }
    view.setVisible(false);
    if (parked) {
      host.window.contentView.removeChildView(view);
      forgetViewBounds(view);
    }
    if (!throttled) contents.setBackgroundThrottling(false);
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
    if (host.privateBrowsing || !host.sessionTracked || !this.sessionDashboardUrl || this.sessionFrozen || this.restoringSession ||
        (this.authenticationUrl && !this.authenticatedUser)) return;
    const tabs = host.tabs.filter(tab => !tab.browser?.privatePartition && (!(tab.automationRunId ?? tab.browser?.automationRunId) || tab.anchored)).map((tab) => ({ tab,
      saved: saveTab({ ...tab, url: tab.authReturnUrl ?? tab.url, title: tab.authReturnTitle ?? tab.title }, this.sessionDashboardUrl!) }))
      .filter((entry) => entry.saved !== null);
    this.savedWindows.set(host.window.id, {
      tabs: tabs.map((entry) => entry.saved!),
      activeIndex: Math.max(0, tabs.findIndex((entry) => entry.tab.id === host.activeId)),
      groups: host.groups.filter(group => group.id === AI_TAB_GROUP_ID || tabs.some(entry => isInTabGroup(host.groups, entry.tab.groupId, group.id))),
      savedGroups: host.savedGroups,
    });
    if (!this.sessionWriteTimer) {
      this.sessionWriteTimer = setTimeout(() => this.flushSession(), 200);
      this.sessionWriteTimer.unref();
    }
  }

  private flushSession(): void {
    for (const host of this.hosts.values()) {
      if (!host.backgroundBroadcast) continue;
      this.flushBackgroundBroadcast(host);
    }
    if (this.sessionWriteTimer) clearTimeout(this.sessionWriteTimer);
    this.sessionWriteTimer = null;
    if (!this.options.tabSessionConfigDir || !this.sessionRestored || this.restoringSession || this.sessionFrozen) return;
    const session = { version: 1 as const, windows: [...this.savedWindows.values()].filter((entry) => entry.tabs.length || entry.savedGroups?.length) };
    const json = JSON.stringify(session);
    if (json === this.lastSessionJson) return;
    try {
      if (this.authenticationUrl && !this.authenticatedUser) return;
      if (this.authenticatedUser) writeAccountTabSession(this.options.tabSessionConfigDir, this.authenticatedUser, session);
      else writeTabSession(this.options.tabSessionConfigDir, session);
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

  /**
   * True when `contents` is a page loaded in a browser tab rather than the
   * product's own chrome.
   *
   * Tabs are created with the product preload (see `createView`), so every
   * page the in-app browser loads can reach privileged IPC. Anything that
   * ends the process has to tell the two apart: a page must never be able to
   * quit or restart the app out from under a running job.
   */
  isTabPageContents(contents: WebContents): boolean {
    const host = this.hostByContents.get(contents.id);
    if (!host) return false;
    return host.tabs.some((tab) => tab.contents === contents || tab.browser?.contents === contents);
  }

  isPrivateBrowser(sender: WebContents): boolean {
    const host = this.hostByContents.get(sender.id);
    const tab = host && (sender === host.shell?.contents || sender === host.browserChrome?.contents)
      ? tabById(host, host.activeId) : host?.tabs.find(tab => tab.contents === sender || tab.browser?.contents === sender);
    return Boolean(host?.privateBrowsing || tab?.browser?.privatePartition);
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
      this.browserAdBlocker.attachSession(this.privateProfile.session, true);
    }
    return this.privateProfile.partition;
  }

  private retainPrivateProfile(tab: Tab): void {
    const profile = this.privateProfile;
    if (!profile || tab.browser?.privatePartition !== profile.partition) return;
    profile.users++;
    let released = false;
    tab.releasePrivateProfile = () => {
      if (released) return;
      released = true;
      if (--profile.users !== 0) return;
      profile.translationSites.clear();
      if (this.privateProfile === profile) this.privateProfile = null;
      // Retire the identity before cleanup so a newly opened private tab
      // cannot race with removal of the preceding session's data.
      void Promise.allSettled([
        profile.session.closeAllConnections(), profile.session.clearStorageData(),
        profile.session.clearCache(), profile.session.clearAuthCache(),
      ]);
    };
    if (!tab.sharedChrome) tab.contents.once("destroyed", tab.releasePrivateProfile);
  }

  baseViewport(window: BrowserWindow): Rectangle {
    return this.hosts.get(window.id)?.base.view?.getBounds() ?? window.getContentBounds();
  }

  baseContents(window: BrowserWindow): WebContents {
    return this.hosts.get(window.id)?.base.contents ?? window.webContents;
  }

  attach(window: BrowserWindow, persistentShell = false): void {
    if (this.hosts.has(window.id)) return;
    const baseView = persistentShell ? new WebContentsView({ webPreferences: tabRendererWebPreferences(this.options.preloadPath) }) : null;
    if (baseView) {
      baseView.setBackgroundColor(backgroundColorForTheme(this.options.theme()));
      window.contentView.addChildView(baseView);
      const [width = 1, height = 1] = window.getContentSize();
      setViewBounds(baseView, { x: 0, y: 0, width, height });
    }
    const base: Tab = {
      generation: 0,
      id: 1,
      anchored: false,
      view: baseView,
      contents: baseView?.webContents ?? window.webContents,
      title: "",
      url: "",
      loading: false,
      loaded: false,
      onLoaded: [],
      painted: false,
      spawned: 0,
      recovering: false,
      attached: !!baseView,
    };
    const host: Host = {
      shellEnabled: false,
      surfaces: new TabSurfaceCache(),
      presentedId: null,
      presentationRevision: 0,
      presentationStatus: "pending",
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
      pendingAtFront: false,
      pendingNavigation: false,
      revealToken: 0,
      afterReveal: [],
      foregroundFrameLeases: new Map(),
      retainedTabControls: new Set(),
      notificationOverlay: null,
      loadingScene: null,
    };
    ensureAiTabGroup(host);
    (this.options.allowed.localFiles ??= new Set()).add(pathToFileURL(path.join(__dirname, "../window-shell/index.html")).href);
    host.surfaces.setPressure(this.memoryPressure);
    this.hosts.set(window.id, host);
    this.distributeSurfaceBudget();
    this.track(host, base);
    if (persistentShell) {
      if (process.platform === "win32") {
        installWindowSurfaceRecovery(window, () => this.foregroundSurfaceViews.get(host));
      }
      // BrowserWindow's neutral backing document must commit too: on Windows
      // an uninitialized backing renderer can keep the native window invisible.
      void window.webContents.loadURL("about:blank").catch(() => undefined);
      window.webContents.on("before-input-event", (event, input) => this.handleInput(host, event, input));
      host.shell = new WindowShell(() => window.isDestroyed() ? null : this.shellState(host), value => this.shellCommand(host, value), () => {
        if (window.isDestroyed()) return;
        this.layout(host);
        this.broadcast(host);
      });
      this.hostByContents.set(host.shell.contents.id, host);
      host.shell.contents.ipc.handle("breadboard:shell-suggestions", async (event, query: unknown) => {
        if (event.senderFrame !== host.shell?.contents.mainFrame || typeof query !== "string" || query.length > 256 ||
            this.isPrivateBrowser(event.sender) || !this.browserUrl) return { suggestions: [] };
        const url = new URL("/api/browser/suggestions", this.browserUrl);
        url.searchParams.set("q", query);
        try {
          const response = await net.fetch(url.href, { signal: AbortSignal.timeout(2000) });
          return response.ok ? await response.json() : { suggestions: [] };
        } catch { return { suggestions: [] }; }
      });
      host.shell.contents.on("before-input-event", (event, input) => this.handleInput(host, event, input));
      host.shell.contents.on("zoom-changed", (_event, direction) => this.run(host, { type: "zoom", direction }));
    }
    if (this.notificationOverlayUrl) {
      this.createNotificationOverlay(host, this.notificationOverlayUrl);
    }

    const relayout = () => {
      this.layout(host);
      if (host.shell) this.send(host.shell.contents, this.shellState(host));
    };
    window.on("resize", relayout);
    window.on("focus", () => {
      this.layout(host);
      this.broadcast(host);
    });
    window.on("blur", () => {
      const dragging = host.tabDragActive;
      host.tabDragActive = false;
      host.tabDragPreview = false;
      if (dragging) this.layout(host);
      this.broadcast(host);
    });
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
      this.destroyNotificationTabsForHost(host);
      for (const release of host.foregroundFrameLeases.values()) release();
      host.foregroundFrameLeases.clear();
      if (host.shell) this.hostByContents.delete(host.shell.contents.id);
      if (host.browserChrome) this.hostByContents.delete(host.browserChrome.contents.id);
      host.shell?.close();
      if (host.browserChrome && !host.browserChrome.contents.isDestroyed()) host.browserChrome.contents.close();
      clearTimeout(host.revealRetry);
      clearTimeout(host.backgroundBroadcast);
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
          tabs: anchored, activeIndex: 0, groups: host.groups.filter(group => anchored.some(tab => isInTabGroup(host.groups, tab.groupId, group.id))), savedGroups: host.savedGroups,
        });
        else this.savedWindows.delete(window.id);
        this.flushSession();
      }
      this.hosts.delete(window.id);
      this.distributeSurfaceBudget();
      this.discardPreparedNewTab(host);
      if (this.hosts.size === 0) void this.browserTerminal.close();
      host.pending = null;
      host.pendingAtFront = false;
      host.pendingNavigation = false;
      host.revealToken += 1;
      host.revealController?.abort();
      // Closed views still waiting for a replacement to come forward go too.
      this.runAfterReveal(host);
      for (const tab of host.tabs) {
        this.hostByContents.delete(tab.contents.id);
        if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
        if (tab.view) this.destroyView(tab);
      }
      this.destroyLoadingScene(host);
      this.destroyNotificationOverlay(host);
      if (!host.tabs.includes(host.base) && !host.base.contents.isDestroyed()) host.base.contents.close();
      if (this.hostByContents.get(host.base.contents.id) === host) this.hostByContents.delete(host.base.contents.id);
      host.downloadsPopover?.close();
      host.extensionsPopover?.close();
      host.selectionPopover?.close(); host.inlineAnswer?.close();
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
    target.base.highlighted = source.base.highlighted;
    target.base.groupId = source.base.groupId;
    target.groups = source.groups;
    target.savedGroups = source.savedGroups;
    source.groupPopover?.close();
    target.groupPopover?.close();
    this.cancelReveal(source);
    this.runAfterReveal(source);
    const views = source.tabs.filter((tab) => tab.view && tab !== source.base);
    if (source.browserChrome) {
      target.browserChrome?.contents.close();
      target.browserChrome = source.browserChrome;
      source.browserChrome = undefined;
    }
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

  private visibleTab(host: Host): Tab | undefined {
    return (host.pending && !host.pendingAtFront ? tabById(host, host.presentedId ?? -1) : undefined)
      ?? tabById(host, host.activeId);
  }

  private toolbarTab(host: Host): Tab | undefined {
    const visible = this.visibleTab(host);
    return visible?.browser ? visible : splitMembers({ ...host, activeId: visible?.id ?? host.activeId }).find(tab => tab.browser);
  }

  private shellState(host: Host, state = this.state(host)): TabsState {
    const toolbar = this.toolbarTab(host);
    return { ...state, selfId: toolbar?.id ?? host.activeId };
  }

  private shellCommand(host: Host, value: unknown): boolean | Promise<boolean> {
    if (!value || typeof value !== "object" || host.window.isDestroyed()) return false;
    const request = value as { command?: unknown; targetId?: number; generation?: number; revision?: number };
    if (!isTabsCommand(request.command)) return false;
    const command = request.command;
    const active = tabById(host, host.activeId);
    if (!active) return false;
    if (command.type === "browser-address-suggestions" && !command.open) {
      // Dismissal belongs to this trusted toolbar, not the website document.
      // Its delayed blur/cleanup can carry the generation from before a
      // navigation; rejecting it leaves an invisible native view over the page.
      const target = tabById(host, request.targetId ?? -1);
      if (!target?.browser) return false;
      target.browser.addressSuggestionsOpen = false;
      target.browser.suggestionsBottom = undefined;
      if (host.activeId === target.id || this.toolbarTab(host) === target) this.layout(host);
      return true;
    }
    if (!isTabStripCommand(command)) {
      const allowed = ["back", "forward", "reload", "browser-navigate", "browser-stop", "browser-menu",
        "browser-translation-menu", "browser-translate", "browser-translation-restore", "browser-downloads-popover",
        "browser-downloads-close", "browser-extensions-popover", "browser-extensions-close", "browser-address-suggestions", "browser-organization"].includes(command.type);
      const target = tabById(host, request.targetId ?? -1);
      if (!allowed || !target || (target !== active && !splitMembers(host).includes(target) && target !== this.toolbarTab(host)) ||
          request.generation !== target.generation || request.revision !== host.presentationRevision) return false;
      if (target !== active) {
        // Toolbar effects also publish closed autocomplete/popovers. They may
        // update the visible browser beside a local page without selecting it.
        if (["browser-address-suggestions", "browser-downloads-close", "browser-extensions-close"].includes(command.type)) {
          // Cleanup from retained controls must not cancel the incoming tab or
          // be dispatched to it through the shared browser renderer.
          if (!splitMembers(host).includes(target)) return false;
        } else this.activate(host, target.id);
        return this.handleCommand(target.contents, { ...command, targetTabId: target.id, generation: target.generation, presentationRevision: host.presentationRevision });
      }
    }
    return this.handleCommand(active.contents, command);
  }

  /** What the page asked for through the bridge. False when it is not a tab
   *  of any window, or the request was not one this window can honour. */
  handleCommand(sender: WebContents, command: TabsCommand): boolean | Promise<boolean> {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) return false;
    if (host.tabs.some(tab => tab.browser?.contents === sender)) return false;
    const splitTarget = splitMembers(host).find(tab => tab.id === command.targetTabId && tab.contents === sender);
    const senderTab = splitTarget ?? (sender === host.browserChrome?.contents
      ? tabById(host, host.activeId) : host.tabs.find(tab => tab.contents === sender));
    const target = command;
    if (!isTabStripCommand(command) && target.targetTabId !== undefined &&
        (target.targetTabId !== senderTab?.id || target.generation !== senderTab?.generation ||
          (target.presentationRevision !== host.presentationRevision && !(splitTarget && Number.isInteger(target.presentationRevision) &&
            target.presentationRevision! >= 0 && target.presentationRevision! < host.presentationRevision)))) return false;
    // Closing a page does not immediately remove its visible tab strip. Keep
    // those window controls usable until the replacement paints, while still
    // rejecting page-local work (navigation, notifications, etc.) from it.
    const retainedControls = [...host.retainedTabControls].find(tab => tab.contents === sender);
    if (!host.tabs.some(tab => tab.contents === sender) &&
        !(retainedControls && isTabStripCommand(command)) &&
        sender !== host.notificationOverlay?.contents &&
        sender !== host.downloadsPopover?.contents &&
        sender !== host.extensionsPopover?.contents &&
        sender !== host.selectionPopover?.contents &&
        sender !== host.inlineAnswer?.contents &&
        sender !== host.groupPopover?.contents &&
        sender !== host.findBar?.contents) {
      // "open" callers fall back to window.open on false. Consume obsolete
      // link requests so a retired renderer cannot create a fallback window.
      return command.type === "open";
    }
    if (this.authenticationUrl && !this.authenticatedUser && command.type !== "auth-sync" && command.type !== "navigation-check") return false;
    if (splitTarget && splitTarget.id !== host.activeId && ["back", "forward", "reload", "browser-navigate", "browser-menu", "browser-find", "browser-find-next"].includes(command.type)) {
      this.activate(host, splitTarget.id);
    }
    switch (command.type) {
      case "page-loading": {
        const tab = host.tabs.find(tab => tab.id === command.id && tab.contents === sender);
        if (!tab || tab.generation !== command.documentGeneration) return false;
        if (tab.pageLoading !== command.pending) {
          tab.pageLoading = command.pending;
          if (host.shell) this.send(host.shell.contents, this.shellState(host));
        }
        return true;
      }
      case "browser-shell-context":
        if (sender !== host.browserChrome?.contents) return false;
        host.browserOwnerKey = command.ownerKey;
        this.broadcast(host);
        return true;
      case "auth-sync":
        if (!this.authenticationUrl || new URL(sender.getURL()).origin !== new URL(this.authenticationUrl).origin) return false;
        return this.synchronizeAuthentication();
      case "notification-targets": {
        const tab = senderTab;
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
        const tab = senderTab;
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
        const tab = senderTab;
        if (!tab || (command.open && (tab.id !== host.activeId || host.pending))) return false;
        tab.voiceOverlay = command.open;
        if (command.open) host.downloadsPopover?.close();
        if (command.open) host.extensionsPopover?.close();
      host.selectionPopover?.close(); host.inlineAnswer?.close();
        if (command.open) this.detachBrowser(host.window, tab);
        else this.syncBrowser(host);
        this.layoutNotificationOverlay(host);
        if (command.open) tab.contents.focus();
        return true;
      }
      case "browser-organization-enabled": {
        const saved = this.browserPreferences.update(command);
        if (!saved) return false;
        for (const owner of this.hosts.values()) {
          for (const tab of owner.tabs) if (tab.browser) {
            if (!command.enabled) { tab.browser.organizationOpen = false; tab.browser.annotationTarget = undefined; tab.browser.annotationMarkers = []; }
            if (!command.enabled && tab.browser.contents && !tab.browser.contents.isDestroyed()) void tab.browser.contents.executeJavaScript(browserAnnotationPaintScript([])).catch(() => undefined);
          }
          owner.selectionPopover?.close();
          this.layout(owner); this.broadcast(owner);
        }
        return true;
      }
      case "browser-notifications-enabled":
      case "browser-notification-permission":
      case "browser-media-permission":
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
        const tab = senderTab;
        if (!tab?.browser) return false;
        this.showTranslationMenu(host, tab);
        return true;
      }
      case "browser-translate":
      case "browser-translation-restore": {
        const tab = senderTab;
        const translation = tab?.browser?.translation;
        if (!translation || tab?.browser?.showingHome) return false;
        if (command.type === "browser-translation-restore") return translation.restore().then(() => true);
        return translation.start(command.language).then(() => true);
      }
      case "navigation-check": {
        const tab = senderTab;
        return !!tab && this.allowTabNavigation(tab, command.url);
      }
      case "open": {
        const from = senderTab;
        if (!this.enabled && !from?.automationRunId) return false;
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
          const source = tabById(host, command.id), member = host.tabs.find(tab => isInTabGroup(host.groups, tab.groupId, command.groupId!));
          if (!source || (!member && command.groupId !== AI_TAB_GROUP_ID) || Boolean(source.browser?.privatePartition) !== Boolean(member?.browser?.privatePartition)) return false;
        }
        if (!moveGroupedTab(host, command.id, command.index, command.groupId)) return false;
        if (command.id === host.activeId) for (const group of tabGroupPath(host.groups, tabById(host, command.id)?.groupId)) group.collapsed = false;
        this.broadcast(host);
        return true;
      }
      case "group-move": {
        if (!this.enabled) return false;
        if (command.parentId) {
          const source = host.tabs.find(tab => isInTabGroup(host.groups, tab.groupId, command.groupId));
          const target = host.tabs.find(tab => isInTabGroup(host.groups, tab.groupId, command.parentId!));
          if (!source || (!target && command.parentId !== AI_TAB_GROUP_ID) || Boolean(source.browser?.privatePartition) !== Boolean(target?.browser?.privatePartition)) return false;
        }
        if (!moveTabGroup(host, command.groupId, command.index, command.parentId)) return false;
        const active = tabById(host, host.activeId);
        if (active) for (const group of tabGroupPath(host.groups, active.groupId)) group.collapsed = false;
        this.broadcast(host);
        return true;
      }
      case "tab-menu":
        return this.enabled && this.openTabMenu(host, command);
      case "tab-drag":
        if (!host.shellEnabled) return false;
        const wasPreview = host.tabDragPreview;
        host.tabDragActive = command.active;
        host.tabDragPreview = command.active && command.preview !== false;
        // A press only holds focus. Resizing the native shell on every click
        // invalidates hit testing and can occlude the page waiting to paint.
        if (wasPreview !== host.tabDragPreview) this.layout(host);
        if (!command.active && !host.pending && host.window.isFocused()) {
          const active = tabById(host, host.activeId);
          if (active) this.navigationContents(active).focus();
        }
        return true;
      case "split-tabs": {
        if (!this.enabled || !host.shellEnabled) return false;
        const source = tabById(host, command.id), target = tabById(host, command.targetId);
        if (!source?.view || !target?.view || Boolean(source.browser?.privatePartition) !== Boolean(target.browser?.privatePartition)) return false;
        const colors = Object.keys(TAB_GROUP_COLORS) as TabGroup["color"][];
        const fresh: TabGroup = { id: randomUUID(), name: "", color: colors[host.groups.length % colors.length]!, collapsed: false };
        if (!splitTabs(host, source.id, target.id, command.side, fresh)) return false;
        this.activate(host, source.id);
        this.flushSession();
        return true;
      }
      case "group-tabs": {
        if (!this.enabled) return false;
        const source = tabById(host, command.id), target = tabById(host, command.targetId);
        if (!source || !target || Boolean(source.browser?.privatePartition) !== Boolean(target.browser?.privatePartition)) return false;
        const colors = Object.keys(TAB_GROUP_COLORS) as TabGroup["color"][];
        const fresh: TabGroup = { id: randomUUID(), name: "", color: colors[host.groups.length % colors.length]!, collapsed: false };
        if (!groupTabs(host, command.id, command.targetId, fresh)) return false;
        if (source.id === host.activeId) {
          for (const group of tabGroupPath(host.groups, source.groupId)) group.collapsed = false;
        }
        this.broadcast(host);
        return true;
      }
      case "group-update": {
        if (!this.enabled) return false;
        const group = host.groups.find(group => group.id === command.groupId);
        if (!group) return false;
        if (group.id === AI_TAB_GROUP_ID && (command.name !== undefined || command.color !== undefined || command.split !== undefined)) return false;
        if (command.split === true && (!host.shellEnabled || host.groups.some(child => child.parentId === group.id) || host.tabs.filter(tab => tab.groupId === group.id && tab.view).length !== 2)) return false;
        if (command.split !== undefined) group.split = command.split;
        if (command.name !== undefined) group.name = command.name.trim();
        if (command.color !== undefined) group.color = command.color;
        if (command.collapsed !== undefined) group.collapsed = command.collapsed;
        if (group.collapsed && isInTabGroup(host.groups, tabById(host, host.activeId)?.groupId, group.id)) {
          const next = host.tabs.find(tab => !isTabGroupHidden(host.groups, tab.groupId));
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
        const owner = senderTab?.automationRunId ?? senderTab?.browser?.automationRunId;
        return this.openBrowserTab(
          host,
          command.url,
          Boolean(owner) && !current,
          owner,
          current,
          undefined,
          senderTab?.browser?.privatePartition
            ?? retainedControls?.browser?.privatePartition
            ?? (host.privateBrowsing ? this.privateBrowserPartition() : null),
        ) !== null;
      }
      case "browser-agent":
        return this.openBrowserAgentTab(host, command.runId, command.url);
      case "browser-agent-close":
        if (!isBrowserAgentRunId(command.runId)) return false;
        this.closeAutomationTabs(command.runId);
        return true;
      case "browser-navigate": {
        const tab = senderTab;
        return tab?.browser ? this.navigateBrowser(host, tab, command.input) : false;
      }
      case "browser-stop": {
        const tab = senderTab;
        const browser = liveBrowserPage(tab?.browser);
        if (!browser) return false;
        browser.contents.stop();
        return true;
      }
      case "browser-downloads-popover": {
        const tab = (senderTab?.id === host.activeId ? senderTab : undefined);
        if (!tab || !this.toolbarShellUrl(tab)) return false;
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
        const tab = (senderTab?.id === host.activeId ? senderTab : undefined);
        if (!tab?.browser || host.pending) return false;
        if (Date.now() - (host.extensionsClosedAt ?? 0) < 200) return true;
        return this.openToolbarPopover(host, tab, command, "extensions");
      }
      case "browser-selection-resize": {
        if (host.selectionPopover?.contents !== sender) return false;
        host.selectionPopover.resize(command.height);
        return true;
      }
      case "browser-selection-close": {
        if (host.selectionPopover?.contents !== sender) return false;
        host.selectionPopover.close(true);
        return true;
      }
      case "browser-selection-action": {
        const popup = host.selectionPopover;
        const candidate = host.selectionCandidate;
        const browser = candidate?.tab.browser;
        if (popup?.contents !== sender || !candidate || !browser?.highlights ||
            candidate.tab.id !== host.activeId) return false;
        return popup.keepOpenDuring(async () => {
          try {
            await browser.highlights!.apply(candidate.entry, command.action, command.value);
            if (popup.isClosed) return true;
            if (command.action === "chat" || command.action === "inline") {
              const selection = browser.highlights!.selection(candidate.entry, command.action, candidate.tab.title || browserFallbackTitle(candidate.tab.url));
              if (selection) {
                browser.selection = selection;
                if (command.action === "chat") { browser.terminalOpen = true; browser.organizationOpen = false; }
                else this.openInlineAnswer(host, candidate.tab, selection, candidate.anchor);
                browser.addressSuggestionsOpen = false;
              }
            }
            popup.close();
            this.layout(host); this.broadcast(host);
            if (command.action !== "inline") candidate.tab.contents.focus();
            return true;
          } catch (error) { this.log(`Web highlight save failed: ${String(error)}`); return false; }
        });
      }
      case "browser-selection-delete": {
        const tab = senderTab;
        if (!tab?.browser?.highlights || tab.browser.selection?.reference?.id !== command.id ||
            tab.browser.selection.url !== command.url) return false;
        return tab.browser.highlights.erase(command.id, command.url).then(() => {
          if (tab.browser?.selection?.reference?.id === command.id) {
            if (host.inlineAnswer?.selection.reference?.id === command.id) host.inlineAnswer.close();
            tab.browser.selection = undefined;
            this.broadcast(host);
          }
          return true;
        }, () => false);
      }
      case "browser-answer-ready": {
        if (host.inlineAnswer?.contents !== sender) return false;
        host.inlineAnswer.connect(); return true;
      }
      case "browser-answer-state": {
        const answer = host.inlineAnswer;
        if (!senderTab || answer?.ownerId !== senderTab.id || answer.selection.requestId !== command.state.requestId ||
            answer.selection.reference?.id !== command.state.selectionId) return false;
        answer.update(command.state); return true;
      }
      case "browser-answer-resize": {
        if (host.inlineAnswer?.contents !== sender) return false;
        host.inlineAnswer.resize(command.width, command.height); return true;
      }
      case "browser-answer-move": {
        if (host.inlineAnswer?.contents !== sender) return false;
        host.inlineAnswer.move(command.dx, command.dy); return true;
      }
      case "browser-answer-action": {
        const answer = host.inlineAnswer;
        if (!answer || answer.contents !== sender || answer.selection.requestId !== command.action.requestId ||
            answer.selection.reference?.id !== command.action.selectionId) return false;
        if (command.action.action === "ask" && answer.state.content.canAsk !== true) return false;
        if (command.action.action === "delete" && answer.state.content.ownerReady !== true) return false;
        const owner = tabById(host, answer.ownerId);
        if (!owner || owner.contents.isDestroyed()) return false;
        if (command.action.action === "close") answer.close();
        else owner.contents.send(IPC_CHANNELS.browserInlineAnswerAction, command.action);
        return true;
      }
      case "browser-selection-conversation": {
        const tab = senderTab;
        if (!tab?.browser?.highlights || tab.browser.selection?.reference?.id !== command.id ||
            tab.browser.selection.url !== command.url) return false;
        return tab.browser.highlights.bindConversation(command.id, command.url, command.conversationId).then(() => {
          if (tab.browser?.selection?.reference?.id === command.id) {
            tab.browser.selection.conversationId = command.conversationId;
            this.broadcast(host);
          }
          return true;
        }, () => false);
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
        if (!tab || !this.toolbarShellUrl(tab)) return false;
        const browser = liveBrowserPage(tab.browser);
        const menuOwner = tab.browser ?? tab;
        const menu = Menu.buildFromTemplate(browserMenuTemplate({
          profileLabel: command.profileLabel, hasPage: Boolean(browser && !tab.browser?.showingHome),
          zoomPercent: browser ? Math.round(browser.contents.getZoomFactor() * 100) : 100,
          fullscreen: host.window.isFullScreen(),
        }, action => setImmediate(() => { void this.browserMenuAction(host, tab, action); })));
        menuOwner.menu?.closePopup(host.window);
        menuOwner.menu = menu;
        const anchor = this.toolbarAnchor(tab, command);
        const [width = 1200, height = 800] = host.window.getContentSize();
        return new Promise<boolean>(resolve => menu.popup({
          window: host.window, x: Math.min(width - 1, Math.round(anchor.x)), y: Math.min(height - 1, Math.round(anchor.y)),
          callback: () => { if (menuOwner.menu === menu) menuOwner.menu = undefined; resolve(true); },
        }));
      }
      case "browser-find":
      case "browser-find-close": {
        const tab = senderTab;
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
          void this.searchPage(host, target, command, target === tab);
        }
        return true;
      }
      case "browser-organization-selection": {
        const candidate = host.selectionCandidate;
        if (host.selectionPopover?.contents !== sender || !candidate || candidate.tab.id !== host.activeId) return false;
        const browser = candidate.tab.browser;
        if (!browser) return false;
        const target = normalizeAnnotationTarget({ kind: "text", url: candidate.tab.url, title: candidate.tab.title,
          quote: candidate.entry.quote, prefix: candidate.entry.prefix, suffix: candidate.entry.suffix });
        return target ? this.openBrowserOrganization(host, candidate.tab, target) : false;
      }
      case "browser-organization-target": {
        const tab = senderTab;
        const target = normalizeAnnotationTarget(command.target);
        if (!tab?.browser || !target || annotationPageUrl(tab.url) !== target.url) return false;
        return this.openBrowserOrganization(host, tab, target);
      }
      case "browser-organization-markers": {
        const tab = senderTab;
        if (!tab?.browser || !this.browserOrganizationAllowed(host, tab)) return false;
        const url = annotationPageUrl(tab.url);
        const items = command.items.flatMap(item => {
          const target = normalizeAnnotationTarget(item.target);
          return target?.url === url ? [{ id: item.id, target }] : [];
        });
        tab.browser.annotationMarkers = items;
        if (tab.browser.contents && !tab.browser.contents.isDestroyed()) void tab.browser.contents.executeJavaScript(browserAnnotationPaintScript(items)).catch(() => undefined);
        return true;
      }
      case "browser-organization": {
        const tab = senderTab;
        if (!tab?.browser || !this.browserOrganizationAllowed(host, tab)) return false;
        tab.browser.organizationOpen = command.open;
        if (command.open) { tab.browser.terminalOpen = false; tab.browser.addressSuggestionsOpen = false; }
        this.layout(host); this.broadcast(host);
        if (command.open) tab.contents.focus();
        return true;
      }
      case "browser-terminal": {
        const tab = senderTab;
        if (!tab?.browser) return false;
        tab.browser.terminalOpen = command.open;
        if (command.open) tab.browser.organizationOpen = false;
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
        if (host.activeId !== tab.id || host.tabDragActive) return true;
        if (command.open) tab.contents.focus();
        else {
          const browser = liveBrowserPage(tab.browser);
          if (browser?.attached) browser.contents.focus();
        }
        return true;
      }
      case "browser-address-suggestions": {
        const tab = senderTab;
        if (!tab?.browser) return false;
        const bottom = command.open ? command.bottom : undefined;
        if (tab.browser.addressSuggestionsOpen === command.open && tab.browser.suggestionsBottom === bottom) return true;
        tab.browser.addressSuggestionsOpen = command.open;
        tab.browser.suggestionsBottom = bottom;
        // The shared toolbar can belong to the browser beside an active local
        // pane. Its dropdown still needs native bounds above the website.
        if (host.activeId === tab.id || this.toolbarTab(host) === tab) this.layout(host);
        return true;
      }
      case "browser-adblock-enabled":
      case "browser-adblock-site-enabled": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = popup ? tabById(host, popup.ownerId) : senderTab;
        if (!tab?.browser || tab.id !== host.activeId || typeof command.enabled !== "boolean") return false;
        const targetSession = session.fromPartition(tab.browser.privatePartition ?? BROWSER_SESSION_PARTITION);
        if (command.type === "browser-adblock-enabled") return this.browserAdBlocker.setEnabled(command.enabled, targetSession);
        if (tab.browser.showingHome) return false;
        // Bind to the displayed site so a navigation cannot apply a stale toggle
        // to a different host while the popover is open.
        if (command.site !== this.browserAdBlocker.snapshot(undefined, tab.url, targetSession).site) return false;
        return this.browserAdBlocker.setSiteEnabled(tab.url, command.enabled, targetSession);
      }
      case "browser-extension-load": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = popup ? tabById(host, popup.ownerId) : senderTab;
        if (!tab?.browser) return false;
        return popup ? popup.keepOpenDuring(() => this.loadBrowserExtension(host, tab)) : this.loadBrowserExtension(host, tab);
      }
      case "browser-extension-action": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = popup ? tabById(host, popup.ownerId) : senderTab;
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
        const tab = popup ? tabById(host, popup.ownerId) : senderTab;
        return tab?.browser
          ? this.reloadBrowserExtension(tab, command.id)
          : false;
      }
      case "browser-extension-remove": {
        const popup = host.extensionsPopover?.contents === sender ? host.extensionsPopover : undefined;
        const tab = popup ? tabById(host, popup.ownerId) : senderTab;
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
      highlighted: tab.highlighted,
      keepLoaded: tab.keepLoaded,
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
      host.selectionPopover?.close(); host.inlineAnswer?.close();
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
      case "highlight":
        tab.highlighted = !tab.highlighted;
        this.broadcast(host);
        this.flushSession();
        return;
      case "keep-loaded":
        tab.keepLoaded = !tab.keepLoaded;
        this.flushSession();
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
    if (!target.contents.isDestroyed()) {
      target.contents.stopFindInPage("clearSelection");
      void target.contents.executeJavaScript(`window[Symbol.for('breadboard:document-find')]?.(null)`)
        .catch(() => undefined);
    }
  }

  private async searchPage(host: Host, target: PageFindState & { contents: WebContents },
    command: Extract<TabsCommand, { type: "browser-find" }>, localPage: boolean): Promise<void> {
    const continuing = target.findQuery === command.text && target.findRequestId !== undefined;
    target.findQuery = command.text;
    // Negative IDs cannot collide with Chromium's native find request IDs.
    const requestId = --this.documentFindRequestId;
    target.findRequestId = requestId;
    target.find = undefined;
    if (localPage) {
      try {
        const result = await target.contents.executeJavaScript(`(async () => {
          const find = window[Symbol.for('breadboard:document-find')];
          return typeof find === 'function' ? { result: await find(${JSON.stringify(command)}) } : null;
        })()`);
        if (target.contents.isDestroyed() || target.findRequestId !== requestId) return;
        if (result) {
          if (result.result) {
            target.find = { ...result.result, query: command.text, requestId, finalUpdate: true };
            this.broadcast(host);
          }
          return;
        }
      } catch {
        // A navigation may replace the document while its search is pending.
        if (target.contents.isDestroyed() || target.findRequestId !== requestId) return;
      }
    }
    // Electron's findNext starts a session; our command advances an existing one.
    target.findRequestId = target.contents.findInPage(command.text, {
      forward: command.forward !== false, findNext: command.findNext !== true || !continuing,
    });
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
    if (host.window.isDestroyed() || tab.contents.isDestroyed() || !host.tabs.includes(tab)) return;
    const shellUrl = this.toolbarShellUrl(tab);
    if (!shellUrl) return;
    const menuOwner = tab.browser ?? tab;
    const browser = liveBrowserPage(tab.browser);
    const page = browser && !tab.browser?.showingHome ? browser.contents : null;
    const internal = (pathname: string) => this.openTab(host, new URL(pathname, shellUrl).toString(), { background: false, origin: "link", from: tab });
    try {
      switch (action) {
        case "picture-in-picture":
          if (page && !tab.browser?.privatePartition && this.googlePipExtension?.state(GOOGLE_PIP_EXTENSION_ID)) {
            await this.googlePipExtension.activate(page);
            return;
          }
          if (page && !await toggleBrowserPictureInPicture(page)) {
            this.publishNotificationToast(tab.contents, { type: "error", message: "No video is ready for Picture in Picture on this page. Start a video and try again." });
          }
          return;
        case "profile": internal("/settings"); return;
        case "settings": internal("/browser/settings"); return;
        case "appearance": internal("/browser/settings?section=appearance"); return;
        case "new-tab": this.openBrowserTab(host); return;
        case "new-window": this.options.openWindow(shellUrl, Boolean(tab.browser?.privatePartition || host.privateBrowsing)); return;
        case "new-private-tab": this.openBrowserTab(host, undefined, false, undefined, undefined, undefined, this.privateBrowserPartition()); return;
        case "new-private-window": this.options.openWindow(shellUrl, true); return;
        case "find": this.requestFind(host, tab); return;
        case "history": case "visited-pages": case "bookmarks": case "downloads":
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
            { label: this.googlePipExtension?.state(GOOGLE_PIP_EXTENSION_ID) && !tab.browser?.privatePartition ? "Picture in Picture (Google)" : "Picture in Picture (Built-in)", enabled: Boolean(page), accelerator: "Alt+P", registerAccelerator: false,
              click: () => { void this.browserMenuAction(host, tab, "picture-in-picture"); } },
            { type: "separator" as const },
            ...extensions.map(extension => ({ label: extension.name.replace(/&/g, "&&"), submenu: [
              ...(extension.action ? [
                { label: "Open", enabled: Boolean(page) && !tab.browser?.privatePartition, click: () => run(async () => { await this.googlePipExtension!.activate(page); return true; }) },
                ...extension.action.menus.map(item => ({ label: item.title, ...(item.checked === undefined ? {} : {type: "checkbox" as const, checked:item.checked}),
                  enabled: Boolean(page) && !tab.browser?.privatePartition, click: () => run(async () => { await this.googlePipExtension!.activate(page, item.id); return true; }) })),
                { type: "separator" as const },
              ] : []),
              { label: "Reload", click: () => run(() => this.reloadBrowserExtension(tab, extension.id)) },
              { label: "Remove", click: () => run(() => this.removeBrowserExtension(tab, extension.id)) },
            ] })),
            ...(extensions.length ? [{ type: "separator" as const }] : []),
            { label: "Load Unpacked Extension…", click: () => run(() => this.loadBrowserExtension(host, tab)) },
            { label: "Chrome Web Store", click: () => { this.openBrowserTab(host, "https://chromewebstore.google.com/"); } },
          ]);
          menuOwner.menu = menu;
          menu.popup({ window: host.window, callback: () => { if (menuOwner.menu === menu) menuOwner.menu = undefined; } });
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

  private zoomTab(host: Host, tab: Tab, direction: "in" | "out" | "reset"): void {
    const contents = this.navigationContents(tab);
    if (host.window.isDestroyed() || contents.isDestroyed()) return;
    if (tab.browser) { this.zoomBrowserPage(host, contents, direction); return; }
    const level = contents.getZoomLevel();
    contents.setZoomLevel(direction === "reset" ? 0 : level + (direction === "in" ? 0.5 : -0.5));
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
    const candidate = this.hostByContents.get(sender.id);
    const host = candidate && !candidate.window.isDestroyed() ? candidate : undefined;
    if (host?.shell?.contents === sender) return this.shellState(host);
    return host
      ? this.stateForTab(host, host.preparedNewTab?.contents.id === sender.id ? host.preparedNewTab
        : [...host.tabs, ...host.retainedTabControls].find((tab) => tab.contents.id === sender.id))
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
      host.selectionPopover?.close(); host.inlineAnswer?.close();
    const popup = new BrowserToolbarPopover(host.window, tab.id,
      { x: command.x + 280, y: command.y }, path.join(__dirname, "../preload/tab-group-preload.js"),
      [tab.contents, ...(host.shell ? [host.shell.contents] : []), ...(tab.browser?.contents ? [tab.browser.contents] : [])], () => {
        this.hostByContents.delete(popup.contents.id);
        if (host.groupPopover === popup) host.groupPopover = undefined;
      }, 280);
    host.groupPopover = popup;
    this.hostByContents.set(popup.contents.id, host);
    // A context menu must not wait for the dashboard route and its providers to
    // hydrate. Like the tab strip, it runs from the bundled desktop assets.
    popup.contents.ipc.handle("breadboard:group-state", event =>
      event.senderFrame === popup.contents.mainFrame ? this.stateFor(popup.contents) : null);
    popup.contents.ipc.handle("breadboard:group-command", (event, value: unknown) => {
      if (event.senderFrame !== popup.contents.mainFrame || !isTabsCommand(value) ||
          !["group-update", "group-move", "group-action", "group-menu-resize", "group-menu-close"].includes(value.type)) return false;
      return this.handleCommand(popup.contents, value);
    });
    return popup.contents.loadFile(path.join(__dirname, "../window-shell/tab-group.html"), {
      query: command.groupId ? { group: command.groupId } : {},
    }).then(() => true, error => {
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
          tab.highlighted = entry.highlighted === true;
          tab.keepLoaded = entry.keepLoaded === true;
          members.push(tab);
        }
        const savedTree = [{ ...saved, parentId: undefined }, ...(saved.groups ?? [])];
        const ids = new Map(savedTree.map(group => [group.id, randomUUID()]));
        const groups = savedTree.map(({ id, name, color, collapsed, split, parentId }) => ({
          id: ids.get(id)!, name, color, collapsed, split, parentId: parentId ? ids.get(parentId) : undefined,
        }));
        host.tabs = [...host.tabs.filter(tab => !members.includes(tab)), ...members];
        host.groups.push(...groups);
        for (const [index, tab] of members.entries()) tab.groupId = ids.get(saved.tabs[index]!.groupId ?? saved.id) ?? groups[0]!.id;
        if (members[0]) this.activate(host, members[0].id);
      }
      host.savedGroups = host.savedGroups.filter(group => group.id !== id);
      this.broadcast(host);
      this.flushSession();
      return true;
    }
    const group = host.groups.find(group => group.id === id);
    const members = host.tabs.filter(tab => isInTabGroup(host.groups, tab.groupId, id));
    if (!group) return false;
    if (action === "show-ai-info") {
      if (id !== AI_TAB_GROUP_ID || !this.newTabUrl) return false;
      // Check again in the native owner: a task may have opened a page since
      // the renderer's idle click. Never add an empty-state tab during work.
      if (host.tabs.some(tab => tab.automationRunId ?? tab.browser?.automationRunId)) return false;
      const url = new URL("/ai-tabs", this.newTabUrl).href;
      const existing = host.tabs.find(tab => !tab.browser && isSameTabScreen(tab.url, url));
      const tab = existing ?? this.openTab(host, url, { background: true, origin: "blank" });
      if (!tab) return false;
      tab.groupId = id;
      tab.title = "AI tabs";
      group.collapsed = false;
      this.activate(host, tab.id);
      return true;
    }
    if (id === AI_TAB_GROUP_ID && ["ungroup", "save-close", "new-window"].includes(action)) return false;
    if (!members.length && action !== "new-tab" && action !== "new-subgroup") return false;
    switch (action) {
      case "copy-links":
        clipboard.writeText(members.map(tab => tab.url).filter(Boolean).join("\n"));
        return true;
      case "neutralize": {
        const wasCollapsed = group.collapsed;
        group.collapsed = true;
        if (members.some(tab => tab.id === host.activeId)) {
          const next = host.tabs.find(tab => !isTabGroupHidden(host.groups, tab.groupId));
          if (next) this.activate(host, next.id);
          else if (!this.openBlankTab(host)) { group.collapsed = wasCollapsed; return false; }
        }
        // Keep the outgoing page until its replacement can paint. A selection
        // made during that handoff cancels unloading the newly selected group.
        this.whenRevealed(host, () => {
          if (host.window.isDestroyed() || isInTabGroup(host.groups, tabById(host, host.activeId)?.groupId, id)) return;
          for (const tab of members) {
            if (host.tabs.includes(tab) && isInTabGroup(host.groups, tab.groupId, id)) this.neutralizeTab(host, tab);
          }
          this.broadcast(host);
          this.flushSession();
        });
        break;
      }
      case "new-subgroup":
      case "new-tab": {
        const first = members[0];
        const tab = first?.browser ? this.openBrowserTab(host, undefined, true, undefined, undefined, undefined, first.browser.privatePartition ?? null)
          : this.newTabUrl ? this.openTab(host, this.newTabUrl, { background: true, origin: "blank" }) : null;
        if (!tab) return false;
        let destination = id;
        if (action === "new-subgroup") {
          destination = randomUUID();
          host.groups.push({ id: destination, parentId: id, name: "New subgroup", color: group.color, collapsed: false });
        }
        moveGroupedTab(host, tab.id, members.length ? host.tabs.indexOf(members[members.length - 1]!) + 1 : host.tabs.length - 1, destination);
        this.activate(host, tab.id);
        return true;
      }
      case "ungroup":
        for (const tab of members) if (tab.groupId === id) tab.groupId = group.parentId;
        for (const child of host.groups) if (child.parentId === id) child.parentId = group.parentId;
        host.groups = host.groups.filter(group => group.id !== id);
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
          host.savedGroups.push({ ...group, parentId: undefined, tabs: tabs as SavedTabGroup["tabs"],
            groups: host.groups.filter(child => child.id !== id && isInTabGroup(host.groups, child.id, id)).map(child => ({ ...child })) });
          this.rememberSession(host);
          this.flushSession();
        }
        // Keep the window (and the saved-group entry) available after closing all members.
        if (host.tabs.length === members.length && !this.openBlankTab(host)) return false;
        const replacement = host.tabs.find(tab => !members.includes(tab));
        if (replacement && members.some(tab => tab.id === host.activeId)) this.activate(host, replacement.id);
        for (const tab of members) this.closeTab(host, tab.id);
        break;
      }
    }
    this.broadcast(host);
    this.flushSession();
    return true;
  }

  /** Release documents while keeping the logical tabs for load-on-selection. */
  /** Replace a background tab by an unloaded copy; false when it is in front or already unloaded. */
  private neutralizeTab(host: Host, tab: Tab): boolean {
    const index = tabIndex(host, tab.id);
    if (index < 0 || host.activeId === tab.id) return false;
    const browser = tab.browser;
    if (browser ? !browser.contents && (tab.sharedChrome || tab.deferredUrl) : tab.deferredUrl) return false;

    const replacement = tab.sharedChrome && browser
      ? this.createSharedBrowserTab(host, browser.shellUrl)
      : this.createView(host, browser?.shellUrl ?? tab.url, true, tab.primary || tab === host.base);
    replacement.id = tab.id;
    replacement.generation = tab.generation + 1;
    replacement.title = tab.title;
    replacement.url = tab.url;
    replacement.anchored = tab.anchored;
    replacement.highlighted = tab.highlighted;
    replacement.keepLoaded = tab.keepLoaded;
    replacement.groupId = tab.groupId;
    replacement.automationRunId = tab.automationRunId;
    replacement.authReturnUrl = tab.authReturnUrl;
    replacement.authReturnTitle = tab.authReturnTitle;
    replacement.loading = false;
    if (browser) {
      replacement.browser = {
        uiKey: browser.uiKey,
        uiVisited: browser.uiVisited,
        shellUrl: browser.shellUrl,
        privatePartition: browser.privatePartition,
        automationRunId: browser.automationRunId,
        restoredMediaBlocked: true,
        view: null, contents: null, ready: false, attached: false, onReady: [],
        terminalOpen: browser.terminalOpen,
        terminalWidth: browser.terminalWidth,
        addressSuggestionsOpen: false,
        homeEntryAvailable: browser.homeEntryAvailable,
        showingHome: browser.showingHome,
        homeHistoryIndex: null,
        pendingHomeNavigation: false,
        favicon: browser.favicon,
      };
      if (!browser.showingHome && tab.url) replacement.deferredBrowserUrl = tab.url;
      // The private profile belongs to open tabs, including unloaded ones.
      // Retain it before disposal releases the old document's reference.
      this.retainPrivateProfile(replacement);
    }
    host.tabs[index] = replacement;
    const wasBase = tab === host.base;
    if (wasBase) host.base = replacement;
    tab.recoveryAttempt = undefined;
    tab.recovering = false;
    this.dispose(host, tab);
    // Older windows own their base WebContents directly; those cannot close
    // without closing the window. Release that document on a neutral page.
    if (!tab.view && !tab.contents.isDestroyed()) void tab.contents.loadURL("about:blank").catch(() => undefined);
    if (wasBase) this.options.onBaseReplaced?.(host.window);
    return true;
  }

  /** Unload pages that have sat in the background past {@link idleUnloadDelayMs}.
   * Each renderer process held 2-3 GB after a long session; 44 of them filled
   * Windows commit and crashed the app on 2026-10-19. Unloaded tabs keep their
   * place, title and address and reload when selected. */
  private async unloadIdleTabs(): Promise<void> {
    if (this.unloadingIdleTabs || !this.enabled) return;
    this.unloadingIdleTabs = true;
    try {
      const memory = process.getSystemMemoryInfo();
      // On Windows Chromium reports the commit limit and available commit as swap.
      const freeCommitMb = process.platform === "win32" && memory.swapTotal ? memory.swapFree / 1024 : null;
      const delay = idleUnloadDelayMs(this.memoryPressure, freeCommitMb);
      for (const host of [...this.hosts.values()]) {
        let unloaded = 0;
        const warm = warmBackgroundTabs(host.tabs.filter(tab => !tab.deferredUrl && !tab.deferredBrowserUrl), delay);
        for (const tab of [...host.tabs]) {
          const inFront = () => host.window.isDestroyed() || !host.tabs.includes(tab) || host.activeId === tab.id ||
            host.presentedId === tab.id || host.pending?.id === tab.id || splitMembers(host).includes(tab);
          if (inFront() || warm.has(tab.id) || tab.backgroundSince === undefined || Date.now() - tab.backgroundSince < delay) continue;
          if (!(await this.canUnloadIdleTab(tab)) || inFront()) continue;
          if (this.neutralizeTab(host, tab)) unloaded += 1;
        }
        if (unloaded === 0 || host.window.isDestroyed()) continue;
        this.log(`unloaded ${unloaded} idle background tab(s); free commit ${freeCommitMb === null ? "unknown" : `${Math.round(freeCommitMb)} MB`}`);
        this.broadcast(host);
        this.flushSession();
      }
    } finally {
      this.unloadingIdleTabs = false;
    }
  }

  private async canUnloadIdleTab(tab: Tab): Promise<boolean> {
    if (tab.keepLoaded || tab.automationRunId || tab.browser?.automationRunId || tab.automationPreparing || tab.voiceOverlay ||
        tab.learnActivity?.active || tab.loading || tab.pageLoading || tab.recovering) return false;
    const pages = [tab.sharedChrome ? null : tab.contents, tab.browser?.contents ?? null]
      .filter((contents): contents is WebContents => !!contents && !contents.isDestroyed());
    for (const contents of pages) {
      if (contents.isCurrentlyAudible() || contents.isDevToolsOpened() || await hasUnsavedInput(contents)) return false;
    }
    return true;
  }

  private moveGroupToWindow(source: Host, group: TabGroup, members: Tab[]): boolean {
    if (!this.newTabUrl) return false;
    const tree = source.groups.filter(child => isInTabGroup(source.groups, child.id, group.id))
      .map(child => ({ ...child, ...(child.id === group.id ? { parentId: undefined, collapsed: false } : {}) }));
    const baseMember = members.find(tab => !tab.view);
    const window = this.options.openWindow(baseMember?.url || this.newTabUrl, Boolean(source.privateBrowsing || members[0]?.browser?.privatePartition));
    const target = window && this.hosts.get(window.id);
    if (!target) return false;
    source.groupPopover?.close();
    if (source.tabs.length === members.length && !this.openBlankTab(source)) return false;
    this.cancelReveal(source);
    this.runAfterReveal(source);
    const sharedMembers = members.filter(tab => tab.sharedChrome);
    const moveSharedChrome = sharedMembers.length > 0 && source.tabs.every(tab => !tab.sharedChrome || members.includes(tab));
    if (moveSharedChrome && source.browserChrome) {
      target.browserChrome?.contents.close();
      target.browserChrome = source.browserChrome;
      source.browserChrome = undefined;
      target.browserOwnerKey = source.browserOwnerKey;
    }
    const moved: Tab[] = [];
    for (const tab of members) {
      if (!tab.view) {
        // Electron's window-owned contents cannot be reparented. Reopen that
        // original page; all WebContentsView tabs below retain their live state.
        target.base.groupId = tab.groupId;
        target.base.anchored = tab.anchored;
        target.base.highlighted = tab.highlighted;
        target.base.title = tab.title;
        moved.push(target.base);
      } else {
        this.detach(source.window, tab);
        source.surfaces.forget(tab.id);
        if (tab.sharedChrome && !moveSharedChrome) {
          // The website (including forms, history and media) moves live. A
          // partial group uses the destination window's shared home/panel view.
          const chrome = this.createSharedBrowserTab(target, tab.browser!.shellUrl);
          tab.contents = chrome.contents;
          tab.view = chrome.view;
          tab.loaded = chrome.loaded;
          tab.painted = chrome.painted;
          tab.attached = false;
        }
        tab.id = target.nextId++;
        this.hostByContents.set(tab.contents.id, target);
        if (tab.browser?.contents) this.hostByContents.set(tab.browser.contents.id, target);
        moved.push(tab);
      }
    }
    source.tabs = source.tabs.filter(tab => !members.includes(tab));
    if (members.includes(source.base) && source.base.view) {
      const movedBase = source.base;
      // Keep the actual document in the destination, including unsaved forms.
      // The old window needs only a neutral primary view for future sign-in/recovery.
      source.base = this.createView(source, "about:blank", true, true);
      source.base.deferredUrl = undefined;
      source.baseRetired = true;
      this.options.onBaseReplaced?.(source.window);
      movedBase.contents.on("did-fail-load", (_event, code, _description, url, mainFrame) => {
        if (mainFrame && code !== -3) void this.recover(movedBase, url);
      });
      installRendererRecovery(movedBase.contents, () => { void this.recover(movedBase, movedBase.url, true); });
    }
    target.groups.push(...tree);
    target.tabs = [...moved, ...(baseMember ? [] : [target.base])];
    if (source.tabs[0]) this.activate(source, source.tabs[0].id);
    if (baseMember) this.whenRevealed(source, () => this.retireBase(source));
    if (moved[0]) this.activate(target, moved[0].id);
    this.broadcast(source);
    this.broadcast(target);
    return true;
  }

  /** Browser chrome and the app-owned Terminal share the same toolbar tools. */
  private toolbarShellUrl(tab: Tab): string | null {
    if (tab.browser) return tab.browser.shellUrl;
    if (!this.newTabUrl || !this.browserUrl || tab.contents.isDestroyed()) return null;
    try {
      const current = new URL(tab.contents.getURL());
      const terminal = new URL(this.newTabUrl);
      return current.origin === terminal.origin && current.pathname.replace(/\/$/, "") === terminal.pathname.replace(/\/$/, "")
        ? this.browserUrl : null;
    } catch { return null; }
  }

  private openToolbarPopover(host: Host, tab: Tab, anchor: { x: number; y: number }, kind: "downloads" | "extensions"): Promise<boolean> {
    const shellUrl = this.toolbarShellUrl(tab);
    if (!shellUrl) return Promise.resolve(false);
    host.groupPopover?.close();
    const key = kind === "downloads" ? "downloadsPopover" : "extensionsPopover";
    if (host[key]) return Promise.resolve(true);
    host[kind === "downloads" ? "extensionsPopover" : "downloadsPopover"]?.close();
    const popup = new BrowserToolbarPopover(
      host.window, tab.id, this.toolbarAnchor(tab, anchor), this.options.preloadPath,
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
    const url = new URL(`/browser/${kind}-popover`, shellUrl);
    if (kind === "extensions") url.searchParams.set("theme", this.options.theme());
    return popup.contents.loadURL(url.toString()).then(() => true, error => {
      if (popup.isClosed) return true;
      this.log(`${kind} popover failed: ${String(error)}`);
      popup.close();
      return false;
    });
  }

  private openInlineAnswer(host: Host, tab: Tab, selection: BrowserSelection, anchor: { x: number; y: number; height?: number }): void {
    const browser = liveBrowserPage(tab.browser);
    if (!browser || !selection.reference || !selection.requestId) return;
    host.inlineAnswer?.close();
    const scale = browser.contents.getZoomFactor();
    const answer = new BrowserInlineAnswer(host.window, tab.id, selection, browser.view.getBounds(),
      { x: anchor.x * scale, y: anchor.y * scale, height: (anchor.height ?? 18) * scale }, this.options.preloadPath, () => {
        this.hostByContents.delete(answer.contents.id);
        if (host.inlineAnswer === answer) host.inlineAnswer = undefined;
        if (!tab.contents.isDestroyed()) tab.contents.send(IPC_CHANNELS.browserInlineAnswerAction,
          { requestId: selection.requestId, selectionId: selection.reference!.id, action: "close" });
        if (!browser.contents.isDestroyed()) void browser.contents.executeJavaScript("window.__breadboardHighlights?.track(null)").catch(() => undefined);
      }, browser.highlights?.saved(selection.reference.id)?.note);
    host.inlineAnswer = answer;
    this.hostByContents.set(answer.contents.id, host);
    const url = new URL("/browser/inline-answer", browser.shellUrl); url.searchParams.set("theme", this.options.theme());
    void answer.contents.loadURL(url.href).catch(() => answer.close());
    void browser.contents.executeJavaScript(`window.__breadboardHighlights?.track(${JSON.stringify(selection.reference.id)})`).catch(() => undefined);
  }

  private openSelectionPopover(host: Host, tab: Tab, entry: WebTextHighlight, anchor: { x: number; y: number; height?: number }): void {
    const browser = tab.browser;
    if (!browser?.view || !browser.highlights) return;
    host.selectionPopover?.close(); host.inlineAnswer?.close();
    const bounds = browser.view.getBounds();
    const scale = browser.contents?.getZoomFactor() ?? 1;
    const width = entry.note ? 490 : 440;
    const popup = new BrowserToolbarPopover(host.window, tab.id,
      { x: bounds.x + anchor.x * scale + width, y: Math.max(bounds.y + 8, bounds.y + anchor.y * scale - 52) },
      this.options.preloadPath, [tab.contents, ...(browser.contents ? [browser.contents] : [])],
      () => {
        this.hostByContents.delete(popup.contents.id);
        if (host.selectionPopover === popup) { host.selectionPopover = undefined; host.selectionCandidate = undefined; }
      }, 490);
    host.selectionPopover = popup; host.selectionCandidate = { tab, entry, anchor };
    this.hostByContents.set(popup.contents.id, host);
    const url = new URL("/browser/selection-popover", browser.shellUrl);
    url.searchParams.set("entry", JSON.stringify(entry));
    if (this.browserOrganizationAllowed(host, tab)) url.searchParams.set("community", "1");
    url.searchParams.set("theme", this.options.theme());
    void popup.contents.loadURL(url.href).catch(() => popup.close());
  }

  private toolbarAnchor(tab: Tab, anchor: { x: number; y: number }): { x: number; y: number } {
    // Browser toolbar coordinates already come from the full-window shell.
    // Terminal renders inside its local tab view below the native tab strip.
    const bounds = !tab.browser ? tab.view?.getBounds() : undefined;
    return { x: anchor.x + (bounds?.x ?? 0), y: anchor.y + (bounds?.y ?? 0) };
  }

  /** Only app-owned tabs and their embedded browser pages, never DevTools or
   * unrelated Electron contents. Used by the authenticated Breadboard skill. */
  breadboardUseTargets() {
    return [...this.hosts.values()].filter(host => !host.window.isDestroyed()).flatMap(host =>
      host.tabs.flatMap(tab => {
        const info = { windowId: host.window.id, tabId: tab.id, active: tab.id === host.activeId, focusedWindow: host.window.isFocused(), chrome: tab.contents,
          aiOpened: Boolean(tab.automationRunId ?? tab.browser?.automationRunId) };
        // Shared browser controls describe the selected tab only. Advertising
        // them once per background tab would give one targetId conflicting URLs.
        const targets = [{ ...info, kind: tab.browser ? "chrome" : "app", contents: tab.contents }]
          .filter(() => !tab.sharedChrome || tab.id === host.activeId);
        const browser = liveBrowserPage(tab.browser);
        if (browser && !tab.browser?.showingHome) targets.push({ ...info, kind: "browser", contents: browser.contents! });
        return targets.filter(target => !target.contents.isDestroyed() && /^https?:\/\//i.test(target.contents.getURL()));
      }),
    );
  }

  /** The app-control bridge owns these tabs, without selecting their window or page. */
  openBreadboardUseBrowser(sender: WebContents, url: string | undefined, owner: string): boolean {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed() || !this.enabled) return false;
    return this.openBrowserTab(host, url, true, owner) !== null;
  }

  /** Keep first-party pages in the authenticated app session, in their own AI tab. */
  openBreadboardUseApp(sender: WebContents, url: string, owner: string): boolean {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) return false;
    return this.openTab(host, url, { background: true, origin: "blank", automationRunId: owner }) !== null;
  }

  navigateBreadboardUseBrowser(windowId: number, tabId: number, input: string): boolean {
    const host = this.hosts.get(windowId);
    const tab = host && tabById(host, tabId);
    return Boolean(host && tab?.browser && this.navigateBrowser(host, tab, input));
  }

  /** Give background input and captures a compositor without selecting the page. */
  async prepareBreadboardUseInput(contents: WebContents): Promise<() => void> {
    const previous = this.inspectionPreparations.get(contents);
    if (previous) {
      previous.users++;
      await previous.ready;
      let released = false;
      return () => { if (!released) { released = true; if (--previous.users === 0) previous.release(); } };
    }
    const host = this.hostByContents.get(contents.id);
    const matches = (tab: Tab) => tab.browser?.contents === contents || tab.contents === contents;
    const tab = host?.tabs.find(tab => tab.id === host.activeId && matches(tab)) ?? host?.tabs.find(matches);
    const page = tab?.browser?.contents === contents ? liveBrowserPage(tab.browser) : tab;
    if (!host || !tab || !page?.view || host.window.isDestroyed()) return () => {};
    const view = page.view;
    const selected = host.activeId === tab.id || splitMembers(host).includes(tab);
    // The shared home/controls document is fully covered by the toolbar and
    // website when its panels are closed. Selection alone does not give it a
    // compositor frame; render it in the parking area too.
    const coveredChrome = page === tab && host.shellEnabled && tab.browser &&
      !tab.browser.showingHome && !tab.browser.terminalOpen && !tab.browser.organizationOpen && !tab.voiceOverlay;
    if (page.attached && selected && !coveredChrome) return () => {};
    // Cached background surfaces can still be attached but hidden. Temporarily
    // own their placement so normal layout cannot put them on screen.
    page.attached = false;
    tab.automationPreparing = true;
    const { width, height } = host.window.getContentBounds();
    setViewBounds(view, { x: Math.max(0, width - 2), y: this.preparationTop(host, height) + 1 - height, width: Math.max(1, width), height: Math.max(1, height) });
    host.window.contentView.addChildView(view);
    const throttled = contents.getBackgroundThrottling();
    if (!throttled) contents.setBackgroundThrottling(true);
    view.setVisible(false);
    view.setVisible(true);
    if (!throttled) contents.setBackgroundThrottling(false);
    const releaseFrames = allowBackgroundFrames(contents);
    const preparation = { users: 1, ready: waitForRevealFrame(contents, 1500), release: () => {
      this.inspectionPreparations.delete(contents);
      releaseFrames();
      tab.automationPreparing = false;
      if (!host.window.isDestroyed() && !contents.isDestroyed() && !page.attached) {
        const current = tabById(host, host.activeId);
        if (current?.contents === contents && coveredChrome) {
          current.attached = true;
          this.layout(host);
        } else {
          host.window.contentView.removeChildView(view);
          forgetViewBounds(view);
        }
      }
    } };
    this.inspectionPreparations.set(contents, preparation);
    await preparation.ready;
    let released = false;
    return () => { if (!released) { released = true; if (--preparation.users === 0) preparation.release(); } };
  }

  /** Includes blank/bootstrap pages that do not yet have an inspectable URL. */
  automationTabOwners(): string[] {
    return [...new Set([...this.hosts.values()].filter(host => !host.window.isDestroyed()).flatMap(host =>
      host.tabs.flatMap(tab => {
        const owner = tab.automationRunId ?? tab.browser?.automationRunId;
        return owner ? [owner] : [];
      })))];
  }

  /** Close only this task's pages, including its popups, across all windows. */
  closeAutomationTabs(owner: string): void {
    this.releasedAutomationRuns.add(owner);
    if (this.releasedAutomationRuns.size > 1_000) this.releasedAutomationRuns.delete(this.releasedAutomationRuns.values().next().value!);
    for (const host of this.hosts.values()) {
      if (host.window.isDestroyed()) continue;
      for (const tab of [...host.tabs]) {
        if ((tab.automationRunId ?? tab.browser?.automationRunId) !== owner) continue;
        // Anchoring is the user's existing way to keep a page open.
        if (tab.anchored) {
          delete tab.automationRunId;
          if (tab.browser) delete tab.browser.automationRunId;
          this.broadcast(host);
        }
        else this.closeTab(host, tab.id);
      }
    }
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
    this.browserAdBlocker.attachSession(browserSession);
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
    if (!this.toolbarShellUrl(tab)) return false;
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
    if (!this.toolbarShellUrl(tab)) return false;
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
    if (!this.toolbarShellUrl(tab)) return false;
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
   * Open a link beside its source page, selecting it unless the gesture asks
   * for a background tab. False hands the request back to open as a window.
   */
  openLocalTab(sender: WebContents, url: string, background = false): boolean {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) return false;
    const from = sender === host.browserChrome?.contents ? tabById(host, host.activeId)
      : host.tabs.find((tab) => tab.contents.id === sender.id);
    if (!this.enabled && !from?.automationRunId) return false;
    return this.openTab(host, url, { background, origin: "link", from, showLoader: false }) !== null;
  }

  /** Route a trusted Breadboard page's external web link into its own browser. */
  openExternalTab(sender: WebContents, url: string, background = false): void {
    const host = this.hostByContents.get(sender.id);
    if (!host || host.window.isDestroyed()) {
      this.options.openExternal?.(url);
      return;
    }
    const from = sender === host.browserChrome?.contents ? tabById(host, host.activeId)
      : host.tabs.find(tab => tab.contents === sender || tab.browser?.contents === sender);
    const owner = from?.automationRunId ?? from?.browser?.automationRunId;
    this.openBrowserTab(host, url, background || Boolean(owner), owner, undefined, undefined,
      from?.browser?.privatePartition ?? (host.privateBrowsing ? this.privateBrowserPartition() : null));
  }

  // ------------------------------------------------------------------ state

  private state(host: Host): TabsState {
    const tabs: TabView[] = host.tabs.map((tab) => ({
      id: tab.id,
      generation: tab.generation,
      anchored: tab.anchored,
      aiOpened: Boolean(tab.automationRunId ?? tab.browser?.automationRunId),
      highlighted: tab.highlighted === true,
      ...(tab.groupId ? { groupId: tab.groupId } : {}),
      title: tab.title,
      url: tab.url,
      // Restored tabs have no document yet, but do no work until selected.
      loading: !tab.deferredUrl && (tab.loading || !tab.loaded),
      pageLoading: tab.pageLoading,
      downloadsOpen: host.downloadsPopover?.ownerId === tab.id,
      ...(tab.find ? { find: tab.find } : {}),
      learnActive: !tab.browser && tab.learnActivity?.active === true &&
        new URL(tab.url).pathname.replace(/\/$/, "") === tab.learnActivity.pathname,
      ...(tab.browser
        ? {
            browser: {
              aiOpened: Boolean(tab.browser.automationRunId),
              private: Boolean(tab.browser.privatePartition),
              adBlock: this.browserAdBlocker.snapshot(
                liveBrowserPage(tab.browser)?.contents,
                tab.browser.showingHome ? "" : tab.url,
                session.fromPartition(tab.browser.privatePartition ?? BROWSER_SESSION_PARTITION),
              ),
              uiKey: tab.browser.uiKey,
              // The run marker only exists so the worker can select this exact
              // Chromium target. It is not an address the person can use, so
              // keep the trusted toolbar looking like an ordinary fresh tab.
              address:
                tab.browser.automationRunId &&
                isBrowserAgentBootstrapUrl(tab.url, tab.browser.automationRunId)
                  ? ""
                  : tab.url,
              pageReady: tab.browser.ready && !tab.browser.showingHome,
              uiVisited: tab.browser.uiVisited,
              canGoBack:
                !tab.browser.showingHome &&
                (tab.browser.homeEntryAvailable ||
                  this.browserNavigationTarget(tab, "back") !== null),
              canGoForward: tab.browser.showingHome
                ? this.browserHomeForwardAvailable(tab)
                : this.browserNavigationTarget(tab, "forward") !== null,
              terminalOpen: tab.browser.terminalOpen,
              organizationOpen: tab.browser.organizationOpen === true,
              annotationTarget: tab.browser.annotationTarget,
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
      enabled: this.enabled && !(this.authenticationUrl && !this.authenticatedUser),
      windowFocused: host.window.isFocused(),
      activeId: host.activeId,
      presentedId: host.presentedId,
      visibleId: this.visibleTab(host)?.id ?? null,
      presentationRevision: host.presentationRevision,
      presentationStatus: host.presentationStatus,
      persistentShell: host.shellEnabled,
      contentHeight: host.window.getContentSize()[1],
      theme: this.options.theme(),
      browserOwnerKey: host.browserOwnerKey,
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
    ensureAiTabGroup(host);
    if (this.restoringSession) positionAiTabGroup(host);
    else normalizeTabGroups(host);
    const splitKey = splitMembers(host).map(tab => tab.id).join(":");
    if (host.splitLayoutKey !== splitKey) {
      host.splitLayoutKey = splitKey;
      this.layout(host);
      this.syncBrowser(host);
    }
    const state = this.state(host);
    if (host.shell) this.send(host.shell.contents, this.shellState(host, state));
    const sent = new Set<number>();
    for (const tab of host.tabs) {
      if (!sent.has(tab.contents.id) && (tab.sharedChrome || splitMembers(host).includes(tab) || tab.id === host.activeId || tab.id === host.presentedId || tab.id === host.notifiedActiveId)) {
        sent.add(tab.contents.id);
        this.send(tab.contents, this.stateForTab(host, tab, state));
      }
    }
    host.notifiedActiveId = host.activeId;
    // Persist and wake unrelated pages outside the input-to-presentation path.
    if (!host.backgroundBroadcast) {
      host.backgroundBroadcast = setTimeout(() => this.flushBackgroundBroadcast(host), 100);
      host.backgroundBroadcast.unref();
    }
    for (const tab of host.retainedTabControls) this.send(tab.contents, this.stateForTab(host, tab, state));
    if (host.preparedNewTab) this.send(host.preparedNewTab.contents, this.stateForTab(host, host.preparedNewTab, state));
    this.scheduleNewTabPreparation(host);
    if (host.extensionsPopover) this.send(host.extensionsPopover.contents, state);
    if (host.selectionPopover) this.send(host.selectionPopover.contents, state);
    if (host.groupPopover) this.send(host.groupPopover.contents, state);
    const findOwner = host.findBar && tabById(host, host.findBar.ownerId);
    if (findOwner) host.findBar?.update(this.findTarget(findOwner)?.find);
  }

  private flushBackgroundBroadcast(host: Host): void {
    clearTimeout(host.backgroundBroadcast);
    host.backgroundBroadcast = undefined;
    if (host.window.isDestroyed()) return;
    this.rememberSession(host);
    const latest = this.state(host);
    for (const tab of host.tabs) {
      if (!tab.sharedChrome && tab.id !== host.activeId && tab.id !== host.presentedId) this.send(tab.contents, this.stateForTab(host, tab, latest));
    }
  }

  private stateForTab(host: Host, tab: Tab | undefined, state = this.state(host)): TabsState {
    if (tab?.sharedChrome) return { ...state, selfId: host.activeId };
    if (tab && host.retainedTabControls.has(tab)) {
      return { ...state, selfId: null, navigationPending: host.pending !== null };
    }
    // A reveal belongs to the outgoing page and its destination. Starting the
    // bar in every background renderer leaves a completion animation waiting
    // when the user switches back to an otherwise fully loaded website.
    const outgoing = (host.presentedId === null ? null : tabById(host, host.presentedId)) ?? host.base;
    return {
      ...state,
      selfId: tab?.id ?? null,
      preparingNewTab: !!tab && tab === host.preparedNewTab,
      navigationPending: state.navigationPending === true &&
        (tab === host.pending || tab === outgoing),
    };
  }

  private send(contents: WebContents, state: TabsState): void {
    if (contents.isDestroyed()) return;
    try {
      // WebContents survives a renderer crash. During recovery, loading events
      // can broadcast before its main frame has been replaced. Electron catches
      // and prints errors from frame.send internally, so our catch cannot guard
      // that path: check the exact frame we send to before entering Electron.
      if (contents.isCrashed()) return;
      const frame = contents.mainFrame;
      if (!frame || frame.isDestroyed()) return;
      frame.send(IPC_CHANNELS.tabsState, state);
    } catch (error) {
      // Reading mainFrame can also fail during teardown. DOM readiness and
      // subsequent state changes broadcast the latest state to the new page.
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
    if (!host.surfaces.canPrewarm) return;
    if (this.authenticationUrl && !this.authenticatedUser) return;
    if (!this.enabled || this.sessionFrozen || !this.newTabUrl || host.privateBrowsing ||
        host.window.isDestroyed() || host.preparedNewTab || host.prepareNewTabTimer || host.pending ||
        (host.newTabPreparationFailed && !host.newTabPreparationRetryAt)) return;
    const active = tabById(host, host.activeId);
    if (!active?.loaded || active.browser?.privatePartition || !isTabPageUrl(this.options.allowed, active.browser?.shellUrl ?? active.url)) return;
    if (new URL(active.browser?.shellUrl ?? active.url).pathname.startsWith("/auth/")) return;
    // Give the page the person just opened priority over preparing its successor.
    host.prepareNewTabTimer = setTimeout(() => {
      host.prepareNewTabTimer = undefined;
      if (host.pending || host.window.isDestroyed()) return;
      void this.prepareNewTab(host).catch(error => {
        this.retryNewTabPreparation(host);
        this.log(`new tab preparation failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, Math.max(500, (host.newTabPreparationRetryAt ?? 0) - Date.now()));
    host.prepareNewTabTimer.unref();
  }

  /** A temporary load/readiness failure must not disable the fast path until
   * the person opens another cold tab. Retain the single-spare/memory limits. */
  private retryNewTabPreparation(host: Host): void {
    host.newTabPreparationFailed = true;
    host.newTabPreparationRetryAt = Date.now() + 5_000;
    this.discardPreparedNewTab(host);
    this.scheduleNewTabPreparation(host);
  }

  private async prepareNewTab(host: Host): Promise<void> {
    if (!host.surfaces.canPrewarm) return;
    const url = this.newTabUrl;
    if (!url || !this.enabled || this.sessionFrozen || host.privateBrowsing ||
        host.preparedNewTab || host.window.isDestroyed()) return;
    const active = tabById(host, host.activeId);
    if (!active?.loaded || active.browser?.privatePartition ||
        !isTabPageUrl(this.options.allowed, active.browser?.shellUrl ?? active.url) ||
        new URL(active.browser?.shellUrl ?? active.url).pathname.startsWith("/auth/")) return;
    let previousFocus = webContents.getFocusedWebContents();
    const tab = this.createView(host, url);
    host.preparedNewTab = tab;
    const current = () => host.preparedNewTab === tab && !host.window.isDestroyed() && !tab.contents.isDestroyed();
    // Windows can focus an offscreen WebContentsView as its document loads.
    // Only a deliberate activation may give the spare keyboard focus.
    // Preparation can outlast the click from the tab strip into Search. Follow
    // that newer focus instead of returning to the strip captured at startup.
    const focusTargets = [...new Set([active.contents, liveBrowserPage(active.browser)?.contents, host.shell?.contents])]
      .filter((contents): contents is WebContents => Boolean(contents && !contents.isDestroyed()));
    const focusListeners = focusTargets.map(contents => {
      const remember = () => { if (host.activeId === active.id) previousFocus = contents; };
      contents.on("focus", remember);
      return () => contents.removeListener("focus", remember);
    });
    let restoreFocusTask: ReturnType<typeof setImmediate> | undefined;
    const stopRestoringFocus = () => {
      tab.contents.removeListener("focus", scheduleRestoreFocus);
      if (restoreFocusTask) clearImmediate(restoreFocusTask);
      restoreFocusTask = undefined;
      for (const remove of focusListeners) remove();
    };
    const restoreFocus = () => {
      if (!current() || !host.window.isFocused()) return;
      const focused = webContents.getFocusedWebContents();
      if (focused && focused !== tab.contents) return;
      const foreground = tabById(host, host.activeId);
      const target = foreground === active && previousFocus && !previousFocus.isDestroyed()
        ? previousFocus
        : liveBrowserPage(foreground?.browser)?.contents ?? foreground?.contents;
      if (target && !target.isDestroyed()) target.focus();
    };
    const scheduleRestoreFocus = () => {
      if (restoreFocusTask) return;
      // Windows finishes assigning focus after emitting this native event.
      // Refocusing synchronously is overwritten when the spare's navigation
      // commits. Defer one event-loop turn and honor any newer user focus.
      restoreFocusTask = setImmediate(() => {
        restoreFocusTask = undefined;
        restoreFocus();
      });
    };
    tab.contents.on("focus", scheduleRestoreFocus);
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") {
      stopRestoringFocus();
      this.discardPreparedNewTab(host);
      return;
    }
    setViewBounds(tab.view!, offscreenBounds(width, height, this.preparationTop(host, height)));
    host.window.contentView.addChildView(tab.view!);
    tab.attached = true;
    tab.view!.setVisible(true);
    const preparation = new AbortController();
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        (async () => {
          if (!tab.loaded) await this.waitForDocument(tab.onLoaded, preparation.signal);
          if (!current() || tab.contents.getURL() !== url) return false;
          await waitForTabChrome(tab.contents, current);
          if (!current()) return false;
          // A widget read can take longer than one frame/readiness probe. Keep
          // preparing within the overall budget instead of throwing the spare
          // away after the first 1.5-second probe.
          while (current() && !preparation.signal.aborted && tab.contents.getURL() === url && !tab.recovering) {
            if (await this.frameReady(tab, preparation.signal)) return current() && !preparation.signal.aborted;
          }
          return false;
        })(),
        new Promise<false>(resolve => { ceiling = setTimeout(() => resolve(false), 30_000); }),
      ]);
      if (!current()) return; // Already claimed or disposed; the foreground owns it now.
      if (!ready) {
        this.retryNewTabPreparation(host);
        return;
      }
      host.newTabPreparationFailed = false;
      host.newTabPreparationRetryAt = undefined;
      tab.painted = true;
      this.detach(host.window, tab);
    } catch (error) {
      if (current()) {
        this.retryNewTabPreparation(host);
      }
      this.log(`new tab preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      preparation.abort();
      if (ceiling) clearTimeout(ceiling);
      stopRestoringFocus();
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
    host.newTabPreparationRetryAt = undefined;
    return this.openTab(host, url, { background: false, origin: "blank" }) !== null;
  }

  /** A view with a hardened page loading `url`, tracked but not yet a tab. */
  private createView(host: Host, url: string, deferred = false, primary = false): Tab {
    const view = new WebContentsView({
      webPreferences: tabRendererWebPreferences(this.options.preloadPath),
    });
    view.setBackgroundColor(backgroundColorForTheme(this.options.theme()));
    const tab: Tab = {
      generation: 0,
      primary,
      id: host.nextId++,
      anchored: false,
      view,
      contents: view.webContents,
      title: "",
      url,
      loading: !deferred,
      ...(deferred ? { deferredUrl: url } : {}),
      backgroundSince: Date.now(),
      loaded: false,
      onLoaded: [],
      painted: false,
      spawned: 0,
      recovering: false,
      attached: false,
    };
    hardenWebContents(view.webContents, this.options.allowed, {
      onOpenLocalWindow: (target) => {
        if (tab.automationRunId) this.openLocalTab(view.webContents, target, true);
        else this.options.openWindow(target);
      },
      onOpenLocalTab: (target, background) => this.openLocalTab(view.webContents, target, background),
      onOpenExternalTab: (target, background) =>
        this.openExternalTab(view.webContents, target, background),
    });
    // Load the document independently. Presentation attaches its first surface;
    // the bounded LRU can retain that surface for subsequent selections.
    this.track(host, tab);
    this.layout(host);
    // Not attached yet: start hidden, so a tab that loads in the background is
    // throttled like one that was left. Selection shows it.
    if (!tab.attached) this.hideBackgroundView(host, view, view.webContents);
    if (!deferred) void view.webContents.loadURL(url).catch(() => undefined);
    return tab;
  }

  private openTab(
    host: Host,
    url: string,
    options: { background: boolean; origin: "link" | "blank"; from?: Tab; showLoader?: boolean; deferred?: boolean; automationRunId?: string },
  ): Tab | null {
    if (host.window.isDestroyed() || !isTabPageUrl(this.options.allowed, url)) return null;
    const owner = options.automationRunId ?? options.from?.automationRunId ?? options.from?.browser?.automationRunId;
    if (owner && this.releasedAutomationRuns.has(owner)) return null;
    const tab = (options.origin === "blank" && !options.deferred ? this.takePreparedNewTab(host, url) : undefined)
      ?? this.createView(host, url, options.deferred);
    tab.automationRunId = owner;
    if (tab.automationRunId && tab.view) {
      const { width, height } = host.window.getContentBounds();
      tab.view.setBounds({ x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) });
    }

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
    if (tab.automationRunId) tab.groupId = ensureAiTabGroup(host).id;
    host.tabs.splice(index, 0, tab);

    if (options.background || tab.automationRunId) this.broadcast(host);
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
    const origin = this.authenticationUrl ?? this.sessionDashboardUrl;
    if (origin && (isAuthenticationUrl(url, origin) || isAuthenticationUrl(tab.browser?.shellUrl ?? tab.url, origin))) return true;
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
    // Preserve CSS-pixel precision until layout converts to native bounds.
    overlay.width = size.width;
    overlay.height = size.height;
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

  private createSharedBrowserTab(host: Host, url: string): Tab {
    let chrome = host.browserChrome;
    if (!chrome || chrome.contents.isDestroyed()) {
      chrome = this.createView(host, url);
      chrome.sharedChrome = true;
      host.browserChrome = chrome;
      const contents = chrome.contents;
      contents.on("dom-ready", () => {
        const owner = this.hostByContents.get(contents.id);
        for (const tab of owner?.tabs ?? []) {
          if (tab.contents !== contents) continue;
          tab.loaded = true;
          for (const resume of tab.onLoaded.splice(0)) resume();
          if (owner) this.prepareBrowserDocument(owner, tab);
        }
        // Reloading the shared document has no logical tab of its own to
        // reveal. Restore its frame flags explicitly, without parking or
        // reloading the independent website that is already on screen.
        if (!owner || owner.pending || owner.browserChrome?.contents !== contents) return;
        const document = owner.browserChrome;
        const generation = document.generation;
        const active = tabById(owner, owner.activeId);
        if (active?.contents !== contents) return;
        void waitForRevealFrame(contents, 1500).then(ready => {
          if (!ready || owner.window.isDestroyed() || document.generation !== generation ||
              owner.browserChrome !== document || owner.pending) return;
          document.painted = true;
          for (const tab of owner.tabs) if (tab.contents === contents) tab.painted = true;
          this.layout(owner);
          this.syncBrowser(owner);
          this.broadcast(owner);
        });
      });
    }
    // One home/panel document per window. Each website retains its own isolated
    // native document and history, but no longer allocates a toolbar renderer.
    return { ...chrome, id: host.nextId++, generation: 0, onLoaded: [], browser: undefined,
      sharedChrome: true, attached: host.window.contentView.children.includes(chrome.view!),
      title: "", url, loading: false, spawned: 0 };
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
    { deferred = false, restored = false, notificationBackground = false }:
      { deferred?: boolean; restored?: boolean; notificationBackground?: boolean } = {},
  ): Tab | null {
    automationRunId ??= replace?.automationRunId ?? replace?.browser?.automationRunId;
    if (automationRunId && this.releasedAutomationRuns.has(automationRunId)) return null;
    const shellUrl = this.browserUrl;
    const initialUrl = requestedUrl === undefined ? null : browserUrlForInput(requestedUrl);
    if (requestedUrl !== undefined && !initialUrl) return null;
    if (!this.enabled || !shellUrl || host.window.isDestroyed()) {
      if (initialUrl) this.options.openExternal?.(initialUrl);
      return null;
    }

    if (replace && !this.allowTabNavigation(replace, shellUrl)) return null;
    if (initialUrl && !replace && !popup && !automationRunId && !privatePartition && !deferred) {
      for (const [contents, entry] of this.backgroundNotificationTabs) {
        if (entry.host === host && entry.tab.url === initialUrl) {
          const retained = this.restoreNotificationTab(contents, background);
          if (retained) return retained;
        }
      }
    }
    const tab = host.shell ? this.createSharedBrowserTab(host, shellUrl) : this.createView(host, shellUrl, deferred);
    // The toolbar and recents paint above the native page when the omnibox
    // is open; the rest of this renderer must allow that page to show through.
    tab.view?.setBackgroundColor(host.shell ? backgroundColorForTheme(this.options.theme()) : "#00000000");
    tab.anchored = replace?.anchored ?? false;
    tab.highlighted = replace?.highlighted;
    tab.keepLoaded = replace?.keepLoaded;
    tab.groupId = replace?.groupId;
    if (automationRunId) tab.groupId = ensureAiTabGroup(host).id;
    tab.browser = {
      uiKey: randomUUID(),
      restoredMediaBlocked: restored && Boolean(initialUrl),
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

    if (notificationBackground && initialUrl) {
      // Register before loadURL: the preload must see a background receiver
      // from its first script, with audio, device prompts and popups blocked.
      this.ensureBrowserPage(host, tab);
      if (!this.retainNotificationTab(host, tab, initialUrl)) {
        this.dispose(host, tab);
        return null;
      }
      this.navigateBrowser(host, tab, initialUrl);
      return tab;
    }

    const replaceIndex = replace ? tabIndex(host, replace.id) : -1;
    if (replace && replaceIndex >= 0) {
      this.retainTabControls(host, replace);
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
    } else if (initialUrl) {
      if (deferred) { tab.url = initialUrl; tab.deferredBrowserUrl = initialUrl; }
      else this.navigateBrowser(host, tab, initialUrl);
    }
    if (background) this.broadcast(host);
    else {
      // Opening a website is navigation even when the link requests a new
      // tab. Retain the outgoing page and its bar until that website is ready.
      this.activate(host, tab.id, !replace && !initialUrl && !popup);
      if (replace && replaceIndex >= 0) {
        if (replace.view && replace !== host.base) {
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
        ...(browser.restoredMediaBlocked ? {
          autoplayPolicy: "document-user-activation-required" as const,
          additionalArguments: ["--breadboard-restored-media"],
        } : {}),
      },
    });
    // Adopted popup contents already exist; a session change alone cannot update them.
    view.webContents.setUserAgent(userAgent);
    view.setBackgroundColor(browserPageBackgroundColor(this.options.theme()));
    // Background automation still needs a real viewport for layout and input.
    // Size the unattached view without putting it in front of the user's page.
    if (browser.automationRunId) {
      const { width, height } = host.window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) });
    }
    browser.view = view;
    browser.contents = view.webContents;
    this.browserAdBlocker.attachPage(browser.contents, Boolean(browser.privatePartition));
    // The preload asks before page scripts run, including after redirects or
    // reloads. Once the person interacts, later documents need no restore guard.
    browser.contents.ipc.on("breadboard:restored-media-blocked", event => {
      event.returnValue = browser.restoredMediaBlocked === true;
    });
    browser.contents.ipc.on("breadboard:restored-media-interaction", () => {
      browser.restoredMediaBlocked = false;
    });
    browser.ready = false;
    browser.attached = false;
    const live = browser as LiveBrowserPage;
    this.trackBrowser(host, tab, live);
    browser.highlights = new BrowserTextHighlights(live.contents, tab.contents, browser.shellUrl, Boolean(browser.privatePartition));
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

  /** Open a background page; a requested sign-in URL is an explicit user handoff. */
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
      if (requestedUrl !== undefined) this.activate(host, existing.id);
      return requestedUrl === undefined || this.navigateBrowser(host, existing, requestedUrl);
    }
    const targetUrl = browserAgentBootstrapUrl(runId);
    const tab = this.openBrowserTab(host, undefined, requestedUrl === undefined, runId);
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
    microphone?: boolean;
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
    // ChatGPT voice, for as long as ChatMock holds a voice conversation.
    if (options.microphone !== undefined) {
      this.browserNotifications.allowMicrophone(page.contents, CHATGPT_WEB_ORIGIN, options.microphone);
      this.log(`chatgpt-web ${lane} page microphone ${options.microphone ? "allowed" : "withdrawn"}`);
    }
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
    contents.ipc.on("breadboard:web-notification:background", event => { event.returnValue = false; });
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
    if (host.selectionPopover?.ownerId === tab.id) host.selectionPopover.close();
    if (host.inlineAnswer?.ownerId === tab.id) host.inlineAnswer.close();
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
    contents.on("input-event", (_event, input) => {
      if (!["mouseDown", "touchStart", "rawKeyDown", "keyDown"].includes(input.type)) return;
      const owner = current();
      if (owner && !owner.pending && !owner.tabDragActive && !tab.splitPreparation && owner.activeId !== tab.id && browser.ready && splitMembers(owner).includes(tab)) this.activate(owner, tab.id);
    });
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
        annotationsEnabled: this.browserOrganizationAllowed(owner, tab),
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
          comment: async () => {
            const pageUrl = tab.url;
            const captured = await contents.executeJavaScript(browserAnnotationCaptureScript(params.x, params.y, params.mediaType, params.srcURL));
            if (pageUrl !== tab.url || contents.isDestroyed() || revision !== contextRevision || owner.activeId !== tab.id) return;
            const target = normalizeAnnotationTarget({ ...captured, url: pageUrl, title: tab.title,
              ...(params.selectionText && !params.isEditable && !["image", "video"].includes(params.mediaType) && captured?.kind !== "text" ? { kind: "text", quote: params.selectionText.slice(0,4000) } : {}),
              ...(["image", "video"].includes(params.mediaType) ? { kind: params.mediaType, mediaUrl: params.srcURL, selector: captured?.selector ?? `${params.mediaType}[src]` } : {}) });
            if (target) this.openBrowserOrganization(owner, tab, target);
          },
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
      browser.annotationTarget = undefined; browser.annotationMarkers = [];
      void contents.executeJavaScript(browserAnnotationPaintScript([])).catch(() => undefined);
      const owner = current();
      if (owner && !owner.window.isDestroyed()) browser.menu?.closePopup(owner.window);
    });
    contents.on("found-in-page", (_event, result) => {
      if (!browser.findQuery || result.requestId !== browser.findRequestId) return;
      browser.find = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal,
        query: browser.findQuery, requestId: result.requestId, finalUpdate: result.finalUpdate };
      const owner = current();
      if (owner) this.broadcast(owner);
    });
    contents.once("destroyed", () => {
      releaseReady();
      const owner = current();
      this.destroyNotificationTab(contents);
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

    // Repeated crashes before a document can load stop automatic recovery.
    // Only record the event here: native renderer startup must happen later.
    let consecutiveCrashes = 0;
    contents.on("did-finish-load", () => { consecutiveCrashes = 0; });
    contents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit" || contents.isDestroyed()) return;
      consecutiveCrashes++;
      this.log(`browser page ${contents.id} renderer gone: ${details.reason} (exit ${details.exitCode})`);
      this.destroyNotificationTab(contents);
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
        if (!owner || !this.enabled || !this.browserUrl || owner.window.isDestroyed() || this.backgroundNotificationTabs.has(contents)) {
          return { action: "deny" };
        }
        if (!browser.automationRunId && !browser.privatePartition) this.browserVisitedLinks.remember(contents.getURL(), details.url);
        return {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: { webPreferences: { ...BROWSER_WEB_PREFERENCES, partition: browser.privatePartition ?? BROWSER_SESSION_PARTITION } },
          createWindow: (options) => {
            const popup = this.openBrowserTab(
              owner, undefined, Boolean(browser.automationRunId) || details.disposition === "background-tab",
              browser.automationRunId, undefined, { details, options }, browser.privatePartition ?? null,
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
      contents.ipc.on("breadboard:web-notification:background", event => { event.returnValue = false; });
      contents.ipc.handle("breadboard:web-notification:request", async () => "denied");
      contents.ipc.handle("breadboard:web-notification:media-permission", async () => "denied");
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
      owner.selectionPopover?.close(); owner.inlineAnswer?.close();
      owner.window.setFullScreen(true);
      this.layout(owner);
      contents.focus();
    });
    contents.on("leave-html-full-screen", () => {
      const owner = current();
      if (owner?.browserFullscreen?.contents === contents) this.exitBrowserFullscreen(owner, false);
    });
    contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      // Selection messages are blocked navigation attempts, not a new document.
      // Chromium can announce them before will-navigate cancels the scheme.
      if (_url.startsWith("breadboard-selection:")) return;
      const owner = current();
      if (isMainFrame && !inPlace) {
        owner?.selectionPopover?.close(); owner?.inlineAnswer?.close();
        browser.selection = undefined;
        tab.generation += 1;
        browser.documentCommitted = false;
        browser.ready = false;
        if (owner?.activeId === tab.id) {
          owner.presentationRevision += 1;
          owner.presentationStatus = "pending";
        }
        browser.paintController?.abort();
        browser.paintController = undefined;
        clearTimeout(browser.paintRetry);
        if (owner?.pending === tab) void this.reveal(owner, tab, ++owner.revealToken, true);
      }
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
      browser.annotationTarget = undefined;
      browser.annotationMarkers = [];
      void contents.executeJavaScript(browserAnnotationPaintScript([])).catch(() => undefined);
      tab.url = url;
      const owner = current();
      if (owner) this.broadcast(owner);
    };
    contents.on("did-navigate", (_event, url) => {
      const retained = this.backgroundNotificationTabs.get(contents);
      if (retained && notificationOrigin(url) !== retained.origin) {
        this.destroyNotificationTab(contents);
        return;
      }
      browser.documentCommitted = true;
      const owner = current();
      if (owner) this.prepareBrowserDocument(owner, tab);
      remember(url);
      if (owner) this.rememberNotificationPage(owner, tab);
      if (browser.pendingHomeNavigation && !browser.showingHome) {
        browser.homeHistoryIndex = contents.navigationHistory.getActiveIndex();
        browser.pendingHomeNavigation = false;
      }
      if (!browser.automationRunId) this.refreshBrowserStoreInstallButton(browser);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        remember(url);
        const owner = current();
        if (owner) this.rememberNotificationPage(owner, tab);
        owner?.selectionPopover?.close(); owner?.inlineAnswer?.close();
        if (!browser.automationRunId) { void browser.highlights?.load(false); this.refreshBrowserStoreInstallButton(browser); }
      }
    });
    contents.on("did-start-loading", () => {
      if (browser.showingHome) {
        contents.stop();
        return;
      }
      const loadingChanged = !tab.loading;
      this.setTabLoading(tab, true);
      const owner = current();
      if (owner) {
        // A website can load an iframe while the address dropdown is open.
        // Keep the native toolbar expanded for that still-focused list;
        // navigation commands and the toolbar itself own its dismissal.
        // An address-bar navigation already published this exact optimistic
        // state before loadURL. Avoid a duplicate native layout + React render
        // when Chromium echoes did-start-loading a moment later.
        if (loadingChanged) this.broadcast(owner);
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
      this.prepareBrowserDocument(owner, tab);
      if (browser.ready) releaseReady();
      this.syncBrowser(owner);
      this.broadcast(owner);
    });
    contents.on("dom-ready", () => {
      browser.documentCommitted = true;
      const readyOwner = current();
      if (readyOwner) {
        // A navigation can replace Chromium's render widget after this view
        // was shown. On Windows the new widget may remain hidden even though
        // the view is selected; refresh this document's native visibility too.
        if (browser.view) this.foregroundSurfaceViews.get(readyOwner)?.delete(browser.view);
        this.refreshSelectedSurfaces(readyOwner);
        this.prepareBrowserDocument(readyOwner, tab);
      }
      if (browser.findQuery) {
        browser.find = undefined;
        browser.findRequestId = contents.findInPage(browser.findQuery, { findNext: true });
      }
      const owner = current();
      if (!owner) return;
      if (!browser.automationRunId) {
        // Passive setup has no user activation or privileged website preload.
        void browser.highlights?.load();
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
      if (targetUrl.startsWith("breadboard-annotation://")) {
        event.preventDefault();
        const owner = current();
        if (!owner || owner.activeId !== tab.id) return;
        try { const id = new URL(targetUrl).searchParams.get("id");
          const item = browser.annotationMarkers?.find(item => item.id === id);
          if (item && annotationPageUrl(tab.url) === item.target.url) this.openBrowserOrganization(owner, tab, item.target);
        } catch { /* Ignore invalid references from the untrusted page. */ }
        return;
      }
      const annotation = parseWebSelectionAction(targetUrl);
      if (annotation) {
        event.preventDefault();
        const owner = current();
        if (!owner || browser.automationRunId || owner.activeId !== tab.id || !browser.attached) return;
        if (annotation.action === "dismiss") owner.selectionPopover?.close();
        else if (annotation.action === "position") {
          const answer = owner.inlineAnswer;
          if (answer?.ownerId === tab.id && answer.selection.reference?.id === annotation.entry.id) {
            const scale = contents.getZoomFactor();
            answer.position(browser.view!.getBounds(), { x: annotation.anchor.x * scale, y: annotation.anchor.y * scale,
              height: (annotation.anchor.height ?? 18) * scale }, annotation.visible !== false);
          }
        } else {
          const saved = browser.highlights?.saved(annotation.entry.id);
          if (annotation.action === "open" && saved?.mode === "inline") {
            owner.selectionPopover?.close(); owner.inlineAnswer?.close();
            const selection = browser.highlights!.selection(saved, "inline", tab.title || browserFallbackTitle(tab.url));
            if (selection) { browser.selection = selection; this.openInlineAnswer(owner, tab, selection, annotation.anchor); this.broadcast(owner); }
          } else this.openSelectionPopover(owner, tab, saved ?? annotation.entry, annotation.anchor);
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
      tab.generation += 1;
      browser.paintController?.abort();
      browser.paintController = undefined;
      clearTimeout(browser.paintRetry);
      browser.ready = false;
      browser.documentCommitted = false;
      const owner = current();
      if (owner?.browserFullscreen?.contents === contents) this.exitBrowserFullscreen(owner, false);
      if (!owner || !tab.url || contents.isDestroyed()) return;
      if (consecutiveCrashes > 1) {
        if (owner.pending === tab) this.cancelReveal(owner);
        this.detachBrowser(owner.window, tab);
        this.setTabLoading(tab, false);
        if (owner.activeId === tab.id) owner.presentationStatus = "failed";
        this.broadcast(owner);
        this.publishNotificationToast(tab.contents, { type: "error", message: "This page keeps crashing. Press Reload to try again." });
        return;
      }
      this.setTabLoading(tab, true);
      this.broadcast(owner);
      void contents.loadURL(tab.url).catch(() => undefined);
    });
    contents.on("before-input-event", (event, input) => {
      const owner = current();
      if (owner) this.handleInput(owner, event, input);
    });
    contents.on("zoom-changed", (_event, direction) => {
      const owner = current();
      if (owner) this.zoomTab(owner, tab, direction);
    });
  }

  private browserOrganizationAllowed(host: Host, tab: Tab): boolean {
    return !!tab.browser && !host.privateBrowsing && !tab.browser.privatePartition && !tab.browser.automationRunId
      && this.browserPreferences.snapshot().organizationSidebarEnabled !== false;
  }

  private openBrowserOrganization(host: Host, tab: Tab, target: BrowserAnnotationTarget): boolean {
    if (!this.browserOrganizationAllowed(host, tab) || !tab.browser || annotationPageUrl(tab.url) !== target.url) return false;
    tab.browser.annotationTarget = target; tab.browser.organizationOpen = true;
    tab.browser.terminalOpen = false; tab.browser.addressSuggestionsOpen = false;
    host.selectionPopover?.close(); host.inlineAnswer?.close();
    this.layout(host); this.broadcast(host); tab.contents.focus();
    return true;
  }

  private askAboutBrowserSelection(host: Host, tab: Tab, browser: BrowserPage, text: string): void {
    if (!text.trim()) return;
    browser.selection = { text: text.slice(0, 8_000), title: tab.title || browserFallbackTitle(tab.url), url: tab.url };
    browser.terminalOpen = true;
    browser.organizationOpen = false;
    browser.addressSuggestionsOpen = false;
    this.layout(host);
    this.broadcast(host);
    tab.contents.focus();
  }

  private reopenClosedTab(host: Host): boolean {
    if (host.privateBrowsing || tabById(host, host.activeId)?.browser?.privatePartition) return false;
    const closed = host.closedTabs.pop();
    if (!closed) return false;
    const tab = closed.browser ? this.openBrowserTab(host, closed.url || undefined)
      : this.openTab(host, closed.url, { background: false, origin: "blank" });
    if (!tab) return false;
    tab.highlighted = closed.highlighted;
    this.broadcast(host);
    this.flushSession();
    return true;
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
    const splitPartner = host.activeId === tab.id ? splitMembers(host).find(member => member !== tab) : undefined;
    if (countBefore > 1) this.retainTabControls(host, tab);
    if (tab.url && !tab.browser?.privatePartition && !tab.automationRunId && !tab.browser?.automationRunId && !host.privateBrowsing) {
      host.closedTabs.push({ url: tab.url, browser: Boolean(tab.browser), highlighted: tab.highlighted });
      if (host.closedTabs.length > MAX_REOPENABLE_TABS) host.closedTabs.shift();
    }
    host.tabs.splice(index, 1);
    if (tab === host.base && tab.view) host.baseRetired = true;

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
    const next = splitPartner ?? host.tabs[nextIndex] ?? host.tabs[0];
    if (next && host.activeId === tab.id) this.activate(host, next.id);
    else this.broadcast(host);

    const retained = this.retainNotificationTab(host, tab);
    // The tab is already closed even if its old pixels must remain until the
    // replacement paints. Permission prompts must not wait for that handoff.
    if (!retained && tab.browser?.contents) this.browserNotifications.clearForPage(tab.browser.contents);
    if (tab.view && tab !== host.base) this.whenRevealed(host, () => {
      // An alert or Ctrl+Shift+T can restore the site before this reveal settles.
      if (host.tabs.includes(tab)) return;
      if (retained && tab.browser?.contents && this.backgroundNotificationTabs.has(tab.browser.contents)) {
        host.surfaces.forget(tab.id);
        host.retainedTabControls.delete(tab);
        this.detach(host.window, tab);
      } else this.dispose(host, tab);
    });
    else this.retireBase(host);
    return true;
  }

  private rememberNotificationPage(host: Host, tab: Tab): void {
    const page = liveBrowserPage(tab.browser);
    if (!page || host.privateBrowsing || page.privatePartition || page.automationRunId || page.scriptOpened ||
        page.showingHome || this.browserSignInsResetting) return;
    const url = page.contents.getURL();
    if (this.browserPreferences.permission(url) === "granted") this.browserNotificationPages.remember(url);
  }

  /** Start opted-in sites even when their tabs were closed before quitting. */
  private restoreBackgroundNotificationTabs(): void {
    if (!this.sessionDashboardUrl || this.restoringSession || this.sessionFrozen || !this.enabled || !this.browserUrl ||
        this.browserSignInsResetting || (this.authenticationUrl && !this.authenticatedUser)) return;
    const hosts = [...this.hosts.values()].filter(host => !host.window.isDestroyed() && !host.privateBrowsing);
    const host = hosts.find(owner => owner.sessionMain) ?? hosts[0];
    if (!host) return;
    for (const url of this.browserNotificationPages.urls()) {
      if (this.browserPreferences.permission(url) !== "granted") continue;
      const origin = notificationOrigin(url);
      if ([...this.backgroundNotificationTabs.values()].some(entry => entry.origin === origin)) continue;
      const existing = hosts.flatMap(owner => owner.tabs.map(tab => ({ owner, tab }))).find(({ tab }) =>
        tab.browser && !tab.browser.privatePartition && !tab.browser.automationRunId && !tab.browser.scriptOpened &&
        !tab.browser.showingHome && notificationOrigin(tab.url) === origin);
      if (existing) {
        this.startDeferredTab(existing.owner, existing.tab);
        continue;
      }
      this.openBrowserTab(host, url, true, undefined, undefined, undefined, null,
        { restored: true, notificationBackground: true });
    }
  }

  private retainNotificationTab(host: Host, tab: Tab, startupUrl?: string): boolean {
    const page = liveBrowserPage(tab.browser);
    const origin = page && notificationOrigin(startupUrl ?? page.contents.getURL());
    if (!page || !origin || host.window.isDestroyed() || host.privateBrowsing || page.privatePartition ||
        page.automationRunId || page.scriptOpened || page.showingHome || page.contents.isCrashed() ||
        this.browserPreferences.permission(origin) !== "granted") return false;
    // One receiving page per site/window, so repeatedly closing a site cannot
    // accumulate renderers or duplicate its notifications indefinitely.
    for (const [contents, entry] of this.backgroundNotificationTabs) {
      if (entry.host === host && entry.origin === origin) this.destroyNotificationTab(contents);
    }
    this.backgroundNotificationTabs.set(page.contents, { host, tab, origin, muted: page.contents.isAudioMuted() });
    this.rememberNotificationPage(host, tab);
    tab.groupId = undefined;
    tab.splitPreparation?.abort();
    clearTimeout(tab.splitRetry);
    page.paintController?.abort();
    clearTimeout(page.paintRetry);
    if (host.findBar?.ownerId === tab.id) host.findBar.close();
    page.menu?.closePopup(host.window);
    page.contents.setAudioMuted(true);
    this.browserNotifications.setBackground(page.contents, true);
    return true;
  }

  private restoreNotificationTab(contents: WebContents, background = false): Tab | undefined {
    const entry = this.backgroundNotificationTabs.get(contents);
    if (!entry) return;
    if (contents.isDestroyed() || entry.host.window.isDestroyed() || entry.tab.contents.isDestroyed()) {
      this.destroyNotificationTab(contents);
      return;
    }
    const { host, tab, muted } = entry;
    this.backgroundNotificationTabs.delete(contents);
    this.browserNotifications.setBackground(contents, false);
    contents.setAudioMuted(muted);
    let closedIndex = host.closedTabs.length - 1;
    while (closedIndex >= 0 && !(host.closedTabs[closedIndex]!.browser && host.closedTabs[closedIndex]!.url === tab.url)) closedIndex--;
    if (closedIndex >= 0) host.closedTabs.splice(closedIndex, 1);
    host.tabs.splice(tabIndex(host, host.activeId) + 1, 0, tab);
    if (background) this.broadcast(host);
    else this.activate(host, tab.id);
    return tab;
  }

  private destroyNotificationTab(contents: WebContents): void {
    const entry = this.backgroundNotificationTabs.get(contents);
    if (!entry) return;
    this.backgroundNotificationTabs.delete(contents);
    this.dispose(entry.host, entry.tab);
  }

  private destroyNotificationTabsForHost(host: Host): void {
    for (const [contents, entry] of this.backgroundNotificationTabs) {
      if (entry.host === host) this.destroyNotificationTab(contents);
    }
  }

  /** A view that is no longer a tab: off the window, out of the maps, closed. */
  private dispose(host: Host, tab: Tab): void {
    host.surfaces.forget(tab.id);
    host.retainedTabControls.delete(tab);
    if (host.findBar?.ownerId === tab.id) host.findBar.close();
    tab.browser?.menu?.closePopup(host.window);
    tab.menu?.closePopup(host.window);
    this.detach(host.window, tab);
    if (tab.browser?.contents) this.browserNotifications.clearForPage(tab.browser.contents);
    if (!tab.sharedChrome) this.hostByContents.delete(tab.contents.id);
    if (tab.browser?.contents) this.hostByContents.delete(tab.browser.contents.id);
    this.destroyView(tab);
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    tab.splitPreparation?.abort();
    clearTimeout(tab.splitRetry);
    tab.releasePrivateProfile?.();
    const host = this.hostByContents.get(tab.contents.id);
    if (host?.downloadsPopover?.ownerId === tab.id) host.downloadsPopover.close();
    if (host?.extensionsPopover?.ownerId === tab.id) host.extensionsPopover.close();
    if (host?.selectionPopover?.ownerId === tab.id) host.selectionPopover.close();
    if (host?.inlineAnswer?.ownerId === tab.id) host.inlineAnswer.close();
    if (host?.groupPopover?.ownerId === tab.id) host.groupPopover.close();
    if (host) this.detach(host.window, tab);
    tab.browser?.paintController?.abort();
    clearTimeout(tab.browser?.paintRetry);
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
    if (!tab.sharedChrome && !tab.contents.isDestroyed()) {
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
      host.surfaces.forget(host.base.id);
      this.detach(host.window, host.base);
      host.retainedTabControls.delete(host.base);
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

  /** User views become windows when tabs are turned off; AI work stays temporary. */
  private popOutViews(host: Host): void {
    if (host.window.isDestroyed()) return;
    this.destroyNotificationTabsForHost(host);
    const active = tabById(host, host.activeId);
    const automationTabs = host.tabs.filter(tab => !tab.anchored && (tab.automationRunId ?? tab.browser?.automationRunId));
    const views = host.tabs.filter((tab) => tab.view && tab !== host.base && !automationTabs.includes(tab));
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
    host.tabs = [...(host.baseRetired ? [] : [host.base]), ...automationTabs.filter(tab => tab !== host.base)];
    if (host.tabs.length === 0) {
      host.window.close();
      return;
    }
    host.activeId = host.baseRetired ? host.tabs[0]!.id : host.base.id;
    this.present(host);
  }

  setMemoryPressure(pressure: TabMemoryPressure): void {
    this.memoryPressure = pressure;
    for (const host of this.hosts.values()) {
      host.surfaces.setPressure(pressure);
      if (!host.surfaces.canPrewarm) this.discardPreparedNewTab(host);
      else this.scheduleNewTabPreparation(host);
      this.trimSurfaces(host);
    }
    if (pressure !== "normal") void this.unloadIdleTabs();
  }

  private distributeSurfaceBudget(): void {
    // Each window has its own LRU, but their additional reservations share one
    // application budget. Opening windows must not multiply the cache allowance.
    const capacity = Math.floor(TAB_SURFACE_BUDGET_BYTES / Math.max(1, this.hosts.size));
    for (const host of this.hosts.values()) {
      host.surfaces.setCapacity(capacity);
      this.trimSurfaces(host);
    }
  }

  private retainSurface(host: Host, tab: Tab): void {
    const [width = 1, height = 1] = host.window.getContentSize();
    const scale = screen.getDisplayMatching(host.window.getBounds()).scaleFactor;
    host.surfaces.touch(tab.id, surfaceReservation(width, height, scale, tab.browser?.attached ? 2 : 1));
    this.trimSurfaces(host);
  }

  private trimSurfaces(host: Host): void {
    // Covered WebContentsViews still supply native drag regions on Electron
    // 33/Windows. Sites such as ChatGPT declare draggable headers, which then
    // swallow clicks in the next site's header even though the old page is
    // hidden. Keep the document alive, but detach inactive website views from
    // the window so their native input regions are unregistered synchronously.
    const browserOwners = new Set([host.activeId, host.pending?.id ?? -1, ...splitMembers(host).map(tab => tab.id)]);
    // A legacy/offscreen handoff still displays the outgoing page until the
    // new one is ready. Immediate selection has already covered that page.
    if (host.pending && !host.pendingAtFront) browserOwners.add(host.presentedId ?? -1);
    for (const tab of host.tabs) {
      if (!browserOwners.has(tab.id)) this.detachBrowser(host.window, tab);
    }
    for (const id of host.surfaces.trim(new Set([host.activeId, host.presentedId ?? -1, host.pending?.id ?? -1, ...splitMembers(host).map(tab => tab.id)]))) {
      const tab = tabById(host, id);
      if (tab) this.detach(host.window, tab);
    }
  }

  // ---------------------------------------------------------- presentation

  private startDeferredTab(host: Host, tab: Tab): void {
    if (tab.deferredUrl) {
      const url = tab.deferredUrl;
      tab.deferredUrl = undefined;
      // Browser shell readiness is tracked by `loaded`; only its native page
      // owns `loading`. A restored browser home has no native page to stop it.
      this.setTabLoading(tab, !tab.browser);
      void tab.contents.loadURL(url).catch(() => undefined);
    }
    if (tab.deferredBrowserUrl) {
      const address = tab.deferredBrowserUrl;
      tab.deferredBrowserUrl = undefined;
      this.navigateBrowser(host, tab, address);
    }
  }

  private activate(host: Host, id: number, showLoader = true): void {
    const tab = tabById(host, id);
    if (!tab) return;
    if (tab.browser) tab.browser.uiVisited = true;
    tab.backgroundSince = undefined;
    this.startDeferredTab(host, tab);
    for (const group of tabGroupPath(host.groups, tab.groupId)) group.collapsed = false;
    for (const member of splitMembers({ ...host, activeId: id })) this.startDeferredTab(host, member);
    if (host.activeId !== id) {
      this.exitBrowserFullscreen(host);
      host.downloadsPopover?.close();
      host.extensionsPopover?.close();
      host.selectionPopover?.close(); host.inlineAnswer?.close();
      host.groupPopover?.close();
      host.findBar?.close();
      const previous = tabById(host, host.activeId);
      if (previous) previous.backgroundSince = Date.now();
      previous?.menu?.closePopup(host.window);
      if (previous?.browser) {
        previous.browser.addressSuggestionsOpen = false;
        previous.browser.menu?.closePopup(host.window);
      }
      for (const other of host.tabs) other.spawned = 0;
      host.activeId = id;
      host.presentationRevision += 1;
      host.presentationStatus = "pending";
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
   * The independent shell selects native content immediately, including an
   * evicted surface or a response still streaming. New surfaces report their
   * first frame asynchronously. Resident switches need no renderer probe.
   * Legacy windows without independent controls retain the parked handoff so
   * their outgoing tab strip remains usable until the incoming page has one.
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
      if (!host.shellEnabled && !this.needsTerminalReadiness(active) && showLoader && (active.loading || !active.loaded)) {
        this.showLoadingScene(host, active);
        this.raiseNotificationOverlay(host);
      }
      return;
    }
    const view = active.view;
    if (!view) {
      if (!active.loaded) {
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
    // Native teardown or an older background preparation can detach a view
    // without updating our flag. Selecting that tab must repair its display.
    if (active.attached && !host.window.contentView.children.includes(view)) active.attached = false;
    if (active.attached && active.painted && !this.needsTerminalReadiness(active) && (!active.browser || active.browser.showingHome || (active.browser.ready && active.browser.attached))) {
      // Already the page in front; a reveal that was under way is abandoned.
      this.cancelReveal(host);
      this.layout(host);
      this.settle(host, active);
      return;
    }
    this.cancelReveal(host);
    if (host.shellEnabled && !this.needsTerminalReadiness(active)) {
      // Selection owns the visible surface immediately. Paint readiness is
      // observed afterwards; it must never keep another tab on screen or
      // require an offscreen renderer to run before the click takes effect.
      host.pending = active;
      host.pendingAtFront = true;
      host.pendingNavigation = true;
      host.presentationStatus = "pending";
      const token = ++host.revealToken;
      active.attached = true;
      this.layout(host);
      if (!host.window.contentView.children.includes(view)) host.window.contentView.addChildView(view);
      view.setVisible(true);
      this.syncBrowser(host);
      void this.reveal(host, active, token);
      return;
    }
    // Even a tab that painted before goes through the offscreen handoff: a
    // detached view is hidden to Chromium, which may evict its last frame, so
    // reattaching it in front and dropping the outgoing page in the same turn
    // showed the bare window background until that renderer painted again —
    // indefinitely while it was busy. `reveal` skips the chrome wait for a
    // painted tab, so a responsive one still comes forward within a few frames.
    host.pending = active;
    // Page navigation starts the blue progress bar while the outgoing page
    // remains visible; a stalled tab selection gets the same feedback below.
    host.pendingNavigation = !showLoader;
    const token = ++host.revealToken;
    const [width, height] = host.window.getContentSize();
    if (!this.sharesPresentedView(host, active) && typeof width === "number" && typeof height === "number") {
      // Bounds first, then attach, so no frame of it lands in the window.
      setViewBounds(view, offscreenBounds(width, height, this.preparationTop(host, height)));
    }
    host.window.contentView.addChildView(view);
    active.attached = true;
    view.setVisible(true);
    this.layout(host);
    if (showLoader && !this.needsTerminalReadiness(active) && (active.loading || !active.loaded)) this.showLoadingScene(host, active);
    this.raiseNotificationOverlay(host);
    host.findBar?.layout();
    void this.reveal(host, active, token, !showLoader);
  }

  private async reveal(host: Host, tab: Tab, token: number, retainUntilLoaded = false): Promise<void> {
    clearTimeout(host.revealRetry);
    host.revealController?.abort();
    if (host.shellEnabled && !this.needsTerminalReadiness(tab)) {
      await this.observeSelectedFrame(host, tab, token);
      return;
    }
    if (host.pendingAtFront) {
      host.pendingAtFront = false;
      this.layout(host);
    }
    const controller = new AbortController();
    const generation = tab.generation;
    host.revealController = controller;
    const current = () => !controller.signal.aborted && !host.window.isDestroyed() &&
      host.pending === tab && host.revealToken === token && tab.generation === generation && !tab.contents.isDestroyed();
    // Route generation can outlast the compositor timeout. This also applies
    // when selecting a restored tab that is still waiting for its document.
    // Keep the outgoing page until DOM-ready before starting the paint clock.
    if (!tab.loaded) {
      await this.waitForDocument(tab.onLoaded, controller.signal);
    }
    if (!current()) return;
    const browser = liveBrowserPage(tab.browser);
    if (browser && !browser.ready && !browser.showingHome && isSafeBrowserUrl(tab.url)) {
      this.prepareBrowserDocument(host, tab);
      await this.waitForDocument(browser.onReady, controller.signal);
    }
    if (!current()) return;
    // A missed paint deadline used to detach the outgoing page anyway. Keep
    // its live controls instead, and let the original probe finish naturally;
    // retries would queue more work on the same stalled renderer.
    const ceiling = setTimeout(() => {
      if (!current()) return;
      host.pendingNavigation = true;
      this.hideLoadingScene(host);
      this.broadcast(host);
    }, REVEAL_MAX_WAIT_MS);
    ceiling.unref?.();
    try {
      if (!tab.painted && this.enabled && !host.shell) {
        await waitForTabChrome(tab.contents, () => this.enabled && current());
      }
      if (!current()) return;
      // The shell and its website can prepare together; serial probes add an
      // extra pair of frames to every browser-tab selection.
      const prepared = await Promise.all([
        this.frameReady(tab, controller.signal),
        this.parkBrowserPage(host, tab, controller.signal),
      ]);
      if (!current() || prepared.some(ready => !ready)) return;
      if (tab.view) {
        // A parked frame does not confirm that Chromium has presented the view
        // at its new position. Retain the outgoing surfaces underneath until
        // both incoming surfaces have painted there, or the base dashboard can
        // flash through the gap between the native moves and the compositor.
        host.pendingAtFront = true;
        this.layout(host);
        this.broadcast(host);
        if (browser?.attached && !browser.showingHome && !tab.voiceOverlay) {
          // Preparation kept the website below the chrome's exposed pixel.
          // At its final bounds the website belongs above the content chrome,
          // with the toolbar and notifications still above both. Otherwise an
          // opaque shell can prevent the website's in-place frame from painting.
          this.raiseViews(host, [browser.view, ...(host.shell ? [host.shell.view] : [])]);
          this.raiseNotificationOverlay(host);
        }
        const inPlace = await Promise.all([
          this.frameReady(tab, controller.signal),
          browser?.attached ? waitForRevealFrame(browser.contents, 1500, controller.signal) : true,
        ]);
        if (!current() || inPlace.some(ready => !ready)) return;
      }
      if (current()) this.commitReveal(host, tab);
    } finally {
      clearTimeout(ceiling);
      if (current()) {
        controller.abort();
        host.revealController = undefined;
        // The attempt is settled and a new bounded retry is scheduled. Keep
        // one continuous progress bar across retries instead of flashing it.
        host.presentationStatus = "pending";
        host.pendingNavigation = true;
        this.hideLoadingScene(host);
        this.broadcast(host);
        // A rejection settles this attempt. Retry even if no further document
        // event arrives; switching away and back is never a recovery mechanism.
        host.revealRetry = setTimeout(() => {
          host.revealRetry = undefined;
          if (host.pending !== tab || host.revealToken !== token || host.window.isDestroyed()) return;
          host.presentationStatus = "pending";
          void this.reveal(host, tab, ++host.revealToken, retainUntilLoaded);
        }, 250);
        host.revealRetry.unref();
      }
    }
  }

  /** Readiness drives telemetry/loading feedback, never native selection. */
  private async observeSelectedFrame(host: Host, tab: Tab, token: number): Promise<void> {
    const controller = new AbortController();
    const generation = tab.generation;
    host.revealController = controller;
    const current = () => !controller.signal.aborted && !host.window.isDestroyed() &&
      host.pending === tab && host.activeId === tab.id && host.revealToken === token &&
      tab.generation === generation && !tab.contents.isDestroyed();
    try {
      const browser = liveBrowserPage(tab.browser);
      if (browser && !browser.showingHome) {
        this.prepareBrowserDocument(host, tab);
        if (!browser.ready) await this.waitForDocument(browser.onReady, controller.signal);
        if (!current()) return;
        if (!await waitForRevealFrame(browser.contents, 1500, controller.signal)) return;
      } else {
        if (!tab.loaded && !tab.documentCommitted) await this.waitForDocument(tab.onLoaded, controller.signal);
        if (!current()) return;
        const ready = await this.frameReady(tab, controller.signal);
        if (!ready) return;
      }
      if (current()) this.commitReveal(host, tab);
    } catch (error) {
      this.log(`selected tab frame check failed: ${String(error)}`);
    } finally {
      if (current()) {
        controller.abort();
        host.revealController = undefined;
        // A native widget can become hidden after the initial selection or
        // DOM-ready refresh. Retrying rAF alone cannot wake that widget.
        this.refreshTabSurface(host, tab);
        // Keep the selection and document while retrying its frame check.
        host.revealRetry = setTimeout(() => {
          host.revealRetry = undefined;
          if (host.pending === tab && host.revealToken === token && !host.window.isDestroyed()) {
            void this.reveal(host, tab, ++host.revealToken);
          }
        }, 250);
        host.revealRetry.unref();
      }
    }
  }

  private waitForDocument(waiters: Array<() => void>, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        const index = waiters.indexOf(finish);
        if (index >= 0) waiters.splice(index, 1);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      if (signal.aborted) { resolve(); return; }
      waiters.push(finish);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  private commitReveal(host: Host, tab: Tab): void {
    host.pending = null;
    host.pendingAtFront = false;
    host.pendingNavigation = false;
    host.revealController = undefined;
    tab.painted = true;
    if (tab.sharedChrome && host.browserChrome) host.browserChrome.painted = true;
    this.layout(host);
    // A browser's trusted shell is transparent below its toolbar. Attach its
    // page before removing the outgoing shell so that hole stays covered.
    this.syncBrowser(host);
    // Remove the cover last, after the selected tab is in place and everything
    // that used to be beneath it is gone, so even the base-tab path cannot
    // expose one stale frame between the loading field and the finished page.
    this.hideLoadingScene(host);
    this.settle(host, tab);
    // rAF can run while Windows still displays an evicted/hidden surface.
    // Renew native visibility after the frame and final stacking as well as
    // on selection: DOM-ready can precede the new render widget's visibility.
    this.refreshTabSurface(host, tab);
    // DOM-ready can precede the actual reveal. Release the navigation bar only
    // after the destination is in place, including on the outgoing renderer.
    this.broadcast(host);
  }

  /** Terminal's initial view must contain hydrated controls and settled widgets.
   * Ordinary web/document tabs retain their immediate native selection path. */
  private needsTerminalReadiness(tab: Tab): boolean {
    if (tab.browser || !this.newTabUrl) return false;
    // A crashed renderer's old ready bit does not describe its replacement.
    // Direct Terminal recovery must satisfy the same hydration/paint contract
    // as a new tab, even when selection races the deferred crash callback.
    if (tab.terminalReady && !tab.contents.isCrashed()) return false;
    if (tab.recovering && !tab.recoveryAttempt?.directTerminal) return false;
    try {
      const home = new URL(this.newTabUrl), url = new URL(tab.url);
      return home.origin === url.origin && home.pathname === url.pathname;
    } catch { return false; }
  }

  /** The document has arrived and the renderer has composited it where it now sits. */
  private async frameReady(tab: Tab, signal?: AbortSignal): Promise<boolean> {
    // Always probe after attachment or movement: a frame from before either
    // operation cannot confirm that the view is now presented in place.
    if (!tab.loaded && !tab.documentCommitted) await this.waitForDocument(tab.onLoaded, signal ?? new AbortController().signal);
    if (this.needsTerminalReadiness(tab)) {
      if (!tab.loaded) await this.waitForDocument(tab.onLoaded, signal ?? new AbortController().signal);
      const release = allowBackgroundFrames(tab.contents);
      try {
        if (!await waitForStartupPageReady(tab.contents, 1500, signal) || signal?.aborted) return false;
        // Prepared Terminals explicitly enroll their widget reads while hidden,
        // so their first selection needs only a new composited frame.
        const owner = this.hostByContents.get(tab.contents.id);
        if (owner?.activeId === tab.id || owner?.preparedNewTab === tab) tab.terminalReady = true;
      } finally { release(); }
    }
    if (!tab.loaded && tab.documentCommitted) return waitForDocumentFrame(tab.contents, signal ?? new AbortController().signal);
    return waitForRevealFrame(tab.contents, 1500, signal);
  }

  /** Abandon the incoming tab; the outgoing surfaces still cover the window. */
  private cancelReveal(host: Host): void {
    clearTimeout(host.revealRetry);
    host.revealRetry = undefined;
    const pending = host.pending;
    host.pending = null;
    host.pendingAtFront = false;
    host.pendingNavigation = false;
    host.revealToken += 1;
    host.revealController?.abort();
    host.revealController = undefined;
    if (pending) this.detach(host.window, pending);
    this.hideLoadingScene(host);
  }

  /** The screen has just reached a stable state with `active` in front. */
  private settle(host: Host, active: Tab): void {
    host.presentedId = active.id;
    host.presentationStatus = "presented";
    this.retainSurface(host, active);
    this.runAfterReveal(host);
    this.applyTitle(host);
    // Trusted browser chrome comes forward first; only after it has painted do
    // we layer the untrusted page beneath its toolbar.
    this.syncBrowser(host);
    if (host.tabDragActive) return;
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

  private retainTabControls(host: Host, tab: Tab): void {
    if (tab === host.base || (tab.attached && host.pending !== tab)) host.retainedTabControls.add(tab);
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
    const owner = this.hosts.get(window.id);
    if (tab.sharedChrome && owner && owner.tabs.some(other => other !== tab && other.view === tab.view &&
        (other.id === owner.activeId || other.id === owner.presentedId))) { tab.attached = false; return; }
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
    if (host.shellEnabled) {
      host.presentationStatus = "pending";
      this.broadcast(host);
      return;
    }
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

  /** A parked view needs an uncovered pixel to receive compositor frames.
   * The persistent shell covers the old top-right parking pixel, even when
   * background throttling is temporarily disabled. Park below its full bounds. */
  private preparationTop(host: Host, height: number): number {
    if (!host.shellEnabled || !host.shell) return 0;
    return Math.min(height - 1, Math.max(browserContentTop(height), host.shell.view.getBounds().height));
  }

  /** A first-frame probe is not ownership of an ongoing PDF/canvas render.
   * Keep selected documents drawing through native occlusion changes, until
   * selection moves away. Use the same leases as preparation so late cleanup
   * cannot re-enable throttling underneath the page the user is reading. */
  private syncForegroundFrames(host: Host): void {
    const selected = new Set<WebContents>();
    const active = tabById(host, host.activeId);
    if (host.shellEnabled && active) {
      for (const tab of new Set([active, ...splitMembers(host)])) {
        if (!tab.contents.isDestroyed()) selected.add(tab.contents);
        const browser = liveBrowserPage(tab.browser);
        if (browser && !browser.showingHome && !tab.voiceOverlay) selected.add(browser.contents);
      }
    }
    // Claim arriving documents before releasing outgoing ones, including when
    // both tabs share browser chrome or a document moves between windows.
    for (const contents of selected) {
      if (!host.foregroundFrameLeases.has(contents)) {
        host.foregroundFrameLeases.set(contents, allowBackgroundFrames(contents));
      }
    }
    for (const [contents, release] of host.foregroundFrameLeases) {
      if (selected.has(contents)) continue;
      release();
      host.foregroundFrameLeases.delete(contents);
    }
  }

  private sharesPresentedView(host: Host, tab: Tab): boolean {
    return Boolean(tab.sharedChrome && host.browserChrome?.painted &&
      tabById(host, host.presentedId ?? -1)?.view === tab.view);
  }

  private refreshTabSurface(host: Host, tab: Tab): void {
    const browser = liveBrowserPage(tab.browser);
    const view = browser && !browser.showingHome && !tab.voiceOverlay ? browser.view : tab.view;
    this.refreshSelectedSurfaces(host, view ?? undefined);
  }

  /** Electron 33 on Windows can keep displaying an evicted surface even while
   * its DOM and frame probes remain healthy. Renew native visibility on entry,
   * document completion, or a failed frame check, preserving the document's
   * PDF canvas, draft, and scroll position. Ordinary layout stays a no-op. */
  private refreshSelectedSurfaces(host: Host, invalidatedView?: WebContentsView): void {
    if (process.platform !== "win32" || !host.shellEnabled || host.window.isDestroyed()) return;
    if (invalidatedView) this.foregroundSurfaceViews.get(host)?.delete(invalidatedView);
    const active = tabById(host, host.activeId);
    const selected = new Set<WebContentsView>();
    const children = host.window.contentView.children;
    for (const tab of new Set([active, ...splitMembers(host)])) {
      if (!tab?.attached) continue;
      if (tab.view && children.includes(tab.view)) selected.add(tab.view);
      const browser = liveBrowserPage(tab.browser);
      if (browser?.attached && !browser.showingHome && !tab.voiceOverlay && children.includes(browser.view)) {
        selected.add(browser.view);
      }
    }
    const previous = this.foregroundSurfaceViews.get(host);
    this.foregroundSurfaceViews.set(host, selected);
    const focused = host.window.isFocused() ? webContents.getFocusedWebContents() : null;
    let restoreFocus = false;
    for (const view of selected) {
      if (previous?.has(view)) continue;
      const contents = view.webContents;
      if (contents.isDestroyed() || contents.isCrashed()) continue;
      if (contents === focused) restoreFocus = true;
      const throttled = contents.getBackgroundThrottling();
      // Electron 33 sets RenderWidgetHostImpl::disable_hidden_ when throttling
      // is disabled. Hide/show alone then skips the renderer's hidden -> shown
      // transition and can leave its old compositor surface undisplayed.
      // Allow that transition first; restore the foreground frame lease only
      // after the native view is visible. Keep the whole operation synchronous.
      if (!throttled) contents.setBackgroundThrottling(true);
      try {
        view.setVisible(false);
        view.setVisible(true);
      } finally {
        if (!throttled && !contents.isDestroyed()) contents.setBackgroundThrottling(false);
      }
    }
    // Hiding the selected native view clears Chromium's keyboard focus even
    // though document.activeElement still points at Search. A late frame check
    // can run after the first click, so give focus back to that exact renderer
    // once it is visible again. Never focus an inactive window or another pane.
    if (restoreFocus && focused && !focused.isDestroyed() && host.window.isFocused()) focused.focus();
  }

  private prepareSplitPartner(host: Host, tab: Tab): void {
    if (tab.splitPreparation || tab.splitRetry || host.window.isDestroyed() || !tab.view || !splitMembers(host).includes(tab)) return;
    this.startDeferredTab(host, tab);
    const browser = liveBrowserPage(tab.browser);
    if (tab.attached && tab.painted && (!browser || browser.showingHome || (browser.ready && browser.attached))) return;
    const controller = new AbortController();
    tab.splitPreparation = controller;
    tab.painted = false;
    const current = () => !controller.signal.aborted && !host.window.isDestroyed() &&
      !tab.contents.isDestroyed() && splitMembers(host).includes(tab);
    void (async () => {
      if (!tab.loaded) await this.waitForDocument(tab.onLoaded, controller.signal);
      if (!current()) return;
      if (!tab.attached || !host.window.contentView.children.includes(tab.view!)) {
        const [width = 1, height = 1] = host.window.getContentSize();
        if (!tab.sharedChrome || !host.window.contentView.children.includes(tab.view!)) {
          setViewBounds(tab.view!, { ...offscreenBounds(width, height, this.preparationTop(host, height)), x: Math.max(0, width - 3) });
          host.window.contentView.addChildView(tab.view!);
        }
        tab.attached = true;
        tab.view!.setVisible(true);
      }
      this.prepareBrowserDocument(host, tab);
      if (browser && !browser.showingHome && !browser.ready) await this.waitForDocument(browser.onReady, controller.signal);
      if (!current()) return;
      const ready = await this.frameReady(tab, controller.signal);
      if (!current()) return;
      if (!ready) {
        tab.splitRetry = setTimeout(() => { tab.splitRetry = undefined; this.prepareSplitPartner(host, tab); }, 250);
        tab.splitRetry.unref();
        return;
      }
      tab.painted = true;
      if (browser?.ready && !browser.showingHome) {
        const bounds = this.browserPageBounds(host, browser);
        if (bounds) setViewBounds(browser.view, bounds);
        if (!browser.attached) host.window.contentView.addChildView(browser.view);
        browser.attached = true;
        browser.view.setVisible(true);
      }
      this.layout(host);
      this.broadcast(host);
    })().catch(error => this.log(`split pane preparation failed: ${String(error)}`)).finally(() => {
      if (tab.splitPreparation === controller) tab.splitPreparation = undefined;
    });
  }

  private layout(host: Host): void {
    if (host.window.isDestroyed()) return;
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") return;
    // A search can replace the initial new-tab page before the independent
    // toolbar finishes loading. The retired base can no longer make the shell
    // ready; use its live replacement, including a browser's trusted document.
    const shellPage = host.baseRetired ? tabById(host, host.activeId) : host.base;
    if (host.shell?.ready && shellPage?.loaded &&
        isTabPageUrl(this.options.allowed, shellPage.browser?.shellUrl ?? shellPage.url)) host.shellEnabled = true;
    this.syncForegroundFrames(host);
    const inset = host.shellEnabled ? BREADBOARD_TITLE_BAR.height : 0;
    const offscreen = offscreenBounds(width, height - inset, this.preparationTop(host, height));
    const pair = host.browserFullscreen || tabById(host, host.activeId)?.voiceOverlay ? [] : splitMembers(host);
    for (const tab of host.tabs) if (!pair.includes(tab)) {
      tab.splitPreparation?.abort(); tab.splitPreparation = undefined;
      clearTimeout(tab.splitRetry); tab.splitRetry = undefined;
    }
    const top = pair.some(tab => tab.browser) ? browserContentTop(height) : inset;
    if (pair.length) {
      host.splitDivider ??= new View();
      const left = splitPaneBounds(width, height, top, 0), right = splitPaneBounds(width, height, top, 1);
      host.splitDivider.setBackgroundColor(backgroundColorForTheme(this.options.theme()));
      setViewBounds(host.splitDivider, { x: left.width, y: top, width: right.x - left.width, height: Math.max(1, height - top) });
      if (!host.window.contentView.children.includes(host.splitDivider)) host.window.contentView.addChildView(host.splitDivider);
    } else if (host.splitDivider && host.window.contentView.children.includes(host.splitDivider)) {
      host.window.contentView.removeChildView(host.splitDivider);
    }
    if (host.shellEnabled && host.shell) {
      const active = tabById(host, host.activeId);
      // Keep the toolbar's native bounds with the website still on screen.
      // Terminal can spend several seconds preparing its initial widgets.
      const toolbar = this.toolbarTab(host);
      const shellHeight = toolbar?.browser ? Math.min(height, Math.max(browserContentTop(height), toolbar.browser.addressSuggestionsOpen ? toolbar.browser.suggestionsBottom ?? 440 : 0)) : inset;
      setViewBounds(host.shell.view, { x: 0, y: 0, width, height: host.tabDragPreview ? height : shellHeight });
      if (!host.window.contentView.children.includes(host.shell.view)) host.window.contentView.addChildView(host.shell.view);
      host.shell.view.setVisible(!host.browserFullscreen && !active?.voiceOverlay);
    }
    if (host.preparedNewTab?.view) setViewBounds(host.preparedNewTab.view, offscreen);
    for (const tab of host.tabs) {
      if (tab.view && (!tab.sharedChrome || tab.id === host.activeId) && (!tab.automationPreparing || tab.id === host.activeId || pair.includes(tab))) {
        setViewBounds(
          tab.view,
          pair.includes(tab) && tab.id !== host.activeId && !tab.sharedChrome && ((host.pending && !host.pendingAtFront) || (tab.splitPreparation && !tab.painted)) ? { ...offscreen, x: Math.max(0, width - 3) }
            : tab === host.pending && !host.pendingAtFront && !this.sharesPresentedView(host, tab) ? offscreen
            : pair.includes(tab) && !tab.sharedChrome ? splitPaneBounds(width, height, top, pair.indexOf(tab))
            : { x: 0, y: inset, width, height: height - inset },
        );
      }
      const browser = liveBrowserPage(tab.browser);
      if (browser?.attached && (browser.ready || (host.shellEnabled && host.activeId === tab.id))) {
        const pane = pair.includes(tab) ? splitPaneBounds(width, height, top, pair.indexOf(tab)) : null;
        const fullscreen = host.browserFullscreen?.contents === browser.contents;
        const x = fullscreen ? 0 : (pane?.x ?? 0) + browserContentLeft(
          pane?.width ?? width,
          browser.terminalOpen,
          browser.terminalWidth,
        );
        const y = fullscreen ? 0 : browserContentTop(height);
        const pageHeight = Math.max(1, height - y);
        const parkedPartner = pair.includes(tab) && tab.id !== host.activeId && ((host.pending && !host.pendingAtFront) || (tab.splitPreparation && !tab.painted));
        setViewBounds(browser.view, {
          x: parkedPartner ? Math.max(0, width - 4) : tab === host.pending && !host.pendingAtFront ? Math.max(0, width - 2) : x,
          y: parkedPartner || (tab === host.pending && !host.pendingAtFront) ? this.preparationTop(host, height) + 1 - pageHeight : y,
          width: Math.max(1, (pane ? pane.x + pane.width : width) - x - (!fullscreen && browser.organizationOpen ? browserOrganizationWidth(pane?.width ?? width) : 0)),
          height: pageHeight,
        });
      }
    }
    const scale = screen.getDisplayMatching(host.window.getBounds()).scaleFactor;
    for (const tab of host.tabs) host.surfaces.resize(tab.id, surfaceReservation(width, height, scale, tab.browser?.attached ? 2 : 1));
    this.trimSurfaces(host);
    for (const member of pair) if (member.id !== host.activeId) this.prepareSplitPartner(host, member);
    const active = tabById(host, host.activeId);
    this.stackBrowserChrome(host);
    // Pending content stays behind the controls. Otherwise stackBrowserChrome
    // has already ordered the shell below menus and other native overlays.
    if (host.pending && host.shellEnabled && host.shell) this.raiseViews(host, [host.shell.view]);
    if (host.loadingScene?.attached && active) this.layoutLoadingScene(host, active);
    this.refreshSelectedSurfaces(host);
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

  private prepareBrowserDocument(host: Host, tab: Tab): void {
    const browser = liveBrowserPage(tab.browser);
    if (!browser || browser.ready || browser.showingHome || !browser.documentCommitted ||
        browser.paintController || host.window.isDestroyed() || (host.activeId !== tab.id && !splitMembers(host).includes(tab))) return;
    const controller = new AbortController();
    browser.paintController = controller;
    clearTimeout(browser.paintRetry);
    const generation = tab.generation;
    const current = () => !controller.signal.aborted && !browser.contents.isDestroyed() &&
      !host.window.isDestroyed() && tab.generation === generation && host.tabs.includes(tab);
    if (!browser.attached || (host.pending === tab && !host.pendingAtFront)) {
      const bounds = this.browserPageBounds(host, browser);
      if (bounds) {
        const [width = 1] = host.window.getContentSize();
        const [, height = 1] = host.window.getContentSize();
        // The persistent shell selects the website immediately. Observe that
        // document in place: parking it again on commit uncovers the old home
        // for a frame. Only a background/legacy handoff needs an exposed pixel.
        const selectedAtFront = host.shellEnabled && host.activeId === tab.id && (!host.pending || host.pendingAtFront);
        setViewBounds(browser.view, selectedAtFront ? bounds : {
          ...bounds, x: width - (host.activeId === tab.id ? 2 : 4), y: this.preparationTop(host, height) + 1 - bounds.height,
        });
        // A recovery or another pending tab may have raised the outgoing
        // website since this view was attached. Give the incoming document
        // its exposed pixel again before waiting for its first frame.
        this.raiseViews(host, [browser.view, ...(host.shell ? [host.shell.view] : [])]);
        browser.attached = true;
        browser.view.setVisible(true);
      }
    }
    // A browser-home navigation can create its native page without another
    // layout pass. Give it foreground ownership and wake its attached surface
    // before asking that renderer for the frames that make the page ready.
    this.syncForegroundFrames(host);
    this.refreshSelectedSurfaces(host);
    void waitForDocumentFrame(browser.contents, controller.signal).then(ready => {
      if (browser.paintController === controller) browser.paintController = undefined;
      if (!current()) return;
      if (ready) {
        browser.ready = true;
        if (host.activeId === tab.id && !host.pending) {
          host.presentedId = tab.id;
          host.presentationStatus = "presented";
        }
        for (const resume of browser.onReady.splice(0)) resume();
        this.syncBrowser(host);
        // In-place navigations have no pending reveal to renew this surface.
        if (host.pending !== tab) this.refreshSelectedSurfaces(host, browser.view);
        this.broadcast(host);
      } else {
        this.refreshSelectedSurfaces(host, browser.view);
        browser.paintRetry = setTimeout(() => this.prepareBrowserDocument(host, tab), 250);
        browser.paintRetry.unref();
      }
    });
  }

  /** Put the active browser page immediately below its trusted toolbar. */
  private syncBrowser(host: Host): void {
    if (host.window.isDestroyed() || (host.pending && !host.pendingAtFront)) return;
    this.syncForegroundFrames(host);
    const active = tabById(host, host.activeId);
    const browser = liveBrowserPage(active?.browser);
    if (active?.attached && !active.voiceOverlay && browser && !browser.showingHome && active.url && (browser.ready || host.shellEnabled)) {
      const bounds = this.browserPageBounds(host, browser);
      if (bounds) {
        setViewBounds(browser.view, bounds);
        if (!browser.attached || !host.window.contentView.children.includes(browser.view)) {
          host.window.contentView.addChildView(browser.view);
          browser.attached = true;
          browser.view.setVisible(true);
        }
      }
    }
    for (const member of splitMembers(host)) {
      if (member !== active) this.prepareSplitPartner(host, member);
    }
    // Order the page and shared chrome together so cached content stays covered.
    if (active?.voiceOverlay) { this.detachBrowser(host.window, active); return; }
    this.stackBrowserChrome(host);
    // layout() runs before the website is attached on a cold selection. Its
    // visibility refresh can therefore only see the trusted chrome. Refresh
    // again after attachment and stacking, or an unthrottled Windows renderer
    // can stay hidden forever while readiness waits for its animation frames.
    this.refreshSelectedSurfaces(host);
  }

  private browserPageBounds(host: Host, browser: LiveBrowserPage) {
    const [width, height] = host.window.getContentSize();
    if (typeof width !== "number" || typeof height !== "number") return null;
    const fullscreen = host.browserFullscreen?.contents === browser.contents;
    const pair = fullscreen ? [] : splitMembers(host);
    const index = pair.findIndex(tab => tab.browser === browser);
    const pane = index < 0 ? null : splitPaneBounds(width, height, browserContentTop(height), index);
    const x = fullscreen ? 0 : (pane?.x ?? 0) + browserContentLeft(pane?.width ?? width, browser.terminalOpen, browser.terminalWidth);
    const y = fullscreen ? 0 : browserContentTop(height);
    return { x, y, width: Math.max(1, (pane ? pane.x + pane.width : width) - x - (!fullscreen && browser.organizationOpen ? browserOrganizationWidth(pane?.width ?? width) : 0)), height: Math.max(1, height - y) };
  }

  /**
   * The website under a browser tab's shell is a second view with the same
   * problem as the shell: detached, it may have lost its frame. Attach it at
   * its final size with one pixel inside the window — the column beside the
   * shell's own parked pixel, so neither covers the other and goes hidden —
   * and wait for a frame. `syncBrowser` then only moves it into place.
   */
  private async parkBrowserPage(host: Host, tab: Tab, signal: AbortSignal): Promise<boolean> {
    const browser = liveBrowserPage(tab.browser);
    if (!browser || !browser.ready || browser.showingHome || tab.voiceOverlay || !tab.url) return true;
    const bounds = this.browserPageBounds(host, browser);
    const [width, height = 1] = host.window.getContentSize();
    if (!bounds || typeof width !== "number") return false;
    setViewBounds(browser.view, { x: Math.max(0, width - 2), y: this.preparationTop(host, height) + 1 - bounds.height, width: bounds.width, height: bounds.height });
    // The website exposes two columns at the right edge; the chrome exposes
    // the last one. Put the website BELOW the chrome so each keeps a visible
    // pixel. Raising the wider website here occluded the chrome completely,
    // making its frame check time out and retry indefinitely on Windows.
    // Both parked surfaces must also stay above the outgoing website, which
    // otherwise covers their pixels while a crashed interface is recovering.
    this.raiseViews(host, [browser.view, ...(tab.view ? [tab.view] : []), ...(host.shell ? [host.shell.view] : [])]);
    browser.attached = true;
    browser.view.setVisible(true);
    return waitForRevealFrame(browser.contents, 1500, signal);
  }

  /** Recents overlay the page; opening them never changes its viewport. */
  private stackBrowserChrome(host: Host): void {
    if (host.window.isDestroyed() || (host.pending && !host.pendingAtFront)) return;
    const tab = tabById(host, host.activeId);
    const browser = liveBrowserPage(tab?.browser);
    if (!tab?.view || !tab.attached) return;
    // Only legacy per-tab chrome hosts suggestions. The persistent shell has
    // its own transparent toolbar; raising its opaque home/panels document
    // here would cover the website whenever the address input is focused.
    const chromeOnTop = !host.shellEnabled && browser?.addressSuggestionsOpen && !host.browserFullscreen;
    const views: View[] = [tab.view];
    if (browser?.attached && !browser.showingHome) {
      if (chromeOnTop) views.unshift(browser.view);
      else views.push(browser.view);
    }
    const pair = host.browserFullscreen || tab.voiceOverlay ? [] : splitMembers(host);
    if (pair.length) {
      views.length = 0;
      // Shared browser home/panels cover the background first; independent
      // local documents and native websites are then clipped to their panes.
      const shared = pair.find(member => member.sharedChrome && member.attached && (member.painted || (host.pendingAtFront && member === tab)));
      if (shared?.view) views.push(shared.view);
      for (const member of pair) {
        if (!member.attached || (!member.painted && !(host.pendingAtFront && member === tab))) continue;
        if (member.view && !member.sharedChrome) views.push(member.view);
        const page = liveBrowserPage(member.browser);
        if (page?.attached && (page.ready || (host.pendingAtFront && member === tab)) && !member.voiceOverlay) views.push(page.view);
      }
      if (chromeOnTop && tab.sharedChrome && tab.view) {
        const index = views.indexOf(tab.view);
        if (index >= 0) views.splice(index, 1);
        views.push(tab.view);
      }
      if (host.splitDivider) views.push(host.splitDivider);
    }
    // Raising a content view also raises it above the shared shell. Restore the
    // toolbar before overlays, including on the resident-tab fast path.
    if (host.shellEnabled && host.shell && !host.browserFullscreen && !tab.voiceOverlay) views.push(host.shell.view);
    if (host.inlineAnswer && browser?.view && host.inlineAnswer.ownerId === tab.id) host.inlineAnswer.position(browser.view.getBounds());
    for (const popup of [host.downloadsPopover, host.extensionsPopover, host.inlineAnswer, host.selectionPopover, host.groupPopover]) {
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
    // Move only the views being raised. Reordering every background sibling
    // caused O(tab count) native mutations and invalidated their hit-test data.
    for (const view of views) container.addChildView(view);
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
    if (this.authenticationUrl && !this.authenticatedUser) return;
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
      onOpenLocalTab: (target, background) => this.openLocalTab(overlay.contents, target, background),
      onOpenExternalTab: (target, background) =>
        this.openExternalTab(overlay.contents, target, background),
    });
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const current = () => host.notificationOverlay === overlay &&
      !host.window.isDestroyed() && !overlay.contents.isDestroyed();
    const cancelRetry = () => { clearTimeout(retry); retry = undefined; };
    const reset = () => {
      overlay.ready = false;
      overlay.width = 0;
      overlay.height = 0;
      if (current()) this.layoutNotificationOverlay(host);
    };
    const scheduleRetry = () => {
      if (!current() || retry) return;
      reset();
      const delay = TAB_RECOVERY_DELAYS_MS[Math.min(failures++, TAB_RECOVERY_DELAYS_MS.length - 1)];
      retry = setTimeout(() => { retry = undefined; if (current()) load(); }, delay);
      retry.unref();
    };
    const load = () => {
      if (!current()) return;
      void overlay.contents.loadURL(url).catch(error => {
        if (!current() || error?.code === "ERR_ABORTED") return;
        this.log(`notification overlay failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
        scheduleRetry();
      });
    };
    overlay.contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { cancelRetry(); reset(); }
    });
    overlay.contents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) scheduleRetry();
    });
    overlay.contents.on("did-finish-load", () => { failures = 0; });
    // Unlike ordinary tabs, this window-owned renderer has no track() handler.
    // Stop sending into a dead frame and queue cards until its new size handshake.
    overlay.contents.on("render-process-gone", reset);
    installRendererRecovery(overlay.contents, scheduleRetry);
    overlay.contents.once("destroyed", cancelRetry);
    this.layoutNotificationOverlay(host);
    host.window.contentView.addChildView(view);
    load();
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
      if (overlay.ready && !overlay.contents.isCrashed()) {
        const frame = overlay.contents.mainFrame;
        if (frame && !frame.isDestroyed()) frame.send(IPC_CHANNELS.notificationOverlayVisibility, audible);
      }
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
    // ResizeObserver reports CSS pixels; native View bounds use DIP. The
    // overlay can inherit page zoom from another trusted tab on this origin.
    // Device scale is already handled by Electron and must not be applied here.
    const zoomFactor = overlay.contents.getZoomFactor();
    const width = Math.max(1, Math.min(Math.ceil(overlay.width * zoomFactor), renderWidth));
    const height = Math.max(1, Math.min(Math.ceil(overlay.height * zoomFactor), windowHeight));
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
      if (pasteOnRightClick(contents, event, params)) return;
      if (!isSafeBrowserUrl(params.linkURL) || !isNavigationAllowed(this.options.allowed, params.linkURL)) return;
      event.preventDefault();
      const url = params.linkURL;
      const documentUrl = contents.getURL();
      const open = (inWindow: boolean) => setImmediate(() => {
        if (contents.isDestroyed() || owner.window.isDestroyed() || current() !== owner ||
            owner.activeId !== tab.id || !owner.tabs.includes(tab) || contents.getURL() !== documentUrl) return;
        if (inWindow) this.options.openWindow(url);
        else this.openLocalTab(contents, url, true);
      });
      Menu.buildFromTemplate([
        { id: "open-link-tab", label: "Open Link in New Tab", enabled: this.enabled, click: () => open(false) },
        { id: "open-link-window", label: "Open Link in New Window", click: () => open(true) },
      ]).popup({ window: owner.window });
    });
    contents.on("input-event", (_event, input) => {
      if (!["mouseDown", "touchStart", "rawKeyDown", "keyDown"].includes(input.type)) return;
      const owner = current();
      if (owner && !tab.sharedChrome && tab.painted && !tab.splitPreparation && !owner.pending && !owner.tabDragActive && owner.activeId !== tab.id && splitMembers(owner).includes(tab)) this.activate(owner, tab.id);
    });
    contents.on("found-in-page", (_event, result) => {
      if (!tab.findQuery || result.requestId !== tab.findRequestId) return;
      tab.find = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal,
        query: tab.findQuery, requestId: result.requestId, finalUpdate: result.finalUpdate };
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
      // App pages report unfinished route/data work through page-loading.
      // Chromium's load event also waits for images and child frames: a stuck
      // logo must not leave a fully usable Terminal looking like it is loading.
      if (!tab.browser) this.setTabLoading(tab, false);
      const waiting = tab.onLoaded;
      tab.onLoaded = [];
      // Readiness waiters remove themselves when resolved/cancelled. Drain a
      // snapshot so the preparation waiter cannot skip the selection waiter
      // when a still-loading spare is claimed by the next click.
      for (const resume of waiting.splice(0)) resume();
      const owner = current();
      if (owner && !contents.isDestroyed()) {
        if (owner.tabs.includes(tab)) {
          owner.newTabPreparationFailed = false;
          owner.newTabPreparationRetryAt = undefined;
        }
        this.layout(owner);
        if (owner.activeId === tab.id && !owner.pending) {
          tab.painted = true;
          tab.attached = true;
          owner.presentedId = tab.id;
          owner.presentationStatus = "presented";
        }
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
      const origin = this.authenticationUrl ?? this.sessionDashboardUrl;
      if (origin && isAuthenticationUrl(url, origin)) {
        tab.authReturnTitle ??= tab.title;
        if (!tab.authReturnUrl && tab.url && !isAuthenticationUrl(tab.url, origin)) tab.authReturnUrl = tab.url;
        if (!tab.authReturnUrl) tab.authReturnUrl = new URL(authReturnPath(new URL(url).searchParams.get("callbackUrl"), origin), origin).href;
        if (this.authenticationUrl) void this.synchronizeAuthentication();
      } else { tab.authReturnUrl = undefined; tab.authReturnTitle = undefined; }
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
    contents.on("did-navigate", (_event, url) => {
      tab.documentCommitted = true;
      remember(url);
      const owner = current();
      // Streaming local documents can paint long before DOMContentLoaded.
      if (owner?.shellEnabled && owner.pending === tab) void this.reveal(owner, tab, ++owner.revealToken);
      else if (owner?.shellEnabled && owner.activeId === tab.id && !owner.pending) {
        // An in-place full navigation replaces the render widget too. Give
        // it the same bounded frame/recovery path as a newly selected tab.
        this.present(owner, false);
      }
    });
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
      tab.generation += 1;
      tab.loaded = false;
      tab.documentCommitted = false;
      tab.pageLoading = false;
      tab.painted = false;
      tab.terminalReady = false;
      if (!tab.browser) {
        // The previous page may still have a stalled subresource, so Chromium
        // need not emit another did-start-loading for this new document.
        this.setTabLoading(tab, true);
        if (owner) this.broadcast(owner);
      }
      if (tab.sharedChrome && owner?.browserChrome === tab) {
        for (const browserTab of owner.tabs) {
          if (browserTab.contents !== contents) continue;
          browserTab.generation += 1;
          browserTab.loaded = false;
          browserTab.painted = false;
          browserTab.browser?.paintController?.abort();
          if (browserTab.browser) {
            browserTab.browser.paintController = undefined;
            clearTimeout(browserTab.browser.paintRetry);
          }
        }
        const pending = owner.pending;
        if (pending?.contents === contents) void this.reveal(owner, pending, ++owner.revealToken, owner.pendingNavigation);
      }
      if (owner?.pending === tab) {
        // A frame from the previous document cannot reveal its replacement.
        // Retire the old probe without detaching the outgoing page.
        const token = ++owner.revealToken;
        void this.reveal(owner, tab, token, owner.pendingNavigation);
      }
    });
    contents.on("did-start-loading", () => {
      if (tab.browser || tab.loaded) return;
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
      const owner = current();
      if (owner) {
        // A local navigation replaces Chromium's render widget without
        // replacing the WebContentsView. The old document's visibility cache
        // cannot certify the new widget: on Windows it may still be hidden,
        // leaving the PDF shell on "Opening PDF" until another tab switch.
        // Refresh only selected surfaces, just as we do for browser documents.
        if (tab.view) this.foregroundSurfaceViews.get(owner)?.delete(tab.view);
        this.refreshSelectedSurfaces(owner);
      }
      if (tab === host.base) { this.clearRetiredBaseDragRegion(host); this.layout(host); }
      if (tab.findQuery && owner) void this.searchPage(owner, tab, { type: "browser-find", text: tab.findQuery }, true);
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
    // Electron reports Ctrl+wheel as a zoom request; it does not apply page
    // zoom itself. Use the hovered tab, including an unfocused split pane.
    contents.on("zoom-changed", (_event, direction) => {
      const owner = current();
      if (!owner) return;
      const target = tab.sharedChrome ? tabById(owner, owner.activeId) : tab;
      if (target) this.zoomTab(owner, target, direction);
    });

    if (tab.view && tab !== host.base && !tab.primary) {
      // The window's own page is looked after by window recovery; a view has
      // to look after itself.
      contents.on("did-fail-load", (_event, errorCode, _description, failedUrl, isMainFrame) => {
        // -3 is an intentional aborted navigation, normally a redirect.
        if (!isMainFrame || errorCode === -3) return;
        const owner = current();
        if (owner?.preparedNewTab === tab) {
          this.retryNewTabPreparation(owner);
          return;
        }
        remember(failedUrl);
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url);
      });
      installRendererRecovery(contents, () => {
        const owner = current();
        if (!owner) return;
        if (owner.preparedNewTab === tab) {
          this.retryNewTabPreparation(owner);
          return;
        }
        void this.recover(tab, tab.browser?.shellUrl ?? tab.url, true);
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
    if (browserAction && browserTab && this.toolbarShellUrl(browserTab)) {
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
      const chrome = host.shellEnabled ? host.shell!.contents : active.contents;
      chrome.focus();
      void chrome
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
    if (this.authenticationUrl && !this.authenticatedUser) return;
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
        if (active) this.zoomTab(host, active, shortcut.direction);
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
  private recover(tab: Tab, recoveryUrl = tab.url, rendererCrashed = false): Promise<void> {
    // Startup waits on this promise so restored tabs finish reconnecting
    // behind the loading screen rather than in front of the person.
    if (tab.recovering) return tab.recoveryPromise ?? Promise.resolve();
    const attempt = this.runRecovery(tab, recoveryUrl, rendererCrashed);
    tab.recoveryPromise = attempt;
    void attempt.finally(() => {
      if (tab.recoveryPromise === attempt) tab.recoveryPromise = undefined;
    });
    return attempt;
  }

  private async runRecovery(tab: Tab, recoveryUrl: string | undefined, rendererCrashed: boolean): Promise<void> {
    if (tab.recovering || !recoveryUrl || tab.contents.isDestroyed()) return;
    const directTerminal = rendererCrashed && this.needsTerminalReadiness(tab);
    tab.recovering = true;
    tab.recoveryUrl = recoveryUrl;
    const sceneUrl = pathToFileURL(this.options.recoveryHtmlPath());
    sceneUrl.searchParams.set("theme", this.options.theme());
    const host = this.hostByContents.get(tab.contents.id);
    const sharedBrowser = tab.sharedChrome && host?.browserChrome === tab;
    const attempt: NonNullable<Tab["recoveryAttempt"]> = {
      expectedUrl: sharedBrowser || directTerminal ? recoveryUrl : sceneUrl.toString(), directTerminal,
    };
    tab.recoveryAttempt = attempt;
    const current = () => tab.recoveryAttempt === attempt && !tab.contents.isDestroyed() &&
      this.hostByContents.has(tab.contents.id);
    if (sharedBrowser) {
      // The shared home/panels renderer is not the website. In particular an
      // omnibox dropdown may have raised it above a healthy native page when
      // it crashed. Put that page back on top and recover only the controls.
      for (const member of host.tabs) {
        if (member.contents === tab.contents && member.browser) member.browser.addressSuggestionsOpen = false;
      }
      this.layout(host);
      this.syncBrowser(host);
      // An in-flight tab handoff deliberately suspends normal stacking. Its
      // outgoing website still belongs on top of the failed shared renderer.
      const presented = tabById(host, host.presentedId ?? host.activeId);
      const page = liveBrowserPage(presented?.browser);
      if (page?.attached && !page.showingHome) {
        this.raiseViews(host, [page.view, ...(host.shell ? [host.shell.view] : [])]);
        this.raiseNotificationOverlay(host);
      }
      this.broadcast(host);
    }
    this.log(sharedBrowser ? "restoring browser controls; keeping website documents alive"
      : directTerminal ? "restoring a crashed Terminal directly; waiting for its ready frame"
      : `page lost in a tab; showing the reconnect scene and waiting for ${recoveryUrl}`);
    try {
      if (directTerminal) {
        // Renderer failure does not imply a workspace/server outage. Reload
        // immediately, without navigating to a reconnect document, a backoff,
        // or a second HTTP request for the same page. Tab selection keeps the
        // outgoing surface until the replacement Terminal is actually ready.
        tab.loaded = false;
        tab.documentCommitted = false;
        tab.painted = false;
        tab.terminalReady = false;
        if (await loadRecoveryUrlIfAlive(tab.contents, recoveryUrl)) return;
        if (!current()) return;
        // A real navigation failure still needs the existing offline recovery.
        attempt.directTerminal = false;
        attempt.expectedUrl = sceneUrl.toString();
        this.log("Terminal restore could not reach the workspace; starting connection recovery");
      }
      if (!sharedBrowser) {
        try {
          await tab.contents.loadFile(this.options.recoveryHtmlPath(), {
            query: { theme: this.options.theme() },
          });
        } catch {
          // The scene is a courtesy; the wait below is what brings the page back.
        }
      }
      let retry = 0;
      while (current()) {
        const delay = sharedBrowser && retry === 0 ? 0
          : TAB_RECOVERY_DELAYS_MS[Math.min(retry, TAB_RECOVERY_DELAYS_MS.length - 1)] ?? 5_000;
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
