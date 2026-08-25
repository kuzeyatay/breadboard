import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LogManager } from "./log-manager";
import {
  ServiceManager,
  type DesktopServiceDefinition,
  type ServiceStatus,
} from "./service-manager";
import {
  buildServiceDefinitions,
  missingRuntimes,
  resolveRuntimeBinaries,
  serviceUrls,
  SCRIBERR_PORT,
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
  mintLaunchSecrets,
  redactSecrets,
  redactedConfigSummary,
  savePersistentConfig,
  type DesktopRuntimeConfig,
} from "./runtime-config";
import {
  stopDetachedLearnWorker,
  stopDetachedLearnWorkerNow,
} from "./learn-worker-cleanup";
import { allocatePort, allocatePortOrAdopt, allocateSupervisedPort } from "./ports";
import { adoptionProbe, isOurServiceRunning, type AdoptionContext } from "./service-adoption";
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
import { installGpuDiagnostics } from "./gpu-diagnostics";
import { claimDevInstance, duplicateStackWarning, releaseDevInstance } from "./dev-instance-lock";
import { openMicrophoneSettings } from "./microphone-settings";
import { stopRecallEngine } from "./recall";
import { readLastWindowTheme, writeLastWindowTheme } from "./theme-state";
import { policyFromSnapshot, sanitizedPolicySummary, type MemoryPolicy } from "./memory-policy";
import { defaultSystemMemorySource } from "./system-memory-source";
import { SupervisorControlPlane } from "./supervisor-control-plane";
import { readStartupSoundEnabled, writeStartupSoundEnabled } from "./startup-sound";
import { prepareQaServiceDefinitions } from "./qa-mode";
import type { QaServiceProfile } from "./startup-options";

// Conservative planning envelope: the dedicated worker is launched with a
// 4096 MB V8 old-space ceiling, plus 50% for young/code spaces, native buffers,
// loaded modules, and child-process overhead. This is explicitly not a measured
// peak or a hard process-tree cap; future calibrated receipts may replace it.
const LEARN_WORKER_ESTIMATED_COMMIT_MB = 6 * 1024;

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
  private memoryPolicy!: MemoryPolicy;
  private systemMemorySource: ReturnType<typeof defaultSystemMemorySource> | null = null;
  private controlPlane: SupervisorControlPlane | null = null;
  private startupState: StartupState = {
    phase: "preparing",
    message: "Preparing Breadboard",
    services: [],
  };
  private quitting = false;
  private servicesStopped = false;
  /**
   * Services found already running at startup, mapped to the port they answered
   * on. This launch reuses them instead of spawning a second copy. Populated
   * during port allocation, consumed when the definitions are registered.
   */
  private readonly adoptedServicePorts = new Map<string, number>();
  /** Set only in dev, non-QA mode, where the duplicate-stack guard applies. */
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
    // Per-launch capability secrets. Minted here, in the process that owns the
    // lifecycle, and handed only to the two server-side processes that need
    // them. They are never persisted, never published to endpoints.json, and
    // never reach a renderer.
    const launchSecrets = mintLaunchSecrets();
    const taken = new Set<number>();
    const adoptionContext: AdoptionContext = { persistent, paths: this.paths };
    /**
     * Claim a service's port, reusing the service when it is already there.
     *
     * A busy preferred port has two very different causes: an unrelated
     * process squatting on it (relocate, as always), or this exact service
     * already running from an earlier launch or a `npm run dev` stack (keep
     * the port and adopt it, instead of running the same service twice).
     */
    const claimPort = async (serviceId: string, preferred: number): Promise<number> => {
      // QA runs isolated profiles under their own data root and is deliberately
      // parallel with whatever else is on the machine: adopting a service from
      // outside the profile would silently destroy that isolation.
      const identify = this.paths.qaMode
        ? undefined
        : (candidate: number) => isOurServiceRunning(serviceId, candidate, adoptionContext);
      // The dashboard is the one service whose hot compiler can consume
      // several GiB. Adopting it leaves the ServiceManager without a child PID,
      // so neither its tree limit nor shutdown applies. Refuse that false
      // supervision contract; a foreign occupant still relocates as before.
      if (serviceId === "dashboard" && identify) {
        return allocateSupervisedPort(serviceId, preferred, taken, identify);
      }
      const { port, adopt } = await allocatePortOrAdopt(preferred, taken, identify);
      if (adopt) this.adoptedServicePorts.set(serviceId, port);
      return port;
    };
    this.config = {
      persistent,
      launchSecrets,
      ports: {
        dashboard: await claimPort("dashboard", 3000),
        chatmock: await claimPort("chatmock", 8765),
        hermes: await claimPort("hermes", 9119),
        // Postiz's coordinator is authorized by a per-launch token, so a
        // running one can never answer this launch: it always starts fresh.
        postiz: await allocatePort(4007, taken),
        postizSupervisor: await allocatePort(7721, taken),
        supervisorControl: await allocatePort(7739, taken),
        quartz: await claimPort("quartz", 8081),
        quartzWs: await allocatePort(3001, taken),
        voicebox: await claimPort("voicebox", 17493),
        // GBrain adapter port is only allocated when GBrain is enabled.
        ...(persistent.gbrainMode !== "disabled" ? { gbrain: await claimPort("gbrain", 7717) } : {}),
        // UI-TARS adapter port is only allocated when UI-TARS is not disabled.
        ...(persistent.uiTarsMode !== "disabled" ? { uiTars: await claimPort("ui-tars", 7719) } : {}),
        // Parametric CAD service. Allocated only when enabled; the definition
        // is registered only when its Python environment actually exists.
        ...(persistent.cadMode !== "disabled" ? { cad: await claimPort("cad", 7731) } : {}),
        ...(persistent.colpaliMode !== "disabled"
          ? { colpali: await claimPort("colpali", 7733) }
          : {}),
        // Local text humanizer. 7735 is the documented development port, but
        // it is only a preference: anything already holding it moves this to an
        // OS-assigned one, and the dashboard is told which.
        ...(persistent.humanizerMode !== "disabled"
          ? { humanizer: await claimPort("humanizer", 7735) }
          : {}),
        // Subscription proxy port, allocated before the binary is known to
        // exist: provisioning happens later, and re-allocating afterwards would
        // mean the port could differ from the one already handed to ChatMock.
        ...(persistent.cliproxyMode !== "disabled"
          ? { cliproxy: await claimPort("cliproxy", CLIPROXY_DEFAULT_PORT) }
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
      redact: (line) =>
        redactSecrets(
          line,
          this.config.persistent,
          Object.values(this.config.launchSecrets ?? {}),
        ),
    });
    const supervisorLog = this.logs.forService("desktop");
    supervisorLog.write(
      `[desktop] starting; mode=${this.paths.mode}${this.paths.qaMode ? `; qa-profile=${this.qaServiceProfile}` : ""}; config=${JSON.stringify(redactedConfigSummary(this.config))}`,
    );

    // Dev, non-QA only: QA runs isolated profiles under their own data root and
    // is deliberately parallel, so it must never be told it is a duplicate.
    if (this.paths.mode === "dev" && !this.paths.qaMode) {
      const repoRoot = repoRootFromModuleDir(this.moduleDir);
      const claim = claimDevInstance({ repoRoot, owner: "desktop" });
      if (claim.conflict && claim.existing) {
        const warning = duplicateStackWarning(claim.existing);
        supervisorLog.write(`[desktop] WARNING: ${warning}`);
        console.warn(`[breadboard-desktop] ${warning}`);
      } else if (claim.staleReplaced) {
        supervisorLog.write("[desktop] replaced a stale development-instance lock");
      }
      this.devInstanceLockRepoRoot = repoRoot;
    }

    installGpuDiagnostics(
      {
        onChildProcessGone: (listener) =>
          void app.on("child-process-gone", (_event, details) => listener(details)),
        // GPUFeatureStatus is a fixed-key interface, not an index signature.
        getGPUFeatureStatus: () => ({ ...app.getGPUFeatureStatus() }) as Record<string, unknown>,
        getGPUInfo: (mode) => app.getGPUInfo(mode),
      },
      (line) => supervisorLog.write(line),
    );

    this.systemMemorySource = defaultSystemMemorySource();
    const initialMemory = await this.systemMemorySource.sample();
    this.memoryPolicy = policyFromSnapshot(initialMemory, process.env);
    supervisorLog.write(
      `[governor] memory policy=${JSON.stringify(sanitizedPolicySummary(this.memoryPolicy))}; ` +
        `commitLimitMb=${Math.round(initialMemory.commitLimitMb)}; ` +
        `freeCommitMb=${Math.round(initialMemory.commitLimitMb - initialMemory.commitTotalMb)}`,
    );
    this.services = new ServiceManager(this.logs, {
      memoryPolicy: this.memoryPolicy,
      systemMetrics: this.systemMemorySource,
      runtimeSupervisorPath: path.join(
        this.paths.binDir,
        process.platform === "win32" ? "runtime-supervisor.exe" : "runtime-supervisor",
      ),
    });
    this.services.registerCapability({
      id: "learn-worker",
      estimatedColdStartCommitMb: LEARN_WORKER_ESTIMATED_COMMIT_MB,
      priority: 70,
      // Learn is an explicit, fenced foreground operation. It may consume the
      // soft reserve but must leave the critical reserve intact; critical and
      // emergency machines still reject it.
      reserveFloor: "critical",
      concurrencyGroup: "large-generation",
      maxLeaseMs: 6 * 60 * 60_000,
    });
    this.services.registerCapability({
      id: "document-ingestion",
      estimatedColdStartCommitMb: Math.min(4096, Math.round(initialMemory.physicalTotalMb * 0.125)),
      priority: 65,
      concurrencyGroup: "document-model",
      maxLeaseMs: 2 * 60 * 60_000,
    });
    this.services.registerCapability({
      id: "artifact-render",
      estimatedColdStartCommitMb: Math.min(4096, Math.round(initialMemory.physicalTotalMb * 0.125)),
      priority: 60,
      concurrencyGroup: "media-processing",
      maxLeaseMs: 2 * 60 * 60_000,
    });
    this.services.registerCapability({
      id: "browser-agent",
      estimatedColdStartCommitMb: Math.min(6144, Math.round(initialMemory.physicalTotalMb * 0.19)),
      priority: 60,
      concurrencyGroup: "browser-automation",
      maxLeaseMs: 2 * 60 * 60_000,
    });
    this.services.registerCapability({
      id: "postiz-stack",
      estimatedColdStartCommitMb: Math.min(8192, Math.round(initialMemory.physicalTotalMb * 0.25)),
      priority: 55,
      concurrencyGroup: "docker-stack",
      maxLeaseMs: 24 * 60 * 60_000,
    });
    const urls = serviceUrls(this.config);
    const startupHtmlPath = defaultStartupHtmlPath(this.moduleDir);
    const recoveryHtmlPath = path.join(path.dirname(startupHtmlPath), "recovery.html");
    const loadingHtmlPath = path.join(path.dirname(startupHtmlPath), "loading.html");
    const allowed = allowedOriginsFor([
      urls.dashboard,
      urls.quartz,
      pathToFileURL(startupHtmlPath).toString(),
      pathToFileURL(recoveryHtmlPath).toString(),
      pathToFileURL(loadingHtmlPath).toString(),
    ]);
    installGlobalSecurity(allowed);

    this.windows = new WindowManager({
      allowed,
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
        memoryPolicy: this.memoryPolicy,
      }),
      this.paths,
      this.qaServiceProfile,
    );
    // Scriberr's port is fixed rather than allocated, so nothing in the port
    // pass could have noticed the sidecar a dev stack (or an earlier launch)
    // left running on it. Spawning a second one just loses the race to bind.
    await this.probeFixedPortService("scriberr", SCRIBERR_PORT);
    for (const definition of definitions) {
      this.services.register(this.withAdoption(definition));
    }

    this.controlPlane = new SupervisorControlPlane({
      port: this.config.ports.supervisorControl ?? 7739,
      secret: this.config.launchSecrets?.supervisorControlToken ?? "",
      services: this.services,
      logs: this.logs,
    });
    await this.controlPlane.start();

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
    } catch (error) {
      const startupError = error instanceof Error ? error.message : String(error);
      this.logs
        .forService("desktop")
        .write(`[desktop] service startup failed: ${startupError}`);
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
      } else {
        // Fail closed even when the rejection happened outside a particular
        // service (for example the control plane or memory sampler). A startup
        // exception must never leave the renderer in its indeterminate
        // "Starting local services" state.
        this.setStartupState({
          ...this.snapshotServices("failed", "Local services could not start"),
          failure: {
            serviceId: "desktop",
            displayName: "Breadboard desktop",
            reason: startupError,
            logTail: this.services.tailLog("desktop"),
          },
        });
      }
      return;
    }

    this.setStartupState(this.snapshotServices("ready", "Ready"));
    await this.windows.showDashboard(serviceUrls(this.config).dashboard);
  }

  /**
   * Note a service whose port is fixed (never allocated) and that is already
   * answering on it, so registration can adopt it like any other.
   */
  private async probeFixedPortService(serviceId: string, port: number): Promise<void> {
    if (this.paths.qaMode || this.adoptedServicePorts.has(serviceId)) return;
    const persistent = this.config.persistent;
    if (await isOurServiceRunning(serviceId, port, { persistent, paths: this.paths })) {
      this.adoptedServicePorts.set(serviceId, port);
    }
  }

  /**
   * Hand the supervisor what it needs to reuse an already-running instance:
   * the flag, and the check that proves the instance is still ours when the
   * service is actually started. Definitions we found nothing for are returned
   * untouched and start normally.
   */
  private withAdoption(definition: DesktopServiceDefinition): DesktopServiceDefinition {
    const port = this.adoptedServicePorts.get(definition.id);
    if (port === undefined) return definition;
    const check = adoptionProbe(definition.id, port, {
      persistent: this.config.persistent,
      paths: this.paths,
    });
    if (check === null) return definition;
    this.logs
      .forService("desktop")
      .write(
        `[desktop] ${definition.displayName} is already running on 127.0.0.1:${port}; reusing it instead of starting another`,
      );
    return { ...definition, adoptExternal: true, adoptionCheck: check };
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
        adopted: status.adopted,
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
      case "humanizer":
        return "Loading local rewriting model";
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
      // Windows forgets an overlay's colours whenever it rebuilds the frame, so
      // the manager keeps what this window asked for and states it again.
      this.windows.rememberWindowSurface(window, surface);
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
        .write("[desktop] all windows disappeared unexpectedly; reopening the dashboard");
      void this.windows.showDashboard(serviceUrls(this.config).dashboard).catch((error) => {
        this.logs
          ?.forService("desktop")
          .write(
            `[desktop] dashboard window reopen failed: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    });
    process.on("uncaughtException", (error) => {
      try {
        this.logs?.forService("desktop").write(`[desktop] uncaught exception: ${error.stack ?? error.message}`);
      } catch {
        // Logging must not block emergency cleanup.
      }
      this.services?.killAllNow();
      if (this.paths) stopDetachedLearnWorkerNow(this.paths.runtimeDir);
      process.exit(1);
    });
    process.on("exit", () => {
      // Last-resort synchronous path: ask the OS to reap known children.
      if (!this.servicesStopped) this.services?.killAllNow();
      if (!this.servicesStopped && this.paths) {
        stopDetachedLearnWorkerNow(this.paths.runtimeDir);
      }
    });
  }

  /**
   * Ask the Postiz coordinator whether it may bring its Compose project down.
   *
   * Bounded and best-effort: a coordinator that is absent, unreachable, slow or
   * unconfigured must never delay Breadboard's own shutdown.
   */
  private async releasePostizStack(): Promise<void> {
    const token = this.config?.launchSecrets?.postizCoordinatorToken;
    const port = this.config?.ports.postizSupervisor;
    if (!token || !port) return;
    const log = this.logs?.forService("desktop");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/shutdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) return;
      const body = (await response.json()) as { stopped?: boolean };
      log?.write(
        body.stopped
          ? "[desktop] Postiz stack stopped on exit"
          : "[desktop] Postiz stack left running on exit",
      );
    } catch {
      // A coordinator that never started, or one already gone, is the common
      // case and is not worth a log line on every quit.
    } finally {
      clearTimeout(timer);
    }
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
      const learnWorkerPid = await stopDetachedLearnWorker(this.paths.runtimeDir);
      if (learnWorkerPid !== null) {
        this.logs
          ?.forService("desktop")
          .write(`[desktop] detached Learn worker tree stopped pid=${learnWorkerPid}`);
      }
      // Give the Postiz coordinator its exit decision before the supervisor
      // terminates it. On Windows a service is ended with TerminateProcess, so
      // an in-process SIGTERM handler would never run and a stack Breadboard
      // started would be left behind on every quit. The coordinator still
      // refuses for a pre-existing stack, an active hold, or pending
      // scheduled publishing — this only asks the question.
      await this.releasePostizStack();
      await this.services?.stopAll();
      await this.controlPlane?.stop();
      this.controlPlane = null;
      this.systemMemorySource?.stop?.();
      this.systemMemorySource = null;
      if (this.devInstanceLockRepoRoot !== null) {
        releaseDevInstance(this.devInstanceLockRepoRoot);
        this.devInstanceLockRepoRoot = null;
      }
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
