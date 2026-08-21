// One directory per study, outside the clone.
//
// Everything a run produces lands under `output/`: the report, the clone's own
// deterministic result files, one file per respondent, the trial directory the
// upstream CLI can read, and a copy of the survey as a MatrAIx task. Nothing is
// written into the clone itself, so the checkout stays exactly as it was cloned.

import fs from "node:fs";
import path from "node:path";
import { matraixWorkspaceRoot } from "./runtime.ts";

export interface MatraixOwner {
  runId: string;
  userId: number;
  brief: string;
  createdAt: string;
}

export interface MatraixArtifact {
  id: string;
  relativePath: string;
  name: string;
  kind: "report" | "data" | "task" | "response";
  contentType: string;
  size: number;
  modifiedAt: string;
}

const RUN_ID = /^mxrun_[0-9a-f]{32}$/;
const SKIP = new Set(["owner.json", "spec.json"]);
const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
};

export class MatraixWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function runDirectory(runId: string): string {
  if (!RUN_ID.test(runId)) {
    throw new MatraixWorkspaceError("invalid_run_id", "That MatrAIx run id is invalid.");
  }
  return path.join(matraixWorkspaceRoot(), runId);
}

export function outputDirectory(runId: string): string {
  return path.join(runDirectory(runId), "output");
}

export function specPath(runId: string): string {
  return path.join(runDirectory(runId), "spec.json");
}

export function createWorkspace(owner: MatraixOwner): string {
  const directory = runDirectory(owner.runId);
  fs.mkdirSync(outputDirectory(owner.runId), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "owner.json"),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8",
  );
  return directory;
}

export function requireWorkspaceOwner(userId: number, runId: string): MatraixOwner {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(runDirectory(runId), "owner.json"), "utf8"),
    ) as MatraixOwner;
    if (parsed.userId === userId) return parsed;
  } catch {
    // A missing workspace and a workspace belonging to somebody else answer the
    // same way, so a run id cannot be probed for existence.
  }
  throw new MatraixWorkspaceError("run_not_found", "That MatrAIx run was not found.");
}

function artifactId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function kindFor(relativePath: string): MatraixArtifact["kind"] {
  if (relativePath.startsWith("task/")) return "task";
  if (relativePath.startsWith("responses/")) return "response";
  if (relativePath === "study.md") return "report";
  return "data";
}

function collect(root: string, directory: string, output: MatraixArtifact[]): void {
  if (output.length >= 2_000) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // `job/` is the clone's trial layout: hundreds of small files that exist
      // so `matraix results` can read the study, not so a person can browse it.
      if (path.relative(root, absolute) === "job") continue;
      collect(root, absolute, output);
      continue;
    }
    if (!entry.isFile() || SKIP.has(entry.name)) continue;
    const contentType = CONTENT_TYPES[path.extname(entry.name).toLowerCase()];
    if (!contentType) continue;
    const stats = fs.statSync(absolute);
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    output.push({
      id: artifactId(relativePath),
      relativePath,
      name: entry.name,
      kind: kindFor(relativePath),
      contentType,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
}

/** The report first, then the data, then the task and the raw responses. */
const KIND_ORDER: Record<MatraixArtifact["kind"], number> = {
  report: 0,
  data: 1,
  task: 2,
  response: 3,
};

export function scanArtifacts(runId: string): MatraixArtifact[] {
  const root = outputDirectory(runId);
  if (!fs.existsSync(root)) return [];
  const artifacts: MatraixArtifact[] = [];
  collect(root, root, artifacts);
  return artifacts.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.relativePath.localeCompare(b.relativePath),
  );
}

export function resolveArtifact(
  runId: string,
  id: string,
): { record: MatraixArtifact; absolutePath: string } {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) {
    throw new MatraixWorkspaceError("artifact_not_found", "That study file was not found.");
  }
  const relative = Buffer.from(id, "base64url").toString("utf8");
  const root = path.resolve(outputDirectory(runId));
  const absolutePath = path.resolve(root, relative);
  if (
    !relative ||
    relative.includes("\0") ||
    (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`))
  ) {
    throw new MatraixWorkspaceError("artifact_not_found", "That study file was not found.");
  }
  const record = scanArtifacts(runId).find((artifact) => artifact.id === id);
  if (!record) {
    throw new MatraixWorkspaceError("artifact_not_found", "That study file was not found.");
  }
  return { record, absolutePath };
}

/** The finished report, for the message the turn saves. */
export function readStudyMarkdown(runId: string): string {
  try {
    return fs.readFileSync(path.join(outputDirectory(runId), "study.md"), "utf8");
  } catch {
    return "";
  }
}
