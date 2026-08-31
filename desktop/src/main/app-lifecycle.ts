import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerSaveBlocker,
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
import {
  WindowManager,
  defaultPreloadPath,
  defaultStartupHtmlPath,
} from "./window-manager";
import {
  allowThemeLocationFor,
  allowedOriginsFor,
  installGlobalSecurity,
  revokeThemeLocationFor,
  type AllowedOrigins,
} from "./security";
import { IPC_CHANNELS } from "../shared/ipc-contract";
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
import type { QaServiceProfile } from "./startup-options";
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
  private runtime: RuntimeProcess | null = null;
  private runtimeDashboardUrl: string | null = null;
  private allowedOrigins!: AllowedOrigins;
  private runtimeStatusTimer: NodeJS.Timeout | null = null;
  private runtimeStatusRefreshInFlight = false;
  private runtimeRestartInFlight: Promise<boolean> | null = null;
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

    if (hotCheckoutFailure === null) {
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
      onMainWindowCloseRequested: () => this.computerUseIndicator?.stop(),
    });

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
      gracefulShutdownTimeoutMs: 60_000,
      forcedShutdownTimeoutMs: 10_000,
      onLog: (source, line) =>
        supervisorLog.write(`[runtime:${source}] ${line}`),
      onUnexpectedExit: (exit) => this.handleUnexpectedRuntimeExit(exit),
    };
  }

  private async prepareDataLayer(): Promise<void> {
    if (this.paths.mode === "dev" && !this.paths.qaMode) return;
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
    if (this.runtimeRestartInFlight) return this.runtimeRestartInFlight;
    const retry = this.retryRuntimeRootOnce();
    this.runtimeRestartInFlight = retry;
    const clearRetry = () => {
      if (this.runtimeRestartInFlight === retry) {
        this.runtimeRestartInFlight = null;
      }
    };
    // Observe both outcomes without creating the rejected promise that
    // `finally()` would return and leave detached from the IPC invocation.
    void retry.then(clearRetry, clearRetry);
    return retry;
  }

  private async retryRuntimeRootOnce(): Promise<boolean> {
    if (this.quitting) return false;
    const previousRuntime = this.runtime;
    if (!previousRuntime) return false;

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
    const dashboardUrl = this.runtimeDashboardUrl;
    if (!this.dashboardShown && dashboardUrl) {
      this.dashboardShown = true;
      try {
        await this.windows.showDashboard(dashboardUrl);
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
    this.lastRuntimeStatusSignature = null;
    const reason = exit.signal
      ? `Runtime stopped with signal ${exit.signal}.`
      : `Runtime stopped with exit code ${exit.code ?? "unknown"}.`;
    this.logs?.forService("desktop").write(`[desktop] ${reason}`);
    if (!this.windows) return;
    this.failRuntimeStartup(reason);
    this.dashboardShown = false;
    void this.windows.showStartupScreen();
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
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return false;
      return openMicrophoneSettings();
    });
    ipcMain.handle(IPC_CHANNELS.allowThemeLocation, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
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
        const window = BrowserWindow.fromWebContents(event.sender);
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
      this.computerUseIndicator?.stop();
      if (this.runtimeStopped) return;
      event.preventDefault();
      if (this.quitting) return;
      this.quitting = true;
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
        ? this.windows.showDashboard(this.runtimeDashboardUrl)
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
