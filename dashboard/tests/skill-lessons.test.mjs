// Lessons a skill learned on this machine.
//
// The interesting cases are the ones that keep the file from becoming noise: a
// repeated correction must not fill the allowance with copies of itself, the
// list must stay bounded, and a lesson must never leak between users.

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  MAX_LESSONS_PER_SKILL,
  ensureSkillLessonSchema,
  forgetSkillLesson,
  listAllSkillLessons,
  listSkillLessons,
  markSkillLessonsUsed,
  normalizeLesson,
  recordSkillLesson,
  renderSkillLessons,
  skillGuidanceWithLessons,
} from "../src/lib/hermes/skill-lessons.ts";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
    INSERT INTO conversations (id, user_id) VALUES (1, 1);
  `);
  ensureSkillLessonSchema(db);
  return db;
}

// --------------------------------------------------------------- normalizing

test("a lesson is flattened into one self-contained line", () => {
  assert.equal(
    normalizeLesson("- The ffmpeg binary\n  is at .portable/bin,\n not on PATH"),
    "The ffmpeg binary is at .portable/bin, not on PATH",
  );
  assert.equal(normalizeLesson("   "), "");
  assert.equal(normalizeLesson(42), "");
  assert.equal(normalizeLesson("x".repeat(900)).length, 400);
});

// ------------------------------------------------------------------ recording

test("a lesson is stored against its skill and read back newest first", () => {
  const db = createDatabase();
  recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "First thing" }, db);
  recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Second thing" }, db);

  const lessons = listSkillLessons(1, "manim", db);
  assert.deepEqual(
    lessons.map((entry) => entry.lesson),
    ["Second thing", "First thing"],
  );
});

test("learning the same thing twice refreshes one lesson rather than adding another", () => {
  const db = createDatabase();
  const first = recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Same" }, db);
  const again = recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Same" }, db);

  assert.equal(again.id, first.id, "the repeat lands on the existing lesson");
  assert.equal(listSkillLessons(1, "manim", db).length, 1);
});

test("a skill's lessons are capped, and the oldest go first", () => {
  const db = createDatabase();
  for (let index = 0; index < MAX_LESSONS_PER_SKILL + 5; index += 1) {
    recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: `Lesson ${index}` }, db);
  }

  const lessons = listSkillLessons(1, "manim", db);
  assert.equal(lessons.length, MAX_LESSONS_PER_SKILL);
  assert.equal(
    lessons.some((entry) => entry.lesson === "Lesson 0"),
    false,
    "the first thing learned is the first thing forgotten",
  );
  assert.equal(lessons[0].lesson, `Lesson ${MAX_LESSONS_PER_SKILL + 4}`);
});

test("an empty lesson or an empty slug records nothing", () => {
  const db = createDatabase();
  assert.equal(recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "  " }, db), null);
  assert.equal(recordSkillLesson({ userId: 1, skillSlug: "", lesson: "Real" }, db), null);
  assert.equal(listAllSkillLessons(1, db).length, 0);
});

test("a slug is normalized, so one skill cannot be split across spellings", () => {
  const db = createDatabase();
  recordSkillLesson({ userId: 1, skillSlug: "Manim", lesson: "A" }, db);
  recordSkillLesson({ userId: 1, skillSlug: " manim ", lesson: "B" }, db);
  assert.equal(listSkillLessons(1, "manim", db).length, 2);
});

// ------------------------------------------------------------------ isolation

test("lessons never cross between users or between skills", () => {
  const db = createDatabase();
  recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Mine" }, db);
  recordSkillLesson({ userId: 2, skillSlug: "manim", lesson: "Theirs" }, db);
  recordSkillLesson({ userId: 1, skillSlug: "watch", lesson: "Other skill" }, db);

  assert.deepEqual(
    listSkillLessons(1, "manim", db).map((entry) => entry.lesson),
    ["Mine"],
  );
  assert.deepEqual(
    listSkillLessons(2, "manim", db).map((entry) => entry.lesson),
    ["Theirs"],
  );
  assert.equal(listAllSkillLessons(1, db).length, 2);
});

test("forgetting is scoped to the owner", () => {
  const db = createDatabase();
  const mine = recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Mine" }, db);

  assert.equal(forgetSkillLesson(2, mine.id, db), false, "another user cannot delete it");
  assert.equal(forgetSkillLesson(1, mine.id, db), true);
  assert.equal(listSkillLessons(1, "manim", db).length, 0);
});

test("use is counted, so a lesson nobody needs is visible as such", () => {
  const db = createDatabase();
  recordSkillLesson({ userId: 1, skillSlug: "manim", lesson: "Used" }, db);
  markSkillLessonsUsed(1, "manim", db);
  markSkillLessonsUsed(1, "manim", db);

  const [lesson] = listSkillLessons(1, "manim", db);
  assert.equal(lesson.useCount, 2);
  assert.ok(lesson.lastUsedAt);
});

// ------------------------------------------------------------------ rendering

test("guidance is unchanged when a skill has learned nothing", () => {
  assert.equal(renderSkillLessons([]), "");
  assert.equal(skillGuidanceWithLessons("Do the thing.", []), "Do the thing.");
});

test("lessons are rendered as later and local, so they win the disagreement", () => {
  const rendered = skillGuidanceWithLessons("Use `foo --bar`.", [
    { id: 1, skillSlug: "x", lesson: "--bar was removed; use --baz", createdAt: "", lastUsedAt: null, useCount: 0 },
  ]);
  assert.match(rendered, /Use `foo --bar`\./);
  assert.match(rendered, /override the guidance above/);
  assert.match(rendered, /- --bar was removed; use --baz/);
  assert.ok(
    rendered.indexOf("Use `foo --bar`.") < rendered.indexOf("--bar was removed"),
    "the correction comes after the thing it corrects",
  );
});
