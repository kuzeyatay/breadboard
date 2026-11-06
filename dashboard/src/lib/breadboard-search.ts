/** Shared search contract. This module is safe to import in the launcher. */
export const SEARCH_TYPES = ["garden", "note", "file", "chat", "task", "event", "room", "place"] as const;
export type SearchType = typeof SEARCH_TYPES[number];
export type SearchFilter = "all" | SearchType;

export const SEARCH_LABELS: Record<SearchFilter, string> = {
  all: "All", garden: "Gardens", note: "Notes", file: "Files", chat: "Chats",
  task: "Tasks", event: "Events", room: "Rooms", place: "Places",
};

export interface BreadboardSearchResult {
  id: string;
  type: SearchType;
  title: string;
  href: string;
  context: string;
  snippet: string;
  score: number;
}

export interface BreadboardSearchResponse {
  query: string;
  results: BreadboardSearchResult[];
  limited: SearchType[];
  unavailable: SearchType[];
}

export const SEARCH_PLACES = [
  { title: "Terminal", href: "/new-tab", context: "Gardens, chats, search, and recent work" },
  { title: "Plan", href: "/plan", context: "Projects, tasks, boards, and to-dos" },
  { title: "Organization", href: "/buzz", context: "Buzz, teams, rooms, and messages" },
  { title: "Calendar", href: "/plan?view=calendar", context: "Events, meetings, and schedule" },
  { title: "Work Timer", href: "/pomodoro", context: "Pomodoro, focus, and breaks" },
  { title: "Settings", href: "/settings", context: "Account, profile, downloads, and preferences" },
  { title: "Garden Library", href: "/garden", context: "Explore your knowledge and notes" },
  { title: "Voice", href: "/voice?view=full", context: "Talk with your assistant" },
] as const;

export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 8);
}

export function searchScore(title: string, text: string, query: string): number {
  const phrase = query.trim().toLowerCase();
  if (!phrase) return 0;
  const name = title.toLowerCase();
  const body = text.toLowerCase();
  const terms = searchTerms(query);
  if (name === phrase) return 120;
  const exact = name.includes(phrase) || body.includes(phrase);
  if (!exact && (!terms.length || !terms.every(term => name.includes(term) || body.includes(term)))) return 0;
  return (name.startsWith(phrase) ? 85 : name.includes(phrase) ? 70 : 0)
    + (body.includes(phrase) ? 12 : 0)
    + terms.reduce((score, term) => score + (name.includes(term) ? 8 : 1), 0);
}

export function searchSnippet(text: string, query: string, length = 190): string {
  const clean = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, " ")
    .replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const matches = searchTerms(query).map(term => lower.indexOf(term)).filter(index => index >= 0);
  const start = Math.max(0, (matches.length ? Math.min(...matches) : 0) - 55);
  return `${start ? "…" : ""}${clean.slice(start, start + length).trim()}${clean.length > start + length ? "…" : ""}`;
}

export function sortSearchResults(results: BreadboardSearchResult[]): BreadboardSearchResult[] {
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function searchPlaces(query: string): BreadboardSearchResult[] {
  return SEARCH_PLACES.map(place => ({ ...place, id: `place:${place.href}`, type: "place" as const,
    snippet: place.context, score: searchScore(place.title, place.context, query),
  })).filter(result => result.score > 0);
}
