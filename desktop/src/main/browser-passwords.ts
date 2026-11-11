import * as fs from "node:fs";
import * as path from "node:path";
import { safeStorage, type WebContents } from "electron";
import { showChoiceDialog } from "./browser-dialogs";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_PASSWORDS_FILE = "browser-passwords.json";

interface StoredPassword { origin: string; username: string; secret: string; updatedAt: number }
export interface SavedPasswordSummary { origin: string; username: string }

/** The site a credential belongs to: http(s) origin of the top-level page only. */
export function passwordOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch { return null; }
}

/**
 * Saved website sign-ins, encrypted with the OS key (DPAPI on Windows) through
 * safeStorage. Plain-text passwords never reach disk or the settings page.
 */
export class BrowserPasswords {
  private items: StoredPassword[] = [];
  private never = new Set<string>();
  private readonly file: string;
  private writable = true;

  constructor(
    configDir: string,
    private readonly log: (message: string) => void = () => {},
    private readonly changed: () => void = () => {},
  ) {
    this.file = path.join(configDir, BROWSER_PASSWORDS_FILE);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (saved?.version !== 1 || !Array.isArray(saved.items) || !Array.isArray(saved.never)) throw new Error("Invalid passwords file");
      this.items = saved.items.filter((item: StoredPassword) => typeof item?.origin === "string" &&
        typeof item.username === "string" && typeof item.secret === "string");
      this.never = new Set(saved.never.filter((origin: unknown) => typeof origin === "string"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      // Never overwrite a file we could not read: it holds the person's passwords.
      this.writable = false;
      this.log(`Could not read saved browser passwords: ${String(error)}`);
    }
  }

  list(): SavedPasswordSummary[] {
    return this.items.map(({ origin, username }) => ({ origin, username }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  /** Decrypted sign-ins for exactly this origin. */
  find(origin: string): Array<{ username: string; password: string }> {
    if (!safeStorage.isEncryptionAvailable()) return [];
    return this.items.filter(item => item.origin === origin).flatMap(item => {
      try { return [{ username: item.username, password: safeStorage.decryptString(Buffer.from(item.secret, "base64")) }]; }
      catch { return []; }
    });
  }

  remove(origin: string, username: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter(item => !(item.origin === origin && item.username === username));
    if (this.items.length === before || !this.flush()) return false;
    this.changed();
    return true;
  }

  private flush(): boolean {
    if (!this.writable) return false;
    try {
      atomicWriteFile(this.file, JSON.stringify({ version: 1, items: this.items, never: [...this.never] }));
      return true;
    } catch (error) {
      this.log(`Could not save browser passwords: ${String(error)}`);
      return false;
    }
  }

  /** A login form was submitted: offer to save or update, like Chrome's key icon. */
  async offer(contents: WebContents, origin: string, username: string, password: string): Promise<void> {
    if (!password || password.length > 1_024 || username.length > 512 || this.never.has(origin) || !this.writable) return;
    if (!safeStorage.isEncryptionAvailable()) return;
    const existing = this.find(origin).find(item => item.username === username);
    if (existing?.password === password) return;
    // A corner notice, like Chrome's key bubble: signing in is never blocked
    // on it, and it goes away by itself when ignored.
    const { response } = await showChoiceDialog(contents, {
      title: existing ? "Update password?" : "Save password?",
      message: `${existing ? "Update" : "Save"} your password for ${origin.replace(/^https?:\/\//u, "")}?`,
      detail: `${username ? `Username: ${username}\n` : ""}Encrypted with your Windows account. Manage saved passwords in Browser settings.`,
      buttons: ["Never for this site", "Not now", existing ? "Update" : "Save"], cancel: 1, primary: 2,
      corner: true, timeoutMs: 30_000,
    });
    if (response === 0) { this.never.add(origin); this.flush(); return; }
    if (response !== 2) return;
    const secret = safeStorage.encryptString(password).toString("base64");
    this.items = this.items.filter(item => !(item.origin === origin && item.username === username));
    this.items.push({ origin, username, secret, updatedAt: Date.now() });
    if (this.flush()) this.changed();
  }

  /** Narrow, main-frame-only IPC for one browser page. */
  attach(contents: WebContents): void {
    const topOrigin = (frameUrl: string | undefined) => {
      const origin = passwordOrigin(frameUrl ?? "");
      return origin && origin === passwordOrigin(contents.getURL()) ? origin : null;
    };
    // Two-step sign-ins (Microsoft, Google, university SSO) ask for the
    // username on one page and the password on the next, where no username
    // field is left to read. Keep the last one typed on this site, in memory.
    let typed: { origin: string; username: string; at: number } | null = null;
    contents.ipc.on("breadboard:web-password:username", (event, username: unknown) => {
      if (event.senderFrame !== contents.mainFrame || typeof username !== "string" || !username || username.length > 512) return;
      const origin = topOrigin(event.senderFrame?.url);
      if (origin) typed = { origin, username, at: Date.now() };
    });
    contents.ipc.on("breadboard:web-password:submitted", (event, submitted: unknown, password: unknown) => {
      if (event.senderFrame !== contents.mainFrame || typeof submitted !== "string" || typeof password !== "string") return;
      const origin = topOrigin(event.senderFrame?.url);
      const username = submitted || (typed && typed.origin === origin && Date.now() - typed.at < 10 * 60_000 ? typed.username : "");
      if (origin) void this.offer(contents, origin, username, password).catch(error => this.log(`Password save failed: ${String(error)}`));
    });
    contents.ipc.handle("breadboard:web-password:get", event => {
      if (event.senderFrame !== contents.mainFrame) return [];
      const origin = topOrigin(event.senderFrame?.url);
      return origin ? this.find(origin) : [];
    });
  }
}
