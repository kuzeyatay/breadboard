// User-initiated setup for Agent Reach channels.
//
// This is a DIFFERENT trust context from ./commands.ts. That module bounds what
// a *model* may run during a chat turn, and deliberately refuses `agent-reach
// configure`, `agent-reach install`, and every package manager. Here the user is
// the one asking, from the settings panel, so those actions are available — but
// only as fixed argv this module owns. Nothing a caller sends becomes a command:
// the request names an id from the tables below, and at most supplies a secret
// that is passed as a single argv element to `agent-reach configure`.
//
// Secrets are write-only. They go to the Agent Reach config on disk (~/.agent-reach)
// and are never read back into a response.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentReachEnv,
  resolveAgentReachRuntime,
  toolsBinDir,
  type AgentReachRuntime,
} from "./runtime.ts";
import { planSpawn } from "./spawn-plan.ts";

export class SetupError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.name = "SetupError";
  }
}

/** Where an installer's argv comes from — never from the request. */
type InstallRecipe =
  | { kind: "venv_pip"; packages: string[] }
  | { kind: "npm_global"; packages: string[] }
  | { kind: "mcporter_add"; name: string; url: string }
  /**
   * Download an archive and lift named executables out of it into `.tools/bin`.
   * Preferred over a system package manager: it needs no admin rights, and
   * `winget` reliably hangs when it has no interactive console.
   */
  | {
      kind: "portable_archive";
      /** Fixed download URL. */
      url?: string;
      /** Or the latest GitHub release of `githubRepo`, whose asset is named by
       * `assetName` with `{tag}` / `{version}` substituted. */
      githubRepo?: string;
      assetName?: string;
      /** Executable basenames to find inside the archive and install. */
      binaries: string[];
    }
  /** Append a line to a tool's own config file when it is not already there. */
  | { kind: "config_line"; file: string[]; line: string; marker: string }
  /** Copy a script shipped by Agent Reach into its per-user tools directory. */
  | { kind: "bundled_file"; source: string[]; destination: string[] };

export interface InstallTarget {
  id: string;
  label: string;
  /** What the user gets once this finishes. */
  unlocks: string;
  /** Channels whose doctor entry should improve afterwards. */
  channels: string[];
  steps: InstallRecipe[];
  /** Shown when the platform has no supported recipe. */
  manual?: string;
}

const INSTALL_TARGETS: InstallTarget[] = [
  {
    id: "exa",
    label: "Exa web search",
    unlocks: "Semantic search across the open web. Free, no API key.",
    channels: ["exa_search"],
    steps: [
      { kind: "npm_global", packages: ["mcporter"] },
      { kind: "mcporter_add", name: "exa", url: "https://mcp.exa.ai/mcp" },
    ],
  },
  {
    id: "yt-dlp",
    label: "YouTube (yt-dlp)",
    unlocks: "Video metadata, subtitles, and video search.",
    channels: ["youtube"],
    steps: [
      { kind: "venv_pip", packages: ["yt-dlp[default]"] },
      // YouTube now serves JS challenges; without a runtime yt-dlp reports
      // itself installed but cannot actually fetch. Node is already present.
      {
        kind: "config_line",
        file: [".config", "yt-dlp", "config"],
        line: "--js-runtimes node",
        marker: "--js-runtimes",
      },
    ],
  },
  {
    id: "bili-cli",
    label: "Bilibili (bili-cli)",
    unlocks: "Video details, search, rankings, and audio — no login needed.",
    channels: ["bilibili"],
    steps: [{ kind: "venv_pip", packages: ["bilibili-cli"] }],
  },
  {
    id: "twitter-cli",
    label: "Twitter/X (twitter-cli)",
    unlocks: "The reader itself. Add cookies below before it can fetch anything.",
    channels: ["twitter"],
    steps: [{ kind: "venv_pip", packages: ["twitter-cli"] }],
  },
  {
    id: "rdt-cli",
    label: "Reddit (rdt-cli)",
    unlocks: "Reddit search and post reading. Needs a login afterwards.",
    channels: ["reddit"],
    steps: [
      {
        kind: "venv_pip",
        // Pinned exactly as Agent Reach's own doctor recommends: the PyPI build
        // lags behind and cannot search.
        packages: [
          "git+https://github.com/public-clis/rdt-cli.git@5e4fb3720d5c174e976cd425ccc3b879d52cac66",
        ],
      },
    ],
  },
  {
    id: "opencli",
    label: "OpenCLI (Facebook, Instagram, XiaoHongShu, Reddit)",
    unlocks:
      "One backend for the login-only platforms. It drives a Chrome you are already signed in to, so after installing you also need its Chrome extension — Agent Reach never signs in for you.",
    channels: ["facebook", "instagram", "xiaohongshu", "reddit"],
    steps: [{ kind: "npm_global", packages: ["@jackwener/opencli"] }],
    manual:
      "Install the OpenCLI extension from the Chrome Web Store, then sign in to each platform in that Chrome profile.",
  },
  {
    id: "gh",
    label: "GitHub CLI",
    unlocks:
      "Repository, issue, PR, and code search. Sign in afterwards with `gh auth login`, or paste a token below.",
    channels: ["github"],
    steps: [
      {
        kind: "portable_archive",
        githubRepo: "cli/cli",
        assetName: "gh_{version}_windows_amd64.zip",
        binaries: ["gh.exe"],
      },
    ],
    manual: "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`.",
  },
  {
    id: "ffmpeg",
    label: "Podcast transcription tools",
    unlocks: "ffmpeg plus Agent Reach's Xiaoyuzhou transcription script.",
    channels: ["xiaoyuzhou"],
    steps: [
      {
        kind: "portable_archive",
        // BtbN publishes Windows builds as GitHub releases under a stable
        // `latest` tag. gyan.dev answers HEAD but then stalls the body, so it
        // is not usable unattended.
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
        binaries: ["ffmpeg.exe", "ffprobe.exe"],
      },
      {
        kind: "bundled_file",
        source: ["agent_reach", "scripts", "transcribe_xiaoyuzhou.sh"],
        destination: [".agent-reach", "tools", "xiaoyuzhou", "transcribe.sh"],
      },
    ],
    manual: "Install ffmpeg from https://ffmpeg.org/download.html and put it on PATH.",
  },
];

/** Config keys `agent-reach configure` accepts (see its CLI parser). */
export interface CredentialField {
  key: string;
  label: string;
  channels: string[];
  hint: string;
  /** Where the user gets the value. */
  source?: string;
}

const CREDENTIALS: CredentialField[] = [
  {
    key: "groq-key",
    label: "Groq API key",
    channels: ["xiaoyuzhou", "youtube"],
    hint: "Whisper transcription for podcasts and videos without subtitles.",
    source: "https://console.groq.com/keys — free",
  },
  {
    key: "openai-key",
    label: "OpenAI API key",
    channels: ["xiaoyuzhou"],
    hint: "Fallback transcription provider when Groq fails.",
  },
  {
    key: "github-token",
    label: "GitHub token",
    channels: ["github"],
    hint: "An alternative to `gh auth login` for read-only repository access.",
    source: "https://github.com/settings/tokens",
  },
  {
    key: "twitter-cookies",
    label: "Twitter/X cookies",
    channels: ["twitter"],
    hint: "Export with the Cookie-Editor extension while signed in to x.com, then paste the header string.",
  },
  {
    key: "xhs-cookies",
    label: "XiaoHongShu cookies",
    channels: ["xiaohongshu"],
    hint: "Cookie-Editor export only. Agent Reach never signs in for you or reads your browser.",
  },
  {
    key: "youtube-cookies",
    label: "YouTube cookies",
    channels: ["youtube"],
    hint: "Only needed for age-restricted or members-only videos.",
  },
  {
    key: "proxy",
    label: "Proxy URL",
    channels: ["reddit", "twitter"],
    hint: "Only needed on a server whose IP those platforms block. Local machines do not need one.",
  },
];

/** `agent-reach configure --from-browser <browser> --platform <platform>`. */
export const COOKIE_BROWSERS = ["chrome", "edge", "firefox", "brave", "opera"] as const;
// Agent Reach deliberately requires an explicit Cookie-Editor paste for
// Twitter and XiaoHongShu; offering automatic import for them only produces a
// CLI refusal. These are the platforms the upstream extractor can truly read.
export const COOKIE_PLATFORMS = ["bilibili", "xueqiu"] as const;

export function setupCatalog(): {
  installs: Array<Omit<InstallTarget, "steps"> & { available: boolean }>;
  credentials: CredentialField[];
  browsers: readonly string[];
  platforms: readonly string[];
} {
  return {
    installs: INSTALL_TARGETS.map(({ steps, ...target }) => ({
      ...target,
      // winget is the only Windows-specific recipe; elsewhere the user installs
      // it themselves and the manual note says how.
      available: !steps.some(
        (step) => step.kind === "portable_archive" && process.platform !== "win32",
      ),
    })),
    credentials: CREDENTIALS,
    browsers: COOKIE_BROWSERS,
    platforms: COOKIE_PLATFORMS,
  };
}

// ---- execution --------------------------------------------------------------

const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_CHARS = 4_000;

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  // npm, mcporter, and winget are .cmd/.exe shims on Windows; planSpawn resolves
  // them to a concrete file and wraps shims safely rather than using a shell.
  const plan = planSpawn(command, args, env, (name) => `${name} is not available on this machine.`);
  if ("error" in plan) return Promise.resolve({ ok: false, output: plan.error });
  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.argv, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: plan.verbatim,
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (out.length < MAX_OUTPUT_CHARS * 2) out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (err.length < MAX_OUTPUT_CHARS * 2) err += chunk;
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, STEP_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: /ENOENT/i.test(error.message)
          ? `${command} is not available on this machine.`
          : error.message,
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const text = `${out}\n${err}`.replace(/\x1b\[[0-9;]*m/g, "").trim();
      resolve({ ok: code === 0, output: text.slice(-MAX_OUTPUT_CHARS) });
    });
  });
}

function venvBin(runtime: AgentReachRuntime, name: string): string {
  return path.join(
    runtime.root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

/**
 * Download an archive, find the named executables anywhere inside it, and put
 * them in `.tools/bin` (which agentReachEnv puts on PATH). Windows-only for now:
 * on macOS/Linux these tools come from a real package manager.
 */
async function installPortableArchive(
  runtime: AgentReachRuntime,
  step: Extract<InstallRecipe, { kind: "portable_archive" }>,
): Promise<{ ok: boolean; output: string }> {
  let url = step.url ?? "";
  if (!url && step.githubRepo && step.assetName) {
    // Follow the /releases/latest redirect rather than calling the API, so this
    // needs no token and no rate-limited request.
    const response = await fetch(`https://github.com/${step.githubRepo}/releases/latest`, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    const tag = response.url.split("/").pop() ?? "";
    if (!/^v?[\w.\-+]+$/.test(tag)) {
      return { ok: false, output: `Could not resolve the latest ${step.githubRepo} release.` };
    }
    const asset = step.assetName
      .replaceAll("{tag}", tag)
      .replaceAll("{version}", tag.replace(/^v/, ""));
    url = `https://github.com/${step.githubRepo}/releases/download/${tag}/${asset}`;
  }
  if (!url) return { ok: false, output: "No download source for this tool." };

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "breadboard-agent-reach-tool-"));
  const archive = path.join(staging, "download.zip");
  const extracted = path.join(staging, "extracted");
  try {
    // Without a deadline a stalled mirror hangs the button forever — which is
    // exactly what gyan.dev's ffmpeg endpoint does: it answers HEAD, then never
    // sends the body.
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, output: `Download failed: ${response.status} ${url}` };
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await fs.mkdir(extracted, { recursive: true });

    // Windows 10+ ships bsdtar in System32, which handles zip. Name it by full
    // path: a PATH lookup finds Git Bash's MSYS tar first, and that one reads
    // "C:\..." as a remote host ("Cannot connect to C: resolve failed").
    const systemTar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const tar = process.platform === "win32" ? systemTar : "tar";
    const unzip = await run(tar, ["-xf", archive, "-C", extracted], process.env, staging);
    if (!unzip.ok) return { ok: false, output: `Could not unpack the archive.\n${unzip.output}` };

    const wanted = new Set(step.binaries.map((name) => name.toLowerCase()));
    const found = new Map<string, string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (wanted.has(entry.name.toLowerCase())) found.set(entry.name.toLowerCase(), full);
      }
    };
    await walk(extracted);
    const missing = step.binaries.filter((name) => !found.has(name.toLowerCase()));
    if (missing.length) {
      return { ok: false, output: `The archive did not contain: ${missing.join(", ")}` };
    }

    const target = toolsBinDir(runtime.root);
    await fs.mkdir(target, { recursive: true });
    for (const [name, source] of found) await fs.copyFile(source, path.join(target, name));
    return { ok: true, output: `Installed ${[...found.keys()].join(", ")} into ${target}` };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : "The download failed.",
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Append a line to a tool's own config file, once. */
async function installConfigLine(
  step: Extract<InstallRecipe, { kind: "config_line" }>,
): Promise<{ ok: boolean; output: string }> {
  const home = os.homedir();
  const file = path.join(home, ...step.file);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const existing = await fs.readFile(file, "utf8").catch(() => "");
    if (existing.includes(step.marker)) {
      return { ok: true, output: `${file} already sets ${step.marker}.` };
    }
    await fs.writeFile(file, `${existing}${existing.endsWith("\n") || !existing ? "" : "\n"}${step.line}\n`);
    return { ok: true, output: `Wrote ${step.line} to ${file}` };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : "Could not write the config." };
  }
}

/** Install a package-owned helper without fetching or executing arbitrary paths. */
async function installBundledFile(
  runtime: AgentReachRuntime,
  step: Extract<InstallRecipe, { kind: "bundled_file" }>,
): Promise<{ ok: boolean; output: string }> {
  const source = path.join(runtime.root, ...step.source);
  const destination = path.join(os.homedir(), ...step.destination);
  try {
    await fs.access(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    if (process.platform !== "win32") await fs.chmod(destination, 0o755);
    return { ok: true, output: `Installed ${destination}` };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : "Could not install the bundled helper.",
    };
  }
}

function requireRuntime(): AgentReachRuntime {
  const runtime = resolveAgentReachRuntime();
  if (!runtime) {
    throw new SetupError(
      503,
      "runtime_unavailable",
      "Agent Reach is not prepared. Create agent-reach/.venv and install the package first.",
    );
  }
  return runtime;
}

/** Run one install target's fixed steps, stopping at the first failure. */
export async function install(targetId: unknown): Promise<{ ok: boolean; output: string }> {
  const target = INSTALL_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) throw new SetupError(400, "unknown_install_target");
  const runtime = requireRuntime();
  const env = agentReachEnv(runtime);
  const log: string[] = [];

  for (const step of target.steps) {
    let result: { ok: boolean; output: string };
    if (step.kind === "venv_pip") {
      result = await run(
        venvBin(runtime, "python"),
        ["-m", "pip", "install", "-U", ...step.packages],
        env,
        runtime.root,
      );
    } else if (step.kind === "npm_global") {
      result = await run(
        "npm",
        ["install", "-g", ...step.packages],
        env,
        runtime.root,
      );
    } else if (step.kind === "mcporter_add") {
      result = await run(
        "mcporter",
        ["config", "add", step.name, step.url, "--scope", "home"],
        env,
        runtime.root,
      );
      // Re-registering an existing server is success from the user's point of view.
      if (!result.ok && /already exists/i.test(result.output)) result = { ...result, ok: true };
    } else if (step.kind === "config_line") {
      result = await installConfigLine(step);
    } else if (step.kind === "bundled_file") {
      result = await installBundledFile(runtime, step);
    } else if (process.platform !== "win32") {
      throw new SetupError(409, "manual_install_required", target.manual ?? "Install this tool manually.");
    } else {
      result = await installPortableArchive(runtime, step);
    }
    log.push(result.output);
    if (!result.ok) {
      return { ok: false, output: `${log.join("\n").trim()}\n\n${target.manual ?? ""}`.trim() };
    }
  }
  return { ok: true, output: log.join("\n").trim() };
}

/**
 * Store one credential through `agent-reach configure <key> <value>`. The value
 * is a single argv element — never interpolated into a command line — and is not
 * echoed back in the response or the returned output.
 */
export async function configure(key: unknown, value: unknown): Promise<{ ok: boolean; output: string }> {
  const field = CREDENTIALS.find((candidate) => candidate.key === key);
  if (!field) throw new SetupError(400, "unknown_credential");
  if (typeof value !== "string" || !value.trim()) {
    throw new SetupError(400, "empty_value");
  }
  if (value.length > 20_000) throw new SetupError(413, "value_too_long");
  const runtime = requireRuntime();
  const result = await run(
    runtime.command,
    [...runtime.baseArgs, "configure", field.key, value.trim()],
    agentReachEnv(runtime),
    runtime.root,
  );
  return { ok: result.ok, output: redact(result.output, value.trim()) };
}

/** Import cookies for one platform from one browser the user names. */
export async function importCookies(
  browser: unknown,
  platform: unknown,
): Promise<{ ok: boolean; output: string }> {
  if (typeof browser !== "string" || !COOKIE_BROWSERS.includes(browser as never)) {
    throw new SetupError(400, "unknown_browser");
  }
  if (typeof platform !== "string" || !COOKIE_PLATFORMS.includes(platform as never)) {
    throw new SetupError(400, "unknown_platform");
  }
  const runtime = requireRuntime();
  const result = await run(
    runtime.command,
    [...runtime.baseArgs, "configure", "--from-browser", browser, "--platform", platform],
    agentReachEnv(runtime),
    runtime.root,
  );
  return result;
}

/** Belt and braces: a CLI that echoes the value back must not reach the browser. */
function redact(output: string, secret: string): string {
  if (secret.length < 6) return output;
  return output.split(secret).join("••••••");
}
