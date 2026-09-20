/** Journaled Garden writes and crash recovery, without the ingestion/model graph. */
import type { Dirent } from "node:fs";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  acquireGardenMutationLease,
  INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
  isGardenMutationBusyError,
  type GardenMutationLease,
} from "./garden-mutation-lease-core.ts";

const KNOWLEDGE_TRANSACTION_VERSION = 1;
const MAX_KNOWLEDGE_TRANSACTION_ENTRIES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES = 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES = 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES = 512 * 1024 * 1024;
const MAX_KNOWLEDGE_TRANSACTION_PATH_BYTES = 4096;
const MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES = 4096;
const MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES = 8192;
const KNOWLEDGE_TRANSACTION_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
export const KNOWLEDGE_TRANSACTION_SHA256 = /^[a-f0-9]{64}$/;
const KNOWLEDGE_TRANSACTION_LOCK_FILE = ".active.lock";
const KNOWLEDGE_COMMIT_TOMBSTONE_FILE = "ingestion-commit.json";
const KNOWLEDGE_TRANSACTION_INITIALIZING_DIRECTORY =
  /^\.initializing\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{32})$/;
const KNOWLEDGE_TRANSACTION_CLEANUP_DIRECTORY =
  /^\.cleanup\.(committed|rolled-back)\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{32})$/;

type KnowledgeTransactionState =
  | "active"
  | "result-pending"
  | "committed"
  | "reconciling";

interface KnowledgeAbsentSnapshot {
  kind: "absent";
}

interface KnowledgeFileBackupSnapshot {
  kind: "file";
  backupName: string;
  sizeBytes: number;
  sha256: string;
  mode: number;
}

interface KnowledgeJournalEntry {
  relativePath: string;
  original: KnowledgeAbsentSnapshot | KnowledgeFileBackupSnapshot;
}

interface KnowledgeTransactionJournal {
  version: 1;
  transactionId: string;
  ownerPid: number;
  clusterPathSha256: string;
  state: KnowledgeTransactionState;
  entries: KnowledgeJournalEntry[];
  createdDirectories: string[];
  resultSha256?: string;
  replacementResultSha256?: string;
}

interface KnowledgeTransactionRegistryLock {
  version: 1;
  transactionId: string;
  ownerPid: number;
  token: string;
}

interface HeldKnowledgeTransactionRegistryLock {
  descriptor: number;
  filePath: string;
  value: KnowledgeTransactionRegistryLock;
}

interface KnowledgeCommitTombstone {
  version: 1;
  transactionId: string;
  clusterPathSha256: string;
  state: "committed" | "reconciling";
  resultSha256: string;
  replacementResultSha256?: string;
}

export interface KnowledgeWriteTransactionOptions {
  registryRoot: string;
  transactionId: string;
  resultPath: string;
  retainCommittedJournal?: boolean;
}

export interface KnowledgeWriteRecovery {
  transactionId: string;
  outcome: "rolled-back" | "committed";
  transaction?: KnowledgeWriteTransaction;
}

export interface KnowledgeWriteTransaction {
  captureFile(filePath: string): void;
  recordCreatedDirectory(directoryPath: string): void;
  prepareResult(expectedSha256: string): void;
  prepareResultReplacement(expectedSha256: string): void;
  readCommittedResult(): Buffer;
  commit(): void;
  seal(): void;
  finalize(): void;
  rollback(): void;
}

function normalizedKnowledgePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameDirectKnowledgePath(left: string, right: string): boolean {
  // Rust supplies Windows namespace paths, while Node realpath can omit that
  // prefix. Compare both in namespace form (including UNC shares), without
  // resolving links or changing the persisted transaction/registry hashes.
  return normalizedKnowledgePath(path.toNamespacedPath(left)) ===
    normalizedKnowledgePath(path.toNamespacedPath(right));
}

function knowledgeClusterPathSha256(clusterDir: string): string {
  return createHash("sha256")
    .update(normalizedKnowledgePath(clusterDir), "utf8")
    .digest("hex");
}

export function fsyncKnowledgeDirectory(directoryPath: string): void {
  // Windows does not provide a reliable directory fsync primitive. Opening a
  // directory and calling FlushFileBuffers can block indefinitely on some
  // filesystems and antivirus/filter-driver combinations instead of returning
  // EACCES/EINVAL/EPERM. Each knowledge file is already fsynced before its
  // atomic rename, so skip the unsupported parent-directory flush on Windows.
  if (process.platform === "win32") return;

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function fsyncKnowledgeFile(filePath: string): void {
  // Atomic knowledge writes on Windows flush the temporary file handle before
  // renaming it. Reopening the renamed file solely to call FlushFileBuffers is
  // redundant and can block indefinitely behind filesystem filter drivers.
  // Other platforms keep the post-rename fsync below.
  if (process.platform === "win32") return;

  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Knowledge transaction durable file is not regular.");
  }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "r");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertDirectKnowledgeDirectory(
  directoryPath: string,
  label: string,
): void {
  const resolved = path.resolve(directoryPath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a direct directory.`);
  }
  const real = fs.realpathSync.native(resolved);
  if (!sameDirectKnowledgePath(real, resolved)) {
    // Name both paths. The bare message cannot be acted on: it does not say
    // which directory was indirect, nor what it resolved to, so a caller sees
    // only that a write was refused (2026-09-17, saving a link to a garden).
    // The two spellings distinguish the cases that matter - a junction or
    // symlink somewhere above the garden, versus a short 8.3 path or other
    // benign alias that realpath expands.
    throw new Error(
      `${label} contains an indirect path: ${resolved} resolves to ${real}.`,
    );
  }
}

function readBoundedKnowledgeDirectoryEntries(
  directoryPath: string,
  maximumEntries: number,
  label: string,
  ignoredName?: string,
) {
  const directory = fs.opendirSync(directoryPath);
  const entries: Dirent[] = [];
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (entry.name === ignoredName) continue;
      if (entries.length >= maximumEntries) {
        throw new Error(`${label} exceeded its bound.`);
      }
      entries.push(entry);
    }
    return entries;
  } finally {
    directory.closeSync();
  }
}

function knowledgeInitializationDirectory(
  registryRoot: string,
  transactionId: string,
): string {
  return path.join(
    registryRoot,
    `.initializing.${transactionId}.${randomBytes(16).toString("hex")}`,
  );
}

function knowledgeCleanupDirectory(
  registryRoot: string,
  transactionId: string,
  outcome: "committed" | "rolled-back",
): string {
  return path.join(
    registryRoot,
    `.cleanup.${outcome}.${transactionId}.${randomBytes(16).toString("hex")}`,
  );
}

function removeKnowledgeTransactionDirectory(
  registryRoot: string,
  transactionDir: string,
  transactionId: string,
  outcome: "committed" | "rolled-back",
): void {
  const cleanupDirectory = knowledgeCleanupDirectory(
    registryRoot,
    transactionId,
    outcome,
  );
  fs.renameSync(transactionDir, cleanupDirectory);
  fsyncKnowledgeDirectory(registryRoot);
  fs.rmSync(cleanupDirectory, { recursive: true, force: true });
  fsyncKnowledgeDirectory(registryRoot);
}

function removeKnowledgeTransactionDebris(
  registryRoot: string,
  entry: Dirent,
): boolean {
  if (
    !KNOWLEDGE_TRANSACTION_INITIALIZING_DIRECTORY.test(entry.name) &&
    !KNOWLEDGE_TRANSACTION_CLEANUP_DIRECTORY.test(entry.name)
  ) {
    return false;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(
      "Knowledge transaction registry contains invalid recovery debris.",
    );
  }
  const debrisPath = path.join(registryRoot, entry.name);
  assertDirectKnowledgeDirectory(
    debrisPath,
    "Knowledge transaction recovery debris",
  );
  fs.rmSync(debrisPath, { recursive: true, force: true });
  fsyncKnowledgeDirectory(registryRoot);
  return true;
}

export function hashKnowledgeFile(filePath: string): {
  sizeBytes: number;
  sha256: string;
} {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Knowledge transaction data is not a regular file.");
  }
  if (
    !sameDirectKnowledgePath(fs.realpathSync.native(filePath), filePath)
  ) {
    throw new Error("Knowledge transaction data contains an indirect path.");
  }
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== metadata.size) {
      throw new Error(
        "Knowledge transaction data changed while it was opened.",
      );
    }
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, opened.size - offset),
        offset,
      );
      if (read < 1) {
        throw new Error(
          "Knowledge transaction data ended before its declared size.",
        );
      }
      digest.update(chunk.subarray(0, read));
      offset += read;
    }
    const checked = fs.fstatSync(descriptor);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      throw new Error("Knowledge transaction data changed while it was read.");
    }
    return { sizeBytes: opened.size, sha256: digest.digest("hex") };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateKnowledgeRelativePath(
  value: unknown,
  allowRoot = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowRoot && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > MAX_KNOWLEDGE_TRANSACTION_PATH_BYTES ||
    value.includes("\\") ||
    path.isAbsolute(value)
  ) {
    throw new Error("Knowledge transaction journal contains an invalid path.");
  }
  const segments = value === "" ? [] : value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Knowledge transaction journal contains an invalid path.");
  }
  return value;
}

function validateKnowledgeJournal(
  value: unknown,
  transactionId: string,
): KnowledgeTransactionJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Knowledge transaction journal is invalid.");
  }
  const journal = value as Record<string, unknown>;
  const keys = Object.keys(journal).sort();
  const required = [
    "clusterPathSha256",
    "createdDirectories",
    "entries",
    "ownerPid",
    "state",
    "transactionId",
    "version",
  ];
  const optional = ["replacementResultSha256", "resultSha256"];
  if (
    keys.some((key) => !required.includes(key) && !optional.includes(key)) ||
    required.some((key) => !keys.includes(key)) ||
    journal.version !== KNOWLEDGE_TRANSACTION_VERSION ||
    journal.transactionId !== transactionId ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId) ||
    typeof journal.clusterPathSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(journal.clusterPathSha256) ||
    !["active", "result-pending", "committed", "reconciling"].includes(
      String(journal.state),
    ) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length > MAX_KNOWLEDGE_TRANSACTION_ENTRIES ||
    !Array.isArray(journal.createdDirectories) ||
    journal.createdDirectories.length > MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES ||
    !Number.isSafeInteger(journal.ownerPid) ||
    Number(journal.ownerPid) < 1
  ) {
    throw new Error("Knowledge transaction journal is invalid.");
  }

  const seenPaths = new Set<string>();
  const entries = journal.entries.map((raw, index): KnowledgeJournalEntry => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Knowledge transaction journal entry is invalid.");
    }
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).sort().join("\0") !== "original\0relativePath") {
      throw new Error("Knowledge transaction journal entry is invalid.");
    }
    const relativePath = validateKnowledgeRelativePath(entry.relativePath);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (seenPaths.has(key)) {
      throw new Error(
        "Knowledge transaction journal contains a duplicate path.",
      );
    }
    seenPaths.add(key);
    if (
      entry.original === null ||
      typeof entry.original !== "object" ||
      Array.isArray(entry.original)
    ) {
      throw new Error("Knowledge transaction snapshot is invalid.");
    }
    const original = entry.original as Record<string, unknown>;
    if (original.kind === "absent" && Object.keys(original).length === 1) {
      return { relativePath, original: { kind: "absent" } };
    }
    const expectedBackupName = `${String(index).padStart(6, "0")}.snapshot`;
    if (
      original.kind !== "file" ||
      Object.keys(original).sort().join("\0") !==
        "backupName\0kind\0mode\0sha256\0sizeBytes" ||
      original.backupName !== expectedBackupName ||
      !Number.isSafeInteger(original.sizeBytes) ||
      Number(original.sizeBytes) < 0 ||
      Number(original.sizeBytes) > MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES ||
      typeof original.sha256 !== "string" ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(original.sha256) ||
      !Number.isSafeInteger(original.mode) ||
      Number(original.mode) < 0 ||
      Number(original.mode) > 0o777
    ) {
      throw new Error("Knowledge transaction snapshot is invalid.");
    }
    return {
      relativePath,
      original: {
        kind: "file",
        backupName: expectedBackupName,
        sizeBytes: Number(original.sizeBytes),
        sha256: original.sha256,
        mode: Number(original.mode),
      },
    };
  });
  const retainedBackupBytes = entries.reduce(
    (total, entry) =>
      total + (entry.original.kind === "file" ? entry.original.sizeBytes : 0),
    0,
  );
  if (
    !Number.isSafeInteger(retainedBackupBytes) ||
    retainedBackupBytes > MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES
  ) {
    throw new Error("Knowledge transaction backup bytes exceeded their bound.");
  }

  const seenDirectories = new Set<string>();
  const createdDirectories = journal.createdDirectories.map((raw) => {
    const relativePath = validateKnowledgeRelativePath(raw, true);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (seenDirectories.has(key)) {
      throw new Error(
        "Knowledge transaction journal contains a duplicate directory.",
      );
    }
    seenDirectories.add(key);
    return relativePath;
  });

  const state = journal.state as KnowledgeTransactionState;
  const resultSha256 = journal.resultSha256;
  const replacementResultSha256 = journal.replacementResultSha256;
  if (
    (state === "active") !== (resultSha256 === undefined) ||
    (resultSha256 !== undefined &&
      (typeof resultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(resultSha256))) ||
    (state === "reconciling") !== (replacementResultSha256 !== undefined) ||
    (replacementResultSha256 !== undefined &&
      (typeof replacementResultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(replacementResultSha256)))
  ) {
    throw new Error("Knowledge transaction result decision is invalid.");
  }
  return {
    version: 1,
    transactionId,
    ownerPid: Number(journal.ownerPid),
    clusterPathSha256: journal.clusterPathSha256,
    state,
    entries,
    createdDirectories,
    ...(resultSha256 === undefined ? {} : { resultSha256 }),
    ...(replacementResultSha256 === undefined
      ? {}
      : { replacementResultSha256 }),
  };
}

let knowledgeJournalWriteSequence = 0;

function writeKnowledgeJournal(
  transactionDir: string,
  journal: KnowledgeTransactionJournal,
): void {
  const bytes = Buffer.from(`${JSON.stringify(journal)}\n`, "utf8");
  if (bytes.byteLength > MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES) {
    throw new Error("Knowledge transaction journal exceeded its bound.");
  }
  const journalPath = path.join(transactionDir, "journal.json");
  const temporaryPath = path.join(
    transactionDir,
    `.journal.pending.${process.pid}.${knowledgeJournalWriteSequence++}`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, journalPath);
    fsyncKnowledgeFile(journalPath);
    fsyncKnowledgeDirectory(transactionDir);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readKnowledgeJournal(
  transactionDir: string,
  transactionId: string,
): KnowledgeTransactionJournal {
  const journalPath = path.join(transactionDir, "journal.json");
  const metadata = fs.lstatSync(journalPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_KNOWLEDGE_TRANSACTION_JOURNAL_BYTES
  ) {
    throw new Error(
      "Knowledge transaction journal is unavailable or unbounded.",
    );
  }
  const bytes = fs.readFileSync(journalPath);
  if (bytes.byteLength !== metadata.size) {
    throw new Error("Knowledge transaction journal changed while it was read.");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Knowledge transaction journal is not valid JSON.");
  }
  return validateKnowledgeJournal(value, transactionId);
}

function processIsAliveForKnowledgeTransaction(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      String(error.code) === "EPERM"
    );
  }
}

function parseKnowledgeRegistryLock(
  value: unknown,
): KnowledgeTransactionRegistryLock {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !==
      "ownerPid\0token\0transactionId\0version"
  ) {
    throw new Error("Knowledge transaction registry lock is invalid.");
  }
  const lock = value as Record<string, unknown>;
  if (
    lock.version !== 1 ||
    typeof lock.transactionId !== "string" ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(lock.transactionId) ||
    !Number.isSafeInteger(lock.ownerPid) ||
    Number(lock.ownerPid) < 1 ||
    typeof lock.token !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(lock.token)
  ) {
    throw new Error("Knowledge transaction registry lock is invalid.");
  }
  return {
    version: 1,
    transactionId: lock.transactionId,
    ownerPid: Number(lock.ownerPid),
    token: lock.token,
  };
}

function readBoundedKnowledgeJson(
  filePath: string,
  maximumBytes: number,
): unknown {
  const metadata = fs.lstatSync(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error("Knowledge transaction durable metadata is invalid.");
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength !== metadata.size) {
    throw new Error(
      "Knowledge transaction durable metadata changed while read.",
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(
      "Knowledge transaction durable metadata is not valid JSON.",
    );
  }
}

function acquireKnowledgeRegistryLock(
  registryRoot: string,
  transactionId: string,
): HeldKnowledgeTransactionRegistryLock {
  const filePath = path.join(registryRoot, KNOWLEDGE_TRANSACTION_LOCK_FILE);
  const value: KnowledgeTransactionRegistryLock = {
    version: 1,
    transactionId,
    ownerPid: process.pid,
    token: randomBytes(32).toString("hex"),
  };
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fsyncKnowledgeDirectory(registryRoot);
    return { descriptor, filePath, value };
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      try {
        fs.rmSync(filePath);
      } catch {
        // A conflicting owner is diagnosed by recovery on the next attempt.
      }
    }
    throw error;
  }
}

function releaseKnowledgeRegistryLock(
  registryRoot: string,
  held: HeldKnowledgeTransactionRegistryLock | null,
): void {
  if (!held) return;
  fs.closeSync(held.descriptor);
  const current = parseKnowledgeRegistryLock(
    readBoundedKnowledgeJson(
      held.filePath,
      MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES,
    ),
  );
  if (
    current.token !== held.value.token ||
    current.ownerPid !== held.value.ownerPid ||
    current.transactionId !== held.value.transactionId
  ) {
    throw new Error("Knowledge transaction registry lock ownership changed.");
  }
  fs.rmSync(held.filePath);
  fsyncKnowledgeDirectory(registryRoot);
}

function clearStaleKnowledgeRegistryLock(registryRoot: string): void {
  const filePath = path.join(registryRoot, KNOWLEDGE_TRANSACTION_LOCK_FILE);
  if (!fs.existsSync(filePath)) return;
  const lock = parseKnowledgeRegistryLock(
    readBoundedKnowledgeJson(filePath, MAX_KNOWLEDGE_TRANSACTION_LOCK_BYTES),
  );
  if (processIsAliveForKnowledgeTransaction(lock.ownerPid)) {
    throw new Error("A live ingestion transaction already owns this garden.");
  }
  fs.rmSync(filePath);
  fsyncKnowledgeDirectory(registryRoot);
}

function validateKnowledgeCommitTombstone(
  value: unknown,
  transactionId: string,
): KnowledgeCommitTombstone {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Knowledge commit tombstone is invalid.");
  }
  const tombstone = value as Record<string, unknown>;
  const keys = Object.keys(tombstone).sort();
  const required = [
    "clusterPathSha256",
    "resultSha256",
    "state",
    "transactionId",
    "version",
  ];
  if (
    keys.some(
      (key) => !required.includes(key) && key !== "replacementResultSha256",
    ) ||
    required.some((key) => !keys.includes(key)) ||
    tombstone.version !== 1 ||
    tombstone.transactionId !== transactionId ||
    !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId) ||
    typeof tombstone.clusterPathSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.clusterPathSha256) ||
    !["committed", "reconciling"].includes(String(tombstone.state)) ||
    typeof tombstone.resultSha256 !== "string" ||
    !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.resultSha256) ||
    (tombstone.state === "reconciling") !==
      (tombstone.replacementResultSha256 !== undefined) ||
    (tombstone.replacementResultSha256 !== undefined &&
      (typeof tombstone.replacementResultSha256 !== "string" ||
        !KNOWLEDGE_TRANSACTION_SHA256.test(tombstone.replacementResultSha256)))
  ) {
    throw new Error("Knowledge commit tombstone is invalid.");
  }
  return {
    version: 1,
    transactionId,
    clusterPathSha256: tombstone.clusterPathSha256,
    state: tombstone.state as "committed" | "reconciling",
    resultSha256: tombstone.resultSha256,
    ...(tombstone.replacementResultSha256 === undefined
      ? {}
      : { replacementResultSha256: tombstone.replacementResultSha256 }),
  };
}

let knowledgeTombstoneWriteSequence = 0;

function knowledgeCommitTombstonePath(resultPath: string): string {
  return path.join(path.dirname(resultPath), KNOWLEDGE_COMMIT_TOMBSTONE_FILE);
}

function writeKnowledgeCommitTombstone(
  resultPath: string,
  tombstone: KnowledgeCommitTombstone,
): void {
  const filePath = knowledgeCommitTombstonePath(resultPath);
  const bytes = Buffer.from(`${JSON.stringify(tombstone)}\n`, "utf8");
  if (bytes.byteLength > MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES) {
    throw new Error("Knowledge commit tombstone exceeded its bound.");
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.ingestion-commit.pending.${process.pid}.${knowledgeTombstoneWriteSequence++}`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readKnowledgeCommitTombstone(
  resultPath: string,
  transactionId: string,
): KnowledgeCommitTombstone {
  return validateKnowledgeCommitTombstone(
    readBoundedKnowledgeJson(
      knowledgeCommitTombstonePath(resultPath),
      MAX_KNOWLEDGE_COMMIT_TOMBSTONE_BYTES,
    ),
    transactionId,
  );
}

function createKnowledgeBackup(
  sourcePath: string,
  backupPath: string,
  maximumBytes: number,
): { sizeBytes: number; sha256: string; mode: number } {
  const sourceMetadata = fs.lstatSync(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error("Knowledge write target is not a regular file.");
  }
  const source = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  const temporaryPath = `${backupPath}.pending.${process.pid}`;
  let destination: number | undefined;
  try {
    const opened = fs.fstatSync(source);
    if (
      !opened.isFile() ||
      opened.size !== sourceMetadata.size ||
      opened.size > maximumBytes
    ) {
      if (opened.size > maximumBytes) {
        throw new Error(
          "Knowledge transaction backup bytes exceeded their bound.",
        );
      }
      throw new Error("Knowledge write target changed while it was opened.");
    }
    destination = fs.openSync(temporaryPath, "wx", 0o600);
    const digest = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < opened.size) {
      const read = fs.readSync(
        source,
        chunk,
        0,
        Math.min(chunk.byteLength, opened.size - offset),
        offset,
      );
      if (read < 1)
        throw new Error("Knowledge write target ended during backup.");
      fs.writeSync(destination, chunk, 0, read);
      digest.update(chunk.subarray(0, read));
      offset += read;
    }
    fs.fsyncSync(destination);
    fs.closeSync(destination);
    destination = undefined;
    const checked = fs.fstatSync(source);
    if (checked.size !== opened.size || checked.mtimeMs !== opened.mtimeMs) {
      throw new Error("Knowledge write target changed during backup.");
    }
    fs.renameSync(temporaryPath, backupPath);
    fsyncKnowledgeFile(backupPath);
    fsyncKnowledgeDirectory(path.dirname(backupPath));
    return {
      sizeBytes: opened.size,
      sha256: digest.digest("hex"),
      mode: opened.mode & 0o777,
    };
  } catch (error) {
    if (destination !== undefined) fs.closeSync(destination);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    fs.closeSync(source);
  }
}

let knowledgeRollbackRestoreSequence = 0;

function restoreKnowledgeSnapshot(
  backupPath: string,
  filePath: string,
  snapshot: KnowledgeFileBackupSnapshot,
): void {
  const backup = hashKnowledgeFile(backupPath);
  if (
    backup.sizeBytes !== snapshot.sizeBytes ||
    backup.sha256 !== snapshot.sha256
  ) {
    throw new Error("Knowledge rollback backup failed its integrity check.");
  }
  const temporaryPath = `${filePath}.rollback.${process.pid}.${knowledgeRollbackRestoreSequence++}`;
  let descriptor: number | undefined;
  try {
    if (fs.existsSync(temporaryPath)) {
      const stale = fs.lstatSync(temporaryPath);
      if (!stale.isFile() || stale.isSymbolicLink()) {
        throw new Error("Knowledge rollback temporary path is indirect.");
      }
      fs.rmSync(temporaryPath);
    }
    fs.copyFileSync(backupPath, temporaryPath, fs.constants.COPYFILE_EXCL);
    descriptor = fs.openSync(temporaryPath, "r+");
    fs.chmodSync(temporaryPath, snapshot.mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncKnowledgeFile(filePath);
    fsyncKnowledgeDirectory(path.dirname(filePath));
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function assertActiveGardenMutationLease(lease: GardenMutationLease): void {
  const processBoundExpiry = Date.parse(lease.lock.processBoundExpiresAt ?? "");
  if (
    lease.lost ||
    (Number.isFinite(processBoundExpiry) && Date.now() >= processBoundExpiry)
  ) {
    throw new Error("Knowledge transaction lost its Garden mutation lease.");
  }
}

function isLiveKnowledgeTransactionConflict(error: unknown): boolean {
  return (
    isGardenMutationBusyError(error) &&
    error.conflict.jobId.startsWith("mutation:document-ingestion:")
  );
}

function liveKnowledgeTransactionError(message: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "EEXIST";
  return error;
}

class DiskBackedKnowledgeWriteTransaction implements KnowledgeWriteTransaction {
  private readonly clusterDir: string;
  private readonly registryRoot: string;
  private readonly transactionDir: string;
  private readonly backupDir: string;
  private readonly resultPath: string;
  private readonly retainCommittedJournal: boolean;
  private journal: KnowledgeTransactionJournal;
  private registryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  private gardenMutationLease: GardenMutationLease | null = null;
  private readonly assertExternalGardenMutationLease?: () => void;
  private finalized = false;

  constructor(
    clusterDir: string,
    options: KnowledgeWriteTransactionOptions,
    existingJournal?: KnowledgeTransactionJournal,
    assertExternalGardenMutationLease?: () => void,
  ) {
    this.clusterDir = path.resolve(clusterDir);
    this.registryRoot = path.resolve(options.registryRoot);
    this.transactionDir = path.join(this.registryRoot, options.transactionId);
    this.backupDir = path.join(this.transactionDir, "backups");
    this.resultPath = path.resolve(options.resultPath);
    this.retainCommittedJournal = options.retainCommittedJournal ?? true;
    this.assertExternalGardenMutationLease = assertExternalGardenMutationLease;
    if (!KNOWLEDGE_TRANSACTION_IDENTIFIER.test(options.transactionId)) {
      throw new Error("Knowledge transaction identity is invalid.");
    }
    if (fs.existsSync(this.clusterDir)) {
      assertDirectKnowledgeDirectory(
        this.clusterDir,
        "Knowledge transaction garden directory",
      );
    } else {
      let existingAncestor = path.dirname(this.clusterDir);
      while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) break;
        existingAncestor = parent;
      }
      assertDirectKnowledgeDirectory(
        existingAncestor,
        "Knowledge transaction garden ancestor",
      );
    }
    assertDirectKnowledgeDirectory(
      path.dirname(this.resultPath),
      "Knowledge transaction result directory",
    );
    if (existingJournal) {
      assertDirectKnowledgeDirectory(
        this.transactionDir,
        "Knowledge transaction directory",
      );
      assertDirectKnowledgeDirectory(
        this.backupDir,
        "Knowledge transaction backup directory",
      );
      this.journal = existingJournal;
      return;
    }
    try {
      this.gardenMutationLease = acquireGardenMutationLease(
        this.clusterDir,
        "document-ingestion",
        {
          ownerId: options.transactionId,
          processBoundStaleMs: this.retainCommittedJournal
            ? INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS
            : undefined,
          ingestionRecovery: {
            registryRoot: this.registryRoot,
            runtimeJobsRoot: path.dirname(path.dirname(this.resultPath)),
          },
        },
      );
    } catch (error) {
      if (isLiveKnowledgeTransactionConflict(error)) {
        throw liveKnowledgeTransactionError(
          "A live ingestion transaction already owns this garden.",
        );
      }
      throw error;
    }
    try {
      fs.mkdirSync(this.registryRoot, { recursive: true });
      assertDirectKnowledgeDirectory(
        this.registryRoot,
        "Knowledge transaction registry",
      );
      if (this.retainCommittedJournal) {
        this.registryLock = acquireKnowledgeRegistryLock(
          this.registryRoot,
          options.transactionId,
        );
      }
    } catch (error) {
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Knowledge transaction setup failed and ownership could not be released.",
        );
      }
      throw error;
    }
    const initializationDirectory = knowledgeInitializationDirectory(
      this.registryRoot,
      options.transactionId,
    );
    const initializationBackupDirectory = path.join(
      initializationDirectory,
      "backups",
    );
    let published = false;
    try {
      fs.mkdirSync(initializationDirectory, {
        recursive: false,
        mode: 0o700,
      });
      fs.mkdirSync(initializationBackupDirectory, {
        recursive: false,
        mode: 0o700,
      });
      fsyncKnowledgeDirectory(initializationDirectory);
      fsyncKnowledgeDirectory(this.registryRoot);
      this.journal = {
        version: 1,
        transactionId: options.transactionId,
        ownerPid: process.pid,
        clusterPathSha256: knowledgeClusterPathSha256(this.clusterDir),
        state: "active",
        entries: [],
        createdDirectories: [],
      };
      writeKnowledgeJournal(initializationDirectory, this.journal);
      fs.renameSync(initializationDirectory, this.transactionDir);
      published = true;
      fsyncKnowledgeDirectory(this.registryRoot);
    } catch (error) {
      try {
        if (published && fs.existsSync(this.transactionDir)) {
          removeKnowledgeTransactionDirectory(
            this.registryRoot,
            this.transactionDir,
            options.transactionId,
            "rolled-back",
          );
        } else {
          fs.rmSync(initializationDirectory, { recursive: true, force: true });
          fsyncKnowledgeDirectory(this.registryRoot);
        }
      } catch (cleanupError) {
        error = new AggregateError(
          [error, cleanupError],
          "Knowledge transaction initialization failed and its debris could not be removed.",
        );
      }
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        error = new AggregateError(
          [error, releaseError],
          "Knowledge transaction initialization failed and ownership could not be released.",
        );
      }
      throw error;
    }
  }

  private releaseOwnership(): void {
    const failures: Error[] = [];
    try {
      releaseKnowledgeRegistryLock(this.registryRoot, this.registryLock);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.registryLock = null;
    }
    try {
      this.gardenMutationLease?.release();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.gardenMutationLease = null;
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Knowledge transaction ownership could not be released cleanly.",
      );
    }
  }

  private updateJournal(next: KnowledgeTransactionJournal): void {
    writeKnowledgeJournal(this.transactionDir, next);
    this.journal = next;
  }

  private assertGardenMutationOwnership(): void {
    this.assertExternalGardenMutationLease?.();
    if (this.gardenMutationLease) {
      assertActiveGardenMutationLease(this.gardenMutationLease);
    }
  }

  private assertMutable(): void {
    if (this.finalized || this.journal.state !== "active") {
      throw new Error(
        `Knowledge write transaction is already ${this.journal.state}.`,
      );
    }
  }

  private relativeWithinCluster(candidate: string, allowRoot = false): string {
    const resolved = path.resolve(candidate);
    const relative = path.relative(this.clusterDir, resolved);
    if (
      relative !== "" &&
      (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative))
    ) {
      throw new Error(
        "Knowledge write transaction path escaped the garden directory.",
      );
    }
    const portable = relative.split(path.sep).join("/");
    validateKnowledgeRelativePath(portable, allowRoot);
    let current = this.clusterDir;
    const segments = portable === "" ? [] : portable.split("/");
    if (fs.existsSync(current)) {
      const rootMetadata = fs.lstatSync(current);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw new Error(
          "Knowledge write transaction path contains an indirect garden directory.",
        );
      }
    }
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) break;
      const metadata = fs.lstatSync(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(
          "Knowledge write transaction path contains an indirect directory.",
        );
      }
    }
    return portable;
  }

  private resolveJournalPath(relativePath: string, allowRoot = false): string {
    const validated = validateKnowledgeRelativePath(relativePath, allowRoot);
    const resolved = path.resolve(
      this.clusterDir,
      ...(validated === "" ? [] : validated.split("/")),
    );
    const checked = this.relativeWithinCluster(resolved, allowRoot);
    if (checked !== validated) {
      throw new Error("Knowledge transaction journal path is not canonical.");
    }
    return resolved;
  }

  captureFile(filePath: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    const relativePath = this.relativeWithinCluster(filePath);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (
      this.journal.entries.some(
        (entry) =>
          (process.platform === "win32"
            ? entry.relativePath.toLowerCase()
            : entry.relativePath) === key,
      )
    )
      return;
    if (this.journal.entries.length >= MAX_KNOWLEDGE_TRANSACTION_ENTRIES) {
      throw new Error("Knowledge transaction file count exceeded its bound.");
    }

    const resolved = this.resolveJournalPath(relativePath);
    let original: KnowledgeAbsentSnapshot | KnowledgeFileBackupSnapshot = {
      kind: "absent",
    };
    if (fs.existsSync(resolved)) {
      const metadata = fs.lstatSync(resolved);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Knowledge write target is not a regular file.");
      }
      const retainedBackupBytes = this.journal.entries.reduce(
        (total, entry) =>
          total +
          (entry.original.kind === "file" ? entry.original.sizeBytes : 0),
        0,
      );
      const remainingBackupBytes =
        MAX_KNOWLEDGE_TRANSACTION_BACKUP_BYTES - retainedBackupBytes;
      if (
        !Number.isSafeInteger(retainedBackupBytes) ||
        remainingBackupBytes < 0 ||
        metadata.size > remainingBackupBytes
      ) {
        throw new Error(
          "Knowledge transaction backup bytes exceeded their bound.",
        );
      }
      const backupName = `${String(this.journal.entries.length).padStart(6, "0")}.snapshot`;
      const backup = createKnowledgeBackup(
        resolved,
        path.join(this.backupDir, backupName),
        remainingBackupBytes,
      );
      original = { kind: "file", backupName, ...backup };
    }
    this.updateJournal({
      ...this.journal,
      entries: [...this.journal.entries, { relativePath, original }],
    });
  }

  recordCreatedDirectory(directoryPath: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    const relativePath = this.relativeWithinCluster(directoryPath, true);
    const key =
      process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
    if (
      this.journal.createdDirectories.some(
        (entry) =>
          (process.platform === "win32" ? entry.toLowerCase() : entry) === key,
      )
    )
      return;
    if (fs.existsSync(directoryPath)) {
      throw new Error(
        "Knowledge transaction was asked to record an existing directory.",
      );
    }
    if (
      this.journal.createdDirectories.length >=
      MAX_KNOWLEDGE_TRANSACTION_DIRECTORIES
    ) {
      throw new Error(
        "Knowledge transaction directory count exceeded its bound.",
      );
    }
    this.updateJournal({
      ...this.journal,
      createdDirectories: [...this.journal.createdDirectories, relativePath],
    });
  }

  prepareResult(expectedSha256: string): void {
    this.assertMutable();
    this.assertGardenMutationOwnership();
    if (!KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)) {
      throw new Error("Knowledge transaction result digest is invalid.");
    }
    this.updateJournal({
      ...this.journal,
      state: "result-pending",
      resultSha256: expectedSha256,
    });
  }

  prepareResultReplacement(expectedSha256: string): void {
    this.assertGardenMutationOwnership();
    if (
      this.finalized ||
      this.journal.state !== "committed" ||
      !this.journal.resultSha256 ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)
    ) {
      throw new Error(
        "Knowledge transaction cannot replace its durable result.",
      );
    }
    const current = hashKnowledgeFile(this.resultPath);
    if (current.sha256 !== this.journal.resultSha256) {
      throw new Error(
        "Knowledge transaction result changed before reconciliation.",
      );
    }
    this.updateJournal({
      ...this.journal,
      state: "reconciling",
      replacementResultSha256: expectedSha256,
    });
  }

  readCommittedResult(): Buffer {
    if (
      this.finalized ||
      !["committed", "reconciling"].includes(this.journal.state) ||
      !this.journal.resultSha256
    ) {
      throw new Error("Knowledge transaction has no committed result.");
    }
    const opened = hashKnowledgeFile(this.resultPath);
    if (
      opened.sizeBytes < 1 ||
      opened.sizeBytes > MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES
    ) {
      throw new Error(
        "Knowledge transaction committed result is outside its bound.",
      );
    }
    const bytes = fs.readFileSync(this.resultPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== opened.sizeBytes || digest !== opened.sha256) {
      throw new Error(
        "Knowledge transaction committed result changed while it was read.",
      );
    }
    const accepted =
      this.journal.state === "reconciling"
        ? [this.journal.resultSha256, this.journal.replacementResultSha256]
        : [this.journal.resultSha256];
    if (!accepted.includes(digest)) {
      throw new Error(
        "Knowledge transaction committed result failed its integrity check.",
      );
    }
    return bytes;
  }

  commit(): void {
    this.assertGardenMutationOwnership();
    if (this.finalized)
      throw new Error("Knowledge write transaction was finalized.");
    if (this.journal.state === "committed") return;
    if (this.journal.state === "active") {
      if (this.retainCommittedJournal) {
        throw new Error(
          "Durable knowledge transactions require a result commit point.",
        );
      }
      removeKnowledgeTransactionDirectory(
        this.registryRoot,
        this.transactionDir,
        this.journal.transactionId,
        "committed",
      );
      this.finalized = true;
      this.releaseOwnership();
      return;
    } else if (this.journal.state === "result-pending") {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 !== this.journal.resultSha256) {
        throw new Error(
          "Knowledge transaction result did not reach its commit point.",
        );
      }
      this.updateJournal({ ...this.journal, state: "committed" });
    } else if (this.journal.state === "reconciling") {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 !== this.journal.replacementResultSha256) {
        throw new Error(
          "Knowledge transaction replacement result did not reach its commit point.",
        );
      }
      const replacementResultSha256 = this.journal.replacementResultSha256;
      const next = {
        ...this.journal,
        state: "committed",
        resultSha256: replacementResultSha256,
      };
      delete next.replacementResultSha256;
      this.updateJournal(next as KnowledgeTransactionJournal);
    } else {
      throw new Error("Knowledge transaction state is invalid.");
    }
  }

  seal(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.journal.state !== "committed" || !this.journal.resultSha256) {
      throw new Error("Only a committed knowledge transaction can be sealed.");
    }
    if (
      this.journal.entries.length > 0 ||
      this.journal.createdDirectories.length > 0
    ) {
      this.updateJournal({
        ...this.journal,
        entries: [],
        createdDirectories: [],
      });
    }
    for (const entry of readBoundedKnowledgeDirectoryEntries(
      this.backupDir,
      MAX_KNOWLEDGE_TRANSACTION_ENTRIES + 1,
      "Knowledge transaction backup directory",
    )) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error("Knowledge transaction backup directory is corrupt.");
      }
      fs.rmSync(path.join(this.backupDir, entry.name));
    }
    fsyncKnowledgeDirectory(this.backupDir);
    const tombstone: KnowledgeCommitTombstone = {
      version: 1,
      transactionId: this.journal.transactionId,
      clusterPathSha256: this.journal.clusterPathSha256,
      state: "committed",
      resultSha256: this.journal.resultSha256,
    };
    const tombstonePath = knowledgeCommitTombstonePath(this.resultPath);
    if (fs.existsSync(tombstonePath)) {
      const existing = readKnowledgeCommitTombstone(
        this.resultPath,
        this.journal.transactionId,
      );
      if (
        existing.clusterPathSha256 !== tombstone.clusterPathSha256 ||
        existing.state !== "committed" ||
        existing.resultSha256 !== tombstone.resultSha256
      ) {
        throw new Error(
          "Knowledge commit tombstone conflicts with the transaction.",
        );
      }
    }
    writeKnowledgeCommitTombstone(this.resultPath, tombstone);
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "committed",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  finalize(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.journal.state !== "committed") {
      throw new Error(
        "Only a committed knowledge transaction can be finalized.",
      );
    }
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "committed",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  rollback(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (
      this.journal.state === "result-pending" &&
      fs.existsSync(this.resultPath)
    ) {
      const result = hashKnowledgeFile(this.resultPath);
      if (result.sha256 === this.journal.resultSha256) {
        throw new Error(
          "Knowledge transaction crossed its durable result commit point.",
        );
      }
      throw new Error("Knowledge transaction result is corrupt.");
    }
    if (
      this.journal.state !== "active" &&
      this.journal.state !== "result-pending"
    ) {
      throw new Error(
        `Knowledge write transaction is already ${this.journal.state}.`,
      );
    }
    const failures: Error[] = [];
    for (const entry of [...this.journal.entries].reverse()) {
      try {
        const filePath = this.resolveJournalPath(entry.relativePath);
        if (entry.original.kind === "file") {
          const existing = fs.existsSync(filePath)
            ? fs.lstatSync(filePath)
            : null;
          if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
            throw new Error("Knowledge rollback target became indirect.");
          }
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          restoreKnowledgeSnapshot(
            path.join(this.backupDir, entry.original.backupName),
            filePath,
            entry.original,
          );
        } else if (fs.existsSync(filePath)) {
          const existing = fs.lstatSync(filePath);
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new Error("Knowledge rollback target became indirect.");
          }
          fs.rmSync(filePath);
          fsyncKnowledgeDirectory(path.dirname(filePath));
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    for (const relativePath of [...this.journal.createdDirectories].reverse()) {
      try {
        const directoryPath = this.resolveJournalPath(relativePath, true);
        if (!fs.existsSync(directoryPath)) continue;
        const metadata = fs.lstatSync(directoryPath);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new Error("Knowledge rollback directory became indirect.");
        }
        if (fs.readdirSync(directoryPath).length === 0) {
          fs.rmdirSync(directoryPath);
          fsyncKnowledgeDirectory(path.dirname(directoryPath));
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Failed to restore every knowledge file after ingestion rollback.",
      );
    }
    removeKnowledgeTransactionDirectory(
      this.registryRoot,
      this.transactionDir,
      this.journal.transactionId,
      "rolled-back",
    );
    this.finalized = true;
    this.releaseOwnership();
  }

  static recover(
    clusterDir: string,
    options: KnowledgeWriteTransactionOptions,
    assertExternalGardenMutationLease: () => void,
  ): KnowledgeWriteRecovery {
    assertExternalGardenMutationLease();
    const transactionDir = path.join(
      options.registryRoot,
      options.transactionId,
    );
    assertDirectKnowledgeDirectory(
      transactionDir,
      "Knowledge transaction directory",
    );
    const journal = readKnowledgeJournal(transactionDir, options.transactionId);
    if (journal.clusterPathSha256 !== knowledgeClusterPathSha256(clusterDir)) {
      throw new Error(
        "Knowledge transaction journal belongs to another garden.",
      );
    }
    if (processIsAliveForKnowledgeTransaction(journal.ownerPid)) {
      throw new Error("A live ingestion transaction cannot be recovered.");
    }
    const tombstonePath = knowledgeCommitTombstonePath(options.resultPath);
    if (fs.existsSync(tombstonePath)) {
      const tombstone = readKnowledgeCommitTombstone(
        options.resultPath,
        options.transactionId,
      );
      if (
        journal.state !== "committed" ||
        journal.resultSha256 !== tombstone.resultSha256 ||
        journal.clusterPathSha256 !== tombstone.clusterPathSha256
      ) {
        throw new Error(
          "Knowledge transaction conflicts with an existing commit tombstone.",
        );
      }
    }
    const transaction = new DiskBackedKnowledgeWriteTransaction(
      clusterDir,
      options,
      journal,
      assertExternalGardenMutationLease,
    );
    if (journal.state === "active") {
      transaction.rollback();
      return { transactionId: options.transactionId, outcome: "rolled-back" };
    }
    if (journal.state === "result-pending") {
      if (!fs.existsSync(options.resultPath)) {
        transaction.rollback();
        return { transactionId: options.transactionId, outcome: "rolled-back" };
      }
      transaction.commit();
    } else if (journal.state === "reconciling") {
      const result = hashKnowledgeFile(options.resultPath);
      if (result.sha256 === journal.replacementResultSha256) {
        transaction.commit();
      } else if (result.sha256 === journal.resultSha256) {
        const next = { ...journal, state: "committed" };
        delete next.replacementResultSha256;
        transaction.updateJournal(next as KnowledgeTransactionJournal);
      } else {
        throw new Error(
          "Knowledge transaction reconciliation result is corrupt.",
        );
      }
    } else {
      transaction.readCommittedResult();
    }
    return {
      transactionId: options.transactionId,
      outcome: "committed",
      transaction,
    };
  }
}

class CommittedKnowledgeWriteTransaction implements KnowledgeWriteTransaction {
  private readonly clusterDir: string;
  private readonly registryRoot: string;
  private readonly transactionId: string;
  private readonly resultPath: string;
  private tombstone: KnowledgeCommitTombstone;
  private registryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  private gardenMutationLease: GardenMutationLease | null = null;
  private finalized = false;

  constructor(
    clusterDir: string,
    registryRoot: string,
    transactionId: string,
    resultPath: string,
    tombstone: KnowledgeCommitTombstone,
  ) {
    this.clusterDir = path.resolve(clusterDir);
    this.registryRoot = path.resolve(registryRoot);
    this.transactionId = transactionId;
    this.resultPath = path.resolve(resultPath);
    this.tombstone = tombstone;
    assertDirectKnowledgeDirectory(
      this.registryRoot,
      "Knowledge transaction registry",
    );
    assertDirectKnowledgeDirectory(
      path.dirname(this.resultPath),
      "Knowledge transaction result directory",
    );
    if (
      tombstone.clusterPathSha256 !==
      knowledgeClusterPathSha256(this.clusterDir)
    ) {
      throw new Error("Knowledge commit tombstone belongs to another garden.");
    }
    this.gardenMutationLease = acquireGardenMutationLease(
      this.clusterDir,
      "document-ingestion-commit-recovery",
      {
        ownerId: this.transactionId,
        processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
        recoverStaleProcessBoundLease: true,
        ingestionRecovery: {
          registryRoot: this.registryRoot,
          runtimeJobsRoot: path.dirname(path.dirname(this.resultPath)),
        },
      },
    );
    try {
      this.registryLock = acquireKnowledgeRegistryLock(
        this.registryRoot,
        this.transactionId,
      );
      if (this.tombstone.state === "reconciling") {
        const result = hashKnowledgeFile(this.resultPath);
        const reconciledSha256 =
          result.sha256 === this.tombstone.replacementResultSha256
            ? this.tombstone.replacementResultSha256
            : result.sha256 === this.tombstone.resultSha256
              ? this.tombstone.resultSha256
              : null;
        if (!reconciledSha256) {
          throw new Error("Knowledge commit reconciliation result is corrupt.");
        }
        const next: KnowledgeCommitTombstone = {
          version: 1,
          transactionId: this.transactionId,
          clusterPathSha256: this.tombstone.clusterPathSha256,
          state: "committed",
          resultSha256: reconciledSha256,
        };
        writeKnowledgeCommitTombstone(this.resultPath, next);
        this.tombstone = next;
      }
    } catch (error) {
      try {
        this.releaseOwnership();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Knowledge commit recovery failed and ownership could not be released.",
        );
      }
      throw error;
    }
  }

  private assertGardenMutationOwnership(): void {
    if (!this.gardenMutationLease) {
      throw new Error(
        "Knowledge commit recovery has no Garden mutation lease.",
      );
    }
    assertActiveGardenMutationLease(this.gardenMutationLease);
  }

  private releaseOwnership(): void {
    const failures: Error[] = [];
    try {
      releaseKnowledgeRegistryLock(this.registryRoot, this.registryLock);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.registryLock = null;
    }
    try {
      this.gardenMutationLease?.release();
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.gardenMutationLease = null;
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Knowledge commit recovery ownership could not be released cleanly.",
      );
    }
  }

  private assertNotFinalized(): void {
    if (this.finalized) {
      throw new Error("Knowledge commit reconciliation was finalized.");
    }
  }

  captureFile(): void {
    throw new Error("A committed knowledge transaction cannot capture files.");
  }

  recordCreatedDirectory(): void {
    throw new Error(
      "A committed knowledge transaction cannot capture directories.",
    );
  }

  prepareResult(): void {
    throw new Error("A committed knowledge transaction already has a result.");
  }

  prepareResultReplacement(expectedSha256: string): void {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    if (
      this.tombstone.state !== "committed" ||
      !KNOWLEDGE_TRANSACTION_SHA256.test(expectedSha256)
    ) {
      throw new Error("Knowledge commit tombstone cannot replace its result.");
    }
    const current = hashKnowledgeFile(this.resultPath);
    if (current.sha256 !== this.tombstone.resultSha256) {
      throw new Error("Knowledge commit result changed before reconciliation.");
    }
    const next: KnowledgeCommitTombstone = {
      ...this.tombstone,
      state: "reconciling",
      replacementResultSha256: expectedSha256,
    };
    writeKnowledgeCommitTombstone(this.resultPath, next);
    this.tombstone = next;
  }

  readCommittedResult(): Buffer {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    const opened = hashKnowledgeFile(this.resultPath);
    if (
      opened.sizeBytes < 1 ||
      opened.sizeBytes > MAX_KNOWLEDGE_TRANSACTION_RESULT_BYTES
    ) {
      throw new Error("Knowledge commit result is outside its bound.");
    }
    const bytes = fs.readFileSync(this.resultPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== opened.sizeBytes || digest !== opened.sha256) {
      throw new Error("Knowledge commit result changed while it was read.");
    }
    const accepted =
      this.tombstone.state === "reconciling"
        ? [this.tombstone.resultSha256, this.tombstone.replacementResultSha256]
        : [this.tombstone.resultSha256];
    if (!accepted.includes(digest)) {
      throw new Error("Knowledge commit result failed its integrity check.");
    }
    return bytes;
  }

  commit(): void {
    this.assertNotFinalized();
    this.assertGardenMutationOwnership();
    if (this.tombstone.state === "committed") return;
    const result = hashKnowledgeFile(this.resultPath);
    if (result.sha256 !== this.tombstone.replacementResultSha256) {
      throw new Error(
        "Knowledge commit replacement did not reach its commit point.",
      );
    }
    const next: KnowledgeCommitTombstone = {
      version: 1,
      transactionId: this.transactionId,
      clusterPathSha256: this.tombstone.clusterPathSha256,
      state: "committed",
      resultSha256: result.sha256,
    };
    writeKnowledgeCommitTombstone(this.resultPath, next);
    this.tombstone = next;
  }

  seal(): void {
    if (this.finalized) return;
    this.assertGardenMutationOwnership();
    if (this.tombstone.state !== "committed") {
      throw new Error("Knowledge commit reconciliation is incomplete.");
    }
    this.finalized = true;
    this.releaseOwnership();
  }

  finalize(): void {
    this.assertNotFinalized();
    if (this.tombstone.state !== "committed") {
      throw new Error("Knowledge commit reconciliation is incomplete.");
    }
    fs.rmSync(knowledgeCommitTombstonePath(this.resultPath));
    fsyncKnowledgeDirectory(path.dirname(this.resultPath));
    this.seal();
  }

  rollback(): void {
    throw new Error("A committed knowledge transaction cannot be rolled back.");
  }
}

export function knowledgeWriteTransactionRegistryRoot(
  dataRoot: string,
  contentPath: string,
  clusterSlug: string,
): string {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  const gardenKey = knowledgeClusterPathSha256(clusterDir).slice(0, 32);
  return path.join(dataRoot, "runtime", "ingestion-transactions", gardenKey);
}

export function recoverKnowledgeWriteTransactions(
  contentPath: string,
  clusterSlug: string,
  registryRoot: string,
  runtimeJobsRoot: string,
): KnowledgeWriteRecovery[] {
  const clusterDir = path.join(contentPath, clusterSlug.trim());
  let recoveryLease: GardenMutationLease;
  try {
    recoveryLease = acquireGardenMutationLease(
      clusterDir,
      "document-ingestion-recovery",
      {
        ownerId: `recovery-${process.pid}-${randomBytes(8).toString("hex")}`,
        processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
        recoverStaleProcessBoundLease: true,
        ingestionRecovery: {
          registryRoot: path.resolve(registryRoot),
          runtimeJobsRoot: path.resolve(runtimeJobsRoot),
        },
      },
    );
  } catch (error) {
    if (isLiveKnowledgeTransactionConflict(error)) {
      throw liveKnowledgeTransactionError(
        "A live ingestion transaction cannot be recovered.",
      );
    }
    throw error;
  }
  let recoveryLock: HeldKnowledgeTransactionRegistryLock | null = null;
  let recovered = false;
  // Own the same per-garden lock as a writer for the whole scan. Merely
  // observing that a prior lock is stale leaves a race where a new writer can
  // start before rollback; recovery must either win the atomic create or fail
  // without touching the garden.
  try {
    assertActiveGardenMutationLease(recoveryLease);
    // Check only after acquiring the fence: the previous owner could create
    // its registry and crash between an earlier existence check and this lock.
    const registryExists = fs.existsSync(registryRoot);
    if (registryExists) {
      assertDirectKnowledgeDirectory(registryRoot, "Knowledge transaction registry");
    }
    // The transaction registry can already be gone while its process-bound
    // Garden lease remains after a crash or an interrupted cleanup. Acquiring
    // and releasing the recovery lease above safely fences and clears that
    // orphan even though there are no journals left to scan.
    if (!registryExists) {
      recovered = true;
      return [];
    }
    clearStaleKnowledgeRegistryLock(registryRoot);
    recoveryLock = acquireKnowledgeRegistryLock(
      registryRoot,
      `recovery_${process.pid}_${randomBytes(8).toString("hex")}`,
    );
    const recoveries: KnowledgeWriteRecovery[] = [];
    const entries = readBoundedKnowledgeDirectoryEntries(
      registryRoot,
      MAX_KNOWLEDGE_TRANSACTION_ENTRIES,
      "Knowledge transaction registry",
      KNOWLEDGE_TRANSACTION_LOCK_FILE,
    );
    for (const entry of entries) {
      if (removeKnowledgeTransactionDebris(registryRoot, entry)) continue;
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !KNOWLEDGE_TRANSACTION_IDENTIFIER.test(entry.name)
      ) {
        throw new Error(
          "Knowledge transaction registry contains an invalid entry.",
        );
      }
      const recovery = DiskBackedKnowledgeWriteTransaction.recover(
        clusterDir,
        {
          registryRoot,
          transactionId: entry.name,
          resultPath: path.join(runtimeJobsRoot, entry.name, "result.json"),
          retainCommittedJournal: true,
        },
        () => assertActiveGardenMutationLease(recoveryLease),
      );
      if (recovery.outcome === "committed") {
        if (!recovery.transaction) {
          throw new Error(
            "Committed knowledge transaction recovery is invalid.",
          );
        }
        recovery.transaction.seal();
        recoveries.push({ transactionId: entry.name, outcome: "committed" });
      } else {
        recoveries.push(recovery);
      }
    }
    recovered = true;
    return recoveries;
  } finally {
    try {
      releaseKnowledgeRegistryLock(registryRoot, recoveryLock);
    } finally {
      // A corrupt/incomplete rollback must not drop the fence and let the next
      // ordinary writer bypass the unresolved journal.
      if (recovered) recoveryLease.release();
      else recoveryLease.abandon();
    }
  }
}

export function recoverCommittedKnowledgeWriteTransaction(
  contentPath: string,
  clusterSlug: string,
  registryRoot: string,
  transactionId: string,
  resultPath: string,
): KnowledgeWriteRecovery | null {
  if (!KNOWLEDGE_TRANSACTION_IDENTIFIER.test(transactionId)) {
    throw new Error("Knowledge commit transaction identity is invalid.");
  }
  const tombstonePath = knowledgeCommitTombstonePath(resultPath);
  if (!fs.existsSync(tombstonePath)) return null;
  assertDirectKnowledgeDirectory(
    registryRoot,
    "Knowledge transaction registry",
  );
  clearStaleKnowledgeRegistryLock(registryRoot);
  const tombstone = readKnowledgeCommitTombstone(resultPath, transactionId);
  const transaction = new CommittedKnowledgeWriteTransaction(
    path.join(contentPath, clusterSlug.trim()),
    registryRoot,
    transactionId,
    resultPath,
    tombstone,
  );
  try {
    transaction.readCommittedResult();
  } catch (error) {
    try {
      transaction.seal();
    } catch {
      // The original integrity failure remains authoritative.
    }
    throw error;
  }
  return { transactionId, outcome: "committed", transaction };
}

export function createKnowledgeWriteTransaction(
  contentPath: string,
  clusterSlug: string,
  backupRootOrOptions: string | KnowledgeWriteTransactionOptions = os.tmpdir(),
): KnowledgeWriteTransaction {
  const options =
    typeof backupRootOrOptions === "string"
      ? {
          registryRoot: backupRootOrOptions,
          transactionId: `knowledge_${process.pid}_${Date.now()}_${randomBytes(8).toString("hex")}`,
          resultPath: path.join(
            backupRootOrOptions,
            `.breadboard-unused-result-${process.pid}-${Date.now()}`,
          ),
          retainCommittedJournal: false,
        }
      : backupRootOrOptions;
  return new DiskBackedKnowledgeWriteTransaction(
    path.join(contentPath, clusterSlug.trim()),
    options,
  );
}
