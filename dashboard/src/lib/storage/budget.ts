import type Database from "better-sqlite3";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { managedPath } from "./filesystem.ts";
import { ensureStorageSchema } from "./store.ts";

/**
 * What may be done to a file when the data folder is over its budget.
 * - content: the person's own work. Never removed; cold text may be compressed in place.
 * - regenerable: Breadboard can produce it again (built site, caches, raw simulation dumps).
 * - redownloadable: fetched from somewhere and fetchable again (models, source videos).
 * - capture: Recall's screen recording.
 */
export type StorageClass = "content" | "regenerable" | "redownloadable" | "capture";

export const DEFAULT_BUDGET_BYTES = 40 * 1024 ** 3;
export const MINIMUM_BUDGET_BYTES = 5 * 1024 ** 3;
/** A chat's working folder above this is reported to the person, in the chat and in Settings. */
export const CHAT_CAP_BYTES = 2 * 1024 ** 3;
const CHAT_LISTED_BYTES = 256 * 1024 ** 2;

// ponytail: a path table, not per-file provenance. A producer that writes
// regenerable data somewhere new stays "content" (the safe class) until it gets
// a line here; record provenance at write time if this list starts to sprawl.
const RULES: ReadonlyArray<readonly [RegExp, StorageClass]> = [
  [/^recall\//u, "capture"],
  [/^(?:quartz\/public|runtime-v2\/temp|runtime\/jobs|cache|runtime\/hermes\/cache)\//u, "regenerable"],
  [/^quartz\/\.breadboard-quartz-publish\.stage-/u, "regenerable"],
  [/^runtime\/hermes-workspaces\/.*\/multisim\/runs\/[^/]+\/(?:data\.(?:json|csv)|result\.raw)$/u, "regenerable"],
  // Copies made before quick questions stopped staging attachments; the upload store holds the original.
  [/^runtime\/hermes-workspaces\/.*-inline-[^/]+\/\.breadboard\/attachments\//u, "regenerable"],
  [/^(?:agent-runtime|humanizer\/models|runtime\/scriberr\/models|runtime\/colpali)\//u, "redownloadable"],
  [/^runtime\/hermes-workspaces\/.*\/source\.(?:mp4|webm|mkv|m4a|mp3)$/u, "redownloadable"],
];

export function classifyStoragePath(relative: string): StorageClass {
  const normalized = relative.replaceAll("\\", "/");
  return RULES.find(([pattern]) => pattern.test(normalized))?.[1] ?? "content";
}

const initialized = new WeakSet<Database.Database>();
function ensureBudgetSchema(db: Database.Database): void {
  if (initialized.has(db)) return;
  ensureStorageSchema(db);
  const columns = db.prepare("PRAGMA table_info(storage_settings)").all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === "budget_bytes"))
    db.exec(`ALTER TABLE storage_settings ADD COLUMN budget_bytes INTEGER NOT NULL DEFAULT ${DEFAULT_BUDGET_BYTES}`);
  db.exec(`CREATE TABLE IF NOT EXISTS storage_chat_usage(folder TEXT PRIMARY KEY, bytes INTEGER NOT NULL,
    removable_bytes INTEGER NOT NULL, measured_at INTEGER NOT NULL)`);
  initialized.add(db);
}

export function setStorageBudget(db: Database.Database, bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < MINIMUM_BUDGET_BYTES) throw new Error("Choose a storage budget of at least 5 GiB.");
  ensureBudgetSchema(db);
  db.prepare("UPDATE storage_settings SET budget_bytes=?,updated_at=? WHERE id=1").run(bytes, Date.now());
}

/** `usedBytes` is a lower bound until the scan completes, so "over" never flips on a guess. */
export function storageBudget(db: Database.Database, inventory: { allocatedBytes: number; classes?: Record<string, number> } | null) {
  ensureBudgetSchema(db);
  const { budget_bytes: budgetBytes } = db.prepare("SELECT budget_bytes FROM storage_settings WHERE id=1").get() as { budget_bytes: number };
  const usedBytes = inventory?.allocatedBytes ?? 0;
  return { budgetBytes, usedBytes, overBytes: Math.max(0, usedBytes - budgetBytes), over: usedBytes > budgetBytes, classes: inventory?.classes ?? {} };
}

/**
 * A chat's working folder is where its tools put files: downloads, simulation
 * output, renders. The chat's text lives in the database and is tiny; this is
 * what grows to gigabytes. The folder name is the chat's public id in lower case.
 */
export function chatFolderOf(relative: string): string | null {
  return /^runtime\/hermes-workspaces\/conversations\/([a-z0-9_-]{1,80})\//u.exec(relative.replaceAll("\\", "/"))?.[1] ?? null;
}

export type ChatUsage = Map<string, { bytes: number; removableBytes: number }>;

export function noteChatFile(usage: ChatUsage, relative: string, bytes: number): void {
  const folder = chatFolderOf(relative);
  if (!folder) return;
  const entry = usage.get(folder) ?? { bytes: 0, removableBytes: 0 };
  entry.bytes += bytes;
  if (classifyStoragePath(relative) !== "content") entry.removableBytes += bytes;
  usage.set(folder, entry);
}

/** Called when a scan completes: only then is "this chat is small" known. */
export function saveChatUsage(db: Database.Database, usage: ChatUsage, now = Date.now()): void {
  ensureBudgetSchema(db);
  const insert = db.prepare("INSERT INTO storage_chat_usage(folder,bytes,removable_bytes,measured_at) VALUES(?,?,?,?)");
  db.transaction(() => {
    db.prepare("DELETE FROM storage_chat_usage").run();
    for (const [folder, entry] of usage) if (entry.bytes >= CHAT_LISTED_BYTES) insert.run(folder, entry.bytes, entry.removableBytes, now);
  })();
}

export function largeChats(db: Database.Database) {
  ensureBudgetSchema(db);
  return (db.prepare(`SELECT u.folder, u.bytes, u.removable_bytes removableBytes,
      (SELECT c.title FROM conversations c WHERE lower(c.public_id)=u.folder LIMIT 1) title
    FROM storage_chat_usage u ORDER BY u.bytes DESC LIMIT 20`).all() as Array<{ folder: string; bytes: number; removableBytes: number; title: string | null }>)
    .map(row => ({ ...row, over: row.bytes > CHAT_CAP_BYTES }));
}

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

/** One instruction for the turn when this chat's folder is over the cap, otherwise nothing. */
export function chatWorkspaceNotice(db: Database.Database, conversationPublicId: string | null | undefined): string {
  if (!conversationPublicId) return "";
  ensureBudgetSchema(db);
  const row = db.prepare("SELECT bytes, removable_bytes removableBytes FROM storage_chat_usage WHERE folder=? AND bytes>?")
    .get(conversationPublicId.toLowerCase(), CHAT_CAP_BYTES) as { bytes: number; removableBytes: number } | undefined;
  if (!row) return "";
  return [
    "# chat_working_folder_size",
    `The files this chat's tools have saved take ${gib(row.bytes)} on the person's disk, above the ${gib(CHAT_CAP_BYTES)} limit for one chat.`,
    row.removableBytes > 0 ? `${gib(row.removableBytes)} of that is downloaded sources or raw dumps that can be fetched or produced again.` : "",
    "Tell the person this in one sentence at the start of your answer, and that Settings, Storage lists the chat with a button to remove what can be recreated.",
    "Do not download or generate further large files in this chat unless the person asks for them; when a tool can write one format, do not write three.",
  ].filter(Boolean).join("\n");
}

/**
 * Remove what can be recreated from one chat's folder. Only ever called from the
 * person's own click: nothing here runs on a schedule.
 */
export async function reclaimChatFolder(db: Database.Database, root: string, folder: string): Promise<{ filesRemoved: number; bytesReleased: number }> {
  if (!/^[a-z0-9_-]{1,80}$/u.test(folder)) throw new Error("Invalid chat reference.");
  ensureBudgetSchema(db);
  const base = path.join("runtime", "hermes-workspaces", "conversations", folder);
  let filesRemoved = 0, bytesReleased = 0;
  // ponytail: no lease against a run that is using the folder right now. A run
  // that loses its source video fails one step and says so; take the workspace
  // claim from workspace-storage.ts if that ever bites.
  const stack = [base];
  while (stack.length) {
    const relative = stack.pop()!;
    const directory = await fs.promises.opendir(await managedPath(root, relative));
    for await (const entry of directory) {
      const child = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { stack.push(child); continue; }
      if (!entry.isFile() || classifyStoragePath(child) === "content") continue;
      const target = await managedPath(root, child), stat = await fs.promises.lstat(target);
      if (stat.nlink !== 1) continue;
      await fs.promises.unlink(target);
      filesRemoved++; bytesReleased += stat.size;
    }
  }
  db.prepare("UPDATE storage_chat_usage SET bytes=MAX(0,bytes-?),removable_bytes=0 WHERE folder=?").run(bytesReleased, folder);
  return { filesRemoved, bytesReleased };
}
