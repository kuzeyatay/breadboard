import * as fs from "node:fs";
import * as path from "node:path";
import type { DesktopServiceDefinition } from "./service-manager";
import type { ResolvedPaths } from "./path-resolver";
import type { DesktopRuntimeConfig } from "./runtime-config";

/**
 * Central construction of every supervised service definition.
 *
 * Runtime strategy (see docs/DESKTOP_PACKAGING.md):
 *  - Node services (dashboard standalone, Quartz) run on a bundled official
 *    Node runtime (`resources/runtimes/node/node.exe`). This keeps npm-prebuilt
 *    native modules (better-sqlite3, bcrypt) on the exact ABI they were
 *    installed for — no Electron-ABI rebuild needed.
 *  - OpenHarness stays a Bun application (upstream-friendly) and runs on a
 *    bundled `runtimes/bun/bun.exe`.
 *  - ChatMock and the pinned Hermes wheel run on bundled CPython 3.13 under
 *    `runtimes/python`.
 *  - Scriberr remains optional and is only ever a Docker compatibility mode.
 *
 * In dev mode the system `node`, `bun`, and `python` are used, matching the
 * repository's existing scripts.
 */
export interface RuntimeBinaries {
  node: string;
  bun: string;
  python: string;
}

export function resolveRuntimeBinaries(paths: ResolvedPaths): RuntimeBinaries {
  if (paths.mode === "dev") {
    return {
      node: process.platform === "win32" ? "node.exe" : "node",
      bun: process.platform === "win32" ? "bun.exe" : "bun",
      python: process.platform === "win32" ? "python.exe" : "python3",
    };
  }
  const executable = (dir: string, name: string): string =>
    path.join(paths.runtimesDir, dir, process.platform === "win32" ? `${name}.exe` : name);
  return {
    node: executable("node", "node"),
    bun: executable("bun", "bun"),
    python: executable("python", "python"),
  };
}

export interface MissingRuntime {
  runtime: keyof RuntimeBinaries;
  path: string;
}

/** In packaged mode every bundled runtime must exist; fail loudly otherwise. */
export function missingRuntimes(paths: ResolvedPaths, binaries: RuntimeBinaries): MissingRuntime[] {
  if (paths.mode === "dev") return [];
  return (Object.entries(binaries) as [keyof RuntimeBinaries, string][])
    .filter(([, binaryPath]) => !fs.existsSync(binaryPath))
    .map(([runtime, binaryPath]) => ({ runtime, path: binaryPath }));
}

function optionalBinary(paths: ResolvedPaths, name: string): string | null {
  const candidate = path.join(paths.binDir, process.platform === "win32" ? `${name}.exe` : name);
  return fs.existsSync(candidate) ? candidate : null;
}

export interface ServiceUrls {
  dashboard: string;
  chatmock: string;
  chatmockV1: string;
  openharness: string;
  quartz: string;
  /** Only present when GBrain is enabled (a loopback port was allocated). */
  gbrain?: string;
  /** Only present when UI-TARS is enabled (a loopback port was allocated). */
  uiTars?: string;
}

/** Server-only Hermes endpoint. Never include this in serviceUrls/endpoints.json. */
export function hermesServiceUrl(config: DesktopRuntimeConfig): string {
  return `http://127.0.0.1:${config.ports.hermes}`;
}

export function serviceUrls(config: DesktopRuntimeConfig): ServiceUrls {
  const { ports } = config;
  return {
    dashboard: `http://127.0.0.1:${ports.dashboard}`,
    chatmock: `http://127.0.0.1:${ports.chatmock}`,
    chatmockV1: `http://127.0.0.1:${ports.chatmock}/v1`,
    openharness: `http://127.0.0.1:${ports.openharness}`,
    quartz: `http://127.0.0.1:${ports.quartz}`,
    // The adapter secret is NOT published — only the loopback URL, so the smoke
    // test can probe /health without exposing credentials.
    ...(ports.gbrain ? { gbrain: `http://127.0.0.1:${ports.gbrain}` } : {}),
    ...(ports.uiTars ? { uiTars: `http://127.0.0.1:${ports.uiTars}` } : {}),
  };
}

/**
 * Base environment shared by all services. Deliberately NOT process.env in
 * packaged mode: services get a controlled environment plus the entries the
 * OS needs (SystemRoot etc. on Windows).
 */
function baseEnv(paths: ResolvedPaths): Record<string, string> {
  const passthroughKeys =
    process.platform === "win32"
      ? [
          "SystemRoot",
          "SystemDrive",
          "windir",
          "ComSpec",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA",
          "PROGRAMDATA",
          "ProgramFiles",
          "ProgramFiles(x86)",
          "PATHEXT",
          "NUMBER_OF_PROCESSORS",
          "OS",
          "USERNAME",
          "HOMEDRIVE",
          "HOMEPATH",
        ]
      : ["HOME", "USER", "TMPDIR", "LANG", "SHELL"];
  const env: Record<string, string> = {};
  for (const key of passthroughKeys) {
    const value = process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  if (paths.mode === "dev") {
    // Dev parity: inherit the developer's full environment.
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && !(key in env)) env[key] = value;
    }
    const pathValue = process.env["PATH"] ?? process.env["Path"];
    if (typeof pathValue === "string") env["PATH"] = pathValue;
  } else {
    // Minimal PATH: system dirs (taskkill, cmd) only; runtimes are invoked by
    // absolute path.
    env["PATH"] =
      process.platform === "win32"
        ? [
            path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32"),
            process.env["SystemRoot"] ?? "C:\\Windows",
          ].join(path.delimiter)
        : "/usr/bin:/bin";
  }
  return env;
}

export interface BuildDefinitionsInput {
  paths: ResolvedPaths;
  config: DesktopRuntimeConfig;
  binaries: RuntimeBinaries;
}

export function buildServiceDefinitions(input: BuildDefinitionsInput): DesktopServiceDefinition[] {
  const { paths, config, binaries } = input;
  const urls = serviceUrls(config);
  const hermesUrl = hermesServiceUrl(config);
  const persistent = config.persistent;
  const shared = baseEnv(paths);
  const ffmpeg = optionalBinary(paths, "ffmpeg");
  const ffprobe = optionalBinary(paths, "ffprobe");
  const ytdlp = optionalBinary(paths, "yt-dlp");

  const openharnessAuthHeader = `Basic ${Buffer.from(
    `${persistent.openharnessUsername}:${persistent.openharnessPassword}`,
  ).toString("base64")}`;

  // GBrain (garden knowledge retrieval). Additive and off by default. When
  // enabled it runs as a supervised loopback Bun sidecar with a per-install
  // secret, storing its mutable PGLite/index data under the desktop data dir.
  const gbrainEnabled = persistent.gbrainMode !== "disabled";
  const gbrainPort = config.ports.gbrain ?? 7717;
  const gbrainUrl = `http://127.0.0.1:${gbrainPort}`;
  const gbrainDataDir = path.join(paths.dataRoot, "gbrain");

  // UI-TARS browser-operator adapter. Additive, optional by default. A supervised
  // loopback Node sidecar with a per-install secret; mutable data (screenshots,
  // isolated browser profiles, session registry) lives under the desktop data dir.
  // Optional mode NEVER blocks startup — if the runtime/deps are absent the
  // dashboard reports an unavailable state and the rest of Breadboard is unaffected.
  const uiTarsEnabled = persistent.uiTarsMode !== "disabled";
  const uiTarsPort = config.ports.uiTars ?? 7719;
  const uiTarsUrl = `http://127.0.0.1:${uiTarsPort}`;
  const uiTarsDataDir = path.join(paths.dataRoot, "ui-tars");

  const chatmock: DesktopServiceDefinition = {
    id: "chatmock",
    displayName: "Local AI (ChatMock)",
    required: true,
    command: binaries.python,
    args: [
      "chatmock.py",
      "serve",
      "--port",
      String(config.ports.chatmock),
      "--reasoning-effort",
      "low",
      "--reasoning-summary",
      "detailed",
      "--reasoning-compat",
      "legacy",
    ],
    cwd: path.join(paths.appRoot, "chatmock"),
    env: {
      ...shared,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
    healthCheck: {
      type: "http",
      url: `${urls.chatmock}/health`,
      timeoutMs: 2_000,
      intervalMs: 500,
    },
    startupTimeoutMs: 90_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const openharness: DesktopServiceDefinition = {
    id: "openharness",
    displayName: "Agent runtime (OpenHarness)",
    required: persistent.openharnessMode === "required",
    command: binaries.bun,
    args: [
      "run",
      "packages/opencode/src/index.ts",
      "serve",
      "--port",
      String(config.ports.openharness),
      "--hostname",
      "127.0.0.1",
    ],
    cwd: paths.openharnessAppDir,
    dependsOn: ["chatmock"],
    env: {
      ...shared,
      OPENCODE_SERVER_PASSWORD: persistent.openharnessPassword,
      OPENCODE_SERVER_USERNAME: persistent.openharnessUsername,
      OPENCODE_CONFIG_DIR: path.join(paths.appRoot, "openharness-config"),
      BREADBOARD_INTERNAL_URL: urls.dashboard,
      OPENHARNESS_TOOL_SECRET: persistent.openharnessToolSecret,
      CHATMOCK_BASE_URL: urls.chatmockV1,
      CHATMOCK_API_KEY: "local",
      CHATMOCK_MODEL: process.env["CHATMOCK_MODEL"] ?? "gpt-5.6-sol",
      OPENCODE_ENABLE_EXA: "1",
      OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    },
    healthCheck: {
      // Meaningful readiness: the server is up AND the ChatMock provider
      // loaded (mirrors scripts/dev-all.mjs which checks /global/health then
      // /config/providers for "chatmock").
      type: "http",
      url: `${urls.openharness}/config/providers`,
      headers: { Authorization: openharnessAuthHeader },
      expectBodyIncludes: "chatmock",
      timeoutMs: 2_500,
      intervalMs: 750,
    },
    startupTimeoutMs: 120_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const hermes: DesktopServiceDefinition = {
    id: "hermes",
    displayName: "Agent runtime (Hermes)",
    // Runtime unavailability must not make gardens and other unrelated
    // Breadboard features unusable. Agent API routes report the existing
    // sanitized runtime-unavailable error while the bounded supervisor retries.
    required: false,
    command: binaries.python,
    args: [
      "-m",
      "hermes_cli.main",
      "serve",
      "--isolated",
      "--host",
      "127.0.0.1",
      "--port",
      String(config.ports.hermes),
      "--no-open",
    ],
    cwd: paths.hermesAppDir,
    dependsOn: ["chatmock"],
    env: {
      ...shared,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      HERMES_HOME: paths.hermesHome,
      HERMES_DESKTOP: "1",
      HERMES_SERVE_HEADLESS: "1",
      HERMES_DASHBOARD_SESSION_TOKEN: persistent.hermesSessionToken,
      BREADBOARD_INTERNAL_URL: urls.dashboard,
      BREADBOARD_HERMES_TOOL_SECRET: persistent.hermesToolSecret,
      OPENAI_BASE_URL: urls.chatmockV1,
      OPENAI_API_KEY: "local",
      CHATMOCK_BASE_URL: urls.chatmockV1,
      CHATMOCK_MODEL: process.env["CHATMOCK_MODEL"] ?? "gpt-5.6-sol",
    },
    healthCheck: {
      type: "http",
      url: `${hermesUrl}/api/status`,
      expectBodyIncludes: '"version"',
      timeoutMs: 3_000,
      intervalMs: 750,
    },
    startupTimeoutMs: 120_000,
    gracefulShutdownMs: 8_000,
    restartPolicy: "on-failure",
  };

  const quartzArgs = [
    path.join(paths.quartzWorkspace, "quartz", "bootstrap-cli.mjs"),
    "build",
    "--serve",
    "--port",
    String(config.ports.quartz),
    // The Quartz CLI always opens a hot-reload websocket; pin it to an
    // allocated port so it cannot collide with anything else on 3001.
    "--wsPort",
    String(config.ports.quartzWs),
  ];
  const quartz: DesktopServiceDefinition = {
    id: "quartz",
    displayName: "Garden site (Quartz)",
    required: true,
    command: binaries.node,
    args: quartzArgs,
    cwd: paths.quartzWorkspace,
    env: {
      ...shared,
      BREADBOARD_DASHBOARD_URL: urls.dashboard,
    },
    healthCheck: {
      // Quartz is ready once its server answers. A brand-new install has an
      // empty garden, so `/` legitimately 404s until the first page exists.
      type: "http",
      url: `${urls.quartz}/`,
      acceptAnyStatus: true,
      timeoutMs: 3_000,
      intervalMs: 1_000,
    },
    startupTimeoutMs: 300_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const dashboardEntry =
    paths.mode === "packaged"
      ? [path.join(paths.dashboardServerDir, "server.js")]
      : [
          path.join(paths.dashboardServerDir, "node_modules", "next", "dist", "bin", "next"),
          "dev",
          "--webpack",
          "--port",
          String(config.ports.dashboard),
          "--hostname",
          "127.0.0.1",
        ];

  const dashboard: DesktopServiceDefinition = {
    id: "dashboard",
    displayName: "Breadboard workspace",
    required: true,
    command: binaries.node,
    args: dashboardEntry,
    cwd: paths.dashboardServerDir,
    // The selected runtime starts in the preceding supervisor wave because it
    // depends on ChatMock. It is intentionally not a hard dashboard dependency:
    // unrelated Breadboard features remain usable if the runtime is degraded.
    dependsOn: ["chatmock", "quartz"],
    env: {
      ...shared,
      NODE_ENV: paths.mode === "packaged" ? "production" : "development",
      PORT: String(config.ports.dashboard),
      HOSTNAME: "127.0.0.1",
      // --- Data + content locations (single source of truth: path-resolver) ---
      BREADBOARD_DATA_DIR: paths.dataRoot === paths.appRoot ? path.join(paths.appRoot, "dashboard") : paths.dataRoot,
      BREADBOARD_REPO_ROOT: paths.appRoot,
      QUARTZ_CONTENT_PATH: paths.quartzContent,
      NEXT_PUBLIC_QUARTZ_URL: urls.quartz,
      // --- Auth ---
      NEXTAUTH_SECRET: persistent.nextAuthSecret,
      NEXTAUTH_URL: urls.dashboard,
      // Seeds the invite-only registration flow so the first local account
      // can be created (code shown in the Help menu).
      SECOND_BRAIN_INITIAL_INVITE_CODE: persistent.initialInviteCode,
      // --- Generation pipeline (ChatMock, unchanged contract) ---
      OPENAI_BASE_URL: urls.chatmockV1,
      OPENAI_API_KEY: "local",
      CHATMOCK_BASE_URL: urls.chatmockV1,
      CHATMOCK_MODEL: process.env["CHATMOCK_MODEL"] ?? "gpt-5.6-sol",
      // --- Runtime-neutral selection (server only) ---
      AGENT_RUNTIME: persistent.agentRuntime,
      AGENT_RUNTIME_FALLBACK: persistent.agentRuntimeFallback ?? "none",
      HERMES_BASE_URL: hermesUrl,
      HERMES_DASHBOARD_SESSION_TOKEN: persistent.hermesSessionToken,
      BREADBOARD_HERMES_TOOL_SECRET: persistent.hermesToolSecret,
      // --- OpenHarness ---
      OPENHARNESS_ENABLED: persistent.openharnessMode === "legacy" ? "false" : "true",
      OPENHARNESS_MODE: persistent.openharnessMode,
      OPENHARNESS_BASE_URL: urls.openharness,
      OPENHARNESS_USERNAME: persistent.openharnessUsername,
      OPENHARNESS_PASSWORD: persistent.openharnessPassword,
      OPENHARNESS_TOOL_SECRET: persistent.openharnessToolSecret,
      OPENHARNESS_CAPABILITY_SECRET: persistent.openharnessCapabilitySecret,
      OPENHARNESS_ROOT: paths.openharnessRoot,
      OPENHARNESS_SKILLS_QUARANTINE: paths.skillsQuarantine,
      OPENHARNESS_SKILLS_APPROVED: paths.skillsApproved,
      OPENHARNESS_SKILLS_CONDITIONAL: paths.skillsConditional,
      // Optional local persona catalog. Packaged services use a controlled
      // environment, so this explicit pass-through is required when the
      // desktop process was launched with AGENCY_AGENTS_PATH configured.
      ...(process.env["AGENCY_AGENTS_PATH"]?.trim()
        ? { AGENCY_AGENTS_PATH: path.resolve(process.env["AGENCY_AGENTS_PATH"].trim()) }
        : {}),
      BREADBOARD_INTERNAL_URL: urls.dashboard,
      // --- Quartz publish pipeline runs `node bootstrap-cli.mjs` itself ---
      BREADBOARD_NODE_BINARY: binaries.node,
      // --- Video transcription (optional capability) ---
      VIDEO_TRANSCRIPTION_ENABLED: persistent.scriberrEnabled ? "true" : "false",
      ...(persistent.scriberrEnabled
        ? { SCRIBERR_BASE_URL: persistent.scriberrBaseUrl ?? "http://127.0.0.1:8091" }
        : {}),
      ...(ffmpeg ? { FFMPEG_PATH: ffmpeg } : {}),
      ...(ffprobe ? { FFPROBE_PATH: ffprobe } : {}),
      ...(ytdlp ? { YTDLP_PATH: ytdlp } : {}),
      // --- GBrain (garden knowledge retrieval; only when enabled) ---
      ...(gbrainEnabled
        ? {
            GBRAIN_MODE: persistent.gbrainMode,
            GBRAIN_ADAPTER_URL: gbrainUrl,
            GBRAIN_ADAPTER_SECRET: persistent.gbrainAdapterSecret,
          }
        : {}),
      // --- UI-TARS browser operator (loopback adapter; only when enabled) ---
      UI_TARS_MODE: persistent.uiTarsMode,
      ...(uiTarsEnabled
        ? {
            UI_TARS_ADAPTER_URL: uiTarsUrl,
            UI_TARS_ADAPTER_SECRET: persistent.uiTarsAdapterSecret,
          }
        : {}),
    },
    healthCheck: {
      type: "http",
      url: `${urls.dashboard}/api/health`,
      timeoutMs: 3_000,
      intervalMs: 750,
    },
    startupTimeoutMs: 180_000,
    gracefulShutdownMs: 8_000,
    restartPolicy: "on-failure",
  };

  const gbrain: DesktopServiceDefinition = {
    id: "gbrain",
    displayName: "Knowledge retrieval (GBrain)",
    // Never blocks startup even in `required` GBRAIN mode: the dashboard reports
    // a truthful unavailable/degraded state rather than failing the whole app.
    required: false,
    command: binaries.bun,
    args: ["run", path.join(paths.appRoot, "gbrain-adapter", "src", "server.ts")],
    cwd: path.join(paths.appRoot, "gbrain-adapter"),
    env: {
      ...shared,
      GBRAIN_ADAPTER_HOST: "127.0.0.1",
      GBRAIN_ADAPTER_PORT: String(gbrainPort),
      GBRAIN_ADAPTER_SECRET: persistent.gbrainAdapterSecret,
      // Mutable index data lives under the desktop data dir, never in resources.
      GBRAIN_DATA_DIR: gbrainDataDir,
      GBRAIN_EMBEDDING_PROVIDER: process.env["GBRAIN_EMBEDDING_PROVIDER"] ?? "none",
      GBRAIN_QUERY_TIMEOUT_MS: "15000",
    },
    healthCheck: {
      type: "http",
      url: `${gbrainUrl}/health`,
      timeoutMs: 2_500,
      intervalMs: 750,
    },
    startupTimeoutMs: 60_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const uiTars: DesktopServiceDefinition = {
    id: "ui-tars",
    displayName: "Browser operator (UI-TARS)",
    // Never blocks startup: optional/required modes both degrade to a truthful
    // unavailable state in the dashboard rather than failing the whole app.
    required: false,
    command: binaries.node,
    args: [
      "--experimental-strip-types",
      path.join(paths.appRoot, "ui-tars-adapter", "src", "server.ts"),
    ],
    cwd: path.join(paths.appRoot, "ui-tars-adapter"),
    env: {
      ...shared,
      UI_TARS_ADAPTER_HOST: "127.0.0.1",
      UI_TARS_ADAPTER_PORT: String(uiTarsPort),
      // Secret injected via env (never argv) so it cannot leak in process listings.
      UI_TARS_ADAPTER_SECRET: persistent.uiTarsAdapterSecret,
      // Mutable runtime data (screenshots, isolated browser profiles, session
      // registry) lives under the desktop data dir — never in resources.
      UI_TARS_DATA_DIR: uiTarsDataDir,
      // Real Agent TARS runtime by default; the fake runtime is test-only. If the
      // upstream deps/Chromium are absent this fails to start and the app stays
      // usable (optional mode).
      UI_TARS_RUNTIME: process.env["UI_TARS_RUNTIME"] ?? "agent-tars",
      UI_TARS_MAX_CONCURRENT_RUNS: process.env["UI_TARS_MAX_CONCURRENT_RUNS"] ?? "3",
      UI_TARS_SCREENSHOT_RETENTION_MS: process.env["UI_TARS_SCREENSHOT_RETENTION_MS"] ?? "86400000",
    },
    healthCheck: {
      type: "http",
      url: `${uiTarsUrl}/health`,
      timeoutMs: 2_500,
      intervalMs: 750,
    },
    startupTimeoutMs: 60_000,
    gracefulShutdownMs: 8_000,
    restartPolicy: "on-failure",
  };

  const definitions: DesktopServiceDefinition[] = [chatmock];
  // Legacy mode intentionally runs without OpenHarness (existing Breadboard
  // migration contract) — do not register the service at all.
  const selectedRuntimes = new Set(
    [persistent.agentRuntime, persistent.agentRuntimeFallback].filter(Boolean),
  );
  if (selectedRuntimes.has("hermes")) definitions.push(hermes);
  if (
    selectedRuntimes.has("openharness") &&
    persistent.openharnessMode !== "legacy"
  ) {
    definitions.push(openharness);
  }
  if (gbrainEnabled) definitions.push(gbrain);
  if (uiTarsEnabled) definitions.push(uiTars);
  definitions.push(quartz, dashboard);

  // Scriberr: optional Docker compatibility mode only. Never required, never
  // blocks startup; when disabled the dashboard reports the capability as
  // unavailable (existing behavior).
  if (persistent.scriberrEnabled && persistent.scriberrBaseUrl === null) {
    definitions.push({
      id: "scriberr",
      displayName: "Video transcription (Scriberr, Docker)",
      required: false,
      command: "docker",
      args: [
        "compose",
        "-f",
        path.join(paths.appRoot, "scriberr", "docker-compose.yml"),
        "-f",
        path.join(paths.runtimeDir, "scriberr-compose.override.yml"),
        "up",
      ],
      cwd: path.join(paths.appRoot, "scriberr"),
      env: shared,
      healthCheck: {
        type: "http",
        url: "http://127.0.0.1:8091/health",
        timeoutMs: 2_500,
        intervalMs: 1_000,
      },
      startupTimeoutMs: 60_000,
      gracefulShutdownMs: 10_000,
      restartPolicy: "never",
    });
  }
  return definitions;
}
