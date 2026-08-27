// What Deep Tutor is allowed to read, decided from the surface it was called on.
//
// This module is the whole answer to "embedded in the Garden" versus "in the
// Terminal it can reach every file". A scope is two things:
//
//   roots       directories the tutor may list, read and search, live, through
//               Breadboard's MCP file server. Nothing outside them resolves.
//   attachments a small, eagerly-loaded selection handed to the turn up front,
//               so the first answer already knows what the material says
//               instead of spending a round discovering it.
//
// Garden Chat scopes to that Garden's directory: its notes, its folders, its
// assets. Nothing from another Garden and nothing from the repository at large.
// The Terminal scopes to the Breadboard workspace plus every folder the user
// has already granted Hermes read access to — reusing that consent rather than
// inventing a second permission model for the same question.
//
// Server-only: reads the filesystem and the grants table.

import type { Dirent } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { createFilesystemGrantStore } from "../hermes/filesystem-grants.ts";
import db from "../db.ts";

export type TutorScopeKind = "garden" | "workspace";

export interface TutorMaterialAttachment {
  path: string;
  filename: string;
  mimeType: string;
  bytes: number;
}

export interface TutorScope {
  kind: TutorScopeKind;
  /** Stable id used to key the tutoring home, so memory follows the scope. */
  id: string;
  /** How the scope is named to the learner and in the tool descriptions. */
  label: string;
  /** Directories the file server may serve. Already resolved and existing. */
  roots: string[];
  /** A sentence for the turn's preamble, so the model knows what it has. */
  summary: string;
}

/**
 * How much material is worth loading before the first model call. Past this the
 * tutor is better off searching: an over-stuffed context costs every later
 * round, while `search_materials` costs one tool call when it is actually
 * needed.
 */
const MAX_EAGER_FILES = 12;
const MAX_EAGER_BYTES = 400_000;
// A whole-course dump would eat the budget on its own and crowd out the
// focused notes that actually answer the question. It stays reachable through
// `read_material` and `search_materials`; it just does not ride along.
const MAX_SINGLE_FILE_BYTES = 150_000;

/** Extensions DeepTutor's own extractor can turn into text. */
const ATTACHABLE = new Map<string, string>([
  [".md", "text/markdown"],
  [".mdx", "text/markdown"],
  [".txt", "text/plain"],
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv"],
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".next-desktop",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "dist",
  "build",
  ".obsidian",
]);

function existingDirectory(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(candidate));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/** The Garden's own directory under the Quartz content root. */
export function gardenDirectory(clusterSlug: string): string | null {
  const contentPath = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (!contentPath) return null;
  const root = path.resolve(contentPath);
  const candidate = path.resolve(root, clusterSlug.trim());
  // Containment first: a slug is user input, and `..` in it must not walk out
  // of the content root even though callers have already checked ownership.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return existingDirectory(candidate);
}

export interface ScopeInput {
  userId: number;
  surface: "garden_chat" | "dashboard_terminal";
  /** Required for `garden_chat`. */
  clusterSlug?: string | null;
  /** The Garden's display name, when the caller knows it. */
  gardenName?: string | null;
}

/**
 * Resolve the surface into the material the tutor may see.
 *
 * A Garden with no directory yet is still a valid scope — it simply has no
 * roots, and the tutor is told so rather than being pointed at the workspace.
 * Silently widening the scope would be the worst possible failure here.
 */
export function resolveScope(input: ScopeInput): TutorScope {
  if (input.surface === "garden_chat") {
    const slug = (input.clusterSlug ?? "").trim();
    const directory = slug ? gardenDirectory(slug) : null;
    const label = input.gardenName?.trim() || slug || "this Garden";
    return {
      kind: "garden",
      id: `garden-${slug || "unknown"}`,
      label,
      roots: directory ? [directory] : [],
      summary: directory
        ? `You are tutoring inside the "${label}" Garden. Its notes and files are your material — read them with list_materials, read_material and search_materials before answering, and ground what you say in what they actually say.`
        : `You are tutoring inside the "${label}" Garden, which has no files on disk yet. Answer from the conversation and say plainly when something is not written down anywhere.`,
    };
  }

  const roots: string[] = [];
  const workspace = existingDirectory(repositoryRoot());
  if (workspace) roots.push(workspace);
  for (const granted of grantedReadRoots(input.userId)) {
    if (!roots.some((root) => granted === root || granted.startsWith(root + path.sep))) {
      roots.push(granted);
    }
  }
  return {
    kind: "workspace",
    id: "workspace",
    label: "your workspace",
    roots,
    summary:
      roots.length > 1
        ? "You are tutoring in the Terminal. The whole Breadboard workspace and every folder the user has granted access to are your material — use list_materials, read_material and search_materials to find what a question is about before answering."
        : "You are tutoring in the Terminal. The whole Breadboard workspace is your material — use list_materials, read_material and search_materials to find what a question is about before answering.",
  };
}

/** Folders the user already let Hermes read. Read-only ones are enough here. */
function grantedReadRoots(userId: number): string[] {
  try {
    const store = createFilesystemGrantStore(db);
    return store
      .list(userId)
      .filter((grant) => grant.permissions.read)
      .map((grant) => existingDirectory(grant.canonicalPath))
      .filter((value): value is string => Boolean(value));
  } catch {
    // No grants table, no grants — the workspace root still stands.
    return [];
  }
}

/**
 * Pick the files worth putting in front of the model before it thinks.
 *
 * Relevance is lexical on purpose: there is no embedding provider behind
 * ChatMock, so a vector store would be a dependency with nothing to fill it.
 * Scoring words from the question against the file's name and its opening text
 * is cheap, explainable, and good enough to seed a turn — anything it misses,
 * the tutor can still find with `search_materials`.
 */
export function selectEagerMaterial(
  scope: TutorScope,
  question: string,
  options: { maxFiles?: number; maxBytes?: number } = {},
): TutorMaterialAttachment[] {
  if (!scope.roots.length) return [];
  const maxFiles = options.maxFiles ?? MAX_EAGER_FILES;
  const maxBytes = options.maxBytes ?? MAX_EAGER_BYTES;
  const terms = questionTerms(question);
  const candidates: Array<TutorMaterialAttachment & { score: number }> = [];

  for (const root of scope.roots) {
    // The workspace root is enormous and mostly code; eager loading there would
    // be guesswork at great expense. The Terminal tutor reads on demand.
    if (scope.kind !== "garden") break;
    walk(root, root, 0, (file, size) => {
      const extension = path.extname(file).toLowerCase();
      const mimeType = ATTACHABLE.get(extension);
      if (!mimeType || size > MAX_SINGLE_FILE_BYTES) return;
      candidates.push({
        path: file,
        filename: path.relative(root, file).split(path.sep).join("/"),
        mimeType,
        bytes: size,
        score: scoreFile(file, extension, terms),
      });
    });
  }

  candidates.sort((left, right) => right.score - left.score || left.bytes - right.bytes);

  const picked: TutorMaterialAttachment[] = [];
  let budget = maxBytes;
  for (const candidate of candidates) {
    if (picked.length >= maxFiles) break;
    // A file nothing in the question points at is only worth loading while the
    // selection is still thin — otherwise it is noise with a token price.
    if (candidate.score <= 0 && picked.length >= 4) continue;
    if (candidate.bytes > budget) continue;
    budget -= candidate.bytes;
    const { score: _score, ...attachment } = candidate;
    picked.push(attachment);
  }
  return picked;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "how", "what",
  "why", "when", "where", "which", "who", "can", "could", "should", "would",
  "explain", "tell", "me", "my", "this", "that", "these", "those", "it", "its",
  "about", "from", "into", "please", "help", "using", "use", "make", "give",
]);

function questionTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
    ),
  ].slice(0, 24);
}

/**
 * A file's claim on the turn. The name counts for more than the body: a note
 * called `fourier-series-coefficients.md` is about Fourier series in a way a
 * passing mention halfway down another page is not.
 *
 * The body is read through `prose`, and a term has to appear more than once to
 * count. Both rules exist because of what a Garden note actually looks like:
 * every page in a generated Garden carries frontmatter and a `Source:
 * [[whole-course-notes|Everything About Sampling, Aliasing and Filters]]`
 * backlink, so a single shared link title otherwise made every page in the
 * Garden look like a match for every question asked of it.
 */
function scoreFile(file: string, extension: string, terms: string[]): number {
  if (!terms.length) return 0;
  const name = path.basename(file, extension).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 8;
  }
  if (extension !== ".md" && extension !== ".mdx" && extension !== ".txt") return score;

  let head = "";
  try {
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(8192);
      const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return score;
  }

  const { title, body } = splitFrontmatter(head);
  const titleWords = title.toLowerCase();
  for (const term of terms) {
    if (titleWords.includes(term)) score += 6;
  }
  const text = prose(body);
  for (const term of terms) {
    const occurrences = countOccurrences(text, term);
    if (occurrences > 1) score += Math.min(occurrences, 4);
  }
  return score;
}

/** The note's declared title, and everything after the frontmatter block. */
function splitFrontmatter(text: string): { title: string; body: string } {
  if (!text.startsWith("---")) return { title: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { title: "", body: text };
  const front = text.slice(3, end);
  const body = text.slice(end + 4);
  const title = /^\s*title:\s*"?([^"\n]+)"?/m.exec(front)?.[1] ?? "";
  return { title: title.trim(), body };
}

/**
 * The note's own words, with link machinery removed. A wikilink's target and
 * label are somebody else's title, not this page's subject.
 */
function prose(body: string): string {
  return body
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\s*(?:source|locations|related|tags)\s*:.*$/gim, " ")
    .toLowerCase();
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0 && count < 8) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function walk(
  directory: string,
  root: string,
  depth: number,
  visit: (file: string, size: number) => void,
): void {
  if (depth > 6) return;
  let entries: Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, root, depth + 1, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      visit(full, fs.statSync(full).size);
    } catch {
      // Vanished between readdir and stat.
    }
  }
}
