import db from "../db.ts";

export interface SavedPrompt {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: string;
  favorite: boolean;
  isDefault: boolean;
}

export const LEGACY_PROMPTS_KEY = "sb_prompts_v1";

export const DEFAULT_PROMPTS: SavedPrompt[] = [
  ["dp-1", "summarize-all-documents", "Summarize all documents", "Summarize the key points from all documents in this garden into a concise, structured overview with clear headings.", "Summary"],
  ["dp-2", "study-guide", "Study guide", "Create a comprehensive study guide from my materials. Include key concepts, definitions, important facts, and any formulas or equations. Organize by topic.", "Study"],
  ["dp-3", "quiz-me", "Quiz me", "Generate 8 quiz questions based on the content in this garden to test my understanding. Mix multiple choice and open questions. Include correct answers at the end.", "Study"],
  ["dp-4", "explain-for-a-beginner", "Explain like I'm a beginner", "Explain the main concepts in this garden as if I have no prior background in the subject. Use simple language, analogies, and real-world examples.", "Study"],
  ["dp-5", "find-connections", "Find connections", "Identify and explain the key connections, relationships, and dependencies between the topics and documents in this garden. Show how ideas link together.", "Analysis"],
  ["dp-6", "gaps-and-contradictions", "Gaps and contradictions", "Analyze my documents and identify: (1) gaps in information where more research is needed, (2) any contradictions or conflicting information between sources, (3) assumptions that may be worth questioning.", "Analysis"],
  ["dp-7", "extract-key-formulas-and-terms", "Extract key formulas and terms", "List all important formulas, equations, technical terms, and definitions from my documents. Format each with a brief explanation of what it means and when to use it.", "Analysis"],
  ["dp-8", "essay-outline", "Essay outline", "Based on my documents, write a detailed outline for an academic essay or report covering the main topic. Include thesis, main arguments, supporting points, and a suggested conclusion.", "Writing"],
  ["dp-9", "action-items-and-tasks", "Action items and tasks", "Extract all action items, tasks, to-dos, deadlines, and next steps mentioned anywhere in my documents. Present as a prioritized list.", "Summary"],
  ["dp-10", "timeline-of-events", "Timeline of events", "Create a chronological timeline of all events, milestones, dates, or sequential steps mentioned in my materials. Include brief descriptions for each entry.", "Summary"],
].map(([id, slug, title, content, category]) => ({
  id,
  slug,
  title,
  content,
  category,
  favorite: false,
  isDefault: true,
}));

type PromptRow = {
  id: number;
  legacy_id: string | null;
  slug: string;
  title: string;
  content: string;
  category: string;
  favorite: number;
};

function fromRow(row: PromptRow): SavedPrompt {
  return {
    id: `user-${row.id}`,
    slug: row.slug,
    title: row.title,
    content: row.content,
    category: row.category,
    favorite: row.favorite === 1,
    isDefault: false,
  };
}

export function promptSlug(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return slug || "custom-prompt";
}

function uniqueSlug(userId: number, requested: string, excludingId?: number): string {
  const base = promptSlug(requested);
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = suffix ? `${base}-${suffix + 1}`.slice(0, 64) : base;
    const row = db.prepare(
      "SELECT id FROM openharness_prompts WHERE user_id = ? AND slug = ? AND (? IS NULL OR id <> ?)",
    ).get(userId, candidate, excludingId ?? null, excludingId ?? null);
    if (!row && !DEFAULT_PROMPTS.some((prompt) => prompt.slug === candidate)) return candidate;
  }
  throw new Error("Could not allocate a unique prompt slug.");
}

export function listPrompts(userId: number): SavedPrompt[] {
  const rows = db.prepare(
    "SELECT id, legacy_id, slug, title, content, category, favorite FROM openharness_prompts WHERE user_id = ? ORDER BY favorite DESC, updated_at DESC, id DESC",
  ).all(userId) as PromptRow[];
  return [...DEFAULT_PROMPTS, ...rows.map(fromRow)];
}

export function resolvePrompt(userId: number | null, slug: string): SavedPrompt | null {
  const builtIn = DEFAULT_PROMPTS.find((prompt) => prompt.slug === slug);
  if (builtIn) return builtIn;
  if (userId === null) return null;
  const row = db.prepare(
    "SELECT id, legacy_id, slug, title, content, category, favorite FROM openharness_prompts WHERE user_id = ? AND slug = ?",
  ).get(userId, slug) as PromptRow | undefined;
  return row ? fromRow(row) : null;
}

export function createPrompt(userId: number, input: { title: string; content: string; category?: string; favorite?: boolean; legacyId?: string }): SavedPrompt {
  const slug = uniqueSlug(userId, input.title);
  const result = db.prepare(
    `INSERT INTO openharness_prompts (user_id, legacy_id, slug, title, content, category, favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, input.legacyId ?? null, slug, input.title, input.content, input.category || "Custom", input.favorite ? 1 : 0);
  return resolvePrompt(userId, slug) ?? { id: `user-${result.lastInsertRowid}`, slug, title: input.title, content: input.content, category: input.category || "Custom", favorite: Boolean(input.favorite), isDefault: false };
}

export function updatePrompt(userId: number, id: number, input: { title: string; content: string; category?: string; favorite?: boolean }): SavedPrompt | null {
  const exists = db.prepare("SELECT id FROM openharness_prompts WHERE id = ? AND user_id = ?").get(id, userId);
  if (!exists) return null;
  const slug = uniqueSlug(userId, input.title, id);
  db.prepare(
    `UPDATE openharness_prompts SET slug = ?, title = ?, content = ?, category = ?, favorite = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).run(slug, input.title, input.content, input.category || "Custom", input.favorite ? 1 : 0, id, userId);
  return resolvePrompt(userId, slug);
}

export function deletePrompt(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM openharness_prompts WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function importLegacyPrompts(userId: number, values: unknown[]): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  const insert = db.transaction(() => {
    for (const value of values.slice(0, 200)) {
      if (!value || typeof value !== "object") { skipped += 1; continue; }
      const record = value as Record<string, unknown>;
      const legacyId = typeof record.id === "string" ? record.id.slice(0, 100) : "";
      const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
      const content = typeof record.content === "string" ? record.content.trim().slice(0, 50_000) : "";
      const category = typeof record.category === "string" ? record.category.trim().slice(0, 100) : "Custom";
      if (!legacyId || !title || !content || record.isDefault === true || DEFAULT_PROMPTS.some((prompt) => prompt.id === legacyId)) {
        skipped += 1;
        continue;
      }
      const exists = db.prepare("SELECT id FROM openharness_prompts WHERE user_id = ? AND legacy_id = ?").get(userId, legacyId);
      if (exists) { skipped += 1; continue; }
      createPrompt(userId, { legacyId, title, content, category, favorite: record.favorite === true });
      imported += 1;
    }
  });
  insert();
  return { imported, skipped };
}
