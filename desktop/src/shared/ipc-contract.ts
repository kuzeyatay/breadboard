import { isTranslationLanguage, isBrowserMediaPermissionList, isAppLinkScheme, notificationOrigin, type BrowserMediaPermission, type BrowserPreferences, type BrowserPreferenceCommand, type BrowserTranslationState, type SavedPasswordSummary } from "./browser-preferences";
import { isTabGroupId, isTabGroupColor, type TabGroup } from "./tab-groups";
import { normalizeAnnotationTarget } from "./browser-annotations";
import type { BrowserSelection } from "./web-text-selection";
import { isBrowserInlineAnswerState, isBrowserInlineAnswerAction, type BrowserInlineAnswerState, type BrowserInlineAnswerAction } from "./browser-inline-answer";

export const IPC_CHANNELS = {
  getVersions: "breadboard:get-versions",
  getStartupState: "breadboard:get-startup-state",
  retryService: "breadboard:retry-service",
  openLogs: "breadboard:open-logs",
  copyDiagnostics: "breadboard:copy-diagnostics",
  exportDiagnostics: "breadboard:export-diagnostics",
  quit: "breadboard:quit",
  restartApp: "breadboard:restart-app",
  pickFolder: "breadboard:pick-folder",
  openMicrophoneSettings: "breadboard:open-microphone-settings",
  allowThemeLocation: "breadboard:allow-theme-location",
  setTheme: "breadboard:set-theme",
  getThemeState: "breadboard:get-theme-state",
  getStartupSound: "breadboard:get-startup-sound",
  claimStartupSound: "breadboard:claim-startup-sound",
  setStartupSound: "breadboard:set-startup-sound",
  getCurrentLocationPreference: "breadboard:get-current-location-preference",
  setCurrentLocationPreference: "breadboard:set-current-location-preference",
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
  // The floating recording controller shown while a workflow is being taught by
  // demonstration. It has to stay visible over the application being
  // demonstrated, which only the shell can arrange.
  openTeachController: "breadboard:open-teach-controller",
  closeTeachController: "breadboard:close-teach-controller",
  // Browser navigation: the tabs a window carries along its caption strip. The
  // shell owns the tabs (each is its own page, like a browser's); the page only
  // draws the strip from the state it is sent and asks for changes by command.
  getTabsState: "breadboard:get-tabs-state",
  getBrowserTerminalAccess: "breadboard:get-browser-terminal-access",
  spotifyRequest: "breadboard:spotify-request",
  readTerminalData: "breadboard:read-terminal-data",
  cancelTerminalData: "breadboard:cancel-terminal-data",
  textHighlightRequest: "breadboard:text-highlight-request",
  tabsCommand: "breadboard:tabs-command",
  tabsState: "breadboard:tabs-state",
  browserInlineAnswerState: "breadboard:browser-inline-answer-state",
  browserInlineAnswerAction: "breadboard:browser-inline-answer-action",
  notificationToast: "breadboard:notification-toast",
  chatNotificationDelivered: "breadboard:chat-notification-delivered",
  notificationOverlayVisibility: "breadboard:notification-overlay-visibility",
  getBrowserNavigation: "breadboard:get-browser-navigation",
  getBrowserSignIns: "breadboard:get-browser-sign-ins",
  openBrowserSignIn: "breadboard:open-browser-sign-in",
  // The ChatGPT tab lent to ChatMock's "OpenAI (web)" provider: a Breadboard
  // page relays ChatMock's request for it and hands back the CDP target.
  chatgptWebTab: "breadboard:chatgpt-web-tab",
  resetBrowserSignIns: "breadboard:reset-browser-sign-ins",
  setBrowserNavigation: "breadboard:set-browser-navigation",
  getBrowserBookmarks: "breadboard:get-browser-bookmarks",
  setBrowserBookmarks: "breadboard:set-browser-bookmarks",
  getBrowserShortcuts: "breadboard:get-browser-shortcuts",
  setBrowserShortcuts: "breadboard:set-browser-shortcuts",
  getBrowserRecentSearches: "breadboard:get-browser-recent-searches",
  getBrowserHistory: "breadboard:get-browser-history",
  browserHistoryCommand: "breadboard:browser-history-command",
  browserHistoryChanged: "breadboard:browser-history-changed",
  setBrowserRecentSearches: "breadboard:set-browser-recent-searches",
  getBrowserDownloads: "breadboard:get-browser-downloads",
  browserDownloadCommand: "breadboard:browser-download-command",
  savePdfDownload: "breadboard:save-pdf-download",
  getDownloadSettings: "breadboard:get-download-settings",
  setDownloadPrompt: "breadboard:set-download-prompt",
  chooseDownloadDirectory: "breadboard:choose-download-directory",
  openLocalPath: "breadboard:open-local-path",
  gestureControl: "breadboard:gesture-control",
  codeDock: "breadboard:code-dock",
} as const;

/** Open a produced folder in the file explorer, or reveal a produced file. */
export interface OpenLocalPathRequest {
  /** Absolute path on this machine. Relative paths are refused. */
  path: string;
  /** For a file: select it in its folder. Files are never launched. */
  reveal?: boolean;
}

export type OpenLocalPathResult =
  | { ok: true; opened: "folder" | "revealed" }
  | { ok: false; code: "invalid_path" | "not_found" | "open_failed" | "unsupported"; error: string };

export interface ClickyLauncherState {
  supported: boolean;
  available: boolean;
  projectAvailable: boolean;
  status: "ready" | "unsupported" | "not_built" | "not_found";
  message: string;
}

export interface ClickyLaunchResult {
  ok: boolean;
  code:
    | "launched"
    | "unsupported"
    | "not_built"
    | "not_found"
    | "launch_failed"
    | "project_opened"
    | "project_open_failed";
  message: string;
  state: ClickyLauncherState;
}

/**
 * How the dashboard is choosing its theme, sent with every theme it applies.
 *
 * With "Sunrise to sunset" on, the dashboard follows the sun and the two
 * times are the local-clock minutes of that day's sunrise and sunset as it
 * computed them. They are what the shell needs to open the next launch on the
 * right side of the day before the dashboard has painted, without holding the
 * coordinates they were computed from. Sunrise moves by a minute or two a day,
 * so a launch weeks later may be off around the edges; the dashboard settles
 * the exact answer on its first paint.
 */
export type WindowThemeSchedule =
  | { mode: "manual" }
  | { mode: "sun"; sunriseMinutes: number; sunsetMinutes: number; overrideUntil?: number };

/** One tab as the strip draws it. */
export interface TabView {
  /** Temporary app or browser tab opened by an AI task. */
  aiOpened?: boolean;
  highlighted?: boolean;
  downloadsOpen?: boolean;
  generation?: number;
  find?: { matches: number; activeMatchOrdinal: number };
  groupId?: string;
  id: number;
  anchored: boolean;
  title: string;
  url: string;
  loading: boolean;
  pageLoading?: boolean;
  learnActive?: boolean;
  /** Present only for a sandboxed web page beneath trusted browser chrome. */
  browser?: {
    aiOpened?: boolean;
    private?: boolean;
    address: string;
    /** The native document can cover the trusted browser home. */
    pageReady?: boolean;
    uiVisited?: boolean;
    uiKey?: string;
    canGoBack: boolean;
    canGoForward: boolean;
    terminalOpen: boolean;
    organizationOpen?: boolean;
    annotationTarget?: import("./browser-annotations").BrowserAnnotationTarget;
    downloadsOpen?: boolean;
    extensionsOpen?: boolean;
    hls?: { streams: BrowserHlsStream[]; available: boolean };
    adBlock?: { enabled: boolean; available: boolean; site: string | null; siteEnabled: boolean; blocked: number };
    vpn?: { enabled: boolean; status: "off" | "connecting" | "on" | "error" };
    terminalWidth: number;
    zoomPercent?: number;
    translation?: BrowserTranslationState;
    find?: { matches: number; activeMatchOrdinal: number };
    favicon?: string;
    selection?: BrowserSelection;
  };
}

/**
 * Everything a page needs to draw the tab strip of the window it is in. Sent
 * to every tab of that window whenever any of it changes, so a tab brought to
 * the front already has the strip drawn by the time it is seen.
 */
export interface TabsState {
  windowFocused?: boolean;
  /** The Profile switch. Off, the strip is empty and every shortcut is inert. */
  enabled: boolean;
  activeId: number | null;
  presentedId?: number | null;
  /** Native content currently in front, including an outgoing page during preparation. */
  visibleId?: number | null;
  /** Presented panes that can be read, including the inactive split partner. */
  visibleIds?: number[];
  notificationPageVisible?: boolean;
  /** Uncovered native pixels in the receiving renderer's CSS viewport; [] means unseen. */
  notificationVisibleRects?: Array<{ x: number; y: number; width: number; height: number }>;
  /** Available notification layout space in CSS pixels, independent of card bounds. */
  notificationViewport?: NotificationOverlaySize;
  presentationRevision?: number;
  presentationStatus?: "pending" | "presented" | "failed";
  persistentShell?: boolean;
  contentHeight?: number;
  theme?: "light" | "dark";
  browserOwnerKey?: string;
  /** The visible page is waiting for a destination to paint without a loading scene. */
  navigationPending?: boolean;
  /** The receiving page's own tab, which may differ from the selected tab. */
  selfId: number | null;
  /** This hidden Terminal is preparing its initial widgets for the next open. */
  preparingNewTab?: boolean;
  tabs: TabView[];
  groups?: TabGroup[];
  savedGroups?: Array<TabGroup & { tabCount: number }>;
  /** Unpacked Chromium extensions active in Breadboard's isolated browser profile. */
  extensions: BrowserExtensionView[];
  browserPreferences?: BrowserPreferences;
  /** Saved website sign-ins (origin and username only) for Browser settings. */
  savedPasswords?: SavedPasswordSummary[];
}

export interface BrowserExtensionView {
  id: string;
  name: string;
  version: string;
  iconUrl?: string;
  action?: { title: string; badge: string; menus: Array<{id: string; title: string; checked?: boolean}> };
}

/** A Breadboard page asking for the shell's ChatGPT tab on ChatMock's behalf. */
export interface ChatgptWebTabRequest {
  /** Bring the tab (and its window) in front of the person, for signing in. */
  foreground: boolean;
  /**
   * Throw the current page away and build a new one. ChatMock asks for this
   * when the page it attached to has stopped answering DevTools - a crashed
   * renderer keeps its target listed, so only a new page recovers it.
   */
  reset?: boolean;
  /**
   * Which page ChatMock wants: "interactive" (a person's chat, signing in) or
   * "batch" (Learn, the council). Each lane is its own page, so a long batch
   * turn never occupies the chat composer. Absent from an older ChatMock,
   * which then gets the interactive page.
   */
  lane?: string;
  /**
   * ChatGPT voice: true lets this page use the microphone (chatgpt.com, audio
   * only) until a later request says false. Absent leaves it as it is.
   */
  microphone?: boolean;
}

/**
 * The tab's DevTools address, or why the shell could not provide one. `lane`
 * echoes the page handed out; ChatMock reads its presence as "this shell
 * keeps a page per lane" and otherwise shares the one page as before.
 */
export type ChatgptWebTabResult =
  | { ok: true; cdpPort: number; targetId: string; lane: string }
  | { ok: false; error: string };

export function isChatgptWebTabRequest(value: unknown): value is ChatgptWebTabRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { foreground, reset, lane, microphone } = value as {
    foreground?: unknown; reset?: unknown; lane?: unknown; microphone?: unknown;
  };
  return (
    typeof foreground === "boolean" &&
    (reset === undefined || typeof reset === "boolean") &&
    (microphone === undefined || typeof microphone === "boolean") &&
    (lane === undefined || (typeof lane === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(lane)))
  );
}

export interface BrowserSignInsState {
  /** Sites with recognized login sessions; cookie material never leaves main. */
  sites: string[];
  openPages: number;
}

export interface BrowserBookmark {
  url: string;
  title: string;
  iconUrl: string;
}

export interface BrowserDownload {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  startedAt: number;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  active: boolean;
  error?: string;
  progress?: { completed: number; total: number };
  /** Native flows with their own UI keep it open instead of stealing focus. */
  autoOpen?: boolean;
}

/** Detected URLs and request credentials stay in main; commands carry an opaque ID. */
export interface BrowserHlsStream {
  id: string;
  label: string;
  host: string;
  state: "detected" | "preparing" | "downloading" | "completed" | "error";
  error?: string;
}

export interface BrowserDownloadsSnapshot {
  items: BrowserDownload[];
  error: string | null;
}

export interface DownloadSettingsState {
  directory: string;
  askWhereToSave: boolean;
}

export type DownloadSettingsResult =
  | { ok: true; settings: DownloadSettingsState }
  | { ok: false; error: string };

/** The desktop chooses the destination; renderers cannot supply a path. */
export interface SavePdfDownloadRequest {
  filename: string;
  data: ArrayBuffer;
}

export type SavePdfDownloadResult =
  | { ok: true; filename: string; savePath: string }
  | { ok: false; error: string; cancelled?: boolean };

export type BrowserDownloadCommand =
  | { type: "open" | "show" | "cancel" | "remove"; id: string }
  | { type: "clear" };

export function isBrowserDownloadCommand(value: unknown): value is BrowserDownloadCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  return command.type === "clear" || (
    ["open", "show", "cancel", "remove"].includes(String(command.type)) &&
    typeof command.id === "string" && command.id.length > 0 && command.id.length <= 100
  );
}

export function isBrowserBookmarkOwnerKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 320;
}

export function isBrowserRecentSearches(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 80 && value.every((entry) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= 300 && entry === entry.trim(),
  ) && new Set(value).size === value.length;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export interface BrowserHistorySnapshot {
  items: BrowserHistoryEntry[];
  error: string | null;
}

export type BrowserHistoryCommand = { type: "clear" } | { type: "remove"; url: string };

export function isBrowserHistoryCommand(value: unknown): value is BrowserHistoryCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  return command.type === "clear" || (command.type === "remove" && typeof command.url === "string");
}

/** Keep the renderer-to-disk bookmark payload small and display-safe. */
export function isBrowserBookmarks(value: unknown): value is BrowserBookmark[] {
  if (!Array.isArray(value) || value.length > 40) return false;
  const urls = new Set<string>();
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const bookmark = entry as Record<string, unknown>;
    if (
      typeof bookmark.url !== "string" ||
      typeof bookmark.title !== "string" ||
      typeof bookmark.iconUrl !== "string" ||
      bookmark.title.trim().length === 0 ||
      bookmark.title.length > 100 ||
      bookmark.iconUrl.length > 2_048
    ) {
      return false;
    }
    try {
      const page = new URL(bookmark.url);
      if ((page.protocol !== "http:" && page.protocol !== "https:") || urls.has(page.toString())) {
        return false;
      }
      urls.add(page.toString());
      if (/^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/iu.test(bookmark.iconUrl)) {
        return true;
      }
      const icon = new URL(bookmark.iconUrl);
      return icon.protocol === "http:" || icon.protocol === "https:";
    } catch {
      return false;
    }
  });
}

/** A process-local notice forwarded from whichever Breadboard tab produced it
 * to the one window-level overlay that remains above every tab surface. */
export interface DesktopNotificationToast {
  id?: string;
  message: string;
  type: "success" | "error";
  title?: string;
  chatId?: string;
  response?: string;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string; media?: BrowserMediaPermission[] };
  dismissed?: boolean;
}

/** The overlay renderer reports only the rectangle occupied by its cards. */
export interface NotificationOverlaySize {
  width: number;
  height: number;
}

/** Only the trusted notification overlay may publish these pending chat cards. */
export interface DesktopChatNotification {
  id: string;
  title: string;
  body: string;
  urls: string[];
  rect: { x: number; y: number; width: number; height: number } | null;
  delivered: boolean;
  soundEnabled: boolean;
}

export function isDesktopChatNotifications(value: unknown): value is DesktopChatNotification[] {
  return Array.isArray(value) && value.length <= 100 && value.every(card => {
    if (!card || typeof card !== 'object') return false;
    const text = (value: unknown, limit: number) => typeof value === 'string' && value.length > 0 && value.length <= limit;
    const rect = card.rect;
    return text(card.id, 256) && text(card.title, 256) && text(card.body, 8192) &&
      Array.isArray(card.urls) && card.urls.length > 0 && card.urls.length <= 8 && card.urls.every((url: unknown) => text(url, 2048)) &&
      typeof card.delivered === 'boolean' && typeof card.soundEnabled === 'boolean' &&
      (rect === null || (rect && ['x','y','width','height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]) && Math.abs(rect[key]) <= 100_000) && rect.width > 0 && rect.height > 0));
  });
}

export function isDesktopNotificationToast(value: unknown): value is DesktopNotificationToast {
  if (!value || typeof value !== "object") return false;
  const notice = value as Record<string, unknown>;
  const optionalText = (field: unknown, maximum: number) =>
    field === undefined || (typeof field === "string" && field.length <= maximum);
  const permission = notice.notificationPermission;
  return (
    typeof notice.message === "string" &&
    notice.message.length > 0 &&
    notice.message.length <= 8_192 &&
    (notice.type === "success" || notice.type === "error") &&
    (notice.id === undefined || (typeof notice.id === "string" && notice.id.length > 0 && notice.id.length <= 256)) &&
    optionalText(notice.title, 256) &&
    optionalText(notice.chatId, 256) &&
    optionalText(notice.response, 100_000) &&
    (notice.dismissed === undefined || typeof notice.dismissed === "boolean") &&
    (permission === undefined || (typeof permission === "object" && permission !== null &&
      typeof (permission as Record<string, unknown>).id === "string" &&
      String((permission as Record<string, unknown>).id).length > 0 &&
      String((permission as Record<string, unknown>).id).length <= 100 &&
      notificationOrigin((permission as Record<string, unknown>).origin) !== null &&
      notificationOrigin((permission as Record<string, unknown>).origin) === (permission as Record<string, unknown>).origin &&
      ((permission as Record<string, unknown>).media === undefined || isBrowserMediaPermissionList((permission as Record<string, unknown>).media)))) &&
    (notice.website === undefined || (typeof notice.website === "object" && notice.website !== null &&
      typeof (notice.website as Record<string, unknown>).id === "string" &&
      String((notice.website as Record<string, unknown>).id).length <= 100 &&
      notificationOrigin((notice.website as Record<string, unknown>).origin) === (notice.website as Record<string, unknown>).origin))
  );
}

export function isNotificationOverlaySize(value: unknown): value is NotificationOverlaySize {
  if (!value || typeof value !== "object") return false;
  const size = value as Record<string, unknown>;
  return (
    typeof size.width === "number" &&
    Number.isFinite(size.width) &&
    size.width >= 0 &&
    size.width <= 10_000 &&
    typeof size.height === "number" &&
    Number.isFinite(size.height) &&
    size.height >= 0 &&
    size.height <= 10_000
  );
}

/** What a page may ask the shell to do with the tabs of its own window. */
export type TabsCommand = TabsAction & { targetTabId?: number; generation?: number; presentationRevision?: number };

type TabsAction =
  | { type: "browser-adblock-enabled"; enabled: boolean }
  | { type: "browser-vpn-enabled"; enabled: boolean }
  | { type: "browser-adblock-site-enabled"; enabled: boolean; site: string }
  | { type: "browser-shell-context"; ownerKey: string }
  | { type: "page-loading"; id: number; documentGeneration: number; pending: boolean }
  | { type: "auth-sync" }
  | { type: "navigation-check"; url: string }
  | { type: "notification-targets"; urls: string[] }
  | { type: "notification-open"; urls: string[] }
  | { type: "learn-activity"; gardenId: string; active: boolean }
  | { type: "voice-overlay"; open: boolean }
  | { type: "voice-open"; conversationKey?: string }
  | BrowserPreferenceCommand
  | { type: "browser-translate"; language: string }
  | { type: "browser-translation-menu" }
  | { type: "browser-translation-restore" }
  | { type: "browser-notification-action"; id: string; action: "click" | "close" }
  | { type: "browser-notification-permission-response"; id: string; permission: NotificationPermission }
  | { type: "open"; url: string; background?: boolean }
  | { type: "new" }
  | { type: "activate"; id: number }
  | { type: "close"; id?: number }
  | { type: "anchor"; id: number }
  | { type: "tab-menu"; id: number; x: number; y: number }
  | { type: "move"; id: number; index: number; groupId?: string | null }
  | { type: "group-move"; groupId: string; index: number; parentId?: string | null }
  | { type: "group-tabs"; id: number; targetId: number }
  | { type: "split-tabs"; id: number; targetId: number; side: "left" | "right" }
  | { type: "tab-drag"; active: boolean; preview?: boolean }
  | { type: "group-update"; groupId: string; name?: string; color?: TabGroup["color"]; collapsed?: boolean; split?: boolean }
  | { type: "group-action"; groupId: string; action: "new-tab" | "new-subgroup" | "ungroup" | "delete" | "copy-links" | "save-close" | "restore" | "delete-saved" | "new-window" | "neutralize" | "show-ai-info" }
  | { type: "group-menu"; groupId?: string; x: number; y: number }
  | { type: "group-menu-resize"; height: number }
  | { type: "group-menu-close" }
  | { type: "reopen" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  /** A sandboxed Chromium page beneath Breadboard's own browser toolbar. */
  | { type: "browser"; url?: string; replaceCurrent?: boolean }
  /** A background browser page reserved for one browser-agent run. */
  | { type: "browser-agent"; runId: string; url?: string }
  | { type: "browser-agent-close"; runId: string }
  | { type: "browser-navigate"; input: string }
  | { type: "browser-stop" }
  | { type: "browser-menu"; x: number; y: number; profileLabel: string }
  | { type: "browser-find"; text: string; forward?: boolean; findNext?: boolean }
  | { type: "browser-find-close" }
  | { type: "browser-downloads-popover"; x: number; y: number }
  | { type: "browser-downloads-resize"; height: number }
  | { type: "browser-downloads-close" }
  | { type: "browser-downloads-show-all" }
  | { type: "browser-extensions-popover"; x: number; y: number }
  | { type: "browser-extensions-resize"; height: number }
  | { type: "browser-selection-resize"; height: number }
  | { type: "browser-selection-close" }
  | { type: "browser-selection-action"; action: "highlight" | "note" | "remove" | "chat" | "inline"; value?: string | null }
  | { type: "browser-selection-conversation"; id: string; url: string; conversationId: string }
  | { type: "browser-selection-delete"; id: string; url: string }
  | { type: "browser-answer-ready" }
  | { type: "browser-answer-state"; state: BrowserInlineAnswerState }
  | { type: "browser-answer-action"; action: BrowserInlineAnswerAction }
  | { type: "browser-answer-resize"; width: number; height: number }
  | { type: "browser-answer-move"; dx: number; dy: number }
  | { type: "browser-extensions-close" }
  | { type: "browser-extensions-picture-in-picture" }
  | { type: "browser-hls-download"; id: string }
  | { type: "browser-terminal"; open: boolean; width?: number }
  | { type: "browser-organization"; open: boolean }
  | { type: "browser-organization-selection" }
  | { type: "browser-organization-target"; target: import("./browser-annotations").BrowserAnnotationTarget }
  | { type: "browser-organization-markers"; items: Array<{ id: string; target: import("./browser-annotations").BrowserAnnotationTarget }> }
  | { type: "browser-address-suggestions"; open: boolean; bottom?: number }
  | { type: "browser-extension-load" }
  | { type: "browser-extension-action"; id: string; menuId?: string }
  | { type: "browser-extension-reload"; id: string }
  | { type: "browser-extension-remove"; id: string }
  /** A page-local notice for the native layer shared by this window's tabs. */
  | { type: "notification-toast"; notice: DesktopNotificationToast }
  | { type: "notification-chat-delivery"; cards: DesktopChatNotification[] }
  /** The overlay renderer's current interactive rectangle. */
  | { type: "notification-overlay-resize"; size: NotificationOverlaySize };

/** A renderer is not trusted to have sent a command of the shape above. */
export function isTabsCommand(value: unknown): value is TabsCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  const isId = (id: unknown) => typeof id === "number" && Number.isInteger(id) && id >= 0;
  const isExtensionId = (id: unknown) =>
    typeof id === "string" && /^[a-p]{32}$/u.test(id);
  switch (command.type) {
    case "browser-adblock-enabled":
    case "browser-vpn-enabled": return typeof command.enabled === "boolean";
    case "browser-adblock-site-enabled":
      return typeof command.enabled === "boolean" && typeof command.site === "string" && command.site.length > 0 && command.site.length <= 253;
    case "browser-shell-context": return typeof command.ownerKey === "string" && command.ownerKey.length <= 256;
    case "page-loading": return Number.isSafeInteger(command.id) && Number.isSafeInteger(command.documentGeneration) && typeof command.pending === "boolean";
    case "auth-sync": return true;
    case "notification-targets":
    case "notification-open":
      return Array.isArray(command.urls) && command.urls.length <= 8 &&
        (command.type === "notification-targets" || command.urls.length > 0) &&
        command.urls.every(url => typeof url === "string" && url.length > 0 && url.length <= 8_192);
    case "learn-activity":
      return typeof command.active === "boolean" &&
        typeof command.gardenId === "string" && command.gardenId.length > 0 &&
        command.gardenId.length <= 1_024;
    case "browser-translate":
    case "browser-translation-language":
      return isTranslationLanguage(command.language);
    case "browser-notifications-enabled":
      return typeof command.enabled === "boolean";
    case "browser-media-permission":
      return isBrowserMediaPermissionList(command.media) && typeof command.origin === "string" &&
        notificationOrigin(command.origin) === command.origin &&
        (command.permission === "default" || command.permission === "granted" || command.permission === "denied");
    case "browser-app-link":
      return typeof command.origin === "string" && notificationOrigin(command.origin) === command.origin &&
        isAppLinkScheme(command.scheme) && typeof command.allowed === "boolean";
    case "browser-password-delete":
      return typeof command.origin === "string" && command.origin.length <= 2_048 &&
        typeof command.username === "string" && command.username.length <= 512;
    case "browser-notification-permission":
      return notificationOrigin(command.origin) !== null && notificationOrigin(command.origin) === command.origin &&
        ["default", "granted", "denied"].includes(String(command.permission));
    case "browser-notification-action":
      return typeof command.id === "string" && command.id.length <= 100 && ["click", "close"].includes(String(command.action));
    case "browser-notification-permission-response":
      return typeof command.id === "string" && command.id.length > 0 && command.id.length <= 100 &&
        (command.permission === "default" || command.permission === "granted" || command.permission === "denied");
    case "navigation-check":
      return typeof command.url === "string" && command.url.length > 0 && command.url.length <= 8_192;
    case "open":
      return (
        typeof command.url === "string" &&
        (command.background === undefined || typeof command.background === "boolean")
      );
    case "anchor":
    case "activate":
      return isId(command.id);
    case "tab-menu":
      return isId(command.id) &&
        [command.x, command.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000);
    case "close":
      return command.id === undefined || isId(command.id);
    case "move":
      return isId(command.id) && isId(command.index) && (command.groupId == null || isTabGroupId(command.groupId));
    case "group-move":
      return isTabGroupId(command.groupId) && isId(command.index) && (command.parentId == null || isTabGroupId(command.parentId));
    case "tab-drag":
      return typeof command.active === "boolean" && (command.preview === undefined || typeof command.preview === "boolean");
    case "split-tabs":
      return isId(command.id) && isId(command.targetId) && command.id !== command.targetId && (command.side === "left" || command.side === "right");
    case "group-tabs":
      return isId(command.id) && isId(command.targetId) && command.id !== command.targetId;
    case "group-update":
      return isTabGroupId(command.groupId) &&
        (command.name === undefined || (typeof command.name === "string" && command.name.length <= 80)) &&
        (command.color === undefined || isTabGroupColor(command.color)) &&
        (command.collapsed === undefined || typeof command.collapsed === "boolean") &&
        (command.split === undefined || typeof command.split === "boolean");
    case "group-action":
      return isTabGroupId(command.groupId) && ["new-tab", "new-subgroup", "ungroup", "delete", "copy-links", "save-close", "restore", "delete-saved", "new-window", "neutralize", "show-ai-info"].includes(String(command.action));
    case "group-menu":
      return (command.groupId === undefined || isTabGroupId(command.groupId)) &&
        [command.x, command.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000);
    case "group-menu-resize":
      return typeof command.height === "number" && Number.isFinite(command.height) && command.height > 0 && command.height <= 10_000;
    case "group-menu-close":
      return true;
    case "browser":
      return (
        (command.url === undefined || typeof command.url === "string") &&
        (command.replaceCurrent === undefined ||
          typeof command.replaceCurrent === "boolean")
      );
    case "browser-agent-close":
      return typeof command.runId === "string" && /^job_[0-9a-f]{64}$/u.test(command.runId);
    case "browser-agent":
      return (
        typeof command.runId === "string" &&
        /^job_[0-9a-f]{64}$/u.test(command.runId) &&
        (command.url === undefined || typeof command.url === "string")
      );
    case "browser-navigate":
      return typeof command.input === "string" && command.input.length <= 8_192;
    case "browser-menu":
      return typeof command.profileLabel === "string" && command.profileLabel.length <= 320 &&
        [command.x, command.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000);
    case "browser-find":
      return typeof command.text === "string" && command.text.length <= 1_000 &&
        (command.forward === undefined || typeof command.forward === "boolean") &&
        (command.findNext === undefined || typeof command.findNext === "boolean");
    case "browser-downloads-popover":
    case "browser-extensions-popover":
      return [command.x, command.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000);
    case "browser-downloads-resize":
    case "browser-extensions-resize":
    case "browser-selection-resize":
      return typeof command.height === "number" && Number.isFinite(command.height) && command.height > 0 && command.height <= 600;
    case "browser-selection-action":
      return ["highlight", "note", "remove", "chat", "inline"].includes(command.action as string) &&
        (command.value === undefined || command.value === null || (typeof command.value === "string" && command.value.length <= 4000)) &&
        (command.action !== "highlight" || ["blue", "green", "pink", "purple"].includes(command.value as string));
    case "browser-answer-state": return isBrowserInlineAnswerState(command.state);
    case "browser-answer-action": return isBrowserInlineAnswerAction(command.action);
    case "browser-answer-resize":
      return [command.width, command.height].every(value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 3000);
    case "browser-answer-move":
      return [command.dx, command.dy].every(value => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 20000);
    case "browser-selection-delete":
      return typeof command.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.id) &&
        typeof command.url === "string" && command.url.length <= 1800;
    case "browser-selection-conversation":
      return typeof command.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.id) &&
        typeof command.url === "string" && command.url.length <= 1800 &&
        typeof command.conversationId === "string" && /^conv_[A-Za-z0-9_-]{1,120}$/.test(command.conversationId);
    case "browser-organization": return typeof command.open === "boolean";
    case "browser-organization-enabled": return typeof command.enabled === "boolean";
    case "browser-organization-selection": return true;
    case "browser-organization-target": return normalizeAnnotationTarget(command.target) !== null;
    case "browser-organization-markers": return Array.isArray(command.items) && command.items.length <= 200 && command.items.every((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const value = item as { id?: unknown; target?: unknown };
      return typeof value.id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value.id) && normalizeAnnotationTarget(value.target) !== null;
    });
    case "browser-terminal":
      return (
        typeof command.open === "boolean" &&
        (command.width === undefined ||
          (typeof command.width === "number" &&
            Number.isFinite(command.width) &&
            Number.isInteger(command.width) &&
            command.width >= 320 &&
            command.width <= 1_600))
      );
    case "browser-address-suggestions":
      return typeof command.open === "boolean" &&
        (command.bottom === undefined ||
          (typeof command.bottom === "number" && Number.isFinite(command.bottom) &&
            command.bottom >= 0 && command.bottom <= 20_000));
    case "voice-overlay":
      return typeof command.open === "boolean";
    case "voice-open":
      return command.conversationKey === undefined ||
        (typeof command.conversationKey === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(command.conversationKey));
    case "browser-hls-download":
      return typeof command.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.id);
    case "browser-extension-reload":
    case "browser-extension-remove":
      return isExtensionId(command.id);
    case "notification-toast":
      return isDesktopNotificationToast(command.notice);
    case "notification-chat-delivery":
      return isDesktopChatNotifications(command.cards);
    case "notification-overlay-resize":
      return isNotificationOverlaySize(command.size);
    case "new":
    case "browser-translation-menu":
    case "browser-translation-restore":
    case "reopen":
    case "back":
    case "forward":
    case "reload":
    case "browser-stop":
    case "browser-find-close":
    case "browser-downloads-close":
    case "browser-extensions-close":
    case "browser-selection-close":
    case "browser-answer-ready":
    case "browser-extensions-picture-in-picture":
    case "browser-downloads-show-all":
    case "browser-extension-load":
      return true;
    case "browser-extension-action":
      return isExtensionId(command.id) &&
        (command.menuId === undefined || (typeof command.menuId === "string" && command.menuId.length > 0 && command.menuId.length <= 500));
    default:
      return false;
  }
}
