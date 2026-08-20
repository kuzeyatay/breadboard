// The per-run workspace, and the rules about what may be read out of it.
//
// A Vox Director run is a real project on disk, laid out the way the clone lays
// its own out, because that is what lets `vox-director/scripts/assemble.py` and
// `kenburns.py` run against it unmodified:
//
//   dashboard/vox-director-runs/<runId>/
//     owner.json        who this run belongs to, so a finished film outlives the process
//     beats.json        upstream's own document — the one every stage script reads
//     production.json   Breadboard's richer record, which becomes the artifact
//     keyframes/        one collage poster per shot
//     elements/<key>/   the pieces cut out of that poster, plus its blurred backdrop
//     motion/           one clip per shot
//     audio/            narration per beat, and the music bed
//     out/final.mp4     the deliverable
//
// Workspaces are not deleted when a run ends: the film is the deliverable, and
// a card reopened after a restart re-reads it. The directory is gitignored.

import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir } from "../runtime-paths.ts";

const RUN_ID = /^voxrun_[0-9a-f]{32}$/;

export class VoxWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VoxWorkspaceError";
    this.code = code;
  }
}

export interface VoxWorkspaceOwner {
  runId: string;
  userId: number;
  brief: string;
  createdAt: string;
}

export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.VOX_DIRECTOR_WORKSPACE_ROOT?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(dashboardDataDir(), "vox-director-runs");
}

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

export function runDirectory(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isRunId(runId)) {
    throw new VoxWorkspaceError("invalid_run_id", "That Vox Director run id is not valid.");
  }
  return path.join(workspaceRoot(env), runId);
}

export const WORKSPACE_SUBDIRECTORIES = [
  "keyframes",
  "elements",
  "motion",
  "audio",
  "captions",
  "out",
] as const;

export function createWorkspace(input: {
  runId: string;
  userId: number;
  brief: string;
}): string {
  const root = runDirectory(input.runId);
  fs.mkdirSync(root, { recursive: true });
  for (const child of WORKSPACE_SUBDIRECTORIES) {
    fs.mkdirSync(path.join(root, child), { recursive: true });
  }
  const owner: VoxWorkspaceOwner = {
    runId: input.runId,
    userId: input.userId,
    brief: input.brief.slice(0, 4_000),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  return root;
}

export function readOwner(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): VoxWorkspaceOwner | null {
  try {
    const raw = fs.readFileSync(path.join(runDirectory(runId, env), "owner.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<VoxWorkspaceOwner>;
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
 * film outlives the process that made it, so anything reading a run's files
 * falls back to this rather than trusting a run id from a page.
 */
export function requireWorkspaceOwner(userId: number, runId: string): VoxWorkspaceOwner {
  const owner = readOwner(runId);
  if (!owner || owner.userId !== userId) {
    throw new VoxWorkspaceError("run_not_found", "That Vox Director run was not found.");
  }
  return owner;
}

/**
 * Resolve a path inside one run's workspace, or refuse.
 *
 * Every path this integration touches after the planning stage was influenced
 * by model output — an element name, a shot key, a beat id — so containment is
 * checked here, once, on the way in. The Python driver checks again on its own
 * side: a spec file is data crossing a process boundary, and the second check
 * is what makes tampering with one between the two useless.
 */
export function resolveInWorkspace(runId: string, relative: string): string {
  const root = path.resolve(runDirectory(runId));
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new VoxWorkspaceError("path_escapes_workspace", "That path is outside the run.");
  }
  return target;
}

/** POSIX-separated path relative to the run root, which is what gets stored. */
export function relativeInWorkspace(runId: string, absolute: string): string {
  const root = path.resolve(runDirectory(runId));
  return path.relative(root, path.resolve(absolute)).split(path.sep).join("/");
}

/** Write a JSON spec for the driver, inside the run it belongs to. */
export function writeSpec(runId: string, name: string, spec: unknown): string {
  const target = resolveInWorkspace(runId, path.join("specs", `${sanitize(name)}.json`));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(spec), "utf8");
  return target;
}

function sanitize(value: string): string {
  const cleaned = value.replace(/[^a-z0-9._-]/gi, "-").slice(0, 60);
  return cleaned || "spec";
}

export function writeJsonFile(runId: string, name: string, value: unknown): string {
  const target = resolveInWorkspace(runId, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

/** Remove a run's whole workspace. Only the verification path uses this. */
export function removeWorkspace(runId: string): void {
  fs.rmSync(runDirectory(runId), { recursive: true, force: true });
}
