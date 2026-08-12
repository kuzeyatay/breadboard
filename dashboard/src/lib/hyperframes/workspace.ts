// The per-run project directory, and the finished files inside it.
//
// A HyperFrames run is a real project on disk — `index.html` plus whatever
// media it pulls in — and its outputs are deliverables the person asked for, so
// workspaces live under the dashboard's data directory rather than in the OS
// temp directory. That also makes a finished run readable again after a
// restart, when the in-memory run state is long gone: ownership is recorded in
// the workspace itself.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  cliCommand,
  hyperframesEnv,
  resolveHyperframesRoot,
  workspaceRoot,
  type HyperframesLauncher,
  type HyperframesToolchain,
} from "./runtime.ts";

export interface WorkspaceOwner {
  runId: string;
  userId: number;
  brief: string;
  createdAt: string;
}

export interface HyperframesArtifact {
  /** Stable across re-scans and restarts: derived from the relative path. */
  id: string;
  /** Path relative to the project directory, POSIX-separated. */
  relativePath: string;
  name: string;
  kind: "video" | "image" | "composition" | "document" | "audio";
  /** MIME type the artifact route serves it as. */
  contentType: string;
  size: number;
  modifiedAt: string;
}

const RUN_ID = /^hfrun_[0-9a-f]{32}$/;
const INIT_TIMEOUT_MS = 180_000;
const MAX_SCAN_ENTRIES = 4_000;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".cache",
  "frames",
  ".hyperframes",
]);

// The scaffold's own instruction files. They are input to the agent, not output
// of the run, and listing them as "project files" invites the person to open
// documentation they never asked for.
const SKIPPED_FILES = new Set(["agents.md", "claude.md"]);

const FILE_KINDS: Record<
  string,
  { kind: HyperframesArtifact["kind"]; contentType: string }
> = {
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".html": { kind: "composition", contentType: "text/html; charset=utf-8" },
  ".md": { kind: "document", contentType: "text/markdown; charset=utf-8" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
};

export class WorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

function requireRunId(runId: string): string {
  if (!isRunId(runId)) {
    throw new WorkspaceError("invalid_run_id", "That HyperFrames run id is not valid.");
  }
  return runId;
}

export function runDirectory(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(workspaceRoot(env), requireRunId(runId));
}

/** The project itself — `index.html` lives here, and so does `out/`. */
export function projectDirectory(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runDirectory(runId, env), "project");
}

export function readOwner(runId: string, env: NodeJS.ProcessEnv = process.env): WorkspaceOwner | null {
  try {
    const raw = fs.readFileSync(path.join(runDirectory(runId, env), "owner.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkspaceOwner>;
    if (typeof parsed.userId !== "number" || !Number.isInteger(parsed.userId)) return null;
    return {
      runId,
      userId: parsed.userId,
      brief: typeof parsed.brief === "string" ? parsed.brief : "",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
}

/**
 * Ownership check for a workspace whose run is no longer in memory. A finished
 * video outlives the process that made it, so the artifact routes fall back to
 * this rather than 404-ing every run after a dashboard restart.
 */
export function requireWorkspaceOwner(userId: number, runId: string): WorkspaceOwner {
  const owner = readOwner(runId);
  if (!owner || owner.userId !== userId) {
    throw new WorkspaceError("run_not_found", "That HyperFrames run was not found.");
  }
  return owner;
}

function spawnCli(
  launcher: HyperframesLauncher,
  toolchain: HyperframesToolchain,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const { command, args: argv } = cliCommand(launcher, args);
    const child = spawn(command, argv, {
      cwd,
      windowsHide: true,
      env: hyperframesEnv(toolchain),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk: string) => {
      output = `${output}${chunk}`.slice(-16_000);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}` });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/**
 * The clone's blank template, used when `hyperframes init` cannot run. It is
 * the same `index.html` the CLI would have copied, so a scaffold failure costs
 * the project's `meta.json`/`package.json` niceties but never the run.
 */
function scaffoldFromClone(projectPath: string): boolean {
  const root = resolveHyperframesRoot();
  if (!root) return false;
  const template = path.join(root, "packages", "cli", "src", "templates", "blank");
  const index = path.join(template, "index.html");
  if (!fs.existsSync(index)) return false;
  fs.mkdirSync(projectPath, { recursive: true });
  fs.cpSync(template, projectPath, { recursive: true });
  const shared = path.join(root, "packages", "cli", "src", "templates", "_shared");
  if (fs.existsSync(shared)) fs.cpSync(shared, projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "hyperframes.json"),
    `${JSON.stringify({ $schema: "https://hyperframes.dev/schema.json", registry: "hyperframes" }, null, 2)}\n`,
    "utf8",
  );
  return true;
}

export interface CreatedWorkspace {
  runDirectory: string;
  projectDirectory: string;
  /** How the project was scaffolded, for the run's opening event. */
  scaffold: "cli" | "clone-template";
  /** CLI output when `init` failed and the template fallback was used. */
  scaffoldWarning: string;
}

/**
 * Scaffold `<workspace>/project` and record who owns it.
 *
 * `--non-interactive` matters: without it the CLI opens a prompt wizard and the
 * spawn hangs until the timeout. The environment already carries
 * `HYPERFRAMES_SKIP_SKILLS`, which keeps `init` from reaching GitHub to freshen
 * skills into the user's global agent directories — this integration reads the
 * skills out of the clone instead.
 */
export async function createWorkspace(input: {
  runId: string;
  userId: number;
  brief: string;
  launcher: HyperframesLauncher;
  toolchain: HyperframesToolchain;
}): Promise<CreatedWorkspace> {
  const runPath = runDirectory(input.runId);
  const projectPath = projectDirectory(input.runId);
  await fsp.mkdir(runPath, { recursive: true });
  const owner: WorkspaceOwner = {
    runId: input.runId,
    userId: input.userId,
    brief: input.brief.slice(0, 4_000),
    createdAt: new Date().toISOString(),
  };
  await fsp.writeFile(
    path.join(runPath, "owner.json"),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8",
  );

  const init = await spawnCli(
    input.launcher,
    input.toolchain,
    ["init", "project", "--example", "blank", "--non-interactive"],
    runPath,
    INIT_TIMEOUT_MS,
  );
  const scaffolded = fs.existsSync(path.join(projectPath, "index.html"));
  if (init.code === 0 && scaffolded) {
    pinProjectScripts(projectPath);
    return {
      runDirectory: runPath,
      projectDirectory: projectPath,
      scaffold: "cli",
      scaffoldWarning: "",
    };
  }
  if (!scaffoldFromClone(projectPath)) {
    throw new WorkspaceError(
      "scaffold_failed",
      `The HyperFrames project could not be scaffolded. ${init.output.trim().split(/\r?\n/).slice(-1)[0] ?? ""}`.trim(),
    );
  }
  pinProjectScripts(projectPath);
  return {
    runDirectory: runPath,
    projectDirectory: projectPath,
    scaffold: "clone-template",
    scaffoldWarning: init.output.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400),
  };
}

/**
 * Point the scaffold's own npm scripts at the local CLI.
 *
 * `hyperframes init` writes `"check": "npx --yes hyperframes@0.7.94 check"`, and
 * an agent reaches for `npm run check` before it reaches for a bare command —
 * observed on the first real run. That fetches a second copy of the CLI from
 * npm (slow, and impossible offline) even though the pinned one is already on
 * PATH. `dev` and `publish` are dropped rather than rewritten: `preview` never
 * exits, and `publish` uploads the video to a hosted service, which is not
 * something a chat brief authorises.
 */
export function pinProjectScripts(projectPath: string): void {
  const file = path.join(projectPath, "package.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return;
  const rewritten: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (name === "dev" || name === "publish") continue;
    rewritten[name] = value.replace(
      /^npx\s+(?:--yes\s+|-y\s+)?hyperframes(?:@[^\s]+)?\s+/,
      "hyperframes ",
    );
  }
  rewritten.lint = rewritten.lint ?? "hyperframes lint";
  manifest.scripts = rewritten;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function artifactId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function relativeFromArtifactId(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) return null;
  const decoded = Buffer.from(id, "base64url").toString("utf8");
  if (!decoded || decoded.includes("\0") || decoded.includes("..")) return null;
  return decoded;
}

function walk(root: string, directory: string, collected: HyperframesArtifact[]): void {
  if (collected.length >= MAX_SCAN_ENTRIES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (collected.length >= MAX_SCAN_ENTRIES) return;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(root, absolute, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIPPED_FILES.has(entry.name.toLowerCase())) continue;
    const descriptor = FILE_KINDS[path.extname(entry.name).toLowerCase()];
    if (!descriptor) continue;
    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolute);
    } catch {
      continue;
    }
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    collected.push({
      id: artifactId(relativePath),
      relativePath,
      name: entry.name,
      kind: descriptor.kind,
      contentType: descriptor.contentType,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

const KIND_ORDER: Record<HyperframesArtifact["kind"], number> = {
  video: 0,
  image: 1,
  composition: 2,
  document: 3,
  audio: 4,
};

/**
 * Everything the run produced, video first. The agent chooses its own output
 * paths (the skills suggest `out/`, but a workflow may not), so the workspace
 * is scanned rather than a fixed path being assumed — and the template's own
 * `index.html` is included, because the composition source is a deliverable
 * too: it is what makes the video editable later.
 */
export function scanArtifacts(runId: string): HyperframesArtifact[] {
  const projectPath = projectDirectory(runId);
  if (!fs.existsSync(projectPath)) return [];
  const collected: HyperframesArtifact[] = [];
  walk(projectPath, projectPath, collected);
  return collected.sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (byKind !== 0) return byKind;
    return right.modifiedAt.localeCompare(left.modifiedAt);
  });
}

/** The rendered video a finished run should lead with, if it made one. */
export function primaryVideo(artifacts: readonly HyperframesArtifact[]): HyperframesArtifact | null {
  return artifacts.find((artifact) => artifact.kind === "video" && artifact.size > 0) ?? null;
}

export interface ResolvedArtifact {
  record: HyperframesArtifact;
  absolutePath: string;
}

/**
 * Resolve an artifact id back to a file inside the project directory. The id
 * encodes a relative path, so the decoded path is re-checked for containment
 * before anything is opened.
 */
export function resolveArtifact(runId: string, id: string): ResolvedArtifact {
  const relativePath = relativeFromArtifactId(id);
  if (!relativePath) {
    throw new WorkspaceError("artifact_not_found", "That output was not found.");
  }
  const projectPath = path.resolve(projectDirectory(runId));
  const absolute = path.resolve(projectPath, relativePath);
  if (absolute !== projectPath && !absolute.startsWith(`${projectPath}${path.sep}`)) {
    throw new WorkspaceError("artifact_not_found", "That output was not found.");
  }
  const descriptor = FILE_KINDS[path.extname(absolute).toLowerCase()];
  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolute);
  } catch {
    throw new WorkspaceError("artifact_not_found", "That output was not found.");
  }
  if (!descriptor || !stats.isFile()) {
    throw new WorkspaceError("artifact_not_found", "That output was not found.");
  }
  return {
    record: {
      id,
      relativePath,
      name: path.basename(absolute),
      kind: descriptor.kind,
      contentType: descriptor.contentType,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    },
    absolutePath: absolute,
  };
}
