// Reads and writes for built document skills: the SQLite row that identifies a
// skill, and the markdown tree on disk that is the skill.
//
// Every path that reaches a file goes through `skillFilePath`, which resolves
// and containment-checks against the skill's own directory. The read tool is
// model-driven, so a traversal attempt is an expected input, not a hypothetical.

import crypto from "node:crypto";
import db from "../db.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import type {
  BookType,
  DocumentSkillFile,
  DocumentSkillOrigin,
  DocumentSkillRecord,
  DocumentSkillStatus,
  SkillDepth,
} from "./types.ts";

interface DocumentSkillRow {
  id: number;
  user_id: number;
  slug: string;
  content_hash: string;
  title: string;
  author: string | null;
  status: string;
  book_type: string;
  depth: string;
  chapter_count: number;
  source_tokens: number;
  origin_kind: string;
  origin_file_name: string;
  origin_cluster_slug: string | null;
  origin_document_slug: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function documentSkillsRoot(): string {
  return path.join(dashboardDataDir(), "document-skills");
}

export function skillDirectory(slug: string): string {
  return path.join(documentSkillsRoot(), slug);
}

/** SHA-256 over the extracted text — the identity a build is cached under. */
export function documentContentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function slugifyTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toRecord(row: DocumentSkillRow): DocumentSkillRecord {
  const origin: DocumentSkillOrigin =
    row.origin_kind === "garden" && row.origin_cluster_slug && row.origin_document_slug
      ? {
          kind: "garden",
          clusterSlug: row.origin_cluster_slug,
          documentSlug: row.origin_document_slug,
          fileName: row.origin_file_name,
        }
      : { kind: "upload", fileName: row.origin_file_name };
  return {
    id: row.id,
    slug: row.slug,
    contentHash: row.content_hash,
    title: row.title,
    author: row.author,
    status: (["building", "ready", "failed"] as const).includes(row.status as DocumentSkillStatus)
      ? (row.status as DocumentSkillStatus)
      : "failed",
    bookType: row.book_type === "technical" ? "technical" : "text",
    depth: row.depth === "reference" ? "reference" : "study",
    chapterCount: row.chapter_count,
    sourceTokens: row.source_tokens,
    origin,
    userId: row.user_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findSkillByHash(userId: number, contentHash: string): DocumentSkillRecord | null {
  const row = db
    .prepare("SELECT * FROM document_skills WHERE user_id = ? AND content_hash = ?")
    .get(userId, contentHash) as DocumentSkillRow | undefined;
  return row ? toRecord(row) : null;
}

export function findSkillBySlug(userId: number, slug: string): DocumentSkillRecord | null {
  const row = db
    .prepare("SELECT * FROM document_skills WHERE user_id = ? AND slug = ?")
    .get(userId, slug) as DocumentSkillRow | undefined;
  return row ? toRecord(row) : null;
}

export function findSkillForGardenDocument(
  userId: number,
  clusterSlug: string,
  documentSlug: string,
): DocumentSkillRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM document_skills
       WHERE user_id = ? AND origin_cluster_slug = ? AND origin_document_slug = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(userId, clusterSlug, documentSlug) as DocumentSkillRow | undefined;
  return row ? toRecord(row) : null;
}

export function listSkills(userId: number): DocumentSkillRecord[] {
  const rows = db
    .prepare("SELECT * FROM document_skills WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as DocumentSkillRow[];
  return rows.map(toRecord);
}

/** Every ready skill, for the catalog source that lists them on the Skills page. */
export function listReadySkills(): DocumentSkillRecord[] {
  const rows = db
    .prepare("SELECT * FROM document_skills WHERE status = 'ready' ORDER BY updated_at DESC")
    .all() as DocumentSkillRow[];
  return rows.map(toRecord);
}

function uniqueSlug(base: string): string {
  const seed = base || "document";
  let candidate = seed;
  let counter = 2;
  while (db.prepare("SELECT 1 FROM document_skills WHERE slug = ?").get(candidate)) {
    candidate = `${seed}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export interface CreateSkillInput {
  userId: number;
  contentHash: string;
  title: string;
  author?: string | null;
  bookType: BookType;
  depth: SkillDepth;
  sourceTokens: number;
  origin: DocumentSkillOrigin;
}

/**
 * Claim a build. Returns the existing record when one is already present for
 * this content, so two chats attaching the same file cannot start two builds.
 */
export function createBuildingSkill(input: CreateSkillInput): DocumentSkillRecord {
  const existing = findSkillByHash(input.userId, input.contentHash);
  if (existing) return existing;

  const now = new Date().toISOString();
  const slug = uniqueSlug(slugifyTitle(input.title));
  db.prepare(
    `INSERT INTO document_skills (
       user_id, slug, content_hash, title, author, status, book_type, depth,
       chapter_count, source_tokens, origin_kind, origin_file_name,
       origin_cluster_slug, origin_document_slug, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'building', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    slug,
    input.contentHash,
    input.title,
    input.author ?? null,
    input.bookType,
    input.depth,
    input.sourceTokens,
    input.origin.kind,
    input.origin.fileName,
    input.origin.kind === "garden" ? input.origin.clusterSlug : null,
    input.origin.kind === "garden" ? input.origin.documentSlug : null,
    now,
    now,
  );
  const created = findSkillByHash(input.userId, input.contentHash);
  if (!created) throw new Error("document skill row could not be created");
  return created;
}

export function markSkillReady(id: number, chapterCount: number): void {
  db.prepare(
    "UPDATE document_skills SET status = 'ready', chapter_count = ?, error = NULL, updated_at = ? WHERE id = ?",
  ).run(chapterCount, new Date().toISOString(), id);
}

export function markSkillFailed(id: number, error: string): void {
  db.prepare("UPDATE document_skills SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(
    error.slice(0, 2000),
    new Date().toISOString(),
    id,
  );
}

/**
 * Re-open a failed or stale skill for building. Used when a build is retried,
 * so the row keeps its slug (and therefore any reference to it elsewhere).
 */
export function markSkillBuilding(id: number): void {
  db.prepare("UPDATE document_skills SET status = 'building', error = NULL, updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id,
  );
}

export function deleteSkill(userId: number, slug: string): boolean {
  const record = findSkillBySlug(userId, slug);
  if (!record) return false;
  db.prepare("DELETE FROM document_skills WHERE id = ?").run(record.id);
  fs.rmSync(skillDirectory(slug), { recursive: true, force: true });
  return true;
}

/**
 * Resolve a model-supplied file name inside a skill directory.
 * Returns null for anything that escapes the directory or is not markdown.
 */
export function skillFilePath(slug: string, relativePath: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const root = path.resolve(skillDirectory(slug));
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  if (path.extname(target).toLowerCase() !== ".md") return null;
  return target;
}

export function readSkillFile(slug: string, relativePath: string): string | null {
  const target = skillFilePath(slug, relativePath);
  if (!target || !fs.existsSync(target)) return null;
  return fs.readFileSync(target, "utf8");
}

export function writeSkillFile(slug: string, relativePath: string, content: string): void {
  const target = skillFilePath(slug, relativePath);
  if (!target) throw new Error(`Invalid skill file path: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const descriptor = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function listSkillFiles(slug: string): DocumentSkillFile[] {
  const root = skillDirectory(slug);
  if (!fs.existsSync(root)) return [];
  const files: DocumentSkillFile[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (path.extname(entry.name).toLowerCase() !== ".md") continue;
      files.push({
        path: path.relative(root, full).split(path.sep).join("/"),
        bytes: fs.statSync(full).size,
      });
    }
  };
  walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** The compact index injected into a turn: the skill's own SKILL.md body. */
export function readSkillIndex(slug: string): string | null {
  return readSkillFile(slug, "SKILL.md");
}
