// Dependency-free: the Quartz build imports this to label every page.
export const PAGE_AUTHORSHIP_LABELS = {
  "human-written": "Human written",
  "ai-written": "AI generated",
  "ai-edited": "AI edited",
  // Older pages store this; a human editing model text is a mixed page.
  "human-edited": "AI edited",
  unsure: "Unsure",
} as const;

export type PageAuthorship = keyof typeof PAGE_AUTHORSHIP_LABELS;

export function isPageAuthorship(value: unknown): value is PageAuthorship {
  return typeof value === "string" && Object.hasOwn(PAGE_AUTHORSHIP_LABELS, value);
}

/**
 * The stored `authorship` frontmatter value. Pages written before it existed
 * fall back to their origin: only notes made in the Garden editor are human;
 * Learn lessons, ingested sources and indexes are model output.
 */
export function pageAuthorship(frontmatter: Record<string, unknown> | null | undefined): PageAuthorship {
  const stored = frontmatter?.authorship;
  if (isPageAuthorship(stored)) return stored;
  return frontmatter?.source === "user-note" ? "human-written" : "ai-written";
}

/** Who touched it last decides the "edited" side; untouched origins stay as written. */
export function editedPageAuthorship(current: PageAuthorship, editor: "human" | "ai"): PageAuthorship {
  if (editor === "human") return current.startsWith("ai-") ? "human-edited" : current;
  return current.startsWith("human-") ? "ai-edited" : current;
}

/** Characters of the current page by where they came from (`authorship_chars` frontmatter). */
export interface AuthorshipChars { typed: number; pasted: number; ai: number }
export interface AuthorshipEdit { typed?: number; pasted?: number; ai?: number; removed: number }

export function parseAuthorshipChars(value: unknown): AuthorshipChars | null {
  const match = typeof value === "string" && value.match(/^typed (\d+), pasted (\d+), ai (\d+)$/);
  return match ? { typed: Number(match[1]), pasted: Number(match[2]), ai: Number(match[3]) } : null;
}

export function formatAuthorshipChars(chars: AuthorshipChars): string {
  return `typed ${Math.round(chars.typed)}, pasted ${Math.round(chars.pasted)}, ai ${Math.round(chars.ai)}`;
}

/** Start a tally for a page that has none: its whole body belongs to its recorded origin. */
export function seedAuthorshipChars(origin: PageAuthorship, length: number): AuthorshipChars {
  if (origin === "human-written") return { typed: length, pasted: 0, ai: 0 };
  if (origin === "unsure") return { typed: 0, pasted: length, ai: 0 };
  return { typed: 0, pasted: 0, ai: length };
}

// ponytail: deletions shrink every source proportionally instead of tracking
// which characters were removed; per-range attribution if this misleads.
export function applyAuthorshipEdit(chars: AuthorshipChars, edit: AuthorshipEdit): AuthorshipChars {
  const total = chars.typed + chars.pasted + chars.ai;
  const keep = total ? Math.max(0, total - edit.removed) / total : 0;
  return {
    typed: chars.typed * keep + (edit.typed ?? 0),
    pasted: chars.pasted * keep + (edit.pasted ?? 0),
    ai: chars.ai * keep + (edit.ai ?? 0),
  };
}

/** Typed text is human; pasted text has an unknown source, so it can only make a page Unsure. */
export function classifyAuthorship(chars: AuthorshipChars): PageAuthorship | null {
  const total = chars.typed + chars.pasted + chars.ai;
  if (total < 1) return null;
  const human = chars.typed / total, pasted = chars.pasted / total, ai = chars.ai / total;
  if (human >= 0.7) return "human-written";
  if (ai >= 0.7) return "ai-written";
  if (ai >= 0.2) return "ai-edited";
  return pasted > human ? "unsure" : "human-written";
}

export interface PageAuthorshipStatus { state: PageAuthorship; label: string; score?: number; breakdown?: string }

export function pageAuthorshipStatus(frontmatter: Record<string, unknown> | null | undefined): PageAuthorshipStatus {
  const state = pageAuthorship(frontmatter);
  const status: PageAuthorshipStatus = { state: state === "human-edited" ? "ai-edited" : state, label: PAGE_AUTHORSHIP_LABELS[state] };
  const chars = parseAuthorshipChars(frontmatter?.authorship_chars);
  const total = chars ? chars.typed + chars.pasted + chars.ai : 0;
  if (!chars || total < 1) return status;
  const percent = (value: number) => Math.round((value / total) * 100);
  const human = percent(chars.typed), pasted = percent(chars.pasted), ai = percent(chars.ai);
  status.score = status.state === "human-written" ? human : status.state === "unsure" ? pasted : ai;
  status.breakdown = `Human written ${human}%\nUnsure (pasted, source unknown) ${pasted}%\nAI ${ai}%`;
  return status;
}
