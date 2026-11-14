// Dependency-free: the Quartz build imports this to label every page.
export const PAGE_AUTHORSHIP_LABELS = {
  "human-written": "Human written",
  "ai-written": "AI written",
  "ai-edited": "AI edited",
  "human-edited": "Human edited",
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
