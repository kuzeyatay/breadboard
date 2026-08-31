import fs from "node:fs";
import path from "node:path";

import { repositoryRoot } from "../runtime-paths.ts";

export const PATENT_DISCLOSURE_SKILL = "patent-disclosure-skill";
export const PATENT_DISCLOSURE_UPSTREAM_COMMIT =
  "ecd62fdb45b9792bb5fb2ebe8dc61157e04faab0";

const MAX_GUIDANCE_FILES = 256;
const MAX_GUIDANCE_BYTES = 512 * 1024;
const ROOT_GUIDANCE_FILES = new Set([
  "INSTALL.md",
  "README.md",
  "SKILL.md",
]);
const GUIDANCE_DIRECTORIES = new Set([
  "docs",
  "examples",
  "prompts",
  "references",
]);
const GUIDANCE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
]);

export class PatentDisclosureSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PatentDisclosureSourceError";
    this.code = code;
  }
}

function configuredRoot(env: NodeJS.ProcessEnv): string | null {
  const configured = env.BREADBOARD_PATENT_DISCLOSURE_ROOT?.trim();
  return configured ? path.resolve(configured) : null;
}

export function patentDisclosureSourceRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return configuredRoot(env) ??
    path.join(repositoryRoot(), PATENT_DISCLOSURE_SKILL);
}

function portablePath(value: string): string {
  return value.split(path.sep).join("/");
}

function allowedGuidancePath(relativePath: string): boolean {
  if (ROOT_GUIDANCE_FILES.has(relativePath)) return true;
  const segments = relativePath.split("/");
  return segments.length > 1 &&
    GUIDANCE_DIRECTORIES.has(segments[0]) &&
    GUIDANCE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function normalizeGuidancePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 240 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new PatentDisclosureSourceError(
      "patent_guidance_path_invalid",
      "Patent guidance paths must be non-empty, bounded text paths.",
    );
  }
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    ) ||
    !allowedGuidancePath(normalized)
  ) {
    throw new PatentDisclosureSourceError(
      "patent_guidance_path_denied",
      "Only the reviewed patent skill's text guidance can be opened.",
    );
  }
  return normalized;
}

function directSourceRoot(root: string): string {
  try {
    const resolved = path.resolve(root);
    const metadata = fs.lstatSync(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      fs.realpathSync.native(resolved) !== resolved
    ) throw new Error("indirect source root");
    return resolved;
  } catch {
    throw new PatentDisclosureSourceError(
      "patent_guidance_unavailable",
      "The reviewed patent-disclosure guidance is not installed.",
    );
  }
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function directGuidanceFile(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!pathWithin(root, candidate)) {
    throw new PatentDisclosureSourceError(
      "patent_guidance_path_denied",
      "Patent guidance paths cannot leave the reviewed source root.",
    );
  }
  try {
    const metadata = fs.lstatSync(candidate);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      fs.realpathSync.native(candidate) !== candidate
    ) throw new Error("indirect guidance file");
    if (metadata.size > MAX_GUIDANCE_BYTES) {
      throw new PatentDisclosureSourceError(
        "patent_guidance_too_large",
        "That patent guidance file exceeds the read limit.",
      );
    }
    return candidate;
  } catch (error) {
    if (error instanceof PatentDisclosureSourceError) throw error;
    throw new PatentDisclosureSourceError(
      "patent_guidance_not_found",
      "That reviewed patent guidance file is not available.",
    );
  }
}

function collectGuidanceFiles(root: string, directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    const directoryMetadata = fs.lstatSync(current);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink() ||
      fs.realpathSync.native(current) !== current
    ) return;
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = portablePath(path.relative(root, absolute));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !allowedGuidancePath(relative)) continue;
      files.push(relative);
      if (files.length > MAX_GUIDANCE_FILES) {
        throw new PatentDisclosureSourceError(
          "patent_guidance_unavailable",
          "The reviewed patent guidance index exceeds its file limit.",
        );
      }
    }
  };
  if (fs.existsSync(directory)) visit(directory);
  return files;
}

export function listPatentDisclosureGuidance(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const root = directSourceRoot(patentDisclosureSourceRoot(env));
  const rootFiles = [...ROOT_GUIDANCE_FILES]
    .filter((relative) => fs.existsSync(path.join(root, relative)));
  const nested = [...GUIDANCE_DIRECTORIES]
    .flatMap((directory) =>
      collectGuidanceFiles(root, path.join(root, directory))
    );
  return [...rootFiles, ...nested].sort();
}

export function readPatentDisclosureGuidance(
  requestedPath: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { path: string; guidance: string; bytes: number } {
  const relativePath = normalizeGuidancePath(requestedPath);
  const root = directSourceRoot(patentDisclosureSourceRoot(env));
  const source = directGuidanceFile(root, relativePath);
  const contents = fs.readFileSync(source);
  const guidance = contents.toString("utf8");
  if (Buffer.from(guidance, "utf8").compare(contents) !== 0) {
    throw new PatentDisclosureSourceError(
      "patent_guidance_invalid_encoding",
      "Patent guidance must be valid UTF-8 text.",
    );
  }
  return { path: relativePath, guidance, bytes: contents.byteLength };
}
