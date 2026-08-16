// Spaced repetition: the promises the feature makes, and the ones it must not break.
//
// The scheduling maths belongs to ts-fsrs and is tested upstream; what is tested
// here is everything Breadboard put around it. The load-bearing claims are:
// scheduling state survives a garden rebuild (the reason it is not in
// frontmatter), a chat can only ever hold one open question (the reason a reply
// can be attributed at all), the daily budget actually caps, and a reply that
// arrives while a question is open is graded rather than routed to the assistant.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-review-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_MEM0 = "off";

const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-review-content-"));
process.env.QUARTZ_CONTENT_PATH = contentRoot;

const { default: db } = await import("../src/lib/db.ts");
const { ReviewStore } = await import("../src/lib/review/store.ts");
const { REVIEW_GRADES } = await import("../src/lib/review/types.ts");
const scheduling = await import("../src/lib/review/scheduling.ts");
const cards = await import("../src/lib/review/cards.ts");
const delivery = await import("../src/lib/review/delivery.ts");

after(() => {
  // Windows will not unlink the SQLite file while the handle is open.
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(contentRoot, { recursive: true, force: true });
});

let nextUser = 0;
function makeUser() {
  nextUser += 1;
  const username = `review-user-${nextUser}`;
  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash) VALUES (?, ?, 'x')`,
    )
    .run(username, `${username}@example.com`);
  return Number(info.lastInsertRowid);
}

function makeStore() {
  return new ReviewStore(db);
}

function seedCard(store, userId, overrides = {}) {
  const result = store.upsertCard({
    userId,
    gardenSlug: overrides.gardenSlug ?? "physics",
    pageSlug: overrides.pageSlug ?? "gauss-law",
    pageTitle: overrides.pageTitle ?? "1.2 Gauss's Law",
    question: overrides.question ?? "Why does Gauss's law hold for any closed surface?",
    answer: overrides.answer ?? "Because flux depends only on enclosed charge.",
    sourceHash: overrides.sourceHash ?? "hash-1",
  });
  return result;
}

// --------------------------------------------------------------- scheduling

test("a graded card moves into the future and records a log", () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);

  const before = store.card(id);
  assert.equal(before.reps, 0);
  assert.equal(before.state, 0, "a fresh card starts in the New state");

  const now = new Date("2026-01-01T09:00:00.000Z");
  const result = store.grade(id, REVIEW_GRADES.good, { desiredRetention: 0.9, now });
  assert.ok(result, "grading a real card returns a result");

  const after_ = store.card(id);
  assert.equal(after_.reps, 1);
  assert.ok(
    new Date(after_.due).getTime() > now.getTime(),
    "a graded card is scheduled into the future",
  );

  const logs = db.prepare(`SELECT COUNT(*) AS n FROM review_logs WHERE card_id = ?`).get(id);
  assert.equal(logs.n, 1, "the review is logged for the optimizer to train on later");
});

test("a harder grade schedules sooner than an easier one", () => {
  const store = makeStore();
  const userId = makeUser();
  const now = new Date("2026-01-01T09:00:00.000Z");

  const hardId = seedCard(store, userId, { pageSlug: "a" }).id;
  const easyId = seedCard(store, userId, { pageSlug: "b" }).id;

  store.grade(hardId, REVIEW_GRADES.hard, { desiredRetention: 0.9, now });
  store.grade(easyId, REVIEW_GRADES.easy, { desiredRetention: 0.9, now });

  const hard = new Date(store.card(hardId).due).getTime();
  const easy = new Date(store.card(easyId).due).getTime();
  assert.ok(hard < easy, "hard comes back before easy");
});

test("the mirrored grade constants match the vendored FSRS enum", async () => {
  const { Rating } = await import("../src/lib/review/fsrs/models.ts");
  assert.equal(REVIEW_GRADES.again, Rating.Again);
  assert.equal(REVIEW_GRADES.hard, Rating.Hard);
  assert.equal(REVIEW_GRADES.good, Rating.Good);
  assert.equal(REVIEW_GRADES.easy, Rating.Easy);
});

// ------------------------------------------------------- rebuild durability

test("rewriting a note refreshes its question but keeps its schedule", () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);

  const now = new Date("2026-01-01T09:00:00.000Z");
  store.grade(id, REVIEW_GRADES.good, { desiredRetention: 0.9, now });
  const scheduled = store.card(id);

  // What a Learn rebuild does: same page, new prose, therefore a new hash.
  const again = store.upsertCard({
    userId,
    gardenSlug: "physics",
    pageSlug: "gauss-law",
    pageTitle: "1.2 Gauss's Law",
    question: "A rewritten question",
    answer: "Rewritten prose after a rebuild.",
    sourceHash: "hash-2",
  });

  assert.equal(again.id, id, "the same page keeps the same card");
  assert.equal(again.refreshed, true);

  const after_ = store.card(id);
  assert.equal(after_.question, "A rewritten question");
  assert.equal(after_.reps, scheduled.reps, "review count survives the rebuild");
  assert.equal(after_.due, scheduled.due, "the schedule survives the rebuild");
  assert.equal(after_.stability, scheduled.stability);
});

test("an unchanged note is left completely alone", () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);
  const second = seedCard(store, userId);
  assert.equal(second.id, id);
  assert.equal(second.created, false);
  assert.equal(second.refreshed, false);
});

// ------------------------------------------------------------- due selection

test("only enabled gardens produce due cards", () => {
  const store = makeStore();
  const userId = makeUser();
  seedCard(store, userId, { gardenSlug: "physics", pageSlug: "p1" });
  seedCard(store, userId, { gardenSlug: "chemistry", pageSlug: "c1" });

  assert.equal(store.due(userId, { limit: 10 }).length, 0, "nothing is due before opting in");

  store.setGardenSettings(userId, "physics", { enabled: true });
  const due = store.due(userId, { limit: 10 });
  assert.equal(due.length, 1);
  assert.equal(due[0].garden_slug, "physics");
});

test("a suspended card is never due", () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);
  store.setGardenSettings(userId, "physics", { enabled: true });
  assert.equal(store.due(userId, { limit: 10 }).length, 1);

  store.setSuspended(userId, id, true);
  assert.equal(store.due(userId, { limit: 10 }).length, 0);
});

// -------------------------------------------------------------- daily budget

test("the daily budget caps sends and resets the next day", () => {
  const store = makeStore();
  const userId = makeUser();
  store.setUserSettings(userId, { channel: "telegram", dailyLimit: 2 });

  assert.equal(store.claimDailyBudget(userId, "2026-01-01", 1), 1);
  assert.equal(store.claimDailyBudget(userId, "2026-01-01", 1), 1);
  assert.equal(store.claimDailyBudget(userId, "2026-01-01", 1), 0, "the third is refused");
  assert.equal(store.sentToday(userId, "2026-01-01"), 2);

  assert.equal(store.claimDailyBudget(userId, "2026-01-02", 1), 1, "a new day starts over");
  assert.equal(store.sentToday(userId, "2026-01-02"), 1);
});

// ---------------------------------------------------------------- deliveries

test("a chat holds only one open question at a time", () => {
  const store = makeStore();
  const userId = makeUser();
  const first = seedCard(store, userId, { pageSlug: "p1" }).id;
  const second = seedCard(store, userId, { pageSlug: "p2" }).id;

  store.openDelivery({
    cardId: first,
    userId,
    channel: "telegram",
    chatId: "chat-1",
    question: "first?",
  });
  store.openDelivery({
    cardId: second,
    userId,
    channel: "telegram",
    chatId: "chat-1",
    question: "second?",
  });

  const open = store.openDeliveryForChat("chat-1");
  assert.equal(open.card_id, second, "the newest question is the open one");

  const openCount = db
    .prepare(`SELECT COUNT(*) AS n FROM review_deliveries WHERE chat_id = ? AND status = 'open'`)
    .get("chat-1");
  assert.equal(openCount.n, 1, "the previous question was expired, not left open");
});

test("deliveries in other chats are untouched", () => {
  const store = makeStore();
  const userId = makeUser();
  const a = seedCard(store, userId, { pageSlug: "p1" }).id;
  const b = seedCard(store, userId, { pageSlug: "p2" }).id;

  store.openDelivery({ cardId: a, userId, channel: "telegram", chatId: "chat-a", question: "a?" });
  store.openDelivery({ cardId: b, userId, channel: "whatsapp", chatId: "chat-b", question: "b?" });

  assert.equal(store.openDeliveryForChat("chat-a").card_id, a);
  assert.equal(store.openDeliveryForChat("chat-b").card_id, b);
});

// ------------------------------------------------------------------ grading

test("a bare 1-4 reply grades without calling a model", async () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);
  store.setUserSettings(userId, { channel: "telegram" });
  store.openDelivery({
    cardId: id,
    userId,
    channel: "telegram",
    chatId: "chat-grade",
    question: "why?",
  });

  const outcome = await delivery.handleInboundReview({
    store,
    chatId: "chat-grade",
    text: "4",
  });

  assert.ok(outcome, "the reply was recognised as a review answer");
  assert.match(outcome.reply, /Easy/);
  assert.equal(store.card(id).reps, 1);
  assert.equal(store.openDeliveryForChat("chat-grade"), null, "the question is closed");
});

test("an admission of not knowing grades as again", async () => {
  const store = makeStore();
  const userId = makeUser();
  const { id } = seedCard(store, userId);
  store.openDelivery({
    cardId: id,
    userId,
    channel: "telegram",
    chatId: "chat-idk",
    question: "why?",
  });

  const outcome = await delivery.handleInboundReview({
    store,
    chatId: "chat-idk",
    text: "no idea",
  });
  assert.ok(outcome);
  assert.match(outcome.reply, /Again/);
});

test("a message with no open question is not a review reply", async () => {
  const store = makeStore();
  const outcome = await delivery.handleInboundReview({
    store,
    chatId: "chat-with-nothing-open",
    text: "what is the weather",
  });
  assert.equal(outcome, null, "the router must fall through to a normal conversation");
});

test("explicitGrade only accepts real grades", () => {
  assert.equal(delivery.explicitGrade("3"), REVIEW_GRADES.good);
  assert.equal(delivery.explicitGrade("  Easy "), REVIEW_GRADES.easy);
  assert.equal(delivery.explicitGrade("5"), null);
  assert.equal(delivery.explicitGrade("because the flux is constant"), null);
});

// ------------------------------------------------------------------ seeding

test("only learning pages with enough prose become cards", () => {
  const gardenDir = path.join(contentRoot, "seed-garden");
  fs.mkdirSync(gardenDir, { recursive: true });

  const longProse =
    "Gauss's law states that the total electric flux through any closed surface " +
    "equals the enclosed charge divided by the permittivity of free space. It " +
    "holds for any surface whatsoever because the inverse-square falloff of the " +
    "field is exactly compensated by the growth in area, so only enclosed charge " +
    "survives the integral and the surface's shape drops out entirely.";

  fs.writeFileSync(
    path.join(gardenDir, "gauss.md"),
    `---\ntitle: "1.2 Gauss's Law"\nknowledge_type: "learning-page"\n---\n\n` +
      `# 1.2 Gauss's Law\n\nSource: [[book|Book]]\n\nLocations: Page 1\n\n${longProse}\n\n` +
      `## Page-Grounded Details\n\nSome excerpt that must not become the answer.\n`,
    "utf8",
  );

  // Too short to ask about fairly.
  fs.writeFileSync(
    path.join(gardenDir, "stub.md"),
    `---\ntitle: "Stub"\nknowledge_type: "learning-page"\n---\n\n# Stub\n\nToo short.\n`,
    "utf8",
  );

  // Not generated learning material at all.
  fs.writeFileSync(
    path.join(gardenDir, "note.md"),
    `---\ntitle: "A hand-written note"\n---\n\n# Note\n\n${longProse}\n`,
    "utf8",
  );

  // Breadboard's own build scratch must be ignored.
  const hidden = path.join(gardenDir, ".breadboard");
  fs.mkdirSync(hidden, { recursive: true });
  fs.writeFileSync(
    path.join(hidden, "hidden.md"),
    `---\ntitle: "Hidden"\nknowledge_type: "learning-page"\n---\n\n${longProse}\n`,
    "utf8",
  );

  const candidates = cards.collectCandidates("seed-garden");
  assert.equal(candidates.length, 1, "one page qualifies");
  assert.equal(candidates[0].pageSlug, "gauss");
  assert.match(candidates[0].answer, /inverse-square/);
  assert.doesNotMatch(
    candidates[0].answer,
    /must not become the answer/,
    "the answer stops at Page-Grounded Details",
  );
});

test("the offline seed produces usable cards without a model", async () => {
  const store = makeStore();
  const userId = makeUser();
  const result = await cards.seedGarden({
    store,
    userId,
    gardenSlug: "seed-garden",
    offline: true,
  });

  assert.equal(result.created, 1);
  assert.equal(result.modelQuestions, 0);

  const list = store.listCards(userId, "seed-garden");
  assert.equal(list.length, 1);
  assert.match(list[0].question, /Gauss's Law/, "the template question names the topic");
  assert.doesNotMatch(list[0].question, /^\d/, "the build's numeric prefix is stripped");
});

test("re-seeding an unchanged garden creates nothing new", async () => {
  const store = makeStore();
  const userId = makeUser();
  await cards.seedGarden({ store, userId, gardenSlug: "seed-garden", offline: true });
  const second = await cards.seedGarden({
    store,
    userId,
    gardenSlug: "seed-garden",
    offline: true,
  });
  assert.equal(second.created, 0);
  assert.equal(second.unchanged, 1);
});

// -------------------------------------------------------------------- misc

test("settings are clamped rather than trusted", () => {
  const store = makeStore();
  const userId = makeUser();
  const settings = store.setUserSettings(userId, {
    dailyLimit: 9999,
    sendHour: 99,
    desiredRetention: 5,
  });
  assert.equal(settings.dailyLimit, 50);
  assert.equal(settings.sendHour, 23);
  assert.equal(settings.desiredRetention, 0.97);
});

test("usersWithDelivery needs both a channel and an enabled garden", () => {
  const store = makeStore();
  const userId = makeUser();
  seedCard(store, userId);

  assert.equal(
    store.usersWithDelivery().some((row) => row.userId === userId),
    false,
    "no channel yet",
  );

  store.setUserSettings(userId, { channel: "telegram" });
  assert.equal(
    store.usersWithDelivery().some((row) => row.userId === userId),
    false,
    "channel but no enabled garden",
  );

  store.setGardenSettings(userId, "physics", { enabled: true });
  assert.equal(
    store.usersWithDelivery().some((row) => row.userId === userId),
    true,
  );
});

test("interval wording stays readable across scales", () => {
  assert.equal(scheduling.humanizeInterval(0), "now");
  assert.equal(scheduling.humanizeInterval(10 * 60_000), "10m");
  assert.equal(scheduling.humanizeInterval(5 * 3_600_000), "5h");
  assert.equal(scheduling.humanizeInterval(4 * 86_400_000), "4d");
  assert.equal(scheduling.humanizeInterval(90 * 86_400_000), "3mo");
});
