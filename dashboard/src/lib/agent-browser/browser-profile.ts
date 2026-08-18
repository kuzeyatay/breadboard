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

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

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
  if (explicit && existsSync(explicit)) return explicit;
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
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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
  return existsSync(dir) ? dir : null;
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
      newest = Math.max(newest, statSync(mark).mtimeMs);
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
  ].find(existsSync);
  if (!source) return [];

  cookieSnapshotCounter += 1;
  const snapshot = path.join(os.tmpdir(), `breadboard-cookies-${process.pid}-${cookieSnapshotCounter}`);
  const copies = [snapshot];
  try {
    copyFileSync(source, snapshot);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(source + suffix)) {
        copyFileSync(source + suffix, snapshot + suffix);
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
}

// The open window is recorded on disk rather than in module memory. Whoever
// asks — the profile page rendering on the server, the API route acting on a
// click, the service refusing a run — may be a different module instance or a
// different worker than the one that launched it, and all three have to agree
// about whether the browser is holding the profile.
function markerPath(env: NodeJS.ProcessEnv): string {
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

function forgetWindow(env: NodeJS.ProcessEnv): void {
  try {
    unlinkSync(markerPath(env));
  } catch {
    /* nothing recorded */
  }
}

/** The window Breadboard opened, if it is still up. Closing it by hand counts. */
export function signInWindow(env: NodeJS.ProcessEnv = process.env): SignInWindow | null {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(markerPath(env), "utf8"));
  } catch {
    return null;
  }
  const marker = record as Partial<SignInWindow>;
  if (typeof marker?.pid !== "number" || typeof marker.startedAt !== "string") {
    forgetWindow(env);
    return null;
  }
  const age = Date.now() - Date.parse(marker.startedAt);
  if (!Number.isFinite(age) || age > MARKER_MAX_AGE_MS || !isAlive(marker.pid)) {
    forgetWindow(env);
    return null;
  }
  return {
    pid: marker.pid,
    startedAt: marker.startedAt,
    executable: typeof marker.executable === "string" ? marker.executable : "",
  };
}

export function signInWindowOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return signInWindow(env) !== null;
}

function normalizeStartUrl(url: unknown): string | null {
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

/**
 * Open the agents' browser on the shared profile so a person can sign in.
 * Idempotent: if the window is already up, that window is handed back rather
 * than a second process that would only forward its arguments and exit.
 */
export function openSignInWindow(url?: unknown, env: NodeJS.ProcessEnv = process.env): SignInWindow {
  // Bad input is rejected before anything is looked up or launched.
  const startUrl = normalizeStartUrl(url);
  const existing = signInWindow(env);
  if (existing) return existing;

  const executable = resolveBrowserExecutable(env);
  if (!executable) throw new BrowserProfileError(503, "browser_not_found");
  const dir = agentBrowserProfileDir(env);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    throw new BrowserProfileError(500, "profile_not_writable");
  }

  const child = spawn(
    executable,
    [
      `--user-data-dir=${dir}`,
      // A profile Breadboard owns should never nag about being new or about
      // which browser the machine defaults to.
      "--no-first-run",
      "--no-default-browser-check",
      ...(startUrl ? [startUrl] : []),
    ],
    // Detached and unreferenced: this window outlives the request that opened
    // it, and belongs to the person, not to the server.
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.unref();
  if (typeof child.pid !== "number") throw new BrowserProfileError(502, "browser_launch_failed");

  const state: SignInWindow = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    executable,
  };
  try {
    writeFileSync(markerPath(env), JSON.stringify(state), "utf8");
  } catch {
    // Unrecorded, the window would be invisible to the run guard: close it
    // again rather than leave a browser holding a profile nothing knows about.
    try {
      process.kill(child.pid);
    } catch {
      /* already gone */
    }
    throw new BrowserProfileError(500, "profile_not_writable");
  }
  return state;
}

/**
 * Ask the window to close. Deliberately graceful — no /F, no SIGKILL — so
 * Chromium shuts down the way it does from its own close button and flushes
 * cookies and local storage to the profile. The tracked pid is NOT cleared
 * here: liveness decides when the window is really gone, so a shutdown the
 * browser refuses (an unsaved-changes prompt, say) is not reported as done.
 */
export function closeSignInWindow(env: NodeJS.ProcessEnv = process.env): boolean {
  const current = signInWindow(env);
  if (!current) return false;
  try {
    if (process.platform === "win32") {
      // No /F (that would drop cookies Chromium has not committed yet) and no
      // /T: the tree walk hits the GPU and renderer children, which have no
      // message loop to receive a close, and taskkill then refuses the parent
      // for having survivors. Addressed to the browser process alone this is a
      // WM_CLOSE on its window, which is exactly the close button, and its
      // children go down with it.
      spawn("taskkill", ["/PID", String(current.pid)], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else {
      process.kill(current.pid, "SIGTERM");
    }
  } catch {
    /* already gone — liveness will notice */
  }
  return true;
}

/**
 * Wait, briefly, for a closing window to actually exit. A page that refuses to
 * unload can outlast this, and then the card simply keeps saying the window is
 * open — which is the truth, and the person can close it in the browser.
 */
export async function awaitWindowClosed(
  timeoutMs = 8_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!signInWindowOpen(env)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return !signInWindowOpen(env);
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
  if (!existsSync(resolved)) return;
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
  const signedIn = existsSync(dir);
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
