/** Per-site device and data grants the browser asks about (Chrome's site settings). */
export const BROWSER_MEDIA_PERMISSIONS = ["microphone", "camera", "location"] as const;
export type BrowserMediaPermission = typeof BROWSER_MEDIA_PERMISSIONS[number];

export function isBrowserMediaPermission(value: unknown): value is BrowserMediaPermission {
  return (BROWSER_MEDIA_PERMISSIONS as readonly unknown[]).includes(value);
}

export function isBrowserMediaPermissionList(value: unknown): value is BrowserMediaPermission[] {
  return Array.isArray(value) && value.length > 0 && value.length <= BROWSER_MEDIA_PERMISSIONS.length &&
    value.every(isBrowserMediaPermission) && new Set(value).size === value.length;
}

export interface BrowserPreferences {
  notificationsEnabled: boolean;
  organizationSidebarEnabled?: boolean;
  sites: Record<string, "granted" | "denied">;
  mediaSites?: Record<string, Partial<Record<BrowserMediaPermission, "granted" | "denied">>>;
  translationLanguage: string;
  translationSites?: Record<string, string>;
  /** Sites allowed to open zoommtg:, msteams: ... links without asking. */
  appLinks?: Record<string, string[]>;
}

export function isAppLinkScheme(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9+.-]{0,31}$/u.test(value);
}

/** Saved website sign-in as the settings page sees it: never the password. */
export interface SavedPasswordSummary { origin: string; username: string }

export const TRANSLATION_LANGUAGES = "af ak am ar as ay az be bg bho bm bn bo bs ca ceb co cs cy da de doi dv ee el en eo es et eu fa fi fil fj fr fy ga gd gl gn gu ha haw he hi hmn hr ht hu hy id ig ilo is it ja jv ka kk km kn ko kri ku ky la lb lg ln lo lt lus lv mai mg mi mk ml mn mni mr ms mt my ne nl no nso ny om or pa pl ps pt pt-BR qu ro ru rw sa sd si sk sl sm sn so sq sr st su sv sw ta te tg th ti tk tl tr ts tt ug uk ur uz vi xh yi yo zh-Hans zh-Hant zu".split(" ");

export function isTranslationLanguage(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(value);
}

/** Remember a host across paths and HTTP-to-HTTPS upgrades, without opting in other hosts. */
export function translationSite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.host : null;
  } catch { return null; }
}

export function notificationOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      ? url.origin : null;
  } catch { return null; }
}

export type BrowserPreferenceCommand =
  | { type: "browser-organization-enabled"; enabled: boolean }
  | { type: "browser-notifications-enabled"; enabled: boolean }
  | { type: "browser-notification-permission"; origin: string; permission: "default" | "granted" | "denied" }
  | { type: "browser-media-permission"; origin: string; media: BrowserMediaPermission[]; permission: "default" | "granted" | "denied" }
  | { type: "browser-translation-language"; language: string }
  | { type: "browser-app-link"; origin: string; scheme: string; allowed: boolean }
  | { type: "browser-password-delete"; origin: string; username: string };

export interface BrowserTranslationState {
  status: "original" | "translating" | "translated" | "error";
  language: string;
  translated: number;
  error?: string;
}
