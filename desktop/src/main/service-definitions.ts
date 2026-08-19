import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DesktopServiceDefinition } from "./service-manager";
import type { ResolvedPaths } from "./path-resolver";
import type { DesktopRuntimeConfig } from "./runtime-config";
import { DEFAULT_BREADBOARD_SKILLS_CATALOG_URL } from "./skills-catalog-config";
import { recallDataDir, recallHome } from "./recall";
import {
  CLIPROXY_DEFAULT_PORT,
  cliproxyApiKey,
  cliproxyBinaryPath,
  cliproxyConfigPath,
  cliproxyHome,
  cliproxyManagementKey,
  isCliproxyInstalled,
} from "./cliproxy";

/**
 * Central construction of every supervised service definition.
 *
 * Runtime strategy (see docs/DESKTOP_PACKAGING.md):
 *  - Node services (dashboard standalone, Quartz) run on a bundled official
 *    Node runtime (`resources/runtimes/node/node.exe`). This keeps npm-prebuilt
 *    native modules (better-sqlite3, bcrypt) on the exact ABI they were
 *    installed for — no Electron-ABI rebuild needed.
 *  - Optional GBrain tooling runs on the bundled Bun runtime.
 *  - ChatMock and the pinned Hermes wheel run on bundled CPython 3.13 under
 *    `runtimes/python`.
 *  - Scriberr runs as a bundled native Windows sidecar. Its speech-model
 *    environment is prepared lazily under the user's data directory.
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

/**
 * Hermes needs its own interpreter in dev.
 *
 * Packaged builds ship a CPython that already has the pinned Hermes wheel
 * installed. In dev the system `python.exe` has ChatMock's dependencies but not
 * Hermes's, so `-m hermes_cli.main` died on import (`No module named 'yaml'`)
 * and the supervisor reported the runtime as unavailable while everything else
 * looked healthy. Prefer the checkout's virtualenv, which is what
 * scripts/start-hermes.mjs uses; HERMES_PYTHON overrides both.
 */
export function resolveHermesPython(
  paths: ResolvedPaths,
  binaries: RuntimeBinaries,
): string {
  if (paths.mode !== "dev") return binaries.python;
  const override = process.env["HERMES_PYTHON"]?.trim();
  if (override) return override;
  const venv = path.join(
    paths.hermesAppDir,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  return fs.existsSync(venv) ? venv : binaries.python;
}

/**
 * Resolve the persona catalog shipped with Breadboard.
 *
 * A valid developer override still wins, but a stale absolute path must not
 * hide the managed catalog. This commonly happens after moving a checkout or
 * leaving a OneDrive-synchronized directory.
 */
export function resolveAgencyAgentsPath(paths: ResolvedPaths): string {
  const override = process.env["AGENCY_AGENTS_PATH"]?.trim();
  if (override) {
    const resolved = path.resolve(override);
    if (fs.existsSync(path.join(resolved, "divisions.json"))) return resolved;
  }
  return path.join(paths.appRoot, "agency-agents");
}

export interface VoiceboxRuntime {
  command: string;
  argsPrefix: string[];
  cwd: string;
  selfManaged?: boolean;
}

/**
 * Resolve the cloned Voicebox environment in development or its native server
 * sidecar in an installed app. Returning null is intentional: Voicebox is an
 * optional leaf capability, and Settings gives the user a specific setup state
 * while the rest of Breadboard remains usable.
 */
export function resolveVoiceboxRuntime(
  paths: ResolvedPaths,
  binaries?: RuntimeBinaries,
): VoiceboxRuntime | null {
  const executable = process.platform === "win32" ? "voicebox-server.exe" : "voicebox-server";
  const binaryOverride = process.env["VOICEBOX_SERVER_BIN"]?.trim();
  if (binaryOverride && fs.existsSync(binaryOverride)) {
    return { command: binaryOverride, argsPrefix: [], cwd: path.dirname(binaryOverride) };
  }
  if (paths.mode === "packaged") {
    const binary = path.join(paths.binDir, executable);
    return fs.existsSync(binary)
      ? { command: binary, argsPrefix: [], cwd: paths.runtimeDir }
      : null;
  }

  const root = path.join(paths.appRoot, "voicebox");
  const launcher = path.join(paths.appRoot, "scripts", "start-voicebox.mjs");
  if (binaries && fs.existsSync(launcher) && fs.existsSync(path.join(root, "backend", "main.py"))) {
    return {
      command: binaries.node,
      argsPrefix: [launcher],
      cwd: paths.appRoot,
      selfManaged: true,
    };
  }
  const pythonOverride = process.env["VOICEBOX_PYTHON"]?.trim();
  const candidates = [
    pythonOverride,
    path.join(paths.appRoot, ".runtime", "voicebox-venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
    path.join(root, "backend", "venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
    path.join(root, "backend", ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
    path.join(root, ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const python = candidates.find((candidate) => fs.existsSync(candidate));
  if (!python || !fs.existsSync(path.join(root, "backend", "main.py"))) return null;
  return { command: python, argsPrefix: ["-m", "backend.main"], cwd: root };
}

/** Server-only Voicebox endpoint. Never publish it to the renderer. */
export function voiceboxServiceUrl(config: DesktopRuntimeConfig): string {
  return `http://127.0.0.1:${config.ports.voicebox ?? 17493}`;
}


/** Server-only CAD service endpoint. Never published to the renderer. */
export function cadServiceUrl(config: DesktopRuntimeConfig): string {
  return `http://127.0.0.1:${config.ports.cad ?? 7731}`;
}

/**
 * Resolve the CAD service's interpreter.
 *
 * CadQuery's kernel binding publishes wheels for CPython 3.10–3.12 only, so the
 * service never runs on the bundled runtime that serves ChatMock and Hermes: it
 * gets its own environment, provisioned by `npm run setup:cad` in development
 * and staged under the install resources in a packaged build. Returning null is
 * intentional — parametric CAD is an optional leaf capability, and its absence
 * must leave the rest of Breadboard untouched.
 */
/** Server-only ColPali service endpoint. Never published to the renderer. */
export function colpaliServiceUrl(config: DesktopRuntimeConfig): string {
  return `http://127.0.0.1:${config.ports.colpali ?? 7733}`;
}

/**
 * Resolve the ColPali service's interpreter.
 *
 * Its own environment for the same reason CAD has one, but a different
 * constraint: PyTorch publishes no wheels for this repository's default Python,
 * so `npm run setup:colpali` pins 3.13. Returning null is the ordinary case —
 * the environment is a 3.5 GB opt-in, and without it document attachments are
 * inlined whole exactly as they were before ColPali existed.
 */
export function resolveColpaliPython(paths: ResolvedPaths): string | null {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const scripts = process.platform === "win32" ? "Scripts" : "bin";
  const override = process.env["COLPALI_PYTHON"]?.trim();
  const candidates = [
    override,
    path.join(paths.runtimesDir, "colpali-python", scripts, executable),
    path.join(paths.runtimesDir, "colpali-python", executable),
    path.join(paths.appRoot, ".runtime", "colpali-venv", scripts, executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const python = candidates.find((candidate) => fs.existsSync(candidate));
  if (!python) return null;
  return fs.existsSync(
    path.join(paths.appRoot, "colpali-service", "breadboard_colpali", "__main__.py"),
  )
    ? python
    : null;
}

export function resolveCadPython(paths: ResolvedPaths): string | null {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  const scripts = process.platform === "win32" ? "Scripts" : "bin";
  const override = process.env["CAD_PYTHON"]?.trim();
  const candidates = [
    override,
    path.join(paths.runtimesDir, "cad-python", scripts, executable),
    path.join(paths.runtimesDir, "cad-python", executable),
    path.join(paths.appRoot, ".runtime", "cad-venv", scripts, executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const python = candidates.find((candidate) => fs.existsSync(candidate));
  if (!python) return null;
  return fs.existsSync(path.join(paths.appRoot, "cad-service", "breadboard_cad", "__main__.py"))
    ? python
    : null;
}

/** Prefer a Codex binary built from the cloned source in dev; packaged builds
 * use the binary staged under resources/bin by prepare-app-resources.mjs. */
export function resolveCodexBinary(paths: ResolvedPaths): string {
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  if (paths.mode === "packaged") return path.join(paths.binDir, executable);
  const override = process.env["CODEX_BIN"]?.trim();
  if (override && fs.existsSync(override)) return override;
  for (const profile of ["release", "debug"]) {
    const candidate = path.join(
      paths.appRoot,
      "codex",
      "codex-rs",
      "target",
      profile,
      executable,
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return executable;
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

export interface ServiceUrls {
  dashboard: string;
  chatmock: string;
  chatmockV1: string;
  postiz: string;
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
    postiz: `http://127.0.0.1:${ports.postiz}`,
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
          "DOCKER_CLI_PATH",
          "PODMAN_CLI_PATH",
          "DOCKER_DESKTOP_PATH",
        ]
      : [
          "HOME",
          "USER",
          "TMPDIR",
          "LANG",
          "SHELL",
          "DOCKER_CLI_PATH",
          "PODMAN_CLI_PATH",
          "DOCKER_DESKTOP_PATH",
        ];
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

/**
 * Give the supervised development dashboard enough heap for long, in-process
 * Learn runs. Next dev otherwise caps its server child at half of physical RAM
 * and deliberately restarts it at 80% of that cap. A valid large curriculum
 * run can cross that threshold and be mistaken for an abandoned worker.
 *
 * Seventy-five percent raises the watchdog boundary from roughly 40% to 60%
 * of physical RAM, while still leaving headroom for Electron and sidecars. The
 * cap prevents unusually large developer machines from granting an unbounded
 * heap. This is dev-only: packaged/standalone servers do not use Next's dev
 * restart watchdog.
 */
function dashboardDevNodeOptions(inherited: string | undefined): string {
  const totalMemoryMb = Math.floor(os.totalmem() / (1024 * 1024));
  const maxOldSpaceMb = Math.min(24 * 1024, Math.max(1024, Math.floor(totalMemoryMb * 0.75)));
  return [inherited?.trim(), `--max-old-space-size=${maxOldSpaceMb}`]
    .filter((value): value is string => Boolean(value))
    .join(" ");
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
  const voiceboxUrl = voiceboxServiceUrl(config);
  const voiceboxRuntime = resolveVoiceboxRuntime(paths, binaries);
  const persistent = config.persistent;
  const shared = baseEnv(paths);
  const bundledBinary = (name: string): string =>
    path.join(paths.binDir, process.platform === "win32" ? `${name}.exe` : name);
  const ffmpeg = bundledBinary("ffmpeg");
  const ffprobe = bundledBinary("ffprobe");
  const ytdlp = bundledBinary("yt-dlp");
  const scriberrBinary = bundledBinary("scriberr");
  const scriberrDataDir = path.join(paths.runtimeDir, "scriberr");
  const voiceboxDataDir = path.join(paths.runtimeDir, "voicebox");

  // GBrain (garden knowledge retrieval). On by default (`preferred`), and still
  // additive: it runs as a supervised loopback Bun sidecar with a per-install
  // secret, storing its mutable PGLite/index data under the desktop data dir,
  // and never blocks startup. `disabled` in desktop-config.json turns it off.
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

  // Subscription proxy (CLIProxyAPI). Serves the models behind Claude/Gemini/
  // Kimi/Grok subscriptions over OAuth, so they cost nothing per token and need
  // no API key. Registered only when the binary is actually present: it is
  // downloaded on demand rather than bundled, and a service whose command does
  // not exist would fail on every launch for the majority who never connect one.
  const cliproxyHomeDir = cliproxyHome(paths);
  const cliproxyEnabled =
    persistent.cliproxyMode !== "disabled" && isCliproxyInstalled(cliproxyHomeDir);
  const cliproxyPort = config.ports.cliproxy ?? CLIPROXY_DEFAULT_PORT;
  const cliproxyUrl = `http://127.0.0.1:${cliproxyPort}`;
  // Reading these mints the secret files on first use. Both the proxy's own
  // config and the dashboard need the same values.
  const cliproxyKey = cliproxyEnabled ? cliproxyApiKey(cliproxyHomeDir) : "";
  const cliproxyMgmtKey = cliproxyEnabled ? cliproxyManagementKey(cliproxyHomeDir) : "";

  /**
   * What the dashboard and ChatMock need to reach the proxy.
   *
   * Passed explicitly rather than left to each side's own defaults so a
   * non-preferred port (8317 taken) or a packaged data root cannot make them
   * disagree about which proxy is running.
   */
  const cliproxyClientEnv: Record<string, string> = cliproxyEnabled
    ? {
        CLIPROXY_HOME: cliproxyHomeDir,
        CLIPROXY_PORT: String(cliproxyPort),
        CLIPROXY_BASE_URL: `${cliproxyUrl}/v1`,
        CLIPROXY_API_KEY: cliproxyKey,
        CLIPROXY_MANAGEMENT_KEY: cliproxyMgmtKey,
      }
    : {};

  // Recall (local screen + audio capture). Not a supervised service on purpose
  // — see main/recall.ts for why the dashboard owns the recorder process. These
  // are the locations both sides must agree on.
  const recallHomeDir = recallHome(paths);
  const recallDataDirectory = recallDataDir(paths);
  const recallUrl = `http://127.0.0.1:${config.ports.recall ?? 3030}`;

  const cadPython = resolveCadPython(paths);
  const cadEnabled = persistent.cadMode !== "disabled" && cadPython !== null;
  const cadUrl = cadServiceUrl(config);
  const cadWorkspace = path.join(paths.runtimeDir, "cad-workspaces");
  const colpaliPython = resolveColpaliPython(paths);
  const colpaliEnabled = persistent.colpaliMode !== "disabled" && colpaliPython !== null;
  const colpaliUrl = colpaliServiceUrl(config);
  // The vectors are Breadboard's state, not the user's documents, so they live
  // under the desktop data dir rather than beside the checkout.
  const colpaliHome = path.join(paths.runtimeDir, "colpali");

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
      // Use ChatMock's native Responses web search. This rides the existing
      // ChatGPT login and introduces no separate search-provider API key.
      "--enable-web-search",
    ],
    cwd: path.join(paths.appRoot, "chatmock"),
    env: {
      ...shared,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      // The dashboard starts ChatMock's OAuth flow and inherits this same home.
      // Keep the serving process on it too, or Settings can show the newly
      // selected account while GPT requests continue using ~/.codex instead.
      CODEX_HOME: paths.codexHome,
      // ChatMock's `cliproxy` provider falls back to these when no base URL or
      // key is stored in providers.json, so a first-run install reaches the
      // proxy before any catalog sync has happened.
      ...cliproxyClientEnv,
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
    // The dashboard hot-reloads in development, but the Python model gateway
    // does not. Provider catalog edits otherwise leave Settings talking to the
    // pre-edit process until the entire desktop app is restarted.
    restartOnChange:
      paths.mode === "dev"
        ? [
            path.join(paths.appRoot, "chatmock", "chatmock", "providers", "catalog.py"),
            path.join(paths.appRoot, "chatmock", "chatmock", "providers", "dispatch.py"),
            path.join(paths.appRoot, "chatmock", "chatmock", "providers", "registry.py"),
            path.join(paths.appRoot, "chatmock", "chatmock", "providers", "store.py"),
          ]
        : undefined,
  };

  const postiz: DesktopServiceDefinition = {
    id: "postiz",
    displayName: "Social publishing (Postiz)",
    // Social publishing degrades to local drafts. Docker is external software,
    // so its absence or a slow first container pull must never block Breadboard.
    required: false,
    startInBackground: true,
    command: binaries.node,
    args: [
      "--experimental-strip-types",
      path.join(paths.appRoot, "scripts", "start-postiz-supervisor.mjs"),
    ],
    cwd: paths.appRoot,
    env: {
      ...shared,
      BREADBOARD_DATA_DIR: paths.mode === "packaged" ? paths.dataRoot : "",
      BREADBOARD_REPO_ROOT: paths.appRoot,
      SOCIALS_MANAGER_MODE: "stack",
      SOCIALS_MANAGER_URL: urls.postiz,
      SOCIALS_MANAGER_ROOT: path.join(paths.appRoot, "postiz-app"),
      SOCIALS_MANAGER_SUPPRESS_DOCKER_UI: "true",
      POSTIZ_SUPERVISOR_HOST: "127.0.0.1",
      POSTIZ_SUPERVISOR_PORT: String(config.ports.postizSupervisor),
      POSTIZ_SUPERVISOR_STARTUP_TIMEOUT_MS: String(18 * 60_000),
    },
    healthCheck: {
      // The coordinator opens this endpoint only after Docker Compose, the web
      // app, account bootstrap, and an authenticated integrations request pass.
      type: "http",
      url: `http://127.0.0.1:${config.ports.postizSupervisor}/health`,
      expectBodyIncludes: '"ready":true',
      timeoutMs: 3_000,
      intervalMs: 1_500,
    },
    startupTimeoutMs: 20 * 60_000,
    gracefulShutdownMs: 8_000,
    restartPolicy: "on-failure",
  };

  const hermes: DesktopServiceDefinition = {
    id: "hermes",
    displayName: "Agent runtime (Hermes)",
    // Runtime unavailability must not make gardens and other unrelated
    // Breadboard features unusable. Agent API routes report the existing
    // sanitized runtime-unavailable error while the bounded supervisor retries.
    required: false,
    // Dev uses the hermes-agent virtualenv; packaged uses the bundled CPython.
    command: resolveHermesPython(paths, binaries),
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
      CHATMOCK_MODEL: process.env["CHATMOCK_MODEL"] ?? "default",
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
    restartOnChange:
      paths.mode === "dev"
        ? [path.join(paths.hermesAppDir, "plugins", "breadboard", "__init__.py")]
        : undefined,
  };

  const voicebox: DesktopServiceDefinition | null = voiceboxRuntime
    ? {
        id: "voicebox",
        displayName: "Local speech (Voicebox)",
        required: false,
        startInBackground: true,
        command: voiceboxRuntime.command,
        args: voiceboxRuntime.selfManaged
          ? voiceboxRuntime.argsPrefix
          : [
              ...voiceboxRuntime.argsPrefix,
              "--host",
              "127.0.0.1",
              "--port",
              String(config.ports.voicebox ?? 17493),
              "--data-dir",
              voiceboxDataDir,
            ],
        cwd: voiceboxRuntime.cwd,
        env: {
          ...shared,
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          VOICEBOX_AUTOINSTALL: "true",
          VOICEBOX_PORT: String(config.ports.voicebox ?? 17493),
          VOICEBOX_DATA_DIR: voiceboxDataDir,
          VOICEBOX_MODELS_DIR: path.join(voiceboxDataDir, "models"),
          VOICEBOX_STATUS_PATH: path.join(voiceboxDataDir, "startup-status.json"),
        },
        // Deliberately no readiness wait, for the same reason as Scriberr
        // below: Voicebox's first launch downloads multi-gigabyte CUDA wheels
        // and speech models, and a readiness deadline here would terminate
        // that install mid-download and leave it to start over on every
        // launch. Settings polls /health itself and reports the install from
        // the status file, so supervising liveness alone stays truthful.
        startupTimeoutMs: 5_000,
        gracefulShutdownMs: 10_000,
        restartPolicy: "on-failure",
      }
    : null;

  const quartzDirectory = path.relative(paths.quartzWorkspace, paths.quartzContent)
    .split(path.sep)
    .join("/") || ".";
  const quartzOutput = path.relative(
    paths.quartzWorkspace,
    path.join(paths.quartzWorkspace, "public"),
  ).split(path.sep).join("/") || ".";
  const quartzArgs = [
    path.join(paths.quartzWorkspace, "quartz", "bootstrap-cli.mjs"),
    "build",
    "--directory",
    quartzDirectory,
    "--output",
    quartzOutput,
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
      // Quartz binds this supervisor-only endpoint before its initial build.
      // Large gardens can take several minutes to rebuild; app startup should
      // wait for the server process, not for every note to finish rendering.
      type: "http",
      url: `${urls.quartz}/__health`,
      expectBodyIncludes: '"ready":true',
      timeoutMs: 3_000,
      intervalMs: 1_000,
    },
    startupTimeoutMs: 300_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const requestedDashboardMode =
    process.env["BREADBOARD_DESKTOP_DASHBOARD_MODE"]?.trim().toLowerCase();
  const devStandaloneServer = path.join(
    paths.dashboardServerDir,
    ".next-desktop",
    "standalone",
    "dashboard",
    "server.js",
  );
  const useDevStandalone = paths.mode === "dev" && requestedDashboardMode === "standalone";
  if (useDevStandalone && !fs.existsSync(devStandaloneServer)) {
    throw new Error(
      "Fast desktop dashboard build is missing. Run `npm run desktop:dev:fast` from the repository root.",
    );
  }
  const dashboardEntry = paths.mode === "packaged"
    ? [path.join(paths.dashboardServerDir, "server.js")]
    : useDevStandalone
      ? [devStandaloneServer]
      : [
          path.join(paths.dashboardServerDir, "node_modules", "next", "dist", "bin", "next"),
          "dev",
          "--webpack",
          "--port",
          String(config.ports.dashboard),
          "--hostname",
          "127.0.0.1",
        ];
  const dashboardCwd = useDevStandalone
    ? path.dirname(devStandaloneServer)
    : paths.dashboardServerDir;
  const dashboardProduction = paths.mode === "packaged" || useDevStandalone;

  const dashboard: DesktopServiceDefinition = {
    id: "dashboard",
    displayName: "Breadboard workspace",
    required: true,
    command: binaries.node,
    args: dashboardEntry,
    cwd: dashboardCwd,
    // The selected runtime starts in the preceding supervisor wave because it
    // depends on ChatMock. It is intentionally not a hard dashboard dependency:
    // unrelated Breadboard features remain usable if the runtime is degraded.
    dependsOn: ["chatmock", "quartz"],
    env: {
      ...shared,
      NODE_ENV: dashboardProduction ? "production" : "development",
      ...(paths.mode === "dev" && !dashboardProduction
        ? { NODE_OPTIONS: dashboardDevNodeOptions(shared["NODE_OPTIONS"]) }
        : {}),
      PORT: String(config.ports.dashboard),
      HOSTNAME: "127.0.0.1",
      // --- Data + content locations (single source of truth: path-resolver) ---
      // An empty override in dev preserves the dashboard's historical
      // `<repo>/dashboard/db` layout. A configured BREADBOARD_DATA_DIR opts the
      // dashboard into the packaged `<data>/database` layout, so pointing it at
      // `<repo>/dashboard` would silently create `<repo>/dashboard/database`.
      // Explicitly clear it to prevent an inherited shell value doing the same.
      BREADBOARD_DATA_DIR: paths.mode === "packaged" ? paths.dataRoot : "",
      // A dev standalone server changes cwd to its traced build directory.
      // Keep its mutable data in the same dashboard/db location as hot reload.
      BREADBOARD_DEVELOPMENT_DASHBOARD_DIR:
        paths.mode === "dev" ? path.join(paths.appRoot, "dashboard") : "",
      BREADBOARD_REPO_ROOT: paths.appRoot,
      // The desktop supervisor owns Postiz startup. The dashboard is a client,
      // and always receives the exact dynamically allocated container port.
      SOCIALS_MANAGER_MODE: "stack",
      SOCIALS_MANAGER_URL: urls.postiz,
      SOCIALS_MANAGER_SUPPRESS_DOCKER_UI: "true",
      BREADBOARD_SKILLS_CATALOG_URL:
        process.env["BREADBOARD_SKILLS_CATALOG_URL"]?.trim() ||
        DEFAULT_BREADBOARD_SKILLS_CATALOG_URL,
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
      CHATMOCK_MODEL: process.env["CHATMOCK_MODEL"] ?? "default",
      // --- Local speech (Voicebox; server-only loopback proxy) ---
      VOICEBOX_BASE_URL: voiceboxUrl,
      VOICEBOX_STATUS_PATH: path.join(voiceboxDataDir, "startup-status.json"),
      // --- Recall (local screen + audio history) ---
      // The dashboard owns this engine's lifecycle rather than the supervisor,
      // because capture is a per-user opt-in it alone can read; see
      // main/recall.ts. What it needs from here is where to install it, where
      // its recordings live, and which loopback port to expect it on.
      RECALL_HOME: recallHomeDir,
      RECALL_DATA_DIR: recallDataDirectory,
      RECALL_BASE_URL: recallUrl,
      // --- Hermes runtime (server only) ---
      CODEX_BIN: resolveCodexBinary(paths),
      CODEX_HOME: paths.codexHome,
      // ARIS is a read-only research methodology/skill checkout consumed by
      // the dashboard per turn; it is not a separate network service.
      ARIS_ROOT: process.env["ARIS_ROOT"]?.trim()
        ? path.resolve(process.env["ARIS_ROOT"].trim())
        : path.join(paths.appRoot, "auto-claude-code-research-in-sleep"),
      HERMES_BASE_URL: hermesUrl,
      HERMES_DASHBOARD_SESSION_TOKEN: persistent.hermesSessionToken,
      BREADBOARD_HERMES_TOOL_SECRET: persistent.hermesToolSecret,
      HERMES_ENABLED: "true",
      HERMES_MODE: "required",
      HERMES_CAPABILITY_SECRET: persistent.hermesCapabilitySecret,
      HERMES_ROOT: paths.hermesWorkspaceRoot,
      HERMES_SKILLS_QUARANTINE: paths.skillsQuarantine,
      HERMES_SKILLS_APPROVED: paths.skillsApproved,
      HERMES_SKILLS_CONDITIONAL: paths.skillsConditional,
      HERMES_FIRST_PARTY_SKILLS_ROOT: path.join(
        paths.appRoot,
        "hermes-skills",
        "prebuilt",
      ),
      BREADBOARD_WATCH_PYTHON: binaries.python,
      // The evaluator is internal-only. Mode defaults to empty/off and is
      // deliberately absent from renderer settings and IPC contracts.
      BREADBOARD_IFIXAI_PYTHON: binaries.python,
      BREADBOARD_IFIXAI_ENDPOINT: urls.chatmockV1,
      BREADBOARD_IFIXAI_MODE: process.env["BREADBOARD_IFIXAI_MODE"] ?? "",
      BREADBOARD_IFIXAI_SUT_MODEL:
        process.env["BREADBOARD_IFIXAI_SUT_MODEL"] ??
        process.env["CHATMOCK_MODEL"] ??
        "default",
      BREADBOARD_IFIXAI_JUDGE_MODEL:
        process.env["BREADBOARD_IFIXAI_JUDGE_MODEL"] ?? "",
      BREADBOARD_IFIXAI_REPAIR_MODEL:
        process.env["BREADBOARD_IFIXAI_REPAIR_MODEL"] ?? "",
      BREADBOARD_IFIXAI_SUITE:
        process.env["BREADBOARD_IFIXAI_SUITE"] ?? "strategic",
      BREADBOARD_IFIXAI_SEED:
        process.env["BREADBOARD_IFIXAI_SEED"] ?? "1701",
      BREADBOARD_IFIXAI_INTERVAL_HOURS:
        process.env["BREADBOARD_IFIXAI_INTERVAL_HOURS"] ?? "24",
      BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS:
        process.env["BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS"] ?? "120",
      BREADBOARD_IFIXAI_TIMEOUT_MINUTES:
        process.env["BREADBOARD_IFIXAI_TIMEOUT_MINUTES"] ?? "20",
      BREADBOARD_IFIXAI_JUDGE_MAX_CALLS:
        process.env["BREADBOARD_IFIXAI_JUDGE_MAX_CALLS"] ?? "200",
      BREADBOARD_IFIXAI_MAX_ATTEMPTS:
        process.env["BREADBOARD_IFIXAI_MAX_ATTEMPTS"] ?? "1",
      BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT:
        process.env["BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT"] ?? "0.15",
      BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION:
        process.env["BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION"] ?? "0.02",
      // LoopX is stdlib-only Python, so the bundled runtime runs it directly.
      // Without these the packaged app finds no interpreter beside the staged
      // source and every conversation silently loses its loop state.
      BREADBOARD_LOOPX_PYTHON: binaries.python,
      BREADBOARD_LOOPX_ROOT: path.join(paths.appRoot, "loopx"),
      // Goal Mode reads the cloned Goal continuation contract. State itself is
      // conversation-scoped under BREADBOARD_DATA_DIR, never in app resources.
      BREADBOARD_GOAL_ROOT: path.join(paths.appRoot, "goal"),
      // Product-owned persona catalog. A valid source override is supported
      // for development, while installed builds use the staged copy.
      AGENCY_AGENTS_PATH: resolveAgencyAgentsPath(paths),
      BREADBOARD_INTERNAL_URL: urls.dashboard,
      // --- Quartz publish pipeline runs `node bootstrap-cli.mjs` itself ---
      BREADBOARD_NODE_BINARY: binaries.node,
      // --- Video transcription (optional capability) ---
      VIDEO_TRANSCRIPTION_ENABLED: persistent.scriberrEnabled ? "true" : "false",
      ...(persistent.scriberrEnabled
        ? {
            SCRIBERR_BASE_URL: persistent.scriberrBaseUrl ?? "http://127.0.0.1:8091",
            SCRIBERR_USERNAME: persistent.scriberrUsername,
            SCRIBERR_PASSWORD: persistent.scriberrPassword,
          }
        : {}),
      FFMPEG_PATH: ffmpeg,
      FFPROBE_PATH: ffprobe,
      YTDLP_PATH: ytdlp,
      // --- GBrain (garden knowledge retrieval) ---
      // The desktop config is the lifecycle source of truth. Set the mode even
      // when disabled so a GBRAIN_MODE inherited from a dev `.env.local` cannot
      // make the dashboard probe a sidecar the supervisor intentionally omitted.
      GBRAIN_MODE: persistent.gbrainMode,
      ...(gbrainEnabled
        ? {
            GBRAIN_ADAPTER_URL: gbrainUrl,
            GBRAIN_ADAPTER_SECRET: persistent.gbrainAdapterSecret,
          }
        : {}),
      // --- Subscription proxy (OAuth sign-in + model sync live here) ---
      CLIPROXY_MODE: persistent.cliproxyMode,
      ...cliproxyClientEnv,
      // --- Agent TARS operator (loopback adapter; only when enabled) ---
      UI_TARS_MODE: persistent.uiTarsMode,
      ...(uiTarsEnabled
        ? {
            UI_TARS_ADAPTER_URL: uiTarsUrl,
            UI_TARS_ADAPTER_SECRET: persistent.uiTarsAdapterSecret,
          }
        : {}),
      // --- Parametric CAD (loopback service; only when it is actually present) ---
      // The port is dynamically allocated, so it must be passed; the secret is
      // the per-install one, which both the dashboard and the service read from
      // here rather than from the shared file.
      CAD_MODE: persistent.cadMode,
      // `disabled` when there is no interpreter, so the dashboard stops calling
      // a service that cannot answer instead of timing out once per question.
      COLPALI_MODE: colpaliEnabled ? "auto" : "disabled",
      ...(colpaliEnabled
        ? {
            COLPALI_SERVICE_URL: colpaliUrl,
            COLPALI_SERVICE_SECRET: persistent.colpaliServiceSecret,
            BREADBOARD_COLPALI_PORT: String(config.ports.colpali ?? 7733),
            BREADBOARD_COLPALI_HOME: colpaliHome,
          }
        : {}),
      ...(cadEnabled
        ? {
            CAD_SERVICE_URL: cadUrl,
            CAD_SERVICE_SECRET: persistent.cadServiceSecret,
            BREADBOARD_CAD_PORT: String(config.ports.cad ?? 7731),
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
      // Production vendored engine; `fake` is test-only and refused here anyway.
      GBRAIN_BACKEND: process.env["GBRAIN_BACKEND"] ?? "gbrain",
      // Real vectors with no paid API, matching the dev stack: ChatMock's
      // `/v1/embeddings` serves a local ONNX model and is OpenAI-compatible,
      // which is the only shape the vendored engine's gateway accepts. PROVIDER,
      // BASE_URL, MODEL, API_KEY and DIMENSIONS must ALL be set or the adapter
      // truthfully degrades to lexical. ChatMock ignores the key.
      GBRAIN_EMBEDDING_PROVIDER: process.env["GBRAIN_EMBEDDING_PROVIDER"] ?? "openai-compatible",
      GBRAIN_EMBEDDING_BASE_URL: process.env["GBRAIN_EMBEDDING_BASE_URL"] ?? urls.chatmockV1,
      GBRAIN_EMBEDDING_API_KEY: process.env["GBRAIN_EMBEDDING_API_KEY"] ?? "local",
      GBRAIN_EMBEDDING_MODEL: process.env["GBRAIN_EMBEDDING_MODEL"] ?? "local/bge-small-en-v1.5",
      GBRAIN_EMBEDDING_DIMENSIONS: process.env["GBRAIN_EMBEDDING_DIMENSIONS"] ?? "384",
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
    displayName: "Agent TARS operator",
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
      UI_TARS_SCREENSHOT_RETENTION_MS: process.env["UI_TARS_SCREENSHOT_RETENTION_MS"] ?? "0",
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

  const cad: DesktopServiceDefinition | null = cadEnabled
    ? {
        id: "cad",
        displayName: "Parametric CAD (CadQuery)",
        // Never blocks startup: without it the CAD agent reports the service as
        // unavailable and every other capability is unaffected.
        required: false,
        startInBackground: true,
        command: cadPython!,
        args: [
          "-m",
          "breadboard_cad",
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          String(config.ports.cad ?? 7731),
        ],
        cwd: path.join(paths.appRoot, "cad-service"),
        env: {
          ...shared,
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          // Secret injected via env (never argv) so it cannot leak in process listings.
          BREADBOARD_CAD_SECRET: persistent.cadServiceSecret,
          BREADBOARD_CAD_HOST: "127.0.0.1",
          BREADBOARD_CAD_PORT: String(config.ports.cad ?? 7731),
          // Per-execution workspaces are transient and live under the desktop
          // data dir — never in resources, and never in the user's documents.
          BREADBOARD_CAD_WORKSPACE: cadWorkspace,
        },
        // Deliberately no readiness wait: the health endpoint imports
        // OpenCascade in a child process, which takes several seconds on a cold
        // cache. Supervising liveness keeps startup honest while the dashboard's
        // /api/cad/health reports the real state.
        startupTimeoutMs: 5_000,
        gracefulShutdownMs: 8_000,
        restartPolicy: "on-failure",
      }
    : null;

  const colpali: DesktopServiceDefinition | null = colpaliEnabled
    ? {
        id: "colpali",
        displayName: "Document page retrieval (ColPali)",
        // Never blocks startup: without it, attached documents are inlined
        // whole, which is what Breadboard did before this service existed.
        required: false,
        startInBackground: true,
        command: colpaliPython!,
        args: [
          "-m",
          "breadboard_colpali",
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          String(config.ports.colpali ?? 7733),
        ],
        cwd: path.join(paths.appRoot, "colpali-service"),
        env: {
          ...shared,
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          // Secret injected via env (never argv) so it cannot leak in process listings.
          BREADBOARD_COLPALI_SECRET: persistent.colpaliServiceSecret,
          BREADBOARD_COLPALI_PORT: String(config.ports.colpali ?? 7733),
          BREADBOARD_COLPALI_HOME: colpaliHome,
        },
        // No readiness wait, and a short startup timeout: the process binds its
        // port immediately and imports nothing heavy until the first request.
        // Waiting on health would mean waiting on `import torch`.
        startupTimeoutMs: 5_000,
        gracefulShutdownMs: 8_000,
        restartPolicy: "on-failure",
      }
    : null;

  const cliproxy: DesktopServiceDefinition = {
    id: "cliproxy",
    displayName: "Subscriptions (model proxy)",
    // Never blocks startup, in any mode: subscriptions are an optional way to
    // reach models, and the rest of Breadboard works without them.
    required: false,
    command: cliproxyBinaryPath(cliproxyHomeDir),
    // Written by prepareDataLayer, not here: building definitions must stay
    // free of side effects. Port, auth-dir and the loopback secrets are
    // Breadboard's to own, so that file is regenerated every launch.
    args: ["--config", cliproxyConfigPath(cliproxyHomeDir)],
    cwd: cliproxyHomeDir,
    env: {
      ...shared,
      // Keeps the Go binary's own logs inside the proxy home rather than cwd.
      WRITABLE_PATH: cliproxyHomeDir,
    },
    healthCheck: {
      type: "http",
      // /v1/models is the readiness signal that matters: it answers only once
      // the credential files have been loaded, which is what makes the
      // subscription models actually addressable. It is authenticated, so the
      // bearer goes with it — an unauthenticated probe 401s forever.
      url: `${cliproxyUrl}/v1/models`,
      headers: { Authorization: `Bearer ${cliproxyKey}` },
      timeoutMs: 2_500,
      intervalMs: 750,
    },
    startupTimeoutMs: 45_000,
    gracefulShutdownMs: 5_000,
    restartPolicy: "on-failure",
  };

  const definitions: DesktopServiceDefinition[] = [chatmock, postiz];
  // Before ChatMock's wave completes: ChatMock resolves `cliproxy/<model>` per
  // request, so ordering only affects how quickly the first such call succeeds,
  // not correctness.
  if (cliproxyEnabled) definitions.push(cliproxy);
  definitions.push(hermes);
  if (gbrainEnabled) definitions.push(gbrain);
  if (uiTarsEnabled) definitions.push(uiTars);
  if (cad) definitions.push(cad);
  if (colpali) definitions.push(colpali);
  if (voicebox) definitions.push(voicebox);
  definitions.push(quartz, dashboard);

  // Scriberr: bundled native loopback sidecar. It has no readiness wait here
  // because its first launch may prepare sizeable speech-model dependencies.
  // Dashboard health checks remain truthful while setup continues, and the
  // optional process never delays or blocks the Breadboard window.
  if (persistent.scriberrEnabled && persistent.scriberrBaseUrl === null) {
    definitions.push({
      id: "scriberr",
      displayName: "Video transcription (Scriberr)",
      required: false,
      command: scriberrBinary,
      args: [],
      cwd: paths.runtimeDir,
      env: {
        ...shared,
        HOST: "127.0.0.1",
        PORT: "8091",
        APP_ENV: "production",
        SCRIBERR_LAZY_MODEL_INIT: "true",
        SECURE_COOKIES: "false",
        ALLOWED_ORIGINS: urls.dashboard,
        DATABASE_PATH: path.join(scriberrDataDir, "scriberr.db"),
        JWT_SECRET_FILE: path.join(scriberrDataDir, "jwt_secret"),
        UPLOAD_DIR: path.join(scriberrDataDir, "uploads"),
        TRANSCRIPTS_DIR: path.join(scriberrDataDir, "transcripts"),
        TEMP_DIR: path.join(scriberrDataDir, "temp"),
        WHISPERX_ENV: path.join(scriberrDataDir, "models"),
        // Speaker separation only. WhisperX diarizes with pyannote, whose model
        // is gated on Hugging Face: without a token the job fails with a 401 and
        // the transcript comes back unattributed. `baseEnv` is an allowlist, so
        // this has to be forwarded explicitly or setting it would silently do
        // nothing. Absent is the normal case and costs only the speaker labels.
        ...(process.env.HF_TOKEN?.trim() ? { HF_TOKEN: process.env.HF_TOKEN.trim() } : {}),
        FFMPEG_PATH: ffmpeg,
        FFPROBE_PATH: ffprobe,
        YTDLP_PATH: ytdlp,
        PATH: [paths.binDir, shared["PATH"]].filter(Boolean).join(path.delimiter),
      },
      startupTimeoutMs: 5_000,
      gracefulShutdownMs: 10_000,
      restartPolicy: "on-failure",
    });
  }
  return definitions;
}
