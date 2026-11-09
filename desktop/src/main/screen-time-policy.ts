export interface ScreenTimeContext {
  userId: string | null;
  tab?: { id: number; title: string; url: string; browser: boolean; private: boolean };
}
export interface ScreenTimeSample { pid?: number; process?: string; title?: string; idleSeconds: number }
export interface ScreenTimeSlice {
  start: number; end: number; app: string; process: string; title: string;
  kind: "app" | "breadboard" | "website"; tabId?: number; url?: string; domain?: string;
}
export interface ScreenTimePreferences { enabled: boolean; excluded: string[] }
const PRIVATE_WINDOW = /\b(incognito|inprivate|private browsing|private window)\b/i;
const SYSTEM_PROCESS = /^(lockapp|logonui|screensaver|scrnsave|credentialuibroker)$/i;
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);

export function screenTimePreferences(value: unknown): ScreenTimePreferences {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { enabled: row.enabled !== false, excluded: Array.isArray(row.excluded)
    ? row.excluded.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean).slice(0, 100) : [] };
}

export function screenTimeExcluded(app: string, title: string, exclusions: readonly string[]): boolean {
  const a = app.toLowerCase(), t = title.toLowerCase();
  return exclusions.some(value => {
    const [matchApp, ...matchTitle] = value.toLowerCase().split("::");
    return matchTitle.length ? a.includes(matchApp!) && t.includes(matchTitle.join("::"))
      : a.includes(matchApp!) || t.includes(matchApp!);
  });
}

/** Retain only navigable URLs, without credentials, query strings or fragments. */
export function screenTimeUrl(value: string, browser: boolean): { url?: string; domain?: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return {};
    if (!browser) return { url: url.pathname };
    if (url.username || url.password) return {};
    return { url: `${url.origin}${url.pathname}`, domain: url.hostname.replace(/^www\./, "") };
  } catch { return {}; }
}

export function screenTimeActivity(sample: ScreenTimeSample, context: ScreenTimeContext, preferences: ScreenTimePreferences, ownPid: number): Omit<ScreenTimeSlice, "start" | "end"> | null {
  if (!preferences.enabled || !context.userId || !/^[1-9]\d*$/.test(context.userId) ||
      !Number.isFinite(sample.idleSeconds) || sample.idleSeconds >= 300 || !sample.process ||
      SYSTEM_PROCESS.test(sample.process) || PRIVATE_WINDOW.test(sample.title ?? "")) return null;
  const tab = sample.pid === ownPid ? context.tab : undefined;
  // Auxiliary Electron windows have no verified tab context; fail closed for privacy.
  if (sample.pid === ownPid && !tab) return null;
  if (tab?.private) return null;
  const process = clean(sample.process);
  const title = clean(tab?.title || sample.title || process);
  const app = sample.pid === ownPid ? "Breadboard" : ({ msedge: "Microsoft Edge", chrome: "Google Chrome", firefox: "Firefox",
    code: "Visual Studio Code", explorer: "File Explorer", winword: "Microsoft Word", excel: "Microsoft Excel",
    powerpnt: "PowerPoint", devenv: "Visual Studio", windowsterminal: "Windows Terminal" } as Record<string, string>)[process.toLowerCase()] || process;
  if (screenTimeExcluded(app, title, preferences.excluded) || screenTimeExcluded(process, title, preferences.excluded)) return null;
  return { app, process, title, kind: tab ? tab.browser ? "website" : "breadboard" : "app",
    ...(tab ? { tabId: tab.id, ...screenTimeUrl(tab.url, tab.browser) } : {}) };
}

/** Attribute the preceding observed interval; gaps (sleep or stalled helpers) are never time spent. */
export function observedScreenTime(previous: { at: number; activity: Omit<ScreenTimeSlice, "start" | "end"> } | null, now: number): ScreenTimeSlice | null {
  if (!previous || now <= previous.at || now - previous.at > 6000) return null;
  return { ...previous.activity, start: previous.at, end: now };
}

export function sameScreenTimeActivity(a: Omit<ScreenTimeSlice, "start" | "end">, b: Omit<ScreenTimeSlice, "start" | "end">): boolean {
  return a.app === b.app && a.process === b.process && a.title === b.title && a.url === b.url && a.kind === b.kind;
}
