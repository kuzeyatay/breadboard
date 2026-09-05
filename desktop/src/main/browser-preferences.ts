import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import { isTranslationLanguage, notificationOrigin, type BrowserPreferences, type BrowserPreferenceCommand } from "../shared/browser-preferences";

/** The same persistent profile owns browser cookies and notification grants. */
export class BrowserPreferenceStore {
  private value: BrowserPreferences = { notificationsEnabled: true, sites: {}, translationLanguage: "en" };
  private readError = false;
  constructor(private readonly directory: string, private readonly log: (message: string) => void = () => {}) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, "browser-preferences.json"), "utf8"));
      if (typeof value.notificationsEnabled !== "boolean" || !isTranslationLanguage(value.translationLanguage) ||
          !value.sites || typeof value.sites !== "object" || Array.isArray(value.sites) ||
          Object.entries(value.sites).some(([origin, permission]) => notificationOrigin(origin) !== origin || !["granted", "denied"].includes(String(permission)))) {
        throw new Error("Invalid browser preferences");
      }
      this.value = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.readError = true;
        this.value.notificationsEnabled = false;
        log("Browser preferences could not be read; notification grants remain disabled.");
      }
    }
  }
  snapshot(): BrowserPreferences { return { ...this.value, sites: { ...this.value.sites } }; }
  permission(url: string): NotificationPermission {
    const origin = notificationOrigin(url);
    return !this.value.notificationsEnabled || !origin ? "denied" : this.value.sites[origin] ?? "default";
  }
  update(command: BrowserPreferenceCommand): boolean {
    if (this.readError) return false;
    const next = this.snapshot();
    if (command.type === "browser-notifications-enabled") next.notificationsEnabled = command.enabled;
    else if (command.type === "browser-translation-language") {
      if (!isTranslationLanguage(command.language)) return false;
      next.translationLanguage = command.language;
    } else {
      if (notificationOrigin(command.origin) !== command.origin) return false;
      if (command.permission === "default") delete next.sites[command.origin];
      else next.sites[command.origin] = command.permission;
    }
    try {
      atomicWriteFile(path.join(this.directory, "browser-preferences.json"), JSON.stringify(next, null, 2));
      this.value = next;
      return true;
    } catch { this.log("Browser preferences could not be saved."); return false; }
  }
}
