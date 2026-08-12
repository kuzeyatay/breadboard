/**
 * Turning a blocked microphone into something the user can act on.
 *
 * `getUserMedia` reports every refusal as the same NotAllowedError, but the fix
 * differs completely depending on who refused: this page's permission inside
 * the browser, the operating system's privacy switch, or nobody at all when the
 * prompt was dismissed before it was answered. "Allow it in system or browser
 * settings" leaves the user exactly where the error found them — they have to
 * guess which of the two, and then find it.
 *
 * So this module names the blocker from the evidence the browser does give
 * (the permission state for the origin, and the wording Chromium puts in the
 * exception), and returns the steps for that blocker plus the one address the
 * app is allowed to open on the user's behalf.
 */

/**
 * `ask` is the one that can be fixed without leaving the page: the browser has
 * not stored a refusal, so requesting again pops the native prompt. `browser`
 * is a stored refusal, which no page is allowed to undo — only the browser's
 * own UI can.
 */
export type MicrophoneBlockSource = "ask" | "browser" | "system" | "unknown";

/** What `navigator.permissions` reports, or null where it reports nothing. */
export type MicrophonePermissionState = "granted" | "denied" | "prompt" | null;

export interface MicrophoneEnvironment {
  userAgent?: string;
  /** `navigator.userAgentData.platform`, `navigator.platform` or `process.platform`. */
  platform?: string;
  /** The Electron shell, which can open the OS privacy page for us. */
  desktopShell?: boolean;
  /** The origin's stored permission, where the browser exposes one. */
  permission?: MicrophonePermissionState;
  /** The DOMException message; Chromium names the system denial in it. */
  message?: string;
}

export interface MicrophoneFixAction {
  label: string;
  /** What to do by hand if every automatic route fails. */
  manual: string | null;
}

export interface MicrophoneFix {
  source: MicrophoneBlockSource;
  headline: string;
  steps: string[];
  action: MicrophoneFixAction | null;
  /** An address browsers refuse to open from a link, so it is copied instead. */
  copy: { label: string; value: string } | null;
  /** What to call the retry, when asking again is itself the fix. */
  retryLabel: string | null;
  /** The browser's own words, so a wrong guess here is checkable. */
  detail: string | null;
}

type BrowserName = "chrome" | "edge" | "brave" | "opera" | "firefox" | "safari" | "unknown";
type OsName = "windows" | "macos" | "linux" | "unknown";

const BROWSER_LABELS: Record<BrowserName, string> = {
  chrome: "Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  opera: "Opera",
  firefox: "Firefox",
  safari: "Safari",
  unknown: "your browser",
};

/** Site-permission pages, which browsers refuse to open from a web page. */
const BROWSER_SETTINGS: Record<BrowserName, string | null> = {
  chrome: "chrome://settings/content/microphone",
  edge: "edge://settings/content/microphone",
  brave: "brave://settings/content/microphone",
  opera: "opera://settings/content/microphone",
  firefox: "about:preferences#privacy",
  safari: null,
  unknown: null,
};

/** Privacy pages the OS registers a protocol for, so a link can reach them. */
const SYSTEM_SETTINGS: Record<OsName, string | null> = {
  windows: "ms-settings:privacy-microphone",
  macos: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  linux: null,
  unknown: null,
};

const SYSTEM_LABELS: Record<OsName, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "system",
  unknown: "system",
};

export function detectBrowser(userAgent = ""): BrowserName {
  // Edg/ on desktop, EdgA/ on Android, EdgiOS/ on iOS, Edge/ on the old engine.
  if (/\bEdg(e|A|iOS)?\//i.test(userAgent)) return "edge";
  if (/\bOPR\/|\bOpera\//i.test(userAgent)) return "opera";
  if (/\bBrave\//i.test(userAgent)) return "brave";
  if (/\bFirefox\/|\bFxiOS\//i.test(userAgent)) return "firefox";
  if (/\bChrom(e|ium)\/|\bCriOS\//i.test(userAgent)) return "chrome";
  if (/\bSafari\//i.test(userAgent)) return "safari";
  return "unknown";
}

export function detectOs(platform = "", userAgent = ""): OsName {
  const hint = `${platform} ${userAgent}`.toLowerCase();
  if (/mac|darwin|iphone|ipad|ipod/.test(hint)) return "macos";
  if (/win/.test(hint)) return "windows";
  if (/linux|android|x11|cros/.test(hint)) return "linux";
  return "unknown";
}

/**
 * Name who refused, from the two signals a browser actually gives.
 *
 * The permission state is the load-bearing one: a stored `denied` can only have
 * come from the browser's own site permission, while `prompt` or `granted` mean
 * the browser was willing and something underneath it said no.
 */
export function classifyMicrophoneBlock(environment: MicrophoneEnvironment = {}): MicrophoneBlockSource {
  const message = (environment.message ?? "").toLowerCase();
  // Chromium's own wording, and the only way to tell these two apart at all.
  if (message.includes("dismiss")) return "ask";
  if (message.includes("by system") || message.includes("system denied")) return "system";
  // The desktop shell has no per-site permission to get in the way.
  if (environment.desktopShell) return "system";
  if (environment.permission === "denied") return "browser";
  // Nothing was stored against this page, so the browser will still prompt —
  // asking again is the whole fix, and sending someone to Windows settings for
  // it is both wrong and a much longer trip.
  if (environment.permission === "prompt") return "ask";
  // The page is allowed and was still refused: whatever said no sits below the
  // browser.
  if (environment.permission === "granted") return "system";
  // Firefox answers nothing about the microphone permission, but it does not
  // need to: a Windows denial surfaces there as NotFoundError, so the
  // NotAllowedError that reaches us is Firefox's own per-site block.
  if (detectBrowser(environment.userAgent) === "firefox") return "browser";
  return "unknown";
}

function browserSteps(browser: BrowserName): string[] {
  if (browser === "firefox") {
    return [
      "Click the padlock at the left of the address bar.",
      'Next to "Use the Microphone", click the × to clear the block.',
      // Dismissing Firefox's prompt blocks temporarily, and the temporary block
      // never prompts again — so the tab looks permanently broken until it is
      // cleared or reopened.
      'If it reads "Blocked Temporarily", closing this tab and reopening it clears it too.',
      "Start dictation again and choose Allow.",
    ];
  }
  if (browser === "safari") {
    return [
      "Open Safari → Settings → Websites → Microphone.",
      "Set this website to Allow.",
      "Reload the page, then start dictation again.",
    ];
  }
  if (browser === "unknown") {
    return [
      "Open this page's site permissions in your browser — usually the icon at the left of the address bar.",
      "Set Microphone to Allow.",
      "Reload the page, then start dictation again.",
    ];
  }
  return [
    "Click the icon at the left of the address bar, next to the page address.",
    "Set Microphone to Allow.",
    "Reload the page, then start dictation again.",
  ];
}

function systemSteps(os: OsName, appLabel: string): string[] {
  if (os === "windows") {
    return [
      'Turn on "Microphone access".',
      'Turn on "Let apps access your microphone", and "Let desktop apps access your microphone" further down the page.',
      "Come back here and start dictation again.",
    ];
  }
  if (os === "macos") {
    return [
      `Tick ${appLabel} in the microphone list.`,
      `Quit and reopen ${appLabel} — macOS only applies the change on the next launch.`,
      "Start dictation again.",
    ];
  }
  return [
    `Open your system sound settings and check that the input device is not muted or blocked for ${appLabel}.`,
    "Come back here and start dictation again.",
  ];
}

/** The way in that needs no button at all, for when the button fails. */
function manualRoute(os: OsName): string | null {
  if (os === "windows") {
    return `Press Windows+R, paste ${SYSTEM_SETTINGS.windows} and press Enter.`;
  }
  if (os === "macos") return "Open System Settings → Privacy & Security → Microphone.";
  return null;
}

function systemAction(os: OsName, desktopShell: boolean): MicrophoneFixAction | null {
  if (desktopShell) return { label: "Open microphone settings", manual: manualRoute(os) };
  if (!SYSTEM_SETTINGS[os]) return null;
  return { label: `Open ${SYSTEM_LABELS[os]} microphone settings`, manual: manualRoute(os) };
}

function browserCopy(browser: BrowserName): MicrophoneFix["copy"] {
  const value = BROWSER_SETTINGS[browser];
  if (!value) return null;
  return { label: "Or paste this into a new tab", value };
}

/** The browser's own explanation, short enough to sit under the steps. */
function detailFrom(message: string | undefined, browser: BrowserName): string | null {
  const trimmed = message?.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return `${BROWSER_LABELS[browser]} said: ${trimmed.replace(/\.$/, "")}.`;
}

/** The steps, controls and copyable address for whoever blocked the microphone. */
export function microphoneFix(environment: MicrophoneEnvironment = {}): MicrophoneFix {
  const source = classifyMicrophoneBlock(environment);
  const browser = detectBrowser(environment.userAgent);
  const os = detectOs(environment.platform, environment.userAgent);
  const desktopShell = environment.desktopShell === true;
  const appLabel = desktopShell ? "Breadboard" : BROWSER_LABELS[browser];
  const detail = detailFrom(environment.message, browser);

  if (source === "ask") {
    return {
      source,
      headline: "Breadboard needs your permission to use the microphone.",
      // Nothing was stored, so this really is one click plus the browser's own
      // prompt — no settings page in sight.
      steps: [
        "Press Allow microphone below.",
        `Choose "Allow" in the prompt ${appLabel} shows at the top of the window.`,
      ],
      action: null,
      copy: null,
      retryLabel: "Allow microphone",
      detail,
    };
  }

  if (source === "system") {
    return {
      source,
      headline:
        os === "unknown"
          ? `Your system is blocking the microphone for ${appLabel}.`
          : `${SYSTEM_LABELS[os]} is blocking the microphone for ${appLabel}.`,
      steps: systemSteps(os, appLabel),
      action: systemAction(os, desktopShell),
      copy: null,
      retryLabel: null,
      detail,
    };
  }

  if (source === "browser") {
    return {
      source,
      // A stored refusal is the one case no button can undo: browsers forbid a
      // page from re-asking, precisely so that "no" stays "no".
      headline: `${BROWSER_LABELS[browser]} is blocking the microphone for this page.`,
      steps: browserSteps(browser),
      action: null,
      copy: browserCopy(browser),
      retryLabel: null,
      detail,
    };
  }

  // Nothing identified the blocker, so cover both in the order they are likely:
  // the page's own permission first, the system switch as the follow-up.
  const system = systemAction(os, desktopShell);
  return {
    source,
    headline: "Breadboard could not open the microphone.",
    steps: [
      ...browserSteps(browser),
      system
        ? `Still blocked? Check that ${appLabel} is allowed to use the microphone in ${SYSTEM_LABELS[os]} settings.`
        : `Still blocked? Check that ${appLabel} is allowed to use the microphone in your system settings.`,
    ],
    action: system,
    copy: browserCopy(browser),
    retryLabel: null,
    detail,
  };
}

interface DesktopMicrophoneBridge {
  openMicrophoneSettings?: () => Promise<boolean>;
}

function desktopBridge(): DesktopMicrophoneBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { breadboardDesktop?: DesktopMicrophoneBridge }).breadboardDesktop;
}

/** Asks the Electron shell for the OS privacy page; false when it cannot. */
async function openDesktopMicrophoneSettings(): Promise<boolean> {
  const open = desktopBridge()?.openMicrophoneSettings;
  if (!open) return false;
  try {
    return await open();
  } catch {
    return false;
  }
}

/**
 * Open this machine's microphone privacy page, by whichever route exists.
 *
 * A `ms-settings:` link is not one of them: Firefox will not hand an external
 * protocol to Windows from a page, and Chromium's confirmation can be silenced
 * for good, so the link is a button that visibly does nothing. The Electron
 * shell can open it, and so can the Breadboard server — which runs on this very
 * machine — leaving the address itself only as something to paste by hand.
 */
export async function openSystemMicrophoneSettings(): Promise<boolean> {
  if (await openDesktopMicrophoneSettings()) return true;
  try {
    const response = await fetch("/api/speech/microphone-settings", { method: "POST" });
    if (!response.ok) return false;
    const result = (await response.json()) as { opened?: boolean };
    return result.opened === true;
  } catch {
    return false;
  }
}

async function microphonePermissionState(): Promise<MicrophonePermissionState> {
  try {
    // Firefox has no "microphone" descriptor and throws; that is a null answer,
    // not an error worth surfacing.
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

function platformHint(): string | undefined {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || undefined;
}

/** Reads the live environment, then names the blocker and its fix. */
export async function describeMicrophoneBlock(error?: unknown): Promise<MicrophoneFix> {
  if (typeof navigator === "undefined") return microphoneFix();
  return microphoneFix({
    userAgent: navigator.userAgent,
    platform: platformHint(),
    desktopShell: typeof desktopBridge()?.openMicrophoneSettings === "function",
    permission: await microphonePermissionState(),
    message: error instanceof Error ? error.message : undefined,
  });
}
