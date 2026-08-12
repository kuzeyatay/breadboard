import "server-only";

import {
  configuredStaleMs,
  getSkillsCatalogStore,
} from "./lib/hermes/skills-catalog-store.ts";
import { synchronizeSkillsCatalog } from "./lib/hermes/skills-catalog-sync.ts";
import { resumeAbandonedRuntimeRuns } from "./lib/hermes/run-recovery.ts";
import { ABANDONED_RUN_AFTER_MS } from "./lib/hermes/run-liveness.ts";
import { startScheduledChatScheduler } from "./lib/schedules/scheduler.ts";
import { autostartComfyUi } from "./lib/comfyui/autostart.ts";
import { autostartTelegramGateway } from "./lib/telegram/service.ts";
import { autostartWhatsAppGateway } from "./lib/whatsapp/service.ts";
import { startIfixAiMaintenanceScheduler } from "./lib/ifixai-maintenance/scheduler.ts";
import { autostartPaperTrader } from "./lib/paper-trader/autostart.ts";

const globalState = globalThis as typeof globalThis & {
  __breadboardSkillsCatalogScheduler?: ReturnType<typeof setInterval>;
  __breadboardAbandonedRunSweeper?: ReturnType<typeof setInterval>;
  __breadboardAbandonedLearnSweeper?: ReturnType<typeof setInterval>;
};

if (!globalState.__breadboardSkillsCatalogScheduler) {
  const refreshIfStale = async () => {
    const store = getSkillsCatalogStore();
    if (!store.status().stale) return;
    await synchronizeSkillsCatalog({ store }).catch(() => {
      // The failed run is stored durably and the last-known-good snapshot stays active.
    });
  };
  setTimeout(() => void refreshIfStale(), 0);
  const timer = setInterval(() => void refreshIfStale(), configuredStaleMs());
  timer.unref();
  globalState.__breadboardSkillsCatalogScheduler = timer;
}

// A turn whose pump died with the process that owned it — a restart, a crash,
// the desktop app quitting mid-answer — is still marked active in the database
// and still holds its conversation's only run slot. Adopting those runs gives
// each one a pump again, which either recovers the answer Hermes already
// finished or ends the turn, and either way hands the conversation back. The
// repeat covers runs orphaned by another process while this one keeps running.
if (!globalState.__breadboardAbandonedRunSweeper) {
  const sweep = () => {
    try {
      resumeAbandonedRuntimeRuns();
    } catch {
      // A sweep is best-effort: the next one runs in a minute, and every entry
      // point that could be blocked by an abandoned run also clears its own.
    }
  };
  setTimeout(sweep, 0);
  const timer = setInterval(sweep, ABANDONED_RUN_AFTER_MS / 2);
  timer.unref();
  globalState.__breadboardAbandonedRunSweeper = timer;
}

// Learn jobs are also durable, but their workers are process-local. A fenced
// sweeper restores the pre-run snapshot only after both the database heartbeat
// and the garden lease are stale. Keeping this out of the status endpoint makes
// every Learn GET a genuine read while still recovering cleanly after restart.
if (!globalState.__breadboardAbandonedLearnSweeper) {
  let sweeping = false;
  const sweep = async () => {
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath || sweeping) return;
    sweeping = true;
    try {
      const { recoverAbandonedLearnJobs } = await import("./lib/learn.ts");
      await recoverAbandonedLearnJobs({ contentPath });
    } catch {
      // Recovery owns a fenced lease and is idempotent. A later sweep retries
      // anything that could not be inspected safely during startup.
    } finally {
      sweeping = false;
    }
  };
  setTimeout(() => void sweep(), 0);
  const timer = setInterval(() => void sweep(), 60 * 1000);
  timer.unref();
  globalState.__breadboardAbandonedLearnSweeper = timer;
}

// Cron-scheduled chats fire from this process, so they keep running while the
// app is open on any page — or on none at all.
startScheduledChatScheduler();

// Same reasoning for WhatsApp: a linked phone should reach Breadboard whenever
// the app is running, not only while a chat page happens to be open.
autostartWhatsAppGateway();

// And for Telegram, which long-polls the Bot API from this same process.
autostartTelegramGateway();

// The local image renderer, but only when there is already one installed and
// nothing else is answering on its port. Booting it here means the first
// Advanced render is not also paying for a Python start and a multi-gigabyte
// model load.
autostartComfyUi();

// Internal prompt maintenance is operator-configured and headless. It writes
// only isolated evaluation artifacts and never activates a repair candidate.
startIfixAiMaintenanceScheduler();

// A trading desk someone started runs while Breadboard is open. Closing the app
// tears its process down; this resumes it on the next launch only when its
// durable flag is still set. It never starts one nobody asked for.
autostartPaperTrader();
