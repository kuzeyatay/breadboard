// Keeping the desk running while Breadboard is open, and resuming it on reopen.
//
// This is the background half of the agent, and it is two loops rather than
// one because two different things can stop a desk.
//
// **The keepalive** watches the arena process. If the desk is meant to be
// running and the backend is not up, it starts it — which covers the app being
// launched again after being quit, a crash, and a machine that went to sleep
// with the process still nominally alive. It reads the durable `enabled` flag on
// every tick rather than caching it, so a Stop takes effect immediately.
//
// **The cycle watchdog** watches the analyses. A TradingAgents run is a child
// process, and a child process does not survive the app closing; the `pending`
// row it left behind would otherwise block every future cycle forever. Any
// analysis older than the timeout the run itself would have honoured is written
// off so the next cycle can claim a fresh one.
//
// Nothing here ever *enables* a desk. Starting one is always a decision someone
// made in chat, and this only honours a decision already recorded.

import { PAPER_TRADER_AGENT_ID } from "./identity.ts";
import { getPaperTraderStore } from "./instance.ts";
import { paperTraderSettingsFrom } from "./settings.ts";
import {
  arenaStarting,
  currentArena,
  stopArena,
  stopArenaForProcessExit,
} from "./service.ts";
import { cycleOverdue, resolveCallbackOrigin, startDesk } from "./supervisor.ts";

interface Globals {
  __breadboardPaperTraderKeepalive?: ReturnType<typeof setInterval>;
  __breadboardPaperTraderStartup?: ReturnType<typeof setTimeout>;
  __breadboardPaperTraderShutdownInstalled?: boolean;
}

const globals = globalThis as unknown as Globals;

/**
 * Delayed rather than immediate: boot is already contending for the disk with
 * the dashboard, Hermes and everything else that starts with the app, and the
 * desk's first cycle is minutes away regardless.
 */
const START_AFTER_MS = 15_000;
const CHECK_EVERY_MS = 60_000;
/** Matches the analysis timeout in ./decisions.ts, plus room to settle. */
const STALE_ANALYSIS_MINUTES = 35;

let reviving = false;

/**
 * Everything here is inside the try, including the database reads.
 *
 * This runs from a timer as `void revive()`, so anything that escapes becomes an
 * unhandled rejection — and an unhandled rejection takes the whole dashboard
 * process down, which for a background keepalive nobody is watching would be an
 * absurd way to lose the app. A failed tick is worth nothing more than the next
 * tick trying again.
 */
async function revive(): Promise<void> {
  if (reviving) return;
  reviving = true;
  try {
    const store = getPaperTraderStore();
    const state = store.state();
    if (!state.enabled) return;

    // Done whether or not the backend needs starting: an orphaned analysis
    // blocks the cycle even when everything else is healthy.
    store.failStaleAnalyses(STALE_ANALYSIS_MINUTES);
    store.releaseStaleAdvice(STALE_ANALYSIS_MINUTES);

    if (arenaStarting()) return;
    if (state.ownerUserId === null) return;

    const { agentSettingsFor } = await import("../agent-settings/store.ts");
    const settings =
      state.runSettings ??
      paperTraderSettingsFrom(agentSettingsFor(state.ownerUserId, PAPER_TRADER_AGENT_ID));

    // Up but no longer asking for decisions is its own failure, and the one this
    // loop would otherwise never notice: `currentArena()` is perfectly happy
    // with a process whose scheduler stopped hours ago. Restarting is the only
    // cure — the flag that stopped it lives in the arena's own memory.
    const running = currentArena();
    if (
      running &&
      !cycleOverdue(state, settings.cycleMinutes, Date.now(), running.startedAt)
    ) {
      return;
    }
    if (running) await stopArena();

    await startDesk({
      userId: state.ownerUserId,
      settings,
      callbackOrigin: resolveCallbackOrigin(),
      resumeOnly: true,
    });
  } catch {
    // startDesk has already recorded why, and the card shows it. The next tick
    // tries again: a desk that cannot start because ChatMock is not up yet
    // should come back on its own once it is.
  } finally {
    reviving = false;
  }
}

export function autostartPaperTrader(): void {
  installShutdownCleanup();
  if (globals.__breadboardPaperTraderKeepalive) return;

  const startup = setTimeout(() => void revive(), START_AFTER_MS);
  startup.unref?.();
  globals.__breadboardPaperTraderStartup = startup;
  const timer = setInterval(() => void revive(), CHECK_EVERY_MS);
  timer.unref();
  globals.__breadboardPaperTraderKeepalive = timer;
}

function clearBackgroundTimers(): void {
  if (globals.__breadboardPaperTraderStartup) {
    clearTimeout(globals.__breadboardPaperTraderStartup);
    globals.__breadboardPaperTraderStartup = undefined;
  }
  if (globals.__breadboardPaperTraderKeepalive) {
    clearInterval(globals.__breadboardPaperTraderKeepalive);
    globals.__breadboardPaperTraderKeepalive = undefined;
  }
}

/** Stop the process but preserve the durable intent so it can resume on reopen. */
export async function shutdownPaperTrader(): Promise<void> {
  clearBackgroundTimers();
  await stopArena();
}

function installShutdownCleanup(): void {
  if (globals.__breadboardPaperTraderShutdownInstalled) return;
  globals.__breadboardPaperTraderShutdownInstalled = true;

  process.once("exit", stopArenaForProcessExit);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      clearBackgroundTimers();
      stopArenaForProcessExit();
      // The once-listener has removed itself, so the repeated signal resumes
      // Node's normal shutdown path (and lets the desktop supervisor take over).
      try {
        process.kill(process.pid, signal);
      } catch {
        process.exit(signal === "SIGINT" ? 130 : 143);
      }
    });
  }
}
