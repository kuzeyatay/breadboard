import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import { isTranslationLanguage, notificationOrigin, translationSite, type BrowserPreferences, type BrowserPreferenceCommand } from "../shared/browser-preferences";

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
      const translationSites = value.translationSites ?? {};
      if (typeof translationSites !== "object" || Array.isArray(translationSites) ||
          Object.entries(translationSites).some(([site, language]) =>
            (translationSite(`https://${site}`) !== site && translationSite(`http://${site}`) !== site) || !isTranslationLanguage(language))) {
        throw new Error("Invalid translation preferences");
      }
      this.value = { ...value, translationSites };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.readError = true;
        this.value.notificationsEnabled = false;
        log("Browser preferences could not be read; notification grants remain disabled.");
      }
    }
  }
  snapshot(): BrowserPreferences { return { ...this.value, sites: { ...this.value.sites }, translationSites: { ...this.value.translationSites } }; }
  translationLanguageFor(url: string): string | undefined {
    const site = translationSite(url);
    return site && Object.hasOwn(this.value.translationSites ?? {}, site) ? this.value.translationSites![site] : undefined;
  }
  setSiteTranslation(url: string, language: string | null): boolean {
    const site = translationSite(url);
    if (this.readError || !site || (language !== null && !isTranslationLanguage(language))) return false;
    const next = this.snapshot();
    if (language === null) delete next.translationSites![site];
    else next.translationSites = { ...next.translationSites, [site]: language };
    return this.save(next);
  }
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
    return this.save(next);
  }
  private save(next: BrowserPreferences): boolean {
    try {
      atomicWriteFile(path.join(this.directory, "browser-preferences.json"), JSON.stringify(next, null, 2));
      this.value = next;
      return true;
    } catch { this.log("Browser preferences could not be saved."); return false; }
  }
}
