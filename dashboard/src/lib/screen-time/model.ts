export type ScreenTimePeriod = "day" | "week" | "month";
export type ActivityCategory = "creating" | "learning" | "communication" | "entertainment" | "browsing" | "other";
export const CATEGORIES: { id: ActivityCategory; label: string; color: string }[] = [
  { id: "creating", label: "Creating", color: "#659875" },
  { id: "learning", label: "Learning", color: "#7e9fc0" },
  { id: "communication", label: "Communication", color: "#b194c5" },
  { id: "entertainment", label: "Entertainment", color: "#d6a06d" },
  { id: "browsing", label: "Browsing", color: "#8cbcb0" },
  { id: "other", label: "Other", color: "#a5aaa0" },
];
export interface UsageSlice {
  start: number; end: number; app: string; process: string; title: string;
  kind: "app" | "breadboard" | "website"; tabId?: number; url?: string; domain?: string;
}
export interface UsageItem {
  id: string; name: string; subtitle: string; milliseconds: number; visits: number;
  category: ActivityCategory; app: string; title?: string; url?: string; domain?: string;
  start: number; end: number;
}
export interface UsageBucket { start: number; end: number; total: number; categories: Record<ActivityCategory, number>; apps: UsageItem[]; tabs: UsageItem[]; websites: UsageItem[] }
export interface UsageSummary {
  total: number; breadboardTotal: number; longestSession: number; switches: number;
  apps: UsageItem[]; tabs: UsageItem[]; websites: UsageItem[]; timeline: UsageSlice[];
  categories: { id: ActivityCategory; milliseconds: number }[]; buckets: UsageBucket[];
}
export interface ScreenTimeSettings { enabled: boolean; excluded: string[]; useForSuggestions: boolean }
export interface ScreenTimeResponse {
  summary: UsageSummary; previousTotal: number; range: { start: number; end: number };
  settings: ScreenTimeSettings;
  status: { state: string; updatedAt: number | null; available: boolean };
  recall: { enabled: boolean; agentAccess: boolean };
}

export function usageCategory(slice: Pick<UsageSlice, "app" | "process" | "url" | "domain" | "title">): ActivityCategory {
  // Categories describe activity, never a judgment about productivity.
  const text = `${slice.app} ${slice.process} ${slice.domain ?? ""} ${slice.url ?? ""}`.toLowerCase();
  if (/code|studio|figma|photoshop|illustrator|blender|solidworks|fusion|github|gitlab|terminal|powershell|word|excel|powerpoint|\/artifacts|\/cad/.test(text)) return "creating";
  if (/\/garden|\/reader|\/review|wikipedia|arxiv|scholar|coursera|udemy|khanacademy|notion|obsidian/.test(text)) return "learning";
  if (/slack|teams|discord|outlook|mail|whatsapp|telegram|zoom|\/buzz/.test(text)) return "communication";
  if (/spotify|netflix|youtube|twitch|steam|vlc|tiktok|instagram/.test(text)) return "entertainment";
  if (slice.domain || /chrome|edge|firefox|brave|opera|safari/.test(text)) return "browsing";
  return "other";
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) return "0m";
  if (milliseconds < 60000) return "<1m";
  const minutes = Math.floor(milliseconds / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`;
}

export function safeUsageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^\/(?!\/)[^\\\u0000-\u0020]*$/.test(value)) return value.split(/[?#]/)[0];
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch { return undefined; }
}

export function readUsageSlice(value: unknown): UsageSlice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.start !== "number" || typeof row.end !== "number" || !Number.isFinite(row.start) || !Number.isFinite(row.end) ||
    row.start <= 0 || row.end <= row.start || row.end - row.start > 60000 || typeof row.app !== "string" || !row.app.trim() ||
    typeof row.title !== "string" || typeof row.process !== "string" || !["app", "breadboard", "website"].includes(String(row.kind))) return null;
  const url = safeUsageUrl(row.url);
  return { start: row.start, end: row.end, app: row.app.slice(0, 300), title: row.title.slice(0, 300), process: row.process.slice(0, 300),
    kind: row.kind as UsageSlice["kind"], ...(url ? { url } : {}),
    ...(typeof row.domain === "string" ? { domain: row.domain.slice(0, 200) } : {}) };
}

const emptyCategories = (): Record<ActivityCategory, number> => ({ creating: 0, learning: 0, communication: 0, entertainment: 0, browsing: 0, other: 0 });
const contextKey = (slice: UsageSlice) => `${slice.app}\n${slice.title}\n${slice.url ?? ""}\n${slice.kind}`;

/** Clip to the requested interval and coalesce checkpoints. Overlapping samples never add time twice. */
export function normalizeUsage(slices: readonly UsageSlice[], start: number, end: number): UsageSlice[] {
  const result: UsageSlice[] = [];
  let cursor = start;
  for (const slice of [...slices].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const from = Math.max(start, slice.start, cursor), to = Math.min(end, slice.end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const last = result.at(-1);
    if (last && last.end === from && contextKey(last) === contextKey(slice)) last.end = to;
    else result.push({ ...slice, start: from, end: to });
    cursor = to;
  }
  return result;
}

export function summarizeUsage(slices: readonly UsageSlice[], boundaries: readonly number[]): UsageSummary {
  const sessions = normalizeUsage(slices, boundaries[0] ?? 0, boundaries.at(-1) ?? 0);
  const buckets: UsageBucket[] = boundaries.slice(0, -1).map((start, i) => ({ start, end: boundaries[i + 1], total: 0, categories: emptyCategories(), apps: [], tabs: [], websites: [] }));
  const bucketMaps = buckets.map(() => ({ apps: new Map<string, UsageItem>(), tabs: new Map<string, UsageItem>(), websites: new Map<string, UsageItem>() }));
  const apps = new Map<string, UsageItem>(), tabs = new Map<string, UsageItem>(), websites = new Map<string, UsageItem>();
  const categories = emptyCategories();
  let total = 0, breadboardTotal = 0, longestSession = 0, switches = 0;
  const add = (map: Map<string, UsageItem>, id: string, name: string, subtitle: string, slice: UsageSlice, ms: number, category: ActivityCategory) => {
    const existing = map.get(id);
    if (existing) { existing.milliseconds += ms; existing.visits++; existing.end = Math.max(existing.end, slice.end); }
    else map.set(id, { id, name, subtitle, app: slice.app, title: slice.title, milliseconds: ms, visits: 1, category,
      start: slice.start, end: slice.end, url: slice.url, domain: slice.domain });
  };
  for (let i = 0; i < sessions.length; i++) {
    const slice = sessions[i], ms = slice.end - slice.start, category = usageCategory(slice);
    total += ms; categories[category] += ms; longestSession = Math.max(longestSession, ms);
    if (slice.app === "Breadboard") breadboardTotal += ms;
    if (i && sessions[i - 1].end === slice.start && contextKey(sessions[i - 1]) !== contextKey(slice)) switches++;
    add(apps, slice.app.toLowerCase(), slice.app, slice.process, slice, ms, category);
    if (slice.kind !== "app") add(tabs, `${slice.url ?? ""}\n${slice.title}`, slice.title, slice.domain || "Breadboard", slice, ms, category);
    if (slice.domain) add(websites, slice.domain, slice.domain, "In Breadboard", slice, ms, category);
    for (const [index, bucket] of buckets.entries()) {
      const overlap = Math.max(0, Math.min(slice.end, bucket.end) - Math.max(slice.start, bucket.start));
      bucket.total += overlap; bucket.categories[category] += overlap;
      if (overlap) {
        const clipped = { ...slice, start: Math.max(slice.start, bucket.start), end: Math.min(slice.end, bucket.end) };
        add(bucketMaps[index].apps, slice.app.toLowerCase(), slice.app, slice.process, clipped, overlap, category);
        if (slice.kind !== "app") add(bucketMaps[index].tabs, `${slice.url ?? ""}\n${slice.title}`, slice.title, slice.domain || "Breadboard", clipped, overlap, category);
        if (slice.domain) add(bucketMaps[index].websites, slice.domain, slice.domain, "In Breadboard", clipped, overlap, category);
      }
    }
  }
  const sorted = (map: Map<string, UsageItem>) => [...map.values()].sort((a, b) => b.milliseconds - a.milliseconds || a.name.localeCompare(b.name));
  for (const [index, bucket] of buckets.entries()) {
    bucket.apps = sorted(bucketMaps[index].apps); bucket.tabs = sorted(bucketMaps[index].tabs); bucket.websites = sorted(bucketMaps[index].websites);
  }
  // App category follows its largest observed activity rather than its first visit.
  for (const app of apps.values()) {
    const times = emptyCategories();
    for (const slice of sessions) if (slice.app.toLowerCase() === app.id) times[usageCategory(slice)] += slice.end - slice.start;
    app.category = (Object.keys(times) as ActivityCategory[]).sort((a, b) => times[b] - times[a])[0];
  }
  return { total, breadboardTotal, longestSession, switches, apps: sorted(apps), tabs: sorted(tabs), websites: sorted(websites),
    timeline: sessions.slice(-150).reverse(), categories: CATEGORIES.map(({ id }) => ({ id, milliseconds: categories[id] })).filter(item => item.milliseconds > 0), buckets };
}

/** Calendar arithmetic stays in the viewer's local timezone, including 23/25-hour days. */
export function screenTimeRange(period: ScreenTimePeriod, date: string): { boundaries: number[]; previousStart: number; previousEnd: number; start: number; end: number } {
  const selected = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(selected.getTime())) throw new Error("Choose a valid date.");
  selected.setHours(0, 0, 0, 0);
  if (period === "week") selected.setDate(selected.getDate() - (selected.getDay() + 6) % 7);
  if (period === "month") selected.setDate(1);
  const finish = new Date(selected);
  if (period === "month") finish.setMonth(finish.getMonth() + 1);
  else finish.setDate(finish.getDate() + (period === "week" ? 7 : 1));
  const previous = new Date(selected);
  if (period === "month") previous.setMonth(previous.getMonth() - 1);
  else previous.setDate(previous.getDate() - (period === "week" ? 7 : 1));
  const boundaries = [selected.getTime()];
  const step = new Date(selected);
  while (step < finish) {
    if (period === "day") step.setTime(step.getTime() + 3600000);
    else step.setDate(step.getDate() + 1);
    boundaries.push(Math.min(step.getTime(), finish.getTime()));
  }
  return { start: selected.getTime(), end: finish.getTime(), boundaries, previousStart: previous.getTime(), previousEnd: selected.getTime() };
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
