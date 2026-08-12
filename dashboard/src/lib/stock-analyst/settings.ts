// What a Stock Analyst run uses for everything the question does not say.
//
// The values themselves live where every other agent's defaults live — the
// per-user agent-settings catalog and store. This module is only the vocabulary
// in between: the choices the catalog offers, and the translation from stored
// values into the configuration the supervised service is started with.
//
// Every field here maps to a real setting the clone reads at boot (see its
// `.env.example`). Nothing is invented: a setting the clone cannot honour would
// be a lie told in a settings dialog.
//
// The translation has two halves on purpose. Most settings are process
// environment, which the clone's `setup_env()` leaves alone because it loads its
// file with `override=False`. The watchlist is not: `STOCK_LIST` is one of six
// keys the clone deliberately re-reads from the env *file* on every use, so that
// editing `.env` takes effect without a restart. Passing it as environment alone
// would be silently ignored, so it is written to Breadboard's own env file
// instead — see ./service.ts for why that file exists at all.

import type { AgentSettingValues } from "../agent-settings/catalog.ts";

/**
 * How much machinery a question is put through.
 *
 * The clone has two agent architectures. `single` is one tool-calling loop —
 * fast, and what its own default Ask-a-Stock chat uses. `multi` is a staged
 * orchestrator (technical, fundamental, news, strategy, risk, decision) whose
 * mode decides how many of those stages run, and it is what produces the
 * decision-dashboard style answer the project is known for. It costs several
 * model calls per stage, which is why it is not the default.
 */
export const DEPTHS = [
  {
    value: "single",
    label: "Quick answer",
    help: "One agent with tools. Fastest, and enough for a single question about one stock.",
    arch: "single",
    mode: "standard",
  },
  {
    value: "multi-quick",
    label: "Short review",
    help: "The staged orchestrator with its shortest pipeline.",
    arch: "multi",
    mode: "quick",
  },
  {
    value: "multi-standard",
    label: "Standard review",
    help: "The staged orchestrator's normal pipeline: data, news, strategy, risk, decision.",
    arch: "multi",
    mode: "standard",
  },
  {
    value: "multi-full",
    label: "Full decision report",
    help: "Every stage, for the complete report with scores, levels, risks and a checklist.",
    arch: "multi",
    mode: "full",
  },
  {
    value: "multi-specialist",
    label: "Strategy panel",
    help: "Runs several strategy specialists in parallel and reconciles their views.",
    arch: "multi",
    mode: "specialist",
  },
] as const;

export type Depth = (typeof DEPTHS)[number]["value"];

/** The three languages the clone can write a report in. */
export const REPORT_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese", help: "The project's own default." },
  { value: "ko", label: "Korean" },
] as const;

export type ReportLanguage = (typeof REPORT_LANGUAGES)[number]["value"];

/**
 * Which of the clone's fifteen built-in strategy skills a run may reason with.
 * `auto` lets its router pick from the market state; `all` activates every one,
 * which is slower and broader.
 */
export const STRATEGY_MODES = [
  {
    value: "auto",
    label: "Chosen automatically",
    help: "The clone's router picks strategies from the current market state.",
  },
  {
    value: "all",
    label: "All fifteen",
    help: "Moving averages, Chan theory, Elliott waves, volume breakout, sentiment cycle and the rest.",
  },
] as const;

export type StrategyMode = (typeof STRATEGY_MODES)[number]["value"];

export interface StockAnalystSettings {
  /** Empty follows the chat's model. */
  model: string;
  depth: Depth;
  language: ReportLanguage;
  strategies: StrategyMode;
  /**
   * The user's own stocks, as the clone's own code format:
   * `600519,hk00700,AAPL,7203.T,005930.KS,2330.TW`. Empty is fine — a question
   * naming its own stock never needs it.
   */
  watchlist: string;
  /** Keep what earlier runs concluded, and calibrate confidence against it. */
  memory: boolean;
  /** The clone's own default is 0.7; a stock verdict should be reproducible. */
  temperature: number;
}

export const DEFAULT_STOCK_ANALYST_SETTINGS: StockAnalystSettings = {
  model: "",
  depth: "single",
  language: "en",
  strategies: "auto",
  watchlist: "",
  memory: false,
  temperature: 0.2,
};

const DEPTH_SET = new Set<string>(DEPTHS.map((depth) => depth.value));
const LANGUAGE_SET = new Set<string>(REPORT_LANGUAGES.map((language) => language.value));
const STRATEGY_SET = new Set<string>(STRATEGY_MODES.map((strategy) => strategy.value));
const MAX_MODEL_LENGTH = 120;
export const MAX_WATCHLIST_LENGTH = 400;

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clampTemperature(value: unknown, fallback: number): number {
  const temperature = Number(value);
  if (!Number.isFinite(temperature)) return fallback;
  // The clone forwards this to litellm, and 0–2 is the range every
  // OpenAI-compatible relay accepts.
  return Math.min(Math.max(Math.round(temperature * 100) / 100, 0), 2);
}

/**
 * A watchlist the clone will actually parse. It splits on commas and upper-cases
 * each entry, so anything that is not a plausible ticker is dropped here rather
 * than becoming a code the data layer spends a run failing to resolve.
 */
export function normalizeWatchlist(value: unknown): string {
  return boundedText(value, MAX_WATCHLIST_LENGTH)
    .split(/[,\s]+/)
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(code))
    .slice(0, 40)
    .join(",");
}

/**
 * Read the catalog's stored values as run settings. The catalog already
 * normalised them, so this only maps names and applies the defaults for
 * anything an older stored row is missing.
 */
export function stockAnalystSettingsFrom(values: AgentSettingValues): StockAnalystSettings {
  const depth = typeof values.depth === "string" ? values.depth : "";
  const language = typeof values.language === "string" ? values.language : "";
  const strategies = typeof values.strategies === "string" ? values.strategies : "";
  return {
    model: boundedText(values.model, MAX_MODEL_LENGTH),
    depth: DEPTH_SET.has(depth) ? (depth as Depth) : DEFAULT_STOCK_ANALYST_SETTINGS.depth,
    language: LANGUAGE_SET.has(language)
      ? (language as ReportLanguage)
      : DEFAULT_STOCK_ANALYST_SETTINGS.language,
    strategies: STRATEGY_SET.has(strategies)
      ? (strategies as StrategyMode)
      : DEFAULT_STOCK_ANALYST_SETTINGS.strategies,
    watchlist: normalizeWatchlist(values.watchlist),
    // An unset boolean has to read as the default rather than as false, or every
    // stored row written before this field existed would silently change.
    memory:
      typeof values.memory === "boolean"
        ? values.memory
        : DEFAULT_STOCK_ANALYST_SETTINGS.memory,
    temperature: clampTemperature(
      values.temperature,
      DEFAULT_STOCK_ANALYST_SETTINGS.temperature,
    ),
  };
}

/**
 * The environment overrides these settings become. Read once by the clone at
 * boot, which is why ./service.ts restarts the service when they change.
 */
export function settingsEnv(settings: StockAnalystSettings): Record<string, string> {
  const depth = DEPTHS.find((option) => option.value === settings.depth) ?? DEPTHS[0];
  return {
    AGENT_ARCH: depth.arch,
    AGENT_ORCHESTRATOR_MODE: depth.mode,
    REPORT_LANGUAGE: settings.language,
    LLM_TEMPERATURE: String(settings.temperature),
    AGENT_MEMORY_ENABLED: settings.memory ? "true" : "false",
    // `auto` is the clone's router; `manual` is what makes an explicit skill
    // list mean anything, and `all` is its own shorthand for every built-in.
    AGENT_SKILL_ROUTING: settings.strategies === "all" ? "manual" : "auto",
    AGENT_SKILLS: settings.strategies === "all" ? "all" : "",
  };
}

/**
 * The lines Breadboard's own env file carries. Only the keys the clone insists
 * on reading from a file belong here — everything else is environment, which is
 * easier to reason about and impossible to leave behind on disk.
 */
export function settingsEnvFile(settings: StockAnalystSettings): string {
  return `# Written by Breadboard for the Stock Analyst agent. Edits are overwritten.\nSTOCK_LIST=${settings.watchlist}\n`;
}
