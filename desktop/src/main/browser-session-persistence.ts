import * as fs from "node:fs";
import * as path from "node:path";
import { safeStorage, type Cookie, type CookiesSetDetails, type Session } from "electron";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_SESSION_COOKIES_FILE = "session-cookies.encrypted";
const stores = new WeakMap<Session, BrowserSessionPersistence>();

function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

/** Retain cookie scope and flags without inventing an expiry or widening a host-only cookie. */
function cookieDetails(cookie: Cookie): CookiesSetDetails | null {
  if (!cookie || cookie.session !== true || cookie.expirationDate !== undefined ||
      typeof cookie.name !== "string" || typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" || !cookie.domain ||
      typeof cookie.path !== "string" || !cookie.path.startsWith("/") ||
      typeof cookie.hostOnly !== "boolean" || typeof cookie.secure !== "boolean" ||
      typeof cookie.httpOnly !== "boolean" ||
      !["unspecified", "no_restriction", "lax", "strict"].includes(cookie.sameSite)) return null;
  const host = cookie.domain.replace(/^\./, "");
  try {
    const url = new URL(`${cookie.secure ? "https" : "http"}://${host}/`);
    if (url.hostname !== host || url.port || url.username || url.password) return null;
    return {
      url: url.href, name: cookie.name, value: cookie.value, path: cookie.path,
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
    };
  } catch { return null; }
}

const cookieKey = (cookie: Cookie) => JSON.stringify([cookie.domain, cookie.path, cookie.name]);

/** Electron 33 persists expiring cookies, but explicitly disables native session-cookie
 * persistence. Continue the normal browser session using an OS-encrypted checkpoint.
 * The native jar remains authoritative for expiry, logout, and data clearing. */
class BrowserSessionPersistence {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> | null = null;
  private dirty = false;
  constructor(private readonly session: Session, private readonly file: string,
    private readonly log: (message: string) => void) {}

  async restore(): Promise<void> {
    if (!encryptionAvailable()) {
      // Never fall back to plaintext, or leave a stale login available for a later run.
      fs.rmSync(this.file, { force: true });
      this.log("[browser] Session-cookie restoration unavailable: OS encryption is unavailable.");
    } else if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(this.file, "utf8"), "base64")));
        if (saved?.version !== 1 || !Array.isArray(saved.cookies)) throw new Error("Invalid checkpoint");
        const existing = new Set((await this.session.cookies.get({})).map(cookieKey));
        for (const cookie of saved.cookies) {
          const details = cookieDetails(cookie);
          if (!details || existing.has(cookieKey(cookie))) continue;
          try { await this.session.cookies.set(details); }
          catch { this.log("[browser] A saved session cookie could not be restored."); }
        }
      } catch {
        // Cookie values, domains and decryption errors must never reach logs.
        this.log("[browser] Session-cookie checkpoint could not be read; using current site data.");
      }
    }
    this.session.cookies.on("changed", (_event, _cookie, _cause, removed) => {
      // Persist deletions promptly so signing out cannot resurrect the previous login.
      if (removed) {
        void this.flush().catch(() => this.reportWriteError());
      } else if (!this.timer) {
        this.timer = setTimeout(() => {
          void this.flush().catch(() => this.reportWriteError());
        }, 250);
        this.timer.unref();
      }
    });
    await this.flush();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Coalesce bursts while serializing fresh reads. A reset during an in-flight
    // write requires one more read, so the final checkpoint cannot resurrect it.
    this.dirty = true;
    this.pending ??= this.drain().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      const cookies = await this.session.cookies.get({ session: true });
      if (cookies.length === 0 || !encryptionAvailable()) {
        fs.rmSync(this.file, { force: true });
      } else {
        const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, cookies }));
        atomicWriteFile(this.file, encrypted.toString("base64"));
      }
      this.session.flushStorageData();
      await this.session.cookies.flushStore();
    }
  }

  private reportWriteError(): void {
    this.log("[browser] Browser session data could not be saved.");
  }
}

/** Await before creating browser views, agent pages, extensions or restored tabs. */
export async function restoreBrowserSession(browserSession: Session,
  log: (message: string) => void = () => {}): Promise<void> {
  if (!browserSession.isPersistent() || !browserSession.storagePath || stores.has(browserSession)) return;
  const store = new BrowserSessionPersistence(browserSession,
    path.join(browserSession.storagePath, BROWSER_SESSION_COOKIES_FILE), log);
  stores.set(browserSession, store);
  try { await store.restore(); }
  catch { log("[browser] Browser session persistence could not be initialized."); }
}

export async function flushBrowserSession(browserSession: Session): Promise<void> {
  const store = stores.get(browserSession);
  if (store) await store.flush();
  else {
    browserSession.flushStorageData();
    await browserSession.cookies.flushStore();
  }
}
