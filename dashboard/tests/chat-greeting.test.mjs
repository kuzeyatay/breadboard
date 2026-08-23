import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHAT_GREETING_ROTATION_MS,
  CHAT_SUGGESTION_COUNT,
  EMPTY_CHAT_GREETING_SIGNALS,
  chatGreetingBucket,
  msUntilNextChatGreeting,
  resolveChatGreeting,
  resolveChatSuggestions,
} from "../src/lib/hermes/chat-greeting.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");

const runtimeTerminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
const runtimePanel = source("src/app/components/hermes/agent-runtime-panel.tsx");
const legacyTerminal = source("src/app/components/knowledge-terminal.tsx");
const emptyState = source("src/app/components/hermes/chat-greeting-empty-state.tsx");

const SIGNALS = {
  ...EMPTY_CHAT_GREETING_SIGNALS,
  name: "Grey",
  gardenCount: 4,
  recentGardens: [
    { name: "Thermodynamics", slug: "thermodynamics" },
    { name: "Control Theory", slug: "control-theory" },
  ],
  recentChats: ["Entropy and the second law"],
  promptsToday: 3,
  minutesSinceLastPrompt: 600,
  daysSinceJoined: 120,
};

/** A Wednesday, so no weekday-specific line is in play unless a test asks for one. */
function at(hour, { day = 19, month = 7, year = 2026, minute = 0 } = {}) {
  return new Date(year, month, day, hour, minute, 0, 0);
}

function greeting(now, overrides = {}) {
  return resolveChatGreeting({
    signals: { ...SIGNALS, ...overrides.signals },
    scope: overrides.scope ?? "mine",
    temporary: overrides.temporary ?? false,
    now,
  });
}

function suggestions(now, overrides = {}) {
  return resolveChatSuggestions({
    signals: { ...SIGNALS, ...overrides.signals },
    scope: overrides.scope ?? "mine",
    temporary: overrides.temporary ?? false,
    now,
  });
}

/** Every greeting across `hours` consecutive hours from a fixed starting point. */
function sweep(hours, overrides = {}, startHour = 0) {
  const results = [];
  for (let index = 0; index < hours; index += 1) {
    const now = new Date(2026, 7, 19, startHour, 0, 0, 0);
    now.setHours(now.getHours() + index);
    results.push({ now, greeting: greeting(now, overrides), suggestions: suggestions(now, overrides) });
  }
  return results;
}

test("the greeting holds for an hour and then steps on", () => {
  assert.equal(CHAT_GREETING_ROTATION_MS, 60 * 60 * 1000);

  const early = greeting(at(13, { minute: 1 }));
  const late = greeting(at(13, { minute: 59 }));
  assert.deepEqual(early, late);

  // 13:00 and 14:00 are both afternoon, so the pools are the same and any
  // difference is the rotation itself rather than the window changing.
  const nextHour = greeting(at(14));
  assert.notEqual(early.leadId, nextHour.leadId);
  assert.notEqual(early.questionId, nextHour.questionId);
});

test("the bucket and the countdown agree about where the hour ends", () => {
  const now = at(13, { minute: 20 });
  assert.equal(chatGreetingBucket(now), chatGreetingBucket(at(13, { minute: 59 })));
  assert.equal(chatGreetingBucket(now) + 1, chatGreetingBucket(at(14)));

  const remaining = msUntilNextChatGreeting(now);
  assert.ok(remaining > 0 && remaining <= CHAT_GREETING_ROTATION_MS);
  assert.equal(
    chatGreetingBucket(new Date(now.getTime() + remaining)),
    chatGreetingBucket(now) + 1,
  );
});

test("a greeting never claims the wrong time of day", () => {
  // A fortnight of hours, so the rotation has had every chance to reach for a
  // line it should not have.
  for (const entry of sweep(24 * 14)) {
    const hour = entry.now.getHours();
    if (entry.greeting.leadId === "good-morning") assert.ok(hour >= 8 && hour < 12);
    if (entry.greeting.leadId === "good-afternoon") assert.ok(hour >= 12 && hour < 17);
    if (entry.greeting.leadId === "good-evening") assert.ok(hour >= 17 && hour < 21);
    if (entry.greeting.leadId === "still-up" || entry.greeting.leadId === "working-late") {
      assert.ok(hour < 5);
    }
    if (entry.greeting.leadId === "up-early") assert.ok(hour >= 5 && hour < 8);
    if (entry.greeting.questionId === "plan-today") assert.ok(hour < 12);
  }
});

test("over a day it uses the clock, the calendar and the name", () => {
  const day = sweep(24 * 7);
  const leads = new Set(day.map((entry) => entry.greeting.leadId));

  // The plain time-of-day greetings are the backbone, and all of them get used.
  for (const id of ["good-morning", "good-afternoon", "good-evening", "still-up"]) {
    assert.ok(leads.has(id), `expected the rotation to reach ${id}`);
  }
  // A weekend line only ever appears on a weekend, and does appear.
  const weekendLeads = day.filter((entry) => entry.greeting.leadId === "happy-weekend");
  assert.ok(weekendLeads.length > 0);
  for (const entry of weekendLeads) {
    assert.ok(entry.now.getDay() === 0 || entry.now.getDay() === 6);
    assert.match(entry.greeting.lead, /^Happy (Saturday|Sunday)$/);
  }

});

test("the name is an occasional touch, not a rule every line has to obey", () => {
  // A name comes up sometimes, while most visits leave enough room for the
  // greeting itself. Splash lines always skip it, and an account with nothing
  // to call them never gets a dangling comma.
  const week = sweep(24 * 7);
  const named = week.filter((entry) => entry.greeting.name === "Grey");
  const nameless = week.filter((entry) => entry.greeting.name === null);
  assert.ok(named.length > 0, "the rotation never used the name");
  assert.ok(
    named.length / week.length < 0.3,
    `${named.length} of ${week.length} greetings still used the name`,
  );
  assert.ok(nameless.length > named.length, "the name was still the default");

  for (const entry of named) {
    // A vocative lead has to read as a sentence once the name is appended.
    assert.doesNotMatch(entry.greeting.lead, /[.,!?]$/, entry.greeting.leadId);
  }
  for (const entry of nameless) {
    assert.doesNotMatch(entry.greeting.lead, /Grey/);
  }

  const everyMood = [
    {},
    { signals: { minutesSinceLastPrompt: null, promptsToday: 0, daysSinceJoined: 0 } },
    { signals: { minutesSinceLastPrompt: 5 } },
    { signals: { minutesSinceLastPrompt: 60 * 24 * 30 } },
    { signals: { promptsToday: 40 } },
    { scope: "public" },
    { temporary: true },
  ];
  for (const mood of everyMood) {
    for (const entry of sweep(24 * 7, mood)) {
      if (entry.greeting.name) {
        assert.equal(entry.greeting.name, "Grey", `${entry.greeting.leadId} used the wrong name`);
        assert.doesNotMatch(entry.greeting.lead, /[.,!?]$/, entry.greeting.leadId);
      }
    }
  }

  for (const entry of sweep(48, { signals: { name: null } })) {
    assert.equal(entry.greeting.name, null);
  }
});

test("the name is drawn apart from the greeting it follows", () => {
  assert.match(emptyState, /\{greeting\?\.name \? <span className="text-gray-500">, \{greeting\.name\}<\/span> : null\}/);
});

test("the greeting reads the activity, not just the clock", () => {
  const brandNew = sweep(24 * 7, {
    signals: { minutesSinceLastPrompt: null, promptsToday: 0, daysSinceJoined: 0, gardenCount: 0, recentGardens: [], recentChats: [] },
  });
  const brandNewLeads = new Set(brandNew.map((entry) => entry.greeting.leadId));
  assert.ok(brandNewLeads.has("welcome-in"));
  assert.ok(!brandNewLeads.has("hello-again"), "someone who has never written cannot be greeted again");
  assert.ok(!brandNewLeads.has("back-again"));
  assert.ok(!brandNewLeads.has("been-a-while"));

  const resuming = sweep(24 * 7, { signals: { minutesSinceLastPrompt: 5 } });
  const resumingLeads = new Set(resuming.map((entry) => entry.greeting.leadId));
  assert.ok(resumingLeads.has("back-again"));
  assert.ok(!resumingLeads.has("been-a-while"));
  assert.ok(
    new Set(resuming.map((entry) => entry.greeting.questionId)).has("pick-up"),
  );

  const returning = sweep(24 * 7, { signals: { minutesSinceLastPrompt: 60 * 24 * 30, promptsToday: 0 } });
  const returningLeads = new Set(returning.map((entry) => entry.greeting.leadId));
  assert.ok(returningLeads.has("been-a-while"));
  assert.ok(!returningLeads.has("back-again"));

  const busy = sweep(24 * 7, { signals: { promptsToday: 40, minutesSinceLastPrompt: 90 } });
  assert.ok(new Set(busy.map((entry) => entry.greeting.leadId)).has("still-going"));
});

test("four openers, all different, and all four move with the hour", () => {
  const first = suggestions(at(13));
  assert.equal(first.length, CHAT_SUGGESTION_COUNT);
  assert.equal(new Set(first).size, CHAT_SUGGESTION_COUNT);
  assert.deepEqual(suggestions(at(13, { minute: 59 })), first);

  const next = suggestions(at(14));
  assert.notDeepEqual(next, first);
  assert.equal(new Set(next).size, CHAT_SUGGESTION_COUNT);
});

test("the openers do not fall into a short repeating cycle", () => {
  // Sliding the window by its own width looks fine and is not: a pool that
  // happens to be a multiple of four long comes back around every four hours.
  const week = sweep(24 * 7).map((entry) => entry.suggestions.join(" | "));
  for (let index = 1; index < week.length; index += 1) {
    assert.notEqual(week[index], week[index - 1], `hour ${index} repeated the hour before it`);
  }
  // Family diversity deliberately collapses some windows onto the same four
  // cards — that is the point of it — so a day is not 24 distinct sets. It
  // should still be most of a day rather than a handful on repeat.
  const day = week.slice(0, 24);
  assert.ok(
    new Set(day).size >= 12,
    `only ${new Set(day).size} distinct sets of openers across a day`,
  );
});

test("the openers name the gardens and chats they are about", () => {
  const day = sweep(24 * 7).flatMap((entry) => entry.suggestions);
  assert.ok(day.some((prompt) => prompt.includes("Thermodynamics")));
  assert.ok(day.some((prompt) => prompt.includes("Control Theory")));
  assert.ok(day.some((prompt) => prompt.includes("Entropy and the second law")));

  // Nothing is templated with a garden that is not there.
  for (const prompt of sweep(24 * 7, {
    signals: { gardenCount: 0, recentGardens: [], recentChats: [] },
  }).flatMap((entry) => entry.suggestions)) {
    assert.doesNotMatch(prompt, /\{|\}|undefined|NaN/);
  }
});

test("an empty account is offered somewhere to start", () => {
  const openers = new Set(
    sweep(24 * 3, { signals: { ...EMPTY_CHAT_GREETING_SIGNALS } }).flatMap((entry) => entry.suggestions),
  );
  assert.ok(openers.has("How do I start my first garden?"));
  // Nothing offers to review or connect gardens that do not exist yet.
  for (const prompt of openers) {
    assert.doesNotMatch(prompt, /across all gardens|different gardens|before an exam/);
  }
  for (const entry of sweep(24 * 3, { signals: { ...EMPTY_CHAT_GREETING_SIGNALS } })) {
    assert.equal(entry.suggestions.length, CHAT_SUGGESTION_COUNT);
  }
});

test("the public hub never offers to read a private garden", () => {
  for (const entry of sweep(24 * 7, { scope: "public" })) {
    assert.equal(entry.suggestions.length, CHAT_SUGGESTION_COUNT);
    for (const prompt of entry.suggestions) {
      assert.doesNotMatch(prompt, /\bmy \b|\bmy gardens\b|Thermodynamics|Control Theory|Entropy/);
      assert.match(prompt, /public/);
    }
  }
  const questions = new Set(sweep(24 * 7, { scope: "public" }).map((entry) => entry.greeting.questionId));
  assert.ok(questions.has("public-find"));
});

test("off the record asks the questions worth asking when nothing is kept", () => {
  const offRecord = new Set(
    sweep(24 * 3, { temporary: true, signals: { recentGardens: [], recentChats: [] } }).flatMap(
      (entry) => entry.suggestions,
    ),
  );
  // Accumulation is the wrong invitation in a chat that keeps nothing, so none
  // of the openers about spanning, connecting or revising gardens survive here.
  for (const prompt of offRecord) {
    assert.doesNotMatch(prompt, /span|overlap|connections between|review before an exam/i);
  }
  assert.ok(offRecord.has("Quiz me on a topic in my notes, without keeping the score."));
  assert.ok(
    offRecord.has("Explain a concept from my gardens as if I had never seen it."),
  );
  // A chat that keeps nothing never offers to resume a chat that was kept.
  for (const prompt of offRecord) assert.doesNotMatch(prompt, /Pick up where I left off/);

  const publicOffRecord = new Set(
    sweep(24 * 3, { temporary: true, scope: "public" }).flatMap((entry) => entry.suggestions),
  );
  assert.ok(
    publicOffRecord.has("Quiz me on a public-garden topic, without keeping the score."),
  );

  const leads = new Set(sweep(24 * 3, { temporary: true }).map((entry) => entry.greeting.questionId));
  assert.ok(leads.has("off-the-record") || leads.has("quietly"));
});

test("the title-screen easter eggs are frequent without becoming constant", () => {
  // The lighter lines should feel like a real part of the screen now, while a
  // plain greeting still gets room to breathe between them.
  const week = sweep(24 * 7);
  const light = new Set([
    "nocturnal", "sleep-rumour", "midnight-oil", "living-dangerously", "better-judgement",
    "birds-impressed", "beat-the-sunrise", "before-the-world", "while-quiet",
    "coffee-first", "day-unspoiled", "fresh-eyes", "right-on-time",
    "post-lunch", "afternoon-slump", "shall-we", "halfway-there",
    "golden-hour", "evening-shift", "prime-time", "second-wind",
    "one-more-thing", "screen-glow", "home-stretch", "making-it-count",
    "nobody-works-weekends", "no-alarm",
    "brace-yourself", "here-goes", "nearly-free", "friday-feeling",
    "keyboard-lie-down", "save-some", "in-the-thick", "emigrated",
    "gardens-quiet", "missed-you", "that-was-quick", "back-already", "look-who",
    "no-pressure", "clean-slate", "after-you",
    "quite-the-collection", "at-your-service", "here-we-go", "cause-trouble",
    "the-usual", "fancy-seeing-you",
    "hardcore-mode", "does-not-replace-sleep", "out-of-office-hours", "moon-joined",
    "generating-terrain", "limited-edition-hour", "first-spawn",
    "hello-world", "also-try-outside", "not-on-the-exam", "coffee-not-included",
    "always-dns", "works-on-my-machine", "could-have-been-a-note", "side-quest-accepted",
    "low-battery", "rubber-duck", "you-are-here", "plot-thickens",
    "currently-buffering", "one-more-compile", "watched-compile", "night-shift-enabled",
    "peaceful-difficulty", "also-try-writing", "weekend-mode",
    "inventory-full", "please-hold", "notes-miss-you", "chunk-loaded",
    "spawn-point-set", "insert-greeting", "advancement-made", "now-with-extra-gardens",
    "now-entering-garden", "have-you-watered", "this-never-happened", "nobody-saw-you",
    "may-contain-insight", "as-seen-on-localhost", "certified-present",
    "mildly-unsupervised", "feature-complete-ish", "questions-more", "context-window",
    "autosave-love", "assembly-required", "patch-notes", "probably-not-sentient",
    "tiny-invisible-math", "tangent-summoning",
  ]);
  const share = week.filter((entry) => light.has(entry.greeting.leadId)).length / week.length;
  assert.ok(share > 0.35, `the lighter lines only came up ${Math.round(share * 100)}% of the time`);
  assert.ok(share < 0.8, `the lighter lines came up ${Math.round(share * 100)}% of the time`);

  // And the plain time-of-day greetings are still the backbone underneath.
  const plain = week.filter((entry) =>
    ["good-morning", "morning", "weekday-morning", "good-afternoon", "afternoon",
     "weekday-afternoon", "good-evening", "evening", "weekday-evening", "still-up",
     "still-at-it", "working-late", "up-early", "early-start", "winding-down",
     "late-one", "almost-tomorrow", "weekday-night", "quiet-hours", "slow-morning"].includes(entry.greeting.leadId),
  ).length;
  assert.ok(plain > week.length * 0.25, `only ${plain} of ${week.length} were plain time-of-day lines`);
});

test("the catch-all lines are a safety net rather than the usual answer", () => {
  // The rotation walks whatever is eligible, so a line eligible around the
  // clock used to be picked far more often than one that only fits four hours
  // a day: three catch-alls were taking nearly half of every greeting between
  // them, and "Ready when you are" alone was the most common thing the blank
  // chat ever said. That is what "too generic" actually was.
  const week = sweep(24 * 7);
  const generic = ["good-to-see-you", "hello-again", "ready-when-you-are"];
  const share = week.filter((entry) => generic.includes(entry.greeting.leadId)).length / week.length;
  assert.ok(share < 0.06, `the catch-alls still took ${Math.round(share * 100)}% of the greetings`);

  // No single line dominates any more, whichever one it is.
  const counts = new Map();
  for (const entry of week) {
    counts.set(entry.greeting.leadId, (counts.get(entry.greeting.leadId) ?? 0) + 1);
  }
  const [top, times] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  assert.ok(times / week.length < 0.12, `${top} was ${Math.round((times / week.length) * 100)}% of the week`);

  // They are still reachable, which is the whole reason to keep them: a window
  // thinned right down to nothing would otherwise render an empty line.
  const thin = sweep(24 * 7, {
    signals: {
      ...EMPTY_CHAT_GREETING_SIGNALS,
      name: "Grey",
      minutesSinceLastPrompt: 60 * 30,
    },
    temporary: true,
  });
  assert.ok(thin.every((entry) => entry.greeting.lead.length > 0));
});

test("a joke about the small hours is not told at nine in the morning", () => {
  // The lighter lines are only lighter, not looser: each still has to be true
  // of the hour, the week and the account it appears in.
  const windows = {
    nocturnal: (h) => h < 5,
    "sleep-rumour": (h) => h < 5,
    "midnight-oil": (h) => h < 5,
    "living-dangerously": (h) => h < 5,
    "better-judgement": (h) => h < 5,
    "hardcore-mode": (h) => h < 5,
    "does-not-replace-sleep": (h) => h < 5,
    "out-of-office-hours": (h) => h < 5,
    "birds-impressed": (h) => h >= 5 && h < 8,
    "beat-the-sunrise": (h) => h >= 5 && h < 8,
    "before-the-world": (h) => h >= 5 && h < 8,
    "while-quiet": (h) => h >= 5 && h < 8,
    "generating-terrain": (h) => h >= 5 && h < 8,
    "limited-edition-hour": (h) => h >= 5 && h < 8,
    "coffee-first": (h) => h >= 8 && h < 12,
    "day-unspoiled": (h) => h >= 8 && h < 12,
    "fresh-eyes": (h) => h >= 8 && h < 12,
    "right-on-time": (h) => h >= 8 && h < 12,
    "hello-world": (h) => h >= 8 && h < 12,
    "also-try-outside": (h) => h >= 8 && h < 12,
    "not-on-the-exam": (h) => h >= 8 && h < 12,
    "post-lunch": (h) => h >= 12 && h < 17,
    "afternoon-slump": (h) => h >= 12 && h < 17,
    "shall-we": (h) => h >= 12 && h < 17,
    "halfway-there": (h) => h >= 12 && h < 17,
    "always-dns": (h) => h >= 12 && h < 17,
    "works-on-my-machine": (h) => h >= 12 && h < 17,
    "could-have-been-a-note": (h) => h >= 12 && h < 17,
    "golden-hour": (h) => h >= 17 && h < 21,
    "evening-shift": (h) => h >= 17 && h < 21,
    "prime-time": (h) => h >= 17 && h < 21,
    "second-wind": (h) => h >= 17 && h < 21,
    "low-battery": (h) => h >= 17 && h < 21,
    "rubber-duck": (h) => h >= 17 && h < 21,
    "you-are-here": (h) => h >= 17 && h < 21,
    "one-more-thing": (h) => h >= 21,
    "screen-glow": (h) => h >= 21,
    "home-stretch": (h) => h >= 21,
    "making-it-count": (h) => h >= 21,
    "currently-buffering": (h) => h >= 21,
    "one-more-compile": (h) => h >= 21,
    "watched-compile": (h) => h >= 21,
  };
  for (const entry of sweep(24 * 14)) {
    const window = windows[entry.greeting.leadId];
    if (window) assert.ok(window(entry.now.getHours()), `${entry.greeting.leadId} at ${entry.now.getHours()}:00`);
    if (entry.greeting.leadId === "nobody-works-weekends" || entry.greeting.leadId === "no-alarm" || entry.greeting.leadId === "peaceful-difficulty" || entry.greeting.leadId === "also-try-writing") {
      assert.ok(entry.now.getDay() === 0 || entry.now.getDay() === 6);
    }
    if (entry.greeting.leadId === "brace-yourself" || entry.greeting.leadId === "here-goes") assert.equal(entry.now.getDay(), 1);
    if (entry.greeting.leadId === "nearly-free") assert.equal(entry.now.getDay(), 5);
    if (entry.greeting.leadId === "friday-feeling") assert.equal(entry.now.getDay(), 5);
    if (entry.greeting.questionId === "keeping-you-up" || entry.greeting.questionId === "worth-the-hour") {
      assert.ok(entry.now.getHours() < 5);
    }
  }

  // Nothing teases someone about coming back after a gap they have not had.
  for (const entry of sweep(24 * 7, { signals: { minutesSinceLastPrompt: 5 } })) {
    assert.notEqual(entry.greeting.leadId, "emigrated");
    assert.notEqual(entry.greeting.leadId, "no-pressure");
    assert.notEqual(entry.greeting.leadId, "missed-you");
    assert.notEqual(entry.greeting.leadId, "notes-miss-you");
    assert.notEqual(entry.greeting.leadId, "spawn-point-set");
  }
  // Someone who has never written a message is not welcomed back.
  for (const entry of sweep(24 * 7, {
    signals: { minutesSinceLastPrompt: null, promptsToday: 0, daysSinceJoined: 0 },
  })) {
    assert.notEqual(entry.greeting.leadId, "here-we-go");
    assert.notEqual(entry.greeting.leadId, "that-was-quick");
    assert.notEqual(entry.greeting.leadId, "look-who");
    assert.notEqual(entry.greeting.leadId, "chunk-loaded");
    assert.notEqual(entry.greeting.leadId, "back-already");
  }
});

test("a calendar easter egg only lands on the day it is about", () => {
  const hoursOn = (year, month, day) => {
    const results = [];
    for (let hour = 0; hour < 24; hour += 1) {
      results.push({
        now: new Date(year, month, day, hour, 0, 0, 0),
        greeting: greeting(new Date(year, month, day, hour, 0, 0, 0)),
      });
    }
    return results;
  };

  const april = hoursOn(2026, 3, 1);
  const aprilIds = new Set(april.map((entry) => entry.greeting.leadId));
  assert.ok(
    aprilIds.has("trust-nothing") || aprilIds.has("everything-is-fine"),
    "April the first never told its own joke",
  );
  for (const entry of [...hoursOn(2026, 2, 31), ...hoursOn(2026, 3, 2)]) {
    assert.notEqual(entry.greeting.leadId, "trust-nothing");
    assert.notEqual(entry.greeting.leadId, "everything-is-fine");
  }

  const friday13 = hoursOn(2026, 1, 13);
  assert.equal(friday13[0].now.getDay(), 5);
  assert.ok(
    friday13.some((entry) => entry.greeting.leadId === "watch-your-step"),
    "Friday the 13th never warned anyone",
  );
  for (const entry of hoursOn(2026, 1, 12)) {
    assert.notEqual(entry.greeting.leadId, "watch-your-step");
  }

  const halloween = hoursOn(2026, 9, 31);
  assert.ok(
    halloween.some((entry) => entry.greeting.leadId === "restless-gardens"),
    "Halloween never mentioned the gardens",
  );
  for (const entry of hoursOn(2026, 9, 30)) {
    assert.notEqual(entry.greeting.leadId, "restless-gardens");
  }
});

test("the lighter openers are prompts, not punchlines", () => {
  // Unlike the greetings these are offered every hour, because each one is
  // worth sending. That also keeps the pool a fixed size hour to hour, which
  // the window's stride depends on.
  const day = new Set(sweep(24 * 7).flatMap((entry) => entry.suggestions));
  assert.ok(day.has("Quiz me on a topic from my notes and do not go easy."));
  assert.ok(day.has("Settle an argument I am having with myself."));
  assert.ok(day.has("Find the weakest thing I have written and tell me why it is weak."));
  assert.ok(day.has("Find a rabbit hole in my gardens worth going down."));
  assert.ok(day.has("Give me a side quest based on what I have been learning."));
  // Every card is still something you could press send on.
  for (const prompt of day) assert.match(prompt, /[.?]$/);
});

test("inside a garden the chat is about that garden", () => {
  const garden = { name: "breadboard-dev", slug: "breadboard-dev" };
  const week = [];
  for (let index = 0; index < 24 * 7; index += 1) {
    const now = new Date(2026, 7, 19, 0, 0, 0, 0);
    now.setHours(now.getHours() + index);
    week.push({
      now,
      greeting: resolveChatGreeting({ signals: SIGNALS, scope: "mine", temporary: false, garden, now }),
      suggestions: resolveChatSuggestions({ signals: SIGNALS, scope: "mine", temporary: false, garden, now }),
    });
  }

  // Standing inside a garden, the chat never asks which garden it is in.
  for (const entry of week) {
    assert.notEqual(entry.greeting.questionId, "which-garden");
  }
  // And its own questions come up, naming the place.
  const questions = new Set(week.map((entry) => entry.greeting.questionId));
  assert.ok(questions.has("garden-look") || questions.has("garden-next"));
  assert.ok(
    week.some((entry) => entry.greeting.question.includes("breadboard-dev")),
    "no question named the open garden all week",
  );

  const openers = new Set(week.flatMap((entry) => entry.suggestions));
  // The openers are about this garden — by name, or as "here"/"this garden".
  assert.ok(openers.has("Summarize what I know in breadboard-dev."));
  assert.ok(openers.has("Quiz me on breadboard-dev and do not go easy."));
  // The one outcome a garden chat has that the hub does not.
  assert.ok(openers.has("Answer something here worth saving as a page."));
  // Nothing offers another garden by name; the hub pools name recent gardens,
  // and none of those belong in a chat that cannot see them.
  for (const prompt of openers) {
    assert.doesNotMatch(prompt, /Thermodynamics|Control Theory|Entropy and the second law/);
  }
  // Reaching outward is allowed only when it says so.
  const outward = [...openers].filter((prompt) => prompt.includes("other gardens"));
  assert.deepEqual(outward, ["How does breadboard-dev relate to my other gardens?"]);

  // Four slots, always filled, even for an account with one garden and no history.
  for (let index = 0; index < 24 * 3; index += 1) {
    const now = new Date(2026, 7, 19, 0, 0, 0, 0);
    now.setHours(now.getHours() + index);
    const thin = resolveChatSuggestions({
      signals: { ...EMPTY_CHAT_GREETING_SIGNALS, name: "Grey", gardenCount: 1 },
      scope: "mine",
      temporary: false,
      garden,
      now,
    });
    assert.equal(thin.length, CHAT_SUGGESTION_COUNT);
    for (const prompt of thin) assert.doesNotMatch(prompt, /other gardens/);
  }

  // Two gardens open in two tabs do not say the same thing at the same hour.
  const now = at(15);
  const here = resolveChatGreeting({ signals: SIGNALS, scope: "mine", temporary: false, garden, now });
  const there = resolveChatGreeting({
    signals: SIGNALS,
    scope: "mine",
    temporary: false,
    garden: { name: "Thermodynamics", slug: "thermodynamics" },
    now,
  });
  assert.notEqual(`${here.leadId}/${here.questionId}`, `${there.leadId}/${there.questionId}`);
});

test("two people do not step through the pools in lockstep", () => {
  const now = at(13);
  const one = resolveChatGreeting({ signals: { ...SIGNALS, name: "Grey" }, scope: "mine", temporary: false, now });
  const two = resolveChatGreeting({ signals: { ...SIGNALS, name: "Robin" }, scope: "mine", temporary: false, now });
  assert.notEqual(`${one.leadId}/${one.questionId}`, `${two.leadId}/${two.questionId}`);
});

test("the card's outline draws, holds and lifts on the voice screen's cycle", () => {
  const css = source("src/app/globals.css");
  const block = css.slice(
    css.indexOf("/* The four openers on a blank chat."),
    css.indexOf("/* The openers of a temporary chat"),
  );
  assert.ok(block.length > 0, "the openers' own block is gone from globals.css");

  // The voice ring's sketch language: the whole outline is one dash unit, and
  // one dashoffset rule draws it in. Not a travelling fragment — an orbiting
  // dash was built first and read as worms crawling around the cards.
  assert.match(block, /stroke-dasharray:\s*1;/);
  assert.match(block, /stroke-dashoffset:\s*1;/);
  // Three of the voice ring's 2820ms — four cards at the ring's own rate read
  // as frantic — and linear, because a hand going over a line moves evenly:
  // easing the draw made the sweep lurch.
  assert.match(block, /animation:\s*bb-suggestion-sketch 8460ms linear/);
  const draw = block.slice(block.indexOf("@keyframes bb-suggestion-sketch"));
  assert.match(draw, /0%\s*\{[^}]*animation-timing-function: linear;/);
  assert.match(draw, /52%\s*\{[^}]*animation-timing-function: ease;/);

  // The settled line under the pass — whole, faint, always there. Without it
  // the pass's half-drawn moments read as a broken border.
  assert.match(block, /path:first-child \{\s*opacity: 0\.16;/);

  // Draw, hold, lift: complete just past halfway, rest whole on the border,
  // fade off it rather than retracting.
  const keyframes = block.slice(block.indexOf("@keyframes bb-suggestion-sketch"));
  assert.match(keyframes, /52%\s*\{\s*stroke-dashoffset:\s*0;/);
  assert.match(keyframes, /100%\s*\{\s*stroke-dashoffset:\s*0;\s*opacity:\s*0;/);

  // The card's radius has one stated source; the component reads it back off
  // the card (getComputedStyle) rather than restating it for the drawing.
  assert.match(block, /--bb-suggestion-radius:\s*0\.5rem/);

  // Nothing here explains anything, so reduced motion takes it away rather
  // than freezing it — a stopped pass parks a half-drawn outline on the card,
  // which reads as a rendering fault.
  const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.bb-terminal-suggestion-beam \{\s*display: none;/);
});

test("the old fixed heading is gone from both terminals", () => {
  for (const terminal of [runtimeTerminal, legacyTerminal]) {
    assert.doesNotMatch(terminal, /Ask your whole knowledge base/);
    assert.doesNotMatch(terminal, /Ask the public knowledge hub/);
    assert.doesNotMatch(terminal, /Answers are grounded in the notes/);
    assert.doesNotMatch(terminal, /const SUGGESTED_PROMPTS/);
    assert.match(terminal, /<ChatGreetingEmptyState/);
    assert.match(terminal, /useChatGreeting\(\{ scope, temporary/);
  }
});

test("the garden workspace greets the same way, told which garden it is in", () => {
  const workspace = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  // The fixed "Chat about <garden>" heading is gone; the shared empty state
  // stands in its place, given the open garden by name and slug.
  assert.doesNotMatch(workspace, /Chat about <span/);
  assert.match(workspace, /<ChatGreetingEmptyState/);
  assert.match(workspace, /garden: greetingGarden/);
  assert.match(workspace, /\{ name: clusterName, slug: clusterSlug \}/);
  // Openers fill the workspace's own composer — they do not send.
  assert.match(workspace, /onSelectSuggestion=\{fillComposerWithPrompt\}/);
  assert.match(workspace, /composer\.setSelectionRange\(composer\.value\.length, composer\.value\.length\)/);
  // The Save page hint survives, as the footnote under the openers.
  assert.match(workspace, /footnote=/);
  assert.match(workspace, /Save page<\/span> to keep the/);
});

test("picking an opener fills the composer instead of sending it", () => {
  for (const terminal of [runtimeTerminal, legacyTerminal]) {
    assert.match(terminal, /onSelectSuggestion=\{fillComposerWithPrompt\}/);
    // The text lands in the field and the caret follows it there.
    assert.match(terminal, /setInput\((?:text|prompt)\);\s*\n\s*window\.setTimeout/);
    assert.match(terminal, /composer\.setSelectionRange\(composer\.value\.length, composer\.value\.length\)/);
  }
  // Nothing on this path reaches the runtime any more.
  assert.doesNotMatch(runtimeTerminal, /sendSuggestedPrompt/);
  assert.doesNotMatch(emptyState, /session\.send|sendMessage/);
});

test("the empty transcript loader has contrast on the dark chat surface", () => {
  assert.match(
    runtimePanel,
    /<BreadboardLoader\s+label="Loading this chat"\s+className="h-5 w-5 text-gray-400"/,
  );
});
