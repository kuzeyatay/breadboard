// Bring ComfyUI up with the app, when there is a ComfyUI to bring up.
//
// A first render otherwise pays for the whole cold start — the Python process,
// then several gigabytes of checkpoint off disk — which is the difference
// between the Advanced tab feeling like the other image modes and feeling like
// a machine that has to be woken up. Starting at boot moves that wait somewhere
// nobody is watching.
//
// "When there is one to bring up" is the entire condition, and it is deliberately
// strict. This never installs anything: setup downloads gigabytes and stays an
// explicit click. It never starts a second server: an already-answering ComfyUI
// (yours, on your port, with your models) is left exactly as it is. And it does
// nothing at all when the environment has not been built, which is the state a
// fresh checkout is in.
//
// That is precisely the `stopped` state, so this asks for the status and acts on
// one answer rather than re-deriving the conditions.

import { resolveComfyUiConfig } from "./config.ts";
import { comfyUiStatus } from "./service.ts";
import { ensureComfyUiRunning } from "./server.ts";

interface Globals {
  __breadboardComfyUiAutostarted?: boolean;
}

const globals = globalThis as unknown as Globals;

/**
 * Delayed rather than immediate: boot is already contending for the disk with
 * the dashboard, Hermes and whatever else starts with the app, and a diffusion
 * server is the one thing here nobody is waiting on.
 */
const START_AFTER_MS = 12_000;

export function autostartComfyUi(): void {
  if (globals.__breadboardComfyUiAutostarted) return;
  globals.__breadboardComfyUiAutostarted = true;

  const config = resolveComfyUiConfig();
  if (!config.enabled || !config.managed || !config.autostart) return;

  setTimeout(() => {
    void (async () => {
      try {
        const status = await comfyUiStatus(config);
        // Anything else is either already running, still installing, or not
        // installed — and none of those is ours to change without being asked.
        if (status.state !== "stopped") return;
        await ensureComfyUiRunning(config);
      } catch {
        // The panel reports the real state when the tab is opened, and the
        // first render starts the server itself. A failed autostart costs a
        // slow first picture, never a broken one.
      }
    })();
  }, START_AFTER_MS).unref?.();
}
