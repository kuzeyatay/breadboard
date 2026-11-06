// The one place Recall history is read.
//
// Both callers — the settings tab and the agent's `recall_*` tools — come
// through here, so the user's limits are applied once rather than per caller.
// Two of those limits matter more than the rest:
//
//   * agent access is checked on every agent-facing read, not just at tool
//     registration, so revoking it in the tab takes effect on the next call;
//   * exclusions are re-applied to results, not only passed to the recorder,
//     because history captured before a window was excluded is still history
//     the user has since said they do not want read back.

import { getRecallConfig, type RecallConfig } from "./config.ts";
import {
  RecallClient,
  recallClient,
  type RecallHealth,
  type RecallMeeting,
  type RecallSearchHit,
  type RecallTranscriptSegment,
} from "./client.ts";
import { RecallError } from "./errors.ts";
import {
  projectRecallProcessState,
  type RecallProcessState,
} from "./engine.ts";
import {
  installState,
  readInstallStatus,
  startInstall,
  type RecallInstallState,
  type RecallInstallStatus,
} from "./install.ts";
import {
  isExcluded,
  recallAutoStartDecision,
  shapeSearchResults,
  truncateCapturedText,
  type RecallAutoStartOutcome,
  type ShapedSearch,
} from "./policy.ts";
import {
  readRecallRuntimeStatus,
  recallRuntimeManaged,
  reconcileRecallRuntime,
  type RecallRuntimeStatus,
} from "./runtime-service.ts";
import { getRecallSettings, updateRecallSettings, type RecallSettings } from "./settings.ts";

export interface RecallStatus {
  /** Feature switch — false disables the tab, the routes, and the tools. */
  enabled: boolean;
  /** False on a platform the capture engine publishes no binary for. */
  supported: boolean;
  install: RecallInstallState;
  installStatus: RecallInstallStatus | null;
  process: RecallProcessState;
  /** The engine answered a health probe just now. */
  reachable: boolean;
  health: RecallHealth | null;
  settings: RecallSettings;
  /** Last lines of the engine log, included only when it is not reachable. */
  logTail: string[];
}

export interface RecallSearchArgs {
  query?: string;
  contentType?: "all" | "screen" | "audio";
  limit?: number;
  startTime?: string;
  endTime?: string;
  appName?: string;
  windowName?: string;
}

export type RecallSearchResult = ShapedSearch;

const CONTENT_TYPES: Record<string, "all" | "ocr" | "audio"> = {
  all: "all",
  screen: "ocr",
  audio: "audio",
};

export async function getRecallStatus(
  userId: number,
  {
    config = getRecallConfig(),
    client,
  }: { config?: RecallConfig; client?: RecallClient } = {},
): Promise<RecallStatus> {
  const settings = getRecallSettings(userId);
  const install = installState(config);
  const managed = recallRuntimeManaged();
  let runtimeStatus: RecallRuntimeStatus | null = null;
  if (managed) {
    try {
      runtimeStatus = await readRecallRuntimeStatus(userId);
    } catch {
      // Status is observational. A temporarily unavailable Runtime must not
      // turn a Settings poll into a process start or leak its control details.
      runtimeStatus = null;
    }
  }
  const process_ = projectRecallProcessState(runtimeStatus, managed);

  let health: RecallHealth | null = null;
  if (config.enabled) {
    try {
      health = await (client ?? recallClient(config)).health();
    } catch {
      health = null;
    }
  }

  return {
    enabled: config.enabled,
    supported: install.supported,
    install,
    installStatus: readInstallStatus(config),
    process: process_,
    reachable: health !== null,
    health,
    settings,
    logTail:
      health === null && process_.managed ? (runtimeStatus?.logTail ?? []) : [],
  };
}

/** Shared preconditions for every read of captured history. */
function assertReadable(
  settings: RecallSettings,
  config: RecallConfig,
  forAgent: boolean,
): void {
  if (!config.enabled) throw new RecallError("feature_disabled");
  if (forAgent && !settings.agentAccess)
    throw new RecallError("agent_access_disabled");
}

export async function searchRecall(
  userId: number,
  args: RecallSearchArgs,
  {
    forAgent = false,
    config = getRecallConfig(),
    client,
  }: { forAgent?: boolean; config?: RecallConfig; client?: RecallClient } = {},
): Promise<RecallSearchResult> {
  const settings = getRecallSettings(userId);
  assertReadable(settings, config, forAgent);

  const cap = Math.min(settings.maxResults, config.maxResults);
  const limit = Math.min(Math.max(args.limit ?? cap, 1), cap);
  const start =
    args.startTime?.trim() || `${settings.defaultLookbackHours}h ago`;
  const end = args.endTime?.trim() || "now";

  // Over-fetch a little so exclusions removing rows do not silently shrink the
  // page below what the caller asked for.
  const page = await (client ?? recallClient(config)).search({
    query: args.query,
    contentType: CONTENT_TYPES[args.contentType ?? "all"] ?? "all",
    limit: Math.min(limit * 2, config.maxResults * 2),
    startTime: start,
    endTime: end,
    appName: args.appName,
    windowName: args.windowName,
  });

  return shapeSearchResults(page.hits as readonly RecallSearchHit[], {
    excludedWindows: settings.excludedWindows,
    limit,
    maxTextChars: config.maxResultChars,
    range: { start, end },
    hasMore: page.hasMore,
  });
}

export async function recallActivitySummary(
  userId: number,
  args: { startTime?: string; endTime?: string; appName?: string },
  {
    forAgent = false,
    config = getRecallConfig(),
    client,
  }: { forAgent?: boolean; config?: RecallConfig; client?: RecallClient } = {},
): Promise<Record<string, unknown>> {
  const settings = getRecallSettings(userId);
  assertReadable(settings, config, forAgent);
  const start =
    args.startTime?.trim() || `${settings.defaultLookbackHours}h ago`;
  const end = args.endTime?.trim() || "now";
  const summary = await (client ?? recallClient(config)).activitySummary({
    startTime: start,
    endTime: end,
    appName: args.appName,
  });
  return { range: { start, end }, summary };
}

export interface RecallMeetingsResult {
  meetings: RecallMeeting[];
  transcript?: RecallTranscriptSegment[];
}

export async function recallMeetings(
  userId: number,
  args: {
    query?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    meetingId?: number;
    includeTranscript?: boolean;
  },
  {
    forAgent = false,
    config = getRecallConfig(),
    client,
  }: { forAgent?: boolean; config?: RecallConfig; client?: RecallClient } = {},
): Promise<RecallMeetingsResult> {
  const settings = getRecallSettings(userId);
  assertReadable(settings, config, forAgent);
  const api = client ?? recallClient(config);

  if (typeof args.meetingId === "number" && Number.isFinite(args.meetingId)) {
    const meeting = await api.meeting(args.meetingId);
    const result: RecallMeetingsResult = { meetings: [meeting] };
    if (args.includeTranscript) {
      result.transcript = (await api.meetingTranscript(args.meetingId)).map(
        (segment) => ({
          ...segment,
          text: truncateCapturedText(segment.text, config.maxResultChars),
        }),
      );
    }
    return result;
  }

  const cap = Math.min(settings.maxResults, config.maxResults);
  return {
    meetings: await api.meetings({
      query: args.query,
      startTime: args.startTime,
      endTime: args.endTime,
      limit: Math.min(Math.max(args.limit ?? cap, 1), cap),
    }),
  };
}

export async function recallFrameContext(
  userId: number,
  frameId: number,
  {
    forAgent = false,
    config = getRecallConfig(),
    client,
  }: { forAgent?: boolean; config?: RecallConfig; client?: RecallClient } = {},
): Promise<Record<string, unknown>> {
  const settings = getRecallSettings(userId);
  assertReadable(settings, config, forAgent);
  if (!Number.isFinite(frameId)) {
    throw new RecallError("invalid_input", {
      detail: "frameId must be a number",
    });
  }
  const context = await (client ?? recallClient(config)).frameContext(frameId);

  // The frame's own app/window is enough to honour an exclusion added after
  // capture; without it the caller could read back exactly what they excluded.
  const app = typeof context.app_name === "string" ? context.app_name : null;
  const window =
    typeof context.window_name === "string" ? context.window_name : null;
  if (
    isExcluded({ appName: app, windowName: window }, settings.excludedWindows)
  ) {
    throw new RecallError("invalid_input", {
      userMessage: "That moment is from a window you excluded from Recall.",
      detail: "frame excluded by user policy",
    });
  }
  return context;
}

export type RecallControlAction =
  | "start"
  | "stop"
  | "start-audio"
  | "stop-audio";

export interface RecallControlResult {
  action: RecallControlAction;
  state: RecallProcessState;
  message: string;
}

async function observedRecallRuntimeStatus(
  userId: number,
): Promise<RecallRuntimeStatus | null> {
  if (!recallRuntimeManaged()) return null;
  return readRecallRuntimeStatus(userId).catch(() => null);
}

function reconciledProcessState(running: boolean): RecallProcessState {
  return {
    running,
    pid: null,
    startedAt: null,
    launchedWith: null,
    managed: true,
  };
}

/**
 * Start or stop capture. `start`/`stop` govern the whole engine (screen and
 * audio); the audio actions leave screen capture running.
 */
export async function controlRecall(
  userId: number,
  action: RecallControlAction,
  {
    config = getRecallConfig(),
    client,
  }: { config?: RecallConfig; client?: RecallClient } = {},
): Promise<RecallControlResult> {
  if (!config.enabled) throw new RecallError("feature_disabled");
  const settings = getRecallSettings(userId);

  switch (action) {
    case "start": {
      if (!settings.captureEnabled) throw new RecallError("capture_disabled");
      if (!installState(config).installed)
        throw new RecallError("not_installed");
      const before = await readRecallRuntimeStatus(userId).catch((cause) => {
        throw new RecallError("engine_start_failed", {
          detail: "could not inspect managed Recall state before start",
          cause,
        });
      });
      if (before?.desiredState === "running") {
        throw new RecallError("engine_already_running");
      }
      await reconcileRecallRuntime(userId, "running", settings);
      return {
        action,
        state: reconciledProcessState(true),
        message: "Recall capture is starting.",
      };
    }
    case "stop": {
      const before = await readRecallRuntimeStatus(userId).catch((cause) => {
        throw new RecallError("engine_stop_failed", {
          detail: "could not inspect managed Recall state before stop",
          cause,
        });
      });
      if (!before || before.desiredState === "stopped") {
        throw new RecallError("engine_not_running");
      }
      await reconcileRecallRuntime(userId, "stopped", null);
      return {
        action,
        state: reconciledProcessState(false),
        message: "Recall capture stopped.",
      };
    }
    case "start-audio":
    case "stop-audio": {
      await (client ?? recallClient(config)).setAudioCapture(
        action === "start-audio",
      );
      const runtimeStatus = await observedRecallRuntimeStatus(userId);
      return {
        action,
        state: projectRecallProcessState(runtimeStatus, recallRuntimeManaged()),
        message:
          action === "start-audio"
            ? "Microphone capture started."
            : "Microphone capture stopped.",
      };
    }
    default:
      throw new RecallError("invalid_input", {
        detail: `unknown action ${String(action)}`,
      });
  }
}

export interface RecallAutoStartResult {
  started: boolean;
  outcome:
    | RecallAutoStartOutcome
    | "start_failed"
    | "installing"
    | "install_failed"
    | "unsupported_platform";
  state: RecallProcessState;
}

/**
 * Prepare and resume capture when Breadboard opens, unless the owner opted out.
 *
 * This is the way the recorder starts without somebody pressing Start, so
 * it answers rather than throws: it runs unattended on every app open, where a
 * thrown error has no one to read it and the settings tab already explains
 * every reason capture might not be running. `recallAutoStartDecision` holds
 * the rule; this also checks for an existing engine and prepares a missing
 * installation before asking the native Runtime to start capture.
 */
export async function autoStartRecallCapture(
  userId: number,
  {
    config = getRecallConfig(),
    client,
  }: { config?: RecallConfig; client?: RecallClient } = {},
): Promise<RecallAutoStartResult> {
  const settings = getRecallSettings(userId);
  const managed = recallRuntimeManaged();
  const runtimeStatus = await observedRecallRuntimeStatus(userId);
  const state = projectRecallProcessState(runtimeStatus, managed);
  const install = installState(config);

  // A persisted running intent that has failed or is resource-blocked remains
  // native recovery authority. App load must not turn it into an unbounded
  // automatic retry; only a later explicit Start may request another attempt.
  let engineRunning = runtimeStatus?.desiredState === "running";
  if (
    config.enabled &&
    settings.autoStartCapture &&
    settings.captureEnabled &&
    !engineRunning
  ) {
    engineRunning = await (client ?? recallClient(config))
      .health()
      .then(() => true)
      .catch(() => false);
  }

  // The probes above await I/O. Honor an opt-out or updated exclusions saved
  // while they were in flight, rather than starting from a stale snapshot.
  const currentSettings = getRecallSettings(userId);
  const decision = recallAutoStartDecision({
    featureEnabled: config.enabled,
    settings: currentSettings,
    engineRunning,
    installed: install.installed,
  });
  if (decision === "not_installed") {
    if (!install.supported) return { started: false, outcome: "unsupported_platform", state };
    const progress = readInstallStatus(config);
    if (progress?.phase === "installing" && !progress.stalled) {
      return { started: false, outcome: "installing", state };
    }
    // A failed download needs an explicit retry in Settings, not a download
    // loop on every poll or navigation. A first installation is automatic.
    if (progress && (progress.stalled || ["error", "interrupted"].includes(progress.phase))) {
      return { started: false, outcome: "install_failed", state };
    }
    try {
      await startInstall(userId, config);
      return { started: false, outcome: "installing", state };
    } catch (error) {
      return {
        started: false,
        outcome: error instanceof RecallError && error.code === "install_in_progress"
          ? "installing" : "install_failed",
        state,
      };
    }
  }
  if (decision !== "start") return { started: false, outcome: decision, state };

  try {
    await reconcileRecallRuntime(userId, "running", currentSettings);
    const latest = getRecallSettings(userId);
    if (!latest.captureEnabled || !latest.autoStartCapture) {
      await reconcileRecallRuntime(userId, "stopped", null);
      return {
        started: false,
        outcome: latest.captureEnabled ? "not_opted_in" : "capture_disabled",
        state: reconciledProcessState(false),
      };
    }
    return {
      started: true,
      outcome: "start",
      state: reconciledProcessState(true),
    };
  } catch {
    const after = await observedRecallRuntimeStatus(userId);
    return {
      started: false,
      outcome: "start_failed",
      state: projectRecallProcessState(after, managed),
    };
  }
}

/** Persist the switch and apply it to the actual recorder, including opt-out. */
export async function saveRecallSettings(
  userId: number,
  patch: Record<string, unknown>,
): Promise<RecallSettings> {
  const settings = updateRecallSettings(userId, patch);
  if (!settings.captureEnabled) {
    // Do not swallow a failed stop: Settings must tell the user if the recorder
    // could still be running even though the durable preference is now off.
    const status = await readRecallRuntimeStatus(userId);
    if (status?.ownedByRequester && status.desiredState === "running") {
      await reconcileRecallRuntime(userId, "stopped", null);
    }
  } else if (patch.captureEnabled === true || patch.autoStartCapture === true) {
    await autoStartRecallCapture(userId);
  }
  return settings;
}
