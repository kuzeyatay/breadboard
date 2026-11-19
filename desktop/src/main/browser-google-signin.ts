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

/** Interactive sign-in pages; passive=true is Google's silent session refresh and stays in the tab. */
export function isGoogleSignInPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com"
      && SIGN_IN_PATH.test(parsed.pathname) && parsed.searchParams.get("passive") !== "true";
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

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function devTools<T>(socketUrl: string, method: string): Promise<T> {
  const socket = new WebSocket(socketUrl, { handshakeTimeout: 5000 });
  try {
    return await new Promise<T>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("open", () => socket.send(JSON.stringify({ id: 1, method })));
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
  // The profile persists, so a second sign-in is usually one click: Google remembers the account.
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`,
    "--no-first-run", "--no-default-browser-check", "--new-window", startUrl,
  ], { stdio: "ignore", detached: false });
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.once("error", () => { exited = true; });
  const deadline = Date.now() + 15 * 60_000;
  let raised = false;
  while (!exited && Date.now() < deadline) {
    await wait(1000);
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
      const signIn = pages.find(page => page.type === "page" && new URL(page.url).hostname === "accounts.google.com");
      if (signIn) {
        // Windows keeps focus on Breadboard, so the window opens behind it, unfocused.
        if (!raised && signIn.webSocketDebuggerUrl) raised = await devTools(signIn.webSocketDebuggerUrl, "Page.bringToFront").then(() => true, () => false);
        continue;
      }
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
