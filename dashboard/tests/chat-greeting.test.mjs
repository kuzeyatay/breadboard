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

test("the name is on every greeting there is, never only some of them", () => {
  // Whichever line the rotation lands on, and whatever the day has made true,
  // it is addressed to them by name. A greeting that sometimes drops the name
  // reads as a different product from one screen to the next.
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
      assert.equal(
        entry.greeting.name,
        "Grey",
        `${entry.greeting.leadId} dropped the name`,
      );
      // And it reads as a sentence once the name is appended to it.
      assert.doesNotMatch(entry.greeting.lead, /[.,!?]$/);
    }
  }

  // Only an account with no name to use goes without one.
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

test("it is funny sometimes, which is the only way it stays funny", () => {
  // A product that quips at you on every blank screen has a personality rather
  // than a sense of humour, and it wears out inside a week. The lighter lines
  // are eligible on some hours and compete with the plain ones even then, so
  // they should land often enough to notice and rarely enough to enjoy.
  const week = sweep(24 * 7);
  const light = new Set([
    "nocturnal", "sleep-rumour", "midnight-oil", "birds-impressed", "beat-the-sunrise",
    "coffee-first", "day-unspoiled", "post-lunch", "afternoon-slump", "golden-hour",
    "evening-shift", "one-more-thing", "screen-glow", "nobody-works-weekends",
    "brace-yourself", "nearly-free", "keyboard-lie-down", "save-some", "emigrated",
    "gardens-quiet", "that-was-quick", "back-already", "no-pressure", "clean-slate",
    "quite-the-collection", "at-your-service", "here-we-go", "cause-trouble",
  ]);
  const share = week.filter((entry) => light.has(entry.greeting.leadId)).length / week.length;
  assert.ok(share > 0.05, `the lighter lines never came up (${share})`);
  assert.ok(share < 0.45, `the lighter lines came up ${Math.round(share * 100)}% of the time`);

  // And the plain time-of-day greetings are still the backbone underneath.
  const plain = week.filter((entry) =>
    ["good-morning", "morning", "weekday-morning", "good-afternoon", "afternoon",
     "weekday-afternoon", "good-evening", "evening", "weekday-evening", "still-up",
     "still-at-it", "working-late", "up-early", "early-start", "winding-down",
     "late-one", "almost-tomorrow"].includes(entry.greeting.leadId),
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
    "birds-impressed": (h) => h >= 5 && h < 8,
    "beat-the-sunrise": (h) => h >= 5 && h < 8,
    "coffee-first": (h) => h >= 8 && h < 12,
    "day-unspoiled": (h) => h >= 8 && h < 12,
    "post-lunch": (h) => h >= 12 && h < 17,
    "afternoon-slump": (h) => h >= 12 && h < 17,
    "golden-hour": (h) => h >= 17 && h < 21,
    "evening-shift": (h) => h >= 17 && h < 21,
    "one-more-thing": (h) => h >= 21,
    "screen-glow": (h) => h >= 21,
  };
  for (const entry of sweep(24 * 14)) {
    const window = windows[entry.greeting.leadId];
    if (window) assert.ok(window(entry.now.getHours()), `${entry.greeting.leadId} at ${entry.now.getHours()}:00`);
    if (entry.greeting.leadId === "nobody-works-weekends") {
      assert.ok(entry.now.getDay() === 0 || entry.now.getDay() === 6);
    }
    if (entry.greeting.leadId === "brace-yourself") assert.equal(entry.now.getDay(), 1);
    if (entry.greeting.leadId === "nearly-free") assert.equal(entry.now.getDay(), 5);
    if (entry.greeting.questionId === "keeping-you-up") assert.ok(entry.now.getHours() < 5);
  }

  // Nothing teases someone about coming back after a gap they have not had.
  for (const entry of sweep(24 * 7, { signals: { minutesSinceLastPrompt: 5 } })) {
    assert.notEqual(entry.greeting.leadId, "emigrated");
    assert.notEqual(entry.greeting.leadId, "no-pressure");
  }
  // Someone who has never written a message is not welcomed back.
  for (const entry of sweep(24 * 7, {
    signals: { minutesSinceLastPrompt: null, promptsToday: 0, daysSinceJoined: 0 },
  })) {
    assert.notEqual(entry.greeting.leadId, "here-we-go");
    assert.notEqual(entry.greeting.leadId, "that-was-quick");
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
  // Every card is still something you could press send on.
  for (const prompt of day) assert.match(prompt, /[.?]$/);
});

test("two people do not step through the pools in lockstep", () => {
  const now = at(13);
  const one = resolveChatGreeting({ signals: { ...SIGNALS, name: "Grey" }, scope: "mine", temporary: false, now });
  const two = resolveChatGreeting({ signals: { ...SIGNALS, name: "Robin" }, scope: "mine", temporary: false, now });
  assert.notEqual(`${one.leadId}/${one.questionId}`, `${two.leadId}/${two.questionId}`);
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
