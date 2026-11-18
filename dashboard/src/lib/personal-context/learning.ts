import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ContextFact } from "./rank.ts";

export type LearningEvidence = {
  key: string;
  title: string;
  detail: string;
  refs: string[];
  at: number;
  occasions: number;
};
export const evidenceKey = (input: string) => createHash("sha256").update(input).digest("hex").slice(0, 32);

// Derive on read from surviving, scoped evidence. A removed source cannot be
// reconstructed from a stale cache; corrections and suppressions store only a key.
export function learnRelationships(facts: ContextFact[]): LearningEvidence[] {
  const patterns: LearningEvidence[] = [];
  const groups = new Map<string, ContextFact[]>();
  function add(group: string, fact: ContextFact) {
    const items = groups.get(group) ?? [];
    items.push(fact);
    groups.set(group, items);
  }
  for (const f of facts) {
    if (f.source === "pattern" && f.ref.startsWith("memory:")) {
      patterns.push({
        key: evidenceKey(f.ref),
        title: f.title,
        detail: f.detail || "Confirmed by the user",
        refs: [f.ref],
        at: f.at,
        occasions: 1,
      });
    }
    if (f.source === "history" && (f.days ?? 0) >= 2) {
      patterns.push({
        key: evidenceKey("site:" + f.ref),
        title: f.title,
        refs: [f.ref],
        at: f.at,
        detail: "Revisited on " + f.days + " separate days. Usual page: " + f.ref,
        occasions: f.days!,
      });
    }
    if (f.project && (f.source === "file" || f.source === "task" || f.source === "chat"))
      add("project:" + f.project, f);
    if (f.project && f.source === "calendar" && f.detail?.startsWith("Filed from ")) {
      const source = f.detail.substring(11);
      try {
        add("destination:" + new URL(source).host + ":" + f.project, f);
      } catch {
        /* Not a sourced event. */
      }
    }
  }
  for (const [group, items] of groups) {
    items.sort((a, b) => b.at - a.at);
    const days = new Set(items.filter((f) => f.at > 0).map((f) => new Date(f.at).toISOString().slice(0, 10)));
    if (days.size < 2 || new Set(items.map((f) => f.ref)).size < 2) continue;
    const first = items[0];
    if (group.startsWith("project:") && new Set(items.map((f) => f.source)).size < 2) continue;
    if (group.startsWith("project:")) {
      const occasions = new Map<string, Set<string>>();
      const ordered = [...items].reverse();
      for (let i = 1; i < ordered.length; i++) {
        const before = ordered[i - 1],
          after = ordered[i];
        if (!before.at || after.at - before.at > 90 * 60000 || before.source === after.source) continue;
        const sequence = before.source + " → " + after.source;
        const dates = occasions.get(sequence) ?? new Set<string>();
        dates.add(new Date(after.at).toISOString().slice(0, 10));
        occasions.set(sequence, dates);
      }
      for (const [sequence, dates] of occasions)
        if (dates.size >= 2) {
          patterns.push({
            key: evidenceKey(group + sequence),
            title: first.project + " workflow",
            detail: "Observed " + sequence + " on " + dates.size + " different days in " + first.project,
            refs: items.map((f) => f.ref).slice(0, 6),
            at: first.at,
            occasions: dates.size,
          });
        }
    }
    const selected = items.slice(0, 6);
    const destination = group.startsWith("destination:");
    patterns.push({
      key: evidenceKey(group),
      title: destination
        ? first.project +
          " calendar for " +
          selected
            .map((f) => f.title)
            .slice(0, 2)
            .join(", ")
        : first.project!,
      detail: destination
        ? "On separate occasions, items " + first.detail + " went to the " + first.project + " calendar."
        : "Work across " +
          days.size +
          " separate days: " +
          selected.map((f) => f.source + " — " + f.title).join(" · "),
      at: first.at,
      refs: selected.map((f) => f.ref),
      occasions: days.size,
    });
  }
  return patterns;
}

const initialized = new WeakSet<Database.Database>();
export function feedbackSchema(db: Database.Database) {
  if (initialized.has(db)) return;
  db.exec(
    "CREATE TABLE IF NOT EXISTS personal_context_feedback (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope INTEGER NOT NULL, evidence_key TEXT NOT NULL, correction TEXT, PRIMARY KEY(user_id,scope,evidence_key))",
  );
  initialized.add(db);
}
export function reviewedPatterns(db: Database.Database, user: number, scope: number, facts: ContextFact[]) {
  const patterns = learnRelationships(facts);
  if (!patterns.length) return [];
  feedbackSchema(db);
  const rows = db
    .prepare("SELECT evidence_key,correction FROM personal_context_feedback WHERE user_id=? AND scope=?")
    .all(user, scope) as { evidence_key: string; correction: string | null }[];
  const feedback = new Map(rows.map((r) => [r.evidence_key, r.correction]));
  return patterns.flatMap((p) =>
    feedback.has(p.key) && !feedback.get(p.key)
      ? []
      : [{ ...p, detail: feedback.get(p.key) || p.detail, corrected: Boolean(feedback.get(p.key)) }],
  );
}
export function setContextFeedback(
  db: Database.Database,
  user: number,
  scope: number,
  key: string,
  correction: string | null,
) {
  feedbackSchema(db);
  db.prepare(
    "INSERT INTO personal_context_feedback VALUES(?,?,?,?) ON CONFLICT(user_id,scope,evidence_key) DO UPDATE SET correction=excluded.correction",
  ).run(user, scope, key, correction);
}
