import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerSaveBlocker,
  session,
  shell,
} from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LogManager } from "./log-manager";
import {
  ensureMutableDirectories,
  resolvePaths,
  repoRootFromModuleDir,
  type ResolvedPaths,
} from "./path-resolver";
import {
  loadOrCreatePersistentConfig,
  redactSecrets,
  redactedPersistentConfigSummary,
  savePersistentConfig,
  type PersistentDesktopConfig,
} from "./runtime-config";
import {
  detectDevInstallation,
  executeMigration,
  looksLikeSqliteDatabase,
  planMigration,
  MIGRATION_VERSION,
} from "./migration";
import { preflightQaDashboardDevelopment } from "./provisioning";
import { prepareDevelopmentCliproxyRuntime } from "./cliproxy";
import {
  WindowManager,
  defaultPreloadPath,
  defaultStartupHtmlPath,
} from "./window-manager";
import { BROWSER_SESSION_PARTITION, BROWSER_TAB_PATH } from "./tab-manager";
import { BrowserDownloads } from "./browser-downloads";
import { BreadboardUseBridge } from "./breadboard-use";
import {
  allowThemeLocationFor,
  allowedOriginsFor,
  installGlobalSecurity,
  isNavigationAllowed,
  revokeThemeLocationFor,
  type AllowedOrigins,
} from "./security";
import {
  IPC_CHANNELS,
  isBrowserBookmarkOwnerKey,
  isBrowserBookmarks,
  isBrowserRecentSearches,
  isBrowserHistoryCommand,
  isBrowserDownloadCommand,
  isTabsCommand,
} from "../shared/ipc-contract";
import {
  runtimeProductCopy,
  runtimeProductText,
} from "../shared/runtime-product-copy";
import {
  backgroundColorForSurface,
  isWindowSurface,
  titleBarForSurface,
} from "./window-options";
import { installGpuDiagnostics } from "./gpu-diagnostics";
import {
  claimDevInstance,
  duplicateStackWarning,
  releaseDevInstance,
  requiresExclusiveHotCheckout,
} from "./dev-instance-lock";
import { openMicrophoneSettings } from "./microphone-settings";
import {
  isWindowThemeSchedule,
  readLastWindowTheme,
  writeLastWindowTheme,
} from "./theme-state";
import {
  readStartupSoundEnabled,
  writeStartupSoundEnabled,
} from "./startup-sound";
import {
  readBrowserNavigationEnabled,
  writeBrowserNavigationEnabled,
} from "./browser-navigation";
import {
  readBrowserBookmarks,
  writeBrowserBookmarks,
  readBrowserShortcuts,
  writeBrowserShortcuts,
} from "./browser-bookmarks";
import { readBrowserRecentSearches, writeBrowserRecentSearches } from "./browser-recent-searches";
import {
  readCurrentLocationPreference,
  writeCurrentLocationPreference,
} from "./current-location-preference";
import type { QaServiceProfile } from "./startup-options";
import {
  configureBrowserAgentDebugging,
  resolveBrowserAgentDebuggingPort,
  writeBrowserAgentSessionReceipt,
} from "./browser-agent-session";
import {
  RuntimeProcess,
  type RuntimeLaunchMode,
  type RuntimeProcessOptions,
  type RuntimeReadySnapshot,
  type RuntimeServiceStatus,
  type RuntimeStatusSnapshot,
} from "./runtime-process";
import { runtimeLaunchMode } from "./runtime-launch-mode";
import { runtimeInitialStartupTimeoutMs } from "./runtime-startup-timeout";
import {
  classifyRuntimeStartup,
  runtimeStartupFailureReason,
} from "./runtime-startup-state";
import { inhibitSystemSleepUntilQuit } from "./sleep-inhibitor";
import {
  ComputerUseIndicator,
  defaultComputerUseOverlayHtmlPath,
} from "./computer-use-indicator";
import { rebuildDevelopmentInstallation } from "./development-rebuild";
import { createClickyLauncher } from "./clicky-launcher";
import { ClickyCompanion } from "./clicky-companion";
import { VoiceCompanion } from "./voice-companion";
import { createWindowsInput } from "./windows-click";

export interface StartupFailure {
  serviceId: string;
  displayName: string;
  reason: string;
  logTail: string[];
}

export interface StartupState {
  phase: "preparing" | "starting" | "ready" | "failed";
  message: string;
  services: Array<{
    id: string;
    displayName: string;
    required: boolean;
    state: string;
    lastError: string | null;
    restarts: number;
    /** Reused from an instance that was already running, not started here. */
    adopted: boolean;
  }>;
  failure?: StartupFailure;
}

export interface UnhandledRejectionActions {
  writeDiagnostic(line: string): void;
  killAllNow(): void;
  exit(code: number): void;
}

/**
 * The runtime root is not one of the services returned by Runtime status. Give
 * its startup-card Retry action a distinct target so it cannot be rejected by
 * service-level validation (or confused with a failed data-preparation step).
 */
export const RUNTIME_ROOT_RETRY_ID = "desktop-runtime";

/**
 * Closing the desktop window must return control to its launcher promptly.
 * Runtime V2 has its own longer internal drain ceiling, but Electron cannot
 * wait for that entire ceiling after its last visible window has disappeared.
 */
export const DESKTOP_RUNTIME_EXIT_TIMEOUTS = Object.freeze({
  controlRequestTimeoutMs: 2_000,
  gracefulShutdownTimeoutMs: 5_000,
  forcedShutdownTimeoutMs: 3_000,
});

/**
 * A fail-closed Runtime root is intentionally single-use. The desktop owns
 * recovery by replacing it with a fresh root, using a capped backoff so a
 * persistent machine/configuration failure cannot become a tight spawn loop.
 */
export const RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
]);
export const RUNTIME_ROOT_STABILITY_WINDOW_MS = 60_000;

export function runtimeRootAutoRetryDelayMs(attempt: number): number {
  const boundedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  const finalDelay =
    RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS[
      RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS.length - 1
    ] ?? 30_000;
  return (
    RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS[
      Math.min(boundedAttempt, RUNTIME_ROOT_AUTO_RETRY_DELAYS_MS.length - 1)
    ] ?? finalDelay
  );
}

/**
 * Install the fatal unhandled-rejection path through injectable actions so the
 * process-level behavior can be covered without terminating the test runner.
 */
export function installUnhandledRejectionGuard(
  subscribe: (listener: (reason: unknown) => void) => void,
  actions: UnhandledRejectionActions,
): void {
  subscribe((reason) => {
    try {
      actions.writeDiagnostic(
        `[desktop] unhandled rejection: ${unhandledRejectionReason(reason)}`,
      );
    } catch {
      // Logging must not block emergency cleanup.
    }
    try {
      actions.killAllNow();
    } finally {
      actions.exit(1);
    }
  });
}

function unhandledRejectionReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  if (
    reason === null ||
    reason === undefined ||
    typeof reason === "string" ||
    typeof reason === "number" ||
    typeof reason === "boolean" ||
    typeof reason === "bigint"
  ) {
    return String(reason);
  }
  // Do not serialize arbitrary objects: a rejected integration response can
  // contain credentials that are not part of the desktop's known-secret set.
  return `non-Error ${Object.prototype.toString.call(reason)}`;
}

/**
 * The Electron application lifecycle prepares user data, owns the windows, and
 * launches exactly one fixed Runtime V2 root. Rust alone supervises every
 * service/worker descendant and closes the complete process tree on exit.
 */
export class AppLifecycle {
  private paths!: ResolvedPaths;
  private persistentConfig!: PersistentDesktopConfig;
  private logs!: LogManager;
  private windows!: WindowManager;
  private browserDownloads!: BrowserDownloads;
  private runtime: RuntimeProcess | null = null;
  private runtimeDashboardUrl: string | null = null;
  private allowedOrigins!: AllowedOrigins;
  private runtimeStatusTimer: NodeJS.Timeout | null = null;
  private runtimeStatusRefreshInFlight = false;
  private runtimeRestartInFlight: Promise<boolean> | null = null;
  private runtimeRootRetryTimer: NodeJS.Timeout | null = null;
  private runtimeRootStabilityTimer: NodeJS.Timeout | null = null;
  private runtimeRootRetryAttempt = 0;
  private appRestartInFlight: Promise<boolean> | null = null;
  private lastRuntimeStatusSignature: string | null = null;
  private dashboardShown = false;
  private startupState: StartupState = {
    phase: "preparing",
    message: "Preparing Breadboard",
    services: [],
  };
  private quitting = false;
  private runtimeStopped = false;
  private computerUseIndicator: ComputerUseIndicator | null = null;
  private clickyCompanion: ClickyCompanion | null = null;
  private voiceCompanion: VoiceCompanion | null = null;
  /** Random loopback-only CDP port reserved for visible browser-agent tabs. */
  private browserAgentDebuggingPort: number | null = null;
  private breadboardUse: BreadboardUseBridge | null = null;
  /** Set only after this process successfully claims a Hot dev checkout. */
  private devInstanceLockRepoRoot: string | null = null;
  private readonly moduleDir: string;
  private readonly forceDev: boolean;
  private readonly qaMode: boolean;
  private readonly qaServiceProfile: QaServiceProfile;

  constructor(
    moduleDir: string,
    forceDev: boolean,
    qaMode = false,
    qaServiceProfile: QaServiceProfile = "critical",
  ) {
    this.moduleDir = moduleDir;
    this.forceDev = forceDev;
    this.qaMode = qaMode;
    this.qaServiceProfile = qaServiceProfile;
    // This must precede run(): startup itself contains several awaited steps,
    // and Playwright cannot observe a rejection that predates its attachment.
    installUnhandledRejectionGuard(
      (listener) => process.on("unhandledRejection", listener),
      {
        writeDiagnostic: (line) => {
          if (this.logs) {
            // The LogManager applies the existing per-install secret redactor.
            this.logs.forService("desktop").write(line);
          } else {
            // Before config exists there is no safe known-secret set. Preserve
            // the failure category on stderr without printing its payload.
            console.error(
              "[breadboard-desktop] unhandled rejection before desktop logging initialized",
            );
          }
        },
        killAllNow: () => this.runtime?.terminateNow(),
        exit: (code) => process.exit(code),
      },
    );
  }

  async run(): Promise<void> {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    this.browserAgentDebuggingPort = configureBrowserAgentDebugging(
      app.commandLine,
      app.getPath("userData"),
    );
    app.on("second-instance", () => {
      const window = this.windows?.window;
      if (window) {
        if (window.isMinimized()) window.restore();
        if (!window.isVisible()) window.show();
        window.focus();
      }
    });

    await app.whenReady();

    inhibitSystemSleepUntilQuit(powerSaveBlocker, (listener) => {
      app.once("will-quit", listener);
    });

    this.paths = resolvePaths({
      isPackaged: app.isPackaged,
      forceDev: this.forceDev,
      qaMode: this.qaMode,
      userDataDir: app.getPath("userData"),
      electronResourcesPath: process.resourcesPath,
      moduleDir: this.moduleDir,
    });
    ensureMutableDirectories(this.paths);

    this.persistentConfig = loadOrCreatePersistentConfig(this.paths.configDir);

    this.logs = new LogManager({
      logsDir: this.paths.logsDir,
      redact: (line) =>
        runtimeProductText(redactSecrets(line, this.persistentConfig)),
    });
    const supervisorLog = this.logs.forService("desktop");
    supervisorLog.write(
      `[desktop] starting; mode=${this.paths.mode}${this.paths.qaMode ? `; qa-profile=${this.qaServiceProfile}` : ""}; config=${JSON.stringify(redactedPersistentConfigSummary(this.persistentConfig))}`,
    );

    const launchMode = runtimeLaunchMode(this.paths.mode);
    const attachedDashboardUrl = (() => {
      const configured = process.env["BREADBOARD_DESKTOP_ATTACH_DASHBOARD_URL"]?.trim();
      if (!configured) return null;
      const parsed = new URL(configured);
      if (
        parsed.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(
          "BREADBOARD_DESKTOP_ATTACH_DASHBOARD_URL must be an unauthenticated loopback HTTP URL.",
        );
      }
      return parsed.toString();
    })();
    let hotCheckoutFailure: string | null = null;
    if (
      requiresExclusiveHotCheckout({
        desktopMode: this.paths.mode,
        launchMode,
        qaMode: this.paths.qaMode,
      })
    ) {
      const repoRoot = repoRootFromModuleDir(this.moduleDir);
      try {
        const claim = claimDevInstance({ repoRoot, owner: "desktop" });
        if (claim.conflict && claim.existing) {
          hotCheckoutFailure = duplicateStackWarning(claim.existing);
          supervisorLog.write(
            `[desktop] Hot checkout launch blocked: ${hotCheckoutFailure}`,
          );
        } else {
          if (claim.staleReplaced) {
            supervisorLog.write(
              "[desktop] replaced a stale development-instance lock",
            );
          }
          this.devInstanceLockRepoRoot = repoRoot;
        }
      } catch (error) {
        hotCheckoutFailure =
          error instanceof Error ? error.message : String(error);
        supervisorLog.write(
          `[desktop] Hot checkout launch blocked: ${hotCheckoutFailure}`,
        );
      }
    }

    installGpuDiagnostics(
      {
        onChildProcessGone: (listener) =>
          void app.on("child-process-gone", (_event, details) =>
            listener(details),
          ),
        // GPUFeatureStatus is a fixed-key interface, not an index signature.
        getGPUFeatureStatus: () =>
          ({ ...app.getGPUFeatureStatus() }) as Record<string, unknown>,
        getGPUInfo: (mode) => app.getGPUInfo(mode),
      },
      (line) => supervisorLog.write(line),
    );

    if (hotCheckoutFailure === null && attachedDashboardUrl === null) {
      this.runtime = new RuntimeProcess({
        ...this.runtimeProcessOptions(launchMode),
        startupTimeoutMs: runtimeInitialStartupTimeoutMs(this.paths.runtimeRoot, launchMode),
      });
    }

    const startupHtmlPath = defaultStartupHtmlPath(this.moduleDir);
    const recoveryHtmlPath = path.join(
      path.dirname(startupHtmlPath),
      "recovery.html",
    );
    const loadingHtmlPath = path.join(
      path.dirname(startupHtmlPath),
      "loading.html",
    );
    const computerUseOverlayHtmlPath = defaultComputerUseOverlayHtmlPath(this.moduleDir);
    this.allowedOrigins = allowedOriginsFor([
      pathToFileURL(startupHtmlPath).toString(),
      pathToFileURL(recoveryHtmlPath).toString(),
      pathToFileURL(loadingHtmlPath).toString(),
      pathToFileURL(computerUseOverlayHtmlPath).toString(),
    ]);
    installGlobalSecurity(this.allowedOrigins);

    this.browserDownloads = new BrowserDownloads(this.paths.configDir, shell, (line) => supervisorLog.write(line));
    this.browserDownloads.attach(session.fromPartition(BROWSER_SESSION_PARTITION));
    app.on("before-quit", () => this.browserDownloads.prepareForQuit());

    this.windows = new WindowManager({
      allowed: this.allowedOrigins,
      startupHtmlPath,
      recoveryHtmlPath,
      loadingHtmlPath,
      preloadPath: defaultPreloadPath(this.moduleDir),
      iconPath: this.iconPath(),
      initialTheme: readLastWindowTheme(this.paths.configDir),
      // Window recovery runs entirely in the main process, where nothing else
      // is written down. A reconnect scene that never lifts is unexplainable
      // without this.
      log: (line) => supervisorLog.write(line),
      onMainWindowCloseRequested: () => {
        this.computerUseIndicator?.stop();
        // Popup/controller windows must not turn closing Breadboard's main
        // window into a hidden background session. Defer until the native
        // close event has unwound; window-all-closed may request the same quit
        // first, and `quitting` makes the two paths idempotent.
        setImmediate(() => {
          if (!this.quitting) app.quit();
        });
      },
      devTools: this.paths.mode === "dev",
      browserExtensionsConfigDir: this.paths.configDir,
      browserVisitedLinksConfigDir: this.paths.configDir,
      browserHistoryConfigDir: this.paths.configDir,
      tabSessionConfigDir: this.paths.configDir,
      onBrowserAgentPageReady: async (runId, targetUrl) => {
        const debuggingPort = this.browserAgentDebuggingPort;
        if (!debuggingPort) return false;
        const cdpPort = await resolveBrowserAgentDebuggingPort(
          debuggingPort,
          targetUrl,
        );
        if (!cdpPort) {
          supervisorLog.write(
            `[desktop] could not resolve the built-in browser target for ${runId}`,
          );
          return false;
        }
        try {
          writeBrowserAgentSessionReceipt(this.paths.dataRoot, {
            protocolVersion: 1,
            runId,
            cdpPort,
            targetUrl,
            createdAt: new Date().toISOString(),
          });
          return true;
        } catch (error) {
          supervisorLog.write(
            `[desktop] could not publish the built-in browser target for ${runId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return false;
        }
      },
    });
    this.windows.tabs.setEnabled(readBrowserNavigationEnabled(this.paths.configDir));
    this.breadboardUse = new BreadboardUseBridge({
      tabs: this.windows.tabs, dataRoot: this.paths.dataRoot,
      dashboardUrl: () => this.runtimeDashboardUrl,
      clicky: () => this.clickyLauncher(),
    });
    await this.breadboardUse.start();

    this.computerUseIndicator = new ComputerUseIndicator({
      dataDir: path.join(this.paths.dataRoot, "ui-tars"),
      overlayHtmlPath: computerUseOverlayHtmlPath,
      allowed: this.allowedOrigins,
      log: (line) => supervisorLog.write(line),
    });
    this.computerUseIndicator.start();

    this.registerIpcHandlers();
    this.registerExitGuards();
    this.installApplicationMenu();

    await this.windows.showStartupScreen();

    if (hotCheckoutFailure !== null) {
      this.failRuntimeStartup(hotCheckoutFailure);
      return;
    }

    try {
      await this.prepareDataLayer();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      supervisorLog.write(`[desktop] data preparation failed: ${reason}`);
      this.setStartupState({
        phase: "failed",
        message: "Breadboard could not prepare its data folder",
        services: [],
        failure: {
          serviceId: "desktop",
          displayName: "Breadboard data",
          reason,
          logTail: supervisorLog.readTail(20),
        },
      });
      return;
    }

    if (attachedDashboardUrl !== null) {
      this.runtimeDashboardUrl = attachedDashboardUrl;
      this.allowDashboardOrigin(attachedDashboardUrl);
      this.startVoiceCompanion();
      this.windows.tabs.setNewTabUrl(new URL("/new-tab", attachedDashboardUrl).toString());
      this.windows.tabs.setBrowserUrl(new URL(BROWSER_TAB_PATH, attachedDashboardUrl).toString());
      this.dashboardShown = true;
      this.setStartupState({ phase: "ready", message: "Ready", services: [] });
      await this.windows.showDashboard(
        attachedDashboardUrl,
        new URL("/new-tab", attachedDashboardUrl).toString(),
      );
      return;
    }

    await this.startRuntime();
  }

  private iconPath(): string | undefined {
    const icon = path.join(
      this.paths.mode === "packaged"
        ? path.join(this.paths.resourcesRoot, "assets")
        : path.join(repoRootFromModuleDir(this.moduleDir), "desktop", "assets"),
      "icon.ico",
    );
    return icon;
  }

  /** A RuntimeProcess owns one OS process exactly once; retries get a new owner. */
  private createRuntimeProcess(): RuntimeProcess {
    const launchMode = runtimeLaunchMode(this.paths.mode);
    return new RuntimeProcess({
      ...this.runtimeProcessOptions(launchMode),
      startupTimeoutMs: runtimeInitialStartupTimeoutMs(this.paths.runtimeRoot, launchMode),
    });
  }

  private runtimeProcessOptions(
    launchMode: RuntimeLaunchMode,
  ): Omit<RuntimeProcessOptions, "startupTimeoutMs"> {
    const supervisorLog = this.logs.forService("desktop");
    return {
      binDir: this.paths.binDir,
      bootstrap: {
        mode: launchMode,
        appRoot: this.paths.appRoot,
        runtimeRoot: this.paths.runtimeRoot,
        dataRoot: this.paths.dataRoot,
        configRoot: this.paths.configDir,
      },
      ...DESKTOP_RUNTIME_EXIT_TIMEOUTS,
      onLog: (source, line) =>
        supervisorLog.write(`[runtime:${source}] ${line}`),
      onUnexpectedExit: (exit) => this.handleUnexpectedRuntimeExit(exit),
    };
  }

  private async prepareDataLayer(): Promise<void> {
    preflightQaDashboardDevelopment(this.paths);

    // QA data is always fresh/disposable. Never detect or copy a developer
    // checkout into it: doing so would make scenarios non-deterministic and
    // risks pulling real user content into failure artifacts.
    if (this.paths.qaMode) return;

    // 2. One-time migration from a detected dev checkout (copy, never delete).
    const persistent = this.persistentConfig;
    if (persistent.migrationVersion < MIGRATION_VERSION) {
      const candidates = [
        process.env["BREADBOARD_MIGRATE_FROM"] ?? "",
        repoRootFromModuleDir(this.moduleDir),
      ].filter((candidate) => candidate.length > 0);
      const source = candidates.find((candidate) =>
        detectDevInstallation(candidate),
      );
      if (source) {
        const plan = planMigration(source, this.migrationTargets());
        const pending = plan.items.filter(
          (item) => item.exists && !item.alreadyMigrated,
        );
        if (pending.length > 0) {
          const choice = await dialog.showMessageBox({
            type: "question",
            title: "Import existing Breadboard data?",
            message:
              "An existing Breadboard workspace was found on this computer.",
            detail:
              `Location: ${source}\n\nThe following will be copied (originals stay untouched):\n` +
              pending.map((item) => `  • ${item.label}`).join("\n"),
            buttons: ["Import a copy", "Start fresh"],
            defaultId: 0,
            cancelId: 1,
          });
          if (choice.response === 0) {
            this.setStartupState({
              ...this.startupState,
              message: "Importing your existing gardens",
            });
            const result = executeMigration(plan, this.migrationTargets());
            const brainDb = path.join(this.paths.databaseDir, "brain.db");
            if (
              result.performed.some((item) => item.destination === brainDb) &&
              !looksLikeSqliteDatabase(brainDb)
            ) {
              throw new Error(
                "The imported database failed validation. See the migration report in the config folder.",
              );
            }
            persistent.migratedFrom = source;
          }
        }
      }
      persistent.migrationVersion = MIGRATION_VERSION;
      savePersistentConfig(this.paths.configDir, persistent);
    }

    // Runtime V2's hot/lean CLIProxyAPI launch profile uses a data-root
    // executable. Restore the first-run preparation that the cutover omitted;
    // subscriptions remain optional, so an offline download never blocks the
    // rest of Breadboard from starting.
    if (persistent.cliproxyMode !== "disabled") {
      try {
        await prepareDevelopmentCliproxyRuntime(this.paths, (message) =>
          this.logs.forService("desktop").write(`[desktop] ${message}`),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logs
          .forService("desktop")
          .write(`[desktop] CLIProxyAPI preparation failed: ${reason}`);
      }
    }
  }

  private migrationTargets() {
    return {
      databaseDir: this.paths.databaseDir,
      quartzContent: this.paths.quartzContent,
      backupsDir: this.paths.backupsDir,
      configDir: this.paths.configDir,
    };
  }

  private async startRuntime(): Promise<void> {
    if (!this.runtime) {
      this.failRuntimeStartup("Runtime was not initialized.");
      return;
    }
    this.setStartupState({
      phase: "starting",
      message: "Starting local services",
      services: [],
    });
    try {
      const ready = await this.runtime.start();
      this.runtimeDashboardUrl = ready.dashboardUrl;
      this.allowDashboardOrigin(ready.dashboardUrl);
      this.startVoiceCompanion();
      this.windows.tabs.setNewTabUrl(new URL("/new-tab", ready.dashboardUrl).toString());
      this.windows.tabs.setBrowserUrl(new URL(BROWSER_TAB_PATH, ready.dashboardUrl).toString());
      const status = await this.runtime.status();
      this.startRuntimeStatusPolling();
      await this.applyRuntimeSnapshot(status);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logs
        .forService("desktop")
        .write(`[desktop] Runtime startup failed: ${reason}`);
      this.failRuntimeStartup(reason);
    }
  }

  private retryRuntimeRoot(): Promise<boolean> {
    this.clearScheduledRuntimeRootRetry();
    if (this.runtimeRestartInFlight) return this.runtimeRestartInFlight;
    const retry = this.retryRuntimeRootOnce();
    this.runtimeRestartInFlight = retry;
    const clearRetry = (ready: boolean) => {
      if (this.runtimeRestartInFlight === retry) {
        this.runtimeRestartInFlight = null;
      }
      if (!ready) this.scheduleRuntimeRootRetry();
    };
    // Observe both outcomes without creating the rejected promise that
    // `finally()` would return and leave detached from the IPC invocation.
    void retry.then(clearRetry, () => clearRetry(false));
    return retry;
  }

  private clearScheduledRuntimeRootRetry(): void {
    if (!this.runtimeRootRetryTimer) return;
    clearTimeout(this.runtimeRootRetryTimer);
    this.runtimeRootRetryTimer = null;
  }

  private clearRuntimeRootStabilityTimer(): void {
    if (!this.runtimeRootStabilityTimer) return;
    clearTimeout(this.runtimeRootStabilityTimer);
    this.runtimeRootStabilityTimer = null;
  }

  private scheduleRuntimeRootRetry(): void {
    if (
      this.quitting ||
      this.runtimeStopped ||
      this.runtimeRootRetryTimer ||
      this.runtimeRestartInFlight
    ) {
      return;
    }
    const attempt = this.runtimeRootRetryAttempt;
    const delayMs = runtimeRootAutoRetryDelayMs(attempt);
    this.runtimeRootRetryAttempt = attempt + 1;
    this.logs
      ?.forService("desktop")
      .write(
        `[desktop] scheduling Runtime recovery attempt ${attempt + 1} in ${delayMs}ms`,
      );
    this.runtimeRootRetryTimer = setTimeout(() => {
      this.runtimeRootRetryTimer = null;
      if (this.quitting || this.runtimeStopped) return;
      void this.retryRuntimeRoot();
    }, delayMs);
    this.runtimeRootRetryTimer.unref?.();
  }

  private armRuntimeRootStabilityReset(): void {
    this.clearRuntimeRootStabilityTimer();
    this.runtimeRootStabilityTimer = setTimeout(() => {
      this.runtimeRootStabilityTimer = null;
      if (this.quitting || this.runtime?.state !== "ready") return;
      this.runtimeRootRetryAttempt = 0;
      this.logs
        ?.forService("desktop")
        .write("[desktop] Runtime recovery is stable; retry backoff reset");
    }, RUNTIME_ROOT_STABILITY_WINDOW_MS);
    this.runtimeRootStabilityTimer.unref?.();
  }

  private async retryRuntimeRootOnce(): Promise<boolean> {
    if (this.quitting) return false;
    const previousRuntime = this.runtime;
    if (!previousRuntime) return false;

    this.clearRuntimeRootStabilityTimer();
    this.stopRuntimeStatusPolling();
    const stopped = await previousRuntime.stop();
    if (!stopped.exited) {
      this.failRuntimeStartup(
        "The previous Runtime process could not be stopped safely. Quit Breadboard before trying again.",
      );
      return false;
    }

    if (this.runtimeDashboardUrl) {
      this.allowedOrigins.origins.delete(new URL(this.runtimeDashboardUrl).origin);
    }
    this.runtimeDashboardUrl = null;
    this.windows.tabs.setNewTabUrl(null);
    this.windows.tabs.setBrowserUrl(null);
    this.dashboardShown = false;
    this.lastRuntimeStatusSignature = null;
    this.runtime = this.createRuntimeProcess();
    await this.startRuntime();
    return this.runtime.state === "ready";
  }

  private allowDashboardOrigin(dashboardUrl: string): void {
    this.allowedOrigins.origins.add(new URL(dashboardUrl).origin);
  }

  private runtimeServices(
    snapshot: RuntimeReadySnapshot | RuntimeStatusSnapshot,
  ): StartupState["services"] {
    return snapshot.services.map((status) => ({
      id: status.id,
      displayName: status.displayName,
      required: status.required,
      state: status.state,
      lastError: status.lastError,
      restarts: status.restarts,
      adopted: false,
    }));
  }

  private async applyRuntimeSnapshot(
    snapshot: RuntimeStatusSnapshot,
  ): Promise<void> {
    const signature = JSON.stringify({
      acceptingWork: snapshot.acceptingWork,
      services: snapshot.services,
    });
    if (signature === this.lastRuntimeStatusSignature) return;
    const classification = classifyRuntimeStartup(snapshot.services);
    const services = this.runtimeServices(snapshot);
    if (classification.failure) {
      const failed = classification.failure;
      this.dashboardShown = false;
      this.setStartupState({
        phase: "failed",
        message: classification.message,
        services,
        failure: {
          serviceId: failed.id,
          displayName: failed.displayName,
          reason: runtimeStartupFailureReason(failed),
          logTail: this.logs.forService("desktop").readTail(20),
        },
      });
      await this.windows.showStartupScreen();
      this.lastRuntimeStatusSignature = signature;
      return;
    }

    if (classification.phase !== "ready" || !snapshot.acceptingWork) {
      this.setStartupState({
        phase: "starting",
        message:
          classification.phase === "ready"
            ? "Finishing local service recovery"
            : classification.message,
        services,
      });
      this.lastRuntimeStatusSignature = signature;
      return;
    }

    this.setStartupState({ phase: "ready", message: "Ready", services });
    this.armRuntimeRootStabilityReset();
    const dashboardUrl = this.runtimeDashboardUrl;
    if (!this.dashboardShown && dashboardUrl) {
      this.dashboardShown = true;
      try {
        await this.windows.showDashboard(
          dashboardUrl,
          new URL("/new-tab", dashboardUrl).toString(),
        );
      } catch (error) {
        this.dashboardShown = false;
        this.lastRuntimeStatusSignature = null;
        throw error;
      }
    }
    this.lastRuntimeStatusSignature = signature;
  }

  private startRuntimeStatusPolling(): void {
    if (this.runtimeStatusTimer) return;
    this.runtimeStatusTimer = setInterval(() => {
      void this.refreshRuntimeStatus();
    }, 2_000);
    this.runtimeStatusTimer.unref?.();
  }

  private stopRuntimeStatusPolling(): void {
    if (!this.runtimeStatusTimer) return;
    clearInterval(this.runtimeStatusTimer);
    this.runtimeStatusTimer = null;
  }

  private async refreshRuntimeStatus(): Promise<void> {
    if (this.runtimeStatusRefreshInFlight || this.quitting) return;
    const runtime = this.runtime;
    if (!runtime || runtime.state !== "ready") return;
    this.runtimeStatusRefreshInFlight = true;
    try {
      await this.applyRuntimeSnapshot(await runtime.status());
    } catch {
      // A transient control read cannot create a second owner or change the UI
      // to a false terminal state. Process exit is reported by the fixed-root
      // adapter's onUnexpectedExit callback.
    } finally {
      this.runtimeStatusRefreshInFlight = false;
    }
  }

  private failRuntimeStartup(reason: string): void {
    this.lastRuntimeStatusSignature = null;
    const snapshot = this.runtime?.snapshot() ?? null;
    this.setStartupState({
      phase: "failed",
      message: "Breadboard Runtime could not start",
      services: snapshot ? this.runtimeServices(snapshot) : [],
      failure: {
        serviceId: RUNTIME_ROOT_RETRY_ID,
        displayName: "Breadboard Runtime",
        reason,
        logTail: this.logs.forService("desktop").readTail(20),
      },
    });
  }

  private handleUnexpectedRuntimeExit(exit: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }): void {
    if (this.quitting || this.runtimeStopped) return;
    this.stopRuntimeStatusPolling();
    this.clearRuntimeRootStabilityTimer();
    this.lastRuntimeStatusSignature = null;
    const reason = exit.signal
      ? `Runtime stopped with signal ${exit.signal}.`
      : `Runtime stopped with exit code ${exit.code ?? "unknown"}.`;
    this.logs?.forService("desktop").write(`[desktop] ${reason}`);
    if (!this.windows) return;
    this.failRuntimeStartup(reason);
    this.dashboardShown = false;
    void this.windows.showStartupScreen();
    this.scheduleRuntimeRootRetry();
  }

  private setStartupState(state: StartupState): void {
    const productState = runtimeProductCopy(state);
    this.startupState = productState;
    this.windows.sendToRenderer(IPC_CHANNELS.startupState, productState);
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.getVersions, () => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? "unknown",
    }));
    ipcMain.handle(IPC_CHANNELS.getStartupState, () => this.startupState);
    ipcMain.handle(
      IPC_CHANNELS.retryService,
      async (_event, serviceId: unknown) => {
        if (
          serviceId === RUNTIME_ROOT_RETRY_ID &&
          this.startupState.failure?.serviceId === RUNTIME_ROOT_RETRY_ID
        ) {
          return this.retryRuntimeRoot();
        }
        const runtime = this.runtime;
        const snapshot = runtime?.snapshot();
        if (typeof serviceId !== "string" || !runtime || !snapshot)
          return false;
        const known = snapshot.services.some(
          (status) =>
            status.id === serviceId &&
            ["failed", "resource-blocked", "installation-unavailable"].includes(
              status.state,
            ),
        );
        if (!known) return false;
        this.lastRuntimeStatusSignature = null;
        this.setStartupState({
          phase: "starting",
          message: "Retrying",
          services: this.runtimeServices(snapshot),
        });
        try {
          const result = await runtime.retryService(serviceId);
          await this.applyRuntimeSnapshot(await runtime.status());
          return result.accepted;
        } catch {
          await this.refreshRuntimeStatus();
          return false;
        }
      },
    );
    ipcMain.handle(IPC_CHANNELS.openLogs, async () => {
      await shell.openPath(this.logs.directory);
    });
    ipcMain.handle(IPC_CHANNELS.copyDiagnostics, () => {
      const diagnostics = {
        app: app.getVersion(),
        electron: process.versions.electron,
        mode: this.paths.mode,
        config: redactedPersistentConfigSummary(this.persistentConfig),
        runtime: this.runtime?.snapshot() ?? null,
        services: this.runtime?.snapshot()?.services ?? [],
        failure: this.startupState.failure ?? null,
      };
      clipboard.writeText(
        JSON.stringify(runtimeProductCopy(diagnostics), null, 2),
      );
    });
    ipcMain.handle(IPC_CHANNELS.quit, () => {
      app.quit();
    });
    ipcMain.handle(IPC_CHANNELS.restartApp, (event) => {
      const window = this.windowForSender(event.sender);
      if (!window || window.isDestroyed()) return false;
      return this.restartApplication();
    });
    ipcMain.handle(IPC_CHANNELS.startupContinue, () => {
      this.windows.markStartupContinued();
    });
    ipcMain.handle(IPC_CHANNELS.startupAwaitDashboard, async () => {
      await this.windows.waitForDashboardPaint();
    });
    ipcMain.handle(IPC_CHANNELS.pickFolder, async () => {
      const window = this.windows.window;
      if (!window) return null;
      const result = await dialog.showOpenDialog(window, {
        title: "Choose a folder to grant access to",
        properties: ["openDirectory", "dontAddToRecent"],
      });
      const selected = result.filePaths[0];
      if (result.canceled || !selected) return null;
      try {
        // Canonicalize (resolves junctions/symlinks) so the grant stored by
        // Breadboard's filesystem-grant flow matches the real location.
        return fs.realpathSync(path.resolve(selected));
      } catch {
        return null;
      }
    });
    ipcMain.handle(IPC_CHANNELS.openMicrophoneSettings, async (event) => {
      const window = this.windowForSender(event.sender);
      if (!window || window.isDestroyed()) return false;
      return openMicrophoneSettings();
    });
    ipcMain.handle(IPC_CHANNELS.allowThemeLocation, (event) => {
      const window = this.windowForSender(event.sender);
      if (!window || window.isDestroyed()) return false;
      const webContentsId = event.sender.id;
      if (allowThemeLocationFor(webContentsId)) {
        event.sender.once("destroyed", () => {
          revokeThemeLocationFor(webContentsId);
        });
      }
      return true;
    });
    ipcMain.handle(
      IPC_CHANNELS.setTheme,
      (event, surface: unknown, schedule: unknown) => {
        if (!isWindowSurface(surface)) return false;
        const window = this.windowForSender(event.sender);
        if (!window || window.isDestroyed()) return false;
        window.setBackgroundColor(backgroundColorForSurface(surface));
        if (process.platform === "win32") {
          window.setTitleBarOverlay(titleBarForSurface(surface));
        }
        // Windows forgets an overlay's colours whenever it rebuilds the frame, so
        // the manager keeps what this window asked for and states it again.
        this.windows.rememberWindowSurface(window, surface);
        if (surface === "light" || surface === "dark") {
          this.windows.rememberTheme(surface);
          try {
            // The dashboard says how it chose the theme, so the next launch can
            // open on the right side of sunrise. A malformed schedule is treated
            // as none: the chrome still follows the page.
            writeLastWindowTheme(
              this.paths.configDir,
              surface,
              isWindowThemeSchedule(schedule) ? schedule : undefined,
            );
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logs
              .forService("desktop")
              .write(`[desktop] could not persist window theme: ${reason}`);
          }
        }
        return true;
      },
    );
    // Asked by two renderers that never meet: the startup screen, which plays
    // the chime, and the Profile page, which is where it is switched off.
    // The floating recording controller for a teaching session. The shell opens
    // it on a Breadboard route of its own; the session id is validated here
    // because it becomes part of a URL, and a renderer is not trusted to have
    // kept it to the shape the route expects.
    ipcMain.handle(IPC_CHANNELS.openTeachController, (_event, sessionId: unknown) => {
      if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return false;
      const dashboardUrl = this.runtimeDashboardUrl;
      if (!dashboardUrl) return false;
      const target = new URL("/workflows/teach-controller", dashboardUrl);
      target.searchParams.set("session", sessionId);
      return this.windows.openTeachControllerWindow(target.toString()) !== null;
    });
    ipcMain.handle(IPC_CHANNELS.closeTeachController, () =>
      this.windows.closeTeachControllerWindow(),
    );
    ipcMain.handle(IPC_CHANNELS.getStartupSound, () =>
      readStartupSoundEnabled(this.paths.configDir),
    );
    ipcMain.handle(IPC_CHANNELS.setStartupSound, (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean") return false;
      try {
        writeStartupSoundEnabled(this.paths.configDir, enabled);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logs
          .forService("desktop")
          .write(
            `[desktop] could not persist the startup sound preference: ${reason}`,
          );
        // The switch puts itself back on a false: a preference that silently
        // failed to save would come back on at the next launch anyway.
        return false;
      }
    });
    // Location consent is installation-scoped. Unlike coordinates, this bit
    // has to outlive the dashboard's changing loopback origin.
    ipcMain.handle(IPC_CHANNELS.getCurrentLocationPreference, () =>
      readCurrentLocationPreference(this.paths.configDir),
    );
    ipcMain.handle(
      IPC_CHANNELS.setCurrentLocationPreference,
      (_event, enabled: unknown) => {
        if (typeof enabled !== "boolean") return false;
        try {
          writeCurrentLocationPreference(this.paths.configDir, enabled);
          return true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logs
            .forService("desktop")
            .write(
              `[desktop] could not persist the current location preference: ${reason}`,
            );
          return false;
        }
      },
    );
    // Browser navigation: the tabs along a window's caption strip. Every page
    // may only act on the tabs of the window it is itself a tab of; the
    // manager resolves that from the sender and refuses anyone else.
    ipcMain.handle(IPC_CHANNELS.getTabsState, (event) =>
      this.windows.tabs.stateFor(event.sender),
    );
    ipcMain.handle(IPC_CHANNELS.getBrowserTerminalAccess, (event) =>
      event.senderFrame === event.sender.mainFrame
        ? this.windows.tabs.browserTerminalAccess(event.sender) : null,
    );
    ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command: unknown) => {
      if (!isTabsCommand(command)) return false;
      if (command.type === 'voice-open') {
        if (event.senderFrame !== event.sender.mainFrame || !this.windows.tabs.stateFor(event.sender)?.selfId) return false;
        const url = event.sender.getURL();
        if (!this.runtimeDashboardUrl || new URL(url).origin !== new URL(this.runtimeDashboardUrl).origin) return false;
        this.startVoiceCompanion();
        return this.voiceCompanion?.launch().catch(() => false) ?? false;
      }
      if (command.type === 'voice-overlay' && event.senderFrame !== event.sender.mainFrame) return false;
      return this.windows.tabs.handleCommand(event.sender, command);
    });
    ipcMain.handle(IPC_CHANNELS.getBrowserNavigation, () => this.windows.tabs.isEnabled);
    ipcMain.handle(IPC_CHANNELS.setBrowserNavigation, (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean") return false;
      try {
        writeBrowserNavigationEnabled(this.paths.configDir, enabled);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logs
          .forService("desktop")
          .write(`[desktop] could not persist the browser navigation preference: ${reason}`);
        return false;
      }
      // Applied only once written down: a switch that took effect now and
      // came back the other way at the next launch would be lying.
      this.windows.tabs.setEnabled(enabled);
      return true;
    });
    ipcMain.handle(IPC_CHANNELS.getBrowserBookmarks, (_event, ownerKey: unknown) => {
      if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
      return readBrowserBookmarks(this.paths.configDir, ownerKey);
    });
    ipcMain.handle(
      IPC_CHANNELS.setBrowserBookmarks,
      (_event, ownerKey: unknown, bookmarks: unknown) => {
        if (!isBrowserBookmarkOwnerKey(ownerKey) || !isBrowserBookmarks(bookmarks)) return false;
        try {
          writeBrowserBookmarks(this.paths.configDir, ownerKey, bookmarks);
          return true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logs
            .forService("desktop")
            .write(`[desktop] could not persist browser bookmarks: ${reason}`);
          return false;
        }
      },
    );
    ipcMain.handle(IPC_CHANNELS.getBrowserShortcuts, (_event, ownerKey: unknown) => {
      if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
      return readBrowserShortcuts(this.paths.configDir, ownerKey);
    });
    ipcMain.handle(IPC_CHANNELS.setBrowserShortcuts, (_event, ownerKey: unknown, shortcuts: unknown) => {
      if (!isBrowserBookmarkOwnerKey(ownerKey) || !isBrowserBookmarks(shortcuts) || shortcuts.length > 8) return false;
      try {
        writeBrowserShortcuts(this.paths.configDir, ownerKey, shortcuts);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logs.forService("desktop").write(`[desktop] could not persist browser shortcuts: ${reason}`);
        return false;
      }
    });
    ipcMain.handle(IPC_CHANNELS.getBrowserRecentSearches, (_event, ownerKey: unknown) => {
      if (!isBrowserBookmarkOwnerKey(ownerKey)) return null;
      return readBrowserRecentSearches(this.paths.configDir, ownerKey);
    });
    ipcMain.handle(IPC_CHANNELS.getBrowserHistory, (event) => {
      if (!this.windowForSender(event.sender) || !event.senderFrame ||
          !isNavigationAllowed(this.allowedOrigins, event.senderFrame.url)) {
        throw new Error("History is only available in Breadboard.");
      }
      return this.windows.tabs.browserHistory.snapshot();
    });
    ipcMain.handle(IPC_CHANNELS.browserHistoryCommand, (event, command: unknown) => {
      if (!this.windowForSender(event.sender) || !event.senderFrame ||
          !isNavigationAllowed(this.allowedOrigins, event.senderFrame.url) || !isBrowserHistoryCommand(command)) return false;
      return this.windows.tabs.browserHistory.command(command);
    });
    ipcMain.handle(IPC_CHANNELS.setBrowserRecentSearches, (event, ownerKey: unknown, searches: unknown) => {
      if (this.windows.tabs.isPrivateBrowser(event.sender)) return false;
      if (!isBrowserBookmarkOwnerKey(ownerKey) || !isBrowserRecentSearches(searches)) return false;
      try {
        writeBrowserRecentSearches(this.paths.configDir, ownerKey, searches);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logs.forService("desktop").write(`[desktop] could not persist browser recent searches: ${reason}`);
        return false;
      }
    });
    ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, (event) => {
      if (!this.windowForSender(event.sender) || !event.senderFrame ||
          !isNavigationAllowed(this.allowedOrigins, event.senderFrame.url)) {
        throw new Error("Downloads are only available in Breadboard.");
      }
      return this.browserDownloads.snapshot();
    });
    ipcMain.handle(IPC_CHANNELS.browserDownloadCommand, (event, command: unknown) => {
      if (!this.windowForSender(event.sender) || !event.senderFrame ||
          !isNavigationAllowed(this.allowedOrigins, event.senderFrame.url) || !isBrowserDownloadCommand(command)) {
        return { ok: false, error: "Invalid download action." };
      }
      return this.browserDownloads.command(command);
    });
    ipcMain.handle(IPC_CHANNELS.getClickyState, () =>
      this.clickyLauncher().state(),
    );
    ipcMain.handle(IPC_CHANNELS.launchClicky, async (event) => {
      const window = this.windowForSender(event.sender);
      if (!window || window.isDestroyed()) {
        return {
          ok: false,
          code: "launch_failed",
          message: "Clicky can only be launched from a Breadboard window.",
          state: this.clickyLauncher().state(),
        };
      }
      const launch = await this.clickyLauncher().launch();
      this.logs
        .forService("desktop")
        .write(`[desktop] Clicky launch ${launch.ok ? "accepted" : "refused"}: ${launch.code}`);
      return launch;
    });
    ipcMain.handle(IPC_CHANNELS.openClickyProject, async (event) => {
      const window = this.windowForSender(event.sender);
      if (!window || window.isDestroyed()) {
        return {
          ok: false,
          code: "project_open_failed",
          message: "The Clicky project can only be opened from a Breadboard window.",
          state: this.clickyLauncher().state(),
        };
      }
      return this.clickyLauncher().openProject();
    });
  }

  private startVoiceCompanion() {
    this.voiceCompanion ??= new VoiceCompanion({ dashboardUrl: () => this.runtimeDashboardUrl, allowed: this.allowedOrigins });
    this.windows.tabs.onVoiceNotification = notice => this.voiceCompanion?.notify(notice);
    void this.voiceCompanion.start().catch(error => this.logs.forService('desktop').write(`[voice] ${String(error)}`));
  }

  private clickyLauncher() {
    return createClickyLauncher({
      platform: process.platform,
      appRoot: this.paths.appRoot,
      resourcesRoot: this.paths.resourcesRoot,
      homeDirectory: app.getPath("home"),
      configuredApplicationPath:
        process.env["BREADBOARD_CLICKY_APP_PATH"]?.trim() || undefined,
      openPath: (applicationPath) => shell.openPath(applicationPath),
      launchWindowsCompanion: process.platform === "win32" ? async () => {
        const nativeInput = createWindowsInput(this.paths.appRoot);
        this.clickyCompanion ??= new ClickyCompanion({
          dashboardUrl: () => this.runtimeDashboardUrl,
          allowed: this.allowedOrigins,
          clickAt: nativeInput.click,
          typeText: nativeInput.typeText,
        });
        await this.clickyCompanion.launch();
      } : undefined,
    });
  }

  /**
   * The window a request came from. A window's own page is found by Electron;
   * a page inside one of the window's tabs is known only to the tab manager.
   */
  private windowForSender(sender: Electron.WebContents): BrowserWindow | null {
    return BrowserWindow.fromWebContents(sender) ?? this.windows.tabs.windowFor(sender);
  }

  /**
   * Relaunch the whole product, not just the current page. Development has one
   * extra promise: source changes must be compiled before the old process
   * leaves, while a failed build keeps the still-working app open.
   */
  private restartApplication(): Promise<boolean> {
    if (this.appRestartInFlight) return this.appRestartInFlight;

    const attempt = (async () => {
      if (this.paths.mode === "dev") {
        const launchMode = runtimeLaunchMode(this.paths.mode);
        const rebuilt = await rebuildDevelopmentInstallation({
          repoRoot: repoRootFromModuleDir(this.moduleDir),
          dashboardMode: launchMode === "lean" ? "lean" : "hot",
          writeLog: (line) =>
            this.logs.forService("desktop").write(`[desktop restart] ${line}`),
        });
        if (!rebuilt) {
          this.logs
            .forService("desktop")
            .write("[desktop restart] rebuild failed; keeping Breadboard open");
          return false;
        }
      }

      this.logs
        .forService("desktop")
        .write("[desktop restart] relaunching Breadboard");
      app.relaunch();
      app.quit();
      return true;
    })().catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logs
        .forService("desktop")
        .write(`[desktop restart] could not prepare relaunch: ${reason}`);
      return false;
    });

    this.appRestartInFlight = attempt.finally(() => {
      // `before-quit` flips this synchronously. Keep the completed promise in
      // that path so a second tab cannot schedule another relaunch while the
      // Runtime is still draining.
      if (!this.quitting) this.appRestartInFlight = null;
    });
    return this.appRestartInFlight;
  }

  private installApplicationMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "&Breadboard",
        submenu: [
          {
            label: "Reload page",
            accelerator: "CmdOrCtrl+R",
            // Reloads renderer content only; backend services are untouched.
            click: () => this.windows.reload(),
          },
          { type: "separator" },
          {
            label: "Open logs folder",
            click: () => void shell.openPath(this.logs.directory),
          },
          {
            label: "Open data folder",
            click: () => void shell.openPath(this.paths.dataRoot),
          },
          { type: "separator" },
          { role: "quit", label: "Quit Breadboard" },
        ],
      },
      {
        label: "&View",
        submenu: [
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
          { type: "separator" },
          {
            label: "Toggle full screen",
            accelerator: "CmdOrCtrl+Shift+F",
            click: (_menuItem, focusedWindow) => {
              const window = focusedWindow ?? this.windows.window;
              if (!window || window.isDestroyed()) return;
              window.setFullScreen(!window.isFullScreen());
            },
          },
          ...(this.paths.mode === "dev"
            ? ([
                { role: "toggleDevTools" },
              ] as Electron.MenuItemConstructorOptions[])
            : []),
        ],
      },
      {
        label: "&Help",
        submenu: [
          {
            label: `Breadboard ${app.getVersion()} (local, offline-first)`,
            enabled: false,
          },
          {
            label: "Show sign-up invite code",
            click: () => {
              void dialog.showMessageBox({
                type: "info",
                title: "Breadboard invite code",
                message: "Use this invite code to create your local account:",
                detail: this.persistentConfig.initialInviteCode,
              });
            },
          },
          {
            label: "Service status (diagnostics to clipboard)",
            click: () => {
              clipboard.writeText(
                JSON.stringify(
                  {
                    app: app.getVersion(),
                    services: this.runtime?.snapshot()?.services ?? [],
                  },
                  null,
                  2,
                ),
              );
            },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  private registerExitGuards(): void {
    app.on("before-quit", (event) => {
      this.windows?.tabs.freezeSession();
      this.computerUseIndicator?.stop();
      this.clickyCompanion?.stop();
      this.clickyCompanion = null;
      this.voiceCompanion?.stop();
      this.voiceCompanion = null;
      void this.breadboardUse?.close();
      if (this.runtimeStopped) return;
      event.preventDefault();
      if (this.quitting) return;
      this.quitting = true;
      this.clearScheduledRuntimeRootRetry();
      this.clearRuntimeRootStabilityTimer();
      void this.shutdownRuntime().then(() => {
        this.runtimeStopped = true;
        app.quit();
      });
    });
    app.on("window-all-closed", () => {
      if (this.quitting || this.windows.consumeMainWindowCloseRequest()) {
        app.quit();
        return;
      }

      // `window-all-closed` is not proof that the person closed Breadboard.
      // Chromium can lose the native window when its renderer/GPU process is
      // torn down under memory pressure. Keep the supervised services alive
      // and create a fresh shell around the same dashboard in that case.
      this.logs
        ?.forService("desktop")
        .write(
          "[desktop] all windows disappeared unexpectedly; reopening the dashboard",
        );
      const reopen = this.runtimeDashboardUrl
        ? this.windows.showDashboard(
            this.runtimeDashboardUrl,
            new URL("/new-tab", this.runtimeDashboardUrl).toString(),
          )
        : this.windows.showStartupScreen();
      void reopen.catch((error) => {
        this.logs
          ?.forService("desktop")
          .write(
            `[desktop] dashboard window reopen failed: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    });
    process.on("uncaughtException", (error) => {
      try {
        this.logs
          ?.forService("desktop")
          .write(
            `[desktop] uncaught exception: ${error.stack ?? error.message}`,
          );
      } catch {
        // Logging must not block emergency cleanup.
      }
      if (this.runtime) this.runtime.terminateNow();
      process.exit(1);
    });
    process.on("exit", () => {
      // Last-resort synchronous path: signal only the fixed Runtime V2 root.
      if (!this.runtimeStopped) this.runtime?.terminateNow();
    });
  }

  private async shutdownRuntime(): Promise<void> {
    this.stopRuntimeStatusPolling();
    try {
      this.logs
        ?.forService("desktop")
        .write("[desktop] shutting down Runtime");
      const stopped = this.runtime ? await this.runtime.stop() : undefined;
      if (stopped && !stopped.exited) {
        this.logs
          ?.forService("desktop")
          .write("[desktop] Runtime exit was not confirmed");
      }
      if (this.devInstanceLockRepoRoot !== null) {
        releaseDevInstance(this.devInstanceLockRepoRoot);
        this.devInstanceLockRepoRoot = null;
      }
      this.logs?.forService("desktop").write("[desktop] Runtime stopped");
    } catch (error) {
      this.logs
        ?.forService("desktop")
        .write(
          `[desktop] shutdown error: ${error instanceof Error ? error.message : String(error)}`,
        );
      this.runtime?.terminateNow();
    } finally {
      this.logs?.closeAll();
    }
  }
}
