// Starting, keeping and stopping the desk — the one place that knows what
// "running" means for this agent.
//
// Running is three things at once, and all three have to be true: the arena
// backend is up, its account is pointed at Breadboard's decision endpoint, and
// the durable `enabled` flag says it should stay that way. The flag is the part
// that lets the desk resume after the app is reopened: the boot hook reads it
// and calls straight back in here. The arena itself stops with Breadboard.
//
// **Why the account has to be reconciled and not merely created.** The arena
// seeds an account of its own on a fresh database, and the account carries the
// model, the endpoint and the key it will call for decisions. Pointing that at
// Breadboard is what makes TradingAgents the thing deciding — an account left on
// its seeded defaults calls api.openai.com with a placeholder key and silently
// trades nothing. The reconciliation runs on every start, so a callback origin
// that moved between sessions is corrected rather than inherited.
//
// **Why changing the starting capital opens a new account.** The clone's account
// API has no field for initial capital after creation, and it should not: every
// return figure on the card is measured against it. So a changed amount retires
// the account and opens a fresh one, which is a new portfolio from zero. That is
// the honest reading of "change the starting capital", and the settings page
// says so before it happens.

import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { stopActivePaperTraderAnalyses } from "./decisions.ts";
import {
  createAccount,
  deactivateAccount,
  isTimeout,
  listAccounts,
  updateAccount,
  type ArenaAccount,
} from "./arena.ts";
import { getPaperTraderStore } from "./instance.ts";
import { arenaLog, arenaStarting, currentArena, ensureArena, stopArena } from "./service.ts";
import { deskToken } from "./token.ts";
import { health } from "./runtime.ts";
import { instrumentsOf, type PaperTraderSettings } from "./settings.ts";

interface DeskStartAttempt {
  signature: string;
  generation: number;
  promise: Promise<StartResult>;
}

const lifecycleGlobal = globalThis as typeof globalThis & {
  __breadboardPaperTraderIntentGeneration?: number;
  __breadboardPaperTraderDeskStart?: DeskStartAttempt | null;
};

function intentGeneration(): number {
  return lifecycleGlobal.__breadboardPaperTraderIntentGeneration ?? 0;
}

function advanceIntentGeneration(): number {
  const next = intentGeneration() + 1;
  lifecycleGlobal.__breadboardPaperTraderIntentGeneration = next;
  return next;
}

function assertCurrentIntent(generation: number): void {
  if (intentGeneration() !== generation) {
    throw new Error("The trading desk start was superseded by a newer command.");
  }
}

/** The name the desk's account trades under, and how it is recognised again. */
export const DESK_ACCOUNT_NAME = "TradingAgents";

/**
 * The model id written onto the arena account. It is never used to pick a model
 * — Breadboard's decision endpoint ignores it and runs the TradingAgents graph —
 * but the clone refuses to trade an account with no model at all, and this is
 * what its own UI would show.
 */
const DESK_ACCOUNT_MODEL = "tradingagents";

export interface DeskStatus {
  /** The durable intent: the desk is meant to be running. */
  enabled: boolean;
  /** The backend is up right now. */
  running: boolean;
  starting: boolean;
  accountId: number | null;
  startedAt: string | null;
  /** The capital the live account was opened with. */
  accountCapital: number | null;
  /** Set when the configured capital no longer matches the live account. */
  capitalChangePending: boolean;
  /** When the arena last asked for a decision. */
  lastCycleAt: string | null;
  /** Up and answering, but its trading loop has gone quiet. See `cycleOverdue`. */
  cycleStalled: boolean;
  lastError: string;
}

export interface StartOptions {
  userId: number;
  settings: PaperTraderSettings;
  /** The dashboard's own origin, as the arena will have to reach it. */
  callbackOrigin: string;
  /** Boot/watchdog recovery may only resume an intent that is still enabled. */
  resumeOnly?: boolean;
}

/** Where the arena posts for a decision — an OpenAI-compatible base URL. */
export function callbackBaseUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/paper-trader/decide`;
}

/**
 * A usable origin for the arena's callback. A request's own origin is the
 * authority — it is by definition an address that reaches this dashboard — and
 * the stored one covers the boot path, where there is no request at all.
 */
export function resolveCallbackOrigin(request?: Request): string {
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // Fall through to what was stored.
    }
  }
  const stored = getPaperTraderStore().state().callbackOrigin;
  if (stored) return stored;
  const configured = process.env.BREADBOARD_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

/**
 * How many cycles may pass with no word from the arena before it counts as
 * wedged. Three, so a single slow cycle — a cold price cache, a retrying vendor
 * — is never mistaken for a dead one.
 */
const MISSED_CYCLES_BEFORE_WEDGED = 3;

/**
 * Whether the arena has stopped trading while still appearing healthy.
 *
 * Its scheduler runs the trading job behind a `max_instances=1` flag cleared in
 * a `finally`, so one market-data call that hangs forever ends trading for good
 * while the process stays up and its health endpoint stays cheerful. Nothing
 * short of asking "has it actually called me lately" can tell that apart from a
 * desk that simply has nothing to do — and it always has something to do, even
 * if that something is being told to hold.
 */
export function cycleOverdue(
  state: { lastCycleAt: string | null; startedAt: string | null },
  cycleMinutes: number,
  now = Date.now(),
  arenaStartedAt?: number,
): boolean {
  const parseStoredTime = (value: string | null): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const candidates = [
    parseStoredTime(state.lastCycleAt),
    parseStoredTime(state.startedAt),
    typeof arenaStartedAt === "number" && Number.isFinite(arenaStartedAt)
      ? arenaStartedAt
      : null,
  ].filter((value): value is number => value !== null);
  if (candidates.length === 0) return false;

  // A restarted arena must get its own grace window. Otherwise an old durable
  // cycle pulse makes every replacement look wedged immediately, and the
  // minute keepalive kills it before its five-minute scheduler can ever fire.
  const latestActivity = Math.max(...candidates);
  return now - latestActivity > cycleMinutes * MISSED_CYCLES_BEFORE_WEDGED * 60_000;
}

export function deskStatus(settings?: PaperTraderSettings): DeskStatus {
  const state = getPaperTraderStore().state();
  const arena = currentArena();
  return {
    enabled: state.enabled,
    running: Boolean(arena),
    starting: arenaStarting(),
    accountId: state.accountId,
    startedAt: state.startedAt,
    accountCapital: state.accountCapital,
    capitalChangePending: Boolean(
      settings && state.accountCapital !== null && state.accountCapital !== settings.startingCapital,
    ),
    lastCycleAt: state.lastCycleAt,
    cycleStalled:
      state.enabled &&
      Boolean(arena) &&
      cycleOverdue(state, settings?.cycleMinutes ?? 15, Date.now(), arena?.startedAt),
    lastError: state.lastError,
  };
}

/**
 * Bring a wedged desk back.
 *
 * Restarting is the only cure: the flag that stopped the trading loop lives in
 * the arena's own memory, so nothing Breadboard can say to it over HTTP will
 * clear it. Deliberately not silent — a desk that quietly restarts itself and
 * never says so is how a real fault hides for a week.
 */
export async function restartDesk(options: StartOptions): Promise<StartResult> {
  const generation = advanceIntentGeneration();
  await stopArena();
  assertCurrentIntent(generation);
  return startDeskAtGeneration(options, generation);
}

/**
 * Bring the arena's account into line with the desk's settings, and return it.
 *
 * Retiring and reopening only ever happens for a changed starting capital.
 * Everything else — the name, the endpoint, the key — is an update in place.
 */
async function reconcileAccount(
  base: string,
  settings: PaperTraderSettings,
  callbackOrigin: string,
): Promise<ArenaAccount> {
  const store = getPaperTraderStore();
  const accounts = await listAccounts(base);
  const wanted = {
    model: DESK_ACCOUNT_MODEL,
    baseUrl: callbackBaseUrl(callbackOrigin),
    apiKey: deskToken(),
  };

  const state = store.state();
  const existing =
    accounts.find((account) => account.id === state.accountId) ??
    accounts.find((account) => account.name === DESK_ACCOUNT_NAME) ??
    // A fresh database has exactly one seeded account and no history behind it;
    // adopting it avoids leaving a stranded one beside the desk's own.
    (accounts.length === 1 ? accounts[0] : undefined);

  if (existing && existing.initialCapital !== settings.startingCapital) {
    await write(() => deactivateAccount(base, existing.id));
    // The prepared verdicts belong to the portfolio that just closed.
    store.clearDecisions();
    await write(() =>
      createAccount(base, {
        name: DESK_ACCOUNT_NAME,
        initialCapital: settings.startingCapital,
        ...wanted,
      }),
    );
    return settle(base, store);
  }

  if (existing) {
    const stale =
      existing.name !== DESK_ACCOUNT_NAME ||
      existing.model !== wanted.model ||
      existing.baseUrl !== wanted.baseUrl ||
      existing.apiKey !== wanted.apiKey;
    if (stale) {
      await write(() =>
        updateAccount(base, existing.id, { name: DESK_ACCOUNT_NAME, ...wanted }),
      );
    }
    return settle(base, store);
  }

  await write(() =>
    createAccount(base, {
      name: DESK_ACCOUNT_NAME,
      initialCapital: settings.startingCapital,
      ...wanted,
    }),
  );
  return settle(base, store);
}

/**
 * Carry out one account write, tolerating this side giving up on it.
 *
 * Creating or updating an account in this clone is not a database write: both
 * handlers prefetch a live price for every registered symbol before answering,
 * which is a ccxt round trip per symbol. A slow one is normal, and a request
 * that times out has still been applied — so a timeout is not an error here,
 * only a reason to go and look.
 */
async function write(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!isTimeout(error)) throw error;
  }
}

/**
 * Read back which account the desk actually owns, and record that.
 *
 * The authority is the arena's own list, never the write's response. Recording
 * from the response is how the desk once ended up enabled with no account id:
 * the update landed, the response never arrived, the account was never
 * recorded, and every decision request afterwards was answered "the desk is not
 * running" by a desk that was.
 */
async function settle(
  base: string,
  store: ReturnType<typeof getPaperTraderStore>,
): Promise<ArenaAccount> {
  const accounts = await listAccounts(base);
  const settled =
    accounts.find((account) => account.name === DESK_ACCOUNT_NAME) ??
    (accounts.length === 1 ? accounts[0] : undefined);
  if (!settled) {
    throw new Error("The trading desk's account could not be opened in the arena.");
  }
  store.recordAccount({ accountId: settled.id, capital: settled.initialCapital });
  return settled;
}

export interface StartResult {
  status: DeskStatus;
  account: ArenaAccount;
  /** Where the backend is listening, for the endpoints that proxy it. */
  base: string;
}

/**
 * Start the desk, or adopt the one already running. Records the intent first, so
 * a start that dies half way is still brought back by the keepalive rather than
 * quietly forgotten.
 */
async function startDeskOnce(options: StartOptions, generation: number): Promise<StartResult> {
  const store = getPaperTraderStore();
  assertCurrentIntent(generation);
  if (options.resumeOnly && !store.state().enabled) {
    throw new Error("The trading desk was stopped before it could resume.");
  }
  const snapshot = await health();
  assertCurrentIntent(generation);
  if (options.resumeOnly && !store.state().enabled) {
    throw new Error("The trading desk was stopped before it could resume.");
  }
  if (!snapshot.available) {
    throw new Error(snapshot.reason ?? "Paper Trader is not ready to run.");
  }

  const prior = store.state();
  const sameIntent =
    prior.enabled &&
    prior.ownerUserId === options.userId &&
    prior.callbackOrigin === options.callbackOrigin &&
    JSON.stringify(prior.runSettings) === JSON.stringify(options.settings);
  if (!sameIntent) {
    store.markEnabled({
      userId: options.userId,
      callbackOrigin: options.callbackOrigin,
      settings: options.settings,
    });
  }
  // An analysis that was in flight when the process ended has no one waiting on
  // it any more, and its `pending` row would block every future cycle.
  store.failStaleAnalyses(1);

  try {
    // The register is what the arena is allowed to price and trade, and it reads
    // it at boot — so a changed list restarts the process rather than being
    // quietly ignored until the next time someone stops the desk.
    const service = await ensureArena(
      instrumentsOf(options.settings).map((instrument) => ({
        symbol: instrument.symbol,
        kind: instrument.kind,
        name: instrument.label,
      })),
      options.settings.cycleMinutes,
    );
    assertCurrentIntent(generation);
    const account = await reconcileAccount(service.url, options.settings, options.callbackOrigin);
    assertCurrentIntent(generation);
    store.recordError("");
    return { status: deskStatus(options.settings), account, base: service.url };
  } catch (error) {
    assertCurrentIntent(generation);
    const message = error instanceof Error ? error.message : "The trading desk could not start.";
    store.recordError(`${message} ${arenaLog()}`.trim());
    throw new Error(message);
  }
}

async function startDeskAtGeneration(
  options: StartOptions,
  generation: number,
): Promise<StartResult> {
  assertCurrentIntent(generation);
  if (options.resumeOnly && !getPaperTraderStore().state().enabled) {
    throw new Error("The trading desk was stopped before it could resume.");
  }
  const signature = JSON.stringify({
    userId: options.userId,
    callbackOrigin: options.callbackOrigin,
    settings: options.settings,
  });
  const current = lifecycleGlobal.__breadboardPaperTraderDeskStart;
  if (current) {
    if (current.generation === generation && current.signature === signature) {
      return current.promise;
    }
    await current.promise.catch(() => undefined);
    assertCurrentIntent(generation);
    return startDeskAtGeneration(options, generation);
  }

  const promise = startDeskOnce(options, generation).finally(() => {
    if (lifecycleGlobal.__breadboardPaperTraderDeskStart?.promise === promise) {
      lifecycleGlobal.__breadboardPaperTraderDeskStart = null;
    }
  });
  lifecycleGlobal.__breadboardPaperTraderDeskStart = { signature, generation, promise };
  return promise;
}

/** Start once; concurrent repeats share the same start/reconciliation attempt. */
export function startDesk(options: StartOptions): Promise<StartResult> {
  return startDeskAtGeneration(options, intentGeneration());
}

/** Stop the desk and mean it: the flag is what a restart would otherwise read. */
export async function stopDesk(): Promise<DeskStatus> {
  advanceIntentGeneration();
  const store = getPaperTraderStore();
  store.markDisabled();
  stopActivePaperTraderAnalyses();
  store.failUnservedAnalyses("The decision was discarded because the trading desk stopped.");
  await stopArena();
  return deskStatus();
}

/** The running backend's base URL, or null when the desk is not up. */
export function deskBaseUrl(): string | null {
  return currentArena()?.url ?? null;
}

/**
 * The decision context the analyses run under. There is no request behind a
 * background cycle, so the model is the sentinel that means "whatever the user
 * chose as the background model" and the endpoint is the local ChatMock.
 */
export function analysisContext(): { baseUrl: string; model: string; reasoningEffort: string } {
  return {
    baseUrl: localChatmockBaseUrl(),
    model: GLOBAL_MODEL_SENTINEL,
    reasoningEffort: "medium",
  };
}
