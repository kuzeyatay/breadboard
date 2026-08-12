import { readIfixAiMaintenanceConfig } from "./config.ts";
import { runIfixAiMaintenanceOnce } from "./loop.ts";

type MaintenanceGlobals = typeof globalThis & {
  __breadboardIfixAiMaintenanceTimer?: ReturnType<typeof setInterval>;
  __breadboardIfixAiMaintenanceStartup?: ReturnType<typeof setTimeout>;
  __breadboardIfixAiMaintenanceRunning?: boolean;
};

const globals = globalThis as MaintenanceGlobals;

/** Start the process-wide, headless maintenance loop. Safe across dev reloads. */
export function startIfixAiMaintenanceScheduler(): void {
  if (globals.__breadboardIfixAiMaintenanceTimer) return;
  const config = readIfixAiMaintenanceConfig();
  if (!config.enabled) return;

  const tick = async () => {
    if (globals.__breadboardIfixAiMaintenanceRunning) return;
    globals.__breadboardIfixAiMaintenanceRunning = true;
    try {
      await runIfixAiMaintenanceOnce({ config, trigger: "background_interval" });
    } catch {
      // Runs normally convert failures into durable receipts. This last guard
      // keeps an early filesystem failure from becoming an unhandled rejection.
    } finally {
      globals.__breadboardIfixAiMaintenanceRunning = false;
    }
  };

  const startup = setTimeout(() => void tick(), config.startupDelayMs);
  startup.unref();
  const timer = setInterval(() => void tick(), config.intervalMs);
  timer.unref();
  globals.__breadboardIfixAiMaintenanceStartup = startup;
  globals.__breadboardIfixAiMaintenanceTimer = timer;
}
