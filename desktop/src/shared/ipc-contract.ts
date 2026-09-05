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
  tabsCommand: "breadboard:tabs-command",
  tabsState: "breadboard:tabs-state",
  notificationToast: "breadboard:notification-toast",
  getBrowserNavigation: "breadboard:get-browser-navigation",
  setBrowserNavigation: "breadboard:set-browser-navigation",
  getBrowserBookmarks: "breadboard:get-browser-bookmarks",
  setBrowserBookmarks: "breadboard:set-browser-bookmarks",
  getBrowserShortcuts: "breadboard:get-browser-shortcuts",
  setBrowserShortcuts: "breadboard:set-browser-shortcuts",
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
  title: string;
  url: string;
  loading: boolean;
  /** Present only for a sandboxed web page beneath trusted browser chrome. */
  browser?: {
    address: string;
    canGoBack: boolean;
    canGoForward: boolean;
    terminalOpen: boolean;
    terminalWidth: number;
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
  /** The Profile switch. Off, the strip is empty and every shortcut is inert. */
  enabled: boolean;
  activeId: number | null;
  tabs: TabView[];
  /** Unpacked Chromium extensions active in Breadboard's isolated browser profile. */
  extensions: BrowserExtensionView[];
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

export function isBrowserBookmarkOwnerKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 320;
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
  return (
    typeof notice.message === "string" &&
    notice.message.length > 0 &&
    notice.message.length <= 8_192 &&
    (notice.type === "success" || notice.type === "error") &&
    optionalText(notice.title, 256) &&
    optionalText(notice.chatId, 256) &&
    optionalText(notice.response, 100_000)
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
  | { type: "open"; url: string; background?: boolean }
  | { type: "new" }
  | { type: "activate"; id: number }
  | { type: "close"; id?: number }
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
  | { type: "browser-terminal"; open: boolean; width?: number }
  | { type: "browser-address-suggestions"; open: boolean }
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
    case "open":
      return (
        typeof command.url === "string" &&
        (command.background === undefined || typeof command.background === "boolean")
      );
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
      return typeof command.open === "boolean";
    case "browser-extension-reload":
    case "browser-extension-remove":
      return isExtensionId(command.id);
    case "notification-toast":
      return isDesktopNotificationToast(command.notice);
    case "notification-overlay-resize":
      return isNotificationOverlaySize(command.size);
    case "new":
    case "reopen":
    case "back":
    case "forward":
    case "reload":
    case "browser-stop":
    case "browser-extension-load":
      return true;
    default:
      return false;
  }
}
