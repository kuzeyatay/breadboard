export const EXTERNAL_AGENT_RUN_KINDS = [
  "agent_tars",
  "agent_browser",
  "agent_reach",
  "career_ops",
  "trading_agents",
  "vibe_trading",
  "stock_analyst",
  "paper_trader",
  "deer_flow",
  "deep_research",
  "max_research",
  "get_doc",
  "meeting_notes",
  "deep_tutor",
  "openplanter",
  "openwork",
  "openscience",
  "inbox_zero",
  "codex",
  "opencode",
  "ruflo",
  "socials_manager",
  "hardware_blueprint",
  "parametric_cad",
  "hyperframes",
  "resource2skill",
  "openmontage",
  "vimax",
  "vox_director",
  "shorts",
  "formsmith",
  "money_printer",
  "video_use",
  "legal_agent",
  "wardrobe",
  "matraix",
] as const;

export type ExternalAgentRunKind = (typeof EXTERNAL_AGENT_RUN_KINDS)[number];
export type ExternalAgentOutcome = "running" | "completed" | "failed" | "aborted";
export type ExternalAgentTerminalOutcome = Exclude<ExternalAgentOutcome, "running">;

const EXTERNAL_AGENT_DISPLAY_NAME_BY_KIND = {
  agent_tars: "Agent TARS",
  agent_browser: "Agent Browser",
  agent_reach: "Agent Reach",
  career_ops: "Career Ops",
  trading_agents: "TradingAgents",
  vibe_trading: "Vibe Trading",
  stock_analyst: "Stock Analyst",
  paper_trader: "Paper Trader",
  deer_flow: "DeerFlow",
  deep_research: "Deep Research",
  max_research: "Max Research",
  get_doc: "Get Doc",
  meeting_notes: "Meeting Notes",
  deep_tutor: "DeepTutor",
  openplanter: "OpenPlanter",
  openwork: "OpenWork",
  openscience: "OpenScience",
  inbox_zero: "Inbox Zero",
  codex: "Codex",
  opencode: "OpenCode",
  ruflo: "Ruflo",
  socials_manager: "Socials Manager",
  hardware_blueprint: "Hardware Blueprint",
  parametric_cad: "Parametric CAD",
  hyperframes: "Hyperframes",
  resource2skill: "Resource2Skill",
  openmontage: "OpenMontage",
  vimax: "ViMax",
  vox_director: "Vox Director",
  shorts: "Shorts",
  formsmith: "Formsmith",
  money_printer: "MoneyPrinter",
  video_use: "Video Use",
  legal_agent: "Legal Agent",
  wardrobe: "Wardrobe",
  matraix: "MatrAIx",
} as const satisfies Record<ExternalAgentRunKind, string>;

export function externalAgentDisplayName(kind: ExternalAgentRunKind): string {
  return EXTERNAL_AGENT_DISPLAY_NAME_BY_KIND[kind];
}

/**
 * The API segment each agent's runs live under. Mostly the agent's own name,
 * but three agents are named after the thing they produce rather than the stack
 * that produces it: Formsmith runs on shaper, Parametric CAD on cad, and Agent
 * TARS on ui-tars.
 */
const EXTERNAL_AGENT_API_SLUG_BY_KIND = {
  agent_tars: "ui-tars",
  agent_browser: "agent-browser",
  agent_reach: "agent-reach",
  career_ops: "career-ops",
  trading_agents: "tradingagents",
  vibe_trading: "vibe-trading",
  stock_analyst: "stock-analyst",
  paper_trader: "paper-trader",
  deer_flow: "deer-flow",
  deep_research: "deep-research",
  max_research: "max-research",
  get_doc: "get-doc",
  meeting_notes: "meeting-notes",
  deep_tutor: "deep-tutor",
  openplanter: "openplanter",
  openwork: "openwork",
  openscience: "openscience",
  inbox_zero: "inbox-zero",
  codex: "codex",
  opencode: "opencode",
  ruflo: "ruflo",
  socials_manager: "socials-manager",
  hardware_blueprint: "hardware-blueprint",
  parametric_cad: "cad",
  hyperframes: "hyperframes",
  resource2skill: "resource2skill",
  openmontage: "openmontage",
  vimax: "vimax",
  vox_director: "vox-director",
  shorts: "shorts",
  formsmith: "shaper",
  money_printer: "money-printer",
  video_use: "video-use",
  legal_agent: "legal",
  wardrobe: "wardrobe",
  matraix: "matraix",
} as const satisfies Record<ExternalAgentRunKind, string>;

/**
 * Where a run of this kind is stopped. Every agent answers the same shape —
 * `/api/<slug>/runs/<runId>/abort` — except the two browser operators, whose
 * runs are addressed under the agent that owns the browser.
 */
export function externalAgentAbortUrl(
  kind: ExternalAgentRunKind,
  runId: string,
  agentId?: string,
): string | null {
  const slug = EXTERNAL_AGENT_API_SLUG_BY_KIND[kind];
  if (!slug || !runId) return null;
  if (kind === "agent_tars" || kind === "agent_browser") {
    return agentId
      ? `/api/${slug}/agents/${agentId}/runs/${runId}/abort`
      : null;
  }
  return `/api/${slug}/runs/${runId}/abort`;
}

/**
 * Content consumed by an inline run observer. New delegated turns keep this in
 * metadata; the fallback repairs rows written by the older card-takeover model,
 * where the worker result replaced `content` and the Super Agent text survived
 * only as `delegatedAgentPreamble`.
 */
export function externalAgentCardContent(message: {
  content: string;
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  externalAgentResult?: string;
}): string {
  if (message.delegatedAgentRun !== true) return message.content;
  if (message.externalAgentResult !== undefined) return message.externalAgentResult;
  if (
    message.delegatedAgentPreamble?.trim() &&
    message.content !== message.delegatedAgentPreamble
  ) {
    return message.content;
  }
  return "";
}

/**
 * Keep the Super Agent's text as the presented message, including for rows
 * saved by the former card-takeover implementation. The inferred result lets a
 * refreshed hidden observer and continuation finish migrating that old row.
 */
export function delegatedAgentPresentation<T extends {
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  externalAgentResult?: string;
}>(content: string, fields: T): T & { content: string; externalAgentResult?: string } {
  if (fields.delegatedAgentRun !== true) return { ...fields, content };
  const visibleContent = fields.delegatedAgentPreamble ?? content;
  const externalAgentResult =
    fields.externalAgentResult ??
    (fields.delegatedAgentPreamble && content !== fields.delegatedAgentPreamble
      ? content
      : undefined);
  return {
    ...fields,
    content: visibleContent,
    ...(externalAgentResult !== undefined ? { externalAgentResult } : {}),
  };
}

export interface ExternalAgentTerminalResult {
  outcome: ExternalAgentTerminalOutcome;
  content: string;
  usage?: ChatTokenUsage;
  activity?: ExternalAgentActivityEntry[];
  edits?: ExternalAgentEdits;
  /**
   * Bounded, JSON-safe presentation state for cards whose useful result is
   * richer than their saved prose. The artifact remains the source of truth;
   * this only lets a refreshed transcript render the same finished card.
   */
  state?: Record<string, unknown>;
}

const MAX_EXTERNAL_AGENT_STATE_CHARS = 100_000;

export function parseExternalAgentState(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_EXTERNAL_AGENT_STATE_CHARS) return null;
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The two working-tree snapshots that bracket a coding agent's run. Kept with
 * the turn so its edits stay reviewable and undoable for as long as the message
 * exists — the file list and diffs are always recomputed from these.
 */
export interface ExternalAgentEdits {
  before: string;
  after: string;
}

const SNAPSHOT_ID = /^[0-9a-f]{40}$/;

export function parseExternalAgentEdits(value: unknown): ExternalAgentEdits | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const before = candidate.before;
  const after = candidate.after;
  if (typeof before !== "string" || !SNAPSHOT_ID.test(before)) return null;
  if (typeof after !== "string" || !SNAPSHOT_ID.test(after)) return null;
  return { before, after };
}

/**
 * One step of what an agent did — a thought or a tool call. Stored with the
 * finished turn so the work survives a reload: the run manager keeps events in
 * memory only, and they are gone the moment the process restarts.
 */
export type ExternalAgentActivityEntry =
  | { key: number; kind: "reasoning"; text: string }
  | {
      key: number;
      kind: "tool";
      tool: string;
      status: string;
      title: string;
      summary: string;
    };

const MAX_ACTIVITY_ENTRIES = 60;
const MAX_ACTIVITY_TEXT = 1_200;
const MAX_ACTIVITY_LABEL = 300;

function activityText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

/** Validate stored activity so one bad row cannot break a transcript. */
export function parseExternalAgentActivity(
  value: unknown,
): ExternalAgentActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ExternalAgentActivityEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const key = Number(candidate.key);
    if (!Number.isFinite(key)) continue;
    if (candidate.kind === "reasoning") {
      const text = activityText(candidate.text, MAX_ACTIVITY_TEXT);
      if (text) entries.push({ key, kind: "reasoning", text });
      continue;
    }
    if (candidate.kind !== "tool") continue;
    entries.push({
      key,
      kind: "tool",
      tool: activityText(candidate.tool, MAX_ACTIVITY_LABEL) || "tool",
      status: activityText(candidate.status, MAX_ACTIVITY_LABEL) || "completed",
      title: activityText(candidate.title, MAX_ACTIVITY_LABEL),
      summary: activityText(candidate.summary, MAX_ACTIVITY_TEXT),
    });
  }
  return entries
    .sort((left, right) => left.key - right.key)
    .slice(-MAX_ACTIVITY_ENTRIES);
}

/** Build the stored timeline from a run manager's in-memory event log. */
export function externalAgentActivityFromRunEvents(
  events: readonly { sequenceNumber: number; type: string; payload: Record<string, unknown> }[],
): ExternalAgentActivityEntry[] {
  const entries: unknown[] = [];
  for (const event of events) {
    if (event.type === "reasoning.completed") {
      entries.push({
        key: event.sequenceNumber,
        kind: "reasoning",
        text: event.payload.text,
      });
    }
    if (event.type === "tool.completed") {
      entries.push({
        key: event.sequenceNumber,
        kind: "tool",
        tool: event.payload.tool,
        status: event.payload.status,
        title: event.payload.title,
        summary: event.payload.summary,
      });
    }
  }
  return parseExternalAgentActivity(entries);
}

export type ExternalAgentRun =
  | {
      kind: "agent_tars";
      agentId: string;
      runId: string;
      task: string;
    }
  | {
      kind: "agent_browser";
      agentId: string;
      runId: string;
      task: string;
    }
  | {
      kind: "agent_reach";
      runId: string;
      task: string;
    }
  | {
      kind: "career_ops";
      runId: string;
      task: string;
    }
  | {
      kind: "trading_agents";
      runId: string;
      /** The run's label — "NVDA · 2026-08-04" — not a prompt. */
      task: string;
    }
  | {
      kind: "vibe_trading";
      runId: string;
      /** The research prompt, minus the slash token. */
      task: string;
    }
  | {
      kind: "stock_analyst";
      runId: string;
      /** The question about a stock, minus the slash token. */
      task: string;
    }
  | {
      kind: "paper_trader";
      runId: string;
      /**
       * The instruction to the desk — start, stop or show. Unlike every other
       * agent's, this one is allowed to be a bare command with nothing after it,
       * which is what "start the desk" reads as.
       */
      task: string;
    }
  | {
      kind: "deer_flow";
      runId: string;
      /** The task, minus the slash token. */
      task: string;
    }
  | {
      kind: "max_research";
      runId: string;
      /** The one question the five participants were commissioned against. */
      query: string;
    }
  | {
      kind: "deep_research";
      runId: string;
      query: string;
      output: "report" | "answer";
    }
  | {
      kind: "get_doc";
      runId: string;
      /** What was searched for, minus the slash token. */
      query: string;
    }
  | {
      kind: "meeting_notes";
      runId: string;
      /** What was asked for, minus the slash token. The recording is not named
       * here on purpose: a run resolves it from this conversation, so a
       * descriptor that pinned a blob id would go stale the moment the staged
       * upload was swept. */
      task: string;
    }
  | {
      kind: "deep_tutor";
      runId: string;
      /** What the learner asked, minus the slash token. */
      task: string;
      /** Which of DeepTutor's capabilities ran, e.g. `deep_solve`. */
      capability: string;
    }
  | {
      kind: "openplanter";
      runId: string;
      task: string;
    }
  | {
      kind: "openwork";
      runId: string;
      /** The workspace task, minus the slash token. */
      task: string;
    }
  | {
      kind: "openscience";
      runId: string;
      /** The research goal, minus the slash token. */
      task: string;
    }
  | {
      kind: "inbox_zero";
      runId: string;
      /** The mailbox instruction, minus the slash token. */
      task: string;
    }
  | {
      kind: "socials_manager";
      runId: string;
      /** The drafting brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "hardware_blueprint";
      runId: string;
      /** The hardware brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "parametric_cad";
      runId: string;
      /** The part brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "hyperframes";
      runId: string;
      /** The video brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "resource2skill";
      runId: string;
      /** The artifact brief, including an optional domain flag. */
      brief: string;
    }
  | {
      kind: "openmontage";
      runId: string;
      /** The production brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "vimax";
      runId: string;
      /** The film brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "vox_director";
      runId: string;
      /** The topic the explainer was made from, minus the slash token. */
      brief: string;
    }
  | {
      kind: "shorts";
      runId: string;
      /** The run's label — "youtube.com/… · 3 × 9:16" — not a prompt. */
      task: string;
    }
  | {
      kind: "formsmith";
      runId: string;
      /** The source filename is a label, never a prompt or a filesystem path. */
      task: string;
    }
  | {
      kind: "video_use";
      runId: string;
      /** The run's label — "talk.mp4 — cut the dead air" — not a bare prompt. */
      task: string;
      /**
       * Super Agent was on when this was sent, so the person never chose an
       * agent. Showing them one's card would announce a hand-off they did not
       * make, so the run reports itself as a plain line instead. Recorded on
       * the descriptor rather than read from the toggle at render time: the
       * toggle is a *current* setting, and a turn should not change how it
       * reads because a switch moved afterwards.
       */
      quiet?: boolean;
    }
  | {
      kind: "money_printer";
      runId: string;
      /** The video brief, minus the slash token. */
      brief: string;
    }
  | {
      kind: "legal_agent";
      runId: string;
      /** The assignment's first line — a label, not the whole instruction. */
      task: string;
    }
  | {
      kind: "wardrobe";
      runId: string;
      /**
       * What the import was — "5 photos", or the direction that shaped it. The
       * photographs themselves are the request and they are not repeated here:
       * a transcript holds a label, and the garments end up as artifacts.
       */
      task: string;
    }
  | {
      kind: "matraix";
      runId: string;
      /** The study brief, including any cohort flags typed with it. */
      brief: string;
    }
  | {
      kind: "codex";
      runId: string;
      task: string;
      gardenSlug: string;
      repository: string;
    }
  | {
      kind: "opencode";
      runId: string;
      task: string;
      gardenSlug: string;
      repository: string;
    }
  | {
      kind: "ruflo";
      runId: string;
      task: string;
      gardenSlug: string;
      repository: string;
    };

const MAX_ID_LENGTH = 500;
const MAX_TASK_LENGTH = 100_000;

function boundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): string | null {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = value.trim();
  return normalized || allowEmpty ? normalized : null;
}

/**
 * Validate the durable run descriptor at both API and restore boundaries.
 * Unknown kinds are ignored when reading history, so a bad row cannot break an
 * otherwise healthy transcript.
 */
export function parseExternalAgentRun(value: unknown): ExternalAgentRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const runId = boundedString(candidate.runId, MAX_ID_LENGTH);
  if (!runId) return null;

  if (candidate.kind === "agent_tars" || candidate.kind === "agent_browser") {
    const agentId = boundedString(candidate.agentId, MAX_ID_LENGTH);
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!agentId || !task) return null;
    return {
      kind: candidate.kind,
      agentId,
      runId,
      task,
    };
  }

  if (candidate.kind === "agent_reach") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "agent_reach", runId, task };
  }

  if (candidate.kind === "career_ops") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "career_ops", runId, task };
  }

  if (candidate.kind === "trading_agents") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "trading_agents", runId, task };
  }

  if (candidate.kind === "vibe_trading") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "vibe_trading", runId, task };
  }

  if (candidate.kind === "stock_analyst") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "stock_analyst", runId, task };
  }

  if (candidate.kind === "paper_trader") {
    // No `if (!task) return null` here: a bare `/agents:paper-trader` is the
    // ordinary way to open the desk, and dropping the descriptor would lose the
    // card on reload for the most common instruction there is.
    return {
      kind: "paper_trader",
      runId,
      task: boundedString(candidate.task, MAX_TASK_LENGTH) ?? "",
    };
  }

  if (candidate.kind === "deer_flow") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "deer_flow", runId, task };
  }

  if (candidate.kind === "max_research") {
    const query = boundedString(candidate.query, MAX_TASK_LENGTH);
    if (!query) return null;
    return { kind: "max_research", runId, query };
  }

  if (candidate.kind === "deep_research") {
    const query = boundedString(candidate.query, MAX_TASK_LENGTH);
    if (!query || (candidate.output !== "report" && candidate.output !== "answer")) {
      return null;
    }
    return {
      kind: "deep_research",
      runId,
      query,
      output: candidate.output,
    };
  }

  if (candidate.kind === "get_doc") {
    const query = boundedString(candidate.query, MAX_TASK_LENGTH);
    if (!query) return null;
    return { kind: "get_doc", runId, query };
  }

  if (candidate.kind === "meeting_notes") {
    // An empty task is legitimate here, unlike a search with no query: "/agents:meeting-notes"
    // on its own means "the recording in this chat", which is a complete request.
    const task = boundedString(candidate.task, MAX_TASK_LENGTH, true);
    if (task === null) return null;
    return { kind: "meeting_notes", runId, task };
  }

  if (candidate.kind === "deep_tutor") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    const capability = boundedString(candidate.capability, MAX_ID_LENGTH);
    if (!task || !capability) return null;
    return { kind: "deep_tutor", runId, task, capability };
  }

  if (candidate.kind === "openplanter") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return {
      kind: "openplanter",
      runId,
      task,
    };
  }

  if (candidate.kind === "openwork") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "openwork", runId, task };
  }

  if (candidate.kind === "openscience") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "openscience", runId, task };
  }

  if (candidate.kind === "inbox_zero") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "inbox_zero", runId, task };
  }

  // "postiz" is the kind this agent was persisted under before it was renamed
  // to the Socials Manager. Turns written then are still in the transcript, and
  // a card that stops resolving is a card that vanishes from an old chat.
  if (candidate.kind === "socials_manager" || candidate.kind === "postiz") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "socials_manager", runId, brief };
  }

  if (candidate.kind === "hardware_blueprint") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "hardware_blueprint", runId, brief };
  }

  if (candidate.kind === "parametric_cad") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "parametric_cad", runId, brief };
  }

  if (candidate.kind === "vimax") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "vimax", runId, brief };
  }

  if (candidate.kind === "vox_director") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "vox_director", runId, brief };
  }

  if (candidate.kind === "hyperframes") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "hyperframes", runId, brief };
  }

  if (candidate.kind === "resource2skill") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "resource2skill", runId, brief };
  }

  if (candidate.kind === "openmontage") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "openmontage", runId, brief };
  }

  if (candidate.kind === "shorts") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "shorts", runId, task };
  }

  if (candidate.kind === "formsmith") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "formsmith", runId, task };
  }

  if (candidate.kind === "video_use") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return {
      kind: "video_use",
      runId,
      task,
      ...(candidate.quiet === true ? { quiet: true } : {}),
    };
  }

  if (candidate.kind === "money_printer") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "money_printer", runId, brief };
  }

  if (candidate.kind === "legal_agent") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "legal_agent", runId, task };
  }

  if (candidate.kind === "wardrobe") {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    if (!task) return null;
    return { kind: "wardrobe", runId, task };
  }

  if (candidate.kind === "matraix") {
    const brief = boundedString(candidate.brief, MAX_TASK_LENGTH);
    if (!brief) return null;
    return { kind: "matraix", runId, brief };
  }

  if (
    candidate.kind === "codex" ||
    candidate.kind === "opencode" ||
    candidate.kind === "ruflo"
  ) {
    const task = boundedString(candidate.task, MAX_TASK_LENGTH);
    const gardenSlug = boundedString(candidate.gardenSlug, MAX_ID_LENGTH);
    const repository = boundedString(candidate.repository, MAX_ID_LENGTH);
    if (!task || !gardenSlug || !repository) return null;
    return {
      kind: candidate.kind,
      runId,
      task,
      gardenSlug,
      repository,
    };
  }

  return null;
}

/** Every transcript field a hydrated run descriptor can land on. */
interface ExternalAgentRunFields {
  browserRun?: { runId: string } | null;
  agentBrowserRun?: { runId: string } | null;
  agentReachRun?: { runId: string } | null;
  careerOpsRun?: { runId: string } | null;
  tradingAgentsRun?: { runId: string } | null;
  vibeTradingRun?: { runId: string } | null;
  stockAnalystRun?: { runId: string } | null;
  paperTraderRun?: { runId: string } | null;
  deerFlowRun?: { runId: string } | null;
  deepResearchRun?: { runId: string } | null;
  maxResearchRun?: { runId: string } | null;
  getDocRun?: { runId: string } | null;
  meetingNotesRun?: { runId: string } | null;
  deepTutorRun?: { runId: string } | null;
  openPlanterRun?: { runId: string } | null;
  openworkRun?: { runId: string } | null;
  openscienceRun?: { runId: string } | null;
  inboxZeroRun?: { runId: string } | null;
  socialsManagerRun?: { runId: string } | null;
  hardwareBlueprintRun?: { runId: string } | null;
  parametricCadRun?: { runId: string } | null;
  hyperframesRun?: { runId: string } | null;
  resource2SkillRun?: { runId: string } | null;
  openMontageRun?: { runId: string } | null;
  vimaxRun?: { runId: string } | null;
  voxDirectorRun?: { runId: string } | null;
  shortsRun?: { runId: string } | null;
  formsmithRun?: { runId: string } | null;
  moneyPrinterRun?: { runId: string } | null;
  videoUseRun?: { runId: string } | null;
  legalRun?: { runId: string } | null;
  wardrobeRun?: { runId: string } | null;
  matraixRun?: { runId: string } | null;
  openCodeRun?: { runId: string } | null;
  codexRun?: { runId: string } | null;
  rufloRun?: { runId: string } | null;
}

/**
 * The transcript field each run kind lands on.
 *
 * This is the one table both directions read. `externalAgentMessageFields`
 * writes these fields when a stored descriptor is read back, and the save path
 * (api/chat-sessions/[sessionId]) reads them to rebuild the descriptor. They
 * used to be two hand-written lists, and an agent missing from the second one
 * lost its run card the moment the chat was reloaded — the run was still there,
 * but nothing remembered which agent the turn belonged to.
 *
 * `satisfies Record<ExternalAgentRunKind, ...>` is what makes that impossible:
 * a new kind does not compile until it names its field here.
 */
export const EXTERNAL_AGENT_RUN_FIELD_BY_KIND = {
  agent_tars: "browserRun",
  agent_browser: "agentBrowserRun",
  agent_reach: "agentReachRun",
  career_ops: "careerOpsRun",
  trading_agents: "tradingAgentsRun",
  vibe_trading: "vibeTradingRun",
  stock_analyst: "stockAnalystRun",
  paper_trader: "paperTraderRun",
  deer_flow: "deerFlowRun",
  deep_research: "deepResearchRun",
  max_research: "maxResearchRun",
  get_doc: "getDocRun",
  meeting_notes: "meetingNotesRun",
  deep_tutor: "deepTutorRun",
  openplanter: "openPlanterRun",
  openwork: "openworkRun",
  openscience: "openscienceRun",
  inbox_zero: "inboxZeroRun",
  codex: "codexRun",
  opencode: "openCodeRun",
  ruflo: "rufloRun",
  socials_manager: "socialsManagerRun",
  hardware_blueprint: "hardwareBlueprintRun",
  parametric_cad: "parametricCadRun",
  hyperframes: "hyperframesRun",
  resource2skill: "resource2SkillRun",
  openmontage: "openMontageRun",
  vimax: "vimaxRun",
  vox_director: "voxDirectorRun",
  shorts: "shortsRun",
  formsmith: "formsmithRun",
  money_printer: "moneyPrinterRun",
  video_use: "videoUseRun",
  legal_agent: "legalRun",
  wardrobe: "wardrobeRun",
  matraix: "matraixRun",
} as const satisfies Record<ExternalAgentRunKind, keyof ExternalAgentRunFields>;

const EXTERNAL_AGENT_RUN_FIELDS = EXTERNAL_AGENT_RUN_KINDS.map(
  (kind) => EXTERNAL_AGENT_RUN_FIELD_BY_KIND[kind],
) satisfies readonly (keyof ExternalAgentRunFields)[];

/**
 * The run a transcript message owns, and only if the assistant owns it. A
 * launch stores the same descriptor on both halves of the turn, so matching the
 * user half here would let the terminal result overwrite what the person typed.
 */
export function assistantExternalAgentRunId(
  message: { role: "user" | "assistant" } & ExternalAgentRunFields,
): string | null {
  if (message.role !== "assistant") return null;
  for (const field of EXTERNAL_AGENT_RUN_FIELDS) {
    const runId = message[field]?.runId;
    if (typeof runId === "string" && runId) return runId;
  }
  return null;
}

export function parseExternalAgentOutcome(value: unknown): ExternalAgentOutcome | null {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "aborted"
    ? value
    : null;
}

export function parseExternalAgentStartedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return value;
}

export function externalAgentResponseDurationMs(input: {
  baseDurationMs?: number;
  startedAt?: string;
  endedAtMs: number;
}): number | undefined {
  const baseDurationMs =
    typeof input.baseDurationMs === "number" &&
    Number.isFinite(input.baseDurationMs)
      ? Math.max(0, input.baseDurationMs)
      : 0;
  const startedAtMs = input.startedAt
    ? Date.parse(input.startedAt)
    : Number.NaN;
  if (!Number.isFinite(startedAtMs)) {
    return input.baseDurationMs === undefined ? undefined : baseDurationMs;
  }
  return baseDurationMs + Math.max(0, input.endedAtMs - startedAtMs);
}

export function externalAgentMessageFields(
  metadata: Record<string, unknown>,
): {
  browserRun?: { agentId: string; runId: string; task: string };
  agentBrowserRun?: { agentId: string; runId: string; task: string };
  agentReachRun?: { runId: string; task: string };
  careerOpsRun?: { runId: string; task: string };
  tradingAgentsRun?: { runId: string; task: string };
  vibeTradingRun?: { runId: string; task: string };
  stockAnalystRun?: { runId: string; task: string };
  paperTraderRun?: { runId: string; task: string };
  deerFlowRun?: { runId: string; task: string };
  deepResearchRun?: { runId: string; query: string; output: "report" | "answer" };
  maxResearchRun?: { runId: string; query: string };
  getDocRun?: { runId: string; query: string };
  meetingNotesRun?: { runId: string; task: string };
  deepTutorRun?: { runId: string; task: string; capability: string };
  openPlanterRun?: { runId: string; task: string };
  openworkRun?: { runId: string; task: string };
  openscienceRun?: { runId: string; task: string };
  inboxZeroRun?: { runId: string; task: string };
  socialsManagerRun?: { runId: string; brief: string };
  hardwareBlueprintRun?: { runId: string; brief: string };
  parametricCadRun?: { runId: string; brief: string };
  hyperframesRun?: { runId: string; brief: string };
  resource2SkillRun?: { runId: string; brief: string };
  openMontageRun?: { runId: string; brief: string };
  vimaxRun?: { runId: string; brief: string };
  voxDirectorRun?: { runId: string; brief: string };
  shortsRun?: { runId: string; task: string };
  formsmithRun?: { runId: string; task: string };
  moneyPrinterRun?: { runId: string; brief: string };
  videoUseRun?: { runId: string; task: string; quiet?: boolean };
  legalRun?: { runId: string; task: string };
  wardrobeRun?: { runId: string; task: string };
  matraixRun?: { runId: string; brief: string };
  openCodeRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  codexRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  rufloRun?: {
    runId: string;
    task: string;
    gardenSlug: string;
    repository: string;
  };
  externalAgentOutcome?: ExternalAgentOutcome;
  /** Durable start of the worker phase, used to resume elapsed time exactly. */
  externalAgentStartedAt?: string;
  externalAgentActivity?: ExternalAgentActivityEntry[];
  externalAgentEdits?: ExternalAgentEdits;
  externalAgentState?: Record<string, unknown>;
  /** A model-selected worker is observed but never presented as its own card. */
  delegatedAgentRun?: boolean;
  delegatedAgentPreamble?: string;
  /** Worker output kept outside the Super Agent's visible assistant text. */
  externalAgentResult?: string;
  externalAgentName?: string;
} {
  if (metadata.externalAgent !== true) return {};
  const run = parseExternalAgentRun(metadata.externalAgentRun);
  const outcome = parseExternalAgentOutcome(metadata.externalAgentOutcome);
  const externalAgentStartedAt = parseExternalAgentStartedAt(
    metadata.externalAgentStartedAt,
  );
  const activity = parseExternalAgentActivity(metadata.externalAgentActivity);
  const edits = parseExternalAgentEdits(metadata.externalAgentEdits);
  const state = parseExternalAgentState(metadata.externalAgentState);
  const delegatedAgentRun = metadata.delegatedAgentRun === true;
  const delegatedAgentPreamble =
    delegatedAgentRun &&
    typeof metadata.delegatedAgentPreamble === "string" &&
    metadata.delegatedAgentPreamble.trim()
      ? metadata.delegatedAgentPreamble
      : undefined;
  const externalAgentResult =
    delegatedAgentRun && typeof metadata.externalAgentResult === "string"
      ? metadata.externalAgentResult
      : undefined;
  const outcomeField = {
    ...(outcome ? { externalAgentOutcome: outcome } : {}),
    ...(externalAgentStartedAt ? { externalAgentStartedAt } : {}),
    ...(activity.length ? { externalAgentActivity: activity } : {}),
    ...(edits ? { externalAgentEdits: edits } : {}),
    ...(state ? { externalAgentState: state } : {}),
    ...(delegatedAgentRun ? { delegatedAgentRun: true } : {}),
    ...(delegatedAgentPreamble ? { delegatedAgentPreamble } : {}),
    ...(externalAgentResult !== undefined ? { externalAgentResult } : {}),
    ...(run ? { externalAgentName: externalAgentDisplayName(run.kind) } : {}),
  };
  if (!run) return outcomeField;

  if (run.kind === "agent_tars") {
    return {
      browserRun: {
        agentId: run.agentId,
        runId: run.runId,
        task: run.task,
      },
      ...outcomeField,
    };
  }
  if (run.kind === "agent_browser") {
    return {
      agentBrowserRun: {
        agentId: run.agentId,
        runId: run.runId,
        task: run.task,
      },
      ...outcomeField,
    };
  }
  if (run.kind === "agent_reach") {
    return {
      agentReachRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "career_ops") {
    return {
      careerOpsRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "trading_agents") {
    return {
      tradingAgentsRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "vibe_trading") {
    return {
      vibeTradingRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "stock_analyst") {
    return {
      stockAnalystRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "paper_trader") {
    return {
      paperTraderRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "deer_flow") {
    return {
      deerFlowRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "max_research") {
    return {
      maxResearchRun: { runId: run.runId, query: run.query },
      ...outcomeField,
    };
  }
  if (run.kind === "deep_research") {
    return {
      deepResearchRun: {
        runId: run.runId,
        query: run.query,
        output: run.output,
      },
      ...outcomeField,
    };
  }
  if (run.kind === "get_doc") {
    return {
      getDocRun: { runId: run.runId, query: run.query },
      ...outcomeField,
    };
  }
  if (run.kind === "meeting_notes") {
    return {
      meetingNotesRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "deep_tutor") {
    return {
      deepTutorRun: { runId: run.runId, task: run.task, capability: run.capability },
      ...outcomeField,
    };
  }
  if (run.kind === "openplanter") {
    return {
      openPlanterRun: {
        runId: run.runId,
        task: run.task,
      },
      ...outcomeField,
    };
  }
  if (run.kind === "openwork") {
    return {
      openworkRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "openscience") {
    return {
      openscienceRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "inbox_zero") {
    return {
      inboxZeroRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "socials_manager") {
    return {
      socialsManagerRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "hardware_blueprint") {
    return {
      hardwareBlueprintRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "parametric_cad") {
    return {
      parametricCadRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "hyperframes") {
    return {
      hyperframesRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "resource2skill") {
    return {
      resource2SkillRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "openmontage") {
    return {
      openMontageRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "vimax") {
    return {
      vimaxRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "vox_director") {
    return {
      voxDirectorRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "shorts") {
    return {
      shortsRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "formsmith") {
    return {
      formsmithRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "video_use") {
    return {
      videoUseRun: {
        runId: run.runId,
        task: run.task,
        ...(run.quiet ? { quiet: true } : {}),
      },
      ...outcomeField,
    };
  }
  if (run.kind === "money_printer") {
    return {
      moneyPrinterRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  if (run.kind === "legal_agent") {
    return {
      legalRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "wardrobe") {
    return {
      wardrobeRun: { runId: run.runId, task: run.task },
      ...outcomeField,
    };
  }
  if (run.kind === "matraix") {
    return {
      matraixRun: { runId: run.runId, brief: run.brief },
      ...outcomeField,
    };
  }
  const repositoryRun = {
    runId: run.runId,
    task: run.task,
    gardenSlug: run.gardenSlug,
    repository: run.repository,
  };
  if (run.kind === "ruflo") {
    return { rufloRun: repositoryRun, ...outcomeField };
  }
  return run.kind === "codex"
    ? { codexRun: repositoryRun, ...outcomeField }
    : { openCodeRun: repositoryRun, ...outcomeField };
}
import type { ChatTokenUsage } from "@/lib/chat-token-usage";
