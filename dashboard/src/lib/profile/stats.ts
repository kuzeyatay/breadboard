// What the profile page knows about you, read straight out of the database.
//
// Everything here is derived rather than stored: the dashboard already lists
// your chats, the settings dialog already shows what the agent remembers, and
// the garden library already shows your gardens. None of that is worth
// repeating. What no other surface can answer is the shape of the use — when
// you work, how long the habit has held, which gardens and which agents
// actually carry the weight — so that is what this module computes.
//
// The database is passed in rather than imported so the aggregation can be
// exercised against an in-memory copy.

import type Database from "better-sqlite3";

import {
  DEFAULT_MODEL,
  assistantModelVendor,
  formatAssistantModelName,
} from "../ai-models.ts";
import {
  addDays,
  dateOf,
  daysBetween,
  startOfDay,
  startOfWeek,
  todayDate,
} from "../calendar/wallclock.ts";
import {
  EMPTY_COMPRESSION_SAVINGS,
  readCompressionSavings,
  type CompressionSavings,
} from "./compression-savings.ts";
import { readUserIdentity } from "./identity-store.ts";
import { priceUsd } from "./model-pricing.ts";

/** How many weeks the activity grid covers by default. */
export const DEFAULT_ACTIVITY_WEEKS = 26;

/** Keep phrase analysis useful without pulling an unbounded chat history into memory. */
export const PROFILE_PHRASE_PROMPT_LIMIT = 2_000;

export interface ProfileAccount {
  username: string;
  /** Both halves of the name they set on this page. Either may be empty. */
  firstName: string;
  lastName: string;
  /** The "about you" fields from the same page. Any of them may be empty. */
  nickname: string;
  occupation: string;
  about: string;
  /**
   * What the assistant calls them: their nickname, else their first name, else
   * the username.
   */
  displayName: string | null;
  email: string;
  joinedAt: string;
  /** Whole days between joining and today — the age of the account. */
  daysSinceJoined: number;
}

export interface ProfileTotals {
  conversations: number;
  /** Messages you wrote. The honest measure of use. */
  prompts: number;
  replies: number;
  gardens: number;
  artifacts: number;
  memories: number;
  agentRuns: number;
  /** Tokens across every reply that reported usage. */
  tokens: number;
  /** Milliseconds the assistant spent generating those replies. */
  thinkingMs: number;
  /** Replies that reported usage, so the two numbers above can be qualified. */
  measuredReplies: number;
}

export interface ActivityDay {
  date: string;
  count: number;
  /** A cell in the current week that has not happened yet. */
  future: boolean;
  /** The real conversations that contributed prompts to this day. */
  conversations: ActivityConversation[];
}

export interface ActivityConversation {
  id: number;
  title: string;
  prompts: number;
  garden: { name: string; slug: string } | null;
}

export interface ProfileHabit {
  /** Prompts per hour of the day, index 0–23, in local time. */
  hours: number[];
  /** Prompts per weekday, Monday first, matching the calendar's grid. */
  weekdays: number[];
  /** The hour with the most prompts, or null when there is nothing to rank. */
  peakHour: number | null;
  peakWeekday: number | null;
}

export interface PhraseUse {
  phrase: string;
  /** Prompts containing the phrase, counted once per prompt. */
  count: number;
}

export interface ProfilePhrases {
  items: PhraseUse[];
  analyzedPrompts: number;
  /** There were older prompts outside the bounded sample. */
  truncated: boolean;
}

export interface ProfileStreaks {
  /** Distinct days you wrote something, over the whole account. */
  daysActive: number;
  currentStreak: number;
  longestStreak: number;
  busiestDay: { date: string; count: number } | null;
  firstActiveDay: string | null;
}

export interface SurfaceUse {
  surface: "dashboard_terminal" | "garden_chat" | "quartz_ai";
  label: string;
  count: number;
}

export interface GardenUse {
  slug: string;
  name: string;
  prompts: number;
  lastPromptAt: string | null;
}

export interface ArtifactKindUse {
  kind: string;
  label: string;
  count: number;
}

export interface AgentUse {
  kind: string;
  label: string;
  runs: number;
  completed: number;
  failed: number;
}

export interface InviteTotals {
  created: number;
  redeemed: number;
  open: number;
}

export interface ModelUse {
  /** The id exactly as the turn recorded it, routing prefix and all. */
  model: string;
  label: string;
  vendorLabel: string;
  replies: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Terminal replies on this model that never produced an answer. */
  failed: number;
  /** USD for this model's measured replies, using the fallback when needed. */
  costUsd: number | null;
  /** This model used the profile's fallback rate rather than its own rate. */
  estimated: boolean;
}

export interface ProfileCost {
  models: ModelUse[];
  /** Every reported token, using the fallback model when its own rate is unknown. */
  totalUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  pricedReplies: number;
  /** Usage priced with the fallback because its model or rate was unavailable. */
  estimatedReplies: number;
  estimatedTokens: number;
  fallbackModel: string;
  /**
   * Tool output the runtime compressed away before it reached a model, priced
   * at what those tokens would have cost. It sits beside the spend rather than
   * inside it: one is money spent, the other money not spent, and netting them
   * would hide both.
   */
  compression: CompressionSavings;
}

export interface ProfileReliability {
  /** Assistant turns that reached a terminal state, however they got there. */
  terminalReplies: number;
  completed: number;
  failed: number;
  aborted: number;
  /** The errors that actually recur, most common first. */
  topErrors: Array<{ error: string; count: number }>;
  /** The agent that fails most often, when any agent has failed at all. */
  worstAgent: AgentUse | null;
  lastFailureAt: string | null;
}

export interface ProfileLatency {
  /** Replies that reported a duration, which is what the rest describes. */
  measured: number;
  medianMs: number;
  p90Ms: number;
  slowestMs: number;
  fastestMs: number;
}

export interface MemoryKindUse {
  kind: string;
  label: string;
  count: number;
}

export interface ProfileMemory {
  kinds: MemoryKindUse[];
  /** Remembered on the assistant's own judgement, not yet confirmed by use. */
  candidate: number;
  confirmed: number;
  /** Retired entries, kept because forgetting is a number worth seeing. */
  superseded: number;
}

export type AuditKind = "agent_run" | "artifact" | "memory" | "scheduled_chat";

export interface AuditEntry {
  kind: AuditKind;
  /** Local-time stamp, already normalized to ISO-ish for sorting. */
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
  status: "ok" | "failed" | "pending";
}

export interface ProfileStats {
  account: ProfileAccount;
  totals: ProfileTotals;
  activity: ActivityDay[];
  activityWeeks: number;
  habit: ProfileHabit;
  phrases: ProfilePhrases;
  streaks: ProfileStreaks;
  surfaces: SurfaceUse[];
  gardens: GardenUse[];
  artifactKinds: ArtifactKindUse[];
  agents: AgentUse[];
  invites: InviteTotals;
  cost: ProfileCost;
  reliability: ProfileReliability;
  latency: ProfileLatency;
  memory: ProfileMemory;
  /** The most recent things done on your behalf, newest first. */
  audit: AuditEntry[];
  /** The first chat on the account — where all of this started. */
  firstConversation: { title: string; createdAt: string } | null;
}

/** How many entries the audit feed carries. Enough to read, not to scroll. */
const AUDIT_FEED_LIMIT = 14;

const MEMORY_KIND_LABELS: Record<string, string> = {
  preference: "Preferences",
  project_fact: "Project facts",
  decision: "Decisions",
  working_pattern: "Working patterns",
};

const SURFACE_LABELS: Record<SurfaceUse["surface"], string> = {
  dashboard_terminal: "Terminal",
  garden_chat: "Garden chat",
  quartz_ai: "Published pages",
};

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  text: "Notes",
  markdown: "Markdown",
  document: "Documents",
  pdf: "PDFs",
  presentation: "Slides",
  spreadsheet: "Spreadsheets",
  html: "Web pages",
  code: "Code",
  image: "Images",
  audio: "Audio",
  video: "Video",
  diagram: "Diagrams",
  data: "Data",
  gadget: "Gadgets",
  model: "3D models",
  unknown: "Other",
};

/**
 * Display names for the agents a run can belong to.
 *
 * Runs are stamped with the kind that was current when they ran, so retired
 * spellings stay in the data forever and are kept here beside their successor
 * (`postiz` became `socials_manager`). Anything unrecognised falls back to a
 * readable form of the slug rather than disappearing from the list.
 */
const AGENT_LABELS: Record<string, string> = {
  agent_tars: "UI-TARS",
  agent_browser: "Agent Browser",
  agent_reach: "Agent Reach",
  career_ops: "Career Ops",
  trading_agents: "TradingAgents",
  vibe_trading: "Vibe Trading",
  stock_analyst: "Stock Analyst",
  deer_flow: "DeerFlow",
  deep_research: "Deep Research",
  get_doc: "Get Doc",
  deep_tutor: "Deep Tutor",
  openplanter: "OpenPlanter",
  openwork: "OpenWork",
  codex: "Codex",
  opencode: "OpenCode",
  ruflo: "Ruflo",
  socials_manager: "Socials Manager",
  postiz: "Socials Manager",
  hardware_blueprint: "Hardware Blueprint",
  parametric_cad: "Parametric CAD",
  hyperframes: "Hyperframes",
  openmontage: "OpenMontage",
  vimax: "ViMax",
  shorts: "Shorts",
  formsmith: "Formsmith",
  money_printer: "MoneyPrinter",
};

function titleCase(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function agentLabel(kind: string): string {
  return AGENT_LABELS[kind] ?? titleCase(kind);
}

export function artifactKindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind] ?? titleCase(kind);
}

function count(database: Database.Database, sql: string, ...params: unknown[]): number {
  const row = database.prepare(sql).get(...params) as { value: number | null } | undefined;
  return Number(row?.value ?? 0);
}

interface Options {
  /** Overrides "today" so the grid and the streaks are testable. */
  today?: string;
  weeks?: number;
}

export function readProfileStats(
  database: Database.Database,
  userId: number,
  options: Options = {},
): ProfileStats {
  const today = options.today ?? todayDate();
  const weeks = Math.max(1, options.weeks ?? DEFAULT_ACTIVITY_WEEKS);

  const user = database
    .prepare("SELECT username, email, created_at FROM users WHERE id = ?")
    .get(userId) as { username: string | null; email: string; created_at: string } | undefined;
  const identity = readUserIdentity(userId, database);
  if (!user) throw new Error(`No such user: ${userId}`);

  const joinedDate = normalizeDate(user.created_at);

  // ------------------------------------------------------------------ totals

  const usage = database
    .prepare(
      `WITH profile_messages AS (
         SELECT m.*
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ? AND ${UNIQUE_REPORTED_USAGE}
       )
       SELECT
         COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0) AS prompts,
         COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.status = 'complete' THEN 1 ELSE 0 END), 0) AS replies,
         COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN ${REPORTED_TOTAL_TOKENS} ELSE 0 END), 0) AS tokens,
         COALESCE(SUM(${REPLY_DURATION_MS}), 0) AS thinking_ms,
         COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.token_usage IS NOT NULL THEN 1 ELSE 0 END), 0) AS measured
       FROM profile_messages m`,
    )
    .get(userId) as {
    prompts: number;
    replies: number;
    tokens: number;
    thinking_ms: number;
    measured: number;
  };

  const agents = readAgentUse(database, userId);

  const totals: ProfileTotals = {
    // Temporary chats are excluded everywhere they would be counted or named:
    // a chat kept out of history should not reappear as a statistic about it.
    conversations: count(
      database,
      "SELECT COUNT(*) AS value FROM conversations WHERE user_id = ? AND temporary = 0",
      userId,
    ),
    prompts: Number(usage.prompts),
    replies: Number(usage.replies),
    gardens: count(database, "SELECT COUNT(*) AS value FROM clusters WHERE user_id = ?", userId),
    artifacts: count(
      database,
      "SELECT COUNT(*) AS value FROM hermes_artifacts WHERE user_id = ? AND status <> 'archived'",
      userId,
    ),
    memories: count(
      database,
      "SELECT COUNT(*) AS value FROM durable_memories WHERE user_id = ? AND state <> 'superseded'",
      userId,
    ),
    agentRuns: agents.reduce((sum, agent) => sum + agent.runs, 0),
    tokens: Number(usage.tokens),
    thinkingMs: Number(usage.thinking_ms),
    measuredReplies: Number(usage.measured),
  };

  // -------------------------------------------------------------- day counts

  // Local time, not UTC: an entry made at 1am belongs to the night it was made,
  // and a streak has to break on the boundary the person actually lived.
  const dayRows = database
    .prepare(
      `SELECT date(m.created_at, 'localtime') AS day, COUNT(*) AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
       GROUP BY day
       ORDER BY day`,
    )
    .all(userId) as Array<{ day: string; n: number }>;

  const perDay = new Map(dayRows.map((row) => [row.day, Number(row.n)]));

  const activity = readActivityGrid(database, userId, perDay, today, weeks);

  return {
    account: {
      username: user.username?.trim() || user.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      nickname: identity.nickname,
      occupation: identity.occupation,
      about: identity.about,
      displayName: identity.displayName,
      email: user.email,
      joinedAt: user.created_at,
      daysSinceJoined: Math.max(0, daysBetween(joinedDate, today)),
    },
    totals,
    activity,
    activityWeeks: weeks,
    habit: readHabit(database, userId),
    phrases: readPhrases(database, userId),
    streaks: readStreaks(dayRows, today),
    surfaces: readSurfaceUse(database, userId),
    gardens: readGardenUse(database, userId),
    artifactKinds: readArtifactKinds(database, userId),
    agents,
    invites: readInvites(database, userId),
    cost: readCost(database, userId),
    reliability: readReliability(database, userId, agents),
    latency: readLatency(database, userId),
    memory: readMemory(database, userId),
    audit: readAuditFeed(database, userId),
    firstConversation: readFirstConversation(database, userId),
  };
}

/** A `created_at` may be ISO-8601 or SQLite's space-separated form. */
function normalizeDate(value: string): string {
  return dateOf(value.replace(" ", "T"));
}

/**
 * A rectangular Monday-first grid ending with the week that contains `today`,
 * so the last column is always the current week and the cells line up under
 * fixed weekday labels. Days later in the current week are marked rather than
 * dropped — the column would otherwise be short and the grid would jump.
 */
function buildActivityGrid(
  perDay: Map<string, number>,
  today: string,
  weeks: number,
): ActivityDay[] {
  const currentWeek = startOfWeek(startOfDay(today));
  const start = dateOf(addDays(startOfDay(currentWeek), -(weeks - 1) * 7));

  const days: ActivityDay[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = dateOf(addDays(startOfDay(start), index));
    days.push({
      date,
      count: perDay.get(date) ?? 0,
      future: date > today,
      conversations: [],
    });
  }
  return days;
}

/**
 * Adds a bounded, inspectable breakdown to the heatmap.
 *
 * The totals above are useful at a glance, but a profile chart should also be
 * able to show where a number came from. Only the visible window is queried so
 * an old, heavily-used account does not ship its entire history to the page.
 */
function readActivityGrid(
  database: Database.Database,
  userId: number,
  perDay: Map<string, number>,
  today: string,
  weeks: number,
): ActivityDay[] {
  const days = buildActivityGrid(perDay, today, weeks);
  const firstDate = days[0]?.date;
  if (!firstDate) return days;

  const rows = database
    .prepare(
      `SELECT date(m.created_at, 'localtime') AS day,
              c.id AS conversation_id,
              c.title AS conversation_title,
              g.name AS garden_name,
              g.slug AS garden_slug,
              COUNT(*) AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN clusters g
         ON g.id = c.default_garden_id AND g.user_id = c.user_id
       WHERE c.user_id = ?
         AND m.role = 'user'
         AND date(m.created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY day, c.id, c.title, g.name, g.slug
       ORDER BY day, n DESC, c.title, c.id`,
    )
    .all(userId, firstDate, today) as Array<{
    day: string;
    conversation_id: number;
    conversation_title: string;
    garden_name: string | null;
    garden_slug: string | null;
    n: number;
  }>;

  const byDay = new Map<string, ActivityConversation[]>();
  for (const row of rows) {
    const conversations = byDay.get(row.day) ?? [];
    conversations.push({
      id: Number(row.conversation_id),
      title: row.conversation_title?.trim() || "Untitled conversation",
      prompts: Number(row.n),
      garden:
        row.garden_name && row.garden_slug
          ? { name: row.garden_name, slug: row.garden_slug }
          : null,
    });
    byDay.set(row.day, conversations);
  }

  return days.map((day) => ({
    ...day,
    conversations: byDay.get(day.date) ?? [],
  }));
}

function readStreaks(
  dayRows: Array<{ day: string; n: number }>,
  today: string,
): ProfileStreaks {
  if (dayRows.length === 0) {
    return {
      daysActive: 0,
      currentStreak: 0,
      longestStreak: 0,
      busiestDay: null,
      firstActiveDay: null,
    };
  }

  let longest = 1;
  let running = 1;
  for (let index = 1; index < dayRows.length; index += 1) {
    const gap = daysBetween(dayRows[index - 1].day, dayRows[index].day);
    running = gap === 1 ? running + 1 : 1;
    if (running > longest) longest = running;
  }

  // A streak that ended yesterday is still alive — today is not over yet.
  const lastDay = dayRows[dayRows.length - 1].day;
  const sinceLast = daysBetween(lastDay, today);
  let current = 0;
  if (sinceLast <= 1) {
    current = 1;
    for (let index = dayRows.length - 1; index > 0; index -= 1) {
      if (daysBetween(dayRows[index - 1].day, dayRows[index].day) !== 1) break;
      current += 1;
    }
  }

  const busiest = dayRows.reduce((best, row) => (row.n > best.n ? row : best), dayRows[0]);

  return {
    daysActive: dayRows.length,
    currentStreak: current,
    longestStreak: longest,
    busiestDay: { date: busiest.day, count: Number(busiest.n) },
    firstActiveDay: dayRows[0].day,
  };
}

function readHabit(database: Database.Database, userId: number): ProfileHabit {
  const hours = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);

  const rows = database
    .prepare(
      `SELECT CAST(strftime('%H', m.created_at, 'localtime') AS INTEGER) AS hour,
              CAST(strftime('%w', m.created_at, 'localtime') AS INTEGER) AS weekday,
              COUNT(*) AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
       GROUP BY hour, weekday`,
    )
    .all(userId) as Array<{ hour: number; weekday: number; n: number }>;

  for (const row of rows) {
    const n = Number(row.n);
    if (row.hour >= 0 && row.hour < 24) hours[row.hour] += n;
    // strftime('%w') is Sunday-first; the grid and the calendar are Monday-first.
    if (row.weekday >= 0 && row.weekday < 7) weekdays[(row.weekday + 6) % 7] += n;
  }

  return {
    hours,
    weekdays,
    peakHour: peakIndex(hours),
    peakWeekday: peakIndex(weekdays),
  };
}

function peakIndex(counts: number[]): number | null {
  let best = -1;
  let bestValue = 0;
  counts.forEach((value, index) => {
    if (value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best === -1 ? null : best;
}

function readSurfaceUse(database: Database.Database, userId: number): SurfaceUse[] {
  const rows = database
    .prepare(
      `SELECT m.surface AS surface, COUNT(*) AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
       GROUP BY m.surface`,
    )
    .all(userId) as Array<{ surface: SurfaceUse["surface"]; n: number }>;

  return rows
    .map((row) => ({
      surface: row.surface,
      label: SURFACE_LABELS[row.surface] ?? row.surface,
      count: Number(row.n),
    }))
    .sort((a, b) => b.count - a.count);
}

function readGardenUse(database: Database.Database, userId: number): GardenUse[] {
  const rows = database
    .prepare(
      `SELECT g.slug AS slug, g.name AS name, COUNT(m.id) AS n, MAX(m.created_at) AS last_at
       FROM clusters g
       JOIN conversations c ON c.default_garden_id = g.id
       JOIN conversation_messages m ON m.conversation_id = c.id AND m.role = 'user'
       WHERE g.user_id = ?
       GROUP BY g.id
       ORDER BY n DESC, last_at DESC
       LIMIT 6`,
    )
    .all(userId) as Array<{ slug: string; name: string; n: number; last_at: string | null }>;

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    prompts: Number(row.n),
    lastPromptAt: row.last_at,
  }));
}

function readArtifactKinds(database: Database.Database, userId: number): ArtifactKindUse[] {
  const rows = database
    .prepare(
      `SELECT kind, COUNT(*) AS n
       FROM hermes_artifacts
       WHERE user_id = ? AND status <> 'archived'
       GROUP BY kind
       ORDER BY n DESC, kind`,
    )
    .all(userId) as Array<{ kind: string; n: number }>;

  return rows.map((row) => ({
    kind: row.kind,
    label: artifactKindLabel(row.kind),
    count: Number(row.n),
  }));
}

/**
 * Agent runs, counted by run rather than by message.
 *
 * A run leaves its mark on two messages — the prompt that started it (still
 * `running`) and the reply that carries the result — so counting rows would
 * double every finished run. Grouping by run id also means an outcome that was
 * written late still lands on the run it belongs to.
 */
function readAgentUse(database: Database.Database, userId: number): AgentUse[] {
  const rows = database
    .prepare(
      `SELECT json_extract(m.metadata, '$.externalAgentRun.kind') AS kind,
              json_extract(m.metadata, '$.externalAgentRun.runId') AS run_id,
              json_extract(m.metadata, '$.externalAgentOutcome') AS outcome
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?
         AND json_extract(m.metadata, '$.externalAgentRun.kind') IS NOT NULL`,
    )
    .all(userId) as Array<{ kind: string; run_id: string | null; outcome: string | null }>;

  const runs = new Map<string, { kind: string; outcome: string | null }>();
  for (const row of rows) {
    // A run with no id cannot be deduplicated against anything, so it counts once.
    const key = row.run_id ? `${row.kind}:${row.run_id}` : `${row.kind}:row-${runs.size}`;
    const existing = runs.get(key);
    // "running" is what the prompt records; a terminal outcome always wins.
    if (existing && (existing.outcome ?? "running") !== "running") continue;
    runs.set(key, { kind: row.kind, outcome: row.outcome });
  }

  const byKind = new Map<string, AgentUse>();
  for (const run of runs.values()) {
    const entry = byKind.get(run.kind) ?? {
      kind: run.kind,
      label: agentLabel(run.kind),
      runs: 0,
      completed: 0,
      failed: 0,
    };
    entry.runs += 1;
    if (run.outcome === "completed") entry.completed += 1;
    if (run.outcome === "failed" || run.outcome === "aborted") entry.failed += 1;
    byKind.set(run.kind, entry);
  }

  return [...byKind.values()].sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
}

/**
 * Duration of a reply, wherever the surface happened to record it.
 *
 * The runtime path folds it into `token_usage`; the provider-only path writes
 * it to `metadata`. Reading only one halves the sample for no reason.
 */
const REPLY_DURATION_MS = `COALESCE(
  json_extract(m.token_usage, '$.responseDurationMs'),
  json_extract(m.metadata, '$.responseDurationMs')
)`;

/**
 * A short-lived migration wrote a second `legacy-*` copy of some already
 * canonical assistant messages. The copies carry the exact same usage receipt
 * and can be several minutes apart, so summing rows inflated both tokens and
 * money. A canonical sibling wins; when only migrated copies exist, their first
 * copy wins. Two ordinary replies that happen to use the same number of tokens
 * remain two replies.
 */
const UNIQUE_REPORTED_USAGE = `NOT (
  m.role = 'assistant'
  AND COALESCE(json_extract(m.token_usage, '$.totalTokens'), 0) > 0
  AND (
    m.client_message_id LIKE 'legacy-%'
    OR COALESCE(json_extract(m.metadata, '$.migrated'), 0) = 1
  )
  AND EXISTS (
    SELECT 1
    FROM conversation_messages sibling
    WHERE sibling.conversation_id = m.conversation_id
      AND sibling.id <> m.id
      AND sibling.role = 'assistant'
      AND sibling.status <> 'pending'
      AND (
        (
          sibling.client_message_id NOT LIKE 'legacy-%'
          AND COALESCE(json_extract(sibling.metadata, '$.migrated'), 0) <> 1
        )
        OR (
          sibling.id < m.id
          AND (
            sibling.client_message_id LIKE 'legacy-%'
            OR COALESCE(json_extract(sibling.metadata, '$.migrated'), 0) = 1
          )
        )
      )
      AND ABS((julianday(sibling.created_at) - julianday(m.created_at)) * 86400) <= 600
      AND COALESCE(json_extract(sibling.token_usage, '$.inputTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.inputTokens'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.outputTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.outputTokens'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.totalTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.totalTokens'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.cachedInputTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.cachedInputTokens'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.reasoningTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.reasoningTokens'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.apiCalls'), 0)
          = COALESCE(json_extract(m.token_usage, '$.apiCalls'), 0)
      AND COALESCE(json_extract(sibling.token_usage, '$.contextUsedTokens'), 0)
          = COALESCE(json_extract(m.token_usage, '$.contextUsedTokens'), 0)
  )
)`;

const REPORTED_OUTPUT_TOKENS = `MAX(
  COALESCE(json_extract(m.token_usage, '$.outputTokens'), 0),
  0
)`;

// When an older receipt only has `totalTokens`, treat the unexplained balance
// as input. This lets every reported token participate in the estimate.
const REPORTED_INPUT_TOKENS = `MAX(
  COALESCE(json_extract(m.token_usage, '$.inputTokens'), 0),
  COALESCE(json_extract(m.token_usage, '$.totalTokens'), 0) - ${REPORTED_OUTPUT_TOKENS},
  0
)`;

const REPORTED_TOTAL_TOKENS = `MAX(
  COALESCE(json_extract(m.token_usage, '$.totalTokens'), 0),
  ${REPORTED_INPUT_TOKENS} + ${REPORTED_OUTPUT_TOKENS}
)`;

/**
 * Which models answered you, and what that came to in money.
 *
 * Every reported token participates. A recorded model uses its published rate;
 * an unrated or missing model uses the user's background-model rate, falling
 * back once more to Breadboard's product default when that model is local or
 * otherwise unrated.
 */
function readCost(database: Database.Database, userId: number): ProfileCost {
  let configuredFallback = DEFAULT_MODEL;
  try {
    const row = database
      .prepare("SELECT default_model FROM hermes_user_settings WHERE user_id = ?")
      .get(userId) as { default_model: string | null } | undefined;
    configuredFallback = row?.default_model?.trim() || DEFAULT_MODEL;
  } catch {
    // Older/test databases can predate per-user Hermes settings.
  }
  const fallbackModel =
    priceUsd(configuredFallback, { inputTokens: 0, outputTokens: 0 }) === null
      ? DEFAULT_MODEL
      : configuredFallback;

  const rows = database
    .prepare(
      `WITH message_usage AS (
         SELECT COALESCE(
                  (
                    SELECT COALESCE(
                             json_extract(r.dispatch_json, '$.modelIdentity.modelID'),
                             NULLIF(json_extract(r.dispatch_json, '$.model.modelID'), 'default')
                           )
                    FROM hermes_runs r
                    JOIN hermes_runtime_sessions s ON s.id = r.runtime_session_id
                    WHERE s.conversation_id = m.conversation_id
                      AND json_extract(r.dispatch_json, '$.clientMessageId') = m.client_message_id
                      AND COALESCE(
                            json_extract(r.dispatch_json, '$.modelIdentity.modelID'),
                            NULLIF(json_extract(r.dispatch_json, '$.model.modelID'), 'default')
                          ) IS NOT NULL
                    ORDER BY r.started_at DESC, r.id DESC
                    LIMIT 1
                  ),
                  NULLIF(json_extract(m.metadata, '$.model'), 'default'),
                  json_extract(m.metadata, '$.model'),
                  NULLIF(json_extract(m.token_usage, '$.model'), 'default'),
                  json_extract(m.token_usage, '$.model')
                ) AS model,
                m.status,
                ${REPORTED_INPUT_TOKENS} AS input_tokens,
                ${REPORTED_OUTPUT_TOKENS} AS output_tokens,
                ${REPORTED_TOTAL_TOKENS} AS total_tokens
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.role = 'assistant'
           AND m.status <> 'pending'
           AND ${UNIQUE_REPORTED_USAGE}
       )
       SELECT model,
              COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN status <> 'complete' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM message_usage
       GROUP BY model`,
    )
    .all(userId) as Array<{
    model: string | null;
    n: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;

  const models: ModelUse[] = [];
  let totalUsd = 0;
  let pricedReplies = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedReplies = 0;
  let estimatedTokens = 0;

  for (const row of rows) {
    const model = row.model?.trim();
    const replies = Number(row.n);
    const rowInputTokens = Number(row.input_tokens);
    const rowOutputTokens = Number(row.output_tokens);
    const rowTotalTokens = Number(row.total_tokens);
    const recordedPrice = model
      ? priceUsd(model, {
          inputTokens: rowInputTokens,
          outputTokens: rowOutputTokens,
        })
      : null;
    const estimated = recordedPrice === null;
    const costUsd =
      recordedPrice ??
      priceUsd(fallbackModel, {
        inputTokens: rowInputTokens,
        outputTokens: rowOutputTokens,
      }) ??
      0;

    pricedReplies += replies;
    totalTokens += rowTotalTokens;
    inputTokens += rowInputTokens;
    outputTokens += rowOutputTokens;
    totalUsd += costUsd;
    if (estimated) {
      estimatedReplies += replies;
      estimatedTokens += rowTotalTokens;
    }
    if (!model) continue;

    models.push({
      model,
      label: formatAssistantModelName(model),
      vendorLabel: assistantModelVendor(model).label,
      replies,
      tokens: rowTotalTokens,
      inputTokens: rowInputTokens,
      outputTokens: rowOutputTokens,
      failed: Number(row.failed),
      costUsd,
      estimated,
    });
  }

  models.sort((a, b) => b.replies - a.replies || a.label.localeCompare(b.label));

  // Reading the runtime's savings file must never take the profile page down
  // with it -- the page is about the database, and this is a guest.
  let compression = EMPTY_COMPRESSION_SAVINGS;
  try {
    compression = readCompressionSavings();
  } catch {
    compression = EMPTY_COMPRESSION_SAVINGS;
  }

  return {
    models,
    totalUsd,
    totalTokens,
    inputTokens,
    outputTokens,
    pricedReplies,
    estimatedReplies,
    estimatedTokens,
    fallbackModel,
    compression,
  };
}

/**
 * How often the assistant failed to answer at all.
 *
 * Every other panel on the page counts successes. This one exists because a
 * tool that breaks is a fact about the tool, and nothing else on the profile
 * would ever say so.
 */
function readReliability(
  database: Database.Database,
  userId: number,
  agents: AgentUse[],
): ProfileReliability {
  const outcome = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN m.status = 'complete' THEN 1 ELSE 0 END), 0) AS completed,
         COALESCE(SUM(CASE WHEN m.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN m.status = 'aborted' THEN 1 ELSE 0 END), 0) AS aborted,
         MAX(CASE WHEN m.status IN ('failed','aborted') THEN m.created_at END) AS last_failure_at
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.status <> 'pending'`,
    )
    .get(userId) as {
    completed: number;
    failed: number;
    aborted: number;
    last_failure_at: string | null;
  };

  const errorRows = database
    .prepare(
      `SELECT json_extract(m.metadata, '$.error') AS error, COUNT(*) AS n
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant'
         AND m.status IN ('failed','aborted')
         AND json_extract(m.metadata, '$.error') IS NOT NULL
       GROUP BY error
       ORDER BY n DESC, error
       LIMIT 4`,
    )
    .all(userId) as Array<{ error: string; n: number }>;

  const completed = Number(outcome.completed);
  const failed = Number(outcome.failed);
  const aborted = Number(outcome.aborted);
  const worstAgent = agents.reduce<AgentUse | null>(
    (worst, agent) =>
      agent.failed > 0 && (!worst || agent.failed > worst.failed) ? agent : worst,
    null,
  );

  return {
    terminalReplies: completed + failed + aborted,
    completed,
    failed,
    aborted,
    topErrors: errorRows.map((row) => ({ error: row.error, count: Number(row.n) })),
    worstAgent,
    lastFailureAt: outcome.last_failure_at,
  };
}

/**
 * The shape of the wait, not just its sum.
 *
 * A mean would be dominated by a handful of hour-long agent runs. The median
 * says what a normal reply feels like and the slowest says what the worst one
 * cost, which are the two numbers anyone actually wants.
 */
function readLatency(database: Database.Database, userId: number): ProfileLatency {
  const rows = database
    .prepare(
      `SELECT ${REPLY_DURATION_MS} AS ms
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.status = 'complete'
         AND ${REPLY_DURATION_MS} IS NOT NULL
       ORDER BY ms`,
    )
    .all(userId) as Array<{ ms: number }>;

  const durations = rows
    .map((row) => Number(row.ms))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);

  if (durations.length === 0) {
    return { measured: 0, medianMs: 0, p90Ms: 0, slowestMs: 0, fastestMs: 0 };
  }

  const at = (fraction: number) =>
    durations[Math.min(durations.length - 1, Math.floor(fraction * durations.length))];

  return {
    measured: durations.length,
    medianMs: at(0.5),
    p90Ms: at(0.9),
    slowestMs: durations[durations.length - 1],
    fastestMs: durations[0],
  };
}

/** What the assistant remembers about you, broken out by what kind of thing it is. */
function readMemory(database: Database.Database, userId: number): ProfileMemory {
  const kindRows = database
    .prepare(
      `SELECT kind, COUNT(*) AS n
       FROM durable_memories
       WHERE user_id = ? AND state <> 'superseded'
       GROUP BY kind
       ORDER BY n DESC, kind`,
    )
    .all(userId) as Array<{ kind: string; n: number }>;

  const stateRow = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN state = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate,
         COALESCE(SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
         COALESCE(SUM(CASE WHEN state = 'superseded' THEN 1 ELSE 0 END), 0) AS superseded
       FROM durable_memories
       WHERE user_id = ?`,
    )
    .get(userId) as { candidate: number; confirmed: number; superseded: number };

  return {
    kinds: kindRows.map((row) => ({
      kind: row.kind,
      label: MEMORY_KIND_LABELS[row.kind] ?? titleCase(row.kind),
      count: Number(row.n),
    })),
    candidate: Number(stateRow.candidate),
    confirmed: Number(stateRow.confirmed),
    superseded: Number(stateRow.superseded),
  };
}

// -------------------------------------------------------------- phrases

const PHRASE_RESULT_LIMIT = 8;
const MIN_PHRASE_PROMPTS = 2;
const PHRASE_WORDS = [2, 3] as const;

/**
 * Function words make useful sentences but poor profile statistics on their
 * own. A candidate may contain them, but needs at least one more distinctive
 * word before it can become a phrase in the widget.
 */
const PHRASE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "she",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
  "yours",
]);

interface PhraseCandidate extends PhraseUse {
  words: string[];
}

function phraseTokens(content: string): string[][] {
  // Pasted code and links tend to swamp a person's actual turns with repeated
  // syntax. Strip those before splitting on sentence boundaries so a phrase
  // never crosses from one thought into the next.
  const prose = content
    .normalize("NFKC")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .toLocaleLowerCase();

  return prose
    .split(/[\n\r.!?…;:]+/u)
    .map((segment) => segment.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [])
    .filter((words) => words.length >= PHRASE_WORDS[0]);
}

function containsWordSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/**
 * Repeated two- and three-word runs from the user's own prompts.
 *
 * A phrase counts at most once per prompt. This keeps one pasted paragraph or
 * accidental repetition from impersonating a habit. Overlapping candidates
 * are collapsed so the card does not become a ladder of the same sentence.
 */
function readPhrases(database: Database.Database, userId: number): ProfilePhrases {
  const rows = database
    .prepare(
      `SELECT m.content
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?
         AND c.temporary = 0
         AND m.role = 'user'
         AND m.status = 'complete'
         AND trim(m.content) <> ''
       ORDER BY m.id DESC
       LIMIT ?`,
    )
    .all(userId, PROFILE_PHRASE_PROMPT_LIMIT + 1) as Array<{ content: string }>;

  const truncated = rows.length > PROFILE_PHRASE_PROMPT_LIMIT;
  const sampled = rows.slice(0, PROFILE_PHRASE_PROMPT_LIMIT);
  const counts = new Map<string, number>();

  for (const row of sampled) {
    const inPrompt = new Set<string>();
    for (const words of phraseTokens(row.content)) {
      for (const width of PHRASE_WORDS) {
        for (let start = 0; start <= words.length - width; start += 1) {
          const candidateWords = words.slice(start, start + width);
          const distinctive = candidateWords.some(
            (word) => !PHRASE_STOP_WORDS.has(word) && !/^\d+$/u.test(word),
          );
          if (!distinctive) continue;

          const phrase = candidateWords.join(" ");
          if (phrase.length <= 80) inPrompt.add(phrase);
        }
      }
    }
    for (const phrase of inPrompt) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= MIN_PHRASE_PROMPTS)
    .map<PhraseCandidate>(([phrase, count]) => ({ phrase, count, words: phrase.split(" ") }))
    .sort((a, b) => {
      const scoreA = a.count * (a.words.length === 3 ? 1.2 : 1);
      const scoreB = b.count * (b.words.length === 3 ? 1.2 : 1);
      return (
        scoreB - scoreA ||
        b.count - a.count ||
        b.words.length - a.words.length ||
        a.phrase.localeCompare(b.phrase)
      );
    });

  const selected: PhraseCandidate[] = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(
      (existing) =>
        containsWordSequence(existing.words, candidate.words) ||
        containsWordSequence(candidate.words, existing.words),
    );
    if (!overlaps) selected.push(candidate);
    if (selected.length === PHRASE_RESULT_LIMIT) break;
  }

  return {
    items: selected
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.words.length - a.words.length ||
          a.phrase.localeCompare(b.phrase),
      )
      .map(({ phrase, count }) => ({ phrase, count })),
    analyzedPrompts: sampled.length,
    truncated,
  };
}

/** SQLite writes `2026-06-01 08:00:00`; comparing needs the ISO separator. */
function sortableStamp(value: string): string {
  return value.replace(" ", "T");
}

function truncate(value: string, limit: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * The last few things Breadboard did on your behalf, from every table that
 * records one.
 *
 * Each of these already has a home — a run card, the artifact library, the
 * memory settings, the prompts tab — and none of them can answer "what has
 * this thing been doing lately", because that question crosses all four. Every
 * source is capped on its own so one busy week of artifacts cannot crowd the
 * others out of the merge.
 */
function readAuditFeed(database: Database.Database, userId: number): AuditEntry[] {
  const entries: AuditEntry[] = [];

  const runs = database
    .prepare(
      `SELECT m.created_at AS at,
              json_extract(m.metadata, '$.externalAgentRun.kind') AS kind,
              json_extract(m.metadata, '$.externalAgentOutcome') AS outcome,
              c.title AS conversation_title
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?
         AND json_extract(m.metadata, '$.externalAgentRun.kind') IS NOT NULL
         AND json_extract(m.metadata, '$.externalAgentOutcome') IS NOT NULL
         AND json_extract(m.metadata, '$.externalAgentOutcome') <> 'running'
       ORDER BY datetime(m.created_at) DESC
       LIMIT ?`,
    )
    .all(userId, AUDIT_FEED_LIMIT) as Array<{
    at: string;
    kind: string;
    outcome: string;
    conversation_title: string | null;
  }>;
  for (const run of runs) {
    entries.push({
      kind: "agent_run",
      at: run.at,
      title: `${agentLabel(run.kind)} ran`,
      detail: run.conversation_title ? truncate(run.conversation_title, 60) : null,
      href: null,
      status: run.outcome === "completed" ? "ok" : "failed",
    });
  }

  const artifacts = database
    .prepare(
      `SELECT created_at AS at, title, kind, status
       FROM hermes_artifacts
       WHERE user_id = ? AND status <> 'archived'
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .all(userId, AUDIT_FEED_LIMIT) as Array<{
    at: string;
    title: string;
    kind: string;
    status: string;
  }>;
  for (const artifact of artifacts) {
    entries.push({
      kind: "artifact",
      at: artifact.at,
      title: truncate(artifact.title || "Untitled artifact", 60),
      detail: artifactKindLabel(artifact.kind),
      href: "/artifacts",
      status:
        artifact.status === "failed"
          ? "failed"
          : artifact.status === "ready"
            ? "ok"
            : "pending",
    });
  }

  const memories = database
    .prepare(
      `SELECT created_at AS at, content, kind, state
       FROM durable_memories
       WHERE user_id = ? AND state <> 'superseded'
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .all(userId, AUDIT_FEED_LIMIT) as Array<{
    at: string;
    content: string;
    kind: string;
    state: string;
  }>;
  for (const memory of memories) {
    entries.push({
      kind: "memory",
      at: memory.at,
      title: truncate(memory.content, 70),
      detail: MEMORY_KIND_LABELS[memory.kind] ?? titleCase(memory.kind),
      href: null,
      status: memory.state === "confirmed" ? "ok" : "pending",
    });
  }

  const scheduled = database
    .prepare(
      `SELECT last_run_at AS at, title, last_status
       FROM scheduled_chat_jobs
       WHERE user_id = ? AND last_run_at IS NOT NULL
       ORDER BY datetime(last_run_at) DESC
       LIMIT ?`,
    )
    .all(userId, AUDIT_FEED_LIMIT) as Array<{
    at: string;
    title: string;
    last_status: string | null;
  }>;
  for (const job of scheduled) {
    entries.push({
      kind: "scheduled_chat",
      at: job.at,
      title: truncate(job.title || "Scheduled chat", 60),
      detail: "Ran on schedule",
      href: null,
      status: job.last_status === "failed" ? "failed" : "ok",
    });
  }

  return entries
    .sort((a, b) => sortableStamp(b.at).localeCompare(sortableStamp(a.at)))
    .slice(0, AUDIT_FEED_LIMIT);
}

function readInvites(database: Database.Database, userId: number): InviteTotals {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS created,
              COALESCE(SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS redeemed
       FROM invite_codes
       WHERE created_by_user_id = ?`,
    )
    .get(userId) as { created: number; redeemed: number };

  const created = Number(row.created);
  const redeemed = Number(row.redeemed);
  return { created, redeemed, open: created - redeemed };
}

function readFirstConversation(
  database: Database.Database,
  userId: number,
): { title: string; createdAt: string } | null {
  const row = database
    .prepare(
      `SELECT title, created_at
       FROM conversations
       WHERE user_id = ? AND temporary = 0
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT 1`,
    )
    .get(userId) as { title: string; created_at: string } | undefined;

  return row ? { title: row.title, createdAt: row.created_at } : null;
}
