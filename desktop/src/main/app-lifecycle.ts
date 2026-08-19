import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
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
import { repairWhisperXFfmpeg } from "./whisperx-ffmpeg-repair";
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
  CLIPROXY_DEFAULT_PORT,
  cliproxyHome,
  isCliproxyInstalled,
  provisionCliproxyBinary,
  writeCliproxyConfig,
} from "./cliproxy";
import {
  detectDevInstallation,
  executeMigration,
  looksLikeSqliteDatabase,
  planMigration,
  MIGRATION_VERSION,
} from "./migration";
import {
  needsQuartzProvisioning,
  provisionQaDashboardWorkspace,
  provisionQuartzWorkspace,
} from "./provisioning";
import { WindowManager, defaultPreloadPath, defaultStartupHtmlPath } from "./window-manager";
import {
  allowThemeLocationFor,
  allowedOriginsFor,
  installGlobalSecurity,
  revokeThemeLocationFor,
} from "./security";
import { IPC_CHANNELS } from "../shared/ipc-contract";
import {
  backgroundColorForSurface,
  isWindowSurface,
  titleBarForSurface,
} from "./window-options";
import { openMicrophoneSettings } from "./microphone-settings";
import { stopRecallEngine } from "./recall";
import { readLastWindowTheme, writeLastWindowTheme } from "./theme-state";
import { readStartupSoundEnabled, writeStartupSoundEnabled } from "./startup-sound";
import { prepareQaServiceDefinitions } from "./qa-mode";
import type { QaServiceProfile } from "./startup-options";

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

export interface UnhandledRejectionActions {
  writeDiagnostic(line: string): void;
  killAllNow(): void;
  exit(code: number): void;
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
        killAllNow: () => this.services?.killAllNow(),
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

    this.paths = resolvePaths({
      isPackaged: app.isPackaged,
      forceDev: this.forceDev,
      qaMode: this.qaMode,
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
        hermes: await allocatePort(9119, taken),
        postiz: await allocatePort(4007, taken),
        postizSupervisor: await allocatePort(7721, taken),
        quartz: await allocatePort(8081, taken),
        quartzWs: await allocatePort(3001, taken),
        voicebox: await allocatePort(17493, taken),
        // GBrain adapter port is only allocated when GBrain is enabled.
        ...(persistent.gbrainMode !== "disabled" ? { gbrain: await allocatePort(7717, taken) } : {}),
        // UI-TARS adapter port is only allocated when UI-TARS is not disabled.
        ...(persistent.uiTarsMode !== "disabled" ? { uiTars: await allocatePort(7719, taken) } : {}),
        // Parametric CAD service. Allocated only when enabled; the definition
        // is registered only when its Python environment actually exists.
        ...(persistent.cadMode !== "disabled" ? { cad: await allocatePort(7731, taken) } : {}),
        // Subscription proxy port, allocated before the binary is known to
        // exist: provisioning happens later, and re-allocating afterwards would
        // mean the port could differ from the one already handed to ChatMock.
        ...(persistent.cliproxyMode !== "disabled"
          ? { cliproxy: await allocatePort(CLIPROXY_DEFAULT_PORT, taken) }
          : {}),
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
      `[desktop] starting; mode=${this.paths.mode}${this.paths.qaMode ? `; qa-profile=${this.qaServiceProfile}` : ""}; config=${JSON.stringify(redactedConfigSummary(this.config))}`,
    );

    this.services = new ServiceManager(this.logs);
    const urls = serviceUrls(this.config);
    const startupHtmlPath = defaultStartupHtmlPath(this.moduleDir);
    const recoveryHtmlPath = path.join(path.dirname(startupHtmlPath), "recovery.html");
    const allowed = allowedOriginsFor([
      urls.dashboard,
      urls.quartz,
      pathToFileURL(startupHtmlPath).toString(),
      pathToFileURL(recoveryHtmlPath).toString(),
    ]);
    installGlobalSecurity(allowed);

    this.windows = new WindowManager({
      allowed,
      startupHtmlPath,
      recoveryHtmlPath,
      preloadPath: defaultPreloadPath(this.moduleDir),
      iconPath: this.iconPath(),
      initialTheme: readLastWindowTheme(this.paths.configDir),
      // Window recovery runs entirely in the main process, where nothing else
      // is written down. A reconnect scene that never lifts is unexplainable
      // without this.
      log: (line) => supervisorLog.write(line),
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
    this.writeHermesRuntimeConfig();
    // Before the dev early-return: dev runs the same supervised proxy, and its
    // config must be regenerated for this launch's port either way.
    if (!this.paths.qaMode) {
      await this.prepareCliproxy();
    }
    if (this.paths.mode === "dev" && !this.paths.qaMode) return;

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
    provisionQaDashboardWorkspace(this.paths);

    // QA data is always fresh/disposable. Never detect or copy a developer
    // checkout into it: doing so would make scenarios non-deterministic and
    // risks pulling real user content into failure artifacts.
    if (this.paths.qaMode) return;

    // 2. One-time migration from a detected dev checkout (copy, never delete).
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
  }

  /**
   * Get the subscription proxy ready to be supervised: download it on first
   * use, then regenerate its config for this launch's port.
   *
   * Every failure here is swallowed. Subscriptions are optional, the download
   * needs the network, and `buildServiceDefinitions` simply omits the service
   * when the binary is absent — so the worst case is that the Subscriptions
   * panel reports it as unavailable while the rest of Breadboard starts
   * normally. Blocking startup on a GitHub release download would be the wrong
   * trade for a capability most launches never touch.
   */
  private async prepareCliproxy(): Promise<void> {
    const { cliproxyMode } = this.config.persistent;
    if (cliproxyMode === "disabled") return;
    const home = cliproxyHome(this.paths);
    const log = (message: string) =>
      this.logs.forService("desktop").write(`[cliproxy] ${message}`);

    if (!isCliproxyInstalled(home)) {
      this.setStartupState({
        ...this.startupState,
        phase: "preparing",
        message: "Preparing subscription models",
      });
      try {
        await provisionCliproxyBinary(home, log);
      } catch (error) {
        log(
          `not installed: ${error instanceof Error ? error.message : String(error)}. ` +
            "Subscription models stay unavailable until the next launch.",
        );
        return;
      }
    }

    try {
      writeCliproxyConfig(home, this.config.ports.cliproxy ?? CLIPROXY_DEFAULT_PORT);
    } catch (error) {
      log(`could not write its config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeHermesRuntimeConfig(): void {
    fs.mkdirSync(this.paths.hermesHome, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.paths.hermesHome, 0o700);
    } catch {
      // Windows ACLs are inherited from Electron's per-user data directory.
    }
    const chatmock = `http://127.0.0.1:${this.config.ports.chatmock}/v1`;
    const model = process.env["CHATMOCK_MODEL"]?.trim() || "default";
    const yaml = [
      "# Generated by Breadboard. Hermes state is disposable and non-canonical.",
      "model:",
      `  default: ${JSON.stringify(model)}`,
      "  provider: custom",
      `  base_url: ${JSON.stringify(chatmock)}`,
      // image_input_mode: native (below) governs the attach step, but a second
      // capability gate runs when the API request is built
      // (run_agent._prepare_messages_for_non_vision_model), and it treats
      // unknown vision capability as "no vision" — custom providers are never
      // in models.dev, so it stripped the just-attached pixels on every turn.
      // Declaring the capability satisfies that gate; it is honest because
      // every route ChatMock serves can carry images (Gemini/OpenAI-compat
      // pass-through, Claude via the CLI Read-file bridge).
      "  supports_vision: true",
      "toolsets:",
      "  - breadboard",
      "  - web",
      "web:",
      "  search_backend: ddgs",
      // Search without extract is the worst shape research can have: the model
      // gets titles and snippets it can never open, and answers from them as
      // though it had read the pages. Every extract backend Hermes ships —
      // Firecrawl, Tavily, Exa, Parallel — is a paid reader behind an API key,
      // so with none set `web_extract` failed on every call and the turn quietly
      // degraded to snippet-quoting. `fetch` is Breadboard's bundled provider
      // (plugins/web/fetch): it requests the page itself and strips it to text,
      // with the same SSRF and website-policy gates Firecrawl's loop applies.
      "  extract_backend: fetch",
      // Hermes ships a Mixture-of-Agents preset named "default" and, when no
      // provider is given, a plain model switch to a name matching an enabled
      // preset pivots the session onto the MoA virtual provider. Breadboard
      // sends exactly that string: every provider-prefixed model
      // (`cliproxy/gemini-…`, `anthropic/claude-…`) is addressed through
      // ChatMock's `default` sentinel, so picking one silently rerouted the turn
      // to MoA's own reference models — OpenRouter and Codex, neither of which
      // has credentials here — and the turn died with "HTTP 401: Missing
      // Authentication header". Breadboard does its own multi-model work inside
      // ChatMock's council, so MoA is off.
      //
      // The per-preset flag is the one that matters: `load_config()` merges
      // Hermes's defaults, which already define `moa.presets.default`, and
      // `normalize_moa_config` reads the top-level `enabled` only when no
      // `presets` map exists. Setting just the top-level flag is a no-op here.
      "moa:",
      "  enabled: false",
      "  presets:",
      "    default:",
      "      enabled: false",
      "memory:",
      "  memory_enabled: false",
      "  user_profile_enabled: false",
      "display:",
      "  show_reasoning: true",
      "  busy_input_mode: steer",
      "  busy_steer_ack_enabled: false",
      "  memory_notifications: off",
      // Breadboard exposes dozens of capability-checked plugin tools. Sending
      // every schema on every turn makes Google's subscription gateway answer
      // RESOURCE_EXHAUSTED even while the same Gemini account accepts compact
      // requests. Hermes' built-in progressive-disclosure bridge keeps every
      // tool available while sending only search/describe/call up front.
      "tools:",
      "  tool_search:",
      "    enabled: on",
      "agent:",
      "  coding_context: off",
      // An attached image must reach the model as pixels. Hermes' "auto" image
      // routing asks models.dev whether the active model has vision, and every
      // Breadboard model is addressed as provider `custom` — a name models.dev
      // has never heard of — so auto always resolved to "text": the image was
      // replaced by a `vision_analyze` summary, and when that side call failed
      // the model was told to call `vision_analyze` itself, which no Breadboard
      // session enables. Attaching natively is also the honest route, since the
      // summary loses exactly what an image is usually attached for.
      "  image_input_mode: native",
      "",
    ].join("\n");
    atomicWriteFile(path.join(this.paths.hermesHome, "config.yaml"), yaml);
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

    // Without this, WhisperX decodes silence and every transcript comes back
    // empty while the job still reports success. Cheap, idempotent, and a no-op
    // until Scriberr has provisioned its speech environment.
    const whisperxRepair = repairWhisperXFfmpeg(path.join(this.paths.runtimeDir, "scriberr"));
    this.logs
      .forService("desktop")
      .write(
        `[whisperx] ffmpeg repair: ${whisperxRepair.reason} (linked ${whisperxRepair.linked})`,
      );

    const definitions = prepareQaServiceDefinitions(
      buildServiceDefinitions({
        paths: this.paths,
        config: this.config,
        binaries,
      }),
      this.paths,
      this.qaServiceProfile,
    );
    for (const definition of definitions) {
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
      case "hermes":
        return "Starting agent runtime";
      case "postiz":
        return "Starting social publishing (first launch can take several minutes)";
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
    this.windows.sendToRenderer(IPC_CHANNELS.startupState, this.startupState);
  }

  private setStartupState(state: StartupState): void {
    this.startupState = state;
    this.windows.sendToRenderer(IPC_CHANNELS.startupState, state);
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.getVersions, () => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? "unknown",
    }));
    ipcMain.handle(IPC_CHANNELS.getStartupState, () => this.startupState);
    ipcMain.handle(IPC_CHANNELS.retryService, async (_event, serviceId: unknown) => {
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
    ipcMain.handle(IPC_CHANNELS.openLogs, async () => {
      await shell.openPath(this.logs.directory);
    });
    ipcMain.handle(IPC_CHANNELS.copyDiagnostics, () => {
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
    ipcMain.handle(IPC_CHANNELS.setTheme, (event, surface: unknown) => {
      if (!isWindowSurface(surface)) return false;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return false;
      window.setBackgroundColor(backgroundColorForSurface(surface));
      if (process.platform === "win32") {
        window.setTitleBarOverlay(titleBarForSurface(surface));
      }
      if (surface === "light" || surface === "dark") {
        this.windows.rememberTheme(surface);
        try {
          writeLastWindowTheme(this.paths.configDir, surface);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logs
            .forService("desktop")
            .write(`[desktop] could not persist window theme: ${reason}`);
        }
      }
      return true;
    });
    // Asked by two renderers that never meet: the startup screen, which plays
    // the chime, and the Profile page, which is where it is switched off.
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
          .write(`[desktop] could not persist the startup sound preference: ${reason}`);
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
      // Recall's capture engine is started by the dashboard, not the supervisor
      // (see main/recall.ts), so stopping it is not covered by stopAll(). It
      // goes first: a screen recorder must never outlive Breadboard.
      try {
        if (await stopRecallEngine(this.paths)) {
          this.logs?.forService("desktop").write("[desktop] recall capture engine stopped");
        }
      } catch (error) {
        this.logs
          ?.forService("desktop")
          .write(
            `[desktop] recall shutdown error: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
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
