import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MANIM_QUALITY_FLAGS,
  MAX_MANIM_VIDEO_BYTES,
  readManimConfig,
  type ManimConfig,
} from "./config.ts";
import {
  ManimServiceError,
  type ManimRequest,
} from "./request.ts";

export { ManimServiceError, validateManimRequest } from "./request.ts";
export type { ManimRequest } from "./request.ts";

export interface ManimRunResult extends ManimRequest {
  video: Buffer;
  image: string;
  durationSeconds: number;
  sourceHash: string;
}

export function manimDockerArgs(input: {
  config: ManimConfig;
  workDirectory: string;
  containerName: string;
  request: ManimRequest;
}): string[] {
  const user =
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    typeof process.getgid === "function"
      ? [`${process.getuid()}:${process.getgid()}`]
      : [];
  return [
    "run",
    "--rm",
    "--name", input.containerName,
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "256",
    "--memory", "2g",
    "--cpus", "2",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m",
    "--env", "HOME=/tmp",
    "--env", "XDG_CACHE_HOME=/tmp/.cache",
    ...(user.length ? ["--user", user[0]] : []),
    "--volume", `${input.workDirectory}:/manim:rw`,
    "--workdir", "/manim",
    input.config.image,
    "manim",
    "render",
    "--renderer", "cairo",
    "--disable_caching",
    "--progress_bar", "none",
    "--media_dir", "/manim/media",
    "--format", "mp4",
    "-q", MANIM_QUALITY_FLAGS[input.request.quality],
    "-o", "breadboard-manim",
    "scene.py",
    input.request.sceneName,
  ];
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCommand(input: {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-128 * 1024);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-128 * 1024);
    });
    const timer = setTimeout(() => {
      child.kill();
      if (settled) return;
      settled = true;
      reject(new ManimServiceError("manim_timeout", "The Manim render exceeded its time limit."));
    }, input.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

function removeContainer(config: ManimConfig, name: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    let child;
    try {
      child = spawn(config.dockerExecutable, ["rm", "-f", name], {
        env: process.env,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      finish();
    }, 10_000);
    child.once("close", finish);
    child.once("error", finish);
  });
}

function findRenderedVideo(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === "breadboard-manim.mp4") return candidate;
    }
  }
  return null;
}

async function requireRuntime(config: ManimConfig, signal?: AbortSignal): Promise<void> {
  let server: CommandResult;
  try {
    server = await runCommand({
      command: config.dockerExecutable,
      args: ["version", "--format", "{{.Server.Version}}"],
      timeoutMs: 15_000,
      signal,
    });
  } catch {
    throw new ManimServiceError(
      "manim_runtime_unavailable",
      "Docker is not available. Install or start Docker Desktop, then run `npm run setup:manim`.",
    );
  }
  if (server.code !== 0) {
    throw new ManimServiceError(
      "manim_runtime_unavailable",
      "Docker is not running. Start Docker Desktop, then run `npm run setup:manim`.",
    );
  }
  const image = await runCommand({
    command: config.dockerExecutable,
    args: ["image", "inspect", config.image],
    timeoutMs: 20_000,
    signal,
  });
  if (image.code !== 0) {
    throw new ManimServiceError(
      "manim_runtime_unavailable",
      `The pinned Manim image ${config.image} is not installed. Run \`npm run setup:manim\` once.`,
    );
  }
}

export async function runManim(
  request: ManimRequest,
  signal?: AbortSignal,
): Promise<ManimRunResult> {
  const config = readManimConfig();
  await requireRuntime(config, signal);
  const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-manim-"));
  const containerName = `breadboard-manim-${crypto.randomUUID().slice(0, 12)}`;
  const started = Date.now();
  try {
    fs.writeFileSync(path.join(workDirectory, "scene.py"), request.code, {
      encoding: "utf8",
      flag: "wx",
    });
    let rendered: CommandResult;
    try {
      rendered = await runCommand({
        command: config.dockerExecutable,
        args: manimDockerArgs({ config, workDirectory, containerName, request }),
        cwd: config.repositoryRoot,
        timeoutMs: config.timeoutMs,
        signal,
      });
    } catch (error) {
      // Do not let the disposable worker exit until Docker has removed the
      // named container. Killing only the CLI can otherwise orphan the render
      // in the daemon after Runtime cancellation.
      await removeContainer(config, containerName);
      if (error instanceof ManimServiceError) throw error;
      throw new ManimServiceError(
        "manim_render_failed",
        error instanceof Error ? error.message : "The Manim container could not be started.",
      );
    }
    if (rendered.code !== 0) {
      const detail = rendered.stderr.trim().split(/\r?\n/).slice(-8).join("\n");
      throw new ManimServiceError(
        "manim_render_failed",
        detail || "Manim rejected the scene.",
      );
    }
    const output = findRenderedVideo(path.join(workDirectory, "media"));
    if (!output) {
      throw new ManimServiceError(
        "manim_render_failed",
        "Manim reported success but produced no MP4.",
      );
    }
    const video = fs.readFileSync(output);
    if (
      video.byteLength < 12 ||
      video.byteLength > MAX_MANIM_VIDEO_BYTES ||
      video.subarray(4, 8).toString("ascii") !== "ftyp"
    ) {
      throw new ManimServiceError(
        "manim_render_failed",
        "Manim produced an invalid or oversized MP4.",
      );
    }
    return {
      ...request,
      video,
      image: config.image,
      durationSeconds: Math.max(0, (Date.now() - started) / 1_000),
      sourceHash: crypto.createHash("sha256").update(request.code).digest("hex"),
    };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}
