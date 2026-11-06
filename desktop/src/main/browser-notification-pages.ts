import * as fs from "node:fs";
import * as path from "node:path";
import { notificationOrigin } from "../shared/browser-preferences";
import { atomicWriteFile } from "./runtime-config";

/** Receiving pages belong to the persistent browser profile, just like grants. */
export class BrowserNotificationPages {
  private pages: Record<string, string> = {};
  private readError = false;
  private readonly file: string;

  constructor(directory: string, sites: Record<string, "granted" | "denied">,
    history: readonly { url: string }[], private readonly log: (message: string) => void = () => {}) {
    this.file = path.join(directory, "browser-notification-pages.json");
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (saved?.version !== 1 || !saved.pages || typeof saved.pages !== "object" || Array.isArray(saved.pages) ||
          Object.entries(saved.pages).some(([origin, url]) => notificationOrigin(origin) !== origin ||
            typeof url !== "string" || url.length > 8192 || notificationOrigin(url) !== origin)) {
        throw new Error("Invalid notification pages");
      }
      this.pages = saved.pages;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.readError = true;
        log("Saved notification pages could not be read; automatic website startup is disabled.");
        return;
      }
      // Upgrade existing profiles without asking people to reopen every app.
      // History preserves app paths such as /web; an explicit empty saved map
      // (including after a sign-in reset) must never migrate from history again.
      for (const [origin, permission] of Object.entries(sites)) {
        if (permission !== "granted") continue;
        const url = history.find(entry => entry.url.length <= 8192 && notificationOrigin(entry.url) === origin)?.url;
        this.pages[origin] = url ?? `${origin}/`;
      }
      this.save();
    }
  }

  urls(): string[] { return Object.values(this.pages); }

  remember(url: string): void {
    const origin = notificationOrigin(url);
    if (this.readError || !origin || url.length > 8192 || this.pages[origin] === url) return;
    this.pages[origin] = url;
    this.save();
  }

  reconcile(sites: Record<string, "granted" | "denied">): void {
    let changed = false;
    for (const origin of Object.keys(this.pages)) {
      if (sites[origin] === "granted") continue;
      delete this.pages[origin];
      changed = true;
    }
    if (changed) this.save();
  }

  clear(): void {
    this.pages = {};
    this.readError = false;
    this.save();
  }

  private save(): void {
    if (this.readError) return;
    try { atomicWriteFile(this.file, JSON.stringify({ version: 1, pages: this.pages }, null, 2)); }
    catch { this.log("Notification pages could not be saved."); }
  }
}
