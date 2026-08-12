// LESSONS: what a skill learned the last time it was used.
//
// A reviewed skill's SKILL.md is fixed guidance written by whoever published
// it. It cannot know that on *this* machine the binary lives somewhere else,
// that a flag it recommends was removed two versions ago, or that the approach
// in its second example does not work here. Every one of those is discovered
// mid-turn, explained to the user, and then forgotten — and rediscovered the
// next time, at the same cost.
//
// A lesson is one short correction attached to a skill, written when that
// happens and injected alongside the skill's own guidance from then on.
//
// == Why lessons are not written into the skill directory ==
//
// The obvious implementation — append to a LESSONS.md next to SKILL.md — is
// wrong here, and the reason is the part worth remembering. Breadboard's skill
// trust model hashes a skill's directory at review time and re-verifies it on
// load: `integrityVerified` going false is how a tampered-with skill is caught.
// Writing lessons into that directory would make every lesson indistinguishable
// from tampering, and the only way to keep skills loadable would be to weaken
// the check that makes them safe.
//
// So lessons live here instead, in Breadboard's own database, keyed by slug.
// Three things follow, all of them improvements rather than concessions:
//
//   * The reviewed snapshot stays byte-identical and keeps verifying.
//   * A lesson is *the user's* data, not the publisher's — readable, editable
//     and deletable through Breadboard, and gone when the user says so.
//   * Reinstalling or updating a skill does not silently discard what was
//     learned about running it here, because the two were never the same file.

import type DatabaseType from "better-sqlite3";

import db from "../db.ts";

type Db = DatabaseType.Database;

/**
 * How many lessons one skill may carry.
 *
 * Every lesson is injected on every turn that uses the skill, so the file is
 * paid for repeatedly and forever. A cap keeps a skill's accumulated notes from
 * quietly growing past the guidance they annotate; the oldest go first, on the
 * assumption that a correction nobody has re-learned in a hundred lessons has
 * either been fixed upstream or stopped mattering.
 */
export const MAX_LESSONS_PER_SKILL = 12;
export const MAX_LESSON_LENGTH = 400;

export interface SkillLessonRow {
  id: number;
  user_id: number;
  skill_slug: string;
  lesson: string;
  source_conversation_id: number | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
}

export interface SkillLesson {
  id: number;
  skillSlug: string;
  lesson: string;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

export function ensureSkillLessonSchema(database: Db): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS skill_lessons (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_slug             TEXT    NOT NULL,
      lesson                 TEXT    NOT NULL,
      source_conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
      last_used_at           TEXT,
      use_count              INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_skill_lessons_lookup
      ON skill_lessons(user_id, skill_slug, created_at DESC);

    -- The same correction learned twice is one lesson. Without this a skill
    -- that keeps failing the same way fills its whole allowance with copies of
    -- one sentence and pushes out everything else it knows.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_lessons_unique
      ON skill_lessons(user_id, skill_slug, lesson);
  `);
}

let schemaReady = false;

function handle(database?: Db): Db {
  const target = database ?? db;
  if (database || !schemaReady) {
    ensureSkillLessonSchema(target);
    if (!database) schemaReady = true;
  }
  return target;
}

export function normalizeSkillSlug(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, 120).replace(/[^a-z0-9_.-]/g, "")
    : "";
}

/**
 * Tidy one lesson into the single self-contained sentence it has to be.
 *
 * Lessons are read months later beside a skill, with none of the conversation
 * that produced them. A lesson that says "that didn't work, use the other one"
 * is worse than no lesson, so the shape is enforced here rather than hoped for:
 * one line, no markdown bullet, bounded length.
 */
export function normalizeLesson(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s+/g, " ")
    .replace(/^[-*+\s]+/, "")
    .trim()
    .slice(0, MAX_LESSON_LENGTH);
}

export function recordSkillLesson(
  input: {
    userId: number;
    skillSlug: string;
    lesson: string;
    conversationId?: number | null;
  },
  database?: Db,
): SkillLesson | null {
  const target = handle(database);
  const slug = normalizeSkillSlug(input.skillSlug);
  const lesson = normalizeLesson(input.lesson);
  if (!slug || !lesson) return null;

  const write = target.transaction(() => {
    // A repeated lesson is not a new one, but it *is* evidence the correction
    // still matters — so it refreshes rather than duplicating or being dropped.
    const existing = target
      .prepare(
        "SELECT * FROM skill_lessons WHERE user_id = ? AND skill_slug = ? AND lesson = ?",
      )
      .get(input.userId, slug, lesson) as SkillLessonRow | undefined;
    if (existing) {
      target
        .prepare(
          "UPDATE skill_lessons SET created_at = datetime('now') WHERE id = ?",
        )
        .run(existing.id);
      return existing.id;
    }
    const result = target
      .prepare(
        `INSERT INTO skill_lessons (user_id, skill_slug, lesson, source_conversation_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.userId, slug, lesson, input.conversationId ?? null);
    // Trim to the cap in the same transaction, so the table can never be read
    // between the insert and the eviction and see an over-long list.
    target
      .prepare(
        `DELETE FROM skill_lessons
         WHERE user_id = ? AND skill_slug = ? AND id NOT IN (
           SELECT id FROM skill_lessons
           WHERE user_id = ? AND skill_slug = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )`,
      )
      .run(input.userId, slug, input.userId, slug, MAX_LESSONS_PER_SKILL);
    return Number(result.lastInsertRowid);
  });

  const id = write();
  const row = target
    .prepare("SELECT * FROM skill_lessons WHERE id = ?")
    .get(id) as SkillLessonRow | undefined;
  return row ? present(row) : null;
}

export function listSkillLessons(
  userId: number,
  skillSlug: string,
  database?: Db,
): SkillLesson[] {
  const target = handle(database);
  const slug = normalizeSkillSlug(skillSlug);
  if (!slug) return [];
  return (
    target
      .prepare(
        `SELECT * FROM skill_lessons
         WHERE user_id = ? AND skill_slug = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(userId, slug, MAX_LESSONS_PER_SKILL) as SkillLessonRow[]
  ).map(present);
}

/** Every lesson the user has, newest first — what the Skills page shows. */
export function listAllSkillLessons(userId: number, database?: Db): SkillLesson[] {
  const target = handle(database);
  return (
    target
      .prepare(
        "SELECT * FROM skill_lessons WHERE user_id = ? ORDER BY created_at DESC, id DESC",
      )
      .all(userId) as SkillLessonRow[]
  ).map(present);
}

export function forgetSkillLesson(userId: number, id: number, database?: Db): boolean {
  return (
    handle(database)
      .prepare("DELETE FROM skill_lessons WHERE id = ? AND user_id = ?")
      .run(id, userId).changes > 0
  );
}

/** Record that these lessons were actually put in front of a turn. */
export function markSkillLessonsUsed(
  userId: number,
  skillSlug: string,
  database?: Db,
): void {
  const target = handle(database);
  const slug = normalizeSkillSlug(skillSlug);
  if (!slug) return;
  target
    .prepare(
      `UPDATE skill_lessons
       SET use_count = use_count + 1, last_used_at = datetime('now')
       WHERE user_id = ? AND skill_slug = ?`,
    )
    .run(userId, slug);
}

/**
 * The block appended to a skill's guidance, or "" when it has learned nothing.
 *
 * Deliberately labelled as local and later than the skill itself: a lesson has
 * to win against the manifest it annotates (that is the entire point), and a
 * model given two conflicting instructions with no ordering will pick either.
 */
export function renderSkillLessons(lessons: readonly SkillLesson[]): string {
  if (lessons.length === 0) return "";
  return [
    "[Lessons learned on this machine — these were recorded after this skill",
    "was used here, and they override the guidance above where they disagree.]",
    ...lessons.map((entry) => `- ${entry.lesson}`),
  ].join("\n");
}

/** Guidance plus lessons, in the order the model should weigh them. */
export function skillGuidanceWithLessons(
  guidance: string,
  lessons: readonly SkillLesson[],
): string {
  const block = renderSkillLessons(lessons);
  return block ? `${guidance}\n\n${block}` : guidance;
}

function present(row: SkillLessonRow): SkillLesson {
  return {
    id: row.id,
    skillSlug: row.skill_slug,
    lesson: row.lesson,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}
