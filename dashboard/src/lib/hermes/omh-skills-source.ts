import crypto from "node:crypto";
import { load as loadYaml, JSON_SCHEMA } from "js-yaml";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimePortableRealpath,
} from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import {
  getSkillsCatalogStore,
  type CatalogSnapshotRecord,
  type LocalCatalogSnapshotRecord,
  type SkillsCatalogStore,
} from "./skills-catalog-store.ts";
import type { SkillsShDetail } from "./skills-sh-client.ts";
import { OMH_SKILLS_SOURCE, omhWorkflowToken } from "./omh-command.ts";

export { OMH_SKILLS_SOURCE };
/** Human label used in inspection notices. */
export const OMH_SKILLS_LABEL = "oh-my-hermes clone";
/** Upstream keeps every generated workflow skill in one tree. */
const SKILL_TREE_SUBPATH = "skills";
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 2_000_000;
const MAX_SKILL_TOTAL_BYTES = 10_000_000;

interface LocalOmhSkill {
  directory: string;
  detail: SkillsShDetail;
  description: string | null;
  record: CatalogSnapshotRecord;
  binaryPaths: string[];
}

interface LocalOmhSnapshot {
  repository: string;
  revision: string;
  signature: string;
  skills: Map<string, LocalOmhSkill>;
}

export interface LocalOmhSyncResult {
  available: boolean;
  root: string | null;
  revision: string | null;
  added: number;
  updated: number;
  total: number;
  skipped: boolean;
}

let snapshotCache: LocalOmhSnapshot | null = null;
const appliedSnapshots = new WeakMap<SkillsCatalogStore, string>();

/**
 * Resolves the oh-my-hermes repository root. `OMH_SKILLS_ROOT` may point at the
 * repository itself or at its `skills/` tree; the repository root (the
 * directory containing `skills/`) is returned.
 */
export function localOmhSkillsRepository(): string | null {
  const configured = process.env.OMH_SKILLS_ROOT?.trim();
  const candidates = configured
    ? [path.resolve(configured), path.resolve(configured, "..")]
    : [path.join(repositoryRoot(), "oh-my-hermes")];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
    const tree = path.join(candidate, SKILL_TREE_SUBPATH);
    if (!fs.existsSync(tree) || !fs.statSync(tree).isDirectory()) continue;
    const hasSkills = fs.readdirSync(tree, { withFileTypes: true }).some((entry) =>
      entry.isDirectory() && fs.existsSync(path.join(tree, entry.name, "SKILL.md"))
    );
    if (hasSkills) return externalRuntimePortableRealpath(candidate);
  }
  return null;
}

export function synchronizeLocalOmhSkillsCatalog(input: {
  store?: SkillsCatalogStore;
  force?: boolean;
} = {}): LocalOmhSyncResult {
  const store = input.store ?? getSkillsCatalogStore();
  const repository = localOmhSkillsRepository();
  if (!repository) {
    return { available: false, root: null, revision: null, added: 0, updated: 0, total: 0, skipped: true };
  }
  const snapshot = loadSnapshot(repository, input.force === true);
  if (!input.force && appliedSnapshots.get(store) === snapshot.signature) {
    return {
      available: true,
      root: repository,
      revision: snapshot.revision,
      added: 0,
      updated: 0,
      total: snapshot.skills.size,
      skipped: true,
    };
  }
  const result = store.upsertLocalSnapshot({
    records: [...snapshot.skills.values()].map(({ record, detail, description }) => ({
      record,
      detail,
      description,
    } satisfies LocalCatalogSnapshotRecord)),
  });
  appliedSnapshots.set(store, snapshot.signature);
  return {
    available: true,
    root: repository,
    revision: snapshot.revision,
    ...result,
    skipped: false,
  };
}

export function getLocalOmhSkill(upstreamId: string): {
  detail: SkillsShDetail;
  description: string | null;
  binaryPaths: string[];
  revision: string;
} | null {
  const repository = localOmhSkillsRepository();
  if (!repository) return null;
  const snapshot = loadSnapshot(repository, false);
  const skill = snapshot.skills.get(upstreamId);
  return skill ? {
    detail: skill.detail,
    description: skill.description,
    binaryPaths: [...skill.binaryPaths],
    revision: snapshot.revision,
  } : null;
}

export function readLocalOmhSkillFiles(upstreamId: string): {
  files: Record<string, Buffer>;
  hash: string;
} | null {
  const repository = localOmhSkillsRepository();
  if (!repository) return null;
  const snapshot = loadSnapshot(repository, false);
  const skill = snapshot.skills.get(upstreamId);
  if (!skill) return null;
  const loaded = readSkillFiles(skill.directory);
  return {
    files: Object.fromEntries(loaded.map((file) => [file.relativePath, file.contents])),
    hash: hashFiles(loaded),
  };
}

function loadSnapshot(repository: string, force: boolean): LocalOmhSnapshot {
  if (!force && snapshotCache?.repository === repository) return snapshotCache;
  const revision = readGitRevision(repository) ?? "local";
  const skills = new Map<string, LocalOmhSkill>();
  const tree = path.join(repository, SKILL_TREE_SUBPATH);
  for (const entry of fs.readdirSync(tree, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(tree, entry.name);
    const manifestPath = path.join(directory, "SKILL.md");
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) continue;
    const slug = entry.name;
    const id = `${OMH_SKILLS_SOURCE}/${slug}`;
    const loaded = readSkillFiles(directory);
    const manifestFile = loaded.find((file) => file.relativePath.toLowerCase() === "skill.md");
    if (!manifestFile) continue;
    const manifest = decodeUtf8(manifestFile.contents);
    if (manifest === null) throw new Error(`${id} has a non-UTF-8 SKILL.md`);
    const metadata = readManifestMetadata(manifest, slug);
    const hash = hashFiles(loaded);
    const binaryPaths: string[] = [];
    const detailFiles = loaded.map((file) => {
      const contents = decodeUtf8(file.contents);
      if (contents === null) binaryPaths.push(file.relativePath);
      return { path: file.relativePath, contents: contents ?? "" };
    });
    const record: CatalogSnapshotRecord = {
      id,
      source: OMH_SKILLS_SOURCE,
      slug,
      name: metadata.name,
      installs: 0,
      sourceType: "local-git",
      installUrl: `https://github.com/${OMH_SKILLS_SOURCE}`,
      url: `https://github.com/${OMH_SKILLS_SOURCE}/tree/${revision}/${SKILL_TREE_SUBPATH}/${encodeURIComponent(slug)}`,
      duplicate: false,
      curated: false,
      ranks: {},
      slashCommand: omhWorkflowToken(slug),
    };
    skills.set(id, {
      directory,
      record,
      description: metadata.description,
      binaryPaths,
      detail: {
        id,
        source: OMH_SKILLS_SOURCE,
        slug,
        installs: 0,
        hash,
        files: detailFiles,
      },
    });
  }
  const signature = crypto.createHash("sha256").update(JSON.stringify(
    [...skills.values()].map(({ detail }) => [detail.id, detail.hash]),
  )).digest("hex");
  snapshotCache = { repository, revision, signature, skills };
  return snapshotCache;
}

function readSkillFiles(root: string): Array<{ relativePath: string; contents: Buffer }> {
  const rootRealPath = externalRuntimePortableRealpath(root);
  const files: Array<{ relativePath: string; contents: Buffer }> = [];
  let totalBytes = 0;
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`OMH skill contains a symbolic link: ${absolute}`);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const resolved = externalRuntimePortableRealpath(absolute);
      const relative = path.relative(rootRealPath, resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`OMH skill file escapes its source directory: ${absolute}`);
      }
      const contents = fs.readFileSync(resolved);
      if (contents.byteLength > MAX_SKILL_FILE_BYTES) {
        throw new Error(`OMH skill file exceeds the ${MAX_SKILL_FILE_BYTES}-byte review limit: ${relative}`);
      }
      totalBytes += contents.byteLength;
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error(`OMH skill exceeds the ${MAX_SKILL_TOTAL_BYTES}-byte review limit: ${root}`);
      }
      files.push({ relativePath: relative.replace(/\\/g, "/"), contents });
      if (files.length > MAX_SKILL_FILES) {
        throw new Error(`OMH skill exceeds the ${MAX_SKILL_FILES}-file review limit: ${root}`);
      }
    }
  };
  visit(rootRealPath);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readManifestMetadata(markdown: string, fallbackName: string): { name: string; description: string | null } {
  const frontmatter = markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
  try {
    const parsed = loadYaml(frontmatter, { schema: JSON_SCHEMA });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { name: fallbackName, description: null };
    }
    const values = parsed as Record<string, unknown>;
    return {
      name: typeof values.name === "string" && values.name.trim() ? values.name.trim() : fallbackName,
      description: typeof values.description === "string" && values.description.trim()
        ? values.description.trim()
        : null,
    };
  } catch {
    const name = looseFrontmatterValue(frontmatter, "name");
    const description = looseFrontmatterValue(frontmatter, "description");
    return {
      name: name?.trim() || fallbackName,
      description: description?.trim() || null,
    };
  }
}

function looseFrontmatterValue(frontmatter: string, key: string): string | null {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${key}:\\s*`, "i").test(line));
  if (index < 0) return null;
  const initial = lines[index].replace(new RegExp(`^${key}:\\s*`, "i"), "").trim();
  if (initial === ">" || initial === "|") {
    const continuation: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (!/^\s+/.test(lines[cursor])) break;
      continuation.push(lines[cursor].trim());
    }
    return initial === ">" ? continuation.join(" ") : continuation.join("\n");
  }
  if ((initial.startsWith('"') && initial.endsWith('"')) || (initial.startsWith("'") && initial.endsWith("'"))) {
    return initial.slice(1, -1);
  }
  return initial || null;
}

function hashFiles(files: Array<{ relativePath: string; contents: Buffer }>): string {
  const hashes = files.map(({ relativePath, contents }) => [
    relativePath,
    crypto.createHash("sha256").update(contents).digest("hex"),
  ]);
  return crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
}

function decodeUtf8(contents: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return null;
  }
}

function readGitRevision(repository: string): string | null {
  const dotGit = path.join(repository, ".git");
  if (!fs.existsSync(dotGit)) {
    const marker = path.join(repository, "BREADBOARD_UPSTREAM_COMMIT");
    const revision = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
    return /^[a-f0-9]{40,64}$/i.test(revision) ? revision : null;
  }
  let gitDirectory = dotGit;
  if (fs.statSync(dotGit).isFile()) {
    const match = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    gitDirectory = path.resolve(repository, match[1].trim());
  }
  const head = fs.readFileSync(path.join(gitDirectory, "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40,64}$/i.test(head)) return head;
  const ref = head.match(/^ref:\s*(.+)$/)?.[1];
  if (!ref) return null;
  const looseRef = path.join(gitDirectory, ...ref.split("/"));
  if (fs.existsSync(looseRef)) return fs.readFileSync(looseRef, "utf8").trim();
  const packed = path.join(gitDirectory, "packed-refs");
  if (!fs.existsSync(packed)) return null;
  return fs.readFileSync(packed, "utf8").split(/\r?\n/)
    .map((line) => line.split(" "))
    .find(([, name]) => name === ref)?.[0] ?? null;
}
