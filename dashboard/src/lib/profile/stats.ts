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

import { assistantModelVendor, formatAssistantModelName } from "../ai-models.ts";
import {
  addDays,
  dateOf,
  daysBetween,
  startOfDay,
  startOfWeek,
  todayDate,
} from "../calendar/wallclock.ts";
import { priceUsd } from "./model-pricing.ts";

/** How many weeks the activity grid covers by default. */
export const DEFAULT_ACTIVITY_WEEKS = 26;

export interface ProfileAccount {
  username: string;
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
  /** USD for this model's measured replies, or null when it has no rate. */
  costUsd: number | null;
}

export interface ProfileCost {
  models: ModelUse[];
  /** Summed across the models that have a rate. Never a guess for the rest. */
  totalUsd: number;
  pricedReplies: number;
  /** Replies on a model nobody has priced — the caveat on the total above. */
  unpricedReplies: number;
  /** Replies whose model was never recorded, which predate this bookkeeping. */
  unattributedReplies: number;
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
  if (!user) throw new Error(`No such user: ${userId}`);

  const joinedDate = normalizeDate(user.created_at);

  // ------------------------------------------------------------------ totals

  const usage = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0) AS prompts,
         COALESCE(SUM(CASE WHEN m.role = 'assistant' AND m.status = 'complete' THEN 1 ELSE 0 END), 0) AS replies,
         COALESCE(SUM(json_extract(m.token_usage, '$.totalTokens')), 0) AS tokens,
         COALESCE(SUM(${REPLY_DURATION_MS}), 0) AS thinking_ms,
         COALESCE(SUM(CASE WHEN m.token_usage IS NOT NULL THEN 1 ELSE 0 END), 0) AS measured
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ?`,
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
      email: user.email,
      joinedAt: user.created_at,
      daysSinceJoined: Math.max(0, daysBetween(joinedDate, today)),
    },
    totals,
    activity,
    activityWeeks: weeks,
    habit: readHabit(database, userId),
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
 * Which models answered you, and what that came to in money.
 *
 * Cost is deliberately partial. A model with no published rate is counted and
 * named rather than priced at zero, and replies from before the model was
 * recorded at all are kept in their own bucket — a total that quietly absorbed
 * either would be worse than one that admits its own edges.
 */
function readCost(database: Database.Database, userId: number): ProfileCost {
  const rows = database
    .prepare(
      `SELECT json_extract(m.metadata, '$.model') AS model,
              COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN m.status <> 'complete' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(json_extract(m.token_usage, '$.inputTokens')), 0) AS input_tokens,
              COALESCE(SUM(json_extract(m.token_usage, '$.outputTokens')), 0) AS output_tokens,
              COALESCE(SUM(json_extract(m.token_usage, '$.totalTokens')), 0) AS total_tokens
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'assistant' AND m.status <> 'pending'
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
  let unpricedReplies = 0;
  let unattributedReplies = 0;

  for (const row of rows) {
    const model = row.model?.trim();
    const replies = Number(row.n);
    if (!model) {
      unattributedReplies += replies;
      continue;
    }
    const inputTokens = Number(row.input_tokens);
    const outputTokens = Number(row.output_tokens);
    const costUsd = priceUsd(model, { inputTokens, outputTokens });
    if (costUsd === null) {
      unpricedReplies += replies;
    } else {
      pricedReplies += replies;
      totalUsd += costUsd;
    }
    models.push({
      model,
      label: formatAssistantModelName(model),
      vendorLabel: assistantModelVendor(model).label,
      replies,
      tokens: Number(row.total_tokens),
      inputTokens,
      outputTokens,
      failed: Number(row.failed),
      costUsd,
    });
  }

  models.sort((a, b) => b.replies - a.replies || a.label.localeCompare(b.label));
  return { models, totalUsd, pricedReplies, unpricedReplies, unattributedReplies };
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
