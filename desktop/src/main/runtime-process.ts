import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";
import { MAX_RUNTIME_STARTUP_TIMEOUT_MS } from "./runtime-startup-timeout";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;
export const RUNTIME_EXECUTABLE_NAME = "breadboard-runtime.exe";
export const MAX_RUNTIME_PROTOCOL_LINE_BYTES = 64 * 1024;

/**
 * The only product settings Electron may forward into the native Runtime.
 * Keep this byte-for-byte vocabulary aligned with
 * `OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES` in
 * `native/runtime-core/src/service_environment.rs`. Native then narrows each
 * value again to the one trusted service/worker profile that consumes it.
 */
export const RUNTIME_PRODUCT_ENVIRONMENT_NAMES = [
  "CHATMOCK_MODEL",
  "SKILLS_CATALOG_DB",
  "SKILLS_CATALOG_SYNC_INTERVAL_MINUTES",
  "BREADBOARD_CALDAV_SYNC_INTERVAL_MS",
  "BREADBOARD_EMAIL_DISABLED",
  "BREADBOARD_EMAIL_CREDENTIALS_FILE",
  "BREADBOARD_EMAIL_POLL_MS",
  "BREADBOARD_EMAIL_TURN_TIMEOUT_MS",
  "BREADBOARD_EMAIL_NEW_THREAD_MS",
  "BREADBOARD_TELEGRAM_ENABLED",
  "BREADBOARD_TELEGRAM_API_BASE",
  "BREADBOARD_TELEGRAM_TOKEN_FILE",
  "BREADBOARD_TELEGRAM_BOT_TOKEN",
  "BREADBOARD_TELEGRAM_NEW_CHAT_AFTER_MINUTES",
  "BREADBOARD_WHATSAPP_ENABLED",
  "BREADBOARD_WHATSAPP_BRIDGE_DIR",
  "BREADBOARD_WHATSAPP_SESSION_DIR",
  "BREADBOARD_WHATSAPP_BRIDGE_PORT",
  "BREADBOARD_WHATSAPP_NODE",
  "BREADBOARD_WHATSAPP_REPLY_PREFIX",
  "BREADBOARD_WHATSAPP_NEW_CHAT_AFTER_MINUTES",
  "HERMES_APP_DIR",
  "BREADBOARD_IFIXAI_MODE",
  "BREADBOARD_IFIXAI_PYTHON",
  "BREADBOARD_IFIXAI_ENDPOINT",
  "BREADBOARD_IFIXAI_SUITE",
  "BREADBOARD_IFIXAI_SUT_MODEL",
  "BREADBOARD_IFIXAI_JUDGE_MODEL",
  "BREADBOARD_IFIXAI_REPAIR_MODEL",
  "BREADBOARD_IFIXAI_SEED",
  "BREADBOARD_IFIXAI_INTERVAL_HOURS",
  "BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS",
  "BREADBOARD_IFIXAI_TIMEOUT_MINUTES",
  "BREADBOARD_IFIXAI_JUDGE_MAX_CALLS",
  "BREADBOARD_IFIXAI_MAX_ATTEMPTS",
  "BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT",
  "BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION",
  "VLM_OCR_ENABLED",
  "VLM_OCR_BASE_URL",
  "VLM_OCR_API_KEY",
  "VLM_OCR_MODEL",
  "VLM_OCR_AUTO_START",
  "VLM_OCR_SERVER_BINARY",
  "VLM_OCR_HF_REPO",
  "VLM_OCR_MODEL_PATH",
  "VLM_OCR_MMPROJ_PATH",
  "VLM_OCR_GPU_LAYERS",
  "VLM_OCR_CONTEXT_SIZE",
  "VLM_OCR_STARTUP_TIMEOUT_MS",
  "VLM_OCR_REQUEST_TIMEOUT_MS",
  "VLM_OCR_MAX_TOKENS",
  "VLM_OCR_TEMPERATURE",
  "VLM_OCR_TOP_P",
  "VLM_OCR_TOP_K",
  "VLM_OCR_REPEAT_PENALTY",
  "VLM_OCR_PAGE_IMAGE_WIDTH",
  "VLM_OCR_MAX_PAGES",
  "VLM_OCR_CONCURRENCY",
  "BREADBOARD_EMBEDDING_BASE_URL",
  "BREADBOARD_EMBEDDING_API_KEY",
  "BREADBOARD_EMBEDDING_MODEL",
  "BREADBOARD_EMBEDDING_DIMENSIONS",
  "BREADBOARD_EMBEDDINGS",
  "BREADBOARD_AGENT_MEMORY",
  "BREADBOARD_AGENT_MEMORY_AGENTS",
  "BREADBOARD_MEM0",
  "BREADBOARD_MEM0_EXTRACTION",
  "BREADBOARD_MEM0_LLM_MODEL",
  "BREADBOARD_GRAFT_CLI",
  "BREADBOARD_GIT_BIN",
  "RUFLO_CLAUDE_MODEL",
  "RUFLO_DANGEROUSLY_SKIP_PERMISSIONS",
  "BREADBOARD_VISUAL_BROWSER_PATH",
  "BREADBOARD_SPOTIFY_BROWSER_PATH",
  "BREADBOARD_SOLIDWORKS_EXE",
  "BREADBOARD_SOLIDWORKS_VERSION",
  "AGENT_BROWSER_EXECUTABLE_PATH",
  "SF3D_DEVICE",
  "SF3D_PRETRAINED_MODEL",
  "SF3D_TIMEOUT_MS",
  "UV_PATH",
  "SUBSAI_DEVICE",
  "SUBSAI_COMPUTE_TYPE",
  "SCRIBERR_API_TOKEN",
  "SCRIBERR_REQUEST_TIMEOUT_MS",
  "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS",
  "SCRIBERR_POLL_INTERVAL_MS",
  "SCRIBERR_MODEL_FAMILY",
  "SCRIBERR_MODEL",
  "SCRIBERR_LANGUAGE",
  "SCRIBERR_DIARIZATION",
  "VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS",
  "VIDEO_TRANSCRIPTION_KEEP_MEDIA",
  "VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB",
  "VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS",
  "VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS",
  "YTDLP_DOWNLOAD_TIMEOUT_MS",
  "VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN",
  "QUARTZ_AUTO_PUBLISH",
  "QUARTZ_PUBLISH_MODE",
  "QUARTZ_BUILD_CONCURRENCY",
  "QUARTZ_BUILD_TIMEOUT_MS",
  "GET_DOC_CONTACT_EMAIL",
  "OPENALEX_MAILTO",
  "UNPAYWALL_EMAIL",
  "CORE_API_KEY",
  "HUGGINGFACE_TOKEN",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "CUDA_VISIBLE_DEVICES",
  "CUDA_PATH",
  "CUDA_HOME",
  "CUDA_INCLUDE",
  "CUDA_LIB",
  "OMP_NUM_THREADS",
  "HF_HUB_OFFLINE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "LANG",
  "LC_ALL",
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
  "FAL_KEY",
  "FAL_AI_API_KEY",
  "REPLICATE_API_TOKEN",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
  "KLING_API_KEY",
  "KLING_API_BASE_URL",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DOUBAO_SPEECH_API_KEY",
  "DOUBAO_SPEECH_VOICE_TYPE",
  "DASHSCOPE_API_KEY",
  "SUNO_API_KEY",
  "HEYGEN_API_KEY",
  "RUNWAY_API_KEY",
  "VOLC_ACCESSKEY",
  "VOLC_SECRETKEY",
  "VIDEO_GEN_LOCAL_ENABLED",
  "VIDEO_GEN_LOCAL_MODEL",
  "MODAL_LTX2_ENDPOINT_URL",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "UNSPLASH_ACCESS_KEY",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "VIMAX_IMAGE_MODEL",
  "VOX_DIRECTOR_MUSIC_DIR",
  "SHORTS_WHISPER_DEVICE",
  "INTERACTIVE_VISUALIZER_ENABLED",
  "INTERACTIVE_VISUALIZER_BROWSER_TESTS",
  "INTERACTIVE_VISUALIZER_THREE_ENABLED",
  "INTERACTIVE_VISUALIZER_MAX_ATTEMPTS",
  "INTERACTIVE_VISUALIZER_MAX_SOURCE_BYTES",
  "INTERACTIVE_VISUALIZER_MAX_BUNDLE_BYTES",
  "INTERACTIVE_VISUALIZER_MAX_ARTIFACT_BYTES",
  "INTERACTIVE_VISUALIZER_BROWSER_TIMEOUT_MS",
  "INTERACTIVE_VISUALIZER_MAX_THREE_OBJECTS",
  "INTERACTIVE_VISUALIZER_MAX_VERTICES",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "DOCKER_CLI_PATH",
  "PODMAN_CLI_PATH",
  "DOCKER_DESKTOP_PATH",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "MANIM_DOCKER_IMAGE",
  "MANIM_TIMEOUT_MS",
  "POSTIZ_IDLE_TIMEOUT_MS",
  "POSTIZ_IDLE_CHECK_MS",
  "SOCIALS_MANAGER_READY_TIMEOUT_MS",
  "INBOX_ZERO_GOOGLE_CLIENT_ID",
  "INBOX_ZERO_GOOGLE_CLIENT_SECRET",
  "INBOX_ZERO_MICROSOFT_CLIENT_ID",
  "INBOX_ZERO_MICROSOFT_CLIENT_SECRET",
  "X_API_KEY",
  "X_API_SECRET",
  "X_URL",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "THREADS_APP_ID",
  "THREADS_APP_SECRET",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "GOOGLE_GMB_CLIENT_ID",
  "GOOGLE_GMB_CLIENT_SECRET",
  "TIKTOK_CLIENT_ID",
  "TIKTOK_CLIENT_SECRET",
  "PINTEREST_CLIENT_ID",
  "PINTEREST_CLIENT_SECRET",
  "DRIBBBLE_CLIENT_ID",
  "DRIBBBLE_CLIENT_SECRET",
  "TUMBLR_CLIENT_ID",
  "TUMBLR_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN_ID",
  "SLACK_ID",
  "SLACK_SECRET",
  "SLACK_SIGNING_SECRET",
  "KICK_CLIENT_ID",
  "KICK_SECRET",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "WHOP_CLIENT_ID",
  "VK_ID",
  "MEWE_APP_ID",
  "MEWE_API_KEY",
  "MEWE_HOST",
  "NEYNAR_CLIENT_ID",
  "NEYNAR_SECRET_KEY",
  "TELEGRAM_BOT_NAME",
  "TELEGRAM_TOKEN",
  "BREADBOARD_POSTIZ_POSTIZ_MEMORY_MB",
  "BREADBOARD_POSTIZ_POSTIZ_POSTGRES_MEMORY_MB",
  "BREADBOARD_POSTIZ_POSTIZ_REDIS_MEMORY_MB",
  "BREADBOARD_POSTIZ_SPOTLIGHT_MEMORY_MB",
  "BREADBOARD_POSTIZ_TEMPORAL_ELASTICSEARCH_MEMORY_MB",
  "BREADBOARD_POSTIZ_TEMPORAL_POSTGRESQL_MEMORY_MB",
  "BREADBOARD_POSTIZ_TEMPORAL_MEMORY_MB",
  "BREADBOARD_POSTIZ_TEMPORAL_ADMIN_TOOLS_MEMORY_MB",
  "BREADBOARD_POSTIZ_TEMPORAL_UI_MEMORY_MB",
  "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
] as const;

const MAX_RUNTIME_SERVICES = 256;
const MAX_SERVICE_ID_BYTES = 128;
const MAX_SERVICE_DISPLAY_NAME_BYTES = 256;
const MAX_SERVICE_ERROR_BYTES = 8 * 1024;
const MIN_CONTROL_TOKEN_BYTES = 32;
const MAX_CONTROL_TOKEN_BYTES = 1_024;
const MAX_SERVICE_RESTARTS = 64;
const MAX_RUNTIME_ROOT_BYTES = 4_096;
const MAX_LOOPBACK_URL_BYTES = 2_048;
const MAX_LOG_LINE_LENGTH = 4 * 1024;
const MAX_TIMEOUT_MS = 2 * 60 * 1000;

const RUNTIME_SERVICE_STATES = new Set<RuntimeServiceState>([
  "available-but-stopped",
  "starting",
  "ready",
  "busy",
  "resource-blocked",
  "installation-unavailable",
  "failed",
  "stopping",
]);

const RUNTIME_SERVICE_STARTUP_POLICIES = new Set<RuntimeServiceStartupPolicy>([
  "eager",
  "on-demand",
  "scheduled",
  "external",
]);

export type RuntimeLaunchMode = "lean" | "hot" | "packaged";

export type RuntimeServiceState =
  | "available-but-stopped"
  | "starting"
  | "ready"
  | "busy"
  | "resource-blocked"
  | "installation-unavailable"
  | "failed"
  | "stopping";

export type RuntimeServiceStartupPolicy =
  | "eager"
  | "on-demand"
  | "scheduled"
  | "external";

export interface RuntimeServiceStatus {
  readonly id: string;
  readonly displayName: string;
  readonly required: boolean;
  readonly startupPolicy: RuntimeServiceStartupPolicy;
  readonly state: RuntimeServiceState;
  readonly lastError: string | null;
  readonly restarts: number;
  readonly adopted: false;
}

export interface RuntimeBootstrapInput {
  readonly mode: RuntimeLaunchMode;
  readonly appRoot: string;
  /** Immutable executable and launch-manifest root derived by Electron main. */
  readonly runtimeRoot: string;
  readonly dataRoot: string;
  readonly configRoot: string;
}

export interface RuntimeReadySnapshot {
  readonly protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  readonly runtimePid: number;
  readonly dashboardUrl: string;
  readonly services: readonly RuntimeServiceStatus[];
}

export interface RuntimeStatusSnapshot {
  readonly protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  readonly runtimePid: number;
  readonly acceptingWork: boolean;
  readonly services: readonly RuntimeServiceStatus[];
}

export interface RuntimeServiceRetryResult {
  readonly protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  readonly ok: true;
  readonly serviceId: string;
  readonly accepted: boolean;
  readonly state: RuntimeServiceState;
}

export type RuntimeProcessState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

export interface RuntimeExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly reason: "exit";
}

export interface RuntimeStopResult {
  readonly graceful: boolean;
  readonly forced: boolean;
  readonly exited: boolean;
}

export interface RuntimeProcessOptions {
  /** Directory containing the one permitted executable name. */
  readonly binDir: string;
  readonly bootstrap: RuntimeBootstrapInput;
  readonly startupTimeoutMs?: number;
  readonly controlRequestTimeoutMs?: number;
  readonly gracefulShutdownTimeoutMs?: number;
  readonly forcedShutdownTimeoutMs?: number;
  readonly onLog?: (source: "stdout" | "stderr", line: string) => void;
  readonly onUnexpectedExit?: (exit: RuntimeExitInfo) => void;
}

export interface RuntimeSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: ["pipe", "pipe", "pipe"];
  readonly windowsHide: true;
  readonly shell: false;
  readonly detached: false;
}

/** Minimal child surface used by the adapter and its source-level unit tests. */
export interface RuntimeChildProcess {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface RuntimeProcessDependencies {
  readonly spawnRuntime: (
    executable: string,
    args: readonly string[],
    options: RuntimeSpawnOptions,
  ) => RuntimeChildProcess;
  readonly binaryExists: (executable: string) => boolean;
  readonly fetch: typeof fetch;
  readonly hostEnvironment: NodeJS.ProcessEnv;
}

export type RuntimeProcessErrorCode =
  | "INVALID_CONFIGURATION"
  | "DUPLICATE_START"
  | "RUNTIME_UNAVAILABLE"
  | "SPAWN_FAILED"
  | "STARTUP_TIMEOUT"
  | "PROTOCOL_VIOLATION"
  | "CONTROL_UNAVAILABLE"
  | "CONTROL_REJECTED";

export class RuntimeProcessError extends Error {
  readonly code: RuntimeProcessErrorCode;

  constructor(code: RuntimeProcessErrorCode, message: string) {
    super(message);
    this.name = "RuntimeProcessError";
    this.code = code;
  }
}

interface RuntimeTimeouts {
  readonly startup: number;
  readonly controlRequest: number;
  readonly gracefulShutdown: number;
  readonly forcedShutdown: number;
}

interface ReadyProtocolRecord {
  readonly runtimePid: number;
  readonly controlBaseUrl: string;
  readonly controlToken: string;
  readonly dashboardUrl: string;
  readonly services: readonly RuntimeServiceStatus[];
}

interface BoundedLineReader {
  readonly promise: Promise<{ readonly line: string; readonly remainder: Buffer }>;
  cancel(): void;
}

const DEFAULT_DEPENDENCIES: RuntimeProcessDependencies = {
  spawnRuntime: (executable, args, options) =>
    spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: false,
    }) as unknown as RuntimeChildProcess,
  binaryExists: (executable) => {
    try {
      return fs.statSync(executable).isFile();
    } catch {
      return false;
    }
  },
  fetch: globalThis.fetch.bind(globalThis),
  hostEnvironment: process.env,
};

/**
 * Electron's deliberately narrow bridge to Runtime V2.
 *
 * This class can launch only `<binDir>/breadboard-runtime.exe`, exactly once.
 * Runtime authority is delivered as one bounded stdin record; no command,
 * argument, or environment setting can select a legacy executable or fallback.
 */
export class RuntimeProcess {
  readonly #binDir: string;
  readonly #executable: string;
  readonly #bootstrap: RuntimeBootstrapInput;
  readonly #timeouts: RuntimeTimeouts;
  readonly #onLog: RuntimeProcessOptions["onLog"];
  readonly #onUnexpectedExit: RuntimeProcessOptions["onUnexpectedExit"];
  readonly #dependencies: RuntimeProcessDependencies;

  #state: RuntimeProcessState = "idle";
  #child: RuntimeChildProcess | null = null;
  #runtimePid: number | null = null;
  #exitPromise: Promise<RuntimeExitInfo> | null = null;
  #spawnErrorPromise: Promise<never> | null = null;
  #exitSettled = false;
  #controlBaseUrl: string | null = null;
  #controlToken: string | null = null;
  #readySnapshot: RuntimeReadySnapshot | null = null;
  #statusSnapshot: RuntimeStatusSnapshot | null = null;
  #shutdownPromise: Promise<void> | null = null;
  #stopPromise: Promise<RuntimeStopResult> | null = null;
  #terminationExpected = false;

  constructor(
    options: RuntimeProcessOptions,
    dependencies: Partial<RuntimeProcessDependencies> = {},
  ) {
    this.#binDir = normalizeAbsolutePath(options.binDir, "binDir");
    this.#executable = path.join(this.#binDir, RUNTIME_EXECUTABLE_NAME);
    this.#bootstrap = Object.freeze({
      mode: validateLaunchMode(options.bootstrap.mode),
      appRoot: normalizeAbsolutePath(options.bootstrap.appRoot, "appRoot"),
      runtimeRoot: normalizeAbsolutePath(options.bootstrap.runtimeRoot, "runtimeRoot"),
      dataRoot: normalizeAbsolutePath(options.bootstrap.dataRoot, "dataRoot"),
      configRoot: normalizeAbsolutePath(options.bootstrap.configRoot, "configRoot"),
    });
    this.#timeouts = Object.freeze({
      startup: validateTimeout(
        options.startupTimeoutMs,
        15_000,
        "startupTimeoutMs",
        MAX_RUNTIME_STARTUP_TIMEOUT_MS,
      ),
      controlRequest: validateTimeout(
        options.controlRequestTimeoutMs,
        2_000,
        "controlRequestTimeoutMs",
      ),
      gracefulShutdown: validateTimeout(
        options.gracefulShutdownTimeoutMs,
        5_000,
        "gracefulShutdownTimeoutMs",
      ),
      forcedShutdown: validateTimeout(
        options.forcedShutdownTimeoutMs,
        3_000,
        "forcedShutdownTimeoutMs",
      ),
    });
    this.#onLog = options.onLog;
    this.#onUnexpectedExit = options.onUnexpectedExit;
    this.#dependencies = Object.freeze({
      spawnRuntime: dependencies.spawnRuntime ?? DEFAULT_DEPENDENCIES.spawnRuntime,
      binaryExists: dependencies.binaryExists ?? DEFAULT_DEPENDENCIES.binaryExists,
      fetch: dependencies.fetch ?? DEFAULT_DEPENDENCIES.fetch,
      hostEnvironment: dependencies.hostEnvironment ?? DEFAULT_DEPENDENCIES.hostEnvironment,
    });
  }

  get state(): RuntimeProcessState {
    return this.#state;
  }

  get pid(): number | null {
    return this.#runtimePid;
  }

  get dashboardUrl(): string | null {
    return this.#readySnapshot?.dashboardUrl ?? null;
  }

  /** Last sanitized ready/status record. This never contains control authority. */
  snapshot(): RuntimeReadySnapshot | RuntimeStatusSnapshot | null {
    return this.#statusSnapshot ?? this.#readySnapshot;
  }

  async start(): Promise<RuntimeReadySnapshot> {
    if (this.#state !== "idle") {
      throw new RuntimeProcessError(
        "DUPLICATE_START",
        `Runtime V2 may be started exactly once (current state: ${this.#state}); legacy fallback is disabled.`,
      );
    }
    this.#state = "starting";

    if (!this.#dependencies.binaryExists(this.#executable)) {
      this.#state = "failed";
      throw new RuntimeProcessError(
        "RUNTIME_UNAVAILABLE",
        "Required Runtime V2 executable is unavailable; legacy fallback is disabled.",
      );
    }

    let bootstrapLine: string;
    try {
      bootstrapLine = encodeBootstrap(this.#bootstrap);
    } catch (error) {
      this.#state = "failed";
      throw error;
    }
    let readyReader: BoundedLineReader | null = null;
    const deadline = Date.now() + this.#timeouts.startup;

    try {
      const child = this.#dependencies.spawnRuntime(this.#executable, [], {
        cwd: this.#binDir,
        env: selectRuntimeEnvironment(this.#dependencies.hostEnvironment),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        detached: false,
      });
      this.#child = child;
      this.#observeExit(child);
      // Pipe errors are observations, never proof that the OS reaped the PID.
      child.stdin.on("error", () => undefined);
      child.stdout.on("error", () => undefined);
      child.stderr.on("error", () => undefined);
      const childPid = requirePositivePid(child.pid, "spawned runtime PID");
      this.#runtimePid = childPid;
      readyReader = readOneBoundedLine(child.stdout, MAX_RUNTIME_PROTOCOL_LINE_BYTES);
      this.#drainLogs(child.stderr, "stderr");
      const readyOrExit = Promise.race([
        readyReader.promise,
        this.#exitBeforeReady(),
        this.#spawnErrorBeforeReady(),
      ]);
      // Install a rejection observer before the bootstrap flush; a runtime can
      // fail synchronously while the stdin write callback is still pending.
      void readyOrExit.catch(() => undefined);

      await withDeadline(
        writePrivateBootstrap(child.stdin, bootstrapLine),
        deadline,
        "Runtime V2 did not accept its bootstrap before the startup deadline.",
      );

      const readyLine = await withDeadline(
        readyOrExit,
        deadline,
        "Runtime V2 did not publish its ready handshake before the startup deadline.",
      );
      readyReader.cancel();
      readyReader = null;

      const ready = parseReadyRecord(readyLine.line, childPid);
      if (this.#exitSettled) {
        throw new RuntimeProcessError(
          "SPAWN_FAILED",
          "Runtime V2 exited while its ready handshake was being accepted.",
        );
      }

      this.#controlBaseUrl = ready.controlBaseUrl;
      this.#controlToken = ready.controlToken;
      this.#readySnapshot = freezeReadySnapshot(ready);
      this.#drainLogs(child.stdout, "stdout", readyLine.remainder);
      this.#state = "ready";
      return this.#readySnapshot;
    } catch (error) {
      readyReader?.cancel();
      // `stop()` may run while `start()` is awaiting bootstrap/readiness. Keep
      // that asynchronous transition visible to TypeScript through a helper;
      // local control-flow narrowing cannot observe mutation from another task.
      if (!runtimeShutdownStarted(this.#state)) {
        this.#state = "failed";
      }
      this.#clearControlAuthority();
      this.#forceTerminate();
      await this.#waitForExit(this.#timeouts.forcedShutdown);
      if (error instanceof RuntimeProcessError) throw error;
      throw new RuntimeProcessError(
        "SPAWN_FAILED",
        "Runtime V2 failed to start; legacy fallback is disabled.",
      );
    }
  }

  /** Fetches a bounded, authenticated status record and returns only UI-safe fields. */
  async status(): Promise<RuntimeStatusSnapshot> {
    this.#requireReady("read status");
    const redactionToken = this.#controlToken as string;
    let value: unknown;
    try {
      value = await this.#controlJson("/v1/status", "GET");
    } catch (error) {
      // The private listener is bound before the ready record is published,
      // but a cold Hot compiler can temporarily starve the Electron fetch and
      // native connection-handler threads at that exact handoff. Status is a
      // passive read, so permit one bounded second read only while the same
      // fixed runtime root is still observed ready. Mutations, rejected HTTP
      // responses, protocol faults, and process exits are never retried.
      if (
        !(error instanceof RuntimeProcessError) ||
        error.code !== "CONTROL_UNAVAILABLE" ||
        this.#state !== "ready"
      ) {
        throw error;
      }
      value = await this.#controlJson("/v1/status", "GET");
    }
    const status = parseStatusRecord(value, this.#runtimePid as number, redactionToken);
    if (this.#state !== "ready") {
      throw new RuntimeProcessError(
        "CONTROL_UNAVAILABLE",
        "Runtime V2 left ready state while status was in flight.",
      );
    }
    this.#statusSnapshot = status;
    return status;
  }

  /** Retries one exact manifest service through lifecycle-only authority. */
  async retryService(serviceId: string): Promise<RuntimeServiceRetryResult> {
    this.#requireReady("retry service");
    if (
      Buffer.byteLength(serviceId, "utf8") > MAX_SERVICE_ID_BYTES ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(serviceId)
    ) {
      throw new RuntimeProcessError(
        "INVALID_CONFIGURATION",
        "Runtime V2 service retry id is invalid.",
      );
    }
    const value = await this.#controlJson(
      `/v1/lifecycle/services/${serviceId}/retry`,
      "POST",
      false,
      {},
    );
    return parseServiceRetryResult(value, serviceId);
  }

  /**
   * Stops admission and asks Runtime V2 to drain. Process exit is awaited by
   * `stop()`, which owns the bounded direct-root fallback.
   */
  beginShutdown(): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#requireReady("begin shutdown");
    this.#state = "stopping";
    this.#shutdownPromise = this.#requestShutdown();
    return this.#shutdownPromise;
  }

  /** Requests graceful shutdown once, then signals only the fixed runtime root. */
  stop(): Promise<RuntimeStopResult> {
    if (!this.#stopPromise) this.#stopPromise = this.#stopOnce();
    return this.#stopPromise;
  }

  /**
   * Last-resort synchronous exit path for Electron fatal handlers.
   *
   * Only the already-launched fixed Runtime V2 root can be signalled here.
   * Runtime V2 owns its descendants in one kill-on-close process tree, so this
   * deliberately does not enumerate, adopt, or directly terminate services.
   */
  terminateNow(): void {
    if (this.#state === "idle") {
      this.#state = "stopped";
      return;
    }
    if (this.#state === "stopped" || this.#exitSettled) {
      this.#closePrivateStdin();
      return;
    }
    this.#state = "stopping";
    this.#forceTerminate();
  }

  async #requestShutdown(): Promise<void> {
    const value = await this.#controlJson("/v1/shutdown", "POST", true);
    if (!isRecord(value) || value["ok"] !== true) {
      throw new RuntimeProcessError(
        "PROTOCOL_VIOLATION",
        "Runtime V2 returned an invalid shutdown acknowledgement.",
      );
    }
    requireExactKeys(value, ["ok"], "shutdown acknowledgement");
    this.#terminationExpected = true;
  }

  async #stopOnce(): Promise<RuntimeStopResult> {
    if (this.#state === "idle") {
      this.#state = "stopped";
      return Object.freeze({ graceful: true, forced: false, exited: true });
    }
    if (this.#state === "stopped") {
      this.#closePrivateStdin();
      return Object.freeze({ graceful: true, forced: false, exited: true });
    }
    if (!this.#child) {
      this.#state = "stopped";
      return Object.freeze({ graceful: false, forced: false, exited: true });
    }
    if (this.#exitSettled) {
      this.#closePrivateStdin();
      return Object.freeze({ graceful: false, forced: false, exited: true });
    }

    let shutdownAttempted = false;
    let shutdownAccepted = false;
    if (this.#state === "ready" || this.#shutdownPromise) {
      shutdownAttempted = true;
      try {
        await (this.#shutdownPromise ?? this.beginShutdown());
        shutdownAccepted = true;
      } catch {
        // The bounded force path below is the only fallback.
      }
    } else {
      this.#state = "stopping";
    }

    if (this.#exitSettled) {
      const exit = await this.#waitForExit(this.#timeouts.forcedShutdown);
      this.#closePrivateStdin();
      return Object.freeze({
        graceful: shutdownAccepted || (shutdownAttempted && isCleanExit(exit)),
        forced: false,
        exited: true,
      });
    }

    if (shutdownAccepted) {
      const exit = await this.#waitForExit(this.#timeouts.gracefulShutdown);
      if (exit) {
        this.#closePrivateStdin();
        return Object.freeze({ graceful: true, forced: false, exited: true });
      }
    }

    if (this.#exitSettled) {
      const exit = await this.#waitForExit(this.#timeouts.forcedShutdown);
      this.#closePrivateStdin();
      return Object.freeze({
        graceful: shutdownAccepted || (shutdownAttempted && isCleanExit(exit)),
        forced: false,
        exited: true,
      });
    }
    this.#state = "stopping";
    this.#forceTerminate();
    const forcedExit = await this.#waitForExit(this.#timeouts.forcedShutdown);
    if (!forcedExit && !this.#exitSettled) this.#state = "failed";
    return Object.freeze({
      graceful: false,
      forced: true,
      exited: forcedExit !== null || this.#exitSettled,
    });
  }

  async #controlJson(
    endpoint: string,
    method: "GET" | "POST",
    allowStopping = false,
    body?: Record<string, never>,
  ): Promise<unknown> {
    if (!allowStopping) this.#requireReady(`${method} ${endpoint}`);
    const baseUrl = this.#controlBaseUrl;
    const token = this.#controlToken;
    if (!baseUrl || !token) {
      throw new RuntimeProcessError(
        "CONTROL_UNAVAILABLE",
        "Runtime V2 control authority is unavailable.",
      );
    }

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), this.#timeouts.controlRequest);
    abortTimer.unref?.();
    const request = async (): Promise<unknown> => {
      let response: Response;
      try {
        response = await this.#dependencies.fetch(new URL(endpoint, baseUrl), {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new RuntimeProcessError(
          "CONTROL_UNAVAILABLE",
          `Runtime V2 ${endpoint} request failed or timed out.`,
        );
      }
      if (!response.ok) {
        throw new RuntimeProcessError(
          "CONTROL_REJECTED",
          `Runtime V2 ${endpoint} request was rejected with HTTP ${response.status}.`,
        );
      }
      return readBoundedJsonResponse(response, MAX_RUNTIME_PROTOCOL_LINE_BYTES);
    };
    try {
      return await withTimeout(
        request(),
        this.#timeouts.controlRequest,
        `Runtime V2 ${endpoint} request failed or timed out.`,
      );
    } finally {
      clearTimeout(abortTimer);
      controller.abort();
    }
  }

  #requireReady(operation: string): void {
    if (this.#state !== "ready" || !this.#controlBaseUrl || !this.#controlToken) {
      throw new RuntimeProcessError(
        "CONTROL_UNAVAILABLE",
        `Cannot ${operation} while Runtime V2 is ${this.#state}.`,
      );
    }
  }

  #observeExit(child: RuntimeChildProcess): void {
    this.#spawnErrorPromise = new Promise<never>((_resolve, reject) => {
      child.on("error", () =>
        reject(
          new RuntimeProcessError(
            "SPAWN_FAILED",
            "Runtime V2 process channel failed before readiness.",
          ),
        ),
      );
    });
    // A post-ready ChildProcess `error` (for example, a failed kill request) is
    // not exit proof and must never become an unhandled rejection.
    void this.#spawnErrorPromise.catch(() => undefined);
    let settled = false;
    this.#exitPromise = new Promise<RuntimeExitInfo>((resolve) => {
      const settle = (exit: RuntimeExitInfo): void => {
        if (settled) return;
        settled = true;
        const previousState = this.#state;
        const expected =
          this.#terminationExpected ||
          (previousState === "stopping" && isCleanExit(exit));
        this.#exitSettled = true;
        this.#clearControlAuthority();
        this.#state = expected && previousState !== "failed" ? "stopped" : "failed";
        resolve(exit);
        if (
          !expected &&
          (previousState === "ready" || previousState === "stopping") &&
          this.#onUnexpectedExit
        ) {
          try {
            this.#onUnexpectedExit(exit);
          } catch {
            // Observer failures must not create another process-lifecycle failure.
          }
        }
      };
      child.once("exit", (code, signal) =>
        settle(Object.freeze({ code, signal, reason: "exit" })),
      );
    });
  }

  async #exitBeforeReady(): Promise<never> {
    const exit = await (this.#exitPromise as Promise<RuntimeExitInfo>);
    throw new RuntimeProcessError(
      "SPAWN_FAILED",
      `Runtime V2 exited before readiness (${formatExit(exit)}).`,
    );
  }

  async #spawnErrorBeforeReady(): Promise<never> {
    return this.#spawnErrorPromise as Promise<never>;
  }

  async #waitForExit(timeoutMs: number): Promise<RuntimeExitInfo | null> {
    if (this.#exitSettled && this.#exitPromise) return this.#exitPromise;
    if (!this.#exitPromise) return null;
    return raceWithDelay(this.#exitPromise, timeoutMs, null);
  }

  #forceTerminate(): void {
    const child = this.#child;
    if (!child || this.#exitSettled) return;
    this.#terminationExpected = true;
    this.#closePrivateStdin();
    if (!this.#exitSettled) {
      try {
        child.kill("SIGKILL");
      } catch {
        // `stop()` reports whether an exit was actually observed.
      }
    }
  }

  #closePrivateStdin(): void {
    const stdin = this.#child?.stdin;
    if (!stdin || stdin.destroyed) return;
    try {
      stdin.end();
    } catch {
      stdin.destroy();
    }
  }

  #clearControlAuthority(): void {
    this.#controlBaseUrl = null;
    this.#controlToken = null;
  }

  #drainLogs(
    stream: Readable,
    source: "stdout" | "stderr",
    initial: Buffer = Buffer.alloc(0),
  ): void {
    stream.on("error", () => undefined);
    if (!this.#onLog) {
      stream.resume();
      return;
    }

    let pending = "";
    const accept = (chunk: Buffer): void => {
      // Do not retain a partial pre-ready line and emit it after the control
      // token becomes available. Startup output is intentionally discarded as
      // a whole lifecycle phase; retaining only its unterminated tail would
      // reopen the same secret/path disclosure race as forwarding it directly.
      if (
        (this.#state !== "ready" && this.#state !== "stopping") ||
        !this.#controlToken
      ) {
        pending = "";
        return;
      }
      const boundedChunk = chunk.subarray(0, MAX_LOG_LINE_LENGTH * 2);
      pending += boundedChunk.toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        this.#emitLog(source, pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      if (pending.length > MAX_LOG_LINE_LENGTH) {
        this.#emitLog(source, `${pending.slice(0, MAX_LOG_LINE_LENGTH)}…`);
        pending = "";
      }
    };

    if (initial.length > 0) accept(initial);
    stream.on("data", (chunk: Buffer | string) =>
      accept(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")),
    );
    stream.on("end", () => {
      if (pending.length > 0) this.#emitLog(source, pending);
      pending = "";
    });
    stream.resume();
  }

  #emitLog(source: "stdout" | "stderr", line: string): void {
    if (!this.#onLog) return;
    // Startup output can race ahead of the private ready record that tells us
    // which token to redact. Drain it, but never forward it across that race.
    if (
      (this.#state !== "ready" && this.#state !== "stopping") ||
      !this.#controlToken
    ) {
      return;
    }
    let sanitized = line
      .replace(/\r$/, "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "�")
      .slice(0, MAX_LOG_LINE_LENGTH);
    if (/controlToken/i.test(sanitized)) {
      sanitized = "[redacted Runtime V2 control record]";
    } else if (this.#controlToken && sanitized.includes(this.#controlToken)) {
      sanitized = sanitized.split(this.#controlToken).join("[redacted]");
    }
    if (sanitized.length === 0) return;
    try {
      this.#onLog(source, sanitized);
    } catch {
      // Logging is observational and cannot own runtime lifecycle.
    }
  }
}

function encodeBootstrap(input: RuntimeBootstrapInput): string {
  const record = {
    type: "runtime-bootstrap",
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    mode: input.mode,
    appRoot: input.appRoot,
    runtimeRoot: input.runtimeRoot,
    dataRoot: input.dataRoot,
    configRoot: input.configRoot,
  } as const;
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line, "utf8") > MAX_RUNTIME_PROTOCOL_LINE_BYTES) {
    throw new RuntimeProcessError(
      "INVALID_CONFIGURATION",
      `Runtime V2 bootstrap exceeds ${MAX_RUNTIME_PROTOCOL_LINE_BYTES} bytes.`,
    );
  }
  return line;
}

function parseReadyRecord(line: string, childPid: number): ReadyProtocolRecord {
  const value = parseProtocolJson(line, "ready handshake");
  if (!isRecord(value) || value["type"] !== "runtime-ready") {
    throw protocolViolation("Runtime V2 sent an unexpected ready record type.");
  }
  requireExactKeys(
    value,
    [
      "type",
      "protocolVersion",
      "runtimePid",
      "controlBaseUrl",
      "controlToken",
      "dashboardUrl",
      "services",
    ],
    "ready handshake",
  );
  requireProtocolVersion(value["protocolVersion"]);
  const runtimePid = requirePositivePid(value["runtimePid"], "ready runtimePid");
  if (runtimePid !== childPid) {
    throw protocolViolation("Runtime V2 ready PID does not match the spawned process.");
  }
  const controlToken = validateControlToken(value["controlToken"]);
  const dashboardUrl = validateLoopbackUrl(value["dashboardUrl"], "dashboardUrl", false);
  if (dashboardUrl.includes(controlToken)) {
    throw protocolViolation("Runtime V2 dashboard URL must not contain control authority.");
  }
  return Object.freeze({
    runtimePid,
    controlBaseUrl: validateLoopbackUrl(value["controlBaseUrl"], "controlBaseUrl", true),
    controlToken,
    dashboardUrl,
    services: parseServices(value["services"], controlToken),
  });
}

function parseStatusRecord(
  value: unknown,
  expectedPid: number,
  redactionToken: string,
): RuntimeStatusSnapshot {
  if (!isRecord(value) || value["type"] !== "runtime-status") {
    throw protocolViolation("Runtime V2 sent an unexpected status record type.");
  }
  requireExactKeys(
    value,
    ["type", "protocolVersion", "runtimePid", "acceptingWork", "services"],
    "status record",
  );
  requireProtocolVersion(value["protocolVersion"]);
  const runtimePid = requirePositivePid(value["runtimePid"], "status runtimePid");
  if (runtimePid !== expectedPid) {
    throw protocolViolation("Runtime V2 status PID does not match the launched runtime.");
  }
  if (typeof value["acceptingWork"] !== "boolean") {
    throw protocolViolation("Runtime V2 status acceptingWork must be boolean.");
  }
  return Object.freeze({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    runtimePid,
    acceptingWork: value["acceptingWork"],
    services: parseServices(value["services"], redactionToken),
  });
}

function parseServiceRetryResult(
  value: unknown,
  expectedServiceId: string,
): RuntimeServiceRetryResult {
  if (!isRecord(value)) {
    throw protocolViolation("Runtime V2 service retry response is invalid.");
  }
  requireExactKeys(
    value,
    ["protocolVersion", "ok", "serviceId", "accepted", "state"],
    "service retry response",
  );
  requireProtocolVersion(value["protocolVersion"]);
  if (
    value["ok"] !== true ||
    value["serviceId"] !== expectedServiceId ||
    typeof value["accepted"] !== "boolean" ||
    typeof value["state"] !== "string" ||
    !RUNTIME_SERVICE_STATES.has(value["state"] as RuntimeServiceState)
  ) {
    throw protocolViolation("Runtime V2 service retry response is invalid.");
  }
  return Object.freeze({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    ok: true,
    serviceId: expectedServiceId,
    accepted: value["accepted"],
    state: value["state"] as RuntimeServiceState,
  });
}

function parseServices(value: unknown, redactionToken: string): readonly RuntimeServiceStatus[] {
  if (!Array.isArray(value) || value.length > MAX_RUNTIME_SERVICES) {
    throw protocolViolation(
      `Runtime V2 services must be an array of at most ${MAX_RUNTIME_SERVICES} records.`,
    );
  }
  const ids = new Set<string>();
  const services = value.map((candidate): RuntimeServiceStatus => {
    if (!isRecord(candidate)) throw protocolViolation("Runtime V2 service record is invalid.");
    requireExactKeys(
      candidate,
      [
        "id",
        "displayName",
        "required",
        "startupPolicy",
        "state",
        "lastError",
        "restarts",
        "adopted",
      ],
      "service record",
    );
    const id = candidate["id"];
    if (
      typeof id !== "string" ||
      Buffer.byteLength(id, "utf8") > MAX_SERVICE_ID_BYTES ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id)
    ) {
      throw protocolViolation("Runtime V2 service id is invalid.");
    }
    if (ids.has(id)) throw protocolViolation("Runtime V2 sent a duplicate service id.");
    if (id.includes(redactionToken)) {
      throw protocolViolation("Runtime V2 service id must not contain control authority.");
    }
    ids.add(id);

    const displayName = candidate["displayName"];
    if (
      typeof displayName !== "string" ||
      Buffer.byteLength(displayName, "utf8") < 1 ||
      Buffer.byteLength(displayName, "utf8") > MAX_SERVICE_DISPLAY_NAME_BYTES ||
      /\p{Cc}/u.test(displayName)
    ) {
      throw protocolViolation("Runtime V2 service displayName is invalid.");
    }
    if (displayName.includes(redactionToken)) {
      throw protocolViolation("Runtime V2 service displayName must not contain control authority.");
    }
    if (typeof candidate["required"] !== "boolean") {
      throw protocolViolation("Runtime V2 service required flag is invalid.");
    }
    const startupPolicy = candidate["startupPolicy"];
    if (
      typeof startupPolicy !== "string" ||
      !RUNTIME_SERVICE_STARTUP_POLICIES.has(startupPolicy as RuntimeServiceStartupPolicy)
    ) {
      throw protocolViolation("Runtime V2 service startupPolicy is invalid.");
    }
    const state = candidate["state"];
    if (typeof state !== "string" || !RUNTIME_SERVICE_STATES.has(state as RuntimeServiceState)) {
      throw protocolViolation("Runtime V2 service state is invalid.");
    }
    const lastError = candidate["lastError"];
    if (
      lastError !== null &&
      (typeof lastError !== "string" ||
        Buffer.byteLength(lastError, "utf8") < 1 ||
        Buffer.byteLength(lastError, "utf8") > MAX_SERVICE_ERROR_BYTES)
    ) {
      throw protocolViolation("Runtime V2 service lastError is invalid.");
    }
    const restarts = candidate["restarts"];
    if (
      !Number.isSafeInteger(restarts) ||
      (restarts as number) < 0 ||
      (restarts as number) > MAX_SERVICE_RESTARTS
    ) {
      throw protocolViolation(
        `Runtime V2 service restarts must be an integer from 0 through ${MAX_SERVICE_RESTARTS}.`,
      );
    }
    if (candidate["adopted"] !== false) {
      throw protocolViolation("Runtime V2 is the sole owner; adopted services are forbidden.");
    }

    const sanitizedLastError =
      typeof lastError === "string"
        ? lastError
            .split(redactionToken)
            .join("[redacted]")
            .replace(/\p{Cc}/gu, (character) =>
              character === "\n" || character === "\r" || character === "\t"
                ? character
                : "�",
            )
        : null;
    return Object.freeze({
      id,
      displayName,
      required: candidate["required"],
      startupPolicy: startupPolicy as RuntimeServiceStartupPolicy,
      state: state as RuntimeServiceState,
      lastError: sanitizedLastError,
      restarts: restarts as number,
      adopted: false,
    });
  });
  return Object.freeze(services);
}

function freezeReadySnapshot(value: ReadyProtocolRecord): RuntimeReadySnapshot {
  return Object.freeze({
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    runtimePid: value.runtimePid,
    dashboardUrl: value.dashboardUrl,
    services: value.services,
  });
}

function parseProtocolJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw protocolViolation(`Runtime V2 ${label} is not valid JSON.`);
  }
}

function requireProtocolVersion(value: unknown): void {
  if (value !== RUNTIME_PROTOCOL_VERSION) {
    throw protocolViolation(
      `Runtime V2 protocol mismatch; expected version ${RUNTIME_PROTOCOL_VERSION}.`,
    );
  }
}

function validateLoopbackUrl(value: unknown, label: string, returnOrigin: boolean): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > MAX_LOOPBACK_URL_BYTES ||
    /\p{Cc}/u.test(value) ||
    (!value.startsWith("http://127.0.0.1:") && !value.startsWith("http://[::1]:"))
  ) {
    throw protocolViolation(`Runtime V2 ${label} must be an uncredentialed loopback HTTP URL.`);
  }
  const prefix = value.startsWith("http://127.0.0.1:")
    ? "http://127.0.0.1:"
    : "http://[::1]:";
  const portMatch = /^(\d+)\/?$/.exec(value.slice(prefix.length));
  const port = portMatch ? Number(portMatch[1]) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw protocolViolation(`Runtime V2 ${label} port is invalid.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw protocolViolation(`Runtime V2 ${label} is not a valid URL.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(host) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.pathname !== "/"
  ) {
    throw protocolViolation(`Runtime V2 ${label} must be an uncredentialed loopback HTTP URL.`);
  }
  return returnOrigin ? parsed.origin : parsed.toString();
}

function validateControlToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < MIN_CONTROL_TOKEN_BYTES ||
    Buffer.byteLength(value, "utf8") > MAX_CONTROL_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw protocolViolation("Runtime V2 control token is invalid.");
  }
  return value;
}

function requirePositivePid(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw protocolViolation(`Runtime V2 ${label} must be a positive integer.`);
  }
  return value as number;
}

function protocolViolation(message: string): RuntimeProcessError {
  return new RuntimeProcessError("PROTOCOL_VIOLATION", message);
}

function runtimeShutdownStarted(state: RuntimeProcessState): boolean {
  return state === "stopping" || state === "stopped";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw protocolViolation(`Runtime V2 ${label} contains missing or unknown fields.`);
  }
}

function validateLaunchMode(mode: RuntimeLaunchMode): RuntimeLaunchMode {
  if (mode !== "lean" && mode !== "hot" && mode !== "packaged") {
    throw new RuntimeProcessError("INVALID_CONFIGURATION", "Runtime V2 launch mode is invalid.");
  }
  return mode;
}

function normalizeAbsolutePath(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > MAX_RUNTIME_ROOT_BYTES ||
    /\p{Cc}/u.test(value)
  ) {
    throw new RuntimeProcessError("INVALID_CONFIGURATION", `${label} is invalid.`);
  }
  if (!path.isAbsolute(value)) {
    throw new RuntimeProcessError("INVALID_CONFIGURATION", `${label} must be an absolute path.`);
  }
  return path.normalize(value);
}

function validateTimeout(
  value: number | undefined,
  fallback: number,
  label: string,
  maximum = MAX_TIMEOUT_MS,
): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maximum) {
    throw new RuntimeProcessError(
      "INVALID_CONFIGURATION",
      `${label} must be an integer from 1 through ${maximum}.`,
    );
  }
  return timeout;
}

function selectRuntimeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const target: NodeJS.ProcessEnv = {};
  const groups: readonly (readonly string[])[] = [
    ["SYSTEMROOT", "SystemRoot"],
    ["SYSTEMDRIVE", "SystemDrive"],
    ["WINDIR", "windir"],
    ["TEMP", "Temp"],
    ["TMP", "Tmp"],
    ["USERPROFILE", "UserProfile"],
    ["LOCALAPPDATA", "LocalAppData"],
    ["APPDATA", "AppData"],
    ["PROGRAMDATA", "ProgramData"],
    ["PROGRAMFILES", "ProgramFiles"],
    ["PROGRAMFILES(X86)", "ProgramFiles(x86)"],
    ["HOME"],
    ["USER"],
    ["TMPDIR"],
    ["LANG"],
    ["LC_ALL"],
  ];
  for (const aliases of groups) {
    for (const key of aliases) {
      const value = source[key];
      if (value !== undefined) {
        target[aliases[0] as string] = value;
        break;
      }
    }
  }
  for (const name of RUNTIME_PRODUCT_ENVIRONMENT_NAMES) {
    const value = source[name];
    // QA keeps denied credentials explicitly empty in Electron's environment
    // so dotenv loading cannot restore a developer secret. Optional native
    // settings represent that same state by absence: forwarding an empty value
    // would make the fail-closed Rust environment validator reject startup.
    if (value !== undefined && value.length > 0) target[name] = value;
  }
  return target;
}

function writePrivateBootstrap(stdin: Writable, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      stdin.removeListener("error", onError);
      if (error) {
        reject(
          new RuntimeProcessError("SPAWN_FAILED", "Runtime V2 closed bootstrap stdin early."),
        );
      } else {
        resolve();
      }
    };
    const onError = (): void => finish(new Error("stdin failed"));
    stdin.once("error", onError);
    try {
      stdin.write(line, "utf8", (error) => finish(error));
    } catch {
      finish(new Error("stdin write failed"));
    }
  });
}

function readOneBoundedLine(stream: Readable, maxBytes: number): BoundedLineReader {
  let chunks: Buffer[] = [];
  let bytes = 0;
  let active = true;
  let resolveLine = (_value: { readonly line: string; readonly remainder: Buffer }): void => {};
  let rejectLine = (_error: Error): void => {};

  const cleanup = (): void => {
    stream.removeListener("data", onData);
    stream.removeListener("error", onError);
    stream.removeListener("end", onEnd);
  };
  const fail = (message: string): void => {
    if (!active) return;
    active = false;
    cleanup();
    stream.pause();
    chunks = [];
    rejectLine(protocolViolation(message));
  };
  const onError = (): void => fail("Runtime V2 ready stream failed.");
  const onEnd = (): void => fail("Runtime V2 closed stdout before a ready handshake.");
  const onData = (raw: Buffer | string): void => {
    if (!active) return;
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const newline = chunk.indexOf(0x0a);
    const linePart = newline >= 0 ? chunk.subarray(0, newline) : chunk;
    bytes += linePart.length;
    if (bytes > maxBytes) {
      fail(`Runtime V2 ready handshake exceeds ${maxBytes} bytes.`);
      return;
    }
    chunks.push(linePart);
    if (newline < 0) return;

    active = false;
    cleanup();
    stream.pause();
    let line: string;
    try {
      line = decodeProtocolUtf8(Buffer.concat(chunks, bytes), "ready handshake");
    } catch (error) {
      chunks = [];
      rejectLine(error as Error);
      return;
    }
    if (line.endsWith("\r")) line = line.slice(0, -1);
    chunks = [];
    if (line.length === 0) {
      rejectLine(protocolViolation("Runtime V2 sent an empty ready handshake."));
      return;
    }
    resolveLine({ line, remainder: chunk.subarray(newline + 1) });
  };

  const promise = new Promise<{ readonly line: string; readonly remainder: Buffer }>(
    (resolve, reject) => {
      resolveLine = resolve;
      rejectLine = reject;
      stream.on("data", onData);
      stream.once("error", onError);
      stream.once("end", onEnd);
      stream.resume();
    },
  );

  return {
    promise,
    cancel: () => {
      if (!active) return;
      active = false;
      cleanup();
      stream.pause();
      chunks = [];
    },
  };
}

async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw protocolViolation(`Runtime V2 control response exceeds ${maxBytes} bytes.`);
    }
  }
  if (!response.body) {
    throw protocolViolation("Runtime V2 control response has no body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw protocolViolation(`Runtime V2 control response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = decodeProtocolUtf8(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes),
    "control response",
  );
  if (body.length === 0) throw protocolViolation("Runtime V2 control response is empty.");
  return parseProtocolJson(body, "control response");
}

function decodeProtocolUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw protocolViolation(`Runtime V2 ${label} is not valid UTF-8.`);
  }
}

async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  message: string,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RuntimeProcessError("STARTUP_TIMEOUT", message);
  return withTimeout(promise, remaining, message, "STARTUP_TIMEOUT");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  code: RuntimeProcessErrorCode = "CONTROL_UNAVAILABLE",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RuntimeProcessError(code, message)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function raceWithDelay<T, U>(promise: Promise<T>, delayMs: number, fallback: U): Promise<T | U> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), delayMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatExit(exit: RuntimeExitInfo): string {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}

function isCleanExit(exit: RuntimeExitInfo | null): boolean {
  return exit?.reason === "exit" && exit.code === 0 && exit.signal === null;
}
