import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import * as path from "node:path";
import { app, type CookiesSetDetails, type Session, type WebContents } from "electron";
import WebSocket from "ws";

/**
 * Google refuses sign-in from embedded Chromium ("This browser or app may not
 * be secure") whatever user agent it presents: it fingerprints the engine.
 * Verified 2026-11-19 against Electron 43: Firefox, Chrome and honest Electron
 * identities are all rejected, while real Edge passes the same flow. So the
 * sign-in itself happens in an installed Edge/Chrome window with a dedicated
 * profile, and the resulting Google cookies are imported into the tab's session.
 * The tab must not load the sign-in page first: once Google's check has run in
 * Electron, the same sign-in in Edge seconds later was rejected too.
 */
const SIGN_IN_PATH = /^\/(?:v3\/signin\/|signin\/v2\/|ServiceLogin$|AccountChooser$|AddSession$)/;

/**
 * Interactive sign-in pages. Any `passive` value (true, or a max age such as
 * 1209600 that docs.google.com and Forms send) is Google's silent session check,
 * which bounces straight back and stays in the tab; stopping it blanks the page.
 */
export function isGoogleSignInPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const passive = parsed.searchParams.get("passive");
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com"
      && SIGN_IN_PATH.test(parsed.pathname) && (passive === null || passive === "false");
  } catch { return false; }
}

/** Where the sign-in wanted to go next; Google only continues to https pages. */
export function signInContinueUrl(url: string): string {
  try {
    const next = new URL(new URL(url).searchParams.get("continue") ?? "");
    if (next.protocol === "https:") return next.toString();
  } catch { /* fall through */ }
  return "https://www.google.com/";
}

export function signInBrowserCandidates(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  if (platform !== "win32") return ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/chromium"];
  const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter((root): root is string => Boolean(root));
  return [
    ...roots.map(root => path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe")),
    ...roots.map(root => path.win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe")),
  ];
}

export interface DevToolsCookie {
  name: string; value: string; domain: string; path: string; expires: number;
  httpOnly: boolean; secure: boolean; sameSite?: "Strict" | "Lax" | "None"; partitionKey?: unknown;
}

/** One CDP cookie as Electron's cookies.set input; partitioned cookies have no unpartitioned equivalent. */
export function electronCookie(cookie: DevToolsCookie): CookiesSetDetails | null {
  if (cookie.partitionKey) return null;
  const host = cookie.domain.replace(/^\./, "");
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`,
    name: cookie.name, value: cookie.value, path: cookie.path,
    // A leading dot marks a domain cookie; host-only (and __Host-) cookies must not name a domain.
    ...(cookie.domain.startsWith(".") ? { domain: cookie.domain } : {}),
    secure: cookie.secure, httpOnly: cookie.httpOnly,
    ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
    sameSite: cookie.sameSite === "Strict" ? "strict" : cookie.sameSite === "Lax" ? "lax" : cookie.sameSite === "None" ? "no_restriction" : "unspecified",
  };
}

/** Google's own sites: the accounts a session holds live in these cookies. */
export function isGoogleCookieDomain(domain: string): boolean {
  return /(^|\.)(google\.[a-z]{2,3}(\.[a-z]{2})?|youtube\.com|gstatic\.com|googleusercontent\.com)$/.test(domain.replace(/^\./, ""));
}

/** One Electron cookie as a CDP CookieParam; host-only cookies are addressed by URL, not domain. */
export function devToolsCookieParam(cookie: Electron.Cookie): Record<string, unknown> {
  const host = (cookie.domain ?? "").replace(/^\./, "");
  return {
    name: cookie.name, value: cookie.value, path: cookie.path ?? "/",
    ...(cookie.hostOnly ? { url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}` } : { domain: cookie.domain }),
    secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly),
    ...(cookie.expirationDate ? { expires: cookie.expirationDate } : {}),
    ...(cookie.sameSite === "strict" ? { sameSite: "Strict" } : cookie.sameSite === "lax" ? { sameSite: "Lax" } : cookie.sameSite === "no_restriction" ? { sameSite: "None" } : {}),
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function devTools<T>(socketUrl: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const socket = new WebSocket(socketUrl, { handshakeTimeout: 5000 });
  try {
    return await new Promise<T>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
      socket.on("message", data => {
        const message = JSON.parse(String(data)) as { id?: number; result?: T; error?: { message: string } };
        if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result as T);
      });
    });
  } finally { socket.close(); }
}

let active: Promise<void> | null = null;

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const installedSignInBrowser = () => signInBrowserCandidates().find(candidate => existsSync(candidate));

/**
 * Opens the sign-in in a real browser and imports its cookies once the person
 * has signed in (the window leaves accounts.google.com holding a Google session).
 */
async function signInWithInstalledBrowser(executable: string, startUrl: string, target: Session, log: (message: string) => void): Promise<"signed-in" | "closed"> {
  const profile = path.join(app.getPath("userData"), "google-signin-browser");
  // A concrete port: Chromium treats --remote-debugging-port=0 (and pipe) as automation and
  // sets navigator.webdriver, which Google rejects. The person signs in by hand either way.
  const port = await freeLoopbackPort();
  // Opens blank: the window first receives this session's Google accounts, so "Add another
  // account" adds to them and the import below brings every account back, not just the new one.
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`,
    "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank",
  ], { stdio: "ignore", detached: false });
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.once("error", () => { exited = true; });
  const deadline = Date.now() + 15 * 60_000;
  let started = false;
  let raised = false;
  let sawSignIn = false;
  while (!exited && Date.now() < deadline) {
    await wait(started ? 1000 : 300);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
      if (!started) {
        const blank = pages.find(page => page.type === "page" && page.url === "about:blank");
        if (!blank?.webSocketDebuggerUrl) continue;
        const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
        const accounts = (await target.cookies.get({})).filter(cookie => isGoogleCookieDomain(cookie.domain ?? ""));
        if (accounts.length) await devTools(webSocketDebuggerUrl, "Storage.setCookies", { cookies: accounts.map(devToolsCookieParam) });
        await devTools(blank.webSocketDebuggerUrl, "Page.navigate", { url: startUrl });
        started = true;
        continue;
      }
      const signIn = pages.find(page => page.type === "page" && new URL(page.url).hostname === "accounts.google.com");
      if (signIn) {
        sawSignIn = true;
        // Windows keeps focus on Breadboard, so the window opens behind it, unfocused.
        if (!raised && signIn.webSocketDebuggerUrl) raised = await devTools(signIn.webSocketDebuggerUrl, "Page.bringToFront").then(() => true, () => false);
        continue;
      }
      // The copied accounts already include SID, so only a finished sign-in page counts.
      if (!sawSignIn) continue;
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
      const { cookies } = await devTools<{ cookies: DevToolsCookie[] }>(webSocketDebuggerUrl, "Storage.getCookies");
      if (!cookies.some(cookie => cookie.name === "SID" && /(^|\.)google\.com$/.test(cookie.domain))) continue;
      let imported = 0;
      for (const cookie of cookies) {
        const details = electronCookie(cookie);
        if (!details) continue;
        try { await target.cookies.set(details); imported += 1; } catch (error) { log(`Google sign-in: skipped cookie ${cookie.name}@${cookie.domain}: ${String(error)}`); }
      }
      await target.cookies.flushStore();
      log(`Google sign-in: imported ${imported} cookies from ${path.basename(executable)}.`);
      await devTools(webSocketDebuggerUrl, "Browser.close").catch(() => child.kill());
      return "signed-in";
    } catch { /* the browser is between pages or closing */ }
  }
  if (!exited) child.kill();
  log("Google sign-in: the sign-in window closed before signing in.");
  return "closed";
}

/**
 * Stops Google's sign-in page before it loads here, signs in through a real
 * browser, then opens the page the sign-in was for. Without Chrome or Edge the
 * page loads as before.
 */
export function attachGoogleSignInHandoff(contents: WebContents, target: Session, log: (message: string) => void = () => {}): void {
  const intercept = (url: string, isMainFrame: boolean) => {
    if (!isMainFrame || contents.isDestroyed() || !isGoogleSignInPage(url)) return;
    const executable = installedSignInBrowser();
    if (!executable) return;
    // stop() inside a navigation event deadlocks the main process (Electron 43); the next turn
    // still cancels before Google's page commits.
    setImmediate(() => { if (!contents.isDestroyed()) contents.stop(); });
    // One sign-in window at a time; a second sign-in page waits for it rather than loading here.
    if (active) return;
    const before = contents.getURL();
    active = signInWithInstalledBrowser(executable, url, target, log).then(outcome => {
      // Only after a real sign-in, and only if the person has not moved on in this tab.
      if (outcome === "signed-in" && !contents.isDestroyed() && contents.getURL() === before) void contents.loadURL(signInContinueUrl(url)).catch(() => {});
    }, error => log(`Google sign-in hand-off failed: ${String(error)}`)).finally(() => { active = null; });
  };
  contents.on("did-start-navigation", (_event, url, _inPlace, isMainFrame) => intercept(url, isMainFrame));
  contents.on("did-redirect-navigation", (_event, url, _inPlace, isMainFrame) => intercept(url, isMainFrame));
}
