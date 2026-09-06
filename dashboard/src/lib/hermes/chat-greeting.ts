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
  /**
   * The garden this chat is open inside, when it is open inside one. A garden
   * chat is about one place, so its questions and openers name that place
   * rather than asking which of your gardens the conversation is about.
   */
  garden?: ChatGreetingGarden | null;
  /** A chat opened alongside the current browser page. */
  browser?: boolean;
  /** The reader's clock, not the server's — a greeting has to match their window. */
  now: Date;
}

export interface ChatGreeting {
  /** First line, without the name: "Good afternoon". */
  lead: string;
  /**
   * Rendered muted after the lead during an occasional addressed hour. Null
   * when the account has no name and whenever the line is a splash that would
   * not survive a vocative — "Hello, world, Grey" is not a greeting, it is a bug.
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
  browser: boolean;
  partOfDay: PartOfDay;
  /** 0 is Sunday, matching `Date.getDay()`. */
  weekday: number;
  weekdayName: string;
  weekend: boolean;
  /** 0 is January, matching `Date.getMonth()`. */
  month: number;
  /** 1–31, matching `Date.getDate()`. */
  date: number;
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
  /** The garden this chat is open inside, or null on the hub surfaces. */
  garden: ChatGreetingGarden | null;
  /** They have accumulated a lot of gardens. */
  manyGardens: boolean;
  /**
   * This hour the pools open up to their lighter lines.
   *
   * The playful half of each pool is eligible most hours, but still competes
   * with the plain lines instead of replacing them. That keeps the title-screen
   * surprise without turning every visit into the same forced joke.
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

/** Three hours in four, decided per reader so nobody else is having the same one. */
function playfulHour(audience: string, bucket: number): boolean {
  return fingerprint(`playful:${audience}:${bucket}`) % 4 < 3;
}

/**
 * A name is a small personal touch, not punctuation every greeting has to wear.
 * The offset makes it appear once in every four hours for each reader, while
 * keeping the result stable for the full hour.
 */
function addressedHour(audience: string, bucket: number): boolean {
  return (fingerprint(`address:${audience}`) + bucket) % 4 === 0;
}

function buildContext(input: ChatGreetingInput): GreetingContext {
  const { signals, scope, temporary, now } = input;
  const garden = input.garden ?? null;
  const minutes = signals.minutesSinceLastPrompt;
  const weekday = now.getDay();
  // The garden joins the audience so two gardens open in two tabs do not step
  // through the pools in lockstep — but only when there is one: inserting a
  // "hub" segment for everyone else would shift every existing reader's walk.
  const audience = [
    scope,
    temporary ? "temporary" : "kept",
    ...(garden ? [`garden=${garden.slug}`] : []),
    ...(input.browser ? ["browser"] : []),
    signals.name ?? "anonymous",
    String(signals.gardenCount),
  ].join(":");
  const bucket = chatGreetingBucket(now);
  return {
    signals,
    scope,
    temporary,
    browser: input.browser === true,
    partOfDay: partOfDay(now.getHours()),
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    weekend: weekday === 0 || weekday === 6,
    month: now.getMonth(),
    date: now.getDate(),
    brandNew: minutes === null,
    newHere: signals.daysSinceJoined <= 2,
    resuming: minutes !== null && minutes <= 45,
    returning: minutes !== null && minutes >= 6 * 24 * 60,
    busyDay: signals.promptsToday >= 12,
    hasGardens: signals.gardenCount > 0,
    garden,
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
 * A first line. Lines may read naturally with ", <name>" after them, but the
 * name is only used occasionally. Splash lines set `address: false` because a
 * title-screen punchline does not survive having a vocative stuck on the end.
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
  /**
   * False for splash lines that would not survive ", <name>". Default true,
   * though the name is only appended during an addressed hour.
   */
  address?: boolean;
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
  {
    id: "weekday-night",
    when: (c) => c.partOfDay === "night" && !c.weekend,
    text: (c) => `${c.weekdayName} night`,
  },
  {
    id: "quiet-hours",
    when: (c) => c.partOfDay === "night" || c.partOfDay === "late-night",
    text: () => "Quiet hours",
  },

  // The shape of the week.
  { id: "happy-weekend", when: (c) => c.weekend, text: (c) => `Happy ${c.weekdayName}` },
  {
    id: "slow-morning",
    when: (c) => c.weekend && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "Slow morning",
  },
  {
    id: "midweek",
    when: (c) => c.weekday === 3 && (c.partOfDay === "morning" || c.partOfDay === "afternoon"),
    text: () => "Midweek",
  },
  {
    id: "new-week",
    when: (c) => c.weekday === 1 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "New week",
  },
  {
    id: "happy-friday",
    when: (c) => c.weekday === 5 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "Happy Friday",
  },
  {
    id: "almost-weekend",
    when: (c) => c.weekday === 5 && (c.partOfDay === "afternoon" || c.partOfDay === "evening"),
    text: () => "Almost the weekend",
  },

  // Days that only come around once a year. Not gated on a playful hour: an
  // easter egg that fires one year in five is not an easter egg, it is a miss.
  { id: "new-year", when: (c) => c.month === 0 && c.date === 1, text: () => "New year" },
  { id: "pi-day", when: (c) => c.month === 2 && c.date === 14, text: () => "Pi o'clock", address: false },
  {
    id: "bonus-day",
    when: (c) => c.month === 1 && c.date === 29,
    text: () => "Bonus day unlocked",
    address: false,
  },
  { id: "trust-nothing", when: (c) => c.month === 3 && c.date === 1, text: () => "Trust nothing today" },
  {
    id: "everything-is-fine",
    when: (c) => c.month === 3 && c.date === 1,
    text: () => "Everything is fine",
    address: false,
  },
  { id: "watch-your-step", when: (c) => c.weekday === 5 && c.date === 13, text: () => "Watch your step" },
  {
    id: "restless-gardens",
    when: (c) => c.month === 9 && c.date === 31,
    text: () => "The gardens are restless",
    address: false,
  },
  {
    id: "between-the-days",
    when: (c) => c.month === 11 && c.date >= 24 && c.date <= 26,
    text: () => "Between the days",
  },
  {
    id: "last-save-point",
    when: (c) => c.month === 11 && c.date === 31,
    text: () => "Last save point of the year",
    address: false,
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

  // The lighter half. Vocative lines still have to survive ", <name>"; splash
  // lines set address: false and stand on their own, Minecraft-title-screen
  // style. Each still has to be true of the hour it appears in. A joke about
  // the small hours told at nine in the morning is not a joke, it is a bug.
  { id: "nocturnal", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Look who's nocturnal" },
  { id: "sleep-rumour", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Sleep is a rumour" },
  { id: "midnight-oil", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Burning the midnight oil" },
  { id: "living-dangerously", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Living dangerously" },
  { id: "better-judgement", playful: true, when: (c) => c.partOfDay === "late-night", text: () => "Against better judgement" },
  { id: "birds-impressed", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "The birds are impressed" },
  { id: "beat-the-sunrise", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "Beating the sunrise to it" },
  { id: "before-the-world", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "Before the world wakes" },
  { id: "while-quiet", playful: true, when: (c) => c.partOfDay === "early-morning", text: () => "While it's quiet" },
  { id: "coffee-first", playful: true, when: (c) => c.partOfDay === "morning", text: () => "Coffee first" },
  { id: "day-unspoiled", playful: true, when: (c) => c.partOfDay === "morning", text: () => "The day is still unspoiled" },
  { id: "fresh-eyes", playful: true, when: (c) => c.partOfDay === "morning", text: () => "Fresh eyes" },
  { id: "right-on-time", playful: true, when: (c) => c.partOfDay === "morning", text: () => "Right on time" },
  { id: "post-lunch", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "The post-lunch stretch" },
  { id: "afternoon-slump", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "Beating the afternoon slump" },
  { id: "shall-we", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "Shall we" },
  { id: "halfway-there", playful: true, when: (c) => c.partOfDay === "afternoon", text: () => "Halfway there" },
  { id: "golden-hour", playful: true, when: (c) => c.partOfDay === "evening", text: () => "Golden hour" },
  { id: "evening-shift", playful: true, when: (c) => c.partOfDay === "evening", text: () => "The evening shift" },
  { id: "prime-time", playful: true, when: (c) => c.partOfDay === "evening", text: () => "Prime time" },
  { id: "second-wind", playful: true, when: (c) => c.partOfDay === "evening", text: () => "Second wind" },
  { id: "one-more-thing", playful: true, when: (c) => c.partOfDay === "night", text: () => "Just one more thing" },
  { id: "screen-glow", playful: true, when: (c) => c.partOfDay === "night", text: () => "Screen glow o'clock" },
  { id: "home-stretch", playful: true, when: (c) => c.partOfDay === "night", text: () => "The home stretch" },
  { id: "making-it-count", playful: true, when: (c) => c.partOfDay === "night", text: () => "Making it count" },
  { id: "nobody-works-weekends", playful: true, when: (c) => c.weekend, text: () => "Nobody works weekends" },
  { id: "no-alarm", playful: true, when: (c) => c.weekend, text: () => "No alarm today" },
  {
    id: "brace-yourself",
    playful: true,
    when: (c) => c.weekday === 1 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "Brace yourself",
  },
  {
    id: "here-goes",
    playful: true,
    when: (c) => c.weekday === 1 && (c.partOfDay === "morning" || c.partOfDay === "early-morning"),
    text: () => "Here goes",
  },
  {
    id: "nearly-free",
    playful: true,
    when: (c) => c.weekday === 5 && (c.partOfDay === "afternoon" || c.partOfDay === "evening"),
    text: () => "Nearly free",
  },
  {
    id: "friday-feeling",
    playful: true,
    when: (c) => c.weekday === 5 && (c.partOfDay === "morning" || c.partOfDay === "afternoon"),
    text: () => "Friday feeling",
  },
  { id: "keyboard-lie-down", playful: true, when: (c) => c.busyDay, text: () => "The keyboard needs a lie down" },
  { id: "save-some", playful: true, when: (c) => c.busyDay, text: () => "Save some questions for tomorrow" },
  { id: "in-the-thick", playful: true, when: (c) => c.busyDay, text: () => "In the thick of it" },
  { id: "emigrated", playful: true, when: (c) => c.returning, text: () => "We thought you had emigrated" },
  {
    id: "gardens-quiet",
    playful: true,
    when: (c) => c.returning && c.hasGardens,
    text: () => "Your gardens have been very quiet",
  },
  { id: "missed-you", playful: true, when: (c) => c.returning, text: () => "Missed you" },
  { id: "that-was-quick", playful: true, when: (c) => c.resuming, text: () => "That was quick" },
  { id: "back-already", playful: true, when: (c) => c.resuming, text: () => "Back already" },
  { id: "look-who", playful: true, when: (c) => c.resuming, text: () => "Look who showed up" },
  { id: "no-pressure", playful: true, when: (c) => c.brandNew, text: () => "No pressure" },
  { id: "clean-slate", playful: true, when: (c) => c.brandNew, text: () => "A completely clean slate" },
  { id: "after-you", playful: true, when: (c) => c.brandNew, text: () => "After you" },
  { id: "quite-the-collection", playful: true, when: (c) => c.manyGardens, text: () => "Quite the collection" },
  { id: "at-your-service", playful: true, when: always, text: () => "At your service" },
  { id: "here-we-go", playful: true, when: (c) => !c.brandNew, text: () => "Here we go again" },
  { id: "cause-trouble", playful: true, when: always, text: () => "Let's cause some trouble" },
  { id: "the-usual", playful: true, when: always, text: () => "The usual" },
  { id: "fancy-seeing-you", playful: true, when: always, text: () => "Fancy seeing you" },

  // Splash lines. They skip the name on purpose: these are title-screen
  // punchlines, not vocatives, and they are windowed so a pool of always-on
  // jokes cannot drown the hour they appear in.
  { id: "hardcore-mode", playful: true, address: false, when: (c) => c.partOfDay === "late-night", text: () => "Hardcore mode" },
  { id: "does-not-replace-sleep", playful: true, address: false, when: (c) => c.partOfDay === "late-night", text: () => "Does not replace sleep" },
  { id: "out-of-office-hours", playful: true, address: false, when: (c) => c.partOfDay === "late-night", text: () => "Out of office hours" },
  { id: "moon-joined", playful: true, address: false, when: (c) => c.partOfDay === "late-night", text: () => "The moon joined the chat" },
  { id: "generating-terrain", playful: true, address: false, when: (c) => c.partOfDay === "early-morning", text: () => "Generating terrain" },
  { id: "limited-edition-hour", playful: true, address: false, when: (c) => c.partOfDay === "early-morning", text: () => "Limited edition hour" },
  { id: "first-spawn", playful: true, address: false, when: (c) => c.partOfDay === "early-morning", text: () => "First spawn of the day" },
  { id: "hello-world", playful: true, address: false, when: (c) => c.partOfDay === "morning", text: () => "Hello, world" },
  { id: "also-try-outside", playful: true, address: false, when: (c) => c.partOfDay === "morning", text: () => "Also try going outside" },
  { id: "not-on-the-exam", playful: true, address: false, when: (c) => c.partOfDay === "morning", text: () => "None of this is on the exam" },
  { id: "coffee-not-included", playful: true, address: false, when: (c) => c.partOfDay === "morning", text: () => "Coffee not included" },
  { id: "always-dns", playful: true, address: false, when: (c) => c.partOfDay === "afternoon", text: () => "It's always DNS" },
  { id: "works-on-my-machine", playful: true, address: false, when: (c) => c.partOfDay === "afternoon", text: () => "Works on my machine" },
  { id: "could-have-been-a-note", playful: true, address: false, when: (c) => c.partOfDay === "afternoon", text: () => "This meeting could have been a note" },
  { id: "side-quest-accepted", playful: true, address: false, when: (c) => c.partOfDay === "afternoon", text: () => "Side quest accepted" },
  { id: "low-battery", playful: true, address: false, when: (c) => c.partOfDay === "evening", text: () => "Low battery, high hopes" },
  { id: "rubber-duck", playful: true, address: false, when: (c) => c.partOfDay === "evening", text: () => "The rubber duck is listening" },
  { id: "you-are-here", playful: true, address: false, when: (c) => c.partOfDay === "evening", text: () => "You are here" },
  { id: "plot-thickens", playful: true, address: false, when: (c) => c.partOfDay === "evening", text: () => "The plot thickens" },
  { id: "currently-buffering", playful: true, address: false, when: (c) => c.partOfDay === "night", text: () => "Currently buffering" },
  { id: "one-more-compile", playful: true, address: false, when: (c) => c.partOfDay === "night", text: () => "One more compile" },
  { id: "watched-compile", playful: true, address: false, when: (c) => c.partOfDay === "night", text: () => "A watched compile never finishes" },
  { id: "night-shift-enabled", playful: true, address: false, when: (c) => c.partOfDay === "night", text: () => "Night shift enabled" },
  { id: "peaceful-difficulty", playful: true, address: false, when: (c) => c.weekend, text: () => "Peaceful difficulty" },
  { id: "also-try-writing", playful: true, address: false, when: (c) => c.weekend, text: () => "Also try writing it down" },
  { id: "weekend-mode", playful: true, address: false, when: (c) => c.weekend, text: () => "Weekend mode: technically enabled" },
  { id: "inventory-full", playful: true, address: false, when: (c) => c.busyDay, text: () => "Inventory full" },
  { id: "please-hold", playful: true, address: false, when: (c) => c.busyDay, text: () => "Please hold" },
  { id: "notes-miss-you", playful: true, address: false, when: (c) => c.returning, text: () => "Your notes miss you" },
  { id: "chunk-loaded", playful: true, address: false, when: (c) => c.resuming, text: () => "Chunk loaded" },
  { id: "spawn-point-set", playful: true, address: false, when: (c) => c.brandNew, text: () => "Spawn point set" },
  { id: "insert-greeting", playful: true, address: false, when: (c) => c.brandNew, text: () => "Insert greeting here" },
  { id: "advancement-made", playful: true, address: false, when: (c) => c.manyGardens, text: () => "Advancement made" },
  { id: "now-with-extra-gardens", playful: true, address: false, when: (c) => c.manyGardens, text: () => "Now with extra gardens" },
  { id: "now-entering-garden", playful: true, address: false, when: (c) => c.garden !== null, text: () => "Now entering the garden" },
  { id: "have-you-watered", playful: true, address: false, when: (c) => c.garden !== null, text: () => "Have you watered anything" },
  { id: "this-never-happened", playful: true, address: false, when: (c) => c.temporary, text: () => "This never happened" },
  { id: "nobody-saw-you", playful: true, address: false, when: (c) => c.temporary, text: () => "Nobody saw you come in" },
  { id: "may-contain-insight", playful: true, address: false, when: always, text: () => "May contain traces of insight" },
  { id: "as-seen-on-localhost", playful: true, address: false, when: always, text: () => "As seen on localhost" },
  { id: "certified-present", playful: true, address: false, when: always, text: () => "Certified present" },
  { id: "mildly-unsupervised", playful: true, address: false, when: always, text: () => "Mildly unsupervised" },
  { id: "feature-complete-ish", playful: true, address: false, when: always, text: () => "Feature complete-ish" },
  { id: "questions-more", playful: true, address: false, when: always, text: () => "Now with 64% more questions" },
  { id: "context-window", playful: true, address: false, when: always, text: () => "Do not feed the context window" },
  { id: "autosave-love", playful: true, address: false, when: always, text: () => "Autosave is a love language" },
  { id: "assembly-required", playful: true, address: false, when: always, text: () => "Some assembly required" },
  { id: "patch-notes", playful: true, address: false, when: always, text: () => "Patch notes unavailable" },
  { id: "probably-not-sentient", playful: true, address: false, when: always, text: () => "Probably not sentient" },
  { id: "tiny-invisible-math", playful: true, address: false, when: always, text: () => "Powered by tiny invisible math" },
  { id: "tangent-summoning", playful: true, address: false, when: always, text: () => "May summon a tangent" },
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
    when: (c) => c.hasGardens && c.scope === "mine" && !c.temporary && !c.garden,
    text: () => "Which garden are we in today?",
  },

  // Inside a garden the chat is about one place, and the second line says so.
  { id: "garden-look", when: (c) => c.garden !== null, text: (c) => `What should we look at in ${c.garden!.name}?` },
  { id: "garden-next", when: (c) => c.garden !== null, text: (c) => `What's next for ${c.garden!.name}?` },
  { id: "garden-add", when: (c) => c.garden !== null, text: () => "What should this garden learn today?" },
  { id: "garden-tending", playful: true, when: (c) => c.garden !== null, text: () => "What are we tending today?" },
  { id: "garden-grow-page", playful: true, when: (c) => c.garden !== null, text: () => "Which page are we growing today?" },
  { id: "garden-weeds", playful: true, when: (c) => c.garden !== null, text: () => "Shall we pull some weeds?" },
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
  { id: "figuring-out", when: always, text: () => "What are we figuring out?" },
  { id: "understand", when: always, text: () => "What do you want to understand?" },
  { id: "make-sense-of", when: always, text: () => "What do you want to make sense of?" },
  { id: "get-into", when: always, text: () => "What should we get into?" },
  { id: "help-think", when: always, text: () => "What can I help you think through?" },
  { id: "work-out", when: (c) => !c.brandNew, text: () => "What are you trying to work out?" },
  { id: "needs-attention", when: (c) => !c.brandNew, text: () => "What needs your attention today?" },
  { id: "second-opinion", when: (c) => !c.brandNew, text: () => "What needs a second opinion?" },

  // The lighter half. A second line has no name appended to it, so it may end
  // however it likes — which is most of why the jokes live down here rather
  // than in the leads.
  { id: "breaking-today", playful: true, when: always, text: () => "What are we breaking today?" },
  { id: "rabbit-hole", playful: true, when: always, text: () => "Which rabbit hole are we going down?" },
  { id: "side-quest", playful: true, when: always, text: () => "What's today's side quest?" },
  { id: "quest-log", playful: true, when: always, text: () => "What's in the quest log?" },
  { id: "crafting", playful: true, when: always, text: () => "What needs crafting?" },
  { id: "boss-battle", playful: true, when: always, text: () => "What's today's boss battle?" },
  {
    id: "fix-find-speculate",
    playful: true,
    when: always,
    text: () => "Are we fixing, finding, or wildly speculating?",
  },
  {
    id: "confusion-bullets",
    playful: true,
    when: always,
    text: () => "Shall we turn confusion into bullet points?",
  },
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
  { id: "overthink", playful: true, when: always, text: () => "What are we about to overthink?" },
  { id: "actual-question", playful: true, when: always, text: () => "What's the actual question?" },
  { id: "small-dent", playful: true, when: always, text: () => "Shall we make a small dent?" },
  { id: "detour", playful: true, when: always, text: () => "Which detour are we taking?" },
  { id: "thread-pulling", playful: true, when: always, text: () => "What thread are we pulling on?" },
  { id: "untangling", playful: true, when: always, text: () => "What are we untangling today?" },
  { id: "taking-apart", playful: true, when: always, text: () => "What are we taking apart?" },
  { id: "refusing-sense", playful: true, when: always, text: () => "What's refusing to make sense?" },
  { id: "wrestling", playful: true, when: always, text: () => "What are we wrestling with?" },
  { id: "the-itch", playful: true, when: always, text: () => "What's the itch today?" },
  { id: "bottom-of-it", playful: true, when: always, text: () => "What are we getting to the bottom of?" },
  { id: "half-formed", playful: true, when: always, text: () => "What's the half-formed idea?" },
  { id: "chasing-today", playful: true, when: always, text: () => "What are we chasing today?" },
  { id: "loose-end", playful: true, when: always, text: () => "Which loose end are we tying?" },
  { id: "second-guessing", playful: true, when: always, text: () => "What are we second-guessing?" },
  { id: "the-messy-part", playful: true, when: always, text: () => "What's the messy part?" },
  { id: "poking-at", playful: true, when: always, text: () => "What are we poking at today?" },
  { id: "main-quest", playful: true, when: always, text: () => "What's the main quest?" },
  { id: "grinding-or-exploring", playful: true, when: always, text: () => "Are we grinding or exploring?" },
  { id: "reverse-engineering", playful: true, when: always, text: () => "What are we reverse engineering?" },
  { id: "point-this-at", playful: true, when: always, text: () => "Where do you want to point this?" },
  { id: "todays-experiment", playful: true, when: always, text: () => "What's today's experiment?" },
  { id: "building-or-breaking", playful: true, when: always, text: () => "Are we building or breaking?" },
  {
    id: "morning-wanted",
    playful: true,
    when: (c) => c.partOfDay === "morning" || c.partOfDay === "early-morning",
    text: () => "What did the morning want?",
  },
  {
    id: "which-tab",
    playful: true,
    when: (c) => c.partOfDay === "afternoon",
    text: () => "Which tab are we closing today?",
  },
  {
    id: "what-finishing",
    playful: true,
    when: (c) => c.partOfDay === "evening" || c.partOfDay === "night",
    text: () => "What are we finishing?",
  },
  {
    id: "worth-the-hour",
    playful: true,
    when: (c) => c.partOfDay === "late-night",
    text: () => "What's worth the hour?",
  },
  {
    id: "weekend-brain",
    playful: true,
    when: (c) => c.weekend,
    text: () => "Weekend brain or weekday brain?",
  },
  {
    id: "smallest-useful",
    playful: true,
    when: (c) => c.busyDay,
    text: () => "What's the smallest useful thing?",
  },
  {
    id: "new-or-old",
    playful: true,
    when: (c) => !c.brandNew,
    text: () => "Is this a new thing or an old thing?",
  },
  {
    id: "back-on-the-shelf",
    playful: true,
    when: (c) => c.returning && !c.temporary,
    text: () => "What should we put back on the shelf?",
  },
  {
    id: "habit-or-reason",
    playful: true,
    when: (c) => c.resuming,
    text: () => "What brought you back so soon?",
  },
  {
    id: "whats-growing",
    playful: true,
    when: (c) => c.garden !== null,
    text: () => "What's growing in here?",
  },
  {
    id: "stays-between-us",
    playful: true,
    when: (c) => c.temporary,
    text: () => "What stays between us?",
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
  {
    id: "accidental-connection",
    family: "connect",
    when: (c) => c.signals.gardenCount >= 2,
    text: () => "Find a connection in my notes that looks accidental but is not.",
  },
  {
    id: "useful-rabbit-hole",
    family: "recall",
    when: (c) => c.hasGardens,
    text: () => "Find a rabbit hole in my gardens worth going down.",
  },
  {
    id: "everyday-objects",
    family: "open",
    when: always,
    text: () => "Explain a difficult idea using only everyday objects.",
  },
  {
    id: "learning-side-quest",
    family: "day",
    when: (c) => c.hasGardens,
    text: () => "Give me a side quest based on what I have been learning.",
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

/**
 * Openers for a chat standing inside one garden. Everything here is about this
 * garden — no opener offers to compare gardens the chat cannot see, and the
 * one that does reach outward names the reaching. The "page" family exists
 * because a garden chat has an outcome the hub does not: an answer worth
 * keeping can be saved into the garden as a page.
 */
const GARDEN_SUGGESTIONS: SuggestionCandidate[] = [
  {
    id: "garden-summary",
    family: "recall",
    when: always,
    text: (c) => `Summarize what I know in ${c.garden!.name}.`,
  },
  {
    id: "garden-blunt",
    family: "recall",
    when: always,
    text: () => "Give me a blunt read on how well I understand this garden.",
  },
  {
    id: "garden-forgotten",
    family: "recall",
    when: always,
    text: () => "Tell me something in here I have completely forgotten about.",
  },
  {
    id: "garden-quiz",
    family: "review",
    when: always,
    text: (c) => `Quiz me on ${c.garden!.name} and do not go easy.`,
  },
  {
    id: "garden-exam",
    family: "review",
    when: always,
    text: () => "What here is worth reviewing before an exam?",
  },
  {
    id: "garden-holes",
    family: "gap",
    when: always,
    text: () => "Where are the holes in this garden?",
  },
  {
    id: "garden-contradictions",
    family: "gap",
    when: always,
    text: () => "Do any notes in this garden contradict each other?",
  },
  {
    id: "garden-thin",
    family: "garden",
    when: always,
    text: () => "What is still thin here, and what would fill it?",
  },
  {
    id: "garden-tour",
    family: "garden",
    when: always,
    text: () => "Walk me through this garden as if I were new to it.",
  },
  {
    id: "garden-hardest",
    family: "open",
    when: always,
    text: () => "Explain the hardest idea in this garden in plain words.",
  },
  {
    id: "garden-direction",
    family: "open",
    when: always,
    text: () => "Help me think through where this garden should go next.",
  },
  {
    id: "garden-boss-battle",
    family: "review",
    when: always,
    text: () => "Find the boss battle in this garden and prepare me for it.",
  },
  {
    id: "garden-strange-connection",
    family: "connect",
    when: always,
    text: () => "Show me the strangest useful connection hiding in this garden.",
  },
  {
    id: "garden-relate",
    family: "connect",
    when: (c) => c.signals.gardenCount >= 2,
    text: (c) => `How does ${c.garden!.name} relate to my other gardens?`,
  },
  {
    id: "garden-today",
    family: "day",
    when: (c) => c.partOfDay === "morning" || c.partOfDay === "early-morning",
    text: () => "What should I work on here today?",
  },
  {
    id: "garden-weekend",
    family: "day",
    when: (c) => c.weekend,
    text: () => "What in this garden is worth a weekend read?",
  },
  {
    id: "garden-late",
    family: "day",
    when: (c) => c.partOfDay === "late-night" || c.partOfDay === "night",
    text: () => "Give me the short version of one idea, it is late.",
  },
  {
    id: "garden-page",
    family: "page",
    when: always,
    text: () => "Answer something here worth saving as a page.",
  },
];

const BROWSER_LEADS: LeadCandidate[] = [
  { id: "browser-explore", when: (c) => !c.temporary, address: false, text: () => "Let's explore" },
  { id: "browser-beside-you", when: (c) => !c.temporary, address: false, text: () => "Here while you browse" },
  { id: "browser-closer-look", when: (c) => !c.temporary, address: false, text: () => "A closer look" },
  { id: "browser-temporary", when: (c) => c.temporary, address: false, text: () => "An off-the-record chat" },
];

const BROWSER_QUESTIONS: QuestionCandidate[] = [
  { id: "browser-caught-your-eye", when: always, text: () => "What caught your eye?" },
  { id: "browser-unpack-page", when: always, text: () => "Shall we unpack this page?" },
  { id: "browser-reading", when: always, text: () => "What are we reading today?" },
  { id: "browser-understand", when: always, text: () => "What needs a closer look?" },
];

const BROWSER_SUGGESTIONS: SuggestionCandidate[] = [
  { id: "browser-summary", family: "summary", when: always, text: () => "Summarize this page in a few key points." },
  { id: "browser-explain", family: "explain", when: always, text: () => "Explain the main idea on this page in plain language." },
  { id: "browser-claims", family: "critique", when: always, text: () => "Which claims on this page should I double-check?" },
  { id: "browser-actions", family: "apply", when: always, text: () => "Turn the advice on this page into a practical checklist." },
  { id: "browser-takeaways", family: "summary", when: always, text: () => "What is worth remembering from this page?" },
  { id: "browser-jargon", family: "explain", when: always, text: () => "Explain the unfamiliar terms on this page." },
  { id: "browser-gaps", family: "critique", when: always, text: () => "What questions does this page leave unanswered?" },
  { id: "browser-next", family: "apply", when: always, text: () => "Based on this page, what should I explore next?" },
];

function suggestionPool(context: GreetingContext): SuggestionCandidate[] {
  if (context.browser) return BROWSER_SUGGESTIONS;
  if (context.temporary) {
    return context.scope === "public" ? TEMPORARY_PUBLIC_SUGGESTIONS : TEMPORARY_OWN_SUGGESTIONS;
  }
  if (context.garden) return GARDEN_SUGGESTIONS;
  return context.scope === "public" ? PUBLIC_SUGGESTIONS : OWN_SUGGESTIONS;
}

// ----------------------------------------------------------------- the answer

export function resolveChatGreeting(input: ChatGreetingInput): ChatGreeting {
  const context = buildContext(input);

  const leadPool = context.browser ? BROWSER_LEADS : LEADS;
  const questionPool = context.browser ? BROWSER_QUESTIONS : QUESTIONS;
  const leads = eligiblePool(leadPool, context);
  const questions = eligiblePool(questionPool, context);

  // Each pool has eligible entries for every supported context, so neither
  // fallback should be reachable. A future `when` with an incorrect window
  // degrades to a plain greeting instead of rendering nothing at all.
  const lead = rotate(leads, "lead", context) ?? leadPool[leadPool.length - 1];
  const question = rotate(questions, "question", context) ?? questionPool[0];

  return {
    lead: lead.text(context),
    name:
      lead.address === false || !addressedHour(context.audience, context.bucket)
        ? null
        : input.signals.name,
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
