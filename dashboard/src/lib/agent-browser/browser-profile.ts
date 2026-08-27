// The browser the agents drive, and the one profile directory they drive it with.
//
// agent-browser is handed a browser binary (AGENT_BROWSER_EXECUTABLE_PATH) and,
// optionally, a profile directory (AGENT_BROWSER_PROFILE) which it passes
// straight to Chromium as --user-data-dir. Without one, every run opens a
// browser that has never signed into anything, so every task behind a login is
// out of reach.
//
// This module gives the account a single persistent profile directory and opens
// that same browser against it as an ordinary window, so a person can sign into
// their own apps by hand, once. Every run afterwards starts already signed in.
//
// Chromium permits one process per --user-data-dir: a second launch hands its
// arguments to the first and exits. The sign-in window and a run therefore
// cannot both hold the profile, which is why the window's pid is tracked here —
// on globalThis, like the run map, because in dev each route bundle gets its own
// instance of this module — and a run refuses to start while the window is open.

import {
  rmSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import {
  externalRuntimeCopyFile,
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";

export class BrowserProfileError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// ---- the browser -------------------------------------------------------------

/**
 * The Chrome/Edge binary the agents drive. An explicit
 * AGENT_BROWSER_EXECUTABLE_PATH always wins; otherwise the usual install
 * locations are tried in order, Chrome before Edge.
 */
export function resolveBrowserExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AGENT_BROWSER_EXECUTABLE_PATH?.trim();
  if (explicit && externalRuntimePathExists(explicit)) return explicit;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((candidate) => externalRuntimePathExists(candidate)) ?? null;
}

/** What to call that binary in a sentence a person reads. */
export function browserDisplayName(executable: string | null): string | null {
  if (!executable) return null;
  const base = path.basename(executable).toLowerCase();
  if (base.startsWith("msedge") || base.includes("microsoft edge")) return "Microsoft Edge";
  if (base.includes("chromium")) return "Chromium";
  if (base.includes("chrome")) return "Google Chrome";
  return path.basename(executable);
}

// ---- the profile directory ---------------------------------------------------

/**
 * Where the shared profile lives. Mutable and potentially large (a Chromium
 * profile is hundreds of megabytes), so it sits beside the rest of Breadboard's
 * user data rather than inside the checkout.
 */
export function agentBrowserProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.AGENT_BROWSER_PROFILE?.trim();
  if (explicit) return path.resolve(explicit);
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(path.resolve(base), "agent-browser-profile");
}

/**
 * The profile a run should be given — the directory, but only once it exists.
 * Until someone has opened the sign-in window there is nothing to inherit, and
 * runs keep their historical behaviour of starting from a blank browser.
 */
export function activeProfileDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = agentBrowserProfileDir(env);
  return externalRuntimePathExists(dir) ? dir : null;
}

/** An absolute path with the home directory collapsed, for display only. */
export function displayPath(target: string): string {
  const home = os.homedir();
  return home && target.toLowerCase().startsWith(home.toLowerCase())
    ? `~${target.slice(home.length)}`
    : target;
}

function profileLastUsedAt(dir: string): string | null {
  // Preferences is rewritten whenever the browser closes cleanly; the profile
  // directory itself moves on any write. Newest of the two, so a window that is
  // still open still reports something recent.
  let newest = 0;
  for (const mark of [path.join(dir, "Default", "Preferences"), dir]) {
    try {
      newest = Math.max(newest, externalRuntimeStat(mark).mtimeMs);
    } catch {
      /* not written yet */
    }
  }
  return newest > 0 ? new Date(newest).toISOString() : null;
}

const MULTI_PART_SUFFIXES = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/** `mail.google.com` → `google.com`, `www.bbc.co.uk` → `bbc.co.uk`. */
function registrableDomain(host: string): string {
  const bare = host.replace(/^\./, "").replace(/^www\./, "").toLowerCase();
  if (!bare || /^[\d.]+$/.test(bare)) return bare;
  const labels = bare.split(".");
  if (labels.length <= 2) return bare;
  const secondLast = labels[labels.length - 2] ?? "";
  return labels.slice(MULTI_PART_SUFFIXES.has(secondLast) ? -3 : -2).join(".");
}

let cookieSnapshotCounter = 0;

/**
 * The sites the profile is holding cookies for, busiest first — the only honest
 * answer available to "did my sign-in stick?". Cookie *values* are encrypted by
 * the OS keyring and are never read; only the host column is.
 *
 * The live database is copied before it is opened, because Chromium keeps it
 * open while the window is up and a reader on the original risks contending
 * with it. Everything here is best effort: a locked, missing, or unexpected
 * database simply yields no sites.
 */
export function profileSites(dir: string, limit = 12): string[] {
  const source = [
    path.join(dir, "Default", "Network", "Cookies"),
    path.join(dir, "Default", "Cookies"),
  ].find((candidate) => externalRuntimePathExists(candidate));
  if (!source) return [];

  cookieSnapshotCounter += 1;
  const snapshot = path.join(os.tmpdir(), `breadboard-cookies-${process.pid}-${cookieSnapshotCounter}`);
  const copies = [snapshot];
  try {
    externalRuntimeCopyFile(source, snapshot);
    for (const suffix of ["-wal", "-shm"]) {
      if (externalRuntimePathExists(source + suffix)) {
        externalRuntimeCopyFile(source + suffix, snapshot + suffix);
        copies.push(snapshot + suffix);
      }
    }
    const db = new Database(snapshot, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare("SELECT host_key AS host, COUNT(*) AS total FROM cookies GROUP BY host_key ORDER BY total DESC")
        .all() as Array<{ host?: unknown }>;
      const seen: string[] = [];
      for (const row of rows) {
        if (typeof row.host !== "string") continue;
        const domain = registrableDomain(row.host);
        if (!domain || seen.includes(domain)) continue;
        seen.push(domain);
        if (seen.length >= limit) break;
      }
      return seen;
    } finally {
      db.close();
    }
  } catch {
    return [];
  } finally {
    for (const copy of copies) {
      try {
        unlinkSync(copy);
      } catch {
        /* never written */
      }
    }
  }
}

// ---- the sign-in window ------------------------------------------------------

export interface SignInWindow {
  pid: number;
  startedAt: string;
  executable: string;
  /** Runtime fence for the person-visible sign-in browser. */
  jobId?: string;
  attempt?: number;
  workerInstanceId?: string;
  userId?: number;
  /**
   * Opened for the agents rather than for a person, with no window at all.
   *
   * OpenCLI can only drive a browser that is actually running, so a run needs
   * one whether or not anybody wants to look at it. Two approaches were tried
   * and measured before this one:
   *
   * Headless is out. The extension does connect under `--headless=new`, and
   * then Reddit answers with a challenge page instead of JSON — defeating the
   * one thing OpenCLI exists to do, which is drive a browser sites treat as
   * real.
   *
   * Off-screen at -32000,-32000 worked and looked wrong: Windows still put a
   * button on the taskbar, and clicking it did nothing, because the window it
   * pointed at was past the edge of every display. A control that is visible
   * and dead is worse than either extreme.
   *
   * `--no-startup-window` starts the browser process and creates no window, so
   * there is nothing on screen and nothing in the taskbar, while the extension
   * still loads and sites still see an ordinary browser. Verified live: it
   * connects in about 22 seconds (slower than the 5 a window takes, since the
   * service worker has no page to wake it) and returns real Reddit results.
   */
  background?: boolean;
}

// The open window is recorded on disk rather than in module memory. Whoever
// asks — the profile page rendering on the server, the API route acting on a
// click, the service refusing a run — may be a different module instance or a
// different worker than the one that launched it, and all three have to agree
// about whether the browser is holding the profile.
export function browserProfileMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(agentBrowserProfileDir(env)), "agent-browser-signin.json");
}

// A pid outlives the system's memory of what it meant: after a reboot the same
// number belongs to something else. A window nobody has closed in half a day is
// treated as gone, so a stale record can never block runs indefinitely.
const MARKER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function forgetSignInWindow(env: NodeJS.ProcessEnv = process.env): void {
  try {
    unlinkSync(browserProfileMarkerPath(env));
  } catch {
    /* nothing recorded */
  }
}

/** The window Breadboard opened, if it is still up. Closing it by hand counts. */
export function signInWindow(env: NodeJS.ProcessEnv = process.env): SignInWindow | null {
  let record: unknown;
  try {
    record = JSON.parse(externalRuntimeReadUtf8(browserProfileMarkerPath(env)));
  } catch {
    return null;
  }
  const marker = record as Partial<SignInWindow>;
  if (typeof marker?.pid !== "number" || typeof marker.startedAt !== "string") {
    forgetSignInWindow(env);
    return null;
  }
  const age = Date.now() - Date.parse(marker.startedAt);
  if (!Number.isFinite(age) || age > MARKER_MAX_AGE_MS || !isAlive(marker.pid)) {
    forgetSignInWindow(env);
    return null;
  }
  const hasRuntimeFence = marker.jobId !== undefined || marker.attempt !== undefined ||
    marker.workerInstanceId !== undefined || marker.userId !== undefined;
  if (
    hasRuntimeFence &&
    (typeof marker.jobId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(marker.jobId) ||
      !Number.isSafeInteger(marker.attempt) || Number(marker.attempt) < 1 ||
      typeof marker.workerInstanceId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(marker.workerInstanceId) ||
      !Number.isSafeInteger(marker.userId) || Number(marker.userId) < 1)
  ) {
    forgetSignInWindow(env);
    return null;
  }
  return {
    pid: marker.pid,
    startedAt: marker.startedAt,
    background: marker.background === true,
    executable: typeof marker.executable === "string" ? marker.executable : "",
    ...(hasRuntimeFence
      ? {
          jobId: marker.jobId,
          attempt: marker.attempt,
          workerInstanceId: marker.workerInstanceId,
          userId: marker.userId,
        }
      : {}),
  };
}

export function signInWindowOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return signInWindow(env) !== null;
}

export function normalizeBrowserProfileStartUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new BrowserProfileError(400, "invalid_url");
  }
  // A browser argument is not a place to accept file:// or any other scheme
  // that reads the machine rather than the web.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BrowserProfileError(400, "invalid_url");
  }
  if (parsed.href.length > 2048) throw new BrowserProfileError(400, "invalid_url");
  return parsed.href;
}

/** Delete the profile: every cookie, session, and saved password inside it. */
export function resetProfile(env: NodeJS.ProcessEnv = process.env): void {
  if (signInWindowOpen(env)) throw new BrowserProfileError(409, "sign_in_window_open");
  const dir = agentBrowserProfileDir(env);
  // A misconfigured AGENT_BROWSER_PROFILE must not turn this button into a
  // recursive delete of a home directory or a drive.
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new BrowserProfileError(400, "unsafe_profile_directory");
  }
  if (!externalRuntimePathExists(resolved)) return;
  try {
    rmSync(resolved, { recursive: true, force: true });
  } catch {
    throw new BrowserProfileError(500, "profile_not_removable");
  }
}

// ---- what the profile page reads ---------------------------------------------

export interface BrowserProfileSummary {
  /** A browser to sign into was found. */
  browserFound: boolean;
  browserName: string | null;
  /** Home-collapsed, because the page never needs the absolute path. */
  directory: string;
  /** The profile exists, so runs now start from it. */
  signedIn: boolean;
  lastUsedAt: string | null;
  sites: string[];
  windowOpen: boolean;
  windowStartedAt: string | null;
}

export function browserProfileSummary(env: NodeJS.ProcessEnv = process.env): BrowserProfileSummary {
  const executable = resolveBrowserExecutable(env);
  const dir = agentBrowserProfileDir(env);
  const signedIn = externalRuntimePathExists(dir);
  const window = signInWindow(env);
  return {
    browserFound: Boolean(executable),
    browserName: browserDisplayName(executable),
    directory: displayPath(dir),
    signedIn,
    lastUsedAt: signedIn ? profileLastUsedAt(dir) : null,
    // While the window is up this read is skipped, because Chromium has not
    // committed to the cookie database yet and the copy comes back empty — an
    // answer that would read as "signed out of everything" mid sign-in. Callers
    // keep whatever they last knew until the window closes.
    sites: signedIn && !window ? profileSites(dir) : [],
    windowOpen: Boolean(window),
    windowStartedAt: window?.startedAt ?? null,
  };
}
