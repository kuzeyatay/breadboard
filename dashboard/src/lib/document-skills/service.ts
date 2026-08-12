// The layer chats talk to: get me the skill for this document, and give me the
// block of prompt text that puts it in front of the model.
//
// Builds are deduplicated in-process by content hash. Attaching one PDF to two
// chats, or hitting send while the composer is still building, must not start a
// second distillation — the second caller joins the first build and sees the
// same progress.

import fs from "node:fs";
import path from "node:path";
import type { BuildSkillResult } from "./builder.ts";
import { CLONE_ONLY_EXTENSIONS, extractWithClone } from "./bridge.ts";
import { shouldDistill } from "./planning.ts";
import {
  documentContentHash,
  findSkillByHash,
  findSkillForGardenDocument,
  readSkillIndex,
  listSkillFiles,
} from "./store.ts";
import type { DocumentSkillOrigin, DocumentSkillProgress, DocumentSkillRecord } from "./types.ts";

interface ActiveBuild {
  promise: Promise<BuildSkillResult>;
  progress: DocumentSkillProgress;
  listeners: Set<(progress: DocumentSkillProgress) => void>;
}

const activeBuilds = new Map<string, ActiveBuild>();

function buildKey(userId: number, contentHash: string): string {
  return `${userId}:${contentHash}`;
}

export { shouldDistill };

export interface EnsureSkillInput {
  userId: number;
  text: string;
  title: string;
  origin: DocumentSkillOrigin;
  baseURL?: string;
  model?: string;
  onProgress?: (progress: DocumentSkillProgress) => void;
  signal?: AbortSignal;
}

/**
 * The skill for this document, building it if necessary and joining an
 * in-flight build if one exists.
 */
export async function ensureDocumentSkill(input: EnsureSkillInput): Promise<BuildSkillResult> {
  const contentHash = documentContentHash(input.text);
  const key = buildKey(input.userId, contentHash);

  const ready = findSkillByHash(input.userId, contentHash);
  if (ready?.status === "ready" && readSkillIndex(ready.slug)) {
    return { record: ready, cached: true, warnings: [] };
  }

  const existing = activeBuilds.get(key);
  if (existing) {
    if (input.onProgress) {
      input.onProgress(existing.progress);
      existing.listeners.add(input.onProgress);
    }
    try {
      return await existing.promise;
    } finally {
      if (input.onProgress) existing.listeners.delete(input.onProgress);
    }
  }

  const entry: ActiveBuild = {
    progress: { phase: "extracting", completed: 0, total: 1, message: "Preparing the document" },
    listeners: new Set(input.onProgress ? [input.onProgress] : []),
    promise: Promise.resolve() as unknown as Promise<BuildSkillResult>,
  };
  // Imported here rather than at module load: the builder reaches the ChatMock
  // client and everything behind it, and the turn path asks this module whether
  // a document needs distilling far more often than it needs one built.
  const { buildDocumentSkill } = await import("./builder.ts");
  entry.promise = buildDocumentSkill({
    userId: input.userId,
    text: input.text,
    title: input.title,
    origin: input.origin,
    baseURL: input.baseURL,
    model: input.model,
    signal: input.signal,
    onProgress: (progress) => {
      entry.progress = progress;
      for (const listener of entry.listeners) listener(progress);
    },
  }).finally(() => {
    activeBuilds.delete(key);
  });
  activeBuilds.set(key, entry);
  return entry.promise;
}

/** Progress of an in-flight build, for a client that reconnected to it. */
export function activeBuildProgress(userId: number, contentHash: string): DocumentSkillProgress | null {
  return activeBuilds.get(buildKey(userId, contentHash))?.progress ?? null;
}

/**
 * Read a garden source document's text off disk.
 *
 * Garden sources are markdown pages whose body is the extracted text of the
 * original upload, so the text is already there. Where the original file was
 * retained and is a format only the clone can parse, prefer re-reading it
 * through the clone — an EPUB read properly beats the flattened copy.
 */
export async function gardenDocumentText(
  contentPath: string,
  clusterSlug: string,
  relPath: string,
  body: string,
  sourceFile?: string,
): Promise<string> {
  if (sourceFile) {
    const extension = path.extname(sourceFile).toLowerCase().replace(".", "");
    if (CLONE_ONLY_EXTENSIONS.has(extension)) {
      const candidate = path.resolve(contentPath, clusterSlug, sourceFile);
      const root = path.resolve(contentPath, clusterSlug);
      if (candidate.startsWith(`${root}${path.sep}`) && fs.existsSync(candidate)) {
        const extracted = await extractWithClone(candidate);
        if (extracted?.text) return extracted.text;
      }
    }
  }
  void relPath;
  return body;
}

export function skillForGardenDocument(
  userId: number,
  clusterSlug: string,
  documentSlug: string,
): DocumentSkillRecord | null {
  const record = findSkillForGardenDocument(userId, clusterSlug, documentSlug);
  return record?.status === "ready" ? record : null;
}

/**
 * The prompt block for one or more built skills.
 *
 * It carries the whole SKILL.md — the frameworks, decision rules and section
 * index — and names the tool that opens everything else. That is the swap this
 * integration exists to make: a compact structured index in context, with the
 * document's detail one tool call away, instead of the raw document in context
 * and no structure at all.
 */
export function documentSkillContext(records: DocumentSkillRecord[]): string {
  const blocks = records.flatMap((record) => {
    const index = readSkillIndex(record.slug);
    if (!index) return [];
    const files = listSkillFiles(record.slug)
      .map((file) => file.path)
      .filter((file) => file !== "SKILL.md");
    return [
      [
        `<document_skill slug="${record.slug}" source=${JSON.stringify(record.origin.fileName)}>`,
        index.trim(),
        "",
        `Readable files: ${files.join(", ")}`,
        "</document_skill>",
      ].join("\n"),
    ];
  });
  if (blocks.length === 0) return "";

  return [
    "## Documents in play",
    "",
    "The user's document has been distilled into the structured skill(s) below — this index IS the document's structure, not a summary someone wrote about it.",
    "Answer from it. When the question needs detail the index does not carry, call `document_skill_read` with the skill slug and the file you want (for example `chapters/ch03-....md`, `glossary.md`, `cheatsheet.md`) and answer from what it returns.",
    "Read the sections the question actually needs — that is what they are for. Never answer a document question from memory or assumption when a file in the skill would settle it, and never claim the document says something you have not read.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}
