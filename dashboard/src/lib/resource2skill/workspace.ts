import fs from "node:fs";
import path from "node:path";
import { resource2SkillWorkspaceRoot } from "./runtime.ts";
import type { Resource2SkillDomain } from "./identity.ts";

export interface Resource2SkillOwner {
  runId: string;
  userId: number;
  brief: string;
  domain: Resource2SkillDomain;
  createdAt: string;
}

export interface Resource2SkillArtifact {
  id: string;
  relativePath: string;
  name: string;
  kind: "web" | "presentation" | "spreadsheet" | "scene" | "audio" | "image" | "document" | "source";
  contentType: string;
  size: number;
  modifiedAt: string;
}

const RUN_ID = /^r2srun_[0-9a-f]{32}$/;
const SKIP = new Set([".breadboard-result.json", "owner.json"]);
const TYPES: Record<string, Pick<Resource2SkillArtifact, "kind" | "contentType">> = {
  ".html": { kind: "web", contentType: "text/html; charset=utf-8" },
  ".css": { kind: "source", contentType: "text/css; charset=utf-8" },
  ".js": { kind: "source", contentType: "text/javascript; charset=utf-8" },
  ".pptx": { kind: "presentation", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ".xlsx": { kind: "spreadsheet", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ".blend": { kind: "scene", contentType: "application/octet-stream" },
  ".rpp": { kind: "audio", contentType: "text/plain; charset=utf-8" },
  ".wav": { kind: "audio", contentType: "audio/wav" },
  ".mp3": { kind: "audio", contentType: "audio/mpeg" },
  ".mid": { kind: "audio", contentType: "audio/midi" },
  ".midi": { kind: "audio", contentType: "audio/midi" },
  ".png": { kind: "image", contentType: "image/png" },
  ".jpg": { kind: "image", contentType: "image/jpeg" },
  ".jpeg": { kind: "image", contentType: "image/jpeg" },
  ".webp": { kind: "image", contentType: "image/webp" },
  ".svg": { kind: "image", contentType: "image/svg+xml" },
  ".pdf": { kind: "document", contentType: "application/pdf" },
  ".md": { kind: "document", contentType: "text/markdown; charset=utf-8" },
  ".txt": { kind: "document", contentType: "text/plain; charset=utf-8" },
  ".json": { kind: "source", contentType: "application/json" },
  ".py": { kind: "source", contentType: "text/x-python; charset=utf-8" },
};

export class Resource2SkillWorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function runDirectory(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Resource2SkillWorkspaceError("invalid_run_id", "That Resource2Skill run id is invalid.");
  return path.join(resource2SkillWorkspaceRoot(), runId);
}

export function outputDirectory(runId: string): string {
  return path.join(runDirectory(runId), "output");
}

export function createWorkspace(owner: Resource2SkillOwner): string {
  const directory = runDirectory(owner.runId);
  fs.mkdirSync(outputDirectory(owner.runId), { recursive: true });
  fs.writeFileSync(path.join(directory, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
  return outputDirectory(owner.runId);
}

export function requireWorkspaceOwner(userId: number, runId: string): Resource2SkillOwner {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(runDirectory(runId), "owner.json"), "utf8")) as Resource2SkillOwner;
    if (parsed.userId === userId) return parsed;
  } catch {
    // Report the same not-found response for missing and foreign workspaces.
  }
  throw new Resource2SkillWorkspaceError("run_not_found", "That Resource2Skill run was not found.");
}

function artifactId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function collect(root: string, directory: string, output: Resource2SkillArtifact[]): void {
  if (output.length >= 2_000) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collect(root, absolute, output);
      continue;
    }
    if (!entry.isFile() || SKIP.has(entry.name)) continue;
    const type = TYPES[path.extname(entry.name).toLowerCase()];
    if (!type) continue;
    const stats = fs.statSync(absolute);
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    output.push({ id: artifactId(relativePath), relativePath, name: entry.name, ...type, size: stats.size, modifiedAt: stats.mtime.toISOString() });
  }
}

export function scanArtifacts(runId: string): Resource2SkillArtifact[] {
  const root = outputDirectory(runId);
  if (!fs.existsSync(root)) return [];
  const artifacts: Resource2SkillArtifact[] = [];
  collect(root, root, artifacts);
  return artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function resolveArtifact(runId: string, id: string): { record: Resource2SkillArtifact; absolutePath: string } {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new Resource2SkillWorkspaceError("artifact_not_found", "That output was not found.");
  const relative = Buffer.from(id, "base64url").toString("utf8");
  const root = path.resolve(outputDirectory(runId));
  const absolutePath = path.resolve(root, relative);
  if (!relative || relative.includes("\0") || (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`))) {
    throw new Resource2SkillWorkspaceError("artifact_not_found", "That output was not found.");
  }
  const record = scanArtifacts(runId).find((artifact) => artifact.id === id);
  if (!record) throw new Resource2SkillWorkspaceError("artifact_not_found", "That output was not found.");
  return { record, absolutePath };
}
