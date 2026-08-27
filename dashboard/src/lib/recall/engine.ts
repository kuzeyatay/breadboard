// Pure Recall engine launch contract.
//
// The Rust Runtime owns the recorder process, its Job Object, shutdown, logs,
// and durable desired state. This module deliberately contains no filesystem or
// process operations; it keeps only the stable argv mapping used by the trusted
// native service profile and the compatibility status projection used by the
// existing Settings response.

import { getRecallConfig, type RecallConfig } from "./config.ts";
import type { RecallSettings } from "./policy.ts";
import {
  recallRuntimeProcessRunning,
  type RecallRuntimeStatus,
} from "./runtime-service.ts";

export interface RecallProcessState {
  /** A Runtime-owned recorder is starting or running. */
  running: boolean;
  /** Native process identifiers are intentionally not exposed through Next. */
  pid: number | null;
  startedAt: string | null;
  /** Native command lines are intentionally not exposed through Next. */
  launchedWith: string[] | null;
  /** True when the Rust Runtime, rather than an external operator, owns it. */
  managed: boolean;
}

/** Port the configured base URL points at; the engine defaults to 3030. */
export function enginePort(config: RecallConfig = getRecallConfig()): number {
  try {
    const url = new URL(config.baseUrl);
    return url.port ? Number.parseInt(url.port, 10) : 3030;
  } catch {
    return 3030;
  }
}

/**
 * The argv the user's settings translate into. Kept pure and exported so the
 * mapping from a privacy control to a real engine flag is directly testable —
 * an exclusion that silently fails to reach the recorder is the one bug in
 * this feature that matters most.
 */
export function buildEngineArgs(
  settings: RecallSettings,
  config: RecallConfig = getRecallConfig(),
): string[] {
  const args = [
    "record",
    "--port",
    String(enginePort(config)),
    "--data-dir",
    config.dataDir,
  ];
  if (!settings.captureAudio) args.push("--disable-audio");
  for (const window of settings.excludedWindows) {
    args.push("--ignored-windows", window);
  }
  return args;
}

/** Preserve the existing browser response without leaking native process data. */
export function projectRecallProcessState(
  status: RecallRuntimeStatus | null,
  managed: boolean,
): RecallProcessState {
  return {
    running: recallRuntimeProcessRunning(status),
    pid: null,
    startedAt: null,
    launchedWith: null,
    managed,
  };
}
