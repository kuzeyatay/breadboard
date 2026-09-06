import { isTranslationLanguage, notificationOrigin, type BrowserPreferences, type BrowserPreferenceCommand, type BrowserTranslationState } from "./browser-preferences";

export const IPC_CHANNELS = {
  getVersions: "breadboard:get-versions",
  getStartupState: "breadboard:get-startup-state",
  retryService: "breadboard:retry-service",
  openLogs: "breadboard:open-logs",
  copyDiagnostics: "breadboard:copy-diagnostics",
  quit: "breadboard:quit",
  restartApp: "breadboard:restart-app",
  pickFolder: "breadboard:pick-folder",
  openMicrophoneSettings: "breadboard:open-microphone-settings",
  allowThemeLocation: "breadboard:allow-theme-location",
  setTheme: "breadboard:set-theme",
  getStartupSound: "breadboard:get-startup-sound",
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
  tabsCommand: "breadboard:tabs-command",
  tabsState: "breadboard:tabs-state",
  notificationToast: "breadboard:notification-toast",
  getBrowserNavigation: "breadboard:get-browser-navigation",
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
  getClickyState: "breadboard:get-clicky-state",
  launchClicky: "breadboard:launch-clicky",
  openClickyProject: "breadboard:open-clicky-project",
} as const;

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
  | { mode: "sun"; sunriseMinutes: number; sunsetMinutes: number };

/** One tab as the strip draws it. */
export interface TabView {
  id: number;
  anchored: boolean;
  title: string;
  url: string;
  loading: boolean;
  /** Present only for a sandboxed web page beneath trusted browser chrome. */
  browser?: {
    private?: boolean;
    address: string;
    canGoBack: boolean;
    canGoForward: boolean;
    terminalOpen: boolean;
    downloadsOpen?: boolean;
    terminalWidth: number;
    zoomPercent?: number;
    translation?: BrowserTranslationState;
    find?: { matches: number; activeMatchOrdinal: number };
    favicon?: string;
    selection?: {
      text: string;
      title: string;
      url: string;
    };
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
  /** The visible page is waiting for a destination to paint without a loading scene. */
  navigationPending?: boolean;
  /** The receiving page's own tab, which may differ from the selected tab. */
  selfId: number | null;
  tabs: TabView[];
  /** Unpacked Chromium extensions active in Breadboard's isolated browser profile. */
  extensions: BrowserExtensionView[];
  browserPreferences?: BrowserPreferences;
}

export interface BrowserExtensionView {
  id: string;
  name: string;
  version: string;
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
}

export interface BrowserDownloadsSnapshot {
  items: BrowserDownload[];
  error: string | null;
}

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
  message: string;
  type: "success" | "error";
  title?: string;
  chatId?: string;
  response?: string;
  website?: { id: string; origin: string };
  notificationPermission?: { id: string; origin: string };
  dismissed?: boolean;
}

/** The overlay renderer reports only the rectangle occupied by its cards. */
export interface NotificationOverlaySize {
  width: number;
  height: number;
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
    optionalText(notice.title, 256) &&
    optionalText(notice.chatId, 256) &&
    optionalText(notice.response, 100_000) &&
    (notice.dismissed === undefined || typeof notice.dismissed === "boolean") &&
    (permission === undefined || (typeof permission === "object" && permission !== null &&
      typeof (permission as Record<string, unknown>).id === "string" &&
      String((permission as Record<string, unknown>).id).length > 0 &&
      String((permission as Record<string, unknown>).id).length <= 100 &&
      notificationOrigin((permission as Record<string, unknown>).origin) !== null &&
      notificationOrigin((permission as Record<string, unknown>).origin) === (permission as Record<string, unknown>).origin)) &&
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
export type TabsCommand =
  | { type: "voice-overlay"; open: boolean }
  | { type: "voice-open" }
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
  | { type: "move"; id: number; index: number }
  | { type: "reopen" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  /** A sandboxed Chromium page beneath Breadboard's own browser toolbar. */
  | { type: "browser"; url?: string; replaceCurrent?: boolean }
  /** A visible built-in browser page reserved for one browser-agent run. */
  | { type: "browser-agent"; runId: string; url?: string }
  | { type: "browser-navigate"; input: string }
  | { type: "browser-stop" }
  | { type: "browser-menu"; x: number; y: number; profileLabel: string }
  | { type: "browser-find"; text: string; forward?: boolean; findNext?: boolean }
  | { type: "browser-find-close" }
  | { type: "browser-downloads-popover"; x: number; y: number }
  | { type: "browser-downloads-resize"; height: number }
  | { type: "browser-downloads-close" }
  | { type: "browser-downloads-show-all" }
  | { type: "browser-terminal"; open: boolean; width?: number }
  | { type: "browser-address-suggestions"; open: boolean; bottom?: number }
  | { type: "browser-extension-load" }
  | { type: "browser-extension-reload"; id: string }
  | { type: "browser-extension-remove"; id: string }
  /** A page-local notice for the native layer shared by this window's tabs. */
  | { type: "notification-toast"; notice: DesktopNotificationToast }
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
    case "browser-translate":
    case "browser-translation-language":
      return isTranslationLanguage(command.language);
    case "browser-notifications-enabled":
      return typeof command.enabled === "boolean";
    case "browser-notification-permission":
      return notificationOrigin(command.origin) !== null && notificationOrigin(command.origin) === command.origin &&
        ["default", "granted", "denied"].includes(String(command.permission));
    case "browser-notification-action":
      return typeof command.id === "string" && command.id.length <= 100 && ["click", "close"].includes(String(command.action));
    case "browser-notification-permission-response":
      return typeof command.id === "string" && command.id.length > 0 && command.id.length <= 100 &&
        (command.permission === "default" || command.permission === "granted" || command.permission === "denied");
    case "open":
      return (
        typeof command.url === "string" &&
        (command.background === undefined || typeof command.background === "boolean")
      );
    case "anchor":
    case "activate":
      return isId(command.id);
    case "close":
      return command.id === undefined || isId(command.id);
    case "move":
      return isId(command.id) && isId(command.index);
    case "browser":
      return (
        (command.url === undefined || typeof command.url === "string") &&
        (command.replaceCurrent === undefined ||
          typeof command.replaceCurrent === "boolean")
      );
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
      return [command.x, command.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20_000);
    case "browser-downloads-resize":
      return typeof command.height === "number" && Number.isFinite(command.height) && command.height > 0 && command.height <= 600;
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
    case "browser-extension-reload":
    case "browser-extension-remove":
      return isExtensionId(command.id);
    case "notification-toast":
      return isDesktopNotificationToast(command.notice);
    case "notification-overlay-resize":
      return isNotificationOverlaySize(command.size);
    case "new":
    case "voice-open":
    case "browser-translation-menu":
    case "browser-translation-restore":
    case "reopen":
    case "back":
    case "forward":
    case "reload":
    case "browser-stop":
    case "browser-find-close":
    case "browser-downloads-close":
    case "browser-downloads-show-all":
    case "browser-extension-load":
      return true;
    default:
      return false;
  }
}
