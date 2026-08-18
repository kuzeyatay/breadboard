/**
 * The blank chat's opening lines and its four openers.
 *
 * The empty state used to be one fixed heading and one fixed grounding
 * sentence, which said the same thing at 3am on day four hundred as it did the
 * minute the account was made. This picks both the greeting and the openers
 * from pools instead, and steps one place along every hour, so a chat opened
 * after lunch and a chat opened at midnight do not greet you identically.
 *
 * Everything here is pure. It takes the reader's own clock and a small bundle
 * of activity signals read on the server, and returns strings. Nothing reaches
 * for `Date.now()` on its own, so a test can sit the whole thing at any hour of
 * any day and read back exactly what the screen would say.
 */

export type ChatGreetingScope = "mine" | "public";

export interface ChatGreetingGarden {
  name: string;
  slug: string;
}

/**
 * What the server knows about how this person has been using Breadboard. Kept
 * deliberately small: every field here is one cheap query, and the empty state
 * is on the critical path of opening a chat.
 */
export interface ChatGreetingSignals {
  /** What to call them. Null when the account has no username, or nobody is signed in. */
  name: string | null;
  gardenCount: number;
  /** Gardens touched most recently, freshest first. */
  recentGardens: ChatGreetingGarden[];
  /** Titles of the newest kept chats, freshest first. Placeholders are filtered out. */
  recentChats: string[];
  /** Messages they have written since local midnight. */
  promptsToday: number;
  /** Minutes since their newest message, or null when they have never written one. */
  minutesSinceLastPrompt: number | null;
  /** Whole days between the account being made and now. */
  daysSinceJoined: number;
}

export const EMPTY_CHAT_GREETING_SIGNALS: ChatGreetingSignals = {
  name: null,
  gardenCount: 0,
  recentGardens: [],
  recentChats: [],
  promptsToday: 0,
  minutesSinceLastPrompt: null,
  daysSinceJoined: 0,
};

export interface ChatGreetingInput {
  signals: ChatGreetingSignals;
  scope: ChatGreetingScope;
  /** Off-the-record chats get their own greeting and their own openers. */
  temporary: boolean;
  /** The reader's clock, not the server's — a greeting has to match their window. */
  now: Date;
}

export interface ChatGreeting {
  /** First line, without the name: "Good afternoon". */
  lead: string;
  /**
   * Rendered muted after the lead, on every greeting there is. Null only when
   * the account has no name to use — never because a particular line skipped it.
   */
  name: string | null;
  /** Second line: "What's on your mind?". */
  question: string;
  /** Which variants were picked. Only tests and React keys read these. */
  leadId: string;
  questionId: string;
}

/** How long one greeting stands before the pools step forward. */
export const CHAT_GREETING_ROTATION_MS = 60 * 60 * 1000;

/** How many openers the empty state shows. */
export const CHAT_SUGGESTION_COUNT = 4;

// ---------------------------------------------------------------- the context

type PartOfDay =
  | "late-night"
  | "early-morning"
  | "morning"
  | "afternoon"
  | "evening"
  | "night";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

interface GreetingContext {
  signals: ChatGreetingSignals;
  scope: ChatGreetingScope;
  temporary: boolean;
  partOfDay: PartOfDay;
  /** 0 is Sunday, matching `Date.getDay()`. */
  weekday: number;
  weekdayName: string;
  weekend: boolean;
  /** They have never written a message. */
  brandNew: boolean;
  /** The account itself is only days old. */
  newHere: boolean;
  /** They were here within the last three quarters of an hour. */
  resuming: boolean;
  /** Nothing for the best part of a week. */
  returning: boolean;
  /** A heavy day already. */
  busyDay: boolean;
  hasGardens: boolean;
  /** They have accumulated a lot of gardens. */
  manyGardens: boolean;
  /**
   * This hour the pools open up to their lighter lines.
   *
   * Funny every single time is not funny, it is a personality; a product that
   * quips at you on every blank screen wears out inside a week. So the playful
   * half of each pool is only eligible some of the time, and even then it
   * competes with the plain lines rather than replacing them — which lands it
   * at roughly one greeting in five rather than one in two.
   */
  playful: boolean;
  /** Which pool this reader rotates through, so two people never step in lockstep. */
  audience: string;
  bucket: number;
}

function partOfDay(hour: number): PartOfDay {
  if (hour < 5) return "late-night";
  if (hour < 8) return "early-morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

/** The hour the reader is in, counted from the epoch. One step per rotation. */
export function chatGreetingBucket(now: Date): number {
  return Math.floor(now.getTime() / CHAT_GREETING_ROTATION_MS);
}

/** Milliseconds until the pools step forward, for a timer to sleep on. */
export function msUntilNextChatGreeting(now: Date): number {
  const elapsed = now.getTime() % CHAT_GREETING_ROTATION_MS;
  return CHAT_GREETING_ROTATION_MS - elapsed;
}

/** Two hours in five, decided per reader so nobody else is having the same one. */
function playfulHour(audience: string, bucket: number): boolean {
  return fingerprint(`playful:${audience}:${bucket}`) % 5 < 2;
}

function buildContext(input: ChatGreetingInput): GreetingContext {
  const { signals, scope, temporary, now } = input;
  const minutes = signals.minutesSinceLastPrompt;
  const weekday = now.getDay();
  const audience = [
    scope,
    temporary ? "temporary" : "kept",
    signals.name ?? "anonymous",
    String(signals.gardenCount),
  ].join(":");
  const bucket = chatGreetingBucket(now);
  return {
    signals,
    scope,
    temporary,
    partOfDay: partOfDay(now.getHours()),
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    weekend: weekday === 0 || weekday === 6,
    brandNew: minutes === null,
    newHere: signals.daysSinceJoined <= 2,
    resuming: minutes !== null && minutes <= 45,
    returning: minutes !== null && minutes >= 6 * 24 * 60,
    busyDay: signals.promptsToday >= 12,
    hasGardens: signals.gardenCount > 0,
    manyGardens: signals.gardenCount >= 8,
    playful: playfulHour(audience, bucket),
    audience,
    bucket,
  };
}

// --------------------------------------------------------------- the rotation

/** FNV-1a, purely to spread one reader's starting offset away from another's. */
function fingerprint(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Walk one place along the pool per hour, from a starting point that depends on
 * who is reading. Stepping rather than re-drawing is the point: a fresh random
 * pick each hour would repeat itself often enough to look broken, whereas a
 * walk cannot say the same thing twice until the pool is exhausted.
 */
function rotate<T>(items: T[], salt: string, context: GreetingContext): T | null {
  if (items.length === 0) return null;
  const offset = fingerprint(`${salt}:${context.audience}`);
  return items[(offset + context.bucket) % items.length];
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * How far the window of openers slides each hour.
 *
 * Sliding by the window's own width looks right and is wrong: a pool of
 * sixteen openers and a window of four returns to where it started every four
 * hours, which is exactly the repetition this was supposed to remove. A stride
 * co-prime with the pool visits every position before repeating one, whatever
 * size the pool happens to be that hour.
 */
function windowStride(length: number, count: number): number {
  if (length <= 1) return 1;
  for (let candidate = Math.max(count, Math.floor(length / 2)); candidate > 1; candidate -= 1) {
    if (greatestCommonDivisor(candidate, length) === 1) return candidate;
  }
  return 1;
}

/**
 * The same walk, taking `count` distinct entries and preferring one per family
 * so the four cards are four different kinds of question rather than four
 * rewordings of one. Families are only a preference: a thin pool fills the
 * remaining slots with whatever is left.
 */
function rotateMany<T>(
  items: T[],
  count: number,
  salt: string,
  context: GreetingContext,
  familyOf: (item: T) => string,
): T[] {
  if (items.length === 0) return [];
  const offset = fingerprint(`${salt}:${context.audience}`);
  const start = offset + context.bucket * windowStride(items.length, count);
  const picked: T[] = [];
  const families = new Set<string>();

  for (let step = 0; step < items.length && picked.length < count; step += 1) {
    const item = items[(start + step) % items.length];
    const family = familyOf(item);
    if (families.has(family)) continue;
    families.add(family);
    picked.push(item);
  }
  for (let step = 0; step < items.length && picked.length < count; step += 1) {
    const item = items[(start + step) % items.length];
    if (picked.includes(item)) continue;
    picked.push(item);
  }
  return picked;
}

// ------------------------------------------------------------------- the pool

/**
 * A first line. Every one of these has to read naturally with ", <name>" after
 * it, because the name is not optional: it is what makes the greeting theirs
 * rather than the product's. Anything that would not take a name — "The small
 * hours" — is worded until it does or it does not go in the pool.
 */
interface PoolCandidate {
  when: (context: GreetingContext) => boolean;
  /**
   * True of any hour, which is exactly the problem with it. The rotation walks
   * whatever is eligible, so a line eligible around the clock is picked far
   * more often than one that only fits four hours a day — the three catch-alls
   * were taking nearly half of all greetings between them, and "Ready when you
   * are" alone was the single most common thing the blank chat ever said.
   * These are held back as the safety net they were meant to be.
   */
  generic?: boolean;
  /**
   * A lighter line than the backbone ones, offered only on a playful hour.
   * The flag is the whole mechanism: nothing is randomly funny, the pool is
   * simply wider some hours than others.
   */
  playful?: boolean;
}

interface LeadCandidate extends PoolCandidate {
  id: string;
  text: (context: GreetingContext) => string;
}

const always = () => true;

function offered(candidate: PoolCandidate, context: GreetingContext): boolean {
  if (candidate.playful && !context.playful) return false;
  return candidate.when(context);
}

/** How many lines a window needs before the catch-alls are held back. */
const ENOUGH_WITHOUT_A_FALLBACK = 3;

/**
 * Everything eligible this hour, with the catch-alls dropped whenever the hour
 * has enough to say for itself. They come back the moment a window is thin, so
 * no combination of clock, calendar and account can empty the pool.
 */
function eligiblePool<T extends PoolCandidate>(items: T[], context: GreetingContext): T[] {
  const offeredNow = items.filter((candidate) => offered(candidate, context));
  const specific = offeredNow.filter((candidate) => !candidate.generic);
  return specific.length >= ENOUGH_WITHOUT_A_FALLBACK ? specific : offeredNow;
}

const LEADS: LeadCandidate[] = [
  // The hour of the day, said plainly. These are the backbone; everything else
  // is something the day happened to make true as well.
  { id: "good-morning", when: (c) => c.partOfDay === "morning", text: () => "Good morning" },
  {
    id: "morning",
    when: (c) => c.partOfDay === "morning" || c.partOfDay === "early-morning",
    text: () => "Morning",
  },
  {
    // The weekday makes a plain line current without making it a remark. These
    // are what a thin window needed all along, and they cost nothing: the day
    // is already in the context.
    id: "weekday-morning",
    when: (c) => c.partOfDay === "morning" && !c.weekend,
    text: (c) => `${c.weekdayName} morning`,
  },
  { id: "good-afternoon", when: (c) => c.partOfDay === "afternoon", text: () => "Good afternoon" },
  { id: "afternoon", when: (c) => c.partOfDay === "afternoon", text: () => "Afternoon" },
  {
    id: "weekday-afternoon",
    when: (c) => c.partOfDay === "afternoon" && !c.weekend,
    text: (c) => `${c.weekdayName} afternoon`,
  },
  { id: "good-evening", when: (c) => c.partOfDay === "evening", text: () => "Good evening" },
  { id: "evening", when: (c) => c.partOfDay === "evening", text: () => "Evening" },
  {
    id: "weekday-evening",
    when: (c) => c.partOfDay === "evening" && !c.weekend,
    text: (c) => `${c.weekdayName} evening`,
  },
  { id: "up-early", when: (c) => c.partOfDay === "early-morning", text: () => "Up early" },
  { id: "early-start", when: (c) => c.partOfDay === "early-morning", text: () => "Early start" },
  { id: "winding-down", when: (c) => c.partOfDay === "night", text: () => "Winding down" },
  { id: "late-one", when: (c) => c.partOfDay === "night", text: () => "A late one" },
  { id: "almost-tomorrow", when: (c) => c.partOfDay === "night", text: () => "Almost tomorrow" },
  { id: "still-up", when: (c) => c.partOfDay === "late-night", text: () => "Still up" },
  { id: "working-late", when: (c) => c.partOfDay === "late-night", text: () => "Working late" },
  { id: "still-at-it", when: (c) => c.partOfDay === "late-night", text: () => "Still at it" },

  // The shape of the week.
  { id: "happy-weekend", when: (c) => c.weekend, text: (c) => `Happy ${c.weekdayName}` },
  {
    id: "new-week",
    when: (c) => c.weekday === 1 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "New week",
  },
  {
    id: "almost-weekend",
    when: (c) => c.weekday === 5 && (c.partOfDay === "afternoon" || c.partOfDay === "evening"),
    text: () => "Almost the weekend",
  },

  // What they have actually been doing.
  { id: "welcome-in", when: (c) => c.brandNew, text: () => "Welcome in" },
  { id: "getting-started", when: (c) => c.newHere && !c.brandNew, text: () => "Still settling in" },
  { id: "been-a-while", when: (c) => c.returning, text: () => "It has been a while" },
  { id: "back-again", when: (c) => c.resuming, text: () => "Back again" },
  { id: "welcome-back", when: (c) => c.resuming, text: () => "Welcome back" },
  { id: "still-going", when: (c) => c.busyDay, text: () => "Still going" },
  { id: "long-day", when: (c) => c.busyDay && c.partOfDay === "evening", text: () => "Long day" },

  // The safety net, held back while the hour has anything better to say.
  { id: "good-to-see-you", generic: true, when: always, text: () => "Good to see you" },
  { id: "hello-again", generic: true, when: (c) => !c.brandNew, text: () => "Hello again" },
  { id: "ready-when-you-are", generic: true, when: always, text: () => "Ready when you are" },

  // The lighter half. Same vocative rule as everything above — each of these
  // still has to survive having ", <name>" stuck on the end of it — and each
  // still has to be true of the hour it appears in. A joke about the small
  // hours told at nine in the morning is not a joke, it is a bug.
  { id: "nocturnal", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Look who's nocturnal" },
  { id: "sleep-rumour", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Sleep is a rumour" },
  { id: "midnight-oil", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Burning the midnight oil" },
  { id: "birds-impressed", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "The birds are impressed" },
  { id: "beat-the-sunrise", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "Beating the sunrise to it" },
  { id: "coffee-first", playful: true, when: (c) => c.partOfDay === "morning", text: () => "Coffee first" },
  { id: "day-unspoiled", playful: true, when: (c) => c.partOfDay === "morning", text: () => "The day is still unspoiled" },
  { id: "post-lunch", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "The post-lunch stretch" },
  { id: "afternoon-slump", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "Beating the afternoon slump" },
  { id: "golden-hour", playful: true, when: (c) => c.partOfDay === "evening", text: () => "Golden hour" },
  { id: "evening-shift", playful: true, when: (c) => c.partOfDay === "evening", text: () => "The evening shift" },
  { id: "one-more-thing", playful: true, when: (c) => c.partOfDay === "night", text: () => "Just one more thing" },
  { id: "screen-glow", playful: true, when: (c) => c.partOfDay === "night", text: () => "Screen glow o'clock" },
  { id: "nobody-works-weekends", playful: true, when: (c) => c.weekend, text: () => "Nobody works weekends" },
  {
    id: "brace-yourself",
    playful: true,
    when: (c) => c.weekday === 1 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "Brace yourself",
  },
  {
    id: "nearly-free",
    playful: true,
    when: (c) => c.weekday === 5 && (c.partOfDay === "afternoon" || c.partOfDay === "evening"),
    text: () => "Nearly free",
  },
  { id: "keyboard-lie-down", playful: true, when: (c) => c.busyDay, text: () => "The keyboard needs a lie down" },
  { id: "save-some", playful: true, when: (c) => c.busyDay, text: () => "Save some questions for tomorrow" },
  { id: "emigrated", playful: true, when: (c) => c.returning, text: () => "We thought you had emigrated" },
  {
    id: "gardens-quiet",
    playful: true,
    when: (c) => c.returning && c.hasGardens,
    text: () => "Your gardens have been very quiet",
  },
  { id: "that-was-quick", playful: true, when: (c) => c.resuming, text: () => "That was quick" },
  { id: "back-already", playful: true, when: (c) => c.resuming, text: () => "Back already" },
  { id: "no-pressure", playful: true, when: (c) => c.brandNew, text: () => "No pressure" },
  { id: "clean-slate", playful: true, when: (c) => c.brandNew, text: () => "A completely clean slate" },
  { id: "quite-the-collection", playful: true, when: (c) => c.manyGardens, text: () => "Quite the collection" },
  { id: "at-your-service", playful: true, when: always, text: () => "At your service" },
  { id: "here-we-go", playful: true, when: (c) => !c.brandNew, text: () => "Here we go again" },
  { id: "cause-trouble", playful: true, when: always, text: () => "Let's cause some trouble" },
];

interface QuestionCandidate extends PoolCandidate {
  id: string;
  text: (context: GreetingContext) => string;
}

const QUESTIONS: QuestionCandidate[] = [
  { id: "on-your-mind", generic: true, when: always, text: () => "What's on your mind?" },
  { id: "where-start", generic: true, when: always, text: () => "Where should we start?" },
  { id: "working-on", when: (c) => !c.brandNew, text: () => "What are you working on?" },
  { id: "dig-into", generic: true, when: always, text: () => "What do you want to dig into?" },
  { id: "look-at", when: (c) => !c.temporary, text: () => "What should we look at?" },
  { id: "pick-up", when: (c) => c.resuming && !c.temporary, text: () => "Want to pick up where you left off?" },
  { id: "recap", when: (c) => c.returning && !c.temporary, text: () => "Want a recap of where you got to?" },
  {
    id: "which-garden",
    when: (c) => c.hasGardens && c.scope === "mine" && !c.temporary,
    text: () => "Which garden are we in today?",
  },
  { id: "whats-next", when: (c) => c.busyDay, text: () => "What's next?" },
  { id: "still-chasing", when: (c) => c.partOfDay === "late-night", text: () => "What are we still chasing?" },
  {
    id: "plan-today",
    when: (c) => c.partOfDay === "morning" || c.partOfDay === "early-morning",
    text: () => "What's the plan today?",
  },
  {
    id: "go-over-today",
    when: (c) => (c.partOfDay === "evening" || c.partOfDay === "night") && c.signals.promptsToday > 0,
    text: () => "Want to go back over today?",
  },
  { id: "first-question", when: (c) => c.brandNew, text: () => "Ask me anything to start." },
  { id: "public-find", when: (c) => c.scope === "public", text: () => "What do you want to find out there?" },
  { id: "off-the-record", when: (c) => c.temporary, text: () => "Nothing here is kept. What is it?" },
  { id: "quietly", when: (c) => c.temporary, text: () => "What do you want to ask quietly?" },

  // The lighter half. A second line has no name appended to it, so it may end
  // however it likes — which is most of why the jokes live down here rather
  // than in the leads.
  { id: "breaking-today", playful: true, when: always, text: () => "What are we breaking today?" },
  { id: "rabbit-hole", playful: true, when: always, text: () => "Which rabbit hole are we going down?" },
  {
    id: "pretending",
    playful: true,
    when: (c) => !c.brandNew,
    text: () => "What are we pretending to understand today?",
  },
  { id: "avoiding", playful: true, when: (c) => !c.brandNew, text: () => "What are we avoiding?" },
  { id: "the-damage", playful: true, when: (c) => c.busyDay, text: () => "What's the damage?" },
  {
    id: "past-you",
    playful: true,
    when: (c) => (c.resuming || c.returning) && !c.temporary,
    text: () => "What did past you leave for present you?",
  },
  { id: "where-were-we", playful: true, when: (c) => c.resuming, text: () => "Where were we, again?" },
  {
    id: "keeping-you-up",
    playful: true,
    when: (c) => c.partOfDay === "late-night",
    text: () => "What is keeping you up?",
  },
  {
    id: "not-wait-monday",
    playful: true,
    when: (c) => c.weekend,
    text: () => "What couldn't wait until Monday?",
  },
  { id: "impossible", playful: true, when: (c) => c.brandNew, text: () => "Ask me something impossible." },
  {
    id: "stays-here",
    playful: true,
    when: (c) => c.temporary,
    text: () => "Nobody is writing this down. What is it?",
  },
  {
    id: "public-dig",
    playful: true,
    when: (c) => c.scope === "public",
    text: () => "What are we digging out of the public gardens?",
  },
];

interface SuggestionCandidate extends PoolCandidate {
  id: string;
  family: string;
  text: (context: GreetingContext) => string;
}

function firstGarden(context: GreetingContext): ChatGreetingGarden {
  return context.signals.recentGardens[0];
}

/** Openers for your own gardens, in a chat that is being kept. */
const OWN_SUGGESTIONS: SuggestionCandidate[] = [
  {
    id: "span-topics",
    family: "span",
    when: (c) => c.signals.gardenCount >= 2,
    text: () => "What topics span more than one of my gardens?",
  },
  {
    id: "overlap",
    family: "span",
    when: (c) => c.signals.gardenCount >= 2,
    text: () => "Where do my gardens overlap?",
  },
  {
    id: "summarize-concept",
    family: "recall",
    when: (c) => c.hasGardens,
    text: () => "Summarize everything I know about a concept across all gardens.",
  },
  {
    // Shares the "garden" family with the refresher below rather than sitting
    // in "recall": both are "tell me about this one garden", and two of them in
    // the same set of four is the repetition the families exist to prevent.
    id: "summarize-garden",
    family: "garden",
    when: (c) => c.signals.recentGardens.length >= 1,
    text: (c) => `Summarize what I know about ${firstGarden(c).name}.`,
  },
  {
    id: "exam",
    family: "review",
    when: (c) => c.hasGardens,
    text: () => "Which gardens should I review before an exam?",
  },
  {
    id: "review-today",
    family: "review",
    when: (c) => c.hasGardens,
    text: () => "What should I review today?",
  },
  {
    id: "connections",
    family: "connect",
    when: (c) => c.signals.gardenCount >= 2,
    text: () => "Find connections between ideas in different gardens.",
  },
  {
    id: "relate-two-gardens",
    family: "connect",
    when: (c) => c.signals.recentGardens.length >= 2,
    text: (c) => `How does ${c.signals.recentGardens[0].name} relate to ${c.signals.recentGardens[1].name}?`,
  },
  {
    id: "refresher",
    family: "garden",
    when: (c) => c.signals.recentGardens.length >= 1,
    text: (c) => `Give me a refresher on ${firstGarden(c).name}.`,
  },
  {
    id: "thin-garden",
    family: "garden",
    when: (c) => c.signals.recentGardens.length >= 1,
    text: (c) => `What is still thin in ${firstGarden(c).name}?`,
  },
  {
    id: "resume-chat",
    family: "resume",
    when: (c) => c.signals.recentChats.length >= 1,
    text: (c) => `Pick up where I left off on "${c.signals.recentChats[0]}".`,
  },
  {
    id: "holes",
    family: "gap",
    when: (c) => c.hasGardens,
    text: () => "Where are the holes in what I have written about a topic?",
  },
  {
    id: "contradictions",
    family: "gap",
    when: (c) => c.signals.gardenCount >= 2,
    text: () => "Do any of my notes contradict each other?",
  },
  {
    id: "first-garden",
    family: "start",
    when: (c) => !c.hasGardens,
    text: () => "How do I start my first garden?",
  },
  {
    id: "bring-notes",
    family: "start",
    when: (c) => !c.hasGardens,
    text: () => "How do I get the notes I already have into Breadboard?",
  },
  {
    id: "what-you-can-do",
    family: "start",
    when: (c) => !c.hasGardens,
    text: () => "What can you do for me once I have notes in here?",
  },
  {
    id: "focus-today",
    family: "day",
    when: (c) => c.partOfDay === "morning" || c.partOfDay === "early-morning",
    text: () => "What should I focus on today?",
  },
  {
    id: "recap-today",
    family: "day",
    when: (c) => (c.partOfDay === "evening" || c.partOfDay === "night") && c.signals.promptsToday > 0,
    text: () => "What did I work on today?",
  },
  {
    id: "weekend-read",
    family: "day",
    when: (c) => c.weekend && c.hasGardens,
    text: () => "What is worth reading through this weekend?",
  },
  {
    id: "short-version",
    family: "day",
    when: (c) => c.partOfDay === "late-night",
    text: () => "Give me the short version, it is late.",
  },
  {
    id: "explain-from-scratch",
    family: "open",
    when: always,
    text: () => "Explain something I am trying to learn, from scratch.",
  },
  {
    id: "think-through",
    family: "open",
    when: always,
    text: () => "Help me think through a decision.",
  },

  // The lighter end of the pool. These are not jokes — each one is a prompt
  // worth actually sending — so unlike the lighter greetings they are offered
  // every hour. A pool that changed size hour to hour would also break the
  // rotation: the window's stride is computed from the pool's length, and two
  // different lengths can land two consecutive hours on the same four cards.
  {
    id: "no-mercy-quiz",
    family: "review",
    when: (c) => c.hasGardens,
    text: () => "Quiz me on a topic from my notes and do not go easy.",
  },
  {
    id: "weakest-note",
    family: "gap",
    when: (c) => c.hasGardens,
    text: () => "Find the weakest thing I have written and tell me why it is weak.",
  },
  {
    id: "forgotten",
    family: "recall",
    when: (c) => c.hasGardens,
    text: () => "Tell me something in my gardens I have completely forgotten about.",
  },
  {
    id: "hardest-thing",
    family: "garden",
    when: (c) => c.signals.recentGardens.length >= 1,
    text: (c) => `Explain the hardest idea in ${firstGarden(c).name} in plain words.`,
  },
  {
    id: "settle-argument",
    family: "open",
    when: always,
    text: () => "Settle an argument I am having with myself.",
  },
];

/** Openers for the public hub. Nothing here may name a private garden or chat. */
const PUBLIC_SUGGESTIONS: SuggestionCandidate[] = [
  {
    id: "public-span",
    family: "span",
    when: always,
    text: () => "What topics show up across multiple public gardens?",
  },
  {
    id: "public-summary",
    family: "recall",
    when: always,
    text: () => "Summarize what the public gardens cover about a concept.",
  },
  {
    id: "public-start",
    family: "start",
    when: always,
    text: () => "Which public gardens are the best starting point for a subject?",
  },
  {
    id: "public-connect",
    family: "connect",
    when: always,
    text: () => "Find connections between ideas in different public gardens.",
  },
  {
    id: "public-depth",
    family: "review",
    when: always,
    text: () => "Which public gardens go deepest on a subject?",
  },
  {
    id: "public-gap",
    family: "gap",
    when: always,
    text: () => "What do the public gardens leave out about a subject?",
  },
  {
    id: "public-explain",
    family: "open",
    when: always,
    text: () => "Explain a concept from the public gardens from scratch.",
  },
  {
    id: "public-weekend",
    family: "day",
    when: (c) => c.weekend,
    text: () => "What is worth reading in the public gardens this weekend?",
  },
  {
    id: "public-late",
    family: "day",
    when: (c) => c.partOfDay === "late-night",
    text: () => "Give me one short read from the public gardens.",
  },
  {
    id: "public-surprise",
    family: "recall",
    when: always,
    text: () => "Show me something genuinely surprising from the public gardens.",
  },
  {
    id: "public-disagree",
    family: "gap",
    when: always,
    text: () => "Where do the public gardens disagree with each other?",
  },
];

// The openers a kept chat offers are all about accumulation, and they are the
// wrong invitation in a chat that keeps nothing. These are the questions worth
// asking precisely because no one is taking notes: the beginner's question, the
// test you would rather not have on your record, the honest look at a gap.
const TEMPORARY_OWN_SUGGESTIONS: SuggestionCandidate[] = [
  {
    id: "temp-explain",
    family: "open",
    when: always,
    text: () => "Explain a concept from my gardens as if I had never seen it.",
  },
  {
    id: "temp-quiz",
    family: "review",
    when: always,
    text: () => "Quiz me on a topic in my notes, without keeping the score.",
  },
  {
    id: "temp-holes",
    family: "gap",
    when: always,
    text: () => "Where are the holes in what I have written about a topic?",
  },
  {
    id: "temp-blunt",
    family: "recall",
    when: always,
    text: () => "Give me a blunt read on something I think I understand.",
  },
  {
    id: "temp-garden",
    family: "garden",
    when: (c) => c.signals.recentGardens.length >= 1,
    text: (c) => `Walk me through ${firstGarden(c).name} as if I were new to it.`,
  },
  {
    id: "temp-basic",
    family: "start",
    when: always,
    text: () => "Let me ask the basic question I would rather not file.",
  },
  {
    id: "temp-stuck",
    family: "day",
    when: (c) => c.partOfDay === "late-night" || c.busyDay,
    text: () => "Talk me through something I am stuck on, off the record.",
  },
  {
    id: "temp-should-know",
    family: "open",
    when: always,
    text: () => "Let me ask the thing I should already know the answer to.",
  },
  {
    id: "temp-argue-back",
    family: "recall",
    when: always,
    text: () => "Argue against something I believe, and mean it.",
  },
];

const TEMPORARY_PUBLIC_SUGGESTIONS: SuggestionCandidate[] = [
  {
    id: "temp-public-explain",
    family: "open",
    when: always,
    text: () => "Explain a concept from the public gardens as if I were new to it.",
  },
  {
    id: "temp-public-quiz",
    family: "review",
    when: always,
    text: () => "Quiz me on a public-garden topic, without keeping the score.",
  },
  {
    id: "temp-public-gap",
    family: "gap",
    when: always,
    text: () => "What do the public gardens leave out about a subject?",
  },
  {
    id: "temp-public-start",
    family: "start",
    when: always,
    text: () => "Where should I start on a subject I know nothing about?",
  },
  {
    id: "temp-public-blunt",
    family: "recall",
    when: always,
    text: () => "Give me a blunt read on a subject I think I understand.",
  },
  {
    id: "temp-public-late",
    family: "day",
    when: (c) => c.partOfDay === "late-night",
    text: () => "Give me a quiet read on something I am curious about.",
  },
];

function suggestionPool(context: GreetingContext): SuggestionCandidate[] {
  if (context.temporary) {
    return context.scope === "public" ? TEMPORARY_PUBLIC_SUGGESTIONS : TEMPORARY_OWN_SUGGESTIONS;
  }
  return context.scope === "public" ? PUBLIC_SUGGESTIONS : OWN_SUGGESTIONS;
}

// ----------------------------------------------------------------- the answer

export function resolveChatGreeting(input: ChatGreetingInput): ChatGreeting {
  const context = buildContext(input);

  const leads = eligiblePool(LEADS, context);
  const questions = eligiblePool(QUESTIONS, context);

  // Both pools carry unconditional entries, so neither fallback should ever be
  // reachable. They exist so a future `when` that is wrong about its own window
  // degrades to a plain greeting instead of rendering nothing at all.
  const lead = rotate(leads, "lead", context) ?? LEADS[LEADS.length - 1];
  const question = rotate(questions, "question", context) ?? QUESTIONS[0];

  return {
    lead: lead.text(context),
    name: input.signals.name,
    question: question.text(context),
    leadId: lead.id,
    questionId: question.id,
  };
}

export function resolveChatSuggestions(input: ChatGreetingInput): string[] {
  const context = buildContext(input);
  const eligible = eligiblePool(suggestionPool(context), context);
  return rotateMany(
    eligible,
    CHAT_SUGGESTION_COUNT,
    "suggestion",
    context,
    (candidate) => candidate.family,
  ).map((candidate) => candidate.text(context));
}
