// The container engine, started without the user opening anything.
//
// Docker Desktop is not the only way to get a daemon, and on Windows/macOS the
// CLI talks to one that only exists while some engine is running. Breadboard
// therefore resolves whichever engine is present and starts it itself:
//
//   1. an already-reachable daemon — Docker Desktop, Docker Engine on Linux,
//      dockerd in WSL, Rancher Desktop, Colima or OrbStack all look identical
//      here, so all of them simply work;
//   2. `docker desktop start --detach` — the official CLI plugin, which starts the
//      engine after disabling its dashboard-on-start preference;
//   3. launching the Docker Desktop application by path, for installs whose
//      CLI predates that plugin;
//   4. Podman, which is Apache-2.0 and needs no Docker Desktop subscription —
//      the fallback for users who cannot or will not install Desktop.
//
// Installing an engine is the user's decision, so having none is reported as a
// clear state and the agent degrades to local drafting rather than failing.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type EngineKind = "docker" | "podman";

export interface ContainerEngine {
  kind: EngineKind;
  /** The CLI to invoke: `docker` or `podman`. */
  cli: string;
  /** The compose invocation, already split into command + leading args. */
  compose: readonly string[];
}

export interface DockerStatus {
  /** A container CLI is on PATH. */
  cliInstalled: boolean;
  /** An engine that Breadboard knows how to start is installed. */
  desktopInstalled: boolean;
  /** The daemon answered — containers can be started. */
  daemonRunning: boolean;
  /** Which engine is in play, once one is found. */
  engine?: ContainerEngine;
  /** How the engine was started, for honest reporting in the UI. */
  startedBy?: "already_running" | "desktop_cli" | "application" | "podman_machine";
  reason?: string;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Optional live output sinks used by the desktop supervisor log. */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

const MAX_OUTPUT = 64_000;

/** Run a command to completion, capturing bounded output. */
export function run(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
      },
      options.timeoutMs ?? 120_000,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-MAX_OUTPUT);
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_OUTPUT);
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Candidate Docker Desktop launch targets, most likely first. */
function desktopCandidates(): string[] {
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const localAppData =
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe"),
      path.join(localAppData, "Docker", "Docker Desktop.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Docker.app"];
  }
  // On Linux the engine is a system service, not a desktop app.
  return [];
}

function desktopPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.DOCKER_DESKTOP_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return desktopCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

/** `<cli> info` is the only honest test that containers can be started. */
export async function daemonRunning(cli = "docker"): Promise<boolean> {
  const result = await run(cli, ["info", "--format", "{{.ServerVersion}}"], {
    timeoutMs: 15_000,
  });
  return result.code === 0 && result.stdout.trim().length > 0;
}

/** Is the `docker desktop` CLI plugin available? It is the silent start path. */
export async function hasDesktopCli(cli = "docker"): Promise<boolean> {
  const result = await run(cli, ["desktop", "status"], { timeoutMs: 15_000 });
  // The plugin answers even when the engine is stopped; a missing plugin errors
  // with "is not a docker command".
  return result.code === 0 || !/is not a docker command/i.test(result.stderr);
}

async function cliPresent(cli: string): Promise<boolean> {
  return (await run(cli, ["--version"], { timeoutMs: 10_000 })).code === 0;
}

/**
 * Resolve container CLIs without trusting a broad inherited PATH. Packaged
 * services intentionally receive a minimal environment, while Docker Desktop
 * installs docker.exe under Program Files rather than a system directory.
 */
export function containerCliCandidates(
  kind: EngineKind,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const executable = process.platform === "win32" ? `${kind}.exe` : kind;
  const configured = env[kind === "docker" ? "DOCKER_CLI_PATH" : "PODMAN_CLI_PATH"]?.trim();
  const candidates = configured ? [configured] : [];

  if (process.platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    if (kind === "docker") {
      candidates.push(path.join(programFiles, "Docker", "Docker", "resources", "bin", executable));
    } else {
      candidates.push(path.join(programFiles, "RedHat", "Podman", executable));
      candidates.push(path.join(programFiles, "Podman", executable));
    }
  } else {
    const home = env.HOME ?? os.homedir();
    candidates.push(`/usr/bin/${executable}`, `/usr/local/bin/${executable}`);
    if (process.platform === "darwin") {
      candidates.push(`/opt/homebrew/bin/${executable}`);
      if (kind === "docker") {
        candidates.push(path.join(home, ".docker", "bin", executable));
        candidates.push(path.join(home, ".orbstack", "bin", executable));
      }
    }
  }

  // Dev and custom installs can still use PATH; absolute packaged candidates
  // are attempted first so startup does not depend on shell initialization.
  candidates.push(kind);
  return [...new Set(candidates)];
}

/** Resolve the engine Breadboard should drive, preferring Docker. */
export async function resolveEngine(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContainerEngine | null> {
  for (const kind of ["docker", "podman"] as const) {
    for (const cli of containerCliCandidates(kind, env)) {
      if (!(await cliPresent(cli))) continue;
      const native = await run(cli, ["compose", "version"], { timeoutMs: 15_000 });
      const fallbackName = process.platform === "win32" ? `${kind}-compose.exe` : `${kind}-compose`;
      const siblingFallback = path.isAbsolute(cli)
        ? path.join(path.dirname(cli), fallbackName)
        : fallbackName;
      return {
        kind,
        cli,
        compose: native.code === 0 ? [cli, "compose"] : [siblingFallback],
      };
    }
  }
  return null;
}

export async function dockerStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DockerStatus> {
  const engine = await resolveEngine(env);
  if (!engine) {
    return {
      cliInstalled: false,
      desktopInstalled: false,
      daemonRunning: false,
      reason: "No container engine is installed.",
    };
  }

  const running = await daemonRunning(engine.cli);
  if (running) {
    return {
      cliInstalled: true,
      desktopInstalled: true,
      daemonRunning: true,
      engine,
      startedBy: "already_running",
    };
  }

  // A stopped engine is only actionable if Breadboard can start it. On Linux
  // the daemon is a system service, and Podman starts its own machine.
  const startable =
    engine.kind === "podman" ||
    process.platform === "linux" ||
    (engine.kind === "docker" && (await hasDesktopCli(engine.cli))) ||
    desktopPath(env) !== null;

  return {
    cliInstalled: true,
    desktopInstalled: startable,
    daemonRunning: false,
    engine,
    reason: startable
      ? "The container engine is not running yet."
      : "No startable container engine was found.",
  };
}

/**
 * Suppress Docker Desktop's dashboard window on the next start.
 *
 * Docker only persists non-default settings, so the key is added rather than
 * expected to exist. Callers abort an automatic start if this cannot be set:
 * background startup must never surprise the user with another application's
 * window.
 */
export function suppressDesktopDashboard(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "win32" && process.platform !== "darwin") return false;
  const settingsPath =
    process.platform === "win32"
      ? path.join(
          env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
          "Docker",
          "settings-store.json",
        )
      : path.join(
          os.homedir(),
          "Library",
          "Group Containers",
          "group.com.docker",
          "settings-store.json",
        );
  try {
    const current = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
      : {};
    if (current.OpenUIOnStartupDisabled === true) return true;
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify({ ...current, OpenUIOnStartupDisabled: true }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch Docker Desktop detached. The process outlives this request on purpose:
 * the daemon has to survive the run that started it.
 */
function launchDesktop(target: string): boolean {
  try {
    const child =
      process.platform === "darwin"
        ? spawn("open", ["-g", "-a", target], {
            detached: true,
            stdio: "ignore",
          })
        : spawn(target, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the daemon is up, starting Docker Desktop quietly when it is not. Cold starts
 * take tens of seconds, so callers pass the budget they are willing to wait and
 * decide for themselves what to do when it runs out.
 */
export async function ensureDockerRunning(input: {
  timeoutMs: number;
  autoStart: boolean;
  /** Stop Docker Desktop's dashboard from opening. Enabled by default in config. */
  suppressUi?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<DockerStatus> {
  const env = input.env ?? process.env;
  const status = await dockerStatus(env);
  if (status.daemonRunning || !status.engine) return status;
  if (!input.autoStart) return status;

  const engine = status.engine;
  let startedBy: DockerStatus["startedBy"] | undefined;

  if (engine.kind === "podman") {
    // Podman's Linux-VM machine is the equivalent of Desktop's engine.
    const started = await run("podman", ["machine", "start"], { timeoutMs: 180_000 });
    if (started.code !== 0 && !/already running/i.test(started.stderr)) {
      return { ...status, reason: "The Podman machine could not be started." };
    }
    startedBy = "podman_machine";
  } else if (process.platform === "linux") {
    return {
      ...status,
      reason: "The Docker daemon is not running. Start it with your service manager.",
    };
  } else {
    if (input.suppressUi && !suppressDesktopDashboard(env)) {
      return {
        ...status,
        reason: "Docker Desktop could not be configured for silent startup. Start it manually to enable social publishing.",
      };
    }
    // The CLI plugin is the documented automation path. Detach immediately;
    // daemon readiness is polled below with the caller's own time budget.
    if (await hasDesktopCli(engine.cli)) {
      const started = await run(engine.cli, ["desktop", "start", "--detach"], {
        timeoutMs: 30_000,
      });
      startedBy = started.code === 0 ? "desktop_cli" : undefined;
    }
    if (!startedBy) {
      const target = desktopPath(env);
      if (!target) return { ...status, reason: "Docker Desktop is not installed." };
      if (!launchDesktop(target)) {
        return { ...status, reason: "Docker Desktop could not be launched." };
      }
      startedBy = "application";
    }
  }

  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (await daemonRunning(engine.cli)) {
      return { ...status, daemonRunning: true, startedBy, reason: undefined };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { ...status, startedBy, reason: "The container engine is still starting." };
}

/** The compose invocation for whichever engine is present. */
export async function composeCommand(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly string[] | null> {
  return (await resolveEngine(env))?.compose ?? null;
}
