import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";
import { isTranslationLanguage, isBrowserMediaPermission, isBrowserMediaPermissionList, notificationOrigin, translationSite, isAppLinkScheme, type BrowserMediaPermission, type BrowserPreferences, type BrowserPreferenceCommand } from "../shared/browser-preferences";

/** The same persistent profile owns browser cookies and notification grants. */
export class BrowserPreferenceStore {
  private value: BrowserPreferences = { notificationsEnabled: true, organizationSidebarEnabled: true, sites: {}, translationLanguage: "en" };
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
      const mediaSites = value.mediaSites ?? {};
      if (typeof mediaSites !== "object" || Array.isArray(mediaSites) ||
          Object.entries(mediaSites).some(([origin, permissions]) => notificationOrigin(origin) !== origin ||
            !permissions || typeof permissions !== "object" || Array.isArray(permissions) ||
            Object.entries(permissions).some(([kind, permission]) => !isBrowserMediaPermission(kind) ||
              (permission !== "granted" && permission !== "denied")))) {
        throw new Error("Invalid media permissions");
      }
      // Unreadable app-link entries are dropped, not fatal: they only skip a confirmation.
      const appLinks = Object.fromEntries(Object.entries(value.appLinks && typeof value.appLinks === "object" ? value.appLinks : {})
        .filter(([origin, schemes]) => notificationOrigin(origin) === origin && Array.isArray(schemes))
        .map(([origin, schemes]) => [origin, (schemes as unknown[]).filter(isAppLinkScheme)]));
      this.value = { ...value, organizationSidebarEnabled: value.organizationSidebarEnabled !== false, translationSites, mediaSites, appLinks };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.readError = true;
        this.value.notificationsEnabled = false;
        log("Browser preferences could not be read; site grants remain disabled.");
      }
    }
  }
  snapshot(): BrowserPreferences {
    return { ...this.value, sites: { ...this.value.sites }, translationSites: { ...this.value.translationSites },
      mediaSites: Object.fromEntries(Object.entries(this.value.mediaSites ?? {}).map(([origin, permissions]) => [origin, { ...permissions }])),
      appLinks: Object.fromEntries(Object.entries(this.value.appLinks ?? {}).map(([origin, schemes]) => [origin, [...schemes]])) };
  }
  appLinkAllowed(origin: string, scheme: string): boolean {
    return this.value.appLinks?.[origin]?.includes(scheme) === true;
  }
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
  mediaPermission(url: string, kind: BrowserMediaPermission): NotificationPermission {
    const origin = notificationOrigin(url);
    return this.readError || !origin ? "denied" : this.value.mediaSites?.[origin]?.[kind] ?? "default";
  }
  update(command: BrowserPreferenceCommand): boolean {
    if (this.readError) return false;
    const next = this.snapshot();
    if (command.type === "browser-organization-enabled") next.organizationSidebarEnabled = command.enabled;
    else if (command.type === "browser-notifications-enabled") next.notificationsEnabled = command.enabled;
    else if (command.type === "browser-translation-language") {
      if (!isTranslationLanguage(command.language)) return false;
      next.translationLanguage = command.language;
    } else if (command.type === "browser-media-permission") {
      if (notificationOrigin(command.origin) !== command.origin || !isBrowserMediaPermissionList(command.media) ||
          !["default", "granted", "denied"].includes(command.permission)) return false;
      const permissions = next.mediaSites![command.origin] ?? {};
      for (const kind of command.media) {
        if (command.permission === "default") delete permissions[kind];
        else permissions[kind] = command.permission;
      }
      if (Object.keys(permissions).length) next.mediaSites![command.origin] = permissions;
      else delete next.mediaSites![command.origin];
    } else if (command.type === "browser-app-link") {
      if (notificationOrigin(command.origin) !== command.origin || !isAppLinkScheme(command.scheme)) return false;
      const schemes = new Set(next.appLinks![command.origin] ?? []);
      if (command.allowed) schemes.add(command.scheme); else schemes.delete(command.scheme);
      if (schemes.size) next.appLinks![command.origin] = [...schemes].sort();
      else delete next.appLinks![command.origin];
    } else if (command.type === "browser-password-delete") {
      return false; // Passwords live in BrowserPasswords, never in this file.
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
