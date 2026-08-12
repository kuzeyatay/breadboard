// The per-run production directory, and how a production's own state is read
// back out of it.
//
// An OpenMontage run is a real project on disk. Upstream's `lib/paths.py` reads
// `OPENMONTAGE_PROJECTS_DIR` and everything follows it — the project marker, the
// per-stage checkpoints, the decision log, the generated assets, the rendered
// video. Breadboard points that variable at a per-run directory, which keeps a
// production out of the clone's working tree and gives each run a workspace it
// owns outright.
//
// The second job of this module is reading that state back. OpenMontage already
// writes exactly what a progress card wants to show — which stage completed,
// which provider was chosen and why — so the card reports the production's own
// record of itself rather than guessing from the shell commands that scrolled
// past. Ownership lives in the workspace too, so a finished video still plays in
// an old transcript after a restart, when the in-memory run is long gone.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolveOpenMontageRoot, workspaceRoot } from "./runtime.ts";

export interface WorkspaceOwner {
  runId: string;
  userId: number;
  brief: string;
  createdAt: string;
}

export interface OpenMontageArtifact {
  /** Stable across re-scans and restarts: derived from the relative path. */
  id: string;
  /** Path relative to the projects directory, POSIX-separated. */
  relativePath: string;
  name: string;
  kind: "video" | "image" | "audio" | "document" | "data";
  contentType: string;
  size: number;
  modifiedAt: string;
}

/** One entry of the production's append-only decision log. */
export interface ProductionDecision {
  category: string;
  subject: string;
  /** The pipeline stage the choice was made in. */
  stage: string;
  chosen: string;
  rationale: string;
  optionsConsidered: string[];
  /** True when a later entry supersedes this (category, subject) pair. */
  superseded: boolean;
  at: string;
}

export interface ProductionState {
  /** The project id the agent chose, or null before `init_project` ran. */
  projectId: string | null;
  title: string;
  /** Which of the 13 manifests in `pipeline_defs/` is being run. */
  pipelineType: string;
  /**
   * The chosen pipeline's own ordered stages, read from its manifest. Every
   * pipeline uses a subset of the canonical list — `documentary-montage` has no
   * `research` stage at all — so the card's rail has to come from the manifest
   * or it shows the person steps their video will never take.
   */
  stages: string[];
  /** Stages with a written checkpoint, in the order OpenMontage defines them. */
  completedStages: string[];
  /** The furthest stage reached, which is what the card's rail points at. */
  currentStage: string | null;
  decisions: ProductionDecision[];
  /** Total estimated spend the cost tracker recorded, in USD. */
  spendUsd: number;
}

/**
 * OpenMontage's canonical stage order (`lib/checkpoint.py`). A pipeline manifest
 * may use a subset, never a different order, so this is a safe rail to render.
 */
export const PRODUCTION_STAGES = [
  "research",
  "proposal",
  "idea",
  "script",
  "scene_plan",
  "assets",
  "edit",
  "compose",
  "publish",
] as const;

const RUN_ID = /^omrun_[0-9a-f]{32}$/;
const MAX_SCAN_ENTRIES = 4_000;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".cache",
  "history",
  "frames",
  ".backlot",
]);

const FILE_KINDS: Record<string, { kind: OpenMontageArtifact["kind"]; contentType: string }> = {
  ".mp4": { kind: "video", contentType: "video/mp4" },
  ".webm": { kind: "video", contentType: "video/webm" },
  ".mov": { kind: "video", contentType: "video/quicktime" },
  ".gif": { kind: "image", contentType: "image/gif" },
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".m4a": { kind: "audio", contentType: "audio/mp4" },
  ".md": { kind: "document", contentType: "text/markdown; charset=utf-8" },
  ".txt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".srt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".vtt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".json": { kind: "data", contentType: "application/json; charset=utf-8" },
  ".yaml": { kind: "data", contentType: "text/plain; charset=utf-8" },
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
    throw new WorkspaceError("invalid_run_id", "That OpenMontage run id is not valid.");
  }
  return runId;
}

export function runDirectory(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(workspaceRoot(env), requireRunId(runId));
}

/**
 * The directory handed to upstream as `OPENMONTAGE_PROJECTS_DIR`. The agent
 * creates one project inside it; the extra level is what lets `owner.json` sit
 * beside the productions without upstream's watcher treating it as one.
 */
export function projectsDirectory(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runDirectory(runId, env), "projects");
}

export function readOwner(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceOwner | null {
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
 * this rather than 404-ing every production after a dashboard restart.
 */
export function requireWorkspaceOwner(userId: number, runId: string): WorkspaceOwner {
  const owner = readOwner(runId);
  if (!owner || owner.userId !== userId) {
    throw new WorkspaceError("run_not_found", "That OpenMontage run was not found.");
  }
  return owner;
}

/** Create the run directory and record who owns it. */
export async function createWorkspace(input: {
  runId: string;
  userId: number;
  brief: string;
}): Promise<{ runDirectory: string; projectsDirectory: string }> {
  const runPath = runDirectory(input.runId);
  const projectsPath = projectsDirectory(input.runId);
  await fsp.mkdir(projectsPath, { recursive: true });
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
  return { runDirectory: runPath, projectsDirectory: projectsPath };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(value: unknown, max = 400): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * The project directory the agent created, if it has created one. Upstream
 * marks a project with `project.json`, so that file — not merely a directory —
 * is what identifies one.
 */
export function resolveProjectDirectory(runId: string): string | null {
  const root = projectsDirectory(runId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const projects = entries
    .filter(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "project.json")),
    )
    .map((entry) => path.join(root, entry.name));
  if (projects.length === 0) return null;
  // A brief that produces variants can leave more than one; the newest is the
  // one the run is working on.
  return projects.sort(
    (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
  )[0];
}

function readDecisions(projectPath: string): ProductionDecision[] {
  const log = readJson(path.join(projectPath, "decision_log.json"));
  if (!log) return [];
  const raw = Array.isArray(log.decisions) ? log.decisions : [];
  const parsed: ProductionDecision[] = [];
  for (const item of raw.slice(0, 200)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const subject = str(value.subject, 200);
    const category = str(value.category, 120);
    if (!subject && !category) continue;
    parsed.push({
      category,
      subject,
      stage: str(value.stage, 60),
      // `selected` and `reason` are the schema's names
      // (`schemas/artifacts/decision_log.schema.json`).
      chosen: str(value.selected ?? value.chosen, 300),
      rationale: str(value.reason ?? value.rationale, 1_000),
      optionsConsidered: (Array.isArray(value.options_considered) ? value.options_considered : [])
        .slice(0, 12)
        .map((option) =>
          typeof option === "string"
            ? option.slice(0, 200)
            : str((option as Record<string, unknown>)?.label, 200),
        )
        .filter(Boolean),
      superseded: false,
      at: str(value.at ?? value.timestamp, 60),
    });
  }
  // Upstream's contract: the log is append-only and the board renders the
  // latest entry for a (category, subject) pair as current. Mark the earlier
  // ones so the card can say "revised" instead of showing a stale provider.
  const latest = new Map<string, number>();
  parsed.forEach((decision, index) => {
    latest.set(`${decision.category} ${decision.subject}`, index);
  });
  return parsed.map((decision, index) => ({
    ...decision,
    superseded: latest.get(`${decision.category} ${decision.subject}`) !== index,
  }));
}

function readSpend(projectPath: string): number {
  for (const name of ["cost_ledger.json", "costs.json", "budget.json"]) {
    const ledger = readJson(path.join(projectPath, name));
    if (!ledger) continue;
    const total =
      Number(ledger.total_usd ?? ledger.spent_usd ?? ledger.actual_usd ?? ledger.total) || 0;
    if (Number.isFinite(total) && total > 0) return total;
  }
  return 0;
}

/**
 * What the production says about itself: the pipeline it chose, the stages it
 * has checkpointed, and the decisions it logged. Every field is read from files
 * upstream already writes — nothing here asks the agent to report progress.
 */
/**
 * The ordered stage names of a pipeline manifest in `pipeline_defs/`.
 *
 * Falls back to the canonical list when the manifest cannot be read, which
 * mirrors what `lib/checkpoint.py:get_pipeline_stages` does for the same reason.
 */
export function pipelineStages(
  pipelineType: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const root = resolveOpenMontageRoot(env);
  if (!root || !/^[a-z0-9][a-z0-9-]{0,60}$/i.test(pipelineType)) {
    return [...PRODUCTION_STAGES];
  }
  try {
    const manifest = yaml.load(
      fs.readFileSync(path.join(root, "pipeline_defs", `${pipelineType}.yaml`), "utf8"),
    ) as { stages?: unknown };
    const stages = Array.isArray(manifest?.stages) ? manifest.stages : [];
    const names = stages
      .map((stage) =>
        typeof stage === "string" ? stage : str((stage as Record<string, unknown>)?.name, 60),
      )
      .filter(Boolean);
    return names.length ? names : [...PRODUCTION_STAGES];
  } catch {
    return [...PRODUCTION_STAGES];
  }
}

export function readProductionState(runId: string): ProductionState {
  const empty: ProductionState = {
    projectId: null,
    title: "",
    pipelineType: "",
    stages: [...PRODUCTION_STAGES],
    completedStages: [],
    currentStage: null,
    decisions: [],
    spendUsd: 0,
  };
  const projectPath = resolveProjectDirectory(runId);
  if (!projectPath) return empty;
  const marker = readJson(path.join(projectPath, "project.json")) ?? {};
  const pipelineType = str(marker.pipeline_type, 120);
  const stages = pipelineType ? pipelineStages(pipelineType) : [...PRODUCTION_STAGES];
  const completed = stages.filter((stage) =>
    fs.existsSync(path.join(projectPath, `checkpoint_${stage}.json`)),
  );
  return {
    projectId: str(marker.project_id, 200) || path.basename(projectPath),
    title: str(marker.title, 300),
    pipelineType,
    stages,
    completedStages: completed,
    currentStage: completed.length ? completed[completed.length - 1] : null,
    decisions: readDecisions(projectPath),
    spendUsd: readSpend(projectPath),
  };
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

function walk(root: string, directory: string, collected: OpenMontageArtifact[]): void {
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
    const descriptor = FILE_KINDS[path.extname(entry.name).toLowerCase()];
    if (!descriptor) continue;
    let stats: fs.Stats;
    try {
      stats = fs.statSync(absolute);
    } catch {
      continue;
    }
    collected.push({
      id: artifactId(path.relative(root, absolute).split(path.sep).join("/")),
      relativePath: path.relative(root, absolute).split(path.sep).join("/"),
      name: entry.name,
      kind: descriptor.kind,
      contentType: descriptor.contentType,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

const KIND_ORDER: Record<OpenMontageArtifact["kind"], number> = {
  video: 0,
  image: 1,
  audio: 2,
  document: 3,
  data: 4,
};

/**
 * Everything the production wrote, video first. The stage artifacts (`script`,
 * `scene_plan`, `asset_manifest`, `edit_decisions`) are listed alongside the
 * media because they are the editable record of the piece — re-running from a
 * checkpoint is the reason they exist.
 */
export function scanArtifacts(runId: string): OpenMontageArtifact[] {
  const root = projectsDirectory(runId);
  if (!fs.existsSync(root)) return [];
  const collected: OpenMontageArtifact[] = [];
  walk(root, root, collected);
  return collected.sort((left, right) => {
    const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (byKind !== 0) return byKind;
    return right.modifiedAt.localeCompare(left.modifiedAt);
  });
}

/** The rendered video a finished production should lead with, if it made one. */
export function primaryVideo(
  artifacts: readonly OpenMontageArtifact[],
): OpenMontageArtifact | null {
  const videos = artifacts.filter((artifact) => artifact.kind === "video" && artifact.size > 0);
  if (videos.length === 0) return null;
  // The compose stage writes the deliverable to the project's `renders/`
  // directory (created by `init_project`) or to the configured `output/`.
  // Anything under `assets/` is a generated or sourced clip that went *into*
  // the edit, however recently it was touched — never the finished piece.
  const delivered = videos.filter((artifact) =>
    /(^|\/)(renders|output)\//.test(artifact.relativePath),
  );
  const pool = delivered.length ? delivered : videos;
  return [...pool].sort(
    (left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || right.size - left.size,
  )[0];
}

export interface ResolvedArtifact {
  record: OpenMontageArtifact;
  absolutePath: string;
}

/**
 * Resolve an artifact id back to a file inside the run's projects directory.
 * The id encodes a relative path, so the decoded path is re-checked for
 * containment before anything is opened.
 */
export function resolveArtifact(runId: string, id: string): ResolvedArtifact {
  const relativePath = relativeFromArtifactId(id);
  if (!relativePath) {
    throw new WorkspaceError("artifact_not_found", "That output was not found.");
  }
  const root = path.resolve(projectsDirectory(runId));
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
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
