import { app, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { LogManager } from "./log-manager";
import { ServiceManager, type ServiceStatus } from "./service-manager";
import {
  buildServiceDefinitions,
  missingRuntimes,
  resolveRuntimeBinaries,
  serviceUrls,
} from "./service-definitions";
import {
  ensureMutableDirectories,
  resolvePaths,
  repoRootFromModuleDir,
  type ResolvedPaths,
} from "./path-resolver";
import {
  atomicWriteFile,
  loadOrCreatePersistentConfig,
  redactSecrets,
  redactedConfigSummary,
  savePersistentConfig,
  type DesktopRuntimeConfig,
} from "./runtime-config";
import { allocatePort } from "./ports";
import {
  detectDevInstallation,
  executeMigration,
  looksLikeSqliteDatabase,
  planMigration,
  MIGRATION_VERSION,
} from "./migration";
import {
  needsOpenHarnessProvisioning,
  needsQuartzProvisioning,
  provisionOpenHarnessRuntime,
  provisionQuartzWorkspace,
  writeScriberrComposeOverride,
} from "./provisioning";
import { WindowManager, defaultPreloadPath, defaultStartupHtmlPath } from "./window-manager";
import { allowedOriginsFor, installGlobalSecurity } from "./security";

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
  }>;
  failure?: StartupFailure;
}

/**
 * The authoritative application lifecycle: prepares data directories, runs
 * migration/provisioning, supervises services, owns the window, and guarantees
 * child-process cleanup on every exit path.
 */
export class AppLifecycle {
  private paths!: ResolvedPaths;
  private config!: DesktopRuntimeConfig;
  private logs!: LogManager;
  private services!: ServiceManager;
  private windows!: WindowManager;
  private startupState: StartupState = {
    phase: "preparing",
    message: "Preparing Breadboard",
    services: [],
  };
  private quitting = false;
  private servicesStopped = false;
  private readonly moduleDir: string;
  private readonly forceDev: boolean;

  constructor(moduleDir: string, forceDev: boolean) {
    this.moduleDir = moduleDir;
    this.forceDev = forceDev;
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
        window.focus();
      }
    });

    await app.whenReady();

    this.paths = resolvePaths({
      isPackaged: app.isPackaged,
      forceDev: this.forceDev,
      userDataDir: app.getPath("userData"),
      electronResourcesPath: process.resourcesPath,
      moduleDir: this.moduleDir,
    });
    ensureMutableDirectories(this.paths);

    const persistent = loadOrCreatePersistentConfig(this.paths.configDir);
    const taken = new Set<number>();
    this.config = {
      persistent,
      ports: {
        dashboard: await allocatePort(3000, taken),
        chatmock: await allocatePort(8765, taken),
        openharness: await allocatePort(4096, taken),
        quartz: await allocatePort(8081, taken),
        quartzWs: await allocatePort(3001, taken),
      },
    };

    // Publish the resolved (non-secret) endpoints so diagnostics and external
    // checks target this instance instead of guessing well-known ports.
    atomicWriteFile(
      path.join(this.paths.runtimeDir, "endpoints.json"),
      JSON.stringify(
        { pid: process.pid, startedAt: new Date().toISOString(), urls: serviceUrls(this.config) },
        null,
        2,
      ),
    );

    this.logs = new LogManager({
      logsDir: this.paths.logsDir,
      redact: (line) => redactSecrets(line, this.config.persistent),
    });
    const supervisorLog = this.logs.forService("desktop");
    supervisorLog.write(
      `[desktop] starting; mode=${this.paths.mode}; config=${JSON.stringify(redactedConfigSummary(this.config))}`,
    );

    this.services = new ServiceManager(this.logs);
    const urls = serviceUrls(this.config);
    const allowed = allowedOriginsFor([urls.dashboard, urls.quartz]);
    installGlobalSecurity(allowed);

    this.windows = new WindowManager({
      allowed,
      startupHtmlPath: defaultStartupHtmlPath(this.moduleDir),
      preloadPath: defaultPreloadPath(this.moduleDir),
      iconPath: this.iconPath(),
    });

    this.registerIpcHandlers();
    this.registerExitGuards();
    this.installApplicationMenu();

    await this.windows.showStartupScreen();

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

    await this.startServices();
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

  private async prepareDataLayer(): Promise<void> {
    if (this.paths.mode === "dev") return;

    // 1. Refresh the Quartz workspace program files when needed.
    if (needsQuartzProvisioning(this.paths, app.getVersion())) {
      this.setStartupState({
        ...this.startupState,
        phase: "preparing",
        message: "Preparing the garden workspace",
      });
      provisionQuartzWorkspace(this.paths, app.getVersion(), (message) =>
        this.logs.forService("desktop").write(`[provision] ${message}`),
      );
    }

    // 2. Provision the OpenHarness runtime workspace (first run / app update).
    if (
      this.config.persistent.openharnessMode !== "legacy" &&
      needsOpenHarnessProvisioning(this.paths, app.getVersion())
    ) {
      this.setStartupState({
        ...this.startupState,
        phase: "preparing",
        message: "Preparing the agent runtime (first run)",
      });
      const bun = resolveRuntimeBinaries(this.paths).bun;
      await new Promise<void>((resolve, reject) => {
        // spawnSync inside; run on a fresh tick so the startup screen paints.
        setImmediate(() => {
          try {
            provisionOpenHarnessRuntime(this.paths, app.getVersion(), bun, (message) =>
              this.logs.forService("desktop").write(`[provision] ${message}`),
            );
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    }

    // 3. One-time migration from a detected dev checkout (copy, never delete).
    const persistent = this.config.persistent;
    if (persistent.migrationVersion < MIGRATION_VERSION) {
      const candidates = [
        process.env["BREADBOARD_MIGRATE_FROM"] ?? "",
        repoRootFromModuleDir(this.moduleDir),
      ].filter((candidate) => candidate.length > 0);
      const source = candidates.find((candidate) => detectDevInstallation(candidate));
      if (source) {
        const plan = planMigration(source, this.migrationTargets());
        const pending = plan.items.filter((item) => item.exists && !item.alreadyMigrated);
        if (pending.length > 0) {
          const choice = await dialog.showMessageBox({
            type: "question",
            title: "Import existing Breadboard data?",
            message: "An existing Breadboard workspace was found on this computer.",
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

    // 4. Optional Scriberr Docker compose override.
    if (persistent.scriberrEnabled && persistent.scriberrBaseUrl === null) {
      writeScriberrComposeOverride(this.paths, 8091);
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

  private async startServices(): Promise<void> {
    const binaries = resolveRuntimeBinaries(this.paths);
    const missing = missingRuntimes(this.paths, binaries);
    if (missing.length > 0) {
      this.setStartupState({
        phase: "failed",
        message: "Breadboard installation is incomplete",
        services: [],
        failure: {
          serviceId: "desktop",
          displayName: "Bundled runtimes",
          reason:
            "Missing bundled runtimes: " +
            missing.map((entry) => `${entry.runtime} (${entry.path})`).join(", ") +
            ". Reinstall Breadboard.",
          logTail: [],
        },
      });
      return;
    }

    for (const definition of buildServiceDefinitions({
      paths: this.paths,
      config: this.config,
      binaries,
    })) {
      this.services.register(definition);
    }

    this.services.on("state-changed", () => this.publishServiceStates());
    this.services.on("fatal", (serviceId: string, reason: string) => {
      const status = this.services.status(serviceId);
      this.setStartupState({
        ...this.snapshotServices("failed", `${status.displayName} stopped unexpectedly`),
        failure: {
          serviceId,
          displayName: status.displayName,
          reason,
          logTail: this.services.tailLog(serviceId),
        },
      });
      // If we are already showing the dashboard, bring the startup screen back
      // so the failure is visible and actionable instead of a broken page.
      void this.windows.showStartupScreen();
    });

    this.setStartupState(this.snapshotServices("starting", "Starting local services"));

    try {
      await this.services.startAll();
    } catch {
      const failed = this.services
        .allStatuses()
        .find((status) => status.required && status.state === "failed");
      if (failed) {
        this.setStartupState({
          ...this.snapshotServices("failed", `${failed.displayName} could not start`),
          failure: {
            serviceId: failed.id,
            displayName: failed.displayName,
            reason: failed.lastError ?? "Unknown startup failure",
            logTail: this.services.tailLog(failed.id),
          },
        });
      }
      return;
    }

    this.setStartupState(this.snapshotServices("ready", "Ready"));
    await this.windows.showDashboard(serviceUrls(this.config).dashboard);
  }

  private snapshotServices(
    phase: StartupState["phase"],
    message: string,
  ): StartupState {
    const phaseMessage = this.describePhase(message);
    return {
      phase,
      message: phaseMessage,
      services: this.services.allStatuses().map((status: ServiceStatus) => ({
        id: status.id,
        displayName: status.displayName,
        required: status.required,
        state: status.state,
        lastError: status.lastError,
        restarts: status.restarts,
      })),
    };
  }

  private describePhase(fallback: string): string {
    const statuses = this.services.allStatuses();
    const starting = statuses.find((status) => status.state === "starting");
    if (!starting) return fallback;
    switch (starting.id) {
      case "chatmock":
        return "Starting local AI";
      case "openharness":
        return "Starting agent runtime";
      case "quartz":
        return "Starting garden";
      case "dashboard":
        return "Starting workspace";
      default:
        return fallback;
    }
  }

  private publishServiceStates(): void {
    if (this.startupState.phase === "failed") {
      // Keep the failure view stable until the user retries.
      this.startupState = {
        ...this.startupState,
        services: this.snapshotServices("failed", this.startupState.message).services,
      };
    } else if (this.startupState.phase !== "ready") {
      this.startupState = this.snapshotServices("starting", "Starting local services");
    } else {
      this.startupState = this.snapshotServices("ready", "Ready");
    }
    this.windows.sendToRenderer("breadboard:startup-state", this.startupState);
  }

  private setStartupState(state: StartupState): void {
    this.startupState = state;
    this.windows.sendToRenderer("breadboard:startup-state", state);
  }

  private registerIpcHandlers(): void {
    ipcMain.handle("breadboard:get-versions", () => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? "unknown",
    }));
    ipcMain.handle("breadboard:get-startup-state", () => this.startupState);
    ipcMain.handle("breadboard:retry-service", async (_event, serviceId: unknown) => {
      if (typeof serviceId !== "string") return false;
      const known = this.services
        .allStatuses()
        .some((status) => status.id === serviceId && status.state === "failed");
      if (!known && serviceId !== "desktop") return false;
      this.setStartupState(this.snapshotServices("starting", "Retrying"));
      try {
        if (serviceId === "desktop") {
          await this.prepareDataLayer();
          await this.startServices();
          return true;
        }
        const ok = await this.services.startService(serviceId);
        if (ok) {
          // Resume the normal startup path for anything still pending.
          await this.services.startAll();
          this.setStartupState(this.snapshotServices("ready", "Ready"));
          await this.windows.showDashboard(serviceUrls(this.config).dashboard);
        } else {
          const status = this.services.status(serviceId);
          this.setStartupState({
            ...this.snapshotServices("failed", `${status.displayName} could not start`),
            failure: {
              serviceId,
              displayName: status.displayName,
              reason: status.lastError ?? "Unknown startup failure",
              logTail: this.services.tailLog(serviceId),
            },
          });
        }
        return ok;
      } catch {
        return false;
      }
    });
    ipcMain.handle("breadboard:open-logs", async () => {
      await shell.openPath(this.logs.directory);
    });
    ipcMain.handle("breadboard:copy-diagnostics", () => {
      const diagnostics = {
        app: app.getVersion(),
        electron: process.versions.electron,
        mode: this.paths.mode,
        config: redactedConfigSummary(this.config),
        services: this.services.allStatuses(),
        failure: this.startupState.failure ?? null,
      };
      clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    });
    ipcMain.handle("breadboard:quit", () => {
      app.quit();
    });
    ipcMain.handle("breadboard:pick-folder", async () => {
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
          { role: "togglefullscreen" },
          ...(this.paths.mode === "dev"
            ? ([{ role: "toggleDevTools" }] as Electron.MenuItemConstructorOptions[])
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
                detail: this.config.persistent.initialInviteCode,
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
                    services: this.services.allStatuses(),
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
      if (this.servicesStopped) return;
      event.preventDefault();
      if (this.quitting) return;
      this.quitting = true;
      void this.shutdownServices().then(() => {
        this.servicesStopped = true;
        app.quit();
      });
    });
    app.on("window-all-closed", () => {
      app.quit();
    });
    process.on("uncaughtException", (error) => {
      try {
        this.logs?.forService("desktop").write(`[desktop] uncaught exception: ${error.stack ?? error.message}`);
      } catch {
        // Logging must not block emergency cleanup.
      }
      this.services?.killAllNow();
      process.exit(1);
    });
    process.on("exit", () => {
      // Last-resort synchronous path: ask the OS to reap known children.
      if (!this.servicesStopped) this.services?.killAllNow();
    });
  }

  private async shutdownServices(): Promise<void> {
    try {
      this.logs?.forService("desktop").write("[desktop] shutting down services");
      await this.services?.stopAll();
      this.logs?.forService("desktop").write("[desktop] all services stopped");
    } catch (error) {
      this.logs
        ?.forService("desktop")
        .write(`[desktop] shutdown error: ${error instanceof Error ? error.message : String(error)}`);
      this.services?.killAllNow();
    } finally {
      this.logs?.closeAll();
    }
  }
}
