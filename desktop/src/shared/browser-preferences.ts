export interface BrowserPreferences {
  notificationsEnabled: boolean;
  sites: Record<string, "granted" | "denied">;
  translationLanguage: string;
}

export const TRANSLATION_LANGUAGES = "af ak am ar as ay az be bg bho bm bn bo bs ca ceb co cs cy da de doi dv ee el en eo es et eu fa fi fil fj fr fy ga gd gl gn gu ha haw he hi hmn hr ht hu hy id ig ilo is it ja jv ka kk km kn ko kri ku ky la lb lg ln lo lt lus lv mai mg mi mk ml mn mni mr ms mt my ne nl no nso ny om or pa pl ps pt pt-BR qu ro ru rw sa sd si sk sl sm sn so sq sr st su sv sw ta te tg th ti tk tl tr ts tt ug uk ur uz vi xh yi yo zh-Hans zh-Hant zu".split(" ");

export function isTranslationLanguage(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(value);
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
  | { type: "browser-notifications-enabled"; enabled: boolean }
  | { type: "browser-notification-permission"; origin: string; permission: "default" | "granted" | "denied" }
  | { type: "browser-translation-language"; language: string };

export interface BrowserTranslationState {
  status: "original" | "translating" | "translated" | "error";
  language: string;
  translated: number;
  error?: string;
}
